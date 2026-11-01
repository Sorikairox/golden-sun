#!/usr/bin/env python3
"""Build-time source transforms for the wasm build (orchestrator D3/D17). Vendor files are never edited or
copied into our tree: this tool reads a pinned vendor C file and writes a transformed copy into the gitignored
build directory, which the wasm build compiles in its place (with -iquote <vendor dir> so its own #includes
still resolve). The rules are mechanical and generic:

1. GNU nested functions (clang has none) become clang blocks:
     RET NAME(PARAMS) { BODY }   ->   RET (^NAME)(PARAMS) = ^RET(PARAMS) { BODY };
   A nested function reads and writes its parent's locals in place; a block copies them unless they are
   __block. So every parent local a block uses is marked __block (found from clang's AST of the block
   version). The blocks are never copied to the heap, so the tiny runtime they need is port/pc/blocks.c.
2. Empty asm statements (FAKEMATCH register barriers) use "r" for Thumb's "l"/"h" and lose their ARM register clobbers ("r0".."r12", "ip",
   "lr", "sp"); wasm has no such registers and an empty asm emits nothing either way.

Usage: see main(). The wasm build mirrors games/tbs/src as symlinks under build/wasm/src and writes only the
changed .c files, so every relative #include (including the many .c files that are #included) still resolves.
"""
import json
import os
import re
import subprocess
import sys


def blank(src):
    """src with comments, string and char literals replaced by spaces (same offsets), for brace matching."""
    out, i, n = list(src), 0, len(src)
    while i < n:
        c = src[i]
        if src.startswith('//', i):
            j = src.find('\n', i)
            j = n if j < 0 else j
            out[i:j] = ' ' * (j - i)
            i = j
        elif src.startswith('/*', i):
            j = src.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out[i:j] = [ch if ch == '\n' else ' ' for ch in src[i:j]]
            i = j
        elif c in '"\'':
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == '\\' else 1
            out[i + 1:j] = ' ' * (j - i - 1)
            i = j + 1
        elif c == '#' and (i == 0 or src[i - 1] == '\n'):
            j = i
            while True:  # preprocessor line, with continuations
                k = src.find('\n', j)
                k = n if k < 0 else k
                if k > 0 and src[k - 1] == '\\':
                    j = k + 1
                    continue
                break
            out[i:k] = [ch if ch == '\n' else ' ' for ch in src[i:k]]
            i = k
        else:
            i += 1
    return ''.join(out)


# Brace matching sees only the first branch of each #if (both stay in the output).
def blank_conditionals(src, b):
    out = list(b)
    stack = []  # per #if level: True while inside an #else/#elif branch
    pos = 0
    for line in src.split('\n'):
        t = line.strip()
        if t.startswith('#'):
            d = t[1:].strip()
            if d.startswith('if'):
                stack.append(False)
            elif d.startswith(('else', 'elif')) and stack:
                stack[-1] = True
            elif d.startswith('endif') and stack:
                stack.pop()
        elif any(stack):
            for k in range(pos, pos + len(line)):
                out[k] = ' '
        pos += len(line) + 1
    return ''.join(out)


def depth_map(b):
    d, out = 0, []
    for ch in b:
        if ch == '{':
            d += 1
        out.append(d)
        if ch == '}':
            d -= 1
    return out


def match_brace(b, i):
    d = 0
    for j in range(i, len(b)):
        if b[j] == '{':
            d += 1
        elif b[j] == '}':
            d -= 1
            if d == 0:
                return j
    raise ValueError('unbalanced')


HEADER = re.compile(r'(?P<ret>[A-Za-z_][\w\s\*]*?[\s\*])(?P<name>[A-Za-z_]\w*)\s*\((?P<params>[^(){};]*)\)\s*$', re.S)
CONTROL = {'if', 'for', 'while', 'switch', 'return', 'sizeof', 'do', 'else'}


def find_nested(src):
    """[(start, brace, end, ret, name, params)] for function definitions inside function bodies."""
    b = blank_conditionals(src, blank(src))
    dm = depth_map(b)
    found = []
    for m in re.finditer(r'\{', b):
        i = m.start()
        if dm[i] < 2:  # the brace opening a top-level body has depth 1
            continue
        # the text from the previous ; { or } up to this brace must be a function header
        k = i - 1
        while k >= 0 and b[k] not in ';{}':
            k -= 1
        head = b[k + 1:i]
        hm = HEADER.match(head.strip())
        if not hm or hm.group('name') in CONTROL or hm.group('ret').strip() in ('', 'else', 'return'):
            continue
        if re.search(r'[=,]', head.split('(')[0]):
            continue
        start = k + 1 + (len(head) - len(head.lstrip()))
        found.append((start, i, match_brace(b, i), hm.group('ret').strip(), hm.group('name'),
                      hm.group('params').strip()))
    return found


