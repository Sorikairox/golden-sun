#!/usr/bin/env python3
"""Fit the stand-in objects (tools/ref/standin_cc1.sh) to the original layout and write replacements.

Two of alchemy's compilers (old_agbcc for the sound and flash libraries, GCC 2.95.2 for three ARM files) are
not built here yet, so those objects come from a stand-in compiler with different code and sizes. This script
recovers where every one of their sections and symbols sits in the original ROM, without their bytes:

1. Anchors: every exact section (built by alchemy's real tools) of 16+ bytes that follows a stand-in in its ROM
   bank is searched for in the player's ROM near its built address; its shift (original - built) is the best
   byte-equality match. Exact sections before the first stand-in of a bank keep shift 0.
2. Gaps: the members (stand-in sections, and small or unmatched exact ones) between two anchors.
3. Evidence: each Thumb BL or literal word inside an anchor that targets a symbol in a gap is decoded again at
   the same place in the ROM; that gives the symbol's original address (votes).
4. Layout: in each gap a member starts where evidence for its first symbol says, else right after the exact
   member before it; a stand-in ends where the next member starts (or the gap ends).
5. Writes, per stand-in object, assembly whose sections are zero fill of the original size with the global
   symbols at their original offsets, so a relink places every other object exactly as the original does.

Output (stdout): TSV symbol, object, built, orig, votes, how; '#' lines describe members and gaps.
Reads the ROM only to compare in memory; writes no ROM bytes (the stand-ins are zeros).
Usage: standin_fix.py MAP BUILT_GBA ROM_GBA SYMS(readelf name value type) OUT_DIR
"""
import bisect
import os
import re
import struct
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapparse  # noqa: E402

STANDIN = re.compile(r'/(sound/(audio|tables|driver)|gamepak/flash/(flash|sst|atmel|program_flash_sector)|'
                     r'window/glyph_arm|field/actor_update_arm|field/world_map_lines)\.o$')
ARM_OBJ = re.compile(r'glyph_arm|actor_update_arm|world_map_lines')
ROM, ROM_END = 0x08000000, 0x08800000
W = 256


def objkey(obj):
    return obj.split('/obj/')[-1] if '/obj/' in obj else obj.split('obj/', 1)[-1]


def match(built, orig, bstart, length, d):
    s = bstart + d
    if s < 0 or s + length > len(orig):
        return 0.0
    return sum(a == b for a, b in zip(built[bstart:bstart + length], orig[s:s + length])) / length


def is_pointer(w):
    return 0x02000000 <= w < 0x02040000 or 0x03000000 <= w < 0x03008000 or ROM <= w < ROM_END


def masked_shift(built, orig, bstart, length, prefer, radius=0x1000):
    """Best shift for built[bstart:+length] in orig, ignoring aligned words that are pointers in the build
    (they move with the layout). Ties go to the shift closest to `prefer`. Returns (shift, quality, compared)."""
    keep = []
    for i in range(bstart, bstart + length):
        if i % 4 == 0 or True:
            w0 = i & ~3
            (w,) = struct.unpack_from('<I', built, w0)
            if not (w0 >= bstart and w0 + 4 <= bstart + length and is_pointer(w)):
                keep.append(i)
    if len(keep) < 8:
        return None, 0.0, len(keep)
    best = []
    for d in range(-radius, radius + 1, 2):
        if bstart + d < 0 or bstart + length + d > len(orig):
            continue
        q = sum(built[i] == orig[i + d] for i in keep) / len(keep)
        best.append((q, -abs(d - prefer), d))
    q, _, d = max(best)
    return d, q, len(keep)


def bl_target(img, i):
    h1, h2 = struct.unpack_from('<HH', img, i)
    if (h1 & 0xF800) != 0xF000 or (h2 & 0xF800) != 0xF800:
        return None
    off = ((h1 & 0x7FF) << 12) | ((h2 & 0x7FF) << 1)
    if off & 0x400000:
        off -= 0x800000
    return ROM + i + 4 + off


