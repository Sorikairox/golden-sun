// A small ARM7TDMI interpreter (ARMv4T: ARM and Thumb) for tests only (orchestrator D20). It runs the original
// routines' bytes from the player's ROM (or from where the game copies them, e.g. IWRAM) so that each hand port
// in C can be compared with the original on the same inputs (tests/arm/diff.cjs). Never shipped in the site.
//
// Memory is a flat Uint8Array: the game module's linear memory, where the GBA regions sit at their real
// addresses (orchestrator D5). Accesses outside the GBA regions and the interpreter's own stack throw.
// No timing, no pipeline effects beyond the architectural PC offsets (+8 ARM, +4 Thumb), no banked modes:
// tested routines run in one mode. Unimplemented instructions (coprocessor, SWP, user-bank LDM/STM, mode
// changes, undefined encodings) throw an Error naming the opcode and address.
'use strict';

const REGIONS = [
  [0x02000000, 0x02040000], // EWRAM
  [0x03000000, 0x03008000], // IWRAM
  [0x04000000, 0x04000400], // I/O
  [0x05000000, 0x05000400], // palette
  [0x06000000, 0x06018000], // VRAM
  [0x07000000, 0x07000400], // OAM
  [0x08000000, 0x0a000000], // ROM (32 MB window; the file is 8 MB)
  [0x0d000000, 0x0d100000], // the interpreter's stack and scratch (not a GBA region)
  [0x0e000000, 0x0e010000], // flash
];

const N = 0x80000000, Z = 0x40000000, C = 0x20000000, V = 0x10000000, T = 0x20;

class Arm7 {
  constructor(mem, opts = {}) {
    this.m = mem;
    this.dv = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
    this.r = new Uint32Array(16);
    this.cpsr = 0x1f; // system mode, ARM state
    this.spsr = 0;
    this.onSwi = opts.onSwi || ((n) => { throw new Error(`swi 0x${n.toString(16)} with no handler`); });
    this.onWrite = opts.onWrite || null; // (addr, size) after a store: lets a test catch I/O writes
    this.checkAccess = opts.checkAccess !== false;
    this.steps = 0;
    this.used = new Map(); // instruction class -> count (coverage report)
  }

  // ---- memory ----
  chk(a, size, what) {
    if (!this.checkAccess) return;
    for (const [lo, hi] of REGIONS) if (a >= lo && a + size <= hi) return;
    throw new Error(`${what} of ${size} at 0x${(a >>> 0).toString(16)} outside the GBA regions (pc 0x${this.cur.toString(16)})`);
  }
  r8(a) { a >>>= 0; this.chk(a, 1, 'read'); return this.m[a]; }
  r16(a) { a = (a & ~1) >>> 0; this.chk(a, 2, 'read'); return this.dv.getUint16(a, true); }
  r32(a) { a = (a & ~3) >>> 0; this.chk(a, 4, 'read'); return this.dv.getUint32(a, true); }
  w8(a, v) { a >>>= 0; this.chk(a, 1, 'write'); this.m[a] = v; if (this.onWrite) this.onWrite(a, 1); }
  w16(a, v) { a = (a & ~1) >>> 0; this.chk(a, 2, 'write'); this.dv.setUint16(a, v & 0xffff, true); if (this.onWrite) this.onWrite(a, 2); }
  w32(a, v) { a = (a & ~3) >>> 0; this.chk(a, 4, 'write'); this.dv.setUint32(a, v >>> 0, true); if (this.onWrite) this.onWrite(a, 4); }
  // ARM7 unaligned LDR: the aligned word rotated right by 8 * (address & 3)
  ldrWord(a) { const w = this.r32(a), s = (a & 3) * 8; return s ? ((w >>> s) | (w << (32 - s))) >>> 0 : w; }
  // ARM7 unaligned LDRH: the aligned halfword rotated right by 8
  ldrHalf(a) { const h = this.r16(a); return a & 1 ? ((h >>> 8) | (h << 24)) >>> 0 : h; }
  ldrSignedHalf(a) { if (a & 1) return (this.r8(a) << 24) >> 24 >>> 0; return (this.r16(a) << 16) >> 16 >>> 0; }

