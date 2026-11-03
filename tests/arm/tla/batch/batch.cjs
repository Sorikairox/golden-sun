// D20 batch over every asm2c translation (TLA5): the same differential test as tests/arm/tla/diff_tla.cjs (the
// original's bytes from the TLA ROM in arm7.js against the translation in build/a2c/a2c_test.wasm, r0 and all GBA
// RAM compared), with more input generators. A routine is tried under each world profile in turn until one gives
// inputs the original can run (TLA3's generic world gave 200 EQUIV, 1,002 NOINPUT):
//   generic  RAM words mostly small numbers and pointers into RAM; four random argument words (TLA3's)
//   ptr      RAM words mostly EWRAM pointers; arguments pointers
//   deep     every RAM word a pointer to a 256-byte aligned EWRAM block (offsets below 0x100 stay inside), so
//            pointer chains of any depth resolve; arguments pointers or small numbers
//   struct   EWRAM blocks of small numbers, every IWRAM global word a pointer to one (the game's globals point
//            to heap structures); arguments pointers to blocks, then small numbers
// Usage: node tests/arm/tla/batch/batch.cjs [SHARD/COUNT]  (tests/arm/tla/batch/run.sh runs the shards and merges)
// Env: ROM, CASES (cases per routine, 8), TRIES (inputs per profile, 12), TMAX (ms per routine, 15000), YIELDS (4).
'use strict';
const fs = require('fs');
const path = require('path');
const { Harness, load, rng, ROOT } = require('../../harness');

const ROM = process.env.ROM || path.join(process.env.HOME, 'roms/Golden_Sun_The_Lost_Age_USA_Europe.gba');
const MOD = path.join(ROOT, 'build/a2c/a2c_test.js');
const EW = 0x02000000, EWN = 0x40000, IW = 0x03001100, IWN = 0x7e00 - 0x1100;
const ARM_ROUTINES = new Set(['Func_080212dc', 'Func_08021470']);

function readReport() {
  const rows = [];
  for (const line of fs.readFileSync(path.join(ROOT, 'build/a2c/a2c_test.report.tsv'), 'utf8').split('\n').slice(1)) {
    const f = line.split('\t');
    if (f.length < 5 || f[4] !== 'ok') continue;
    rows.push({ name: f[0], ovl: f[1], addr: parseInt(f[2], 16), bytes: +f[3] });
  }
  return rows;
}