def to_blocks(src, log):
    for start, brace, end, ret, name, params in sorted(find_nested(src), reverse=True):
        words = [w for w in ret.split() if w not in ('static', 'inline', '__inline__')]
        attrs = [w for w in words if w.isupper() and w != 'UNUSED' or w == 'UNUSED']
        rtype = ' '.join(w for w in words if w not in attrs)
        params = params or 'void'
        new_head = f"{' '.join(attrs) + ' ' if attrs else ''}{rtype} (^{name})({params}) = ^{rtype}({params}) "
        src = src[:start] + new_head + src[brace:end + 1] + ';' + src[end + 1:]
        log.append(f'nested function {name} -> block')
    return src


EMPTY_ASM = re.compile(r'__asm__\s*(?:volatile\s*|__volatile__\s*)?\(\s*""(?P<rest>[^;]*?)\)\s*;')
REG = re.compile(r'\s*"(?:r\d+|ip|lr|sp|fp|sl)"\s*,?')


def strip_clobbers(src, log):
    def fix(m):
        rest = m.group('rest')
        thumb = re.sub(r'"([=+&]*)[lh]"\s*\(', r'"\1r"(', rest)  # Thumb low/high register classes
        if thumb != rest:
            log.append('empty asm: Thumb register class -> r')
            return m.group(0).replace(rest, thumb)
        parts = rest.split(':')
        if len(parts) >= 4 and REG.search(parts[3]):
            parts[3] = REG.sub('', parts[3]).rstrip().rstrip(',') + ' '
            log.append('empty asm: ARM register clobbers dropped')
            return m.group(0).replace(rest, ':'.join(parts))
        return m.group(0)
    return EMPTY_ASM.sub(fix, src)


ASM_STMT = re.compile(r'__asm__\s*(?:volatile\s*|__volatile__\s*)?\(\s*"(?P<tmpl>(?:[^"\\]|\\.)+)"(?P<rest>[^;]*?)\)\s*;')


def load_rules(path):
    rules = {}
    for line in open(path, encoding='utf-8'):
        if line.startswith('#') or line.startswith('template\t') or not line.strip():
            continue
        t, r = line.rstrip('\n').split('\t')[:2]
        rules[t] = r
    return rules


def replace_asm(src, rules, log):
    def fix(m):
        tmpl = m.group('tmpl')
        if tmpl not in rules:
            log.append(f'WARNING: asm "{tmpl}" has no rule')
            return m.group(0)
        sections = m.group('rest').split(':')[1:3]
        operands = [om.group(1) for sec in sections for om in re.finditer(r'"[^"]*"\s*\(([^()]*(?:\([^()]*\))?[^()]*)\)', sec)]
        log.append(f'asm "{tmpl}" -> C')
        return rules[tmpl].format(*operands)
    return ASM_STMT.sub(fix, src)


def walk(node, fn, stack=()):
    fn(node, stack)
    for ch in node.get('inner', []) or []:
        walk(ch, fn, stack + (node,))


class FileTracker:
    """clang's JSON AST writes "file" only when it changes from the previous location it printed; this
    follows the printing order (loc, then range begin/end; spelling before expansion) to name every one."""
    def __init__(self):
        self.cur = None

    def see(self, loc):
        if not isinstance(loc, dict):
            return None
        if 'spellingLoc' in loc or 'expansionLoc' in loc:
            sp = self.see(loc.get('spellingLoc'))
            ex = self.see(loc.get('expansionLoc'))
            return ex
        if 'file' in loc:
            self.cur = loc['file']
        if 'offset' in loc:
            return (self.cur, loc['offset'])
        return None


