// TLA7: differential test of The Lost Age's battle effect blitters (trap 29). The original builder, Func_08196404
// (raw Thumb), copies BattleEffect_PatchTemplate into a heap slot with ldm/stm and DMA3 and patches its words for the
// canvas size, clip/mirror flags and mode; effects then call the slot. asm2c translates the builder but not the
// patched ARM it writes; the port aliases the slot to GS1's C blitter (port/pc/blitter.c) through
// Port_TlaBuildBlitter (port/tla/hw/pc_tla.c). The interpreter (arm7.js) decodes every instruction from memory, so it
// runs the ROM's builder and then the ARM words it wrote, as the GBA does:
//   original: Func_08196404 (ROM) in the interpreter, then the built slot in the interpreter;
//   port:     Func_08196404 through the code map (Port_TlaBuildBlitter: the asm2c translation + the alias), then the
//             slot's address through Port_ResolveCode (Port_CallRam6), as the effects call it.
// One build per (width shift 7/8, flags 0-15, mode 0-4); the built words (and everything else in RAM) must match,
// then 30 random draws each: canvases, pictures (zeros included), positions in and around the canvas. Half the builds
// allocate the slot fresh in IWRAM (0x03005380, where the first battle's builder put it) after the port aliased that
// address to the picture decoder, as the field's RamCode_Load leaves it (the TLA6b stop): the fresh allocation must
// drop the alias. The other half reuse a slot already held in EWRAM.
// Usage: node tests/arm/tla/diff_blitter.cjs [--negative]   (needs build/wasm-tla, the TLA ROM)
'use strict';
const path = require('path');
const { Harness, load, rng, ROOT } = require('../harness');

const ROM = process.env.ROM || path.join(process.env.HOME, 'roms/Golden_Sun_The_Lost_Age_USA_Europe.gba');

