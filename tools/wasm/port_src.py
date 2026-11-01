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
2. Empty asm statements (FAKEMATCH register barriers) lose their ARM register clobbers ("r0".."r12", "ip",
   "lr", "sp"); wasm has no such registers and an empty asm emits nothing either way.

Usage: port_src.py VENDOR_FILE OUT_FILE -- CLANG [clang flags...]   (the flags are used for the AST pass)
Prints one line per change.
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


def mark_block_captures(src, path_for_clang, clang_cmd, log):
    """Parse the block version and put __block on every parent local that a block refers to. A parameter
    cannot be __block: it is renamed NAME__param and copied into a __block local NAME at the top of the body."""
    r = subprocess.run(clang_cmd + ['-fblocks', '-Xclang', '-ast-dump=json', '-fsyntax-only', path_for_clang],
                       capture_output=True, text=True)
    if not r.stdout:
        raise SystemExit(f'clang failed on the block version:\n{r.stderr[-3000:]}')
    ast = json.loads(r.stdout)
    decls, parent_fn, body_of, captured = {}, {}, {}, set()
    inside_block = {}

    def visit(node, stack):
        kind = node.get('kind')
        fns = [s_ for s_ in stack if s_.get('kind') == 'FunctionDecl']
        blocks = tuple(s_['id'] for s_ in stack if s_.get('kind') == 'BlockDecl')
        if kind == 'FunctionDecl':
            for ch in node.get('inner', []) or []:
                if ch.get('kind') == 'CompoundStmt':
                    body_of[node['id']] = ch['range']['begin'].get('offset')
        if kind in ('VarDecl', 'ParmVarDecl') and fns:
            decls[node['id']] = node
            parent_fn[node['id']] = fns[-1]['id']
            inside_block[node['id']] = set(blocks)
        if kind == 'DeclRefExpr' and blocks:
            ref = node.get('referencedDecl', {})
            if ref.get('kind') in ('VarDecl', 'ParmVarDecl'):
                captured.add((ref['id'], blocks))
    walk(ast, visit)
    edits = {}
    for vid, blocks in captured:
        d = decls.get(vid)
        if d is None or inside_block[vid] & set(blocks):
            continue
        if 'storageClass' in d and d['storageClass'] in ('static', 'extern'):
            continue
        name = d.get('name')
        if d['kind'] == 'ParmVarDecl':
            loc = d.get('loc', {}).get('offset')
            body = body_of.get(parent_fn[vid])
            if loc is None or body is None:
                log.append(f'WARNING: parameter {name}: no location')
                continue
            edits[loc] = ('replace', name, name + '__param')
            prev = edits.get(body + 1, ('insert', ''))[1]
            line = f" __block {d['type']['qualType']} {name} = {name}__param;"
            if line not in prev:
                edits[body + 1] = ('insert', prev + line)
            log.append(f'parameter {name} -> __block copy')
        else:
            off = d.get('range', {}).get('begin', {}).get('offset')
            if off is not None:
                edits.setdefault(off, ('insert', '__block '))
                log.append(f'__block {name}')
    for off in sorted(edits, reverse=True):
        e = edits[off]
        if e[0] == 'insert':
            src = src[:off] + e[1] + src[off:]
        else:
            assert src[off:off + len(e[1])] == e[1], (off, e)
            src = src[:off] + e[2] + src[off + len(e[1]):]
    return src


def main():
    if '--' not in sys.argv:
        raise SystemExit(__doc__)
    k = sys.argv.index('--')
    vendor, out = sys.argv[1:k]
    clang_cmd = sys.argv[k + 1:]
    src = open(vendor, encoding='utf-8').read()
    log = []
    src = strip_clobbers(src, log)
    rules = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../port/asm_rules.tsv')
    src = replace_asm(src, load_rules(rules), log)
    nested = find_nested(src)
    if nested:
        src = to_blocks(src, log)
        open(out, 'w').write(src)
        src = mark_block_captures(src, out, clang_cmd, log)
    # keep diagnostics and __FILE__ pointing at the vendor file
    open(out, 'w').write(f'#line 1 "{vendor}"\n' + src)
    for line in log:
        print(f'{vendor.split("/src/")[-1]}: {line}')


if __name__ == '__main__':
    main()