  // ---- flags ----
  get n() { return (this.cpsr & N) !== 0; }
  get z() { return (this.cpsr & Z) !== 0; }
  get c() { return (this.cpsr & C) !== 0; }
  get v() { return (this.cpsr & V) !== 0; }
  setNZ(x) { this.cpsr = (this.cpsr & ~(N | Z)) | (x & N) | (x === 0 ? Z : 0); }
  setC(b) { this.cpsr = b ? this.cpsr | C : this.cpsr & ~C; }
  setV(b) { this.cpsr = b ? this.cpsr | V : this.cpsr & ~V; }
  cond(cc) {
    switch (cc) {
      case 0: return this.z; case 1: return !this.z; case 2: return this.c; case 3: return !this.c;
      case 4: return this.n; case 5: return !this.n; case 6: return this.v; case 7: return !this.v;
      case 8: return this.c && !this.z; case 9: return !this.c || this.z;
      case 10: return this.n === this.v; case 11: return this.n !== this.v;
      case 12: return !this.z && this.n === this.v; case 13: return this.z || this.n !== this.v;
      case 14: return true;
      default: throw new Error(`condition 0xF (NV) at 0x${this.cur.toString(16)}`);
    }
  }
  add(a, b, carryIn, s) {
    const r = (a + b + carryIn) >>> 0;
    if (s) {
      this.setNZ(r);
      this.setC(a + b + carryIn > 0xffffffff);
      this.setV(((~(a ^ b) & (a ^ r)) & N) !== 0);
    }
    return r;
  }
  sub(a, b, carryIn, s) { // a - b - !carryIn
    const r = (a - b - (carryIn ? 0 : 1)) >>> 0;
    if (s) {
      this.setNZ(r);
      this.setC(a >= b + (carryIn ? 0 : 1)); // no borrow
      this.setV((((a ^ b) & (a ^ r)) & N) !== 0);
    }
    return r;
  }
  // shift by an amount; returns [value, carry]. imm: the immediate-shift encodings (#0 special cases)
  shift(type, val, amt, imm) {
    const c = this.c;
    if (imm) {
      if (amt === 0) {
        if (type === 0) return [val, c];
        if (type === 1) return [0, (val & N) !== 0];
        if (type === 2) return [(val & N) ? 0xffffffff : 0, (val & N) !== 0];
        return [((c ? N : 0) | (val >>> 1)) >>> 0, (val & 1) !== 0]; // RRX
      }
    } else if (amt === 0) return [val, c];
    switch (type) {
      case 0: // LSL
        if (amt < 32) return [(val << amt) >>> 0, ((val >>> (32 - amt)) & 1) !== 0];
        if (amt === 32) return [0, (val & 1) !== 0];
        return [0, false];
      case 1: // LSR
        if (amt < 32) return [val >>> amt, ((val >>> (amt - 1)) & 1) !== 0];
        if (amt === 32) return [0, (val & N) !== 0];
        return [0, false];
      case 2: // ASR
        if (amt < 32) return [(val >> amt) >>> 0, ((val >> (amt - 1)) & 1) !== 0];
        return [(val & N) ? 0xffffffff : 0, (val & N) !== 0];
      default: { // ROR
        const k = amt & 31;
        if (k === 0) return [val, (val & N) !== 0];
        const r = ((val >>> k) | (val << (32 - k))) >>> 0;
        return [r, (r & N) !== 0];
      }
    }
  }
  note(k) { this.used.set(k, (this.used.get(k) || 0) + 1); }

  get thumb() { return (this.cpsr & T) !== 0; }
  // jump with interworking (BX): bit 0 selects Thumb
  bx(a) {
    if (a & 1) { this.cpsr |= T; this.r[15] = (a & ~1) >>> 0; } else { this.cpsr &= ~T; this.r[15] = (a & ~3) >>> 0; }
  }

