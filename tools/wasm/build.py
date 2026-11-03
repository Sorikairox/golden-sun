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

Usage (inside the container): python3 tools/wasm/build.py [--game tbs|tla] [--jobs N] [--only STAGE]
--game (TLA2) picks the game (tools/wasm/game.py); tbs, the default, is GS1 with its paths unchanged.
"""
import argparse
import concurrent.futures as cf
import glob
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
# the game is chosen before anything reads game.py (it is read at import, also by the port_src.py subprocesses)
for _i, _a in enumerate(sys.argv):
    if _a == '--game' and _i + 1 < len(sys.argv):
        os.environ['PORT_GAME'] = sys.argv[_i + 1]
    elif _a.startswith('--game='):
        os.environ['PORT_GAME'] = _a.split('=', 1)[1]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import game  # noqa: E402
V = os.path.join(ROOT, 'vendor/alchemy')
TBS = game.C.vendor
OUT = game.C.out
# where the game tree is mirrored (port_src.py). TLA (TLA2): under alchemy/games/tla so the vendor's root-relative
# includes (../../../../../games/tla/src/...) land in the mirror, and include/ is mirrored (and transformed) too
MIRROR = os.path.join(OUT, 'tbs') if game.C.game == 'tbs' else os.path.join(OUT, 'alchemy', game.C.vendor_game)
INCROOT = TBS if game.C.game == 'tbs' else MIRROR
CLANG = os.environ.get('WASM_CLANG', '/emsdk/upstream/bin/clang')
INC = ['include'] + ['include/' + d for d in 'battle field game gamepak graphics menu shop sound system window'.split()]
CFLAGS = ['--target=wasm32-unknown-emscripten', '-std=gnu89', '-ffreestanding', '-nostdinc', '-fno-builtin',
          '-fblocks', '-DMODERN=1', f'-D{game.C.define}=1', '-DPORT_WASM=1', '-O2', '-w',
          '-fno-strict-aliasing', '-fwrapv', '-fsigned-char',
          '-include', game.C.prelude, '-I' + game.C.shim] + \
         ['-I' + os.path.join(INCROOT, d) for d in INC] + ['-I' + game.C.gen] + game.C.extra_cflags


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
    """[(image, object)] of C objects with code, in link order: the game's (path under games/tbs without
    extension), then the PC layer's ('port/pc/NAME'), which goes through the same binding so it can name game
    data (gIrqHandlers, Trig_SineTable...) and get their GBA addresses."""
    out = []
    for r in read_tsv(game.sym('objects.tsv')):
        if r['class'] in ('code', 'mixed') and os.path.exists(os.path.join(TBS, r['object'] + '.c')):
            out.append((r['image'], r['object']))
    for n in game.pc_files():
        out.append(('main', 'port/pc/' + n))
    if game.C.game == 'tla':  # TLA4's C ports of the hand-written .s (port/tla/hw/*.c), bound like port/pc (TLA5)
        for p in sorted(glob.glob(os.path.join(ROOT, 'port/tla/hw/*.c'))):
            out.append(('main', 'port/tla/hw/' + os.path.basename(p)[:-2]))
    return out


def stage_asm2c():
    """TLA5 (D23): tools/wasm/asm2c.py translates the listing asm (main and overlays) into build/<out>/asm2c:
    tla_asm.c (compiled and linked by link.py), names.tsv (the routines' names, for the stub binding), report.tsv.
    Never committed."""
    d = os.path.join(OUT, 'asm2c')
    os.makedirs(d, exist_ok=True)
    rc, so, se = run([sys.executable, os.path.join(ROOT, 'tools/wasm/asm2c.py'), '--vendor', V,
                      '--symbols', os.path.join(ROOT, 'port/symbols'),
                      '--extra-symbols', os.path.join(ROOT, 'port/tla/symbols/tla-en-extra.tsv'),
                      '-o', os.path.join(d, 'tla_asm.c'), '--report', os.path.join(d, 'report.tsv'),
                      '--names', os.path.join(d, 'names.tsv'), '--export', '*'])
    print(so.strip() or se[-3000:])
    return rc == 0


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    return r.returncode, r.stdout, r.stderr


def stage_src_ll(objs, jobs):
    # build/wasm/tbs mirrors games/tbs: src/ as symlinks plus the transformed files, include/ as one symlink,
    # so relative includes like ../../../include/gamepak/flash.h resolve
    base = MIRROR
    tree = os.path.join(base, 'src')
    top = base if game.C.game == 'tbs' else os.path.join(OUT, 'alchemy')
    if os.path.isdir(top):
        subprocess.run(['rm', '-rf', top], check=True)
    os.makedirs(base)
    if game.C.game == 'tbs':
        os.symlink(os.path.join(TBS, 'include'), os.path.join(base, 'include'))
    else:
        rc, so, se = run([sys.executable, os.path.join(ROOT, 'tools/wasm/port_src.py'), '--tree',
                          os.path.join(TBS, 'include'), os.path.join(base, 'include')])
        if rc:
            print(se[-3000:])
            return False
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
        if obj.startswith('port/'):
            continue
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
        ll = os.path.join(OUT, 'll', obj + '.ll')
        os.makedirs(os.path.dirname(ll), exist_ok=True)
        if obj.startswith('port/'):  # the PC layer: emscripten's libc headers, the game's types via port/pc
            rc, _, se = run(['emcc', '-O2', '-S', '-emit-llvm', '-I' + os.path.join(ROOT, 'port/pc'),
                             '-o', ll, os.path.join(ROOT, obj + '.c')])
        else:
            rc, _, se = run([CLANG] + CFLAGS + ['-S', '-emit-llvm', '-o', ll, src_of(obj)])
        return obj, (se[-2000:] if rc else None)
    fails = []
    with cf.ThreadPoolExecutor(jobs) as ex:
        # TLA: an object linked into several overlays is compiled once (bind writes one module per overlay)
        todo = objs if game.C.game == 'tbs' else list({o: (i, o) for i, o in reversed(objs)}.values())[::-1]
        for obj, err in ex.map(one, todo):
            if err is not None:
                fails.append((obj, err))
    print(f'src+ll: {len(todo) - len(fails)}/{len(todo)} C objects compiled to IR; {len(notes)} transform notes')
    for obj, err in fails:
        first = next((l for l in err.splitlines() if 'error' in l), err.strip()[:300])
        print(f'  FAIL {obj}: {first}')
    with open(os.path.join(OUT, 'transform_notes.txt'), 'w') as f:
        f.write('\n'.join(notes) + '\n')
    if game.C.game != 'tbs':
        # TLA2: an object clang cannot take yet is left out (its functions become logged stubs) and listed
        with open(os.path.join(OUT, 'll_failed.tsv'), 'w') as f:
            f.write('object\terror\n')
            for obj, err in fails:
                first = next((l for l in err.splitlines() if 'error' in l), err.strip()[:300])
                f.write(f'{obj}\t{first.strip()}\n')
        return True
    return not fails


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--jobs', type=int, default=os.cpu_count())
    ap.add_argument('--only')
    ap.add_argument('--game', default='tbs', choices=('tbs', 'tla'))
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    objs = code_objects()
    stages = ['audit', 'll', 'bind', 'obj', 'link', 'leak']
    if game.C.game == 'tla':
        stages.insert(3, 'asm2c')
    if a.only:
        stages = a.only.split(',')
    if 'audit' in stages:  # vendor tests of code addresses by range/bits: every hit audited (GS14, trap 41)
        import code_range_audit
        if not code_range_audit.run():
            sys.exit(1)
    if 'll' in stages and not stage_src_ll(objs, a.jobs):
        sys.exit(1)
    failed = os.path.join(OUT, 'll_failed.tsv')
    if game.C.game != 'tbs' and os.path.exists(failed):
        skip = {r['object'] for r in read_tsv(failed)}
        objs = [(i, o) for i, o in objs if o not in skip]
        print(f'{len(skip)} objects left out (build/wasm-{game.C.game}/ll_failed.tsv): their functions are stubs')
    if 'bind' in stages:
        import bind
        if not bind.run(objs, OUT, ROOT):
            sys.exit(1)
    if 'asm2c' in stages and not stage_asm2c():
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
