#!/usr/bin/env python3
"""The tla-en address map and code census (phase TLA1) from alchemy's reference build (tools/build_ref_tla.sh).
Addresses, sizes and names only: no ROM bytes are read or written.

Inputs: BUILD_DIR (port_work/tla1: tla-en.map, tla-en.elf, overlays/resource_<id>.{map,elf}) and VENDOR (the
alchemy checkout the build came from: only file existence is checked, to tell a C object from an asm one).

Writes to OUT_DIR:
  tla-en.tsv           every named symbol of the main image: name address size type section object lang
  tla-en-overlays.tsv  every named symbol of the scene overlays (linked at 0x02008000): overlay + the same columns
  tla-en-census.tsv    bytes by place (main/overlays) and class (C code, asm code, data), the totals TLA_PLAN 1.2 uses
and prints the census and the biggest asm sections.

Classes, per linked input section of non-zero size:
  C code     .text of an object compiled from a .c file (games/tla/src/**.c), incl. ARM C and old_agbcc C
  asm code   a section of the vendor's disassembled listings holding a function symbol: recon/tla/raw/*.s (main)
             and the .text.x<addr> pieces of recon/tla/raw/overlays/resource_<id>_overlay.s; their literal pools and
             inline tables are counted with them (this is what is left to convert)
  hand asm   a section of a handwritten .s in games/tla/src holding a function symbol: far-call/import veneers,
             mixer, IWRAM kernels, BIOS calls (GS1 had ~75 such routines, ported by hand)
  libgcc     the eight libgcc members (compiler runtime)
  data       everything else (C .rodata/.data, assets, text, tables, bss excluded: only sections with ROM bytes)
The main image's packed overlay stream (system/overlay/overlays) is counted apart, not as data, since the
overlays' own sections are counted from their maps.
Usage: make_symbols_tla.py BUILD_DIR VENDOR OUT_DIR
"""
import glob
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import elf32  # noqa: E402
import mapparse  # noqa: E402

NOBITS = 8


def source_of(obj, vendor):
    """(path under the vendor, 'c'|'s'|'lib'|'gen') for a linked object path."""
    if 'libgcc.a' in obj:
        return obj, 'lib'
    m = re.search(r'overlays/(resource_[0-9a-f]+)_overlay\.o$', obj)
    if m:
        return f'recon/tla/raw/overlays/{m.group(1)}_overlay.s', 's'
    m = re.search(r'/obj/(.*)\.o$', obj)
    if not m:
        return obj, 'gen'
    base = m.group(1)
    for ext, lang in (('.c', 'c'), ('.s', 's')):
        if os.path.exists(os.path.join(vendor, base + ext)):
            return base + ext, lang
    return base, 'gen'


def short(obj):
    m = re.search(r'/obj/(.*)\.o$', obj)
    if m:
        return m.group(1).replace('games/tla/', '')
    m = re.search(r'overlays/(resource_[0-9a-f]+_overlay)\.o$', obj)
    return 'recon/tla/raw/overlays/' + m.group(1) if m else obj


def load(map_path, elf_path, vendor):
    """[(section, srcpath, lang, cls, [syms])] for one linked image; syms = [(addr, name, size, type)]."""
    secs, _ = mapparse.parse(map_path)
    e = elf32.Elf(elf_path)
    nobits = {(s.addr, s.size) for s in e.sections if s.type == NOBITS}
    bss_ranges = [(s.addr, s.addr + s.size) for s in e.sections if s.type == NOBITS and s.size]
    syms = sorted((s.value & ~1 if s.type == 'FUNC' else s.value, s.name, s.size, s.type) for s in e.symbols
                  if s.name and s.type in ('FUNC', 'OBJECT', 'NOTYPE') and s.shndx not in (0, 0xfff1)
                  and not s.name.startswith(('$', '.L')))
    import bisect
    keys = [s[0] for s in syms]
    out = []
    for s in secs:
        if s.size == 0 or s.name.startswith('.debug') or s.name in ('.comment', '.ARM.attributes'):
            continue
        if any(a <= s.addr < b for a, b in bss_ranges) or s.name.startswith(('.bss', 'COMMON', '.sbss')):
            continue
        src, lang = source_of(s.obj, vendor)
        lo, hi = bisect.bisect_left(keys, s.addr), bisect.bisect_left(keys, s.addr + s.size)
        inside = syms[lo:hi]
        has_func = any(t == 'FUNC' for _, _, _, t in inside)
        if lang == 'lib':
            cls = 'libgcc'
        elif lang == 'c' and s.name.startswith('.text'):
            cls = 'C' if s.size else 'data'
        elif has_func and lang in ('s', 'gen'):
            cls = 'asm' if src.startswith('recon/') else 'hand'
        elif has_func and lang == 'c':
            cls = 'C'
        else:
            cls = 'data'
        if 'system/overlay/overlays' in src:
            cls = 'stream'
        out.append((s, src, lang, cls, inside))
    del nobits
    return out