  // Call a routine at `addr` (bit 0 = Thumb) with up to four register arguments plus stack arguments; returns
  // when it returns to the sentinel in lr. Returns r0 (and leaves all registers in this.r).
  call(addr, args = [], { sp = 0x0d0ff000, stackArgs = [], maxSteps = 50_000_000, regs = {} } = {}) {
    const RET = 0x0d0ffff0;
    this.r.fill(0);
    for (let i = 0; i < 4 && i < args.length; i++) this.r[i] = args[i] >>> 0;
    for (const [k, v] of Object.entries(regs)) this.r[+k] = v >>> 0;
    let s = sp;
    for (let i = stackArgs.length - 1; i >= 0; i--) { s -= 4; this.dv.setUint32(s, stackArgs[i] >>> 0, true); }
    this.r[13] = s;
    this.r[14] = RET;
    this.cpsr = 0x1f;
    this.bx(addr);
    const limit = this.steps + maxSteps;
    while (this.r[15] !== RET) {
      if (this.steps++ > limit) throw new Error(`routine at 0x${addr.toString(16)} did not return in ${maxSteps} steps`);
      if (this.thumb) this.stepThumb(); else this.stepArm();
    }
    return this.r[0];
  }

  // ---------------- ARM ----------------
  stepArm() {
    const pc = this.r[15];
    this.cur = pc;
    const op = this.r32(pc);
    this.r[15] = pc + 4;
    if (!this.cond(op >>> 28)) return;
    const reg = (i) => (i === 15 ? pc + 8 : this.r[i]) >>> 0;
    const bits = (op >>> 25) & 7;
    const unimpl = (what) => { throw new Error(`ARM ${what} 0x${(op >>> 0).toString(16).padStart(8, '0')} at 0x${pc.toString(16)} not implemented`); };

    if ((op & 0x0ffffff0) === 0x012fff10) { this.note('arm bx'); this.bx(reg(op & 15)); return; }
    if (bits === 0 && (op & 0x90) === 0x90) {
      // multiplies, swp, halfword/signed transfers
      const sh = (op >>> 5) & 3;
      if (sh === 0) {
        if ((op & 0x0fc000f0) === 0x00000090) { // MUL/MLA
          this.note('arm mul');
          const rd = (op >>> 16) & 15, rn = (op >>> 12) & 15, rs = (op >>> 8) & 15, rm = op & 15;
          let r = Math.imul(this.r[rm], this.r[rs]) >>> 0;
          if (op & (1 << 21)) r = (r + this.r[rn]) >>> 0;
          this.r[rd] = r;
          if (op & (1 << 20)) this.setNZ(r);
          return;
        }
        if ((op & 0x0f8000f0) === 0x00800090) { // UMULL/UMLAL/SMULL/SMLAL
          this.note('arm mull');
          const hi = (op >>> 16) & 15, lo = (op >>> 12) & 15, rs = (op >>> 8) & 15, rm = op & 15;
          const signed = (op & (1 << 22)) !== 0;
          let p = signed ? BigInt.asIntN(32, BigInt(this.r[rm])) * BigInt.asIntN(32, BigInt(this.r[rs]))
            : BigInt(this.r[rm]) * BigInt(this.r[rs]);
          if (op & (1 << 21)) p += (BigInt(this.r[hi]) << 32n) | BigInt(this.r[lo]);
          p = BigInt.asUintN(64, p);
          this.r[lo] = Number(p & 0xffffffffn);
          this.r[hi] = Number(p >> 32n);
          if (op & (1 << 20)) { this.cpsr = (this.cpsr & ~(N | Z)) | (this.r[hi] & N) | (p === 0n ? Z : 0); }
          return;
        }
        unimpl('swp');
      }
      // halfword and signed transfers
      this.note('arm ldrh/strh');
      const P = op & (1 << 24), U = op & (1 << 23), I = op & (1 << 22), W = op & (1 << 21), L = op & (1 << 20);
      const rn = (op >>> 16) & 15, rd = (op >>> 12) & 15;
      const off = I ? (((op >>> 4) & 0xf0) | (op & 15)) : this.r[op & 15];
      const base = reg(rn);
      const addr = P ? (U ? base + off : base - off) >>> 0 : base;
      let val;
      if (L) {
        if (sh === 1) val = this.ldrHalf(addr);
        else if (sh === 2) val = (this.r8(addr) << 24) >> 24 >>> 0;
        else val = this.ldrSignedHalf(addr);
      } else {
        if (sh !== 1) unimpl('ldrd/strd');
        this.w16(addr, rd === 15 ? pc + 12 : this.r[rd]);
      }
      if (!P) this.r[rn] = (U ? base + off : base - off) >>> 0;
      else if (W) this.r[rn] = addr;
      if (L) { if (rd === 15) unimpl('ldrh pc'); this.r[rd] = val; }
      return;
    }
    if (bits <= 1) {
      // PSR transfers
      if ((op & 0x0fbf0fff) === 0x010f0000) { this.note('arm mrs'); this.r[(op >>> 12) & 15] = (op & (1 << 22)) ? this.spsr : this.cpsr; return; }
      if ((op & 0x0db0f000) === 0x0120f000) {
        this.note('arm msr');
        let v;
        if (op & (1 << 25)) { const rot = ((op >>> 8) & 15) * 2, imm = op & 0xff; v = rot ? ((imm >>> rot) | (imm << (32 - rot))) >>> 0 : imm; } else v = this.r[op & 15];
        let mask = 0;
        if (op & (1 << 19)) mask |= 0xff000000;
        if (op & (1 << 16)) mask |= 0xff;
        if (op & (1 << 22)) { this.spsr = ((this.spsr & ~mask) | (v & mask)) >>> 0; return; }
        if ((mask & 0xff) && ((v & 0x3f) !== (this.cpsr & 0x3f))) unimpl('msr changing mode or state');
        this.cpsr = ((this.cpsr & ~mask) | (v & mask)) >>> 0;
        return;
      }
      // data processing
      const opc = (op >>> 21) & 15, S = (op & (1 << 20)) !== 0, rn = (op >>> 16) & 15, rd = (op >>> 12) & 15;
      let b, sc;
      if (op & (1 << 25)) {
        const rot = ((op >>> 8) & 15) * 2, imm = op & 0xff;
        b = rot ? ((imm >>> rot) | (imm << (32 - rot))) >>> 0 : imm;
        sc = rot ? (b & N) !== 0 : this.c;
      } else {
        const type = (op >>> 5) & 3, rm = op & 15;
        if (op & 0x10) { // register-specified shift: pc reads as +12
          const amt = this.r[(op >>> 8) & 15] & 0xff;
          const vm = rm === 15 ? pc + 12 : this.r[rm];
          [b, sc] = this.shift(type, vm >>> 0, amt, false);
        } else [b, sc] = this.shift(type, reg(rm), (op >>> 7) & 31, true);
      }
      const a = (rn === 15 && !(op & (1 << 25)) && (op & 0x10)) ? pc + 12 : reg(rn);
      let r, write = true;
      const logical = (x) => { if (S) { this.setNZ(x); this.setC(sc); } return x; };
      this.note('arm dp');
      switch (opc) {
        case 0: r = logical((a & b) >>> 0); break;
        case 1: r = logical((a ^ b) >>> 0); break;
        case 2: r = this.sub(a, b, 1, S); break;
        case 3: r = this.sub(b, a, 1, S); break;
        case 4: r = this.add(a, b, 0, S); break;
        case 5: r = this.add(a, b, this.c ? 1 : 0, S); break;
        case 6: r = this.sub(a, b, this.c, S); break;
        case 7: r = this.sub(b, a, this.c, S); break;
        case 8: logical((a & b) >>> 0); write = false; break;
        case 9: logical((a ^ b) >>> 0); write = false; break;
        case 10: this.sub(a, b, 1, true); write = false; break;
        case 11: this.add(a, b, 0, true); write = false; break;
        case 12: r = logical((a | b) >>> 0); break;
        case 13: r = logical(b); break;
        case 14: r = logical((a & ~b) >>> 0); break;
        default: r = logical((~b) >>> 0); break;
      }
      if (!S && !write) unimpl('psr/compare without S');
      if (write) {
        if (rd === 15) { if (S) unimpl('data processing to pc with S'); this.r[15] = (r & ~3) >>> 0; } else this.r[rd] = r;
      }
      return;
    }
    if (bits === 2 || bits === 3) {
      if (bits === 3 && (op & 0x10)) unimpl('undefined');
      this.note('arm ldr/str');
      const P = op & (1 << 24), U = op & (1 << 23), B = op & (1 << 22), W = op & (1 << 21), L = op & (1 << 20);
      const rn = (op >>> 16) & 15, rd = (op >>> 12) & 15;
      let off;
      if (bits === 2) off = op & 0xfff;
      else off = this.shift((op >>> 5) & 3, reg(op & 15), (op >>> 7) & 31, true)[0];
      const base = reg(rn);
      const addr = P ? (U ? base + off : base - off) >>> 0 : base;
      if (!P && W) unimpl('ldrt/strt');
      let val;
      if (L) val = B ? this.r8(addr) : this.ldrWord(addr);
      else { const s = rd === 15 ? pc + 12 : this.r[rd]; if (B) this.w8(addr, s & 0xff); else this.w32(addr, s); }
      if (!P) this.r[rn] = (U ? base + off : base - off) >>> 0;
      else if (W) this.r[rn] = addr;
      if (L) { if (rd === 15) this.r[15] = (val & ~3) >>> 0; else this.r[rd] = val; }
      return;
    }
    if (bits === 4) {
      this.note('arm ldm/stm');
      const P = (op & (1 << 24)) !== 0, U = (op & (1 << 23)) !== 0, S = op & (1 << 22), W = op & (1 << 21), L = op & (1 << 20);
      const rn = (op >>> 16) & 15, list = op & 0xffff;
      if (S) unimpl('ldm/stm with ^');
      if (!list) unimpl('ldm/stm with an empty list');
      this.blockTransfer(rn, list, P, U, W, L, pc + 12);
      return;
    }
    if (bits === 5) {
      this.note('arm b/bl');
      const off = (op << 8) >> 6;
      if (op & (1 << 24)) this.r[14] = pc + 4;
      this.r[15] = (pc + 8 + off) >>> 0;
      return;
    }
    if (bits === 7 && (op & (1 << 24))) {
      this.note('arm swi');
      this.r[15] = pc + 4;
      this.onSwi((op >>> 16) & 0xff, this);
      return;
    }
    unimpl('coprocessor');
  }

