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
    out, keep = set(), set()
    p = os.path.join(ROOT, 'port/tla/hw/bindings.tsv')
    if os.path.exists(p):
        for line in open(p):
            f = line.rstrip('\n').split('\t')
            if len(f) >= 4 and not line.startswith('#') and f[0] != 'symbol':
                if f[2] in ('bind', 'veneer', 'gs1'):
                    out.add(f[3])
                elif f[2] in ('a2c', 'left'):
                    keep.add(f[3])
    # an object with a translated routine stays (heap_release: Heap_Release a2c, its swi 3 tail bound: TLA4a2)
    return out - keep


INTERNAL = set()  # local labels left out as routine starts (make_bindings.py: kind data)
# TLA4c: bound objects whose bytes stay in the listing as data (no labels, no code): a neighbour reads their pool
# (SoundDriver_VSyncRefresh loads 0x03007ff0 from SoundDriver_EnterVBlankUpdate's pool, now bound to C)
DATA_ONLY = {'src/sound/driver/enter_vblank_update'}


def entries_in(data, base, marks):
    """addresses a run enters by itself: bl targets (Thumb pairs, ARM bl) and aligned words (pool entries)."""
    out, mode = set(), 'data'
    for a in range(base, base + len(data) - 1, 2):
        if a in marks:
            mode = marks[a]
        o = a - base
        h = int.from_bytes(data[o:o + 2], 'little')
        if a % 4 == 0 and o + 4 <= len(data):
            w = int.from_bytes(data[o:o + 4], 'little')
            out.add(w & ~1)
            if mode == 'arm' and (w & 0x0f000000) == 0x0b000000:
                off = (w & 0xffffff) - (1 << 24 if w & 0x800000 else 0)
                out.add(a + 8 + 4 * off)
        if mode == 'thumb' and (h & 0xf800) == 0xf000 and o + 4 <= len(data):
            h2 = int.from_bytes(data[o + 2:o + 4], 'little')
            if (h2 & 0xf800) == 0xf800:
                off = ((h & 0x7ff) << 12) | ((h2 & 0x7ff) << 1)
                out.add(a + 4 + off - (1 << 23 if off & 0x400000 else 0))
    return out


def branch_only_labels(names):
    """names whose every use in the vendor's TLA tree (outside their definition) is a b/bcc operand."""
    ident = re.compile(r'[A-Za-z_]\w*')
    br = re.compile(r'^\s*b(?:eq|ne|cs|cc|hs|lo|mi|pl|vs|vc|hi|ls|ge|lt|gt|le|al)?\s+([A-Za-z_]\w*)\s*(?:@.*)?$')
    decl = re.compile(r'^\s*(?:\.(?:global|globl|thumb_func|type|size)\b.*|([A-Za-z_]\w*):.*)$')
    used, other = set(), set()
    for dp, _, fs in os.walk(os.path.join(ROOT, 'vendor/alchemy/games/tla')):
        if '/.git' in dp:
            continue
        for fn in fs:
            if not fn.endswith(('.s', '.c', '.h', '.inc', '.ld', '.txt', '.sym')):
                continue
            for line in open(os.path.join(dp, fn), errors='replace'):
                hit = [t for t in ident.findall(line) if t in names]
                if not hit:
                    continue
                m = br.match(line)
                for t in hit:
                    if m and m.group(1) == t:
                        used.add(t)
                    elif decl.match(line) and (line.strip().startswith('.') or line.strip().startswith(t + ':')):
                        pass
                    else:
                        other.add(t)
    return used - other