def main():
    bdir, vendor, odir = sys.argv[1:4]
    mp = os.path.join(bdir, 'tla-en.map') if os.path.exists(os.path.join(bdir, 'tla-en.map')) else None
    main_rows = load(mp, os.path.join(bdir, 'tla-en.elf'), vendor)
    ovs = []
    for m in sorted(glob.glob(os.path.join(bdir, 'overlays', 'resource_*.map'))):
        ov = re.search(r'resource_([0-9a-f]+)\.map$', m).group(1)
        ovs.append((ov, load(m, m[:-4] + '.elf', vendor)))

    hdr = ('# Golden Sun: The Lost Age (USA, Europe) tla-en %s, from alchemy %s built by tools/build_ref_tla.sh.\n'
           '# Addresses and names only (no ROM bytes). lang: c / s (asm) / lib / gen (generated asset) of the object.\n')
    pin = os.environ.get('ALCHEMY_PIN', '?')
    if os.environ.get('BUILD_NOTE'):
        hdr += '# ' + os.environ['BUILD_NOTE'].replace('%', '%%') + '\n'
    with open(os.path.join(odir, 'tla-en.tsv'), 'w') as f:
        f.write(hdr % ('main-image symbols', pin))
        f.write('name\taddress\tsize\ttype\tsection\tobject\tlang\n')
        for s, src, lang, cls, inside in main_rows:
            for a, n, z, t in inside:
                f.write(f'{n}\t{a:08x}\t{z}\t{t}\t{s.name}\t{short(s.obj)}\t{lang}\n')
    with open(os.path.join(odir, 'tla-en-overlays.tsv'), 'w') as f:
        f.write(hdr % ('scene-overlay symbols', pin))
        f.write('overlay\tname\taddress\tsize\ttype\tsection\tobject\tlang\n')
        for ov, rows in ovs:
            for s, src, lang, cls, inside in rows:
                for a, n, z, t in inside:
                    f.write(f'{ov}\t{n}\t{a:08x}\t{z}\t{t}\t{s.name}\t{short(s.obj)}\t{lang}\n')

    census = defaultdict(int)
    nfunc = defaultdict(int)
    asm_secs = []
    for place, rows in [('main', main_rows)] + [('overlays', r) for _, r in ovs]:
        for s, src, lang, cls, inside in rows:
            census[(place, cls)] += s.size
            nfunc[(place, cls)] += sum(1 for x in inside if x[3] == 'FUNC')
    for ov, rows in [('main', main_rows)] + ovs:
        for s, src, lang, cls, inside in rows:
            if cls == 'asm':
                asm_secs.append((s.size, ov, s.addr, src, sum(1 for x in inside if x[3] == 'FUNC'),
                                 next((n for a, n, z, t in inside if t == 'FUNC'), '')))
    classes = ['C', 'asm', 'hand', 'libgcc', 'data', 'stream']
    with open(os.path.join(odir, 'tla-en-census.tsv'), 'w') as f:
        f.write(f'# tla-en code census (TLA1), alchemy {pin}: bytes of linked sections by class (see make_symbols_tla.py)\n')
        if os.environ.get('BUILD_NOTE'):
            f.write('# ' + os.environ['BUILD_NOTE'] + '\n')
        f.write('place\tclass\tbytes\tfunctions\n')
        for place in ('main', 'overlays'):
            for c in classes:
                f.write(f'{place}\t{c}\t{census[(place, c)]}\t{nfunc[(place, c)]}\n')
    for place in ('main', 'overlays', 'all'):
        get = (lambda c: census[(place, c)]) if place != 'all' else (lambda c: census[('main', c)] + census[('overlays', c)])
        fn = (lambda c: nfunc[(place, c)]) if place != 'all' else (lambda c: nfunc[('main', c)] + nfunc[('overlays', c)])
        code = get('C') + get('asm') + get('hand') + get('libgcc')
        print(f'{place:8s} code {code:8d}: C {get("C"):8d} ({fn("C")} fn)  asm {get("asm"):8d} ({fn("asm")} fn)  '
              f'hand {get("hand"):6d} ({fn("hand")} fn)  libgcc {get("libgcc")}  | data {get("data"):9d}  '
              f'stream {get("stream"):7d} | C {100.0 * get("C") / max(code, 1):.1f}% asm {100.0 * get("asm") / max(code, 1):.1f}% '
              f'hand {100.0 * get("hand") / max(code, 1):.1f}%')
    print('biggest asm sections:')
    for z, ov, a, src, nf, first in sorted(asm_secs, reverse=True)[:25]:
        print(f'  {z:7d}  {ov:>5s} {a:08x}  {nf:3d} fn  {src}  {first}')
    by_dir = defaultdict(lambda: [0, 0])
    for z, ov, a, src, nf, first in asm_secs:
        k = 'overlay ' + ov if ov != 'main' else 'main ' + src
        by_dir[k][0] += z
        by_dir[k][1] += nf
    print('biggest asm by overlay / main file:')
    for k, (z, nf) in sorted(by_dir.items(), key=lambda kv: -kv[1][0])[:20]:
        print(f'  {z:7d}  {nf:3d} fn  {k}')


if __name__ == '__main__':
    main()
