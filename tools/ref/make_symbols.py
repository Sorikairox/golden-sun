#!/usr/bin/env python3
"""Build the tbs-en address map (port/symbols/*.tsv) from alchemy's reference build. Addresses, sizes and
names only: no ROM bytes are written.

Inputs: BUILD_DIR = port_work/g1/alchemy (tbs-en.map, tbs-en.elf, tbs-en.gba, obj/, overlays/*.map,
standin_fit.tsv), the player's ROM (compared in memory: is each section byte-identical?), and vendor/alchemy
(the .s sources, to name each asset's kind from the file it includes).

Writes to OUT_DIR:
  tbs-en.tsv          every symbol of the main image: name address rom size kind section object check
  tbs-en-overlays.tsv every symbol of the 96 scene overlays (linked at 0x02008000): overlay name address size kind section object
  sections.tsv        every input section: address rom size section object kind code_ptrs check
  code_pointer_tables.tsv  data symbols holding code addresses (relocations to functions): overlay name address size code_ptrs other_ptrs
Prints the coverage summary (bytes of the ROM by kind).
Usage: make_symbols.py BUILD_DIR ROM OUT_DIR [VENDOR_ALCHEMY]
"""
import bisect
import glob
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import elf32  # noqa: E402
import mapparse  # noqa: E402

ROM, ROM_SIZE = 0x08000000, 0x800000
GRAPHICS = {'1bpp', '4bpp', '4bpp16x16', '4bpp16x32', '4bpp32x8', '4bpp32x16', '4bpp32x32', '4bpp64x64', '8bpp',
            '8bpp8x16', '8bpp16x16', '8bpp64x64', 'bitmap', 'bitmaps', 'font', 'glyphs', 'icon4', 'icons', 'icons4',
            'pictures', 'strips', 'sprites', 'spriteblocks', 'parts'}
MAPS = {'grid', 'tilemap', 'collision', 'blocks', 'delta0', 'delta1', 'delta2', 'plane'}
STANDIN = re.compile(r'/(sound/(audio|tables|driver)|gamepak/flash/(flash|sst|atmel|program_flash_sector)|'
                     r'window/glyph_arm|field/actor_update_arm|field/world_map_lines)\.o$')


def asset_kind(path):
    base = os.path.basename(path)
    if base.endswith('.inc') and 'messages' in base:
        return 'text'
    parts = base.split('.')[1:]
    forms = [p for p in parts if p not in ('lz', 'plz', 'mtf', 'd7', 'hlz')]
    form = forms[0] if forms else ('lz' if parts else '')
    if form in GRAPHICS:
        return 'graphics'
    if form == 'gbapal':
        return 'palette'
    if form in MAPS:
        return 'map'
    if form == 'script':
        return 'script'
    if form in ('table',):
        return 'table'
    if form in ('pcm8', 'bin', 'pcm4'):
        return 'sound'
    return 'data'


def scan_asm(src):
    """{label: kind} for labels in a .s file followed by an .incbin/.include of an asset."""
    kinds, label = {}, None
    try:
        lines = open(src, encoding='utf-8', errors='replace').read().splitlines()
    except OSError:
        return kinds
    for line in lines:
        line = line.split('@')[0].strip()
        m = re.match(r'^([A-Za-z_.$][\w.$]*):', line)
        if m:
            label = m.group(1)
            line = line[m.end():].strip()
        m = re.match(r'^\.(incbin|include)\s+"([^"]+)"', line)
        if m and label and not m.group(2).endswith(('.h', 'imports.inc', 'map.inc', 'veneer.s', 'flashset.s')):
            k = asset_kind(m.group(2))
            kinds.setdefault(label, []).append(k)
    order = ['graphics', 'map', 'sound', 'script', 'table', 'palette', 'text', 'data']
    return {lab: min(ks, key=order.index) for lab, ks in kinds.items()}