def write_listings(outdir, skip, extra_listing=True):
    ref = os.path.join(ROOT, 'port_work/tla1')
    objs = hc.load_map(os.path.join(ref, 'tla-en.map'))
    syms = hc.load_syms(os.path.join(ref, 'syms.txt'))
    addrs = [s[0] for s in syms]
    img = hc.Image(os.path.join(ref, 'tla-en.elf'))
    # labels the source does not declare .global (STB_LOCAL in the ELF: AlchemyUncredited*, the vendor's names for
    # unlabelled spots): no other object can enter them. As routine starts they would split a routine where its own
    # flow continues (a computed `add pc, pc, ip, lsl #3` into an unrolled loop, a `beq` past the label: TLA4a2), so
    # they are left out unless something in the run enters them (a bl, or a pool word holding the address)
    local = {(s.value & ~1, s.name) for s in img.e.symbols if s.bind == 0}
    glob = {(s.value & ~1, s.name) for s in img.e.symbols if s.bind != 0}
    local -= glob
    # global labels the vendor tree only ever branches to (b/bcc, never bl, a pool word or C): a loop head that the
    # decomp's file split made global (Resource_DecodeType2Loop is entered from decode_2.s by `b` and branches back
    # into it). As routine starts they would cut the loop, so they are treated like local labels
    bonly = branch_only_labels({n for _, n in glob})
    local |= {(a, n) for a, n in glob if n in bonly}
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
        if obj in skip and obj not in DATA_ONLY:
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
        dranges = [(b, b + n) for b, n, o in sel if o[0] in DATA_ONLY and base <= b < base + size] \
            if any(o in DATA_ONLY for o in objs_in) else []
        indata = lambda a: any(lo <= a < hi for lo, hi in dranges)
        for a, n, t in inside:
            if indata(a):
                if n in ('$a', '$t', '$d'):
                    marks[a] = 'data'
                continue
            if n in ('$a', '$t', '$d'):
                marks[a] = {'$a': 'arm', '$t': 'thumb', '$d': 'data'}[n]
            elif not n.startswith(('$', '.')):
                labels.setdefault(a, []).append(n)
        entered = entries_in(data, base, marks)
        for a in list(labels):
            keep = [n for n in labels[a] if (a, n) not in local or a in entered or a == base]
            INTERNAL.update(n for n in labels[a] if n not in keep)
            if keep:
                labels[a] = keep
            else:
                del labels[a]
        # code at the start of a run with no label (iwram_divide.s's shared signed-division body at 0x030004a8,
        # entered by `bmi` from IwramSignedDivide/IwramSignedRemainder): a routine of its own, or the branches into
        # it go to Port_ResolveCode (TLA4b, trap 66). Named by address; no symbol, so only asm2c's codemap has it
        if marks.get(base) in ('arm', 'thumb') and base not in labels:
            labels[base] = [f'HwCode_{base:08x}']
        for lo, hi in dranges:  # a data-only object ends the routine before it (asm2c: HwData_ is no routine)
            labels[lo] = [f'HwData_{lo:08x}']
        # TLA4c: an unlabelled Thumb `bx pc` stub at a $t mark is the Thumb entry of an ARM function (iwram_math.s's
        # 0x03000314, which C calls by that constant as Iwram_ExpandBitRuns): its own routine, named by address
        for a, md in marks.items():
            o = a - base
            if md == 'thumb' and a not in labels and 0 <= o and o + 2 <= len(data) and \
                    int.from_bytes(data[o:o + 2], 'little') == 0x4778:
                labels[a] = [f'HwCode_{a:08x}']
                print(f'hw2c: unlabelled bx-pc stub {a:08x} in {objs_in[0]} gets an entry', file=sys.stderr)
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
    # names-only list for make_bindings.py (kind data: not an entry, part of the routine before it)
    os.makedirs(os.path.join(ROOT, 'build/tla_hw'), exist_ok=True)
    open(os.path.join(ROOT, 'build/tla_hw/internal_labels.txt'), 'w').write(''.join(f'{n}\n' for n in sorted(INTERNAL)))
    return files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-o', '--out', required=True)
    ap.add_argument('--report')
    ap.add_argument('--export', default='')
    ap.add_argument('--only')
    ap.add_argument('--listings', default=os.path.join(ROOT, 'build/tla_hw/listings'))
    ap.add_argument('--all', action='store_true', help='translate bound objects too (tests)')
    ap.add_argument('--with-listings', action='store_true',
                    help='the build (TLA4b, hook H3): translate the vendor listings too, so one output holds both: '
                         'one a2c_dispatch, one codemap, one names.tsv')
    ap.add_argument('--names')
    args = ap.parse_args()
    files = write_listings(args.listings, set() if args.all else bound_objects())
    listing_load = asm2c.Translator.load

    def load(self, only_files=None):
        # the byte listings first: where one covers a listing routine asm2c's listing front end cannot take
        # (build/a2c/report.tsv 'hand'), its translation is the one kept (asm2c translates an address once)
        for p, obj in files:
            try:
                self.listings.append(asm2c.Listing(p, '', self.syms))
            except asm2c.Unsupported as e:
                self.failed[os.path.basename(p)] = str(e)
        if args.with_listings:
            listing_load(self)
    asm2c.Translator.load = load
    sys.argv = ['asm2c', '--vendor', os.path.join(ROOT, 'vendor/alchemy'), '--symbols', os.path.join(ROOT, 'port/symbols'),
                '--extra-symbols', os.path.join(ROOT, 'port_work/tla1/syms.txt'), '-o', args.out, '--export', args.export]
    if args.report:
        sys.argv += ['--report', args.report]
    if args.names:
        sys.argv += ['--names', args.names]
    if args.only:
        sys.argv += ['--only', args.only]
    asm2c.main()


if __name__ == '__main__':
    main()
