#!/usr/bin/env python3
"""TLA4a: asm2c for The Lost Age's handwritten asm (games/tla/src/**/*.s), build-time only.

asm2c (tools/wasm/asm2c.py, D23) reads the vendor's disassembly listings; the handwritten .s are GAS source with
macros, which it does not read. This front end gives it the same input another way: for each hand-asm object with
code it writes a listing of the object's linked bytes (from the reference build's ELF, port_work/tla1/tla-en.elf,
whose image compare-tla-en proves equal to the cartridge), laid out at the object's run address (VMA: IWRAM code at
its IWRAM address), with the object's global labels, `.thumb`/`.arm` from the ELF mapping symbols ($t/$a), Thumb
code as `.2byte`, ARM code and data as `.4byte`. asm2c's decoders then translate it as they translate the listings'
raw halfwords and `.inst` words. Then the usual asm2c output is written (routines, dispatch, codemap, wrappers).

Everything this writes is ROM-derived and goes to the gitignored build tree only (D2/D18); our tree holds this
script and the names-only binding table (port/tla/hw/bindings.tsv).

Objects left out: veneers (bound by name, bindings.tsv), and the binds of bindings.tsv (BIOS SWI wrappers, the IRQ
entry, the code that generates or patches code at run time).
Usage: python3 port/tla/hw/tools/hw2c.py -o build/tla_hw/hw_test.c --report build/tla_hw/hw_test.report.tsv
       [--export '*'] [--only name,...] [--listings build/tla_hw/listings]
"""
import argparse
import bisect
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))
sys.path.insert(0, os.path.join(ROOT, 'tools/wasm'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import asm2c  # noqa: E402
import hand_census as hc  # noqa: E402


def bound_objects():
    """objects bindings.tsv binds instead of translating (kind bind or veneer)."""
    out = set()
    p = os.path.join(ROOT, 'port/tla/hw/bindings.tsv')
    if os.path.exists(p):
        for line in open(p):
            f = line.rstrip('\n').split('\t')
            if len(f) >= 4 and not line.startswith('#') and f[0] != 'symbol' and f[2] in ('bind', 'veneer', 'gs1'):
                out.add(f[3])
    return out


def write_listings(outdir, skip, extra_listing=True):
    ref = os.path.join(ROOT, 'port_work/tla1')
    objs = hc.load_map(os.path.join(ref, 'tla-en.map'))
    syms = hc.load_syms(os.path.join(ref, 'syms.txt'))
    addrs = [s[0] for s in syms]
    img = hc.Image(os.path.join(ref, 'tla-en.elf'))
    os.makedirs(outdir, exist_ok=True)
    for f in os.listdir(outdir):
        if f.endswith('.s'):
            os.remove(os.path.join(outdir, f))
    # code objects, then runs of adjacent ones merged into one listing (a routine may fall through into the next
    # object: asm2c treats that as a tail call only within one listing)
    sel = []
    for base, size, obj in objs:
        if re.search(r'far_call/|/import$|/entry$', obj) and obj != 'src/system/entry':
            continue
        if obj in skip:
            continue
        lo, hi = bisect.bisect_left(addrs, base), bisect.bisect_left(addrs, base + size)
        if not any(s[1] in ('$a', '$t') for s in syms[lo:hi]):
            continue
        sel.append([base, size, [obj]])
    # the main-image listing routines asm2c's listing front end leaves (docs/TLA3.md 2: build/a2c/report.tsv 'hand'):
    # their linked bytes, with the ELF's mapping symbols, give the analysis the pool words and data bounds it lacked
    rep = os.path.join(ROOT, 'build/a2c/report.tsv')
    if os.path.exists(rep) and extra_listing:
        for line in open(rep).read().split('\n')[1:]:
            f = line.split('\t')
            if len(f) > 4 and f[4] == 'hand' and not f[1] and f[2]:
                sel.append([int(f[2], 16), int(f[3]), ['listing/' + f[0]]])
    runs = []
    for b, n, o in sorted(sel):
        if runs and 0 <= b - (runs[-1][0] + runs[-1][1]) < 16:
            runs[-1][1] = b + n - runs[-1][0]
            runs[-1][2] += o
        else:
            runs.append([b, n, o])
    files = []
    for base, size, objs_in in runs:
        lo, hi = bisect.bisect_left(addrs, base), bisect.bisect_left(addrs, base + size)
        inside = syms[lo:hi]
        data = img.read(base, size)
        if data is None:
            continue
        marks = {}   # addr -> mode
        labels = {}  # addr -> [names]
        for a, n, t in inside:
            if n in ('$a', '$t', '$d'):
                marks[a] = {'$a': 'arm', '$t': 'thumb', '$d': 'data'}[n]
            elif not n.startswith(('$', '.')):
                labels.setdefault(a, []).append(n)
        if not labels:
            continue
        lines = [f'@ {" ".join(objs_in)}: linked bytes at the run address (port/tla/hw/tools/hw2c.py)']
        mode, a, end = 'data', base, base + size
        while a < end:
            if a in marks:
                mode = marks[a]
                lines.append('.thumb' if mode == 'thumb' else '.arm' if mode == 'arm' else '@ data')
            for n in labels.get(a, []):
                lines += [f'.global {n}', f'{n}:']
            nxt = min([k for k in list(marks) + list(labels) if k > a] + [end])
            while a < nxt:
                if mode == 'thumb' and a + 2 <= nxt:
                    lines.append(f'.2byte 0x{int.from_bytes(data[a - base:a - base + 2], "little"):04x}')
                    a += 2
                elif a % 4 == 0 and a + 4 <= nxt:
                    lines.append(f'.4byte 0x{int.from_bytes(data[a - base:a - base + 4], "little"):08x}')
                    a += 4
                else:
                    lines.append(f'.byte 0x{data[a - base]:02x}')
                    a += 1
        p = os.path.join(outdir, f'{base:08x}.s')
        open(p, 'w').write('\n'.join(lines) + '\n')
        files.append((p, ' '.join(objs_in)))
    return files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-o', '--out', required=True)
    ap.add_argument('--report')
    ap.add_argument('--export', default='')
    ap.add_argument('--only')
    ap.add_argument('--listings', default=os.path.join(ROOT, 'build/tla_hw/listings'))
    ap.add_argument('--all', action='store_true', help='translate bound objects too (tests)')
    args = ap.parse_args()
    files = write_listings(args.listings, set() if args.all else bound_objects())

    def load(self, only_files=None):
        for p, obj in files:
            try:
                self.listings.append(asm2c.Listing(p, '', self.syms))
            except asm2c.Unsupported as e:
                self.failed[os.path.basename(p)] = str(e)
    asm2c.Translator.load = load
    sys.argv = ['asm2c', '--vendor', os.path.join(ROOT, 'vendor/alchemy'), '--symbols', os.path.join(ROOT, 'port/symbols'),
                '--extra-symbols', os.path.join(ROOT, 'port_work/tla1/syms.txt'), '-o', args.out, '--export', args.export]
    if args.report:
        sys.argv += ['--report', args.report]
    if args.only:
        sys.argv += ['--only', args.only]
    asm2c.main()


if __name__ == '__main__':
    main()
