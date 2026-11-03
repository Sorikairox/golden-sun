#!/usr/bin/env python3
"""asm2c: the vendor's disassembled TLA listings -> C, at build time (TLA3, orchestrator D23).

Reads `recon/tla/raw/*.s` (main image) and `recon/tla/raw/overlays/resource_<id>_overlay.s` (scene overlays, the
English branch of the edition `.ifdef`s) from the vendor checkout and writes C into the build tree. Nothing it
writes is committed (it is derived from vendor and ROM code, D2/D18).

Model: every routine is a C function `void a2c_<addr>(void)` (overlays: `a2c_ov<id>_<addr>`) on a register file
`a2c_r` (r0-r15 plus NZCV). On entry it loads the file into locals; on return it stores them back, so any calling
convention the asm uses survives (AAPCS r0-r3 / stack arguments, r0:r1 results, non-AAPCS helpers). Memory is the
identity map (D5); the GBA stack is real memory at `sp`, as on hardware. The C compiler keeps the locals in wasm
locals and drops flags nobody reads, so NZCV costs only where it is used.

- Thumb: the listing's unified syntax is parsed; halfwords the disassembler left as `.2byte`/`.4byte` are decoded
  when control flow reaches them (`mov lr, rX; .2byte 0xf800` is the call-via-lr indirect call).
- ARM: `.inst` words and words reached after `bx pc` are decoded (conditions, barrel shifter with carry, LDM/STM,
  halfword/signed transfers, long multiplies).
- Calls: `bl` to a translated routine is a direct C call; anything else goes through `a2c_call(addr)` (the build's
  Port_ResolveCode bridge; the D20 test harness runs it in the interpreter). Indirect calls and jumps go through
  `a2c_dispatch(addr)`, a generated switch over every translated routine (overlay-aware), then `a2c_call`.
- Returns: `pop {pc}`, `bx rN`, `ldm .., {pc}` return when the target is the entry lr (any number of returns);
  otherwise the jump is a tail call through `a2c_dispatch`. `bl` to a label inside the routine is the far jump.
- Jump tables: `mov pc, rX` becomes a switch over the routine's labels found in its `.4byte` tables.
- Literal pools: `ldr rX, .L_pool` reads the pool word; symbols become `A2C_SYM(name, gba_address)`.
- Codemap: `a2c_codemap[]` lists {GBA address | thumb bit, overlay, function} for Port_ResolveCode.

Usage: asm2c.py --vendor vendor/alchemy --symbols port/symbols -o build/a2c/tla_asm.c
           [--only NAME,...] [--export NAME,...] [--report build/a2c/report.tsv]
"""
import argparse
import os
import re
import sys

COND = ['eq', 'ne', 'cs', 'cc', 'mi', 'pl', 'vs', 'vc', 'hi', 'ls', 'ge', 'lt', 'gt', 'le', 'al']
CONDC = {'eq': 'z', 'ne': '!z', 'cs': 'c', 'hs': 'c', 'cc': '!c', 'lo': '!c', 'mi': 'n', 'pl': '!n', 'vs': 'v',
         'vc': '!v', 'hi': '(c&&!z)', 'ls': '(!c||z)', 'ge': '(n==v)', 'lt': '(n!=v)', 'gt': '(!z&&n==v)',
         'le': '(z||n!=v)', 'al': '1'}
REGS = {**{f'r{i}': f'r{i}' for i in range(13)}, 'sp': 'sp', 'r13': 'sp', 'lr': 'lr', 'r14': 'lr', 'pc': 'pc',
        'r15': 'pc', 'ip': 'r12', 'fp': 'r11', 'sl': 'r10', 'sb': 'r9'}
RNAMES = [f'r{i}' for i in range(13)] + ['sp', 'lr', 'pc']


class Unsupported(Exception):
    pass


# ----------------------------------------------------------------------------------------------- symbols / files
def load_symbols(symdir, extra=None):
    main, ovl = {}, {}
    for line in open(os.path.join(symdir, 'tla-en.tsv')):
        if line.startswith('#') or line.startswith('name\t'):
            continue
        f = line.rstrip('\n').split('\t')
        if len(f) > 1 and re.fullmatch(r'[0-9a-f]{8}', f[1]):
            main.setdefault(f[0], int(f[1], 16))
    for line in open(os.path.join(symdir, 'tla-en-overlays.tsv')):
        if line.startswith('#') or line.startswith('overlay\t'):
            continue
        f = line.rstrip('\n').split('\t')
        if len(f) > 2 and re.fullmatch(r'[0-9a-f]{8}', f[2]):
            ovl.setdefault(f[0].lower(), {}).setdefault(f[1], int(f[2], 16))
    # bss and linker-script (absolute) symbols are not in tla-en.tsv: the reference build's full symbol list
    # (tools/build_ref_tla.sh output, `name addr size type`) fills them in
    if extra and os.path.exists(extra):
        for line in open(extra):
            f = line.split()
            if len(f) >= 2 and not f[0].startswith(('$', '.L')) and re.fullmatch(r'[0-9a-f]{8}', f[1]):
                main[f[0]] = int(f[1], 16)  # its value keeps the Thumb bit of Thumb functions
        # overlay bss symbols: the reference build's overlay ELFs next to it
        odir = os.path.join(os.path.dirname(extra), 'overlays')
        if os.path.isdir(odir):
            sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'ref'))
            import elf32
            for fn in os.listdir(odir):
                m = re.fullmatch(r'resource_([0-9a-f]+)\.elf', fn)
                if m:
                    d = ovl.setdefault(m.group(1), {})
                    for sy in elf32.Elf(os.path.join(odir, fn)).symbols:
                        if sy.name and not sy.name.startswith(('$', '.L')) and sy.shndx != 0:
                            d[sy.name] = sy.value
    return main, ovl


