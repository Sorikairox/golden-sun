"""Binding stage of the wasm build (tools/wasm/build.py): rewrites each module's LLVM IR (build/wasm/ll ->
build/wasm/bound) so the game's data comes from where the GBA has it, not from the compiler.

For every data global a module defines or uses:
- a symbol of the reference build that is data (port/symbols/tbs-en.tsv, kind not code) becomes the constant
  `inttoptr (i32 ADDRESS to ptr)`: its ROM address, or its RAM address (EWRAM/IWRAM, identity map, D5);
  an overlay's own data its address in the overlay area (tbs-en-overlays.tsv), where the game's overlay loader
  decompresses it from the ROM;
- an absolute symbol (absolute.tsv: message and resource ids used as addresses) becomes its value;
- a data symbol holding code pointers, or pointing (transitively) to one (relocs.tsv), becomes a buffer that the
  PC layer fills at run time from the ROM with its pointer slots patched (build/wasm/gen/relocated.c);
- a C definition of any of those is dropped: its initializer (game data) is never compiled into the wasm.
Defined globals no table knows (compiler switch tables, block descriptors, string literals, a few static
buffers) stay; they are listed in build/wasm/kept_data.tsv for the leak check to review.
Overlay modules (D7): every symbol an overlay defines gets the prefix ovNNN_, so the 96 overlays link side by
side.
"""
import os
import re
from collections import defaultdict

TOKEN = re.compile(r'@(?:"([^"]+)"|([-\w$.]+))')
DEF_GLOBAL = re.compile(r'^@(?:"([^"]+)"|([-\w$.]+)) = (.*)$')
DEF_FUNC = re.compile(r'^define\b[^@]*@(?:"([^"]+)"|([-\w$.]+))\(')
DECL_FUNC = re.compile(r'^declare\b[^@]*@(?:"([^"]+)"|([-\w$.]+))\(')
# `%r = [tail ]call <type> %callee(` : an indirect call (the callee is a local value, not @function)
INDIRECT_CALL = re.compile(r'^(\s+(?:%[-\w.]+ = )?(?:tail |notail )?call [^%@(]*(?:\([^)]*\)\s*)?)(%[-\w.]+)\(')
COMPILER_LOCAL = re.compile(r'^(\.str|switch\.table|__block_|\.compoundliteral|__const\.|_NSConcrete|\.Lswitch|reltable)')


def read_tsv(path):
    rows, header = [], None
    for line in open(path, encoding='utf-8'):
        if line.startswith('#'):
            continue
        f = line.rstrip('\n').split('\t')
        if header is None:
            header = f
            continue
        rows.append(dict(zip(header, f)))
    return rows


class Tables:
    def __init__(self, root):
        sym = os.path.join(root, 'port/symbols')
        self.main = {}            # name -> row (globals and unique locals)
        self.main_local = {}      # (object, name) -> row
        for r in read_tsv(os.path.join(sym, 'tbs-en.tsv')):
            self.main_local[(r['object'], r['name'])] = r
            self.main.setdefault(r['name'], r)
        self.ovl = {}             # (overlay, name) -> row
        self.ovl_local = {}       # (overlay, object, name) -> row
        for r in read_tsv(os.path.join(sym, 'tbs-en-overlays.tsv')):
            self.ovl.setdefault((r['overlay'], r['name']), r)
            self.ovl_local[(r['overlay'], r['object'], r['name'])] = r
        self.main_by_obj = defaultdict(dict)
        for (ob, n), r in self.main_local.items():
            self.main_by_obj[ob][n] = r
        self.ovl_by_obj = defaultdict(dict)
        for (o, ob, n), r in self.ovl_local.items():
            self.ovl_by_obj[(o, ob)][n] = r
        self.absolute = {r['name']: int(r['value'], 16) for r in read_tsv(os.path.join(sym, 'absolute.tsv'))}
        self.relocs = read_tsv(os.path.join(sym, 'relocs.tsv'))
        self.relocated = self.closure()

    def closure(self):
        """(overlay or '', symbol) of every data symbol copied and patched at run time."""
        refs, out = defaultdict(set), set()
        for r in self.relocs:
            tgt = r['target'].split('+')[0]
            refs[(r['overlay'], tgt)].add((r['overlay'], r['symbol']))
            if r['overlay']:
                refs[('', tgt)].add((r['overlay'], r['symbol']))
            if r['target_kind'] == 'code':
                out.add((r['overlay'], r['symbol']))
        todo = list(out)
        while todo:
            for y in refs.get(todo.pop(), ()):
                if y not in out:
                    out.add(y)
                    todo.append(y)
        return out

    def lookup(self, image, obj, name):
        """(row, overlay or '') for a data name used in object `obj` of `image`, or (None, None)."""
        short = obj[len('src/'):] if obj.startswith('src/') else obj
        objkey = 'src/' + short
        cands = [name]
        if '.' in name:  # clang names a function's static Func.var; GCC 2.96 named it var.N
            cands.append(name.split('.', 1)[1])
        for c in cands:
            if image != 'main':
                r = self.ovl_local.get((image, objkey, c)) or self.ovl.get((image, c))
                if r is None:
                    pat = re.compile(re.escape(c) + r'\.\d+$')
                    hits = [v for n, v in self.ovl_by_obj[(image, objkey)].items() if pat.match(n)]
                    r = hits[0] if len(hits) == 1 else None
                if r is not None:
                    return r, image
            r = self.main_local.get((objkey, c))
            if r is None and c == name:
                r = self.main.get(c)
            if r is None:
                pat = re.compile(re.escape(c) + r'\.\d+$')
                hits = [v for n, v in self.main_by_obj[objkey].items() if pat.match(n)]
                r = hits[0] if len(hits) == 1 else None
            if r is not None:
                return r, ''
        return None, None


