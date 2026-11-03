#!/usr/bin/env python3
"""Compile the vendor's C drafts (recon/tla/en/main/<listing>.c) of TLA listing routines into a D20 test module,
for the TLA3 yield comparison against asm2c (docs/TLA3.md). Test-only; output in build/a2c/drafts (gitignored).

Each draft is compiled to LLVM IR with the emsdk clang (vendor headers, -DMODERN=1 -DTLA_EDITION_EN=1, empty
asm statements dropped: wasm has no registers to pin). In the IR, external data symbols are bound to their GBA
addresses (as bind.py does, trap 14) and every external function gets a C thunk that calls the ROM's routine in the
test interpreter (a2c_call), so only the draft's own code is under test. Usage:
  tests/arm/tla/drafts.py Name1,Name2,...   -> build/a2c/drafts/drafts.js + drafts.tsv (name, file, compile result)
"""
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
sys.path.insert(0, os.path.join(ROOT, 'tools/wasm'))
import asm2c  # noqa: E402

DOCKER = '/Applications/Docker.app/Contents/Resources/bin/docker'
OUT = os.path.join(ROOT, 'build/a2c/drafts')


def run(cmd):
    return subprocess.run([DOCKER, 'run', '--rm', '-v', f'{ROOT}:/gs', '-w', '/gs', 'emscripten/emsdk:4.0.15-arm64',
                           'bash', '-c', cmd], capture_output=True, text=True)


def bind_one(nm, f, syms, defined, seen_thunk, thunks):
    p = os.path.join(OUT, f'{f}.ll')
    ll = open(p).read()
    out = []
    for line in ll.split('\n'):
        m = re.match(r'@([\w.$]+) = external .*?(global|constant) ', line)
        if m:
            s = m.group(1)
            if s not in syms:
                raise KeyError(f'no address for data {s}')
            ll_sub = f'inttoptr (i32 {syms[s]} to ptr)'
            out.append(('BIND', s, ll_sub))
            continue
        out.append(line)
    binds = {x[1]: x[2] for x in out if isinstance(x, tuple)}
    body = '\n'.join(x for x in out if not isinstance(x, tuple))
    for s, sub in binds.items():
        body = re.sub(r'@' + re.escape(s) + r'\b', sub, body)
    for m in re.finditer(r'^declare [^@]*?(void|i8|i16|i32|ptr|i64)\s+@([\w.$]+)\(([^)]*)\)', body, re.M):
        ret, fn, args = m.group(1), m.group(2), m.group(3)
        if fn in defined or fn.startswith('llvm.') or fn in seen_thunk:
            continue
        if fn not in syms:
            raise KeyError(f'no address for function {fn}')
        seen_thunk.add(fn)
        n = len([a for a in args.split(',') if a.strip() and a.strip() != '...'])
        ps = ', '.join(f'u32 a{i}' for i in range(n)) or 'void'
        sets = ' '.join(f'a2c_r.r[{i}] = a{i};' for i in range(min(n, 4)))
        ct = 'void' if ret == 'void' else ('u64' if ret == 'i64' else 'u32')
        thunks.append(f'{ct} {fn}({ps}) {{ {sets} a2c_r.r[13] = 0x0d0f8000u; a2c_call(0x{syms[fn] | (syms[fn] & 1):x}u);'
                      + ('' if ct == 'void' else ' return a2c_r.r[0];') + ' }')
    open(p, 'w').write(body)


