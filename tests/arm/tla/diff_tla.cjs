// D20 differential test of asm2c's translations of TLA listing routines (TLA3): each routine's original bytes run
// from the TLA ROM in the test interpreter (arm7.js), its asm2c translation runs in build/a2c/a2c_test.wasm
// (tests/arm/tla/build_test.sh), on the same random inputs and memory; the result r0 and every byte of the GBA RAM
// regions must match. Calls out of a translation that asm2c did not translate (C routines, BIOS) run in the
// interpreter on the same memory, as the original's do.
//
// Usage: node tests/arm/tla/diff_tla.cjs [--all | --batch] [name-filter]
//   default: the 30 proof routines (PROOF below, with their hand-written input rules)
//   --all:   every translated routine with generic inputs (batch report: EQUIV / FAIL / NOINPUT)
// Env: ROM (default ~/roms/Golden_Sun_The_Lost_Age_USA_Europe.gba), CASES (generic cases per routine, 60).
'use strict';
const fs = require('fs');
const path = require('path');
const { Harness, load, rng, ROOT } = require('../harness');

const ROM = process.env.ROM || path.join(process.env.HOME, 'roms/Golden_Sun_The_Lost_Age_USA_Europe.gba');
const OUT = process.env.OUT || 'a2c_test';
// DRAFTS=1: test the vendor's C drafts instead (tests/arm/tla/drafts.py -> build/a2c/drafts/drafts.js); a void
// draft's result is not compared
const DRAFTS = !!process.env.DRAFTS;
const MOD = DRAFTS ? path.join(ROOT, 'build/a2c/drafts/drafts.js') : path.join(ROOT, `build/a2c/${OUT}.js`);
const EW = 0x02000000, EWN = 0x40000, IW = 0x03001200, IWN = 0x7e00 - 0x1200;

function readReport() {
  const rows = [];
  for (const line of fs.readFileSync(path.join(ROOT, `build/a2c/${OUT}.report.tsv`), 'utf8').split('\n').slice(1)) {
    const f = line.split('\t');
    if (f.length < 5 || f[4] !== 'ok') continue;
    rows.push({ name: f[0], ovl: f[1], addr: parseInt(f[2], 16), bytes: +f[3] });
  }
  return rows;
}

// The 30 proof routines (docs/TLA3.md 3), picked for variety among the batch's EQUIV ones: ARM (Func_080212dc,
// Func_08021470: .inst words, local bl, interworking trampoline, long multiplies, .reloc pool), IWRAM install,
// leaves, many calls, literal pools, jump tables, carry/overflow flags, multiple returns, indirect calls, overlays
// (name@overlay), and the biggest battle effect and overlay routines that run on generic inputs.
const PROOF = [
  'System_InstallIwramAndIrqs', 'Func_080212dc', 'Func_08021470', 'BattleEffect_BuildBuffer', 'Func_080f9644',
  'Palette_Transform', 'Func_08021a84', 'Func_08122514', 'Func_080ec4d4', 'Func_081b3ff4', 'Func_080298c0',
  'Func_08027e20', 'Func_0811e3ac', 'ScreenTransition_Start', 'Func_08016990', 'Func_080eb01c', 'ItemIcon_Compose',
  'DebugParty_LoadPreset', 'VramCache_AllocateBlocks', 'Render_ProjectPoint', 'Graphics_AdvancePaletteCycle',
  'Class_Determine',
  'Func_0200048c@6a8', 'Func_02002438@686', 'Func_02003144@64b', 'Func_02004280@681', 'Func_02002a20@696',
  'Func_020001f8@6b0', 'Func_0200065c@6a5', 'Func_02001c7c@64a',
];