class Listing:
    """One listing file laid out at its addresses: items, labels, a byte image of its data words."""

    def __init__(self, path, ovl, syms):
        self.path, self.ovl, self.syms = path, ovl, syms
        self.items = []          # (addr, mode, kind, payload)
        self.at = {}             # addr -> item index (first item at that address with size)
        self.labels = {}         # label -> addr
        self.words = {}          # addr -> (value, symbolic text or None) for .4byte
        self.image = {}          # addr -> byte (numeric data and resolved symbols)
        self.funcs = []          # (name, addr, mode)
        self.locals = set()      # addresses of local (.L) labels
        self.warn = []
        self.parse()

    def sym(self, name):
        if self.ovl and name in self.syms[1].get(self.ovl, {}):
            return self.syms[1][self.ovl][name]
        if name in self.labels and (name.startswith('.') or name[:-1].isdigit() or name not in self.syms[0]):
            return self.labels[name]
        if name in self.syms[0]:
            return self.syms[0][name]
        return None

    def parse(self):
        lines = open(self.path, encoding='utf8').read().split('\n')
        # pass 1 (ifdef filtering, addresses); labels may be referenced before definition, so values are resolved later
        addr, mode, active, stack = None, 'thumb', True, []
        globs, thumbfn, pend = set(), set(), []
        if not self.ovl:
            base = os.path.basename(self.path)[:8]
            addr = int(base, 16) if re.fullmatch(r'[0-9a-f]{8}', base) else None
        in_text = not self.ovl
        for raw in lines:
            s = raw.split('@')[0].strip()
            if not s:
                continue
            m = re.match(r'\.(ifdef|ifndef)\s+(\S+)', s)
            if m:
                stack.append(active)
                defined = m.group(2) == 'TLA_EDITION_EN'  # the en build defines only TLA_EDITION_EN
                cond = defined if m.group(1) == 'ifdef' else not defined
                active = active and cond
                continue
            if s == '.else':
                parent = stack[-1] if stack else True
                active = parent and not active
                continue
            if s == '.endif':
                active = stack.pop() if stack else True
                continue
            if not active:
                continue
            m = re.match(r'\.section\s+\.text\.x([0-9a-f]{8})', s)
            if m:
                addr, in_text = int(m.group(1), 16), True
                continue
            if s.startswith('.section'):
                in_text = False
                continue
            if not in_text:
                continue
            if s in ('.thumb', '.code 16'):
                mode = 'thumb'; continue
            if s in ('.arm', '.code 32'):
                mode = 'arm'; continue
            m = re.match(r'\.global\s+(\S+)', s)
            if m:
                globs.add(m.group(1)); continue
            if s.startswith('.thumb_func'):
                thumbfn.add(len(self.items)); continue
            if s.startswith(('.syntax', '.type', '.size', '.text', '.include', '.ltorg', '.pool')):
                continue
            m = re.match(r'(\d+):$', s)
            if m:  # numeric local label (used by .reloc 1b)
                self.labels[m.group(1) + 'b'] = addr
                continue
            m = re.match(r'\.reloc\s+(\w+),\s*R_ARM_ABS32\w*,\s*(\S+)', s)
            if m:  # the word at the label is the symbol's address
                pend.append((self.labels[m.group(1)], m.group(2), 4))
                continue
            m = re.match(r'([A-Za-z_.$][\w.$]*):(.*)$', s)
            if m:
                lab = m.group(1)
                if addr is None:
                    addr = self.syms[0].get(lab)
                    addr = addr & ~1 if addr is not None else None
                    if addr is None:
                        raise Unsupported(f'{self.path}: no address for {lab}')
                lm = re.fullmatch(r'\.L_([0-9a-f]{8})', lab)
                if lm and int(lm.group(1), 16) != addr:
                    self.warn.append(f'label {lab} at computed 0x{addr:08x}')
                    addr = int(lm.group(1), 16)
                self.labels[lab] = addr
                if lab.startswith('.'):
                    self.locals.add(addr)
                if lab in globs or not lab.startswith('.'):
                    if lab in globs:
                        self.funcs.append((lab, addr, mode))
                s = m.group(2).strip()
                if not s:
                    continue
            if addr is None:
                raise Unsupported(f'{self.path}: code before any address')
            m = re.match(r'\.balign\s+(\d+)', s) or re.match(r'\.align\s+(\d+)', s)
            if m:
                a = int(m.group(1))
                if s.startswith('.align'):
                    a = 1 << a
                addr = (addr + a - 1) & ~(a - 1)
                continue
            m = re.match(r'\.space\s+(\d+)', s)
            if m:
                for i in range(int(m.group(1))):
                    self.image[addr + i] = 0
                addr += int(m.group(1)); continue
            m = re.match(r'\.(2byte|hword|short)\s+(.+)', s)
            if m:
                for v in m.group(2).split(','):
                    try:
                        self.add(addr, mode, 'h', int(v.strip(), 0))
                    except ValueError:
                        pend.append((addr, v.strip(), 2)); self.add(addr, mode, 'h', 0)
                    addr += 2
                continue
            m = re.match(r'\.byte\s+(.+)', s)
            if m:
                for v in m.group(1).split(','):
                    self.image[addr] = int(v.strip(), 0) & 0xff; addr += 1
                continue
            m = re.match(r'\.(4byte|word|long|inst)\s+(.+)', s)
            if m:
                for v in m.group(2).split(','):
                    pend.append((addr, v.strip(), 4))
                    self.add(addr, mode, 'w', v.strip()); addr += 4
                continue
            if s.startswith('.'):
                self.warn.append(f'directive ignored: {s}')
                continue
            mn = s.split()[0]
            size = 4 if (mode == 'arm' or mn == 'bl') else 2
            self.add(addr, mode, 'i', s)
            addr += size
        for i, (a, mo, k, p) in enumerate(self.items):
            if k == 'h':
                self.image[a] = p & 0xff; self.image[a + 1] = (p >> 8) & 0xff
        for a, v, n in pend:
            self.words.pop(a, None)
            val = self.value(v)
            if val is None:
                self.warn.append(f'unresolved word {v}')
                continue
            if n == 4:
                self.words[a] = (val, None if re.fullmatch(r'-?(0x[0-9a-fA-F]+|\d+)', v) else v)
            for i in range(n):
                self.image[a + i] = (val >> (8 * i)) & 0xff

    def add(self, addr, mode, kind, payload):
        self.at.setdefault(addr, len(self.items))
        self.items.append((addr, mode, kind, payload))

    def value(self, text):
        t = text.replace(' ', '')
        m = re.fullmatch(r'([A-Za-z_.$][\w.$]*)(([+-])(0x[0-9a-fA-F]+|\d+))?', t)
        if m:
            b = self.sym(m.group(1))
            if b is None:
                return None
            off = int(m.group(4), 0) if m.group(2) else 0
            return (b + (off if m.group(3) != '-' else -off)) & 0xffffffff
        return int(t, 0) & 0xffffffff

    def h(self, a):
        if a in self.image and a + 1 in self.image:
            return self.image[a] | self.image[a + 1] << 8
        return None

    def w(self, a):
        x, y = self.h(a), self.h(a + 2)
        return None if x is None or y is None else x | y << 16


