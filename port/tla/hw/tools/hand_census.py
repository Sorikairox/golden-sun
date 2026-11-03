#!/usr/bin/env python3
"""TLA4a census of The Lost Age's handwritten asm (games/tla/src/**/*.s) and its GS1 twins.

Reads (never writes) the TLA reference build (port_work/tla1: tla-en.map, syms.txt, tla-en.elf), the GS1 address map
(port/symbols/tbs-en.tsv) and both ROMs, and writes a names-and-verdicts table into build/tla_hw/ (gitignored). No ROM
bytes are written anywhere: the table holds names, addresses, sizes and the comparison verdict only.

Per hand-asm object with code (an ARM `$a` or Thumb `$t` mapping symbol inside its .text):
  - kind: veneer (far_call/*, scene import.s / entry.s: one branch to another symbol) or code;
  - every global label in the object, its extent (to the next label of the object) and its GS1 twin by name:
      same      the bytes are identical;
      reloc     identical except 4-byte words that hold a GBA address in both (pool words of moved symbols) and
                Thumb BL pairs (moved callees);
      differ    other differences (first offset given);
      none      no GS1 symbol of that name (a byte search of the first 24 bytes in GS1's ROM is tried: found-at).
Usage: python3 port/tla/hw/tools/hand_census.py [-o build/tla_hw/census.tsv]
"""
import argparse
import bisect
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))
sys.path.insert(0, os.path.join(ROOT, 'tools/ref'))
import elf32  # noqa: E402

TLA_ROM = os.path.expanduser('~/roms/Golden_Sun_The_Lost_Age_USA_Europe.gba')
GS1_ROM = os.path.expanduser('~/roms/Golden_Sun_USA_Europe.gba')


def load_map(path):
    objs = []
    rx = re.compile(r'^ \.text\s+0x([0-9a-f]+)\s+0x([0-9a-f]+) out/tla-en/obj/games/tla/(src/\S+)\.o$')
    for line in open(path):
        m = rx.match(line)
        if m and int(m.group(2), 16):
            objs.append((int(m.group(1), 16), int(m.group(2), 16), m.group(3)))
    return objs


def load_syms(path):
    out = []
    for line in open(path):
        f = line.split()
        if len(f) >= 4 and re.fullmatch(r'[0-9a-f]{8}', f[1]):
            a = int(f[1], 16)
            # Thumb function values carry bit 0: keep the code address (mapping symbols are already even)
            out.append((a & ~1 if f[3] == 'FUNC' else a, f[0], f[3]))
    out.sort()
    return out


def load_gs1(path):
    d = {}
    for line in open(path):
        f = line.rstrip('\n').split('\t')
        if len(f) < 6 or not f[1].startswith('0x'):
            continue
        d.setdefault(f[0], (int(f[1], 16), int(f[2], 16) if f[2].startswith('0x') else int(f[1], 16),
                            int(f[3] or 0), f[4], f[6] if len(f) > 6 else ''))
    return d


class Image:
    def __init__(self, elf):
        self.e = elf32.Elf(elf)

    def read(self, addr, n):
        for s in self.e.sections:
            if s.type == 1 and s.addr <= addr and addr + n <= s.addr + s.size:
                o = s.offset + addr - s.addr
                return self.e.data[o:o + n]
        return None


def isaddr(w):
    return (w >> 24) in (2, 3, 4, 5, 6, 7, 8, 9) and w & 0xffffff < 0x1000000


