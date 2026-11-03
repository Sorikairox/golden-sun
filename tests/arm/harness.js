// Differential test harness (orchestrator D20): runs an original routine's ARM/Thumb bytes from the player's ROM
// in the test interpreter (arm7.js) and our C port (exported from game.wasm) on the same inputs and memory,
// then compares the results and every byte of the GBA's RAM regions. Shared by tests/arm/diff.cjs.
'use strict';
const fs = require('fs');
const path = require('path');
const { Arm7 } = require('./arm7');

const ROOT = path.resolve(__dirname, '../..');
// regions compared after each call (the interpreter's stack at 0x0D000000 and the wasm stack are not)
const RAM = [[0x02000000, 0x40000], [0x03000000, 0x8000], [0x04000000, 0x400], [0x05000000, 0x400],
  [0x06000000, 0x18000], [0x07000000, 0x400], [0x0e000000, 0x10000]];

function symbols() {
  const map = new Map();
  for (const line of fs.readFileSync(path.join(ROOT, 'port/symbols/tbs-en.tsv'), 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const f = line.split('\t');
    if (f[1] && f[1].startsWith('0x')) map.set(f[0], { addr: parseInt(f[1], 16), load: f[2] ? parseInt(f[2], 16) : 0, size: +f[3], kind: f[4] });
  }
  return map;
}

// TLA (TLA3): port/symbols/tla-en.tsv (name address size ...), then the reference build's full list for bss and
// linker-script symbols (port_work/tla1/syms.txt, gitignored; absent symbols just stay unknown)
function symbolsTla() {
  const map = new Map();
  for (const line of fs.readFileSync(path.join(ROOT, 'port/symbols/tla-en.tsv'), 'utf8').split('\n')) {
    const f = line.split('\t');
    if (f.length > 2 && /^[0-9a-f]{8}$/.test(f[1]) && !map.has(f[0])) map.set(f[0], { addr: parseInt(f[1], 16), size: +f[2], kind: f[3] });
  }
  const extra = path.join(ROOT, 'port_work/tla1/syms.txt');
  if (fs.existsSync(extra)) {
    for (const line of fs.readFileSync(extra, 'utf8').split('\n')) {
      const f = line.split(' ');
      if (f.length > 1 && /^[0-9a-f]{8}$/.test(f[1]) && !map.has(f[0])) map.set(f[0], { addr: parseInt(f[1], 16), size: +f[2], kind: f[3] });
    }
  }
  return map;
}

// xorshift32: deterministic inputs (no Math.random: runs are repeatable)
function rng(seed) {
  let x = seed >>> 0 || 1;
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
  next.range = (lo, hi) => lo + (next() % (hi - lo + 1));
  next.pick = (a) => a[next() % a.length];
  return next;
}

async function load(gameJs, romPath) {
  const factory = require(path.resolve(gameJs));
  const m = await factory({ print: () => {}, printErr: () => {} });
  const rom = fs.readFileSync(romPath);
  m.HEAPU8.set(rom, 0x08000000);
  return m;
}

class Harness {
  constructor(m, opts = {}) {
    this.m = m;
    this.mem = m.HEAPU8;
    this.sym = opts.game === 'tla' ? symbolsTla() : symbols();
    this.cpu = new Arm7(this.mem, { onSwi: (n, cpu) => this.swi(n, cpu) });
    this.verbose = opts.verbose;
    if (opts.game === 'tla') {
      // TLA's System_InstallIwramAndIrqs DMAs 0x400 words from IwramResident_Rom to IwramIrqMain
      this.mem.copyWithin(this.addr('IwramIrqMain'), this.addr('IwramResident_Rom'), this.addr('IwramResident_Rom') + 4096);
    } else {
      // the resident IWRAM code, copied as System_InstallIwramAndIrqs does (5120 bytes)
      // (IwramResident_Rom starts at IwramIrqMain's load address)
      const r = this.sym.get('IwramIrqMain');
      this.mem.copyWithin(0x03000000, r.load, r.load + 5120);
    }
  }
  addr(name) { const s = this.sym.get(name); if (!s) throw new Error(`no symbol ${name}`); return s.addr; }
  // BIOS calls made by original code, from GBATEK (an independent reference for the C versions in bios.c)
  swi(n, cpu) {
    const r = cpu.r;
    if (n === 0x0b) { // CpuSet
      let s = r[0], d = r[1];
      const count = r[2] & 0x1fffff, fixed = (r[2] >>> 24) & 1, words = (r[2] >>> 26) & 1;
      const unit = words ? 4 : 2;
      s &= ~(unit - 1); d &= ~(unit - 1);
      for (let i = 0; i < count; i++) {
        if (words) cpu.w32(d, cpu.r32(s)); else cpu.w16(d, cpu.r16(s));
        d += unit; if (!fixed) s += unit;
      }
      return;
    }
    if (n === 0x19) { // SoundBias: ramp the level (bits 1-9) to 0x200 or 0
      const b = cpu.r16(0x04000088);
      cpu.w16(0x04000088, (b & ~0x3fe) | (r[0] ? 0x200 : 0));
      return;
    }
    throw new Error(`swi 0x${n.toString(16)} not in the harness BIOS`);
  }
  snapshot() { return RAM.map(([a, n]) => this.mem.slice(a, a + n)); }
  restore(s) { RAM.forEach(([a], i) => this.mem.set(s[i], a)); }
  diff(a, b) {
    for (let i = 0; i < RAM.length; i++) {
      if (Buffer.compare(a[i], b[i]) === 0) continue;
      const x = a[i], y = b[i];
      let k = 0; while (x[k] === y[k]) k++;
      let n = 0; for (let j = k; j < x.length; j++) if (x[j] !== y[j]) n++;
      return `memory differs at 0x${(RAM[i][0] + k).toString(16)}: original ${x[k]} port ${y[k]} (${n} bytes differ)`;
    }
    return null;
  }
  // One case: spec.orig (GBA address, |1 for Thumb), spec.port (exported name; spec.call, a JS function, calls
  // it instead, e.g. Port_CallCode4 for vendor C), args, returns ('u32'|'none'), spec.sp (the original's stack top),
  // spec.stopAt (the original also ends when the pc gets there: an entry routine's call out), checkMemory. Returns null if equal, else a description.
  compare(spec, args, { checkMemory = true, stackArgs = [] } = {}) {
    const before = checkMemory ? this.snapshot() : null;
    let ro, rp, err;
    try { ro = this.cpu.call(spec.orig, args, { stackArgs, ...(spec.sp ? { sp: spec.sp } : {}), ...(spec.stopAt ? { stopAt: spec.stopAt } : {}) }) >>> 0; } catch (e) { err = 'original: ' + e.message; }
    const afterOrig = checkMemory ? this.snapshot() : null;
    if (checkMemory) this.restore(before);
    try { rp = (spec.call ? spec.call(...args, ...stackArgs) : this.m['_' + spec.port](...args, ...stackArgs)) >>> 0; } catch (e) { err = err || 'port: ' + e.message; }
    if (err) return err;
    if (spec.returns !== 'none' && ro !== rp) return `result original 0x${ro.toString(16)} port 0x${rp.toString(16)}`;
    if (checkMemory) {
      const afterPort = this.snapshot();
      // spec.ignore: [[address, bytes]] the original writes into its own RAM copy (caches): not compared
      for (const [a, n] of spec.ignore || []) {
        const i = RAM.findIndex(([b, m]) => a >= b && a + n <= b + m);
        afterOrig[i].fill(0, a - RAM[i][0], a - RAM[i][0] + n); afterPort[i].fill(0, a - RAM[i][0], a - RAM[i][0] + n);
      }
      const d = this.diff(afterOrig, afterPort);
      if (d) return d;
    }
    return null;
  }
}

module.exports = { Harness, load, rng, symbols, symbolsTla, ROOT };