# ------------------------------------------------------------------------------------------------ Thumb decoder
def thumb_decode(hw, addr, nxt):
    """A raw Thumb halfword (and the next, for bl) -> unified text the parser takes. Returns (text, size)."""
    op = hw
    r = lambda x: f'r{x}'
    if op >> 13 == 0:
        o = (op >> 11) & 3
        if o < 3:
            imm = (op >> 6) & 31
            if o and imm == 0:
                imm = 32
            return f"{['lsls', 'lsrs', 'asrs'][o]} {r(op & 7)}, {r((op >> 3) & 7)}, #{imm}", 2
        rn, rd, x = (op >> 3) & 7, op & 7, (op >> 6) & 7
        mn = 'subs' if op & 0x200 else 'adds'
        return (f'{mn} {r(rd)}, {r(rn)}, #{x}' if op & 0x400 else f'{mn} {r(rd)}, {r(rn)}, {r(x)}'), 2
    if op >> 13 == 1:
        return f"{['movs', 'cmp', 'adds', 'subs'][(op >> 11) & 3]} {r((op >> 8) & 7)}, #{op & 0xff}", 2
    if op >> 10 == 0x10:
        o = (op >> 6) & 15
        names = ['ands', 'eors', 'lsls', 'lsrs', 'asrs', 'adcs', 'sbcs', 'rors', 'tst', 'negs', 'cmp', 'cmn', 'orrs',
                 'muls', 'bics', 'mvns']
        rd, rs = op & 7, (op >> 3) & 7
        if o == 9:
            return f'negs {r(rd)}, {r(rs)}', 2
        if o == 13:
            return f'muls {r(rd)}, {r(rs)}, {r(rd)}', 2
        return f'{names[o]} {r(rd)}, {r(rs)}', 2
    if op >> 10 == 0x11:
        o = (op >> 8) & 3
        rd = (op & 7) | ((op >> 4) & 8)
        rs = (op >> 3) & 15
        rn = lambda i: RNAMES[i]
        if o == 3:
            return f'bx {rn(rs)}', 2
        return f"{['add', 'cmp', 'mov'][o]} {rn(rd)}, {rn(rs)}", 2
    if op >> 11 == 9:
        return f'ldr {r((op >> 8) & 7)}, [pc, #{(op & 0xff) * 4}]', 2
    if op >> 12 == 5:
        o = (op >> 9) & 7
        names = ['str', 'strh', 'strb', 'ldrsb', 'ldr', 'ldrh', 'ldrb', 'ldrsh']
        return f'{names[o]} {r(op & 7)}, [{r((op >> 3) & 7)}, {r((op >> 6) & 7)}]', 2
    if op >> 13 == 3:
        b, l = (op >> 12) & 1, (op >> 11) & 1
        imm = ((op >> 6) & 31) * (1 if b else 4)
        return f"{('ldr' if l else 'str') + ('b' if b else '')} {r(op & 7)}, [{r((op >> 3) & 7)}, #{imm}]", 2
    if op >> 12 == 8:
        return f"{'ldrh' if op & 0x800 else 'strh'} {r(op & 7)}, [{r((op >> 3) & 7)}, #{((op >> 6) & 31) * 2}]", 2
    if op >> 12 == 9:
        return f"{'ldr' if op & 0x800 else 'str'} {r((op >> 8) & 7)}, [sp, #{(op & 0xff) * 4}]", 2
    if op >> 12 == 10:
        return f"add {r((op >> 8) & 7)}, {'sp' if op & 0x800 else 'pc'}, #{(op & 0xff) * 4}", 2
    if op >> 8 == 0xb0:
        return f"{'sub' if op & 0x80 else 'add'} sp, #{(op & 0x7f) * 4}", 2
    if (op >> 12) == 0xb and ((op >> 9) & 3) == 2:
        regs = [f'r{i}' for i in range(8) if op & (1 << i)]
        if op & 0x100:
            regs.append('pc' if op & 0x800 else 'lr')
        return f"{'pop' if op & 0x800 else 'push'} {{{', '.join(regs)}}}", 2
    if op >> 12 == 12:
        regs = [f'r{i}' for i in range(8) if op & (1 << i)]
        return f"{'ldmia' if op & 0x800 else 'stmia'} {r((op >> 8) & 7)}!, {{{', '.join(regs)}}}", 2
    if op >> 12 == 13:
        c = (op >> 8) & 15
        if c == 15:
            raise Unsupported(f'swi 0x{op & 0xff:x}')
        if c == 14:
            raise Unsupported('undefined thumb')
        off = ((op & 0xff) ^ 0x80) - 0x80
        return f'b{COND[c]} 0x{addr + 4 + off * 2:x}', 2
    if op >> 11 == 0x1c:
        off = ((op & 0x7ff) ^ 0x400) - 0x400
        return f'b 0x{addr + 4 + off * 2:x}', 2
    if op >> 11 == 0x1e and nxt is not None and nxt >> 11 == 0x1f:
        off = ((((op & 0x7ff) << 11) | (nxt & 0x7ff)) ^ 0x200000) - 0x200000
        return f'bl 0x{addr + 4 + off * 2:x}', 4
    if op >> 11 == 0x1f:  # BL suffix alone: call lr + offset * 2 (call-via-lr when 0)
        return f'blh #{(op & 0x7ff) * 2}', 2
    raise Unsupported(f'thumb halfword 0x{op:04x}')