class ObjInfo:
    """Per object: section kinds (code/data), code pointers per data section offset."""
    cache = {}

    @classmethod
    def get(cls, path, func_names, is_c):
        if path not in cls.cache:
            cls.cache[path] = cls(path, func_names, is_c)
        return cls.cache[path]

    def __init__(self, path, func_names, is_c):
        self.ok = os.path.exists(path)
        self.code_secs, self.codeptrs, self.otherptrs = set(), defaultdict(list), defaultdict(list)
        if not self.ok:
            return
        e = elf32.Elf(path)
        names = {s.index: s.name for s in e.sections}
        mapping = defaultdict(set)
        for sym in e.symbols:
            if sym.name in ('$a', '$t') or sym.name.startswith(('$a.', '$t.')):
                mapping[sym.shndx].add('code')
            if sym.type == 'FUNC' and sym.shndx:
                mapping[sym.shndx].add('code')
        for s in e.sections:
            if is_c and s.flags & elf32.SHF_EXECINSTR:
                mapping[s.index].add('code')  # C .text: GCC 2.96 marks Thumb functions with no FUNC type
            if s.flags & elf32.SHF_EXECINSTR and ('code' in mapping[s.index]):
                self.code_secs.add(s.name)
        for target, rels in e.relocs().items():
            tname = names.get(target, '?')
            for r in rels:
                if r.type != elf32.R_ARM_ABS32 or r.sym >= len(e.symbols):
                    continue
                sym = e.symbols[r.sym]
                code = (sym.type == 'FUNC' or
                        (sym.type == 'SECTION' and sym.shndx < len(e.sections) and
                         e.sections[sym.shndx].flags & elf32.SHF_EXECINSTR and 'code' in mapping[sym.shndx]) or
                        (sym.shndx == 0 and sym.name in func_names))
                (self.codeptrs if code else self.otherptrs)[tname].append(r.offset)


