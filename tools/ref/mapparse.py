"""Parse a GNU ld -Map file (alchemy's out/<edition>/<edition>.map) into input sections and their symbols.

Section(out_section, name, addr, size, obj, symbols=[(addr, name)]). Only what the linker placed is
returned; fill and assignments are skipped, except `. = ABSOLUTE(...)` bank starts, returned separately.
"""
import re
from collections import namedtuple

Section = namedtuple('Section', 'out name addr size obj symbols')
_SEC_FULL = re.compile(r'^ (\S+)\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)\s+(\S+)$')
_SEC_NAME = re.compile(r'^ (\S+)$')
_SEC_CONT = re.compile(r'^\s{2,}0x([0-9a-f]+)\s+0x([0-9a-f]+)\s+(\S+)$')
_SYM = re.compile(r'^\s{2,}0x([0-9a-f]+)\s{2,}([A-Za-z_.$][\w.$]*)$')
_OUT = re.compile(r'^(\S+)\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)')
_OUT_NAME = re.compile(r'^(\.?[A-Za-z_]\S*)$')
_ABS = re.compile(r'^\s+0x([0-9a-f]+)\s+\. = ABSOLUTE')
_PATTERN = re.compile(r'^ \*(/\S+\.o)\((.*)\)$')


_LOAD = re.compile(r'0x([0-9a-f]+)\s+0x([0-9a-f]+)\s+load address 0x([0-9a-f]+)')


def output_sections(path):
    """{name: (vma, size, lma)} for every output section; lma == vma unless the map says 'load address'."""
    outs, name = {}, None
    in_map = False
    for raw in open(path, encoding='utf-8', errors='replace'):
        line = raw.rstrip('\n')
        if line.startswith('Linker script and memory map'):
            in_map = True
            continue
        if not in_map:
            continue
        if line and not line[0].isspace():
            m = _OUT.match(line)
            if m:
                name = m.group(1)
                ml = _LOAD.search(line)
                vma, size = int(m.group(2), 16), int(m.group(3), 16)
                outs[name] = (vma, size, int(ml.group(3), 16) if ml else vma)
                name = None
            else:
                mn = _OUT_NAME.match(line)
                name = mn.group(1) if mn else None
            continue
        if name:
            ml = _LOAD.search(line)
            m = re.match(r'^\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)', line)
            if m:
                vma, size = int(m.group(1), 16), int(m.group(2), 16)
                outs[name] = (vma, size, int(ml.group(3), 16) if ml else vma)
            name = None
    return outs


def parse(path, patterns=False):
    """patterns=True also returns each `*/obj.o(.sections)` request as a zero-size Section named '*(...)'
    at the location counter (the end of the section before it): where that object's sections would go."""
    sections, banks = [], []
    last_end = 0
    out, pending, cur = None, None, None
    in_map = False
    for raw in open(path, encoding='utf-8', errors='replace'):
        line = raw.rstrip('\n')
        if line.startswith('Linker script and memory map'):
            in_map = True
            continue
        if not in_map:
            continue
        m = _ABS.match(line)
        if m:
            banks.append(int(m.group(1), 16))
            cur = None
            continue
        if line and not line[0].isspace():
            mo = _OUT.match(line) or _OUT_NAME.match(line)
            if mo:
                out = mo.group(1)
            cur = pending = None
            continue
        if line.startswith(' *') or line.startswith(' **'):
            mp = _PATTERN.match(line)
            if patterns and mp and last_end:
                sections.append(Section(out, '*(' + mp.group(2) + ')', last_end, 0, 'obj/games' + mp.group(1).split('/games', 1)[1], []))
            mf = re.match(r'^ \*fill\*\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)', line)
            if mf:
                last_end = int(mf.group(1), 16) + int(mf.group(2), 16)
            cur = None
            pending = None
            continue
        m = _SEC_FULL.match(line)
        if m and not line.startswith('  '):
            cur = Section(out, m.group(1), int(m.group(2), 16), int(m.group(3), 16), m.group(4), [])
            sections.append(cur)
            last_end = cur.addr + cur.size
            pending = None
            continue
        m = _SEC_NAME.match(line)
        if m and not line.startswith('  '):
            pending, cur = m.group(1), None
            continue
        if pending:
            m = _SEC_CONT.match(line)
            if m:
                cur = Section(out, pending, int(m.group(1), 16), int(m.group(2), 16), m.group(3), [])
                sections.append(cur)
                last_end = cur.addr + cur.size
                pending = None
                continue
        m = _SYM.match(line)
        if m and cur is not None:
            cur.symbols.append((int(m.group(1), 16), m.group(2)))
    return sections, banks


def short_obj(obj):
    """out/tbs-en/obj/games/tbs/src/x/y.o -> src/x/y ; libgcc.a(z.o) -> libgcc.a(z.o)"""
    m = re.search(r'/obj/games/[^/]+/(.*)\.o$', obj)
    return m.group(1) if m else obj
