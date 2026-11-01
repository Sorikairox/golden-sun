"""Object and link stages of the wasm build (tools/wasm/build.py).

obj:  each bound module (build/wasm/bound/*.ll, the game's and port/pc's) -> wasm object; build/wasm/gen too.
link: works out what is still undefined (llvm-nm), then generates build/wasm/gen/glue.ll:
  - far-call veneers: the game calls another bank's routine through a stub NAMEFar (gamepak/far_call/*.s
    `export NAME, TARGET`), and overlays call the main image through import stubs
    (system/overlay/imports.inc `import NAME, TARGET`); each becomes a function NAME that calls TARGET;
  - main-image references to a routine one overlay defines go to that overlay's ovNNN_ copy;
  - every other undefined function becomes a logged stub (Port_StubHit) with the signature its callers use;
then links game.js + game.wasm with emcc: no memory growth, 225 MB of linear memory (D5).
Writes build/wasm/stubs.tsv (name, kind: asm | port | other) and prints the counts.
"""
import concurrent.futures as cf
import glob
import os
import re
import subprocess
from collections import defaultdict

NM = '/emsdk/upstream/bin/llvm-nm'
TYPES = ('void', 'i1', 'i8', 'i16', 'i32', 'i64', 'float', 'double', 'ptr')
# 230400 KB = 0x0E100000: linear memory up to the end of the 64 KB flash at 0x0E000000 (D5)
LINK_FLAGS = ['-sINITIAL_MEMORY=230400kb', '-sALLOW_MEMORY_GROWTH=0', '-sSTACK_SIZE=1048576',
              '-sERROR_ON_UNDEFINED_SYMBOLS=1', '-sEXIT_RUNTIME=0', '-sENVIRONMENT=web,node',
              '-O2',
              # the frame driver hands each frame to the host and may be suspended there (port/web/port_lib.js)
              '--profiling-funcs',  # function names in traces (no data)
              '-sASYNCIFY=1', '-sASYNCIFY_STACK_SIZE=65536',
              # a factory (GoldenSun(opts)) that does not run main by itself: the page or test harness first
              # writes the player's ROM to 0x08000000
              '-sMODULARIZE=1', '-sEXPORT_NAME=GoldenSun', '-sINVOKE_RUN=0',
              '-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAP32,HEAPU32,ccall,callMain',
              # keep every game function and overlay even before anything calls it: the G2 check is that all
              # of them link; G3's boot path will make them reachable
              '-Wl,--no-gc-sections']


