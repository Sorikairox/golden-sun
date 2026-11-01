"""Minimal little-endian ELF32 reader: sections, symbols and REL relocations (enough for ARM objects)."""
import struct
from collections import namedtuple

Sec = namedtuple('Sec', 'index name type flags addr offset size link info entsize')
Sym = namedtuple('Sym', 'name value size type bind shndx')
Rel = namedtuple('Rel', 'offset type sym')

SHT_SYMTAB, SHT_REL = 2, 9
SHF_EXECINSTR = 4
STT = {0: 'NOTYPE', 1: 'OBJECT', 2: 'FUNC', 3: 'SECTION', 4: 'FILE', 13: 'FUNC'}  # 13: STT_ARM_TFUNC (GAS 2.10 Thumb)
R_ARM_ABS32 = 2


class Elf:
    def __init__(self, path):
        d = self.data = open(path, 'rb').read()
        if d[:4] != b'\x7fELF' or d[4] != 1 or d[5] != 1:
            raise ValueError(f'{path}: not ELF32 LE')
        shoff, = struct.unpack_from('<I', d, 0x20)
        shentsize, shnum, shstrndx = struct.unpack_from('<HHH', d, 0x2e)
        raw = [struct.unpack_from('<IIIIIIIIII', d, shoff + i * shentsize) for i in range(shnum)]
        strtab = raw[shstrndx]

        def cstr(off):
            return d[off:d.index(b'\0', off)].decode('latin-1')
        self.sections = [Sec(i, cstr(strtab[4] + r[0]), r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[9])
                         for i, r in enumerate(raw)]
        self.symbols = []
        for s in self.sections:
            if s.type == SHT_SYMTAB:
                names = self.sections[s.link]
                for k in range(s.size // 16):
                    n, v, z, info, other, shndx = struct.unpack_from('<IIIBBH', d, s.offset + k * 16)
                    self.symbols.append(Sym(cstr(names.offset + n), v, z, STT.get(info & 15, str(info & 15)),
                                            info >> 4, shndx))

    def relocs(self):
        """{target section index: [Rel]} for every REL section."""
        out = {}
        for s in self.sections:
            if s.type == SHT_REL:
                rows = []
                for k in range(s.size // 8):
                    off, info = struct.unpack_from('<II', self.data, s.offset + k * 8)
                    rows.append(Rel(off, info & 0xff, info >> 8))
                out[s.info] = rows
        return out
