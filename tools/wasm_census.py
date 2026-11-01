#!/usr/bin/env python3
"""wasm compile census: how many of alchemy's tbs C files parse for wasm32 against our shim layer.

Runs host clang (Homebrew LLVM) with --target=wasm32 -fsyntax-only over the C files, with port/shim/prelude.h
forced first (it takes over the hardware-bound vendor headers) and port/shim before vendor's include dirs.
Prints the clean count and the most common first errors (message and file), compact.
  tools/wasm_census.py [--linked|--all] [--top N] [--show FILE]
--linked (default): the C objects alchemy links into tbs-en (main + overlays, from objects.mk)
--all: every .c under games/tbs/src (many are #included by others and do not stand alone)
Needs port_work/g1/gen/text/msg_ids.h (tools/build_ref.sh copies the generated header there).
"""
import argparse, collections, concurrent.futures as cf, glob, os, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
V = os.path.join(ROOT, 'vendor/alchemy')
CLANG = os.environ.get('CLANG', '/opt/homebrew/opt/llvm/bin/clang')
INC = ['include'] + ['include/' + d for d in 'battle field game gamepak graphics menu shop sound system window'.split()]
FLAGS = ['--target=wasm32', '-fsyntax-only', '-std=gnu89', '-ffreestanding', '-nostdinc', '-DMODERN=1',
         '-DTBS_EDITION_EN=1', '-DPORT_WASM=1', '-ferror-limit=1', '-w', '-Wno-error',
         '-include', os.path.join(ROOT, 'port/shim/prelude.h'), '-I' + os.path.join(ROOT, 'port/shim')] + \
        ['-I' + os.path.join(V, 'games/tbs', d) for d in INC] + ['-I' + os.path.join(ROOT, 'port_work/g1/gen')]


def files(mode):
    if mode == 'all':
        return sorted(glob.glob(os.path.join(V, 'games/tbs/src/**/*.c'), recursive=True))
    mk = open(os.path.join(ROOT, 'port_work/g1/alchemy/objects.mk')).read()
    out = []
    for o in re.findall(r'obj/(games/tbs/\S+)\.o', mk):
        p = os.path.join(V, o + '.c')
        if os.path.exists(p) and p not in out:
            out.append(p)
    return out


def check(path):
    r = subprocess.run([CLANG] + FLAGS + [path], cwd=V, capture_output=True, text=True)
    err = next((l for l in r.stderr.splitlines() if ': error: ' in l or ': fatal error: ' in l), '')
    return path, r.returncode == 0, err


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--top', type=int, default=15)
    ap.add_argument('--show')
    ap.add_argument('--compile', action='store_true', help='full compile to a wasm object (catches inline asm)')
    ap.add_argument('--strict', action='store_true', help='warnings on, as -Werror would see them (no -w)')
    a = ap.parse_args()
    if a.show:
        r = subprocess.run([CLANG] + [f for f in FLAGS if f != '-ferror-limit=1'] + ['-ferror-limit=20', a.show],
                           cwd=V, capture_output=True, text=True)
        print(r.stderr[-6000:])
        return
    if a.compile:
        FLAGS[FLAGS.index('-fsyntax-only')] = '-c'
        FLAGS.extend(['-O1', '-o', '/dev/null'])
    if a.strict:
        FLAGS.remove('-w')
    fs = files('all' if a.all else 'linked')
    with cf.ThreadPoolExecutor(os.cpu_count()) as ex:
        res = list(ex.map(check, fs))
    ok = sum(1 for _, k, _ in res if k)
    print(f"{'all' if a.all else 'linked'}{' compile' if a.compile else ''}{' strict' if a.strict else ''}: "
          f"{ok}/{len(res)} clean")
    msgs, where = collections.Counter(), collections.Counter()
    for p, k, e in res:
        if k:
            continue
        m = re.match(r'(.*?):\d+:\d+: (?:fatal )?error: (.*)', e)
        if m:
            loc = os.path.relpath(m.group(1), V) if m.group(1).startswith('/') else m.group(1)
            where[loc] += 1
            msgs[re.sub(r"'[^']*'", "'_'", m.group(2))[:90]] += 1
        else:
            msgs['(no error line)'] += 1
    print('first-error messages:')
    for m, n in msgs.most_common(a.top):
        print(f'  {n:4d}  {m}')
    print('first-error files:')
    for m, n in where.most_common(a.top):
        print(f'  {n:4d}  {m}')
    with open(os.path.join(ROOT, 'port_work/g1/census.txt'), 'w') as f:
        for p, k, e in res:
            f.write(f"{'OK' if k else 'FAIL'}\t{os.path.relpath(p, V)}\t{e}\n")


if __name__ == '__main__':
    main()