def mark_block_captures(top, clang_cmd, log):
    """Parse a translation unit that uses the blocks (from nested functions) and put __block on every parent
    local a block refers to; a parameter (which cannot be __block) is renamed NAME__param and copied into a
    __block local NAME at the top of the body. Edits go to whichever files of the TU hold the declarations."""
    r = subprocess.run(clang_cmd + ['-fblocks', '-Xclang', '-ast-dump=json', '-fsyntax-only', top],
                       capture_output=True, text=True)
    if not r.stdout:
        raise SystemExit(f'clang failed on {top}:\n{r.stderr[-3000:]}')
    ast = json.loads(r.stdout)
    ft = FileTracker()
    decls, parent_fn, body_of, captured, inside_block, where = {}, {}, {}, set(), {}, {}

    def visit(node, stack):
        loc = ft.see(node.get('loc'))
        rng = node.get('range', {})
        begin = ft.see(rng.get('begin'))
        ft.see(rng.get('end'))
        kind = node.get('kind')
        if kind == 'CompoundStmt' and stack and stack[-1].get('kind') == 'FunctionDecl':
            body_of[stack[-1]['id']] = begin
        fns = [s_ for s_ in stack if s_.get('kind') == 'FunctionDecl']
        blocks = tuple(s_['id'] for s_ in stack if s_.get('kind') == 'BlockDecl')
        if kind in ('VarDecl', 'ParmVarDecl') and fns:
            decls[node['id']] = node
            parent_fn[node['id']] = fns[-1]['id']
            inside_block[node['id']] = set(blocks)
            where[node['id']] = (loc, begin)
        if kind == 'DeclRefExpr' and blocks:
            ref = node.get('referencedDecl', {})
            if ref.get('kind') in ('VarDecl', 'ParmVarDecl'):
                captured.add((ref['id'], blocks))
    walk(ast, visit)
    edits = {}  # (file, offset) -> ('insert', text) | ('replace', old, new)
    for vid, blocks in sorted(captured):
        d = decls.get(vid)
        if d is None or inside_block[vid] & set(blocks):
            continue
        if d.get('storageClass') in ('static', 'extern'):
            continue
        name = d.get('name')
        loc, begin = where[vid]
        if d['kind'] == 'ParmVarDecl':
            body = body_of.get(parent_fn[vid])
            if not loc or not body or not loc[0]:
                log.append(f'WARNING: parameter {name}: no location')
                continue
            edits[loc] = ('replace', name, name + '__param')
            prev = edits.get((body[0], body[1] + 1), ('insert', ''))[1]
            line = f" __block {d['type']['qualType']} {name} = {name}__param;"
            if line not in prev:
                edits[(body[0], body[1] + 1)] = ('insert', prev + line)
            log.append(f'{os.path.basename(loc[0])}: parameter {name} -> __block copy')
        elif begin and begin[0]:
            if begin not in edits:
                edits[begin] = ('insert', '__block ')
                log.append(f'{os.path.basename(begin[0])}: __block {name}')
    by_file = {}
    for (f, off), e in edits.items():
        by_file.setdefault(f, []).append((off, e))
    for f, es in by_file.items():
        src = open(f, encoding='utf-8').read()
        for off, e in sorted(es, key=lambda x: -x[0]):
            if e[0] == 'insert':
                if e[1] == '__block ' and src.startswith('__block', off):
                    continue  # already marked by another translation unit
                if e[1] != '__block ' and e[1].strip() and e[1].strip() in src[off:off + len(e[1]) + 400]:
                    continue
                src = src[:off] + e[1] + src[off:]
            else:
                assert src[off:off + len(e[1])] == e[1], (f, off, e)
                src = src[:off] + e[2] + src[off + len(e[1]):]
        if os.path.islink(f):
            os.unlink(f)
        open(f, 'w').write(src)


def transform_text(path, log):
    """The text rules on one file; returns (new text, had nested functions)."""
    src = open(path, encoding='utf-8').read()
    out = strip_clobbers(src, log)
    rules = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../port/asm_rules.tsv')
    out = replace_asm(out, load_rules(rules), log)
    nested = bool(find_nested(out))
    if nested:
        out = to_blocks(out, log)
    return out, out != src, nested


def mirror(vendor_src, out_src):
    """out_src mirrors vendor_src with symlinks; every .c file the text rules change is written as a real
    file. Returns the files with nested functions (they need mark_block_captures on the TUs that use them)."""
    nested_files = []
    for d, _, files in os.walk(vendor_src):
        rel = os.path.relpath(d, vendor_src)
        od = os.path.join(out_src, rel)
        os.makedirs(od, exist_ok=True)
        for name in files:
            src, dst = os.path.join(d, name), os.path.join(od, name)
            log = []
            if name.endswith('.c'):
                text, changed, nested = transform_text(src, log)
            else:
                changed, nested = False, False
            if os.path.lexists(dst):
                os.unlink(dst)
            if changed:
                open(dst, 'w').write(text)
                for line in log:
                    print(f'{os.path.join(rel, name)}: {line}')
                if nested:
                    nested_files.append(os.path.join(rel, name))
            else:
                os.symlink(src, dst)
    return nested_files


def includes_closure(path, seen=None):
    seen = seen if seen is not None else set()
    if path in seen or not os.path.exists(path):
        return seen
    seen.add(path)
    for m in re.finditer(r'^\s*#\s*include\s+"([^"]+\.c)"', open(path, encoding='utf-8', errors='replace').read(), re.M):
        includes_closure(os.path.normpath(os.path.join(os.path.dirname(path), m.group(1))), seen)
    return seen


def main():
    """port_src.py --tree VENDOR_SRC OUT_SRC                 mirror + text rules; prints the changes
       port_src.py --captures TOP_C -- CLANG [flags...]     __block marks for one translation unit"""
    if sys.argv[1] == '--tree':
        nested = mirror(sys.argv[2], sys.argv[3])
        with open(os.path.join(sys.argv[3], '.nested'), 'w') as f:
            f.write('\n'.join(nested) + '\n')
    elif sys.argv[1] == '--captures':
        k = sys.argv.index('--')
        log = []
        mark_block_captures(sys.argv[2], sys.argv[k + 1:], log)
        for line in log:
            print(line)
    else:
        raise SystemExit(main.__doc__)


if __name__ == '__main__':
    main()