def main():
    mp, bpath, opath, sympath, outdir = sys.argv[1:6]
    built, orig = open(bpath, 'rb').read(), open(opath, 'rb').read()
    secs, banks = mapparse.parse(mp, patterns=True)
    banks = sorted(set([ROM] + banks))

    def bank_of(a):
        return banks[bisect.bisect_right(banks, a) - 1]

    placed = [s for s in secs if s.size and ROM <= s.addr < ROM_END]
    # A stand-in's request that placed nothing (GCC 2.96 put const data in .text where old_agbcc wrote
    # .rodata) still marks where the original section sits: keep it as a zero-size member, unless that object
    # placed a section right there.
    near = {(objkey(s.obj), s.addr - k) for s in placed for k in range(0, 8)}
    ghosts = [s for s in secs if s.name.startswith('*(') and STANDIN.search(s.obj) and ROM <= s.addr < ROM_END
              and (objkey(s.obj), s.addr) not in near]
    members = sorted(placed + ghosts, key=lambda s: (s.addr, 1 if s.size else 0))

    symtype = {}
    for line in open(sympath):
        f = line.split()
        if len(f) == 3 and re.fullmatch(r'[0-9a-f]{8}', f[1]) and f[2] in ('FUNC', 'OBJECT', 'NOTYPE'):
            symtype.setdefault(f[0], (int(f[1], 16), f[2]))

    # 1. anchors
    first_standin = {}
    for s in members:
        if STANDIN.search(s.obj):
            first_standin.setdefault(bank_of(s.addr), s.addr)
    shift_of = {}
    last = {}
    for s in members:
        if STANDIN.search(s.obj) or not s.size:
            continue
        bk = bank_of(s.addr)
        if bk not in first_standin or s.addr < first_standin[bk]:
            shift_of[id(s)] = 0
            continue
        n = min(s.size, W)
        d, q, kept = masked_shift(built, orig, s.addr - ROM, n, last.get(bk, 0))
        if d is None or q < 0.9:
            if d is not None and s.size >= 16:
                print(f"# no anchor: 0x{s.addr:08x} {mapparse.short_obj(s.obj)} {s.name} best {q:.2f}")
            continue
        shift_of[id(s)] = last[bk] = d
    anchors = [s for s in members if id(s) in shift_of]
    a_starts = [s.addr for s in anchors]

    def shift_at(a, extra=()):
        k = bisect.bisect_right(a_starts, a) - 1
        if k >= 0 and anchors[k].addr <= a < anchors[k].addr + anchors[k].size:
            return shift_of[id(anchors[k])]
        for lo, hi, d in extra:
            if lo <= a < hi:
                return d
        return None

    # 2. gaps
    gaps, cur, prev_anchor = [], [], None
    for s in members:
        if id(s) in shift_of:
            if any(STANDIN.search(m.obj) for m in cur):
                gaps.append((prev_anchor, cur, s))
            cur, prev_anchor = [], s
        else:
            cur.append(s)
    if any(STANDIN.search(m.obj) for m in cur):
        gaps.append((prev_anchor, cur, None))

    # 3-4. evidence, then layout; a second round also reads evidence inside the gap members just placed whose
    #      size is known (exact objects and same-size stand-in data such as the sound tables)
    def solve(extra, verbose):
        # 3. evidence for every symbol in a gap
        targets_bl, targets_word = {}, {}
        for _, ms, _ in gaps:
            for m in ms:
                for a, n in m.symbols:
                    v = symtype.get(n, (a, 'NOTYPE'))[0]
                    targets_word[v] = n
                    if v & 1:
                        targets_bl[v & ~1] = n
        votes = defaultdict(Counter)
        for i in range(0, len(built) - 4, 2):
            a = ROM + i
            t = bl_target(built, i)
            if t in targets_bl:
                sh = shift_at(a, extra)
                if sh is not None:
                    ot = bl_target(orig, i + sh)
                    if ot is not None and abs(ot - t) <= 0x1000:
                        votes[targets_bl[t]][ot] += 1
            if i % 4 == 0:
                (w,) = struct.unpack_from('<I', built, i)
                if w in targets_word:
                    sh = shift_at(a, extra)
                    if sh is not None:
                        (ow,) = struct.unpack_from('<I', orig, i + sh)
                        if abs((ow & ~1) - (w & ~1)) <= 0x1000 and (ow & 1) == (w & 1):
                            votes[targets_word[w]][ow & ~1] += 1

        def evidence(n):
            v = votes.get(n)
            return v.most_common(1)[0][0] if v else None

        # 4. layout
        if verbose:
            print('symbol\tobject\tbuilt\torig\tvotes\thow')
        placed_members = {}
        for pa, ms, na in gaps:
            gstart = pa.addr + pa.size + shift_of[id(pa)] if pa else ms[0].addr
            gend = na.addr + shift_of[id(na)] if na else ms[-1].addr + ms[-1].size
            if na is None or bank_of(na.addr) != bank_of(ms[-1].addr):
                # last gap of a bank: it ends at the original's last non-zero byte before the bank's fill
                bend = banks[bisect.bisect_right(banks, ms[-1].addr)] if bisect.bisect_right(banks, ms[-1].addr) < len(banks) else ROM_END
                e = bend - ROM
                while e > gstart - ROM and orig[e - 1] == 0:
                    e -= 1
                gend = ROM + ((e + 3) & ~3)

            def first_ev(m):
                return evidence(m.symbols[0][1]) if m.symbols and m.symbols[0][0] == m.addr else None
            starts = [None] * len(ms)
            # forward: evidence, else right after an exact member, else (first member) the gap start
            for k, m in enumerate(ms):
                st = first_ev(m)
                if st is None:
                    if k == 0:
                        st = gstart
                    elif not STANDIN.search(ms[k - 1].obj) and starts[k - 1] is not None:
                        st = starts[k - 1] + (m.addr - ms[k - 1].addr)
                    if st is not None and STANDIN.search(m.obj) and m.size:
                        st = (st + 3) & ~3
                starts[k] = st
            # a ghost (.rodata the stand-in never emitted): the lowest pointer into this gap from the literal pools
            # of the same object's code in the original ROM
            for k, m in enumerate(ms):
                if starts[k] is None and m.name.startswith('*('):
                    code = [placed_members.get(id(x)) for x in members if objkey(x.obj) == objkey(m.obj) and x.size]
                    ptrs = []
                    for c in code:
                        if c and c[0] is not None and c[1]:
                            for i in range((c[0] - ROM + 3) & ~3, c[0] - ROM + c[1], 4):
                                (w,) = struct.unpack_from('<I', orig, i)
                                if gstart <= w < gend:
                                    ptrs.append(w)
                    if ptrs:
                        starts[k] = min(ptrs) & ~3
            # unplaced ghosts left at the start of a gap (no pointer, no evidence): the earlier ones get no bytes and
            # the last takes the rest, which moves nothing else (assumption, reported in docs/G1.md)
            for k in range(1, len(ms)):
                if (starts[k] is None and ms[k].name.startswith('*(') and ms[k - 1].name.startswith('*(')
                        and starts[k - 1] is not None):
                    starts[k] = starts[k - 1]
            # backward: an exact member just before a placed one
            if starts[-1] is None and na is not None and not STANDIN.search(ms[-1].obj):
                starts[-1] = gend - (na.addr - ms[-1].addr)
            for k in range(len(ms) - 2, -1, -1):
                if starts[k] is None and starts[k + 1] is not None and not STANDIN.search(ms[k].obj):
                    step = (ms[k + 1].addr - ms[k].addr) if not STANDIN.search(ms[k + 1].obj) else ms[k].size
                    starts[k] = starts[k + 1] - step
            if verbose:
                print(f"# gap 0x{gstart:08x}-0x{gend:08x}")
            for k, m in enumerate(ms):
                nxt = starts[k + 1] if k + 1 < len(ms) else gend
                if STANDIN.search(m.obj):
                    size = (nxt - starts[k]) if (starts[k] is not None and nxt is not None) else None
                else:
                    size = m.size
                placed_members[id(m)] = (starts[k], size)
                if verbose:
                    print(f"#   {mapparse.short_obj(m.obj)} {m.name} built 0x{m.addr:08x}+0x{m.size:x} -> "
                          + (f"0x{starts[k]:08x}+0x{size:x}" if starts[k] is not None and size is not None else 'unplaced')
                          + (' (stand-in)' if STANDIN.search(m.obj) else ''))
                for a, n in m.symbols:
                    e = evidence(n)
                    if e is not None:
                        oa, how = e, 'xref' if len(votes[n]) == 1 else 'xref-conflict:' + ','.join(
                            f'{x:#x}x{c}' for x, c in votes[n].items())
                    elif starts[k] is not None:
                        oa, how = starts[k] + (a - m.addr), ('offset' if STANDIN.search(m.obj) else 'exact')
                    else:
                        oa, how = 0, 'unknown'
                    if verbose:
                        print(f"{n}\t{mapparse.short_obj(m.obj)}\t0x{a:08x}\t0x{oa:08x}\t{sum(votes[n].values())}\t{how}")

        return votes, placed_members

    votes, placed_members = solve([], False)
    extra = sorted((placed_members[id(m)][0] - m.addr, m) for _, ms, _ in gaps for m in ms
                   if m.size and placed_members[id(m)][0] is not None and placed_members[id(m)][1] == m.size
                   and not (STANDIN.search(m.obj) and m.name.startswith('.text')))
    extra = [(m.addr, m.addr + m.size, d) for d, m in extra]
    votes, placed_members = solve(extra, True)

    def evidence(n):
        v = votes.get(n)
        return v.most_common(1)[0][0] if v else None

    # 5. replacement objects
    by_obj = defaultdict(list)
    for _, ms, _ in gaps:
        for m in ms:
            if STANDIN.search(m.obj):
                by_obj[objkey(m.obj)].append(m)
    os.makedirs(outdir, exist_ok=True)
    bad = 0
    for obj, ms in sorted(by_obj.items()):
        lines = ['@ Stand-in: zero fill of the original size, symbols at their original offsets.',
                 '@ Written by tools/ref/standin_fix.py; see docs/G1.md.', '.syntax unified']
        ok = True
        for m in ms:
            st, size = placed_members[id(m)]
            if st is None or size is None or size < 0:
                print(f"# cannot place {obj} {m.name}", file=sys.stderr)
                ok = False
                continue
            if size == 0:
                continue
            name = m.name if not m.name.startswith('*(') else '.rodata'
            arm = ARM_OBJ.search(obj)
            base = 'standin_' + re.sub(r'\W', '_', name)
            lines += [f'.section {name},"a{"x" if name.startswith(".text") else ""}",%progbits',
                      '.balign 4',
                      '.arm' if arm else '.thumb', f'{base}:']
            rows = []
            for a, n in m.symbols:
                e = evidence(n)
                off = (e - st) if e is not None else (a - m.addr)
                if not 0 <= off < size:
                    print(f"# {obj}: {n} offset {off:#x} outside 0x{size:x}; clamped", file=sys.stderr)
                    off = max(0, min(off, size - 2))
                rows.append((off, n))
            for off, n in sorted(rows):
                lines += [f'.org {base} + {off:#x}', f'.global {n}']
                t = symtype.get(n)
                if t and t[1] == 'FUNC':
                    lines += [f'.type {n}, %function'] + (['.thumb_func'] if t[0] & 1 else [])
                lines += [f'{n}:']
            lines += [f'.org {base} + {size:#x}']
        if not ok:
            bad += 1
            continue
        if all(placed_members[id(m)][1] == m.size for m in ms):
            print(f"# {obj}: every section has its original size; keeping the stand-in compile", file=sys.stderr)
            continue
        path = os.path.join(outdir, obj[:-2] + '.s')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, 'w').write('\n'.join(lines) + '\n')
    print(f"# stand-in objects written: {len(by_obj) - bad}, unplaced: {bad}", file=sys.stderr)


if __name__ == '__main__':
    main()