  // LDM/STM (ARM) with ARM7 rules for the base in the list
  blockTransfer(rn, list, P, U, W, L, pcStoreValue) {
    const count = popcount(list);
    const base = this.r[rn];
    // lowest address: IA = base, IB = base + 4, DA = base - 4n + 4, DB = base - 4n
    const start = (U ? base + (P ? 4 : 0) : base - 4 * count + (P ? 0 : 4)) >>> 0;
    const newBase = (U ? base + 4 * count : base - 4 * count) >>> 0;
    let a = start;
    const firstInList = list & -list;
    for (let i = 0; i < 16; i++) {
      if (!(list & (1 << i))) continue;
      if (L) {
        const v = this.r32(a);
        if (i === 15) this.r[15] = (v & ~3) >>> 0; else this.r[i] = v;
      } else {
        let v = i === 15 ? pcStoreValue : this.r[i];
        if (i === rn && W && (1 << i) !== firstInList) v = newBase;
        this.w32(a, v);
      }
      a = (a + 4) >>> 0;
    }
    if (W && !(L && (list & (1 << rn)))) this.r[rn] = newBase;
  }

  // ---------------- Thumb ----------------
  stepThumb() {
    const pc = this.r[15];
    this.cur = pc;
    const op = this.r16(pc);
    this.r[15] = pc + 2;
    const r = this.r;
    const unimpl = (what) => { throw new Error(`Thumb ${what} 0x${op.toString(16).padStart(4, '0')} at 0x${pc.toString(16)} not implemented`); };
    const top = op >>> 13;
    if (top === 0) {
      if (((op >>> 11) & 3) === 3) { // add/sub
        this.note('thumb add/sub');
        const rd = op & 7, rs = (op >>> 3) & 7, n = (op >>> 6) & 7;
        const b = (op & 0x400) ? n : r[n];
        r[rd] = (op & 0x200) ? this.sub(r[rs], b, 1, true) : this.add(r[rs], b, 0, true);
        return;
      }
      this.note('thumb shift imm');
      const [v, c] = this.shift((op >>> 11) & 3, r[(op >>> 3) & 7], (op >>> 6) & 31, true);
      r[op & 7] = v; this.setNZ(v); this.setC(c);
      return;
    }
    if (top === 1) {
      this.note('thumb imm');
      const rd = (op >>> 8) & 7, imm = op & 0xff;
      switch ((op >>> 11) & 3) {
        case 0: r[rd] = imm; this.setNZ(imm); break;
        case 1: this.sub(r[rd], imm, 1, true); break;
        case 2: r[rd] = this.add(r[rd], imm, 0, true); break;
        default: r[rd] = this.sub(r[rd], imm, 1, true); break;
      }
      return;
    }
    if ((op >>> 10) === 0x10) { // ALU
      this.note('thumb alu');
      const rd = op & 7, rs = (op >>> 3) & 7;
      const a = r[rd], b = r[rs];
      let v, c;
      switch ((op >>> 6) & 15) {
        case 0: r[rd] = (a & b) >>> 0; this.setNZ(r[rd]); break;
        case 1: r[rd] = (a ^ b) >>> 0; this.setNZ(r[rd]); break;
        case 2: [v, c] = this.shift(0, a, b & 0xff, false); r[rd] = v; this.setNZ(v); this.setC(c); break;
        case 3: [v, c] = this.shift(1, a, b & 0xff, false); r[rd] = v; this.setNZ(v); this.setC(c); break;
        case 4: [v, c] = this.shift(2, a, b & 0xff, false); r[rd] = v; this.setNZ(v); this.setC(c); break;
        case 5: r[rd] = this.add(a, b, this.c ? 1 : 0, true); break;
        case 6: r[rd] = this.sub(a, b, this.c, true); break;
        case 7: [v, c] = this.shift(3, a, b & 0xff, false); r[rd] = v; this.setNZ(v); this.setC(c); break;
        case 8: this.setNZ((a & b) >>> 0); break;
        case 9: r[rd] = this.sub(0, b, 1, true); break;
        case 10: this.sub(a, b, 1, true); break;
        case 11: this.add(a, b, 0, true); break;
        case 12: r[rd] = (a | b) >>> 0; this.setNZ(r[rd]); break;
        case 13: r[rd] = Math.imul(a, b) >>> 0; this.setNZ(r[rd]); break;
        case 14: r[rd] = (a & ~b) >>> 0; this.setNZ(r[rd]); break;
        default: r[rd] = (~b) >>> 0; this.setNZ(r[rd]); break;
      }
      return;
    }
    if ((op >>> 10) === 0x11) { // hi register ops / BX
      const opc = (op >>> 8) & 3, rd = (op & 7) | ((op >>> 4) & 8), rs = (op >>> 3) & 15;
      const val = (i) => (i === 15 ? pc + 4 : r[i]) >>> 0;
      if (opc === 3) { this.note('thumb bx'); this.bx(val(rs)); return; }
      this.note('thumb hireg');
      if (opc === 0) { const v = (val(rd) + val(rs)) >>> 0; if (rd === 15) r[15] = v & ~1; else r[rd] = v; }
      else if (opc === 1) this.sub(val(rd), val(rs), 1, true);
      else { const v = val(rs); if (rd === 15) r[15] = (v & ~1) >>> 0; else r[rd] = v; }
      return;
    }
    if ((op >>> 11) === 9) { this.note('thumb ldr pc'); r[(op >>> 8) & 7] = this.r32(((pc + 4) & ~3) + (op & 0xff) * 4); return; }
    if ((op >>> 12) === 5) { // load/store register offset
      this.note('thumb ldr/str reg');
      const rd = op & 7, a = (r[(op >>> 3) & 7] + r[(op >>> 6) & 7]) >>> 0;
      switch ((op >>> 9) & 7) {
        case 0: this.w32(a, r[rd]); break;
        case 1: this.w16(a, r[rd]); break;
        case 2: this.w8(a, r[rd] & 0xff); break;
        case 3: r[rd] = (this.r8(a) << 24) >> 24 >>> 0; break;
        case 4: r[rd] = this.ldrWord(a); break;
        case 5: r[rd] = this.ldrHalf(a); break;
        case 6: r[rd] = this.r8(a); break;
        default: r[rd] = this.ldrSignedHalf(a); break;
      }
      return;
    }
    if (top === 3) { // load/store immediate offset
      this.note('thumb ldr/str imm');
      const rd = op & 7, base = r[(op >>> 3) & 7], off = (op >>> 6) & 31;
      const B = op & 0x1000, L = op & 0x800;
      const a = (base + (B ? off : off * 4)) >>> 0;
      if (L) r[rd] = B ? this.r8(a) : this.ldrWord(a); else if (B) this.w8(a, r[rd] & 0xff); else this.w32(a, r[rd]);
      return;
    }
    if ((op >>> 12) === 8) { // halfword
      this.note('thumb ldrh/strh imm');
      const rd = op & 7, a = (r[(op >>> 3) & 7] + ((op >>> 6) & 31) * 2) >>> 0;
      if (op & 0x800) r[rd] = this.ldrHalf(a); else this.w16(a, r[rd]);
      return;
    }
    if ((op >>> 12) === 9) { // SP-relative
      this.note('thumb sp ldr/str');
      const rd = (op >>> 8) & 7, a = (r[13] + (op & 0xff) * 4) >>> 0;
      if (op & 0x800) r[rd] = this.ldrWord(a); else this.w32(a, r[rd]);
      return;
    }
    if ((op >>> 12) === 10) { // load address
      this.note('thumb add pc/sp');
      r[(op >>> 8) & 7] = ((op & 0x800) ? r[13] : ((pc + 4) & ~3)) + (op & 0xff) * 4 >>> 0;
      return;
    }
    if ((op >>> 8) === 0xb0) { this.note('thumb add sp'); const o = (op & 0x7f) * 4; r[13] = (op & 0x80) ? r[13] - o >>> 0 : r[13] + o >>> 0; return; }
    if ((op & 0xf600) === 0xb400) { // push/pop
      this.note('thumb push/pop');
      const list = op & 0xff, R = op & 0x100;
      if (op & 0x800) { // pop
        let a = r[13];
        for (let i = 0; i < 8; i++) if (list & (1 << i)) { r[i] = this.r32(a); a += 4; }
        if (R) { r[15] = this.r32(a) & ~1; a += 4; }
        r[13] = a >>> 0;
      } else {
        const n = popcount(list) + (R ? 1 : 0);
        if (!n) unimpl('push with an empty list');
        let a = (r[13] - 4 * n) >>> 0;
        r[13] = a;
        for (let i = 0; i < 8; i++) if (list & (1 << i)) { this.w32(a, r[i]); a += 4; }
        if (R) this.w32(a, r[14]);
      }
      return;
    }
    if ((op >>> 12) === 12) { // ldmia/stmia
      this.note('thumb ldm/stm');
      const rb = (op >>> 8) & 7, list = op & 0xff;
      if (!list) unimpl('ldm/stm with an empty list');
      this.blockTransfer(rb, list, false, true, true, (op & 0x800) !== 0, 0);
      return;
    }
    if ((op >>> 12) === 13) {
      const cc = (op >>> 8) & 15;
      if (cc === 15) { this.note('thumb swi'); this.onSwi(op & 0xff, this); return; }
      if (cc === 14) unimpl('undefined');
      this.note('thumb bcc');
      if (this.cond(cc)) r[15] = (pc + 4 + (((op & 0xff) << 24) >> 23)) >>> 0;
      return;
    }
    if ((op >>> 11) === 0x1c) { this.note('thumb b'); r[15] = (pc + 4 + (((op & 0x7ff) << 21) >> 20)) >>> 0; return; }
    if ((op >>> 11) === 0x1e) { this.note('thumb bl'); r[14] = (pc + 4 + (((op & 0x7ff) << 21) >> 9)) >>> 0; return; }
    if ((op >>> 11) === 0x1f) {
      this.note('thumb bl');
      const t = (r[14] + (op & 0x7ff) * 2) >>> 0;
      r[14] = (pc + 2) | 1;
      r[15] = t & ~1;
      return;
    }
    unimpl('undefined');
  }
}

function popcount(x) { let n = 0; while (x) { x &= x - 1; n++; } return n; }

module.exports = { Arm7, REGIONS };