def name_of(m):
    return m.group(1) or m.group(2)


def fmt(name):
    return '@' + (name if re.fullmatch(r'[-\w$.]+', name) else f'"{name}"')


def run(objs, out, root):
    t = Tables(root)
    os.makedirs(os.path.join(out, 'gen'), exist_ok=True)
    overlay_defs = defaultdict(set)   # overlay -> names its modules define (external linkage)
    modules = []
    for image, obj in objs:
        text = open(os.path.join(out, 'll', obj + '.ll'), encoding='utf-8').read()
        modules.append((image, obj, text))
        if image != 'main':
            for line in text.split('\n'):
                for rx in (DEF_GLOBAL, DEF_FUNC):
                    m = rx.match(line)
                    if m and not re.search(r'= (internal|private)\b', line) and \
                            not (rx is DEF_GLOBAL and m.group(3).startswith('external')):
                        overlay_defs[image].add(name_of(m))
    stats = defaultdict(int)
    code_targets = {r['target'] for r in t.relocs if r['target_kind'] == 'code' and not r['overlay']}
    relocated_used = {}     # bound name -> (overlay, symbol, size)
    kept, unresolved, code_as_data = [], defaultdict(set), defaultdict(set)
    for image, obj, text in modules:
        lines = text.split('\n')
        funcs = set()
        globals_ = {}
        for line in lines:
            m = DEF_FUNC.match(line) or DECL_FUNC.match(line)
            if m:
                funcs.add(name_of(m))
                continue
            m = DEF_GLOBAL.match(line)
            if m and not m.group(3).startswith(('alias', 'ifunc')):
                globals_[name_of(m)] = m.group(3)
        repl, drop = {}, set()
        for name, rest in globals_.items():
            external = rest.startswith('external')
            local = bool(re.match(r'(internal|private)\b', rest))
            if COMPILER_LOCAL.match(name):
                continue
            if name in t.absolute and external:
                repl[name] = f'inttoptr (i32 {t.absolute[name]} to ptr)'
                stats['absolute'] += 1
                continue
            row, ov = t.lookup(image, obj, name)
            if row is not None and row['kind'] == 'code':
                # code read as data (ARM routines the game copies to RAM, veneer tables): bound to its ROM
                # bytes; anything that then calls the copy is ported by hand (G3, build/wasm/code_as_data.tsv)
                code_as_data[row['name']].add(obj)
            if row is not None:
                key = (ov, row['name'])
                if key in t.relocated:
                    bname = 'reloc_' + (ov + '_' if ov else '') + row['name']
                    relocated_used[bname] = (ov, row['name'], int(row['size']))
                    repl[name] = fmt(bname)
                    stats['relocated'] += 1
                else:
                    repl[name] = f"inttoptr (i32 {int(row['address'], 16)} to ptr)"
                    stats['rom/ram' if not ov else 'overlay data'] += 1
                if not external:
                    drop.add(name)
                    stats['C definitions dropped'] += 1
                continue
            if external:
                if image != 'main' and name in overlay_defs[image]:
                    repl[name] = fmt(f'ov{image}_{name}')
                    continue
                unresolved[name].add(obj)
                continue
            if image != 'main' and not local:
                repl[name] = fmt(f'ov{image}_{name}')
            init = rest.split(' x ', 1)[0]
            kept.append((obj, name, 'local' if local else 'global', len(rest)))
        if image != 'main':
            for name in funcs:
                if name in overlay_defs[image]:
                    repl[name] = fmt(f'ov{image}_{name}')
        new_lines = []
        n_rc = [0]
        for line in lines:
            mf = DEF_FUNC.match(line)
            if mf and ' internal ' in line.split('@', 1)[0] + ' ':
                fname = name_of(mf)
                # an overlay's static functions are renamed ovNNN_ (unique), and a main-image static a
                # relocated table points to must be reachable from the generated relocation table: both
                # become external
                if (image != 'main' and fname in repl) or (image == 'main' and fname in code_targets):
                    line = line.replace('define internal ', 'define ', 1)
                    stats['static functions made external'] += 1
            m = DEF_GLOBAL.match(line)
            if m and name_of(m) in drop:
                continue
            if m and name_of(m) in repl and repl[name_of(m)].startswith('inttoptr'):
                continue  # the external declaration of a bound symbol

            def sub(mm):
                n = name_of(mm)
                return repl.get(n, mm.group(0)) if n in repl else mm.group(0)
            line = TOKEN.sub(sub, line)
            mc = INDIRECT_CALL.match(line)
            if mc:
                # an indirect call: the pointer may be a GBA code address (ROM data, the overlay entry table, a
                # RAM copy of an ARM routine); Port_ResolveCode maps it to the wasm function (port/pc/codemap.c)
                n_rc[0] += 1
                tmp = f'%port.rc{n_rc[0]}'
                indent = line[:len(line) - len(line.lstrip())]
                new_lines.append(f'{indent}{tmp} = call ptr @Port_ResolveCode(ptr {mc.group(2)})')
                line = line[:mc.start(2)] + tmp + line[mc.end(2):]
                stats['indirect calls resolved'] += 1
            new_lines.append(line)
        # relocated buffers are declared as external globals under their new name
        decls = []
        if n_rc[0] and not any(l.startswith('declare ptr @Port_ResolveCode(') for l in new_lines):
            decls.append('declare ptr @Port_ResolveCode(ptr)')
        for name, r in repl.items():
            if r.startswith('@reloc_') and not any(l.startswith(r + ' = ') for l in new_lines):
                decls.append(f'{r} = external global [0 x i8], align 4')
        # a renamed external declaration may now be declared twice; keep the first
        seen, final = set(), []
        for line in new_lines + decls:
            m = DEF_GLOBAL.match(line)
            if m and m.group(3).startswith('external'):
                if name_of(m) in seen:
                    continue
                seen.add(name_of(m))
            final.append(line)
        path = os.path.join(out, 'bound', obj + '.ll')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, 'w', encoding='utf-8').write('\n'.join(final))
    # generated buffers for the relocated copies (filled at run time by port/pc)
    sizes = {('', r['name']): int(r['size']) for r in t.main.values()}
    sizes.update({(o, n): int(r['size']) for (o, n), r in t.ovl.items()})
    for ov, sym_ in t.relocated:
        bname = 'reloc_' + (ov + '_' if ov else '') + sym_
        relocated_used.setdefault(bname, (ov, sym_, sizes.get((ov, sym_), 4)))
    with open(os.path.join(out, 'gen', 'relocated.c'), 'w') as f:
        f.write('/* Generated by tools/wasm/bind.py: buffers for data symbols with code pointers (and data pointing to\n'
                ' * them). Port_RelocateAll() fills each from the ROM and patches its pointer slots. No game bytes here. */\n')
        f.write('typedef unsigned char u8;\n')
        for bname, (ov, sym, size) in sorted(relocated_used.items()):
            if not re.fullmatch(r'[A-Za-z_]\w*', bname):
                continue  # an unnamed section piece: nothing in C can name it
            f.write(f'u8 {bname}[{max(size, 4)}] __attribute__((aligned(4)));\n')
    with open(os.path.join(out, 'kept_data.tsv'), 'w') as f:
        f.write('object\tname\tlinkage\tir_chars\n')
        for row in kept:
            f.write('\t'.join(str(x) for x in row) + '\n')
    with open(os.path.join(out, 'code_as_data.tsv'), 'w') as f:
        for name, users in sorted(code_as_data.items()):
            f.write(f'{name}\t{",".join(sorted(users))}\n')
    with open(os.path.join(out, 'unresolved_data.tsv'), 'w') as f:
        for name, users in sorted(unresolved.items()):
            f.write(f'{name}\t{",".join(sorted(users))}\n')
    print('bind: ' + ', '.join(f'{k} {v}' for k, v in sorted(stats.items())) +
          f'; relocated buffers {len(relocated_used)}; kept defined data {len(kept)}; '
          f'unresolved data names {len(unresolved)} (build/wasm/unresolved_data.tsv); '
          f'code read as data {len(code_as_data)}')
    return True