# ----------------------------------------------------------------------------------------------- the translator
class Fn:
    def __init__(self, tr, lst, name, addr, mode, end):
        self.tr, self.L, self.name, self.addr, self.mode, self.end = tr, lst, name, addr, mode, end
        self.cname = tr.cname(lst.ovl, addr)
        self.code = {}       # (addr) -> (mode, lines, succ)
        self.uses_dispatch = False
        self.localrets = set()

    def inside(self, a):
        return self.addr <= a < self.end and not getattr(self, '_stub', {}).get(a)

    # ---- operands
    def reg(self, t):
        t = t.strip().lower()
        if t not in REGS:
            raise Unsupported(f'register {t}')
        return REGS[t]

    def imm(self, t):
        t = t.strip()
        if not t.startswith('#'):
            raise Unsupported(f'immediate {t}')
        return int(t[1:], 0) & 0xffffffff

    def target(self, t):
        t = t.strip()
        if re.fullmatch(r'0x[0-9a-f]+', t):
            return int(t, 16)
        v = self.L.sym(t)
        if v is None:
            v = self.L.value(t)  # symbol +/- offset
        if v is None:
            raise Unsupported(f'unknown target {t}')
        return v & ~1

    def rd_pc(self, a, mode):
        return (a + 4) if mode == 'thumb' else (a + 8)

    def symexpr(self, a):
        val, txt = self.L.words.get(a, (None, None))
        if val is None:
            w = self.L.w(a)
            if w is None:
                raise Unsupported(f'pool word at 0x{a:x} unknown')
            return f'0x{w:08x}u'
        if txt and not txt.startswith('.L'):
            nm = re.match(r'[A-Za-z_][\w]*', txt).group(0)
            base = self.L.sym(nm)
            return f'A2C_SYM({nm}, 0x{(val - base) & 0xffffffff:x}u, 0x{val:08x}u)'
        return f'0x{val:08x}u'

    # ---- discovery + emission
    def translate(self):
        work = [(self.addr, self.mode)]
        seen = set()
        while work:
            a, mo = work.pop()
            optional = mo.endswith('?')
            mo = mo.rstrip('?')
            if (a, mo) in seen or (optional and a in self.code):
                continue
            seen.add((a, mo))
            if not self.inside(a):
                if optional:
                    continue
                if any(f[1] == a for f in self.L.funcs) or self.tr.known(self.L.ovl, a):  # falls through into the next routine: a tail call
                    self.code[a] = (mo, self.tail(a, mo == 'thumb'), [], a)
                    continue
                raise Unsupported(f'flow leaves the routine at 0x{a:x}')
            try:
                lines, succ = (self.thumb(a) if mo == 'thumb' else self.arm(a))
            except Unsupported:
                if optional:  # the return point of a far jump that never comes back (data follows)
                    self.localrets.discard(a)
                    continue
                raise
            self.code[a] = (mo, lines, succ, a + (4 if mo == 'arm' else self.thumb_text(a)[1]))
            work.extend(succ)
        return self.emit()

    def thumb_text(self, a):
        i = self.L.at.get(a)
        if i is not None and self.L.items[i][2] == 'i':
            s = self.L.items[i][3]
            return s, 4 if s.split()[0] == 'bl' else 2
        hw = self.L.h(a)
        if hw is None:
            raise Unsupported(f'no code at 0x{a:x}')
        return thumb_decode(hw, a, self.L.h(a + 2))

    def labels_in_tables(self):
        out = set()
        for wa, (val, txt) in self.L.words.items():
            if self.inside(wa) and txt and txt.startswith('.L') and self.inside(val & ~1):
                out.add(val & ~1)
        return sorted(out)

    def thumb(self, a):
        s, size = self.thumb_text(a)
        nxt = a + size
        mn, _, ops = s.partition(' ')
        mn = mn.lower()
        o = [x.strip() for x in re.split(r',(?![^{]*\})(?![^\[]*\])', ops)] if ops else []
        L, fall = [], [(nxt, 'thumb')]
        flags_nz = lambda d: [f'n = {d} >> 31; z = {d} == 0;']

        def add_flags(d, x, y, cin='0'):
            return [f'{{ u64 t_ = (u64){x} + (u64){y} + {cin}; u32 a_ = {x}, b_ = {y}; u32 r_ = (u32)t_;',
                    f'  c = (u32)(t_ >> 32); v = ((~(a_ ^ b_) & (a_ ^ r_)) >> 31); n = r_ >> 31; z = r_ == 0; {d} = r_; }}']

        def sub_flags(d, x, y, cin='1'):
            return [f'{{ u32 a_ = {x}, b_ = {y}; u64 t_ = (u64)a_ - (u64)b_ - (1 - ({cin})); u32 r_ = (u32)t_;',
                    f'  c = (u32)((t_ >> 32) == 0); v = (((a_ ^ b_) & (a_ ^ r_)) >> 31); n = r_ >> 31; z = r_ == 0; {d} = r_; }}']

        def val(t):
            t = t.strip()
            if t.startswith('#'):
                return f'0x{self.imm(t):x}u'
            r = self.reg(t)
            return f'0x{self.rd_pc(a, "thumb"):x}u' if r == 'pc' else r

        def addr_expr(t):
            m = re.fullmatch(r'\[\s*(\w+)\s*(?:,\s*(#?-?\w+))?\s*\]', t)
            if not m:
                raise Unsupported(f'address {t}')
            base = self.reg(m.group(1))
            if base == 'pc':
                off = self.imm(m.group(2)) if m.group(2) else 0
                return None, ((a + 4) & ~3) + off
            if not m.group(2):
                return base, None
            if m.group(2).startswith('#'):
                off = self.imm(m.group(2))
                return (f'({base} + 0x{off:x}u)' if off else base), None
            return f'({base} + {self.reg(m.group(2))})', None

        if mn in ('movs', 'mov') and len(o) == 2:
            d = self.reg(o[0])
            if o[1].startswith('#'):
                L.append(f'{d} = {val(o[1])};')
                if mn == 'movs':
                    L += flags_nz(d)
            elif d == 'pc':
                return self.jump_table(a, val(o[1]))
            else:
                L.append(f'{d} = {val(o[1])};')
                if mn == 'movs':
                    L += flags_nz(d)
        elif mn in ('adds', 'subs', 'add', 'sub') and len(o) in (2, 3):
            d = self.reg(o[0])
            x, y = (o[0], o[1]) if len(o) == 2 else (o[1], o[2])
            if d == 'pc':
                raise Unsupported('add pc')
            if x.strip().lower() == 'pc':
                xv = f'0x{(a + 4) & ~3:x}u' if y.startswith('#') else f'0x{a + 4:x}u'
            else:
                xv = val(x)
            yv = val(y)
            if mn == 'adds':
                L += add_flags(d, xv, yv)
            elif mn == 'subs':
                L += sub_flags(d, xv, yv)
            else:
                L.append(f'{d} = {xv} {"+" if mn == "add" else "-"} {yv};')
        elif mn == 'cmp':
            L += ['{ u32 t_cmp;'] + sub_flags('t_cmp', val(o[0]), val(o[1])) + ['}']
        elif mn == 'cmn':
            L += ['{ u32 t_cmp;'] + add_flags('t_cmp', val(o[0]), val(o[1])) + ['}']
        elif mn in ('adcs', 'sbcs'):
            d = self.reg(o[0])
            L += add_flags(d, d, val(o[1]), 'c') if mn == 'adcs' else sub_flags(d, d, val(o[1]), 'c')
        elif mn == 'negs':
            d = self.reg(o[0])
            L += sub_flags(d, '0u', val(o[1]))
        elif mn in ('ands', 'orrs', 'eors', 'bics', 'tst'):
            d = self.reg(o[0])
            opx = {'ands': '&', 'orrs': '|', 'eors': '^', 'bics': '& ~', 'tst': '&'}[mn]
            y = val(o[2] if len(o) == 3 else o[1])
            x = val(o[1]) if len(o) == 3 else d
            if mn == 'tst':
                L.append(f'{{ u32 t_ = {d} & {y}; n = t_ >> 31; z = t_ == 0; }}')
            else:
                L.append(f'{d} = {x} {opx}{y};')
                L += flags_nz(d)
        elif mn == 'mvns':
            d = self.reg(o[0]); L.append(f'{d} = ~{val(o[1])};'); L += flags_nz(d)
        elif mn == 'muls':
            d = self.reg(o[0])
            y = val(o[2]) if len(o) == 3 else d
            L.append(f'{d} = {val(o[1])} * {y};'); L += flags_nz(d)
        elif mn in ('lsls', 'lsrs', 'asrs', 'rors'):
            d = self.reg(o[0])
            src, amt = (o[1], o[2]) if len(o) == 3 else (o[0], o[1])
            sv = val(src)
            if amt.startswith('#'):
                k = self.imm(amt)
                if mn == 'lsls':
                    L.append(f'{d} = {sv};' if k == 0 else f'c = ({sv} >> {32 - k}) & 1; {d} = {sv} << {k};')
                elif mn == 'lsrs':
                    L.append(f'c = {sv} >> 31; {d} = 0;' if k == 32 else f'c = ({sv} >> {k - 1}) & 1; {d} = {sv} >> {k};')
                elif mn == 'asrs':
                    L.append(f'c = {sv} >> 31; {d} = (u32)((s32){sv} >> 31);' if k == 32 else
                             f'c = ({sv} >> {k - 1}) & 1; {d} = (u32)((s32){sv} >> {k});')
                else:
                    raise Unsupported('rors #imm in thumb')
            else:
                kind = {'lsls': 0, 'lsrs': 1, 'asrs': 2, 'rors': 3}[mn]
                L.append(f'{d} = a2c_shift_reg({kind}, {sv}, {val(amt)} & 0xff, &c);')
            L += flags_nz(d)
        elif mn in ('ldr', 'ldrh', 'ldrb', 'ldrsh', 'ldrsb', 'str', 'strh', 'strb'):
            d = self.reg(o[0])
            if mn == 'ldr' and not o[1].startswith('['):
                pa = self.target(o[1])
                L.append(f'{d} = {self.symexpr(pa)};')
            else:
                e, const = addr_expr(o[1])
                if const is not None:
                    if mn != 'ldr':
                        raise Unsupported('pc-relative non-word')
                    L.append(f'{d} = {self.symexpr(const)};')
                else:
                    fn = {'ldr': 'a2c_ld32', 'ldrh': 'a2c_ld16', 'ldrb': 'a2c_ld8', 'ldrsh': 'a2c_lds16',
                          'ldrsb': 'a2c_lds8'}
                    if mn in fn:
                        L.append(f'{d} = {fn[mn]}({e});')
                    else:
                        L.append(f"a2c_st{ {'str': 32, 'strh': 16, 'strb': 8}[mn] }({e}, {d});")
        elif mn in ('push', 'pop', 'stmia', 'ldmia'):
            if mn in ('push', 'pop'):
                base, wb, lst = 'sp', True, o[0]
            else:
                base, wb, lst = self.reg(o[0].rstrip('!')), o[0].endswith('!'), o[1]
            regs = [self.reg(x) for x in reglist(lst)]
            regs = expand(regs)
            order = sorted(regs, key=RNAMES.index)
            if mn == 'push':
                L.append(f'sp -= {4 * len(order)};')
                for i, r in enumerate(order):
                    L.append(f'a2c_st32(sp + {4 * i}, {r});')
            elif mn == 'stmia':
                for i, r in enumerate(order):
                    L.append(f'a2c_st32({base} + {4 * i}, {r});')
                L.append(f'{base} += {4 * len(order)};')
            else:
                L.append(f'{{ u32 b_ = {base};')
                pc_load = None
                for i, r in enumerate(order):
                    if r == 'pc':
                        pc_load = f'a2c_ld32(b_ + {4 * i})'
                    else:
                        L.append(f'  {r} = a2c_ld32(b_ + {4 * i});')
                if wb and base not in order:
                    L.append(f'  {base} = b_ + {4 * len(order)};')
                elif mn == 'pop':
                    L.append(f'  sp = b_ + {4 * len(order)};')
                if pc_load:
                    L.append(f'  {{ u32 t_ = {pc_load}; A2C_RETJUMP(t_); }} }}')
                    self.uses_dispatch = True
                    return L, []
                L.append('}')
        elif mn == 'b' or (mn[0] == 'b' and mn[1:] in CONDC and mn not in ('bl', 'bx')):
            t = self.target(o[0])
            if mn == 'b':
                if not self.inside(t):
                    return self.tail(t), []
                return [f'goto L_{t:08x};'], [(t, 'thumb')]
            if not self.inside(t):
                return [f'if ({CONDC[mn[1:]]}) {{'] + ['  ' + x for x in self.tail(t)] + ['}'], [(nxt, 'thumb')]
            return [f'if ({CONDC[mn[1:]]}) goto L_{t:08x};'], [(t, 'thumb'), (nxt, 'thumb')]
        elif mn == 'bl':
            t = self.target(o[0])
            if self.inside(t) and t != self.addr and t in self.L.locals:
                self.localrets.add(nxt)
                return [f'lr = 0x{nxt | 1:x}u; goto L_{t:08x};'], [(t, 'thumb'), (nxt, 'thumb?')]
            L += [f'lr = 0x{nxt | 1:x}u;'] + self.call(t, True)
        elif mn == 'blh':
            off = self.imm(o[0]) if o and o[0].startswith('#') else 0
            L += [f'{{ u32 t_ = lr + {off}u; lr = 0x{nxt | 1:x}u; A2C_SPILL(); a2c_dispatch((t_ & ~1u) | 1u); A2C_RELOAD(); }}']
            self.uses_dispatch = True
        elif mn == 'bx':
            r = self.reg(o[0])
            if r == 'pc':
                t = (a + 4) & ~3
                if not self.inside(t) or self.L.w(t) is None:  # a bx pc veneer into the next (ARM) routine
                    return self.tail(t, False), []
                return [f'goto L_{t:08x};'], [(t, 'arm')]
            self.uses_dispatch = True
            return [f'A2C_RETJUMP({r});'], []
        else:
            raise Unsupported(f'thumb {s}')
        return L, fall

    def call(self, t, thumb):
        cn = self.tr.known(self.L.ovl, t)
        if cn:
            return [f'A2C_SPILL(); {cn}(); A2C_RELOAD();']
        return [f'A2C_SPILL(); a2c_call(0x{t | (1 if thumb else 0):x}u); A2C_RELOAD();']

    def tail(self, t, thumb=True):
        cn = self.tr.known(self.L.ovl, t)
        c = f'{cn}()' if cn else f'a2c_call(0x{t | (1 if thumb else 0):x}u)'
        return [f'A2C_TAILK({c});']

    def table_after(self, a):
        w = (a + 2 + 3) & ~3
        out = []
        while w in self.L.words and (self.L.words[w][1] or '').startswith('.L') and self.inside(self.L.words[w][0] & ~1):
            out.append(self.L.words[w][0] & ~1)
            w += 4
        return sorted(set(out))

    def jump_table(self, a, x):
        labs = self.table_after(a) or self.labels_in_tables()
        L = [f'switch ({x} & ~1u) {{'] + [f'case 0x{t:x}u: goto L_{t:08x};' for t in labs] + \
            [f'default: A2C_RETJUMP({x}); }}']
        self.uses_dispatch = True
        return L, [(t, 'thumb') for t in labs]

    # ---- ARM
    def arm(self, a):
        op = self.L.w(a)
        if op is None:
            raise Unsupported(f'no ARM word at 0x{a:x}')
        cc = op >> 28
        if cc == 15:
            raise Unsupported('ARM NV')
        body, succ, ends = self.arm_body(op, a)
        nxt = (a + 4, 'arm')
        if cc == 14:
            return body, succ + ([] if ends else [nxt])
        return [f'if ({CONDC[COND[cc]]}) {{'] + ['  ' + x for x in body] + ['}'], succ + [nxt]

    def arm_body(self, op, a):
        R = lambda i: f'0x{a + 8:x}u' if i == 15 else RNAMES[i]
        bits = (op >> 25) & 7
        if (op & 0x0ffffff0) == 0x012fff10:
            rm = op & 15
            self.uses_dispatch = True
            # a call when lr was pointed into this routine first (mov lr, pc / add lr, pc, #k): A2C_LOCALRET
            return [f'A2C_RETJUMP({R(rm)});'], [], True
        if bits == 0 and (op & 0x90) == 0x90:
            sh = (op >> 5) & 3
            if sh == 0:
                if (op & 0x0fc000f0) == 0x90:
                    rd, rn, rs, rm = (op >> 16) & 15, (op >> 12) & 15, (op >> 8) & 15, op & 15
                    e = f'{R(rm)} * {R(rs)}' + (f' + {R(rn)}' if op & (1 << 21) else '')
                    L = [f'{RNAMES[rd]} = {e};']
                    if op & (1 << 20):
                        L.append(f'n = {RNAMES[rd]} >> 31; z = {RNAMES[rd]} == 0;')
                    return L, [], False
                if (op & 0x0f8000f0) == 0x00800090:
                    hi, lo, rs, rm = (op >> 16) & 15, (op >> 12) & 15, (op >> 8) & 15, op & 15
                    sg = op & (1 << 22)
                    p = f'(u64)((s64)(s32){R(rm)} * (s64)(s32){R(rs)})' if sg else f'((u64){R(rm)} * (u64){R(rs)})'
                    if op & (1 << 21):
                        p = f'({p} + (((u64){RNAMES[hi]} << 32) | {RNAMES[lo]}))'
                    L = [f'{{ u64 p_ = {p}; {RNAMES[lo]} = (u32)p_; {RNAMES[hi]} = (u32)(p_ >> 32);']
                    if op & (1 << 20):
                        L.append(f'  n = {RNAMES[hi]} >> 31; z = p_ == 0;')
                    L.append('}')
                    return L, [], False
                raise Unsupported(f'ARM 0x{op:08x} (swp)')
            # halfword / signed transfers
            P, U, I, W, Lb = (op >> 24) & 1, (op >> 23) & 1, (op >> 22) & 1, (op >> 21) & 1, (op >> 20) & 1
            rn, rd = (op >> 16) & 15, (op >> 12) & 15
            off = f'0x{((op >> 4) & 0xf0) | (op & 15):x}u' if I else R(op & 15)
            return self.arm_xfer(a, P, U, W, Lb, rn, rd, off, {1: 'h', 2: 'sb', 3: 'sh'}[sh]), [], False
        if bits in (0, 1):
            opc, S, rn, rd = (op >> 21) & 15, (op >> 20) & 1, (op >> 16) & 15, (op >> 12) & 15
            if (opc & 0xc) == 0x8 and not S:
                raise Unsupported(f'ARM 0x{op:08x} (msr/mrs)')
            L = []
            if bits == 1:
                k = (op >> 8) & 15
                imm = op & 0xff
                val = ((imm >> (2 * k)) | (imm << (32 - 2 * k))) & 0xffffffff if k else imm
                b = f'0x{val:x}u'
                sc = (f'{val >> 31}' if k else 'c')
            else:
                rm = op & 15
                typ = (op >> 5) & 3
                if op & 0x10:
                    rs = (op >> 8) & 15
                    rmv = f'0x{a + 12:x}u' if rm == 15 else RNAMES[rm]
                    L.append(f'{{ u32 sc_ = c; u32 b_ = a2c_shift_reg({typ}, {rmv}, {RNAMES[rs]} & 0xff, &sc_);')
                else:
                    amt = (op >> 7) & 31
                    L.append(f'{{ u32 sc_ = c; u32 b_ = a2c_shift_imm({typ}, {R(rm)}, {amt}, &sc_);')
                b, sc = 'b_', 'sc_'
            av = R(rn) if not (op & 0x10 and bits == 0 and rn == 15) else f'0x{a + 12:x}u'
            d = RNAMES[rd]
            succ_extra = []
            if rd == 14 and bits == 1 and opc in (4, 2, 13) and (rn == 15 or opc == 13):
                pass
            if rd == 14 and ((opc == 13 and bits == 0 and (op & 0xfff) == 15) or (bits == 1 and rn == 15 and opc in (2, 4))):
                k = (op & 0xff) if bits == 1 else 0
                ret = (a + 8 + (k if opc != 2 else -k)) & 0xffffffff
                self.localrets.add(ret & ~1)
                succ_extra = [(ret & ~1, 'thumb?' if ret & 1 else 'arm?')]
            nz = lambda e: f'n = {e} >> 31; z = {e} == 0;'
            logical = {0: '&', 1: '^', 12: '|', 14: '& ~'}
            if opc in logical or opc in (13, 15, 8, 9):
                if opc == 13:
                    e = b
                elif opc == 15:
                    e = f'~{b}'
                elif opc in (8, 9):
                    e = f'({av} {"&" if opc == 8 else "^"} {b})'
                else:
                    e = f'({av} {logical[opc]}{b})'
                if opc in (8, 9):
                    L.append(f'{{ u32 t_ = {e}; {nz("t_")} c = {sc}; }}')
                else:
                    L.append(f'{d} = {e};')
                    if S:
                        L.append(f'{nz(d)} c = {sc};')
            else:
                x, y, cin, kind = {2: (av, b, '1', 's'), 3: (b, av, '1', 's'), 4: (av, b, '0', 'a'),
                                   5: (av, b, 'c', 'a'), 6: (av, b, 'c', 's'), 7: (b, av, 'c', 's'),
                                   10: (av, b, '1', 's'), 11: (av, b, '0', 'a')}[opc]
                dst = d if opc not in (10, 11) else 't_'
                if kind == 'a':
                    L.append(f'{{ u32 a_ = {x}, b2_ = {y}; u64 t64_ = (u64)a_ + b2_ + {cin}; u32 t_ = (u32)t64_;')
                    fl = f'c = (u32)(t64_ >> 32); v = ((~(a_ ^ b2_) & (a_ ^ t_)) >> 31); {nz("t_")}'
                else:
                    L.append(f'{{ u32 a_ = {x}, b2_ = {y}; u64 t64_ = (u64)a_ - b2_ - (1 - ({cin})); u32 t_ = (u32)t64_;')
                    fl = f'c = (u32)((t64_ >> 32) == 0); v = (((a_ ^ b2_) & (a_ ^ t_)) >> 31); {nz("t_")}'
                if S or opc in (10, 11):
                    L.append('  ' + fl)
                if opc not in (10, 11):
                    L.append(f'  {d} = t_;')
                L.append('}')
            if bits == 0:
                L.append('}')
            if rd == 15 and opc not in (8, 9, 10, 11):
                if S:
                    raise Unsupported('ARM movs pc')
                self.uses_dispatch = True
                L.append('A2C_RETJUMP(pc);')
                return L, succ_extra, True
            return L, succ_extra, False
        if bits in (2, 3):
            if bits == 3 and op & 0x10:
                raise Unsupported(f'ARM undefined 0x{op:08x}')
            P, U, B, W, Lb = (op >> 24) & 1, (op >> 23) & 1, (op >> 22) & 1, (op >> 21) & 1, (op >> 20) & 1
            rn, rd = (op >> 16) & 15, (op >> 12) & 15
            if bits == 2:
                off = f'0x{op & 0xfff:x}u'
            else:
                off = f'a2c_shift_imm_nc({(op >> 5) & 3}, {R(op & 15)}, {(op >> 7) & 31}, c)'
            return self.arm_xfer(a, P, U, W, Lb, rn, rd, off, 'b' if B else 'w'), [], (Lb and rd == 15)
        if bits == 4:
            P, U, S, W, Lb = (op >> 24) & 1, (op >> 23) & 1, (op >> 22) & 1, (op >> 21) & 1, (op >> 20) & 1
            if S:
                raise Unsupported('ARM ldm/stm ^')
            rn = (op >> 16) & 15
            regs = [i for i in range(16) if op & (1 << i)]
            nb = 4 * len(regs)
            start = {(0, 1): '0', (1, 1): '4', (0, 0): f'{-nb + 4}', (1, 0): f'{-nb}'}[(P, U)]
            L = [f'{{ u32 b_ = {RNAMES[rn]} + (u32)({start});']
            pc = False
            for k, r in enumerate(regs):
                if Lb:
                    if r == 15:
                        pc = f'a2c_ld32(b_ + {4 * k})'
                    else:
                        L.append(f'  {RNAMES[r]} = a2c_ld32(b_ + {4 * k});')
                else:
                    L.append(f'  a2c_st32(b_ + {4 * k}, {R(r) if r != 15 else hex(a + 12) + "u"});')
            if W and not (Lb and rn in regs):
                L.append(f'  {RNAMES[rn]} = {RNAMES[rn]} {"+" if U else "-"} {nb}u;')
            if pc:
                self.uses_dispatch = True
                L.append(f'  {{ u32 t_ = {pc}; A2C_RETJUMP(t_); }}')
            L.append('}')
            return L, [], bool(pc)
        if bits == 5:
            off = ((op & 0xffffff) ^ 0x800000) - 0x800000
            t = (a + 8 + off * 4) & 0xffffffff
            if op & (1 << 24):
                if self.inside(t) and t != self.addr:
                    self.localrets.add(a + 4)
                    return [f'lr = 0x{a + 4:x}u; goto L_{t:08x};'], [(t, 'arm'), (a + 4, 'arm')], True
                return [f'lr = 0x{a + 4:x}u;'] + self.call(t, False), [], False
            if self.inside(t):
                return [f'goto L_{t:08x};'], [(t, 'arm')], True
            return self.tail(t, False), [], True
        raise Unsupported(f'ARM 0x{op:08x}')

    def arm_xfer(self, a, P, U, W, Lb, rn, rd, off, kind):
        base = f'0x{a + 8:x}u' if rn == 15 else RNAMES[rn]
        sign = '+' if U else '-'
        L = [f'{{ u32 ea_ = {base} {sign} {off}; u32 b_ = {"ea_" if P else base};']
        if Lb:
            fn = {'w': 'a2c_ld32', 'b': 'a2c_ld8', 'h': 'a2c_ld16', 'sb': 'a2c_lds8', 'sh': 'a2c_lds16'}[kind]
            L.append(f'  u32 v_ = {fn}(b_);')
        else:
            src = f'0x{a + 12:x}u' if rd == 15 else RNAMES[rd]
            L.append(f"  a2c_st{ {'w': 32, 'b': 8, 'h': 16}[kind] }(b_, {src});")
        if (not P or W) and rn != 15:
            L.append(f'  {RNAMES[rn]} = ea_;')
        if Lb:
            if rd == 15:
                self.uses_dispatch = True
                L.append('  A2C_RETJUMP(v_);')
            else:
                L.append(f'  {RNAMES[rd]} = v_;')
        L.append('}')
        return L

    def emit(self):
        cases = ' '.join(f'case 0x{x:x}u: goto L_{x:08x};' for x in sorted(self.localrets) if x in self.code)
        head = [f'/* {self.name} 0x{self.addr:08x} ({self.mode}){" overlay " + self.L.ovl if self.L.ovl else ""} */',
                '#undef A2C_LOCALRET',
                f'#define A2C_LOCALRET(k) switch ((k) & ~1u) {{ {cases} default: break; }}' if cases else
                '#define A2C_LOCALRET(k) ((void)0)',
                f'void {self.cname}(void) {{', '  A2C_ENTER();']
        return self.fix_fallthrough(head)

    def fix_fallthrough(self, head):
        # a block that falls through to the next address gets a goto when that block is not emitted next
        res = list(head)
        # local return points are entered only by A2C_LOCALRET
        addrs = sorted(self.code)
        for i, a in enumerate(addrs):
            mo, lines, succ, nxt = self.code[a]
            res.append(f'L_{a:08x}: A2C_T(0x{a:x}u);')
            res += ['  ' + x for x in lines]
            if (nxt, mo) in succ and (i + 1 >= len(addrs) or addrs[i + 1] != nxt):
                res.append(f'  goto L_{nxt:08x};')
        res += ['ret:', '  A2C_LEAVE();', '}', '']
        return res