def sh(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr


def veneer_map(root):
    """NAME -> TARGET from the far-call tables and the overlay import list."""
    tbs = os.path.join(root, 'vendor/alchemy/games/tbs/src')
    out = {}
    files = glob.glob(os.path.join(tbs, 'gamepak/far_call/*.[sS]')) + [os.path.join(tbs, 'system/overlay/imports.inc')]
    for p in files:
        for line in open(p, encoding='utf-8', errors='replace'):
            m = re.match(r'\s*(export|import)\s+([\w.]+)\s*,\s*([\w.]+)', line)
            if m and m.group(2) != 'name':
                out.setdefault(m.group(2), m.group(3))
    return out


def signatures(ll_files):
    """name -> (ret, [param types], variadic) from define/declare lines."""
    sig = {}
    rx = re.compile(r'^(define|declare)\b(.*?)@(?:"([^"]+)"|([-\w$.]+))\((.*)\)')
    for p in ll_files:
        for line in open(p, encoding='utf-8'):
            if not line.startswith(('define', 'declare')):
                continue
            m = rx.match(line)
            if not m:
                continue
            name = m.group(3) or m.group(4)
            ret = next((t for t in reversed(m.group(2).split()) if t in TYPES), 'void')
            params_s = m.group(5)
            # strip a trailing ") attrs {" part kept by the greedy match
            depth, cut = 0, len(params_s)
            for i, ch in enumerate(params_s):
                if ch == '(':
                    depth += 1
                elif ch == ')':
                    if depth == 0:
                        cut = i
                        break
                    depth -= 1
            params_s = params_s[:cut]
            params, variadic = [], False
            parts, depth, cur = [], 0, ''
            for ch in params_s:
                if ch == ',' and depth == 0:
                    parts.append(cur)
                    cur = ''
                    continue
                depth += (ch == '(') - (ch == ')')
                cur += ch
            parts.append(cur)
            for part in [x.strip() for x in parts if x.strip()]:
                if part == '...':
                    variadic = True
                    continue
                params.append(part.split()[0])
            if m.group(1) == 'define' or name not in sig:
                sig[name] = (ret, params, variadic)
    return sig


def zero(ret):
    return {'void': None, 'ptr': 'null', 'float': '0.0', 'double': '0.0'}.get(ret, '0')


def run(objs, out, root, clang, jobs, stages):
    obj_dir = os.path.join(out, 'obj')
    os.makedirs(obj_dir, exist_ok=True)
    bound = [os.path.join(out, 'bound', o + '.ll') for _, o in objs]
    cfiles = [os.path.join(out, 'gen/relocated.c')]

    def compile_one(src):
        rel = os.path.relpath(src, root).replace('/', '__')
        o = os.path.join(obj_dir, rel + '.o')
        flags = ['--target=wasm32-unknown-emscripten', '-O2', '-c', '-o', o, src]
        if src.endswith('.c'):
            cmd = ['emcc', '-O2', '-c', '-o', o, src]
        else:
            cmd = [clang] + flags
        rc, _, err = sh(cmd)
        return o, (err[-1500:] if rc else None)
    if 'obj' in stages:
        fails = []
        with cf.ThreadPoolExecutor(jobs) as ex:
            for o, err in ex.map(compile_one, bound + cfiles):
                if err:
                    fails.append((o, err))
        print(f'obj: {len(bound) + len(cfiles) - len(fails)}/{len(bound) + len(cfiles)} objects')
        for o, err in fails[:10]:
            print('  FAIL', os.path.basename(o), next((l for l in err.splitlines() if 'error' in l), err[:300]))
        if fails:
            return False
    if 'link' not in stages:
        return True
    objects = sorted(glob.glob(os.path.join(obj_dir, '*.o')))
    objects = [o for o in objects if not o.endswith(('glue.ll.o', 'reloc_table.ll.o', 'code_map.ll.o'))]
    defined, undefined = set(), defaultdict(set)
    for o in objects:
        rc, so, _ = sh([NM, o])
        for line in so.splitlines():
            parts = line.split()
            if len(parts) == 2 and parts[0] == 'U':
                undefined[parts[1]].add(os.path.basename(o))
            elif len(parts) == 3 and parts[1] in 'TDBRVWtdbr':
                defined.add(parts[2])
    libc = {'memcpy', 'memset', 'memmove', 'printf', 'iprintf', 'puts', 'fflush', 'stdout', 'putchar', 'abort', 'port_frame_ready', 'abort', 'malloc', 'free', 'strlen', 'memcmp',
            '__stack_pointer', '__heap_base', '__indirect_function_table', '__memory_base', '__table_base',
            'emscripten_stack_get_current', '__stack_low', '__stack_high', '__data_end'}
    missing = {n: u for n, u in undefined.items() if n not in defined and n not in libc}
    sig = signatures(bound + [os.path.join(out, 'll', o + '.ll') for _, o in objs])
    vmap = veneer_map(root)
    overlay_def = defaultdict(list)
    for d in defined:
        m = re.match(r'ov([0-9a-f]{3})_(.+)$', d)
        if m:
            overlay_def[m.group(2)].append(d)

    def resolve(name, depth=0):
        if name in defined:
            return name
        if depth > 5:
            return None
        if name in vmap:
            return resolve(vmap[name], depth + 1)
        if len(overlay_def.get(name, [])) == 1:
            return overlay_def[name][0]
        return None
    lines = ['; generated by tools/wasm/link.py: veneers and logged stubs', 'declare void @Port_StubHit(i32)']
    stubs, veneers, mismatched = [], 0, 0
    declared = set()
    for name in sorted(missing):
        s = sig.get(name)
        if s is None:
            continue  # data symbol: reported by the link
        ret, params, variadic = s
        plist = ', '.join([f'{t} %a{i}' for i, t in enumerate(params)] + (['...'] if variadic else []))
        target = resolve(name)
        if target and target != name and variadic:
            # declared without a prototype (K&R `f()`): callers pass the promoted arguments, so the veneer takes
            # its target's signature
            dt = sig.get(target) or sig.get(re.sub(r'^ov[0-9a-f]{3}_', '', target))
            if dt and not dt[2]:
                ret, params, variadic = dt
                plist = ', '.join(f'{t} %a{i}' for i, t in enumerate(params))
        if target and target != name and not variadic:
            tret, tparams, _ = sig.get(re.sub(r'^ov[0-9a-f]{3}_', '', target), sig.get(target, (ret, params, False)))
            if (tret, tparams) != (ret, params):
                mismatched += 1
            if target not in declared:
                declared.add(target)
                dt = sig.get(target) or sig.get(re.sub(r'^ov[0-9a-f]{3}_', '', target)) or (ret, params, False)
                lines.insert(2, f'declare {dt[0]} @"{target}"({", ".join(dt[1] + (["..."] if dt[2] else []))})')
            args = ', '.join(f'{t} %a{i}' for i, t in enumerate(params))
            call = f'call {ret} @"{target}"({args})'
            body = f'  %r = {call}\n  ret {ret} %r' if ret != 'void' else f'  {call}\n  ret void'
            lines.append(f'define {ret} @"{name}"({plist}) {{\n{body}\n}}')
            veneers += 1
            continue
        idx = len(stubs)
        kind = 'port' if name.startswith('Port_') else ('asm' if is_asm(name, root) else 'other')
        stubs.append((name, kind, ','.join(sorted(missing[name]))[:200]))
        z = zero(ret)
        lines.append(f'define {ret} @"{name}"({plist}) {{\n  call void @Port_StubHit(i32 {idx})\n'
                     f'  ret {ret}{" " + z if z else ""}\n}}')
    names_c = os.path.join(out, 'gen', 'stub_names.c')
    with open(names_c, 'w') as f:
        f.write('/* generated by tools/wasm/link.py */\nconst char *const gPortStubNames[] = {\n')
        for n, _, _ in stubs:
            f.write(f'  "{n}",\n')
        f.write('  0};\n' + f'const int gPortStubCount = {len(stubs)};\n')
    glue = os.path.join(out, 'gen', 'glue.ll')
    open(glue, 'w').write('\n'.join(lines) + '\n')
    import relocs_gen
    stub_names = {n for n, _, _ in stubs}
    veneer_names = {re.match(r'define \S+ @"([^"]+)"', l).group(1) for l in lines if l.startswith('define')}
    reloc_ll = relocs_gen.generate(out, root, sig, defined | stub_names | veneer_names)
    import codemap_gen
    codemap_ll = codemap_gen.generate(out, root, sig, defined | stub_names | veneer_names)
    for src in (glue, names_c, reloc_ll, codemap_ll):
        o, err = compile_one(src)
        if err:
            print('glue compile failed:', err)
            return False
    with open(os.path.join(out, 'stubs.tsv'), 'w') as f:
        f.write('name\tkind\tcalled_from\n')
        for row in stubs:
            f.write('\t'.join(row) + '\n')
    kinds = defaultdict(int)
    for _, k, _ in stubs:
        kinds[k] += 1
    print(f'link: {veneers} veneers ({mismatched} with differing signatures), {len(stubs)} logged stubs '
          f'({", ".join(f"{k} {v}" for k, v in sorted(kinds.items()))})')
    objects = sorted(glob.glob(os.path.join(obj_dir, '*.o')))
    # exports: main and every function the PC layer defines (the page, node runners and the differential tests
    # of tests/arm call them)
    exports = {'main'}
    for o in objects:
        if os.path.basename(o).startswith('build__wasm__bound__port__pc__'):
            rc, so, _ = sh([NM, '--defined-only', o])
            exports |= {p[2] for p in (l.split() for l in so.splitlines()) if len(p) == 3 and p[1] == 'T'}
    flags = LINK_FLAGS + ['--js-library', os.path.join(root, 'port/web/port_lib.js'),
                          '-sEXPORTED_FUNCTIONS=' + ','.join('_' + e for e in sorted(exports))]
    rc, so, err = sh(['emcc'] + objects + flags + ['-o', os.path.join(out, 'game.js')])
    errs = [l for l in err.splitlines() if 'error' in l or 'undefined symbol' in l]
    warns = [l for l in err.splitlines() if 'warning' in l]
    if rc:
        print(f'link FAILED ({len(errs)} errors):')
        for l in errs[:25]:
            print('  ' + l[:200])
        return False
    size = os.path.getsize(os.path.join(out, 'game.wasm'))
    print(f'link: game.wasm {size} bytes; {len(warns)} linker warnings')
    for l in warns[:10]:
        print('  ' + l[:200])
    return True


_asm_names = None


def is_asm(name, root):
    """Is `name` defined by one of the vendor's assembly objects (D6: to be rewritten in C)?"""
    global _asm_names
    if _asm_names is None:
        _asm_names = set()
        rows = [l.split('\t') for l in open(os.path.join(root, 'port/symbols/tbs-en.tsv')) if not l.startswith('#')]
        tbs = os.path.join(root, 'vendor/alchemy/games/tbs')
        for r in rows[1:]:
            if len(r) > 6 and r[4] == 'code' and os.path.exists(os.path.join(tbs, r[6] + '.s')):
                _asm_names.add(r[0])
    return name in _asm_names
