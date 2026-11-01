// Differential tests of the hand-ported asm routines (D6/D20): each original routine runs from the player's ROM
// in the test interpreter, our C port runs in game.wasm, on the same random and edge-case inputs; results and
// all GBA RAM must match. Prints one line per routine (EQUIV n cases | FAIL first difference) and the
// interpreter's instruction coverage.
// Usage: node tests/arm/diff.cjs build/wasm/game.js ~/roms/Golden_Sun_USA_Europe.gba [routine-filter]
'use strict';
const { Harness, load, rng } = require('./harness');

const S32 = [0, 1, 2, 3, -1, -2, 7, 0x7fffffff, -0x80000000, 0x40000000, -0x40000000, 0x10000, -0x10000, 255, 256,
  0xffff, 46340, 46341, 1000000, -1000000];

function routines(h) {
  const A = (n) => h.addr(n);
  const T = (n) => h.addr(n) | 1; // a Thumb entry
  const R = rng(0x5eed1);
  const s32 = () => (R() & 3) === 0 ? R.pick(S32) : (R() & 1 ? R() | 0 : (R() >> R.range(0, 31)) | 0);
  const pairs = (n) => {
    const out = [];
    for (const a of S32) for (const b of S32) out.push([a, b]);
    while (out.length < n) out.push([s32(), s32()]);
    return out;
  };
  const EW = 0x02020000; // scratch areas inside EWRAM for memory routines
  const fillRandom = (a, n) => { for (let i = 0; i < n; i++) h.mem[a + i] = R() & 0xff; };
  const pure = (name, port, orig, gen, n, ret = 'u32') => ({ name, spec: { orig, port, returns: ret }, cases: () => gen(n), memoryEvery: 97 });
  const list = [
    pure('IwramSignedDivide', 'IwramSignedDivide', A('IwramSignedDivide'), pairs, 200000),
    pure('IwramSignedRemainder', 'IwramSignedRemainder', A('IwramSignedRemainder'), pairs, 200000),
    pure('IwramUnsignedDivide', 'IwramUnsignedDivide', A('IwramUnsignedDivide'), pairs, 200000),
    pure('IwramUnsignedRemainder', 'IwramUnsignedRemainder', A('IwramUnsignedRemainder'), pairs, 200000),
    pure('__divsi3', '__divsi3', T('__divsi3'), pairs, 20000),
    pure('IwramRatioMulQ14', 'IwramRatioMulQ14', A('IwramRatioMulQ14'), pairs, 100000),
    pure('IwramMulQ16', 'IwramMulQ16', A('IwramMulQ16'), pairs, 50000),
    pure('IwramSqrt', 'IwramSqrt', A('IwramSqrt'), (n) => {
      const out = [];
      for (let i = 0; i < 70000; i++) out.push([i]);
      for (let k = 1; k < 46341; k += 7) out.push([k * k], [k * k - 1], [k * k + 1]);
      out.push([0x7fffffff], [-1], [-0x80000000]);
      while (out.length < n) out.push([s32()]);
      return out;
    }, 300000),
    pure('Iwram_SqrtFarArm', 'Iwram_SqrtFarArm', A('Iwram_SqrtFarArm'), (n) => { const o = []; while (o.length < n) o.push([s32()]); return o; }, 5000),
    pure('Iwram_RatioMulQ14FarArm', 'Iwram_RatioMulQ14FarArm', A('Iwram_RatioMulQ14FarArm'), pairs, 5000),
    pure('Trig_Sin', 'Trig_Sin', T('Trig_Sin'), (n) => {
      const o = []; for (let a = 0; a < 0x10000; a++) o.push([a]);
      while (o.length < n) o.push([s32()]); return o;
    }, 80000),
    pure('Trig_Cos', 'Trig_Cos', T('Trig_Cos'), (n) => {
      const o = []; for (let a = 0; a < 0x10000; a++) o.push([a]);
      while (o.length < n) o.push([s32()]); return o;
    }, 80000),
    pure('umul3232H32', 'umul3232H32', T('umul3232H32'), pairs, 50000),
    pure('ArcTan2FarArm', 'ArcTan2FarArm', A('ArcTan2FarArm'), (n) => {
      const o = []; for (const a of S32) for (const b of S32) o.push([a, b]);
      while (o.length < n) { const k = R.range(0, 20); o.push([(R() | 0) >> k, (R() | 0) >> k]); } return o;
    }, 20000),
    {
      name: 'IwramFillWords', spec: { orig: A('IwramFillWords'), port: 'IwramFillWords', returns: 'u32' },
      cases: () => {
        const o = []; for (let s = 0; s <= 1100; s++) o.push([EW + 4 * R.range(0, 64), s, R()]);
        for (let i = 0; i < 300; i++) o.push([EW + 4 * R.range(0, 64), R.range(0, 8192), R()]); return o;
      },
    },
    {
      name: 'IwramClearWords', spec: { orig: A('IwramClearWords'), port: 'IwramClearWords', returns: 'u32' },
      setup: () => fillRandom(EW, 9000),
      cases: () => { const o = []; for (let s = 0; s <= 600; s++) o.push([EW + 4 * R.range(0, 64), s]); return o; },
    },
    {
      name: 'IwramCopyWords', spec: { orig: A('IwramCopyWords'), port: 'IwramCopyWords', returns: 'u32' },
      setup: () => fillRandom(EW + 0x8000, 9000),
      cases: () => {
        const o = []; for (let s = 0; s <= 1100; s += 1) o.push([EW + 4 * R.range(0, 64), EW + 0x8000 + 4 * R.range(0, 64), s]);
        for (let i = 0; i < 200; i++) o.push([EW + 4 * R.range(0, 64), 0x08000000 + 4 * R.range(0, 0x100000), R.range(0, 8192)]); return o;
      },
    },
    {
      name: 'IwramExpandBitRuns', spec: { orig: A('IwramExpandBitRuns'), port: 'IwramExpandBitRuns', returns: 'u32' },
      cases: function* () {
        for (let i = 0; i < 2000; i++) { const b = EW + 0x8000 + 2 * R.range(0, 100); fillRandom(b, 28); yield [b, EW + R.range(0, 300), R() & 0xff]; }
      },
    },
    {
      name: 'IwramTransformVector', spec: { orig: A('IwramTransformVector'), port: 'IwramTransformVector', returns: 'u32' },
      cases: function* () {
        const g = h.addr('gTransform');
        for (let i = 0; i < 3000; i++) {
          for (let k = 0; k < 12; k++) h.m.HEAP32[(g >> 2) + k] = s32();
          const v = EW + 0x8000; for (let k = 0; k < 3; k++) h.m.HEAP32[(v >> 2) + k] = s32();
          yield [v, EW + 4 * R.range(0, 32)];
        }
      },
      lazy: true,
    },
    {
      name: 'IwramTransformMatrix', spec: { orig: A('IwramTransformMatrix'), port: 'IwramTransformMatrix', returns: 'none' },
      cases: function* () {
        const g = h.addr('gTransform');
        for (let i = 0; i < 3000; i++) {
          for (let k = 0; k < 12; k++) h.m.HEAP32[(g >> 2) + k] = s32();
          const v = EW + 0x8000; for (let k = 0; k < 12; k++) h.m.HEAP32[(v >> 2) + k] = s32();
          yield [v];
        }
      },
      lazy: true,
    },
    {
      name: 'IwramDecompress', spec: { orig: A('IwramDecompress'), port: 'IwramDecompress', returns: 'u32' },
      cases: function* () {
        // valid random streams: literals (some > 223: skips), back references into the bytes before the
        // literal stream, long counts; a zero reference word ends it. Plus a zero-offset stream.
        
        for (let i = 0; i < 1500; i++) {
          const src = EW + 0x10000 + 0x1000 + R.range(0, 255);
          fillRandom(src - 0x1000, 0x1000);
          const lits = [], area = [];
          let flags = [], items = R.range(0, 120);
          const pushFlag = (b) => { flags.push(b); if (flags.length === 8) flush(); };
          const pending = [];
          const flush = () => { let v = 0; flags.forEach((b, k) => { v |= b << k; }); area.push(v, ...pending.splice(0)); flags = []; };
          for (let k = 0; k < items; k++) {
            if (R() & 1) { pushFlag(1); lits.push(R() & 1 ? R.range(0, 223) : R() & 0xff); }
            else {
              const dist = R.range(1, 0xfff), count = R.range(0, 15);
              const w = (count << 12) | dist;
              pending.push(w >> 8, w & 0xff);
              if (count === 0) pending.push(R.range(0, 40));
              pushFlag(0);
            }
          }
          pending.push(0, 0); pushFlag(0); while (flags.length) pushFlag(0);
          const offset = 2 + lits.length;
          h.mem[src] = offset & 0xff; h.mem[src + 1] = offset >> 8;
          h.mem.set(lits, src + 2); h.mem.set(area, src + offset);
          yield [src, EW + R.range(0, 64)];
        }
        h.mem[EW + 0x18000] = 0; h.mem[EW + 0x18001] = 0; yield [EW + 0x18000, EW];
      },
      lazy: true,
    },
    {
      name: 'Heap_Release', spec: { orig: T('Heap_Release'), port: 'Heap_Release', returns: 'none' },
      cases: () => { const o = []; for (let i = 0; i < 3000; i++) o.push([R.pick([0x02000000, 0x03000000, 0, 0x0e000000, 0x06000000]) + (R() & 0x3ffffc) | 0]); return o; },
    },
    {
      name: 'HeapSlot_Release', spec: { orig: T('HeapSlot_Release'), port: 'HeapSlot_Release', returns: 'none' },
      cases: function* () {
        const g = h.addr('gHeapSlots');
        for (let i = 0; i < 3000; i++) {
          for (let k = 0; k < 64; k++) h.m.HEAPU32[(g >> 2) + k] = R() & 1 ? 0 : (R.pick([0x02000000, 0x03000000, 0, 0x100000]) + (R() & 0x3ffffc)) >>> 0;
          yield [R.range(0, 63)];
        }
      },
      lazy: true,
    },
    {
      name: 'Bios_CpuSet', spec: { orig: T('Bios_CpuSet'), port: 'Bios_CpuSet', returns: 'none' },
      setup: () => fillRandom(EW + 0x8000, 0x4000),
      cases: () => {
        const o = [];
        for (let i = 0; i < 2000; i++) {
          const ctl = R.range(0, 600) | (R() & 1 ? 1 << 24 : 0) | (R() & 1 ? 1 << 26 : 0);
          o.push([EW + 0x8000 + R.range(0, 0x1000), EW + R.range(0, 0x1000), ctl]);
        }
        return o;
      },
    },
    { name: 'Bios_SoundBiasOn', spec: { orig: T('Bios_SoundBiasOn'), port: 'Bios_SoundBiasOn', returns: 'none' }, cases: () => [[], []], setup: () => { h.mem[0x04000088] = 0x55; h.mem[0x04000089] = 0xc3; } },
    { name: 'Bios_SoundBiasOff', spec: { orig: T('Bios_SoundBiasOff'), port: 'Bios_SoundBiasOff', returns: 'none' }, cases: () => [[], []] },
  ];
  return list;
}

