// TLA4d: differential test of The Lost Age's PCM mixer and render ported to C (port/tla/hw/pc_tla_mixer.c). The
// originals patch their own code, so asm2c's D20 cannot take them; the interpreter (arm7.js) decodes every
// instruction from memory, so it runs the ROM's self-patching code as the GBA does. One case = one VBlank:
//   original: SoundDriver_EnterVBlankUpdate (ROM, Thumb) and, when it returns 0, IwramSoundRenderVBlank (IWRAM copy),
//             as System_WaitForFrameInterrupt calls them;
//   port:     Port_TlaSoundEnterVBlank (game.wasm), which mixes and renders.
// Inputs: a SoundInfo with 1-12 random channels (envelope phases, PCM waves looped or not, fixed rate, synth waves of
// the three kinds, counts ending inside the VBlank, volumes 0), random workspace, DirectSound buffers, render state
// (channel count, previous buffer half, delay 0xb0 or 0, filter words) and buffer period. Every RAM byte is compared
// except the mixer's and render's own code words (kernel patches, their cache, saved registers, the patched branch)
// and the original's stack below 0x03007900 (it runs with sp = 0x03007900, the lowest stack it accepts, so it never
// takes its sample-DMA-to-stack path, which copies the same bytes).
// Usage: node tests/arm/tla/diff_mixer.cjs [cases]   (needs build/wasm-tla, the TLA ROM)
'use strict';
const path = require('path');
const { Harness, load, rng, ROOT } = require('../harness');

const ROM = process.env.ROM || path.join(process.env.HOME, 'roms/Golden_Sun_The_Lost_Age_USA_Europe.gba');