async function main() {
  const argv = process.argv.slice(2);
  const all = argv.includes('--all');
  const filter = argv.find((a) => !a.startsWith('--'));
  const m = await load(MOD, ROM);
  const h = new Harness(m, { game: 'tla' });
  const mem = h.mem, cpu = h.cpu;
  const dv = new DataView(mem.buffer);
  const R = rng(0x7a3);
  const regs = m._a2c_regs_addr();
  // `wait` is the task scheduler's yield (a fiber yield in the port, D8): in a test it returns at once, for the
  // original and for the translation's interpreter calls alike (a stack switch from a nested call cannot match)
  // A routine that yields many times (battle effect scripts, event scripts) is compared up to its YIELDS-th yield:
  // that call stops the run (a JS exception through the interpreter or through the wasm frames) and both
  // memories are compared there (prefix equivalence over YIELDS-1 frames of work).
  const WAIT = h.addr('wait') & ~1;
  const YIELDS = +(process.env.YIELDS || 4);
  let yieldsLeft = YIELDS;
  const stepT = cpu.stepThumb.bind(cpu);
  cpu.stepThumb = () => {
    if (cpu.r[15] === WAIT) {
      if (--yieldsLeft <= 0) { const e = new Error('yield limit'); e.yieldStop = true; throw e; }
      cpu.note('test: wait returns'); cpu.bx(cpu.r[14]); return;
    }
    stepT();
  };
  // a call out of translated code: run the ROM's routine in the interpreter on the translation's registers
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
  // overlay code: the linked overlay image of the reference build (port_work/tla1/overlays/resource_<id>.bin,
  // tools/build_ref_tla.sh; compare-tla-en proves its packed bytes are the cartridge's). The game's own loader
  // (Resource_LoadCode) needs its RAM decoder installed first, which the harness does not model.
  const ovlCache = new Map();
  const loadOverlay = (id) => {
    if (!ovlCache.has(id)) {
      const f = path.join(ROOT, `port_work/tla1/overlays/resource_${id}.bin`);
      ovlCache.set(id, fs.existsSync(f) ? fs.readFileSync(f) : null);
    }
    return ovlCache.get(id);
  };
  // generic world: RAM words that are mostly small numbers and pointers into RAM (so pointer chains resolve)
  const word = () => {
    const k = R() & 7;
    if (k < 3) return R() & 15;
    if (k < 5) return (EW + (R() % (EWN - 0x100))) & ~3;
    if (k === 5) return (IW + (R() % IWN)) & ~3;
    if (k === 6) return R() & 0xffff;
    return R();
  };
  const fill = (a, n) => { for (let i = 0; i < n; i += 4) dv.setUint32(a + i, word(), true); };
  const world = (ovl) => {
    fill(EW, EWN); fill(IW, IWN);
    mem.fill(0, 0x04000000, 0x04000400);
    if (ovl) {
      const img = loadOverlay(ovl);
      if (!img) throw new Error(`no overlay image ${ovl}`);
      mem.set(img, 0x02008000);
    }
  };
  const RAM = [[0x02000000, 0x40000], [0x03000000, 0x8000], [0x04000000, 0x400], [0x05000000, 0x400],
    [0x06000000, 0x18000], [0x07000000, 0x400], [0x0e000000, 0x10000]];
  // the interpreter's stack area is restored too (not compared): a callee may read stale stack words
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
  // TRACE=1 (a trace build, OUT=...): replay the failing case in both and print where the states first differ
  const traceCase = (r, thumb, cs) => {
    const lo = r.addr, hi = r.addr + r.bytes;
    const to = [], tp = [];
    const st = (pc, rr, f) => `${pc.toString(16)} ${Array.from(rr.slice(0, 14), (x) => (x >>> 0).toString(16)).join(' ')} nzcv=${f}`;
    restore(cs.before);
    const oT = cpu.stepThumb.bind(cpu), oA = cpu.stepArm.bind(cpu);
    let inPort = false;
    const hook = (step) => () => { const pc = cpu.r[15]; if (!inPort && pc >= lo && pc < hi && to.length < 200000) to.push(st(pc, cpu.r, (cpu.cpsr >>> 28).toString(2).padStart(4, '0'))); step(); };
    cpu.stepThumb = hook(oT); cpu.stepArm = hook(oA);
    try { cpu.call(r.addr | (thumb ? 1 : 0), cs.args, { stackArgs: cs.stk, maxSteps: 3_000_000 }); } catch (e) { to.push('error ' + e.message); }
    restore(cs.before);
    inPort = true;
    m.a2cTrace = (a) => { if (tp.length < 200000) { const rr = []; for (let i = 0; i < 20; i++) rr.push(dv.getUint32(regs + 4 * i, true)); tp.push(st(a, rr, rr.slice(16).join(''))); } };
    try { m[`_a2cw${r.ovl ? `_ov${r.ovl}` : ''}_${r.addr.toString(16).padStart(8, '0')}`](4, ...cs.args, ...cs.stk); } catch (e) { tp.push('error ' + e.message); }
    m.a2cTrace = null; cpu.stepThumb = oT; cpu.stepArm = oA;
    // the interpreter state is before the instruction, the trace hook's too; flags only compared where both have them
    let i = 0; const strip = (x) => x.replace(/ nzcv=.*/, '');
    while (i < to.length && i < tp.length && strip(to[i]) === strip(tp[i])) i++;
    console.log(`  trace: ${to.length} / ${tp.length} steps, first difference at step ${i}`);
    for (let k = Math.max(0, i - 3); k <= i + 1; k++) console.log(`   orig ${to[k] || '-'}\n   port ${tp[k] || '-'}`);
  };
  const rows = readReport();
  const byName = new Map(rows.map((r) => [r.ovl ? `${r.name}@${r.ovl}` : r.name, r]));
  // --negative: originals against another routine's translation; every pair must FAIL (a harness that compares
  // nothing cannot pass)
  const NEG = [['Class_Determine', 'Render_ProjectPoint'], ['Func_08016990', 'System_InstallIwramAndIrqs'],
    ['Func_02002a20@696', 'Func_020001f8@6b0'], ['Func_080212dc', 'Func_08021470']];
  const neg = argv.includes('--negative');
  const list = neg ? NEG.map(([o, p]) => ({ ...byName.get(o), portAs: byName.get(p), neg: true }))
    : all ? rows : PROOF.map((n) => byName.get(n) || { name: n, missing: true });
  const N = +(process.env.CASES || 60);
  let eq = 0, fail = 0, noin = 0;
  const out = [];
  for (const r of list) {
    if (filter && !r.name.includes(filter)) continue;
    if (r.missing) { console.log(`${r.name.padEnd(34)} FAIL not translated`); fail++; continue; }
    const pr = r.portAs || r;
    let port = m[`_a2cw${pr.ovl ? `_ov${pr.ovl}` : ''}_${pr.addr.toString(16).padStart(8, '0')}`];
    if (DRAFTS) {
      const fn = m['_' + pr.name];
      if (!fn) { console.log(`${r.name.padEnd(34)} NODRAFT`); continue; }
      port = (ns, ...a) => { const v = fn(...a); return v === undefined ? 'void' : v; };
    }
    const thumb = !(r.name === 'Func_080212dc' || r.name === 'Func_08021470');
    let n = 0, tried = 0, bad = null, lastCase = null, yielded = 0, firstErr = null;
    const t0 = Date.now();
    while (n < N && tried < (all ? Math.max(24, n * 8 + 24) : N * 10) && !bad && Date.now() - t0 < +(process.env.TMAX || 20000)) {
      tried++;
      try { world(r.ovl); } catch (e) { break; }
      const ptr = () => (EW + (R() % (EWN - 0x400))) & ~3;
      // Func_08021470 (ARM) takes four structure pointers
      const args = r.name === 'Func_08021470' ? [ptr(), ptr(), ptr(), ptr()] : [word(), word(), word(), word()];
      const stk = [word(), word(), word(), word()];
      const before = snap();
      lastCase = { before, args, stk };
      let ro;
      yieldsLeft = YIELDS;
      try {
        ro = cpu.call(r.addr | (thumb ? 1 : 0), args, { stackArgs: stk, maxSteps: 3_000_000 }) >>> 0;
      } catch (e) {
        if (e.yieldStop) ro = 'yield'; else { firstErr = firstErr || e.message; restore(before); continue; } // inputs the original cannot run
      }
      const afterO = snap();
      restore(before);
      let rp;
      yieldsLeft = YIELDS; depth = 0;
      try { rp = port(4, ...args, ...stk); if (rp !== 'void') rp >>>= 0; } catch (e) {
        if (e.yieldStop) rp = 'yield'; else { bad = `args ${fmt(args)}: port: ${e.message}`; break; }
      }
      if (ro === 'yield') yielded++;
      if (ro === 'yield' || rp === 'yield') { if (ro !== rp) { bad = `args ${fmt(args)}: original ${ro} port ${rp}`; break; } ro = rp = 0; }
      if (rp === 'void') rp = ro;
      if (ro !== rp) { bad = `args ${fmt(args)}: result original 0x${ro.toString(16)} port 0x${rp.toString(16)}`; break; }
      const d = diff(afterO, snap());
      if (d) { bad = `args ${fmt(args)}: ${d}`; break; }
      n++;
    }
    if (bad && process.env.TRACE && lastCase) traceCase(r, thumb, lastCase);
    let res;
    if (bad) { fail++; res = `FAIL ${bad}`; } else if (n === 0) { noin++; res = `NOINPUT (0 of ${tried} random inputs ran in the original: ${firstErr})`; } else { eq++; res = `EQUIV ${n} cases${yielded ? ` (${yielded} up to yield ${YIELDS})` : ''}${tried > n ? ` (${tried - n} inputs the original cannot run, skipped)` : ''}`; }
    if (r.neg) {
      const ok = res.startsWith('FAIL');
      console.log(`${ok ? 'ok  ' : 'BAD '} original ${r.name} vs translation of ${pr.name}: ${res}`);
      if (ok) { fail--; eq++; } else { eq--; fail++; }
      continue;
    }
    console.log(`${r.name.padEnd(34)} ${res}`);
    out.push(`${r.name}\t${r.ovl}\t${r.addr.toString(16)}\t${r.bytes}\t${res.split(' ')[0]}\t${n}`);
    if (all) fs.appendFileSync(path.join(ROOT, 'build/a2c/d20_batch.part.tsv'), out[out.length - 1] + '\n');
  }
  if (all) fs.writeFileSync(path.join(ROOT, 'build/a2c/d20_batch.tsv'), 'name\toverlay\taddr\tbytes\tresult\tcases\n' + out.join('\n') + '\n');
  console.log(neg ? `${eq}/${eq + fail} negative controls detected` : `${eq} EQUIV, ${fail} FAIL, ${noin} NOINPUT of ${eq + fail + noin}`);
  process.exit(fail ? 1 : 0);
}

function fmt(a) { return '[' + a.map((x) => '0x' + (x >>> 0).toString(16)).join(', ') + ']'; }

main().catch((e) => { console.error(e); process.exit(2); });