async function main() {
  const [gameJs, rom, filter] = process.argv.slice(2);
  const m = await load(gameJs, rom);
  const h = new Harness(m);
  let fails = 0, total = 0;
  for (const r of routines(h)) {
    if (filter && !r.name.includes(filter)) continue;
    if (!m['_' + r.spec.port]) { console.log(`${r.name.padEnd(26)} SKIP (port not exported)`); continue; }
    if (r.setup) r.setup();
    let n = 0, bad = null, i = 0;
    for (const args of r.cases()) {
      const d = h.compare(r.spec, args, { checkMemory: !r.memoryEvery || i % r.memoryEvery === 0 });
      i++; n++;
      if (d) { bad = `args ${fmt(args)}: ${d}`; break; }
    }
    total++;
    if (bad) fails++;
    console.log(`${r.name.padEnd(26)} ${bad ? 'FAIL ' + bad : `EQUIV ${n} cases`}`);
  }
  const cov = [...h.cpu.used.entries()].sort().map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`interpreter coverage: ${cov}`);
  console.log(`${total - fails}/${total} routines EQUIV`);
  process.exit(fails ? 1 : 0);
}

function fmt(a) { return '[' + a.map((x) => '0x' + (x >>> 0).toString(16)).join(', ') + ']'; }

main().catch((e) => { console.error(e); process.exit(2); });