def expand(regs):
    return regs


def reglist(text):
    out = []
    for x in text.strip('{} ').split(','):
        x = x.strip().lower()
        if not x:
            continue
        m = re.fullmatch(r'r(\d+)-r(\d+)', x)
        if m:
            out += [f'r{i}' for i in range(int(m.group(1)), int(m.group(2)) + 1)]
        else:
            out.append(x)
    return out


HEADER = r'''/* Generated by tools/wasm/asm2c.py from the vendor's TLA listings: build output, never committed. */
#include <stdint.h>
typedef uint8_t u8; typedef uint16_t u16; typedef uint32_t u32; typedef uint64_t u64;
typedef int8_t s8; typedef int16_t s16; typedef int32_t s32; typedef int64_t s64;
typedef struct { u32 r[16]; u32 n, z, c, v; } A2cRegs;
extern A2cRegs a2c_r;
void a2c_call(u32 addr);          /* code that is not translated here (C, BIOS, hand ports): Port_ResolveCode */
u32 a2c_overlay_current(void);    /* the loaded scene overlay's resource id (0 if none) */
void a2c_dispatch(u32 addr);
void a2c_badreturn(u32 addr, u32 expected);
void a2c_trace(u32 addr);
#ifndef A2C_SYM /* symbol, offset, its GBA address + offset: the build may bind wasm-resident data instead */
#define A2C_SYM(name, off, addr) (addr)
#endif
#ifndef A2C_T /* per-instruction hook: the D20 trace build defines it (tests/arm/tla/build_test.sh TRACE=1) */
#define A2C_T(a) ((void)0)
#endif
#ifndef A2C_STACK_TOP
#define A2C_STACK_TOP (a2c_r.r[13] ? a2c_r.r[13] : 0x03007f00u)
#endif
#ifndef A2C_RET_SENTINEL
#define A2C_RET_SENTINEL 0x0d0ffff0u
#endif
#define A2C_MEM(a) ((u8 *)(uintptr_t)(a))
static inline u32 a2c_ld32(u32 a) { u32 w = *(u32 *)A2C_MEM(a & ~3u); u32 s = (a & 3) * 8; return s ? (w >> s) | (w << (32 - s)) : w; }
static inline u32 a2c_ld16(u32 a) { u32 h = *(u16 *)A2C_MEM(a & ~1u); return (a & 1) ? (h >> 8) | (h << 24) : h; }
static inline u32 a2c_ld8(u32 a) { return *A2C_MEM(a); }
static inline u32 a2c_lds8(u32 a) { return (u32)(s32)*(s8 *)A2C_MEM(a); }
static inline u32 a2c_lds16(u32 a) { return (a & 1) ? (u32)(s32)*(s8 *)A2C_MEM(a) : (u32)(s32)*(s16 *)A2C_MEM(a); }
static inline void a2c_st32(u32 a, u32 v) { *(u32 *)A2C_MEM(a & ~3u) = v; }
static inline void a2c_st16(u32 a, u32 v) { *(u16 *)A2C_MEM(a & ~1u) = (u16)v; }
static inline void a2c_st8(u32 a, u32 v) { *A2C_MEM(a) = (u8)v; }
/* register-specified shift (amount 0-255) with carry out, as the ARM7 */
static inline u32 a2c_shift_reg(int t, u32 x, u32 k, u32 *c) {
  if (k == 0) return x;
  switch (t) {
  case 0: if (k < 32) { *c = (x >> (32 - k)) & 1; return x << k; } *c = k == 32 ? x & 1 : 0; return 0;
  case 1: if (k < 32) { *c = (x >> (k - 1)) & 1; return x >> k; } *c = k == 32 ? x >> 31 : 0; return 0;
  case 2: if (k < 32) { *c = (x >> (k - 1)) & 1; return (u32)((s32)x >> k); } *c = x >> 31; return (u32)((s32)x >> 31);
  default: { u32 r = k & 31; if (r) x = (x >> r) | (x << (32 - r)); *c = x >> 31; return x; }
  }
}
/* immediate-encoded shift (ARM: #0 means LSL #0, LSR #32, ASR #32, RRX) */
static inline u32 a2c_shift_imm(int t, u32 x, u32 k, u32 *c) {
  if (k == 0) {
    switch (t) { case 0: return x; case 1: *c = x >> 31; return 0; case 2: *c = x >> 31; return (u32)((s32)x >> 31);
    default: { u32 r = (*c << 31) | (x >> 1); *c = x & 1; return r; } }
  }
  return a2c_shift_reg(t, x, k, c);
}
static inline u32 a2c_shift_imm_nc(int t, u32 x, u32 k, u32 c) { u32 cc = c; return a2c_shift_imm(t, x, k, &cc); }
#define A2C_ENTER() u32 r0 = a2c_r.r[0], r1 = a2c_r.r[1], r2 = a2c_r.r[2], r3 = a2c_r.r[3], r4 = a2c_r.r[4], \
  r5 = a2c_r.r[5], r6 = a2c_r.r[6], r7 = a2c_r.r[7], r8 = a2c_r.r[8], r9 = a2c_r.r[9], r10 = a2c_r.r[10], \
  r11 = a2c_r.r[11], r12 = a2c_r.r[12], sp = a2c_r.r[13], lr = a2c_r.r[14], pc = 0; const u32 lr0 = lr; \
  u32 n = a2c_r.n, z = a2c_r.z, c = a2c_r.c, v = a2c_r.v; (void)pc; (void)n; (void)z; (void)c; (void)v
#define A2C_SPILL() (a2c_r.r[0] = r0, a2c_r.r[1] = r1, a2c_r.r[2] = r2, a2c_r.r[3] = r3, a2c_r.r[4] = r4, \
  a2c_r.r[5] = r5, a2c_r.r[6] = r6, a2c_r.r[7] = r7, a2c_r.r[8] = r8, a2c_r.r[9] = r9, a2c_r.r[10] = r10, \
  a2c_r.r[11] = r11, a2c_r.r[12] = r12, a2c_r.r[13] = sp, a2c_r.r[14] = lr, a2c_r.n = n, a2c_r.z = z, a2c_r.c = c, a2c_r.v = v)
#define A2C_RELOAD() (r0 = a2c_r.r[0], r1 = a2c_r.r[1], r2 = a2c_r.r[2], r3 = a2c_r.r[3], r4 = a2c_r.r[4], \
  r5 = a2c_r.r[5], r6 = a2c_r.r[6], r7 = a2c_r.r[7], r8 = a2c_r.r[8], r9 = a2c_r.r[9], r10 = a2c_r.r[10], \
  r11 = a2c_r.r[11], r12 = a2c_r.r[12], sp = a2c_r.r[13], lr = a2c_r.r[14], n = a2c_r.n, z = a2c_r.z, c = a2c_r.c, v = a2c_r.v)
#define A2C_LEAVE() A2C_SPILL()
/* C -> translated routine: r0-r3, nstack words on the GBA stack (AAPCS), r4-r12 and flags 0, lr a sentinel */
static inline u32 a2c_enter_wrapped(u32 nstack, const u32 *a, void (*f)(void)) {
  A2cRegs save = a2c_r; u32 top = A2C_STACK_TOP, sp = top - 4 * nstack, i, res;
  for (i = 0; i < 16; i++) a2c_r.r[i] = 0;
  for (i = 0; i < 4; i++) a2c_r.r[i] = a[i];
  for (i = 0; i < nstack && i < 8; i++) a2c_st32(sp + 4 * i, a[4 + i]);
  a2c_r.r[13] = sp; a2c_r.r[14] = A2C_RET_SENTINEL; a2c_r.n = a2c_r.z = a2c_r.c = a2c_r.v = 0;
  f(); res = a2c_r.r[0];
  save.r[0] = a2c_r.r[0]; save.r[1] = a2c_r.r[1]; a2c_r = save; return res;
}
/* a jump through a register: the return when it is the entry lr, else a tail call */
/* the continuation of a jump: the entry lr returns, a local call's return address (A2C_LOCALRET, per routine)
   goes back into the routine; any other address is a tail call whose callee returns to the lr of the jump */
#define A2C_CONT(k) do { if ((((k) ^ lr0) & ~1u) == 0) goto ret; A2C_LOCALRET(k); a2c_badreturn((k), lr0); goto ret; } while (0)
#define A2C_TAILK(callstmt) do { u32 k_ = lr; A2C_SPILL(); callstmt; A2C_RELOAD(); A2C_CONT(k_); } while (0)
#define A2C_RETJUMP(t) do { u32 tt_ = (t); if (((tt_ ^ lr0) & ~1u) == 0) goto ret; A2C_LOCALRET(tt_); \
  A2C_TAILK(a2c_dispatch(tt_)); } while (0)
'''


