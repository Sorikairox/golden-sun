#!/usr/bin/env python3
"""The wasm build (phase G2). Runs inside the emscripten/emsdk image (tools/web_build.sh mounts the repo at
/gs, vendor read only). Steps, each writing under build/wasm/:

  src/   vendor C code objects through tools/wasm/port_src.py (transforms; #line keeps vendor paths)
  ll/    LLVM IR of each (clang --target=wasm32-unknown-emscripten, port/shim prelude, -fblocks)
  bound/ the IR after binding (bind.py): every data symbol the game reads from the ROM or RAM becomes its fixed
         address (identity memory map, D5), C definitions of ROM data are dropped (so no asset is compiled in),
         code-pointer tables and the data pointing to them become run-time relocated copies, overlay symbols get
         an ovNNN_ prefix (D7), far-call/import veneers are generated
  obj/   wasm objects; game.wasm/game.js linked with port/pc and generated logged stubs for what is missing

Usage (inside the container): python3 tools/wasm/build.py [--jobs N] [--only STAGE]
"""
import argparse
import concurrent.futures as cf
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
V = os.path.join(ROOT, 'vendor/alchemy')
TBS = os.path.join(V, 'games/tbs')
OUT = os.path.join(ROOT, 'build/wasm')
CLANG = os.environ.get('WASM_CLANG', '/emsdk/upstream/bin/clang')
INC = ['include'] + ['include/' + d for d in 'battle field game gamepak graphics menu shop sound system window'.split()]
CFLAGS = ['--target=wasm32-unknown-emscripten', '-std=gnu89', '-ffreestanding', '-nostdinc', '-fno-builtin',
          '-fblocks', '-DMODERN=1', '-DTBS_EDITION_EN=1', '-DPORT_WASM=1', '-O2', '-w',
          '-fno-strict-aliasing', '-fwrapv', '-fsigned-char',
          '-include', os.path.join(ROOT, 'port/shim/prelude.h'), '-I' + os.path.join(ROOT, 'port/shim')] + \
         ['-I' + os.path.join(TBS, d) for d in INC] + ['-I' + os.path.join(ROOT, 'port_work/g1/gen')]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def read_tsv(path):
    rows = []
    header = None
    for line in open(path, encoding='utf-8'):
        if line.startswith('#'):
            continue
        f = line.rstrip('\n').split('\t')
        if header is None:
            header = f
            continue
        rows.append(dict(zip(header, f)))
    return rows


def code_objects():
    """[(image, object path under games/tbs without extension)] of C objects with code, in link order."""
    out = []
    for r in read_tsv(os.path.join(ROOT, 'port/symbols/objects.tsv')):
        if r['class'] in ('code', 'mixed') and os.path.exists(os.path.join(TBS, r['object'] + '.c')):
            out.append((r['image'], r['object']))
    return out


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    return r.returncode, r.stdout, r.stderr


def stage_src_ll(objs, jobs):
    # build/wasm/tbs mirrors games/tbs: src/ as symlinks plus the transformed files, include/ as one symlink,
    # so relative includes like ../../../include/gamepak/flash.h resolve
    base = os.path.join(OUT, 'tbs')
    tree = os.path.join(base, 'src')
    if os.path.isdir(base):
        subprocess.run(['rm', '-rf', base], check=True)
    os.makedirs(base)
    os.symlink(os.path.join(TBS, 'include'), os.path.join(base, 'include'))
    rc, so, se = run([sys.executable, os.path.join(ROOT, 'tools/wasm/port_src.py'), '--tree',
                      os.path.join(TBS, 'src'), tree])
    if rc:
        print(se[-3000:])
        return False
    notes = [l for l in so.splitlines() if l]
    nested = [os.path.join(tree, l) for l in open(os.path.join(tree, '.nested')).read().split() if l]
    import port_src

    def src_of(obj):
        return os.path.join(tree, obj[len('src/'):] + '.c')
    # translation units that include a file with nested functions: mark their captures (sequential: the edits
    # land in shared included files)
    for image, obj in objs:
        top = src_of(obj)
        if set(nested) & port_src.includes_closure(top):
            rc, so, se = run([sys.executable, os.path.join(ROOT, 'tools/wasm/port_src.py'), '--captures', top,
                              '--', CLANG] + CFLAGS + ['-iquote', os.path.dirname(top)])
            if rc:
                print(f'captures failed for {obj}:', se[-2000:])
                return False
            notes += [f'{obj}: {l}' for l in so.splitlines() if l]

    def one(item):
        image, obj = item
        src = src_of(obj)
        ll = os.path.join(OUT, 'll', obj + '.ll')
        os.makedirs(os.path.dirname(ll), exist_ok=True)
        rc, _, se = run([CLANG] + CFLAGS + ['-S', '-emit-llvm', '-o', ll, src])
        return obj, (se[-2000:] if rc else None)
    fails = []
    with cf.ThreadPoolExecutor(jobs) as ex:
        for obj, err in ex.map(one, objs):
            if err is not None:
                fails.append((obj, err))
    print(f'src+ll: {len(objs) - len(fails)}/{len(objs)} C objects compiled to IR; {len(notes)} transform notes')
    for obj, err in fails:
        first = next((l for l in err.splitlines() if 'error' in l), err.strip()[:300])
        print(f'  FAIL {obj}: {first}')
    with open(os.path.join(OUT, 'transform_notes.txt'), 'w') as f:
        f.write('\n'.join(notes) + '\n')
    return not fails


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--jobs', type=int, default=os.cpu_count())
    ap.add_argument('--only')
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    objs = code_objects()
    stages = ['ll', 'bind', 'obj', 'link', 'leak']
    if a.only:
        stages = a.only.split(',')
    if 'll' in stages and not stage_src_ll(objs, a.jobs):
        sys.exit(1)
    if 'bind' in stages:
        import bind
        if not bind.run(objs, OUT, ROOT):
            sys.exit(1)
    if 'obj' in stages or 'link' in stages:
        import link
        if not link.run(objs, OUT, ROOT, CLANG, a.jobs, stages):
            sys.exit(1)
    if 'leak' in stages:
        import leak_check
        if not leak_check.run(os.path.join(OUT, 'game.wasm'), ROOT):
            sys.exit(1)


if __name__ == '__main__':
    main()