def main():
    bdir, rom_path, outdir = sys.argv[1:4]
    vendor = sys.argv[4] if len(sys.argv) > 4 else os.path.join(os.path.dirname(__file__), '../../vendor/alchemy')
    built = open(os.path.join(bdir, 'tbs-en.gba'), 'rb').read()
    rom = open(rom_path, 'rb').read()
    outs = mapparse.output_sections(os.path.join(bdir, 'tbs-en.map'))
    secs, _ = mapparse.parse(os.path.join(bdir, 'tbs-en.map'))
    final = elf32.Elf(os.path.join(bdir, 'tbs-en.elf'))
    func_names = {s.name for s in final.symbols if s.type == 'FUNC'}
    func_addr = {s.value & ~1 for s in final.symbols if s.type == 'FUNC'}
    fit = {}
    fp = os.path.join(bdir, 'standin_fit.tsv')
    if os.path.exists(fp):
        for line in open(fp):
            f = line.rstrip('\n').split('\t')
            if len(f) == 6 and not line.startswith('#') and f[0] != 'symbol':
                fit[f[0]] = f[5].split(':')[0]
    asm_kinds = {}

    def objpath(obj):
        m = re.search(r'obj/(.*)$', obj)
        return os.path.join(bdir, 'obj', m.group(1)) if m else None

    def source_of(obj):
        m = re.search(r'obj/(games/.*)\.o$', obj)
        if not m:
            return None, None
        for ext in ('.c', '.s', '.S', '.mid'):
            p = os.path.join(vendor, m.group(1) + ext)
            if os.path.exists(p):
                return p, ext
        return None, None

    def lma(s):
        o = outs.get(s.out)
        if not o or o[2] == o[0]:
            return s.addr if ROM <= s.addr < ROM + ROM_SIZE else None
        if o[2] >= ROM and s.out not in ('iwram', 'iwram_high', '.bss', 'ewram'):
            return o[2] + (s.addr - o[0])
        return None

    def section_kind(s, info, ext):
        if s.out in ('ewram', 'iwram', 'iwram_high', '.bss') or s.name.startswith('.bss') or s.name.startswith('.sym_'):
            return 'ram'
        if s.name == '.overlays':
            return 'overlay-stream'
        if ext == '.mid':
            return 'sound'
        if ext == '.c':
            return 'code' if s.name.startswith('.text') else 'data'
        if info and s.name in info.code_secs:
            return 'code'
        if s.obj.startswith('tools/') or 'libgcc' in s.obj:
            return 'code'
        return 'data'

    sec_rows, sym_rows, cpt_rows = [], [], []
    by_kind = Counter()
    sec_index = []  # (addr, end, section, kind, rom_addr, check, src)

    def process(sections, overlay, rom_check):
        for s in sections:
            if not s.size:
                continue
            src, ext = source_of(s.obj)
            info = ObjInfo.get(objpath(s.obj), func_names, ext == '.c') if objpath(s.obj) else None
            kind = section_kind(s, info, ext)
            r = lma(s) if overlay is None else None
            check = ''
            if r is not None and rom_check:
                same = built[r - ROM:r - ROM + s.size] == rom[r - ROM:r - ROM + s.size]
                check = 'standin' if STANDIN.search(s.obj) else ('rom' if same else 'DIFF')
                by_kind[kind] += s.size
            cps = len(info.codeptrs.get(s.name, [])) if info else 0
            sec_rows.append((overlay or '', s.addr, r, s.size, s.name, mapparse.short_obj(s.obj), kind, cps, check))
            if src and ext in ('.s', '.S') and src not in asm_kinds:
                asm_kinds[src] = scan_asm(src)
            sec_index.append((s, kind, r, check, src, info, overlay))

    process(secs, None, True)
    for mp in sorted(glob.glob(os.path.join(bdir, 'overlays', 'resource_*.map'))):
        ov = re.search(r'resource_([0-9a-f]+)\.map$', mp).group(1)
        osecs, _ = mapparse.parse(mp)
        process([s for s in osecs if 'obj/' in s.obj], ov, False)

    # symbols: from the maps (global) and the objects' symbol tables (local), placed by section
    for s, kind, r, check, src, info, overlay in sec_index:
        syms = {}
        for a, n in s.symbols:
            if not n.startswith('standin_'):
                syms[n] = a
        op = objpath(s.obj)
        if op and os.path.exists(op):
            e = elf32.Elf(op)
            idx = {x.index: x.name for x in e.sections}
            # an object's section may be split by name in the map (.text.foo); match by name
            for sym in e.symbols:
                if sym.shndx and idx.get(sym.shndx) == s.name and sym.type in ('FUNC', 'OBJECT', 'NOTYPE') \
                        and sym.name and not sym.name.startswith(('$', '.L', 'standin_')) and sym.name not in syms:
                    syms[sym.name] = s.addr + (sym.value & ~1 if sym.type == 'FUNC' else sym.value)
        ordered = sorted(syms.items(), key=lambda x: x[1])
        sizes = {}
        if op and os.path.exists(op):
            for sym in elf32.Elf(op).symbols:
                if sym.size:
                    sizes[sym.name] = sym.size
        for k, (n, a) in enumerate(ordered):
            nxt = ordered[k + 1][1] if k + 1 < len(ordered) else s.addr + s.size
            size = sizes.get(n) or (nxt - a)
            skind = kind
            if kind == 'data' and src and src in asm_kinds and n in asm_kinds[src]:
                skind = asm_kinds[src][n]
            elif kind == 'data' and '/text/' in s.obj:
                skind = 'text'
            elif kind == 'data' and '/src/map/' in s.obj:
                skind = 'map'
            if kind == 'code' and (a & ~1) not in func_addr and n not in func_names and overlay is None:
                skind = 'code'  # labels inside code (jump tables, literal pools) stay code
            sym_check = check
            if check == 'standin':
                sym_check = 'standin-' + fit.get(n, 'offset')
            ra = (r + (a - s.addr)) if r is not None else None
            ptrs = [o for o in (info.codeptrs.get(s.name, []) if info else []) if a - s.addr <= o < a - s.addr + size]
            optrs = [o for o in (info.otherptrs.get(s.name, []) if info else []) if a - s.addr <= o < a - s.addr + size]
            if ptrs and kind != 'code':
                skind = 'codeptr-table'
                cpt_rows.append((overlay or '', n, a, size, len(ptrs), len(optrs)))
            sym_rows.append((overlay, n, a, ra, size, skind, s.name, mapparse.short_obj(s.obj), sym_check))

    os.makedirs(outdir, exist_ok=True)
    hx = lambda v: f'0x{v:08x}' if v is not None else ''  # noqa: E731
    head = ('# Golden Sun (USA, Europe) tbs-en address map, from alchemy 24b72a32 built by tools/build_ref.sh.\n'
            '# Addresses and names only (no ROM bytes). check: rom = section byte-identical to the player\'s ROM;\n'
            '# standin-xref / standin-offset = object built by a stand-in compiler, address from cross-references\n'
            '# / from its offset (see docs/G1.md).\n')
    with open(os.path.join(outdir, 'tbs-en.tsv'), 'w') as f:
        f.write(head + 'name\taddress\trom\tsize\tkind\tsection\tobject\tcheck\n')
        for ov, n, a, ra, z, k, sec, obj, chk in sorted((r for r in sym_rows if r[0] is None), key=lambda r: (r[2], r[1])):
            f.write(f'{n}\t{hx(a)}\t{hx(ra)}\t{z}\t{k}\t{sec}\t{obj}\t{chk}\n')
    with open(os.path.join(outdir, 'tbs-en-overlays.tsv'), 'w') as f:
        f.write(head.replace('address map', 'overlay symbols') + 'overlay\tname\taddress\tsize\tkind\tsection\tobject\n')
        for ov, n, a, ra, z, k, sec, obj, chk in sorted((r for r in sym_rows if r[0] is not None), key=lambda r: (r[0], r[2], r[1])):
            f.write(f'{ov}\t{n}\t{hx(a)}\t{z}\t{k}\t{sec}\t{obj}\n')
    with open(os.path.join(outdir, 'sections.tsv'), 'w') as f:
        f.write(head + 'overlay\taddress\trom\tsize\tsection\tobject\tkind\tcode_ptrs\tcheck\n')
        for ov, a, r, z, sec, obj, k, cps, chk in sorted(sec_rows, key=lambda x: (x[0], x[1])):
            f.write(f'{ov}\t{hx(a)}\t{hx(r)}\t{z}\t{sec}\t{obj}\t{k}\t{cps}\t{chk}\n')
    with open(os.path.join(outdir, 'code_pointer_tables.tsv'), 'w') as f:
        f.write(head + '# Data symbols holding code addresses (ABS32 relocations to functions): compiled from C, not read\n'
                '# from the ROM (orchestrator D4).\noverlay\tname\taddress\tsize\tcode_ptrs\tother_ptrs\n')
        for ov, n, a, z, c, o in sorted(cpt_rows, key=lambda x: (x[0], x[2])):
            f.write(f'{ov}\t{n}\t{hx(a)}\t{z}\t{c}\t{o}\n')

    objs = {}
    for ov, a, r, z, sec, obj, k, cps, chk in sec_rows:
        o = objs.setdefault((ov or 'main', obj), Counter())
        o[k] += z
        o['codeptr'] += cps
    with open(os.path.join(outdir, 'objects.tsv'), 'w') as f:
        f.write(head + '# class: code = only code; data = no code (assets/tables: bound to ROM addresses, never compiled);\n'
                '# mixed = code plus data sections (compile the code, bind the data symbols to the ROM).\n'
                'image\tobject\tclass\tcode_bytes\tdata_bytes\tram_bytes\tcode_ptrs\n')
        classes = Counter()
        for (img, obj), c in sorted(objs.items()):
            code = c['code']
            data = sum(v for k, v in c.items() if k not in ('code', 'ram', 'codeptr'))
            cls = 'code' if code and not data else ('data' if not code else 'mixed')
            if not code and not data:
                cls = 'ram'
            classes[(img == 'main', cls)] += 1
            f.write(f"{img}\t{obj}\t{cls}\t{code}\t{data}\t{c['ram']}\t{c['codeptr']}\n")
    print('  objects: ' + ', '.join(f"{'main' if m else 'overlay'} {c} {n}" for (m, c), n in sorted(classes.items())))

    # coverage
    rom_secs = [x for x in sec_rows if x[2] is not None and not x[0]]
    mapped = sum(x[3] for x in rom_secs)
    last = max(x[2] + x[3] for x in rom_secs)
    pad = ROM_SIZE - (last - ROM)
    sym_kinds = Counter()
    for ov, n, a, ra, z, k, sec, obj, chk in sym_rows:
        if ov is None and ra is not None:
            sym_kinds[k] += z
    print(f"ROM {ROM_SIZE} bytes: sections {mapped} ({100 * mapped / ROM_SIZE:.2f}%), trailing pad {pad}, "
          f"gaps/fill {ROM_SIZE - mapped - pad}")
    for k, v in by_kind.most_common():
        print(f"  section kind {k:15s} {v:9d} bytes {100 * v / ROM_SIZE:6.2f}%")
    for k, v in sym_kinds.most_common():
        print(f"  symbol kind  {k:15s} {v:9d} bytes")
    chk = Counter(x[8] for x in rom_secs)
    print(f"  section checks: {dict(chk)}")
    print(f"  symbols: main {sum(1 for r in sym_rows if r[0] is None)}, overlays {sum(1 for r in sym_rows if r[0] is not None)}; "
          f"code-pointer tables {len(cpt_rows)} ({sum(1 for r in cpt_rows if not r[0])} main)")


if __name__ == '__main__':
    main()