class Translator:
    def __init__(self, vendor, symdir, extra=None):
        self.vendor = vendor
        self.syms = load_symbols(symdir, extra)
        self.listings = []
        self.fnaddr = {}    # (ovl or '', addr) -> cname of translated routines
        self.failed = {}

    def cname(self, ovl, addr):
        return f'a2c_ov{ovl}_{addr:08x}' if ovl else f'a2c_{addr:08x}'

    def known(self, ovl, t):
        t &= ~1
        if ovl and (ovl, t) in self.fnaddr:
            return self.fnaddr[(ovl, t)]
        return self.fnaddr.get(('', t))

    def load(self, only_files=None):
        raw = os.path.join(self.vendor, 'recon/tla/raw')
        paths = [os.path.join(raw, f) for f in sorted(os.listdir(raw)) if f.endswith('.s')]
        ovd = os.path.join(raw, 'overlays')
        paths += [os.path.join(ovd, f) for f in sorted(os.listdir(ovd)) if f.endswith('_overlay.s')]
        for p in paths:
            m = re.search(r'resource_([0-9a-f]+)_overlay\.s$', p)
            ovl = m.group(1) if m else ''
            try:
                self.listings.append(Listing(p, ovl, self.syms))
            except Unsupported as e:
                self.failed[os.path.basename(p)] = str(e)

    def routines(self):
        out = []
        for L in self.listings:
            fs = sorted(L.funcs, key=lambda f: f[1])
            # a routine ends at the next global label of the same listing (or the end of its section piece)
            ends = sorted(set([f[1] for f in fs] + [it[0] + 4 for it in L.items[-1:]]))
            maxa = max([it[0] for it in L.items] + [0]) + 4
            for name, addr, mode in fs:
                nxt = [e for e in ends if e > addr]
                end = min(nxt) if nxt else maxa
                # section pieces of overlays: stop at a gap in the items
                out.append((L, name, addr, mode, end))
        return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--vendor', default='vendor/alchemy')
    ap.add_argument('--symbols', default='port/symbols')
    ap.add_argument('-o', '--out', required=True)
    ap.add_argument('--only', help='comma-separated routine names (default: all)')
    ap.add_argument('--export', default='', help='routine names that get a wrapper u32 NAME(r0..r3, stack0..7)')
    ap.add_argument('--report')
    ap.add_argument('--extra-symbols', default='port_work/tla1/syms.txt')
    args = ap.parse_args()
    tr = Translator(args.vendor, args.symbols, args.extra_symbols)
    tr.load()
    rs = tr.routines()
    only = set(args.only.split(',')) if args.only else None
    sel, seen_at = [], set()
    for r in rs:  # aliases (two global labels at one address) translate once, under the first name
        if (only is None or r[1] in only) and (r[0].ovl, r[2]) not in seen_at:
            seen_at.add((r[0].ovl, r[2]))
            sel.append(r)
    for L, name, addr, mode, end in sel:
        tr.fnaddr[(L.ovl, addr)] = tr.cname(L.ovl, addr)
    bodies, report, ok = [], [], []
    # translate until stable: a routine that fails is dropped from the direct-call set
    for L, name, addr, mode, end in sel:
        f = Fn(tr, L, name, addr, mode, end)
        try:
            bodies.append(f.translate())
            ok.append((L, name, addr, mode))
            report.append((name, L.ovl, f'{addr:08x}', end - addr, 'ok', ''))
        except Unsupported as e:
            tr.fnaddr.pop((L.ovl, addr), None)
            report.append((name, L.ovl, f'{addr:08x}', end - addr, 'hand', str(e)))
    # routines whose direct calls point at a dropped routine are regenerated (they then use a2c_call)
    bodies = []
    for L, name, addr, mode in ok:
        end = [r[4] for r in sel if r[0] is L and r[2] == addr][0]
        bodies.append(Fn(tr, L, name, addr, mode, end).translate())
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, 'w') as o:
        o.write(HEADER)
        for L, name, addr, mode in ok:
            o.write(f'void {tr.cname(L.ovl, addr)}(void);\n')
        o.write('\n')
        for b in bodies:
            o.write('\n'.join(b) + '\n')
        # dispatch: every translated routine by GBA address (overlay routines by the loaded overlay)
        o.write('void a2c_dispatch(u32 t) {\n  switch (t & ~1u) {\n')
        byaddr = {}
        for L, name, addr, mode in ok:
            byaddr.setdefault(addr, []).append((L.ovl, tr.cname(L.ovl, addr)))
        for addr in sorted(byaddr):
            fns = byaddr[addr]
            mains = [c for ov, c in fns if not ov]
            ovs = [(ov, c) for ov, c in fns if ov]
            o.write(f'  case 0x{addr:x}u:')
            if ovs:
                o.write(' switch (a2c_overlay_current()) {')
                for ov, c in ovs:
                    o.write(f' case 0x{ov}: {c}(); return;')
                o.write(' default: break; }')
            if mains:
                o.write(f' {mains[0]}(); return;')
            o.write(' break;\n')
        o.write('  }\n  a2c_call(t);\n}\n')
        o.write('const struct { u32 addr; u32 overlay; void (*fn)(void); } a2c_codemap[] = {\n')
        for L, name, addr, mode in ok:
            o.write(f'  {{0x{addr | (1 if mode == "thumb" else 0):x}u, 0x{L.ovl or "0"}, {tr.cname(L.ovl, addr)}}}, /* {name} */\n')
        o.write('  {0, 0, 0}\n};\n')
        o.write(f'const unsigned a2c_codemap_count = {len(ok)};\n')
        exp = set(x for x in args.export.split(',') if x)
        for L, name, addr, mode in ok:
            if '*' not in exp and name not in exp:
                continue
            cn = tr.cname(L.ovl, addr)
            o.write(f'u32 a2cw{cn[3:]}(u32 ns, u32 a0, u32 a1, u32 a2, u32 a3, u32 s0, u32 s1, u32 s2, u32 s3, u32 s4, u32 s5, u32 s6, u32 s7) {{\n'
                    '  u32 a[12] = {a0, a1, a2, a3, s0, s1, s2, s3, s4, s5, s6, s7};\n' + f'  return a2c_enter_wrapped(ns, a, {cn});\n}}\n')
    if args.report:
        with open(args.report, 'w') as o:
            o.write('name\toverlay\taddr\tbytes\tresult\treason\n')
            for r in report:
                o.write('\t'.join(map(str, r)) + '\n')
            for k, v in tr.failed.items():
                o.write(f'{k}\t\t\t0\tfile\t{v}\n')
    nok = sum(1 for r in report if r[4] == 'ok')
    print(f'asm2c: {nok}/{len(report)} routines translated, {len(tr.failed)} listings unreadable -> {args.out}')


if __name__ == '__main__':
    main()