async function main() {
  const NEG = process.argv.includes('--negative'); // controls: a wrong mode or flag in the port's build must FAIL
  const m = await load(path.join(ROOT, 'build/wasm-tla/game.js'), ROM);
  const h = new Harness(m, { game: 'tla' });
  const dv = new DataView(h.mem.buffer);
  const R = rng(0x7b117);
  const BUILD = 0x08196405, SLOT = 0x60, EW = 0x02020000, CANVAS = EW, PIC = EW + 0x10000;
  const IW_BLK = 0x03005380, EW_BLK = 0x0203c000;
  const DECODER = h.addr('Render_DecodePicture');
  // immediate DMA3 copies (the builder's fragment copies), as hw.c runs them in the port
  h.cpu.onWrite = (a, n) => {
    if (!(a <= 0x040000df && a + n > 0x040000de)) return;
    const ctl = dv.getUint16(0x040000de, true);
    if (!(ctl & 0x8000) || ((ctl >> 12) & 3) !== 0) return;
    let src = dv.getUint32(0x040000d4, true), dst = dv.getUint32(0x040000d8, true), k = dv.getUint16(0x040000dc, true) || 0x10000;
    const unit = ctl & 0x400 ? 4 : 2, dctl = (ctl >> 5) & 3, sctl = (ctl >> 7) & 3;
    const ds = dctl === 1 ? -unit : dctl === 2 ? 0 : unit, ss = sctl === 1 ? -unit : sctl === 2 ? 0 : unit;
    src &= ~(unit - 1); dst &= ~(unit - 1);
    while (k--) { if (unit === 4) dv.setUint32(dst, dv.getUint32(src, true), true); else dv.setUint16(dst, dv.getUint16(src, true), true); src += ss; dst += ds; }
  };
  const IGNORE = [[0x04000000, 0x400], [0x03007c00, 0x400]]; // I/O (DMA registers), the stacks
  const cmp = (a, b) => {
    for (const [x, n] of IGNORE) for (const s of [a, b]) {
      const i = [0x02000000, 0x03000000, 0x04000000].indexOf(x & 0xff000000);
      if (i >= 0) s[i].fill(0, x - (x & 0xff000000), x - (x & 0xff000000) + n);
    }
    return h.diff(a, b);
  };
  let builds = 0, draws = 0, negDetected = 0, negCases = 0;
  for (const ws of [7, 8]) for (let flags = 0; flags < 16; flags++) for (let mode = 0; mode < 5; mode++) {
    const fresh = (flags + mode) & 1;
    if (fresh) {
      dv.setUint32(0x03000000 + SLOT, 0, true);
      dv.setUint32(0x03000004, IW_BLK, true); // the IWRAM pool's next free address
      m._Port_CodeAlias(IW_BLK, DECODER);
    } else {
      dv.setUint32(0x03000000 + SLOT, EW_BLK, true);
    }
    const before = h.snapshot();
    let err = null, ro, rp;
    try { ro = h.cpu.call(BUILD, [SLOT, ws, 7, flags], { stackArgs: [mode] }) >>> 0; } catch (e) { err = 'original build: ' + e.message; }
    const afterO = h.snapshot();
    h.restore(before);
    const neg = NEG && (builds % 2 === 0);
    try {
      rp = m._Port_CallCode5(BUILD, SLOT, ws, 7, flags, mode) >>> 0;
      if (neg) m._Port_BlitterBuilt(dv.getUint32(0x03000000 + SLOT, true), ws, 7, flags ^ (1 << (builds % 4)), 0);
    } catch (e) { err = err || 'port build: ' + e.message; }
    const afterP = h.snapshot();
    let d = err || (ro !== rp ? `build result original ${ro} port ${rp}` : cmp(afterO, afterP));
    if (d) { console.log(`build ws ${ws} flags ${flags} mode ${mode}${fresh ? ' fresh' : ''}: FAIL ${d}`); process.exit(1); }
    builds++;
    const blk = dv.getUint32(0x03000000 + SLOT, true);
    if (blk !== (fresh ? IW_BLK : EW_BLK)) { console.log(`slot at 0x${blk.toString(16)}`); process.exit(1); }
    let caseFail = null;
    for (let i = 0; i < 30; i++) {
      for (let k = 0; k < 0x9000; k++) h.mem[CANVAS + k] = R() & 1 ? R() & 63 : R() & 0xff;
      for (let k = 0; k < 0x1000; k++) h.mem[PIC + k] = R() & 1 ? 0 : (R() & 1 ? R() & 63 : R() & 0xff);
      const w = R() & 1 ? 8 * R.range(0, 8) : R.range(0, 64), hh = R() & 1 ? 8 * R.range(0, 8) : R.range(0, 64);
      const args = [CANVAS + (i % 10 === 9 ? R.range(0, 3) : 0), PIC + R.range(0, 64), R.range(-80, (1 << ws) + 16), R.range(-80, 144)];
      const st = [w, hh];
      const b2 = h.snapshot();
      let e2 = null, o2, p2;
      try { o2 = h.cpu.call(blk | 1, args, { stackArgs: st }) >>> 0; } catch (e) { e2 = 'original: ' + e.message; }
      const ao = h.snapshot();
      h.restore(b2);
      try { p2 = m._Port_CallRam6(blk | 1, ...args, ...st) >>> 0; } catch (e) { e2 = e2 || 'port: ' + e.message; }
      const ap = h.snapshot();
      const d2 = e2 || (o2 !== p2 ? `result original 0x${o2.toString(16)} port 0x${p2.toString(16)}` : cmp(ao, ap));
      h.restore(b2);
      if (d2) { caseFail = `draw ${i} (${args.map((a) => a | 0)} ${st}): ${d2}`; break; }
      draws++;
    }
    if (neg) { negCases++; if (caseFail) negDetected++; else console.log(`negative build ${builds} not detected`); continue; }
    if (caseFail) { console.log(`ws ${ws} flags ${flags} mode ${mode}${fresh ? ' fresh' : ''}: FAIL ${caseFail}`); process.exit(1); }
  }
  if (NEG) { console.log(`${negDetected}/${negCases} negative controls detected`); return; }
  console.log(`blitters: EQUIV ${builds} builds (built words and RAM), ${draws} draws`);
}

main().catch((e) => { console.error(e); process.exit(2); });
