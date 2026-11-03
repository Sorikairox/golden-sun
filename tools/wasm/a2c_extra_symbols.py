#!/usr/bin/env python3
"""Writes port/tla/symbols/tla-en-extra.tsv (TLA5): the symbols asm2c needs beyond tla-en.tsv and
tla-en-overlays.tsv, taken once from the TLA reference build (port_work/tla1: syms.txt and overlays/*.elf), so the
wasm build no longer reads port_work for them:
  - bss and linker-script (absolute) symbols (gInput, IwramResident_Rom, gIrqVector...);
  - function values with their Thumb bit (a pool word `.4byte Func` holds address|1, trap 58);
  - overlay bss symbols.
Exactly the difference asm2c.load_symbols sees with and without the reference build (rows: overlay ('' = main
image), name, address as asm2c uses it). Names and addresses only.
Usage: python3 tools/wasm/a2c_extra_symbols.py [--ref port_work/tla1/syms.txt] [-o port/tla/symbols/tla-en-extra.tsv]
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import asm2c  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--symbols', default='port/symbols')
    ap.add_argument('--ref', default='port_work/tla1/syms.txt')
    ap.add_argument('-o', '--out', default='port/tla/symbols/tla-en-extra.tsv')
    a = ap.parse_args()
    base_m, base_o = asm2c.load_symbols(a.symbols, None)
    full_m, full_o = asm2c.load_symbols(a.symbols, a.ref)
    rows = []
    for n, v in full_m.items():
        if base_m.get(n) != v:
            rows.append(('', n, v))
    for ov, d in full_o.items():
        b = base_o.get(ov, {})
        for n, v in d.items():
            # an overlay ELF also lists the main image's symbols (absolute): the main value answers the same
            if b.get(n) != v and not (full_m.get(n) == v and not n.startswith('.')):
                rows.append((ov, n, v))
    rows.sort(key=lambda r: (r[0], r[2], r[1]))
    with open(a.out, 'w') as f:
        f.write('# TLA symbols asm2c needs beyond tla-en.tsv / tla-en-overlays.tsv (bss, linker-script symbols, Thumb bit\n'
                '# of function values, overlay bss), from the tla-en reference build (alchemy f6c08e64, tools/build_ref_tla.sh).\n'
                '# Names and addresses only. Regenerate: python3 tools/wasm/a2c_extra_symbols.py\n'
                'overlay\tname\taddress\n')
        for ov, n, v in rows:
            f.write(f'{ov}\t{n}\t{v & 0xffffffff:08x}\n')
    print(f'{len(rows)} rows -> {a.out}')


if __name__ == '__main__':
    main()