def compare(a, b, thumb):
    """same / reloc / differ@offset over the common length."""
    n = min(len(a), len(b))
    if a[:n] == b[:n]:
        return 'same', n
    i = 0
    while i < n:
        if a[i] == b[i]:
            i += 1
            continue
        # a differing aligned word that is a GBA address in both
        k = i & ~3
        if k + 4 <= n:
            wa, wb = int.from_bytes(a[k:k + 4], 'little'), int.from_bytes(b[k:k + 4], 'little')
            if isaddr(wa & ~1) and isaddr(wb & ~1) and (wa & 1) == (wb & 1):
                i = k + 4
                continue
        # a Thumb BL pair (0xf000 prefix + 0xf800 suffix)
        if thumb:
            k = i & ~1
            for s in (k, k - 2):
                if 0 <= s and s + 4 <= n:
                    ha, hb = (int.from_bytes(x[s:s + 2], 'little') for x in (a, b))
                    la, lb = (int.from_bytes(x[s + 2:s + 4], 'little') for x in (a, b))
                    if ha >> 11 == hb >> 11 == 0x1e and la >> 11 == lb >> 11 == 0x1f:
                        i = s + 4
                        break
            else:
                return f'differ@{i:x}', n
            continue
        return f'differ@{i:x}', n
    return 'reloc', n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-o', '--out', default=os.path.join(ROOT, 'build/tla_hw/census.tsv'))
    args = ap.parse_args()
    ref = os.path.join(ROOT, 'port_work/tla1')
    objs = load_map(os.path.join(ref, 'tla-en.map'))
    syms = load_syms(os.path.join(ref, 'syms.txt'))
    addrs = [s[0] for s in syms]
    gs1 = load_gs1(os.path.join(ROOT, 'port/symbols/tbs-en.tsv'))
    img = Image(os.path.join(ref, 'tla-en.elf'))
    g1rom = open(GS1_ROM, 'rb').read()
    rows = []
    for base, size, obj in objs:
        lo, hi = bisect.bisect_left(addrs, base), bisect.bisect_left(addrs, base + size)
        inside = syms[lo:hi]
        maps = [s for s in inside if s[1] in ('$a', '$t')]
        if not maps:
            continue
        veneer = bool(re.search(r'far_call/|/import$|/entry$', obj)) and obj != 'src/system/entry'
        labels = [s for s in inside if not s[1].startswith(('$', '.L'))]
        # one row per distinct address (aliases joined)
        byaddr = {}
        for a, n, t in labels:
            byaddr.setdefault(a, []).append(n)
        pts = sorted(byaddr)
        for i, a in enumerate(pts):
            end = pts[i + 1] if i + 1 < len(pts) else base + size
            # mode from the last mapping symbol at or before a
            mode = '?'
            for s in inside:
                if s[0] > a:
                    break
                if s[1] in ('$a', '$t', '$d'):
                    mode = {'$a': 'arm', '$t': 'thumb', '$d': 'data'}[s[1]]
            names = byaddr[a]
            if veneer:
                rows.append((obj, 'veneer', ','.join(names), a, end - a, mode, '', '', ''))
                continue
            tb = img.read(a, end - a)
            twin, verdict, where = '', 'none', ''
            for n in names:
                if n in gs1 and gs1[n][3] in ('code', 'data', ''):
                    g = gs1[n]
                    gb = g1rom[g[1] - 0x08000000: g[1] - 0x08000000 + (end - a)]
                    v, _ = compare(tb, gb, mode == 'thumb') if tb else ('noimage', 0)
                    twin, verdict, where = n, v, f'{g[1]:08x}'
                    break
            if verdict == 'none' and tb and len(tb) >= 24:
                k = g1rom.find(tb[:24])
                if k >= 0:
                    verdict, where = 'bytes-found', f'{0x08000000 + k:08x}'
            rows.append((obj, 'code', ','.join(names), a, end - a, mode, twin, verdict, where))
    # object level: the object's whole code against GS1 at the twin of its first label (by name or by bytes)
    objrows = []
    for base, size, obj in objs:
        mine = [r for r in rows if r[0] == obj and r[1] == 'code']
        if not mine:
            continue
        tb = img.read(base, size)
        g = None
        for r in mine:
            if r[8] and r[7] != 'none':
                g = int(r[8], 16) - (r[3] - base)
                break
        if g is None:
            k = g1rom.find(tb[:16]) if tb and len(tb) >= 16 else -1
            g = 0x08000000 + k if k >= 0 else None
        if g is None:
            objrows.append((obj, base, size, '', 'none'))
            continue
        if g < 0x08000000:  # IWRAM twin: its ROM copy (tbs-en rom column) is what the GS1 ROM holds
            lma = [v[1] for v in gs1.values() if v[0] == g]
            g = lma[0] if lma else None
        if g is None:
            objrows.append((obj, base, size, '', 'nolma'))
            continue
        gb = g1rom[g - 0x08000000:g - 0x08000000 + size]
        thumb = any(r[5] == 'thumb' for r in mine)
        v, _ = compare(tb, gb, thumb)
        objrows.append((obj, base, size, f'{g:08x}', v))
    with open(os.path.join(os.path.dirname(args.out), 'objects.tsv'), 'w') as o:
        o.write('object\taddr\tbytes\tgs1_rom\tverdict\n')
        for r in objrows:
            o.write(f'{r[0]}\t{r[1]:08x}\t{r[2]}\t{r[3]}\t{r[4]}\n')
    from collections import Counter as C2
    print('objects:', len(objrows), dict(C2(r[4].split('@')[0] for r in objrows)))
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, 'w') as o:
        o.write('object\tkind\tnames\taddr\tbytes\tmode\tgs1_twin\tverdict\tgs1_addr\n')
        for r in rows:
            o.write('\t'.join([r[0], r[1], r[2], f'{r[3]:08x}', str(r[4]), r[5], r[6], r[7], r[8]]) + '\n')
    code = [r for r in rows if r[1] == 'code']
    from collections import Counter
    print(f'{len(rows)} labels: {len(rows) - len(code)} veneer, {len(code)} code;',
          dict(Counter(r[7].split('@')[0] for r in code)), '->', args.out)


if __name__ == '__main__':
    main()