def main():
    names = sys.argv[1].split(',')
    syms = asm2c.load_symbols(os.path.join(ROOT, 'port/symbols'), os.path.join(ROOT, 'port_work/tla1/syms.txt'))[0]
    os.makedirs(OUT, exist_ok=True)
    vend = 'vendor/alchemy'
    inc = ['games/tla/include'] + [os.path.join('games/tla/include', d) for d in sorted(os.listdir(os.path.join(ROOT, vend, 'games/tla/include')))
                                   if os.path.isdir(os.path.join(ROOT, vend, 'games/tla/include', d))] + ['games/tla/src']
    flags = ' '.join(['--target=wasm32-unknown-emscripten', '-std=gnu89', '-ffreestanding', '-nostdinc', '-fno-builtin', '-O2',
                      '-w', '-Wno-error', '-DMODERN=1', '-DTLA_EDITION_EN=1', '-S', '-emit-llvm'] + [f'-I/gs/{vend}/{i}' for i in inc])
    rows, lls = [], []
    # the draft file of a routine is named after its listing file (the listing that defines it)
    raw = os.path.join(ROOT, vend, 'recon/tla/raw')
    owner = {}
    for f in os.listdir(raw):
        if f.endswith('.s'):
            for line in open(os.path.join(raw, f)):
                m = re.match(r'\s*\.global\s+(\S+)', line)
                if m:
                    owner[m.group(1)] = f[:-2]
    for nm in names:
        f = owner.get(nm)
        src = os.path.join(ROOT, vend, f'recon/tla/en/main/{f}.c') if f else None
        if not src or not os.path.exists(src):
            rows.append((nm, f or '', 'no draft'))
            continue
        text = open(src, encoding='utf8').read()
        if not re.search(r'\b' + re.escape(nm) + r'\s*\(', text):
            rows.append((nm, f, 'draft lacks the routine'))
            continue
        # drop GNU asm statements (register pinning/scheduling barriers): no meaning in wasm
        text = re.sub(r'\b(asm|__asm__)\s*(volatile\s*)?\((?:[^()]|\([^()]*\))*\)\s*;', ';', text)
        dst = os.path.join(OUT, f'{f}.c')
        open(dst, 'w').write(text)
        r = run(f'/emsdk/upstream/bin/clang {flags} build/a2c/drafts/{f}.c -o build/a2c/drafts/{f}.ll')
        if r.returncode:
            err = [x for x in r.stderr.split('\n') if 'error' in x][:1]
            rows.append((nm, f, 'compile error: ' + (err[0].split('error: ')[-1] if err else '?')))
            continue
        lls.append((nm, f))
        rows.append((nm, f, 'compiled'))
    # bind data, thunk functions
    thunks, defined = [], set()
    for nm, f in lls:
        ll = open(os.path.join(OUT, f'{f}.ll')).read()
        for m in re.finditer(r'^define [^@]*@([\w.$]+)\(', ll, re.M):
            defined.add(m.group(1))
    seen_thunk = set()
    good = []
    for nm, f in lls:
        try:
            thunks_before = len(thunks)
            bind_one(nm, f, syms, defined, seen_thunk, thunks)
            good.append((nm, f))
        except KeyError as e:
            rows[:] = [(a, b, f'link: {e.args[0]}' if a == nm else c) for a, b, c in rows]
            del thunks[thunks_before:]
    lls = good
    if False:
        p = None
    open(os.path.join(OUT, 'thunks.c'), 'w').write(
        '#include <stdint.h>\ntypedef uint32_t u32; typedef uint64_t u64;\n'
        'typedef struct { u32 r[16]; u32 n, z, c, v; } A2cRegs; extern A2cRegs a2c_r; void a2c_call(u32);\n'
        + '\n'.join(thunks) + '\n')
    exports = ','.join(['_a2c_regs_addr'] + [f'_{nm}' for nm, f in lls])
    lst = ' '.join(f'build/a2c/drafts/{f}.ll' for f in sorted(set(f for _, f in lls)))
    r = run(f'emcc -O2 -w {lst} build/a2c/drafts/thunks.c tests/arm/tla/a2c_rt.c --js-library tests/arm/tla/a2c_lib.js '
            '-sINITIAL_MEMORY=236978176 -sALLOW_MEMORY_GROWTH=0 -sMODULARIZE=1 -sENVIRONMENT=node -sSTACK_SIZE=1048576 '
            f'-sEXPORTED_FUNCTIONS={exports} -sEXPORTED_RUNTIME_METHODS=HEAPU8 -sEMULATE_FUNCTION_POINTER_CASTS=1 -o build/a2c/drafts/drafts.js')
    if r.returncode:
        print(r.stderr[-3000:])
    with open(os.path.join(OUT, 'drafts.tsv'), 'w') as o:
        for row in rows:
            o.write('\t'.join(row) + '\n')
    for row in rows:
        print('\t'.join(row))


if __name__ == '__main__':
    main()