async function main() {
  const [shard, count] = (process.argv[2] || '0/1').split('/').map(Number);
  const m = await load(MOD, ROM);
  const h = new Harness(m, { game: 'tla' });
  const mem = h.mem, cpu = h.cpu;
  const dv = new DataView(mem.buffer);
  const R = rng(0x7a3 + shard);
  const regs = m._a2c_regs_addr();
  // `wait` returns at once and the YIELDS-th yield stops both runs (trap 57, as diff_tla.cjs)
  const WAIT = h.addr('wait') & ~1;
  const YIELDS = +(process.env.YIELDS || 4);
  let yieldsLeft = YIELDS;
  // code runs only from the ROM, the resident IWRAM block and the loaded overlay: a jump into data (a random word
  // used as a code pointer) is an input the original cannot run, not a case (it executed garbage)
  let ovlLoaded = false;
  const notCode = (pc) => !(pc >= 0x08000000 && pc < 0x0a000000) && !(pc >= 0x03000000 && pc < 0x03001100) && !(pc >= 0x0d000000 && pc < 0x0d100000) &&
    !(ovlLoaded && pc >= 0x02008000 && pc < 0x02010000);
  const stepA = cpu.stepArm.bind(cpu);
  cpu.stepArm = () => { if (notCode(cpu.r[15])) throw new Error(`executes data at 0x${cpu.r[15].toString(16)}`); stepA(); };
  const stepT = cpu.stepThumb.bind(cpu);
  cpu.stepThumb = () => {
    if (notCode(cpu.r[15])) throw new Error(`executes data at 0x${cpu.r[15].toString(16)}`);
    if (cpu.r[15] === WAIT) {
      if (--yieldsLeft <= 0) { const e = new Error('yield limit'); e.yieldStop = true; throw e; }
      cpu.bx(cpu.r[14]); return;
    }
    stepT();
  };
  let depth = 0;
  m.a2cCall = (addr) => {
    const r = []; for (let i = 0; i < 16; i++) r.push(dv.getUint32(regs + 4 * i, true));
    const saved = { r: cpu.r.slice(), cpsr: cpu.cpsr };
    if (depth++ > 0) throw new Error('nested interpreter call');
    try {
      const rr = {}; for (let i = 4; i <= 12; i++) rr[i] = r[i];
      cpu.call(addr >>> 0, r.slice(0, 4), { sp: r[13], regs: rr, maxSteps: 5_000_000 });
    } finally { depth--; }
    for (let i = 0; i <= 12; i++) dv.setUint32(regs + 4 * i, cpu.r[i], true);
    cpu.r.set(saved.r); cpu.cpsr = saved.cpsr;
  };
  const ovlCache = new Map();
  const loadOverlay = (id) => {
    if (!ovlCache.has(id)) {
      const f = path.join(ROOT, `port_work/tla1/overlays/resource_${id}.bin`);
      ovlCache.set(id, fs.existsSync(f) ? fs.readFileSync(f) : null);
    }
    return ovlCache.get(id);
  };
  const small = () => R() & 15;
  const ewptr = () => (EW + (R() % (EWN - 0x2000))) & ~3;
  const block = () => (EW + 0x100 * (R() % ((EWN - 0x2000) >> 8))) >>> 0;
  const PROFILES = {
    generic: {
      word: () => { const k = R() & 7; if (k < 3) return small(); if (k < 5) return (EW + (R() % (EWN - 0x100))) & ~3;
        if (k === 5) return (IW + (R() % IWN)) & ~3; if (k === 6) return R() & 0xffff; return R(); },
      args(w) { return [w(), w(), w(), w()]; },
    },
    ptr: {
      word: () => { if ((R() & 7) < 6) return ewptr(); return small(); },
      args() { return [ewptr(), ewptr(), ewptr(), ewptr()]; },
    },
    deep: {
      word: () => block(),
      args() { const k = R() & 3; return [block(), k & 1 ? small() : block(), k & 2 ? small() : block(), small()]; },
    },
    struct: {
      fill() {
        for (let i = 0; i < EWN; i += 4) dv.setUint32(EW + i, (R() & 3) ? small() : block(), true);
        for (let i = 0; i < IWN; i += 4) dv.setUint32(IW + i, block(), true);
      },
      word: () => small(),
      args(w, t) { return t & 1 ? [block(), small(), small(), small()] : [block(), block(), small(), small()]; },
    },
  };
  const world = (ovl, P) => {
    if (P.fill) P.fill(); else {
      for (let i = 0; i < EWN; i += 4) dv.setUint32(EW + i, P.word(), true);
      for (let i = 0; i < IWN; i += 4) dv.setUint32(IW + i, P.word(), true);
    }
    mem.fill(0, 0x04000000, 0x04000400);
    cpu.call(h.addr('Heap_Initialize') | 1, []);
    ovlLoaded = !!ovl;
    if (ovl) {
      const img = loadOverlay(ovl);
      if (!img) throw new Error(`no overlay image ${ovl}`);
      mem.set(img, 0x02008000);
    }
  };
  const RAM = [[0x02000000, 0x40000], [0x03000000, 0x8000], [0x04000000, 0x400], [0x05000000, 0x400],
    [0x06000000, 0x18000], [0x07000000, 0x400], [0x0e000000, 0x10000]];
  const STK = [0x0d0f0000, 0x10000];
  const snap = () => [...RAM, STK].map(([a, n]) => mem.slice(a, a + n));
  const restore = (s) => [...RAM, STK].forEach(([a], i) => mem.set(s[i], a));
  const diff = (a, b) => {
    for (let i = 0; i < RAM.length; i++) {
      if (Buffer.compare(a[i], b[i]) === 0) continue;
      let k = 0; while (a[i][k] === b[i][k]) k++;
      return `memory differs at 0x${(RAM[i][0] + k).toString(16)}: original ${a[i][k]} port ${b[i][k]}`;
    }
    return null;
  };
  const N = +(process.env.CASES || 8), TRIES = +(process.env.TRIES || 12), TMAX = +(process.env.TMAX || 15000);
  const rows = readReport().filter((_, i) => i % count === shard);
  const outp = path.join(ROOT, `build/a2c/batch/shard_${shard}.tsv`);
  fs.writeFileSync(outp, '');
  for (const r of rows) {
    const port = m[`_a2cw${r.ovl ? `_ov${r.ovl}` : ''}_${r.addr.toString(16).padStart(8, '0')}`];
    const thumb = !ARM_ROUTINES.has(r.name);
    let n = 0, bad = null, used = '', firstErr = null, tried = 0;
    const t0 = Date.now();
    for (const [pname, P] of Object.entries(PROFILES)) {
      if (n || bad) break;
      for (let t = 0; t < TRIES + N && n < N && !bad && Date.now() - t0 < TMAX; t++) {
        if (n === 0 && t >= TRIES) break;
        tried++;
        try { world(r.ovl, P); } catch (e) { firstErr = firstErr || e.message; break; }
        const args = P.args(P.word, t);
        const stk = [P.word(), P.word(), P.word(), P.word()];
        const before = snap();
        let ro;
        yieldsLeft = YIELDS;
        try { ro = cpu.call(r.addr | (thumb ? 1 : 0), args, { stackArgs: stk, maxSteps: 3_000_000 }) >>> 0; } catch (e) {
          if (e.yieldStop) ro = 'yield'; else { firstErr = firstErr || e.message; restore(before); continue; }
        }
        const afterO = snap();
        restore(before);
        let rp;
        yieldsLeft = YIELDS; depth = 0;
        try { rp = port(4, ...args, ...stk) >>> 0; } catch (e) {
          if (e.yieldStop) rp = 'yield'; else { bad = `${pname} args ${fmt(args)}: port: ${e.message}`; break; }
        }
        if (ro === 'yield' || rp === 'yield') { if (ro !== rp) { bad = `${pname} args ${fmt(args)}: original ${ro} port ${rp}`; break; } ro = rp = 0; }
        if (ro !== rp) { bad = `${pname} args ${fmt(args)}: result original 0x${ro.toString(16)} port 0x${rp.toString(16)}`; break; }
        const d = diff(afterO, snap());
        if (d) { bad = `${pname} args ${fmt(args)}: ${d}`; break; }
        n++; used = pname;
      }
    }
    const res = bad ? 'FAIL' : n ? 'EQUIV' : 'NOINPUT';
    const why = bad || (n ? `${n} cases (${used})` : `0 of ${tried}: ${(firstErr || '').replace(/0x[0-9a-f]+/g, 'X')}`);
    fs.appendFileSync(outp, `${r.name}\t${r.ovl}\t${r.addr.toString(16)}\t${r.bytes}\t${res}\t${used}\t${n}\t${why}\n`);
  }
  process.exit(0);
}

function fmt(a) { return '[' + a.map((x) => '0x' + (x >>> 0).toString(16)).join(', ') + ']'; }

main().catch((e) => { console.error(e); process.exit(2); });