async function main() {
  const NEG = process.argv.includes('--negative'); // controls: a changed input byte, or no port call, must FAIL
  const N = +(process.argv.filter((a) => !a.startsWith('--'))[2] || 300);
  let negDetected = 0;
  const m = await load(path.join(ROOT, 'build/wasm-tla/game.js'), ROM);
  const h = new Harness(m, { game: 'tla' });
  const dv = new DataView(h.mem.buffer);
  const R = rng(0x7a4d1);
  const fill = (a, n) => { for (let i = 0; i < n; i++) h.mem[a + i] = R() & 0xff; };
  const ENTER = h.addr('SoundDriver_EnterVBlankUpdate') | 1, RENDER = h.addr('IwramSoundRenderVBlank') | 1;
  const IDLE = h.addr('Task_Idle') | 1;
  const SI = 0x02030000, WAVES = 0x02034000, BUF = 0x02003a90, WS = 0x03006fc0;
  const K1 = dv.getUint32(0x03000d38, true), K2 = dv.getUint32(0x03000d3c, true); // the ROM's filter words
  const IGNORE = [[0x030007b4, 0x03000d1c - 0x030007b4], [0x03000d40, 0x03000ee4 - 0x03000d40], [0x03007800, 0x100]];
  let eq = 0, rendered = 0, clipped = 0;
  for (let i = 0; i < N; i++) {
    fill(SI, 0x8000);
    fill(BUF, 0x18c0);
    const wsMode = R.range(0, 2); // random words (clipping), small halves, zeros
    if (wsMode === 0) fill(WS, 2112);
    else for (let k = 0; k < 528; k++) dv.setUint32(WS + 4 * k, wsMode === 1 ? (((R() & 0x1fff) - 0x1000) & 0xffff) | ((((R() & 0x1fff) - 0x1000) & 0xffff) << 16) : 0, true);
    dv.setUint32(0x03000d1c, R(), true);
    dv.setUint32(0x03000d2c, BUF + 1056 * R.range(0, 2), true);
    dv.setUint32(0x03000d30, R.pick([0xb0, 0xb0, 0xb0, 0, 0x40]), true);
    dv.setUint32(0x03000d34, R(), true);
    dv.setUint32(0x03000d38, R() & 1 ? K1 : R(), true);
    dv.setUint32(0x03000d3c, R() & 1 ? K2 : R(), true);
    dv.setUint32(0x03000ee4, R() & 1 ? 0 : R(), true);
    h.mem[0x03001139] = R.range(0, 4);
    dv.setUint32(0x03007ff0, SI, true);
    dv.setUint32(SI, 0x68736d53, true);
    dv.setUint32(SI + 32, R() & 1 ? 0 : IDLE, true);
    dv.setUint32(SI + 36, R(), true);
    dv.setUint32(SI + 40, IDLE, true);
    h.mem[SI + 11] = 3;
    dv.setUint32(SI + 16, 528, true);
    dv.setUint32(SI + 24, R.pick([266, 265, 300, 250, 399]), true);
    const nch = R.range(1, 12);
    h.mem[SI + 6] = nch;
    for (let k = 0; k < nch; k++) {
      const c = SI + 80 + 64 * k, w = WAVES + 0x800 * k;
      const size = R.pick([0, 16, 100, 300, 1000, 1500]);
      dv.setUint32(c + 36, w, true);
      dv.setUint32(w + 12, size, true);
      const loop = R() & 1;
      h.mem[w + 3] = loop ? 0x40 : 0;
      dv.setUint32(w + 8, loop ? R.range(0, Math.max(0, size - 1)) : 0, true);
      h.mem[c] = R.pick([0x80, 0xc0, 0x83, 0x82, 0x81, 0x93, 0x92, 0x43, 0x53, 0x42, 0x04, 0x14, 0x03, 0x02, 0x01, 0x00]);
      h.mem[c + 1] = R.pick([0, 0, 0, 8, 0x40]);
      if (R() % 5 === 0) { h.mem[c + 2] = 0; h.mem[c + 3] = 0; } // both volumes 0: skipped
      h.mem[c + 13] = R.range(0, 3);
      const cnt = R.pick([0, 1, 5, 200, 400, 2000, size]);
      if (h.mem[c + 1] === 8 && (!cnt || !size || (h.mem[c] & 0x80))) h.mem[c + 1] = 0; // a fixed-rate wave of 0 samples mixes forever
      dv.setUint32(c + 24, cnt, true);
      dv.setUint32(c + 40, w + 16 + R.range(0, 200), true);
      dv.setUint32(c + 28, R() & 0x7fffff, true);
      dv.setUint32(c + 32, R.pick([0x800, 0x2000, 0x5000, 0x5200, 0x8000, 0xa000, 0x14000, 0x28000]) + (R() & 0xfff), true);
      if (R() & 1) h.mem[w + 16 + 1 + R.range(0, 200)] = R.range(0, 2); // synth kinds 0/1/other
    }
    const before = h.snapshot();
    let err = null, r0;
    try {
      r0 = h.cpu.call(ENTER, [], { sp: 0x03007900 }) >>> 0;
      if (r0 === 0) { h.cpu.call(RENDER, [8], { sp: 0x03007900 }); rendered++; }
    } catch (e) { err = 'original: ' + e.message; }
    const afterO = h.snapshot();
    h.restore(before);
    if (NEG && i % 3 === 1) h.mem[WS + 4 * R.range(0, 527) + (wsMode ? 2 : 3)] ^= wsMode ? 0x80 : 0x40; // a workspace word: the output LSB (small words) or the sign (random: saturated words hide their other bits)
    if (NEG && i % 3 === 2) h.mem[0x03000d1c] ^= 1;                    // the channel count
    if (!(NEG && i % 3 === 0)) try { m._Port_TlaSoundEnterVBlank(); } catch (e) { err = err || 'port: ' + e.message; }
    const afterP = h.snapshot();
    if (!err && dv.getUint32(0x03000ee4, true) === 0x80008000) clipped++;
    for (const [a, n] of IGNORE) {
      const ri = a >= 0x03000000 && a < 0x03008000 ? 1 : 0;
      const base = ri ? 0x03000000 : 0x02000000;
      afterO[ri].fill(0, a - base, a - base + n); afterP[ri].fill(0, a - base, a - base + n);
    }
    const d = err || (r0 !== 0 ? `original returned ${r0}` : h.diff(afterO, afterP));
    h.restore(before);
    if (NEG) { if (d) negDetected++; else console.log(`negative case ${i} not detected`); continue; }
    if (d) { console.log(`case ${i}: FAIL ${d}`); process.exit(1); }
    eq++;
  }
  if (NEG) { console.log(`${negDetected}/${N} negative controls detected`); return; }
  console.log(`mixer + render: EQUIV ${eq} cases (${rendered} rendered, ${clipped} with clipping)`);
}

main().catch((e) => { console.error(e); process.exit(2); });
