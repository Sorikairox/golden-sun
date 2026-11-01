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
    // six words: ax, bx, ay, by in r0-r3, az, bz on the stack (Transform_BuildLookAt's Dot3Fn)
    pure('RelocatedQ16DotProduct', 'RelocatedQ16DotProduct', A('RelocatedQ16DotProduct'), (n) => {
      const o = []; for (const a of S32) for (const b of S32) o.push([a, b, b, a, a, a], [a, b, 0, 0, 0, 0]);
      while (o.length < n) o.push([s32(), s32(), s32(), s32(), s32(), s32()]); return o;
    }, 50000),
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
    {
      name: 'SoundMainBTM', spec: { orig: T('SoundMainBTM'), port: 'SoundMainBTM', returns: 'none' },
      setup: () => fillRandom(EW, 0x1000),
      cases: () => { const o = []; for (let i = 0; i < 500; i++) o.push([EW + 4 * R.range(0, 900)]); return o; },
    },
    {
      name: 'RealClearChain', spec: { orig: T('RealClearChain'), port: 'RealClearChain', returns: 'none' },
      cases: function* () {
        // a channel at EW, a track and neighbours in a small EWRAM area; links null or set at random
        for (let i = 0; i < 2000; i++) {
          const ch = EW, tr = EW + 0x100, pv = EW + 0x200, nx = EW + 0x300;
          fillRandom(EW, 0x400);
          const dv = new DataView(h.mem.buffer);
          dv.setUint32(ch + 44, R() & 3 ? tr : 0, true);
          dv.setUint32(ch + 48, R() & 1 ? pv : 0, true);
          dv.setUint32(ch + 52, R() & 1 ? nx : 0, true);
          yield [ch];
        }
      },
    },
    {
      // depth slots (gOamDepthLists, 256 words below gVBlankCount) with random chains of entries in EWRAM,
      // random matrices; up to and beyond 128 sprites
      name: 'Oam_BuildBufferKernel', spec: { orig: A('Oam_BuildBufferKernel'), port: 'Oam_BuildBufferKernel', returns: 'none' },
      cases: function* () {
        const dv = new DataView(h.mem.buffer);
        const lists = h.addr('gVBlankCount') - 1024, mats = h.addr('gOamMatrices'), cnt = h.addr('gOamMatrixCount');
        for (let i = 0; i < 400; i++) {
          for (let k = 0; k < 256; k++) dv.setUint32(lists + 4 * k, 0, true);
          const n = R.pick([0, 1, 5, 60, 127, 128, 129, 200]);
          for (let k = 0; k < n; k++) {
            const e = EW + 0x1000 + 12 * k, s = lists + 4 * R.range(0, 255);
            dv.setUint32(e, dv.getUint32(s, true), true); dv.setUint32(e + 4, R(), true); dv.setUint32(e + 8, R(), true);
            dv.setUint32(s, e, true);
          }
          for (let k = 0; k < 64; k++) dv.setUint32(mats + 4 * k, R(), true);
          h.mem[cnt] = R.range(0, 32);
          yield [EW + 0x8000];
        }
      },
    },
    {
      name: 'Message_FindArm', spec: { orig: A('Message_FindArm'), port: 'Message_FindArm', returns: 'none' },
      cases: () => { const o = []; for (let b = 0; b < 42; b++) for (let k = 0; k < 256; k += 3) o.push([EW, b * 256 + k]); return o; },
    },
    {
      // real messages: position a reader with the original Message_FindArm, then compare every decode step
      // until the message's 0 (or 400 symbols)
      name: 'Text_DecodeSymbol', spec: { orig: A('Text_DecodeSymbol'), port: 'Text_DecodeSymbol', returns: 'u32' },
      cases: function* () {
        const dv = new DataView(h.mem.buffer);
        for (let i = 0; i < 600; i++) {
          const msg = R.range(0, 41) * 256 + R.range(0, 255);
          h.cpu.call(A('Message_FindArm'), [EW, msg]);
          for (let k = 0; k < 400; k++) {
            yield [EW];
            if (dv.getUint32(EW, true) === 0) break;
          }
        }
      },
    },
    {
      // every resource of the ROM's directory whose first byte is a form the decoder knows (0, 1) or not (2..);
      // streams that are not really tagged LZ make the original run off the regions: skipped, as the game never
      // decodes them
      name: 'Decompress_TaggedLzArm', spec: { orig: A('Decompress_TaggedLzArm'), port: 'Decompress_TaggedLzArm', returns: 'u32' },
      skipOriginalErrors: true,
      cases: function* () {
        const dv = new DataView(h.mem.buffer), dir = A('Resource_DirectoryTable');
        for (let id = 0; id < 1000; id++) {
          const src = dv.getUint32(dir + 4 * id, true);
          if (src < 0x08000000 || src >= 0x08800000) continue;
          yield [src, 0x02004000];
        }
      },
    },
    {
      name: 'Decompress_MoveToFrontLzCommands', spec: { orig: A('Decompress_MoveToFrontLzCommands'), port: 'Decompress_MoveToFrontLzCommands', returns: 'u32' },
      skipOriginalErrors: true,
      cases: function* () {
        const dv = new DataView(h.mem.buffer), dir = A('Resource_DirectoryTable');
        for (let id = 0; id < 1000; id++) {
          const src = dv.getUint32(dir + 4 * id, true);
          if (src < 0x08000000 || src >= 0x08800000) continue;
          yield [src, 0x02004000];
        }
      },
    },
    {
      name: 'Resource_PatchThumbBranch', spec: { orig: A('Resource_PatchThumbBranch'), port: 'Resource_PatchThumbBranch', returns: 'none' },
      cases: function* () {
        const dv = new DataView(h.mem.buffer);
        for (let i = 0; i < 1000; i++) {
          const base = EW + 2 * R.range(0, 64), n = R.range(0, 3000);
          for (let k = 0; k < 2 * n + 8; k += 2) {
            const r = R() & 7;
            dv.setUint16(base + k, r === 0 ? 0xf000 | (R() & 0x7ff) : r === 1 ? 0xf800 | (R() & 0x7ff) : R() & 0xffff, true);
          }
          yield [base, n];
        }
      },
    },
    {
      // random planes with many placeholder pictures (low 12 bits 0xfff); 128 KB of EWRAM in all
      name: 'Tile_ConvertMapGrid', spec: { orig: A('Tile_ConvertMapGrid'), port: 'Tile_ConvertMapGrid', returns: 'none' },
      cases: function* () {
        const dv = new DataView(h.mem.buffer);
        for (let i = 0; i < 12; i++) {
          const pics = 0x02000000, cells = 0x02010000, planes = 0x02030000;
          fillRandom(planes, 0x8000);
          const p = R.pick([2, 4, 50]);
          for (let k = 0; k < 16384; k++) dv.setUint16(pics + 2 * k, R() % p === 0 ? (R() & 0xf000) | 0xfff : R() & 0xffff, true);
          yield [pics, cells, planes];
        }
      },
    },
    {
      // queues of random entries: byte/halfword/word stores, OR/clear read-modify-writes, and DMA entries with the
      // enable bit clear (register writes only: the interpreter runs no DMA) into EWRAM scratch
      name: 'Resource_ExecuteTransfer', spec: { orig: A('Resource_ExecuteTransfer'), port: 'Resource_ExecuteTransfer', returns: 'none' },
      setup: () => fillRandom(EW, 0x1000),
      cases: function* () {
        const dv = new DataView(h.mem.buffer), q = EW + 0x2000;
        for (let i = 0; i < 1500; i++) {
          const n = R.range(1, 20);
          for (let k = 0; k < n; k++) {
            const size = R.range(0, 3);
            const e = q + 4 + 12 * k;
            dv.setUint32(e, R(), true);
            dv.setUint32(e + 4, size === 0 ? 0 : EW + (R.range(0, 0x3f0) & ~(size === 3 ? 3 : size === 2 ? 1 : 0)), true);
            dv.setUint32(e + 8, size === 0 ? ((R() & 0x7ff0) << 16 | (R() & 0xffff)) >>> 0 : (size << 16) | (R.range(0, 3) << 18) | (R() & 0xffff), true);
          }
          yield [q, n];
        }
      },
    },
    {
      // the ROM's own icons (resource Icons: offsets table, entries + 32) and random streams
      name: 'Tile_Decompress4bpp', spec: { orig: A('Tile_Decompress4bpp'), port: 'Tile_Decompress4bpp', returns: 'none' },
      skipOriginalErrors: true,
      cases: function* () {
        const dv = new DataView(h.mem.buffer);
        const dir = A('Resource_DirectoryTable'), icons = dv.getUint32(dir + 4 * 0xf0, true) // ResourceId_Icons (absolute.tsv);
        for (let i = 0; i < 200; i++) {
          const off = dv.getUint16(icons + 2 * i, true);
          yield [icons + off + 32, EW + R.range(0, 64)];
        }
        for (let i = 0; i < 300; i++) { const src = EW + 0x8000 + R.range(0, 255); fillRandom(src, 512); yield [src, EW + R.range(0, 64)]; }
      },
    },
    {
      name: 'Tile_ExpandOpaque', spec: { orig: A('Tile_ExpandOpaque'), port: 'Tile_ExpandOpaque', returns: 'none' },
      cases: function* () {
        for (let i = 0; i < 500; i++) {
          const w = R.range(1, 8), hh = R.range(1, 6);
          fillRandom(EW + 0x8000, w * hh * 64 + 8);
          if (R() & 1) for (let k = 0; k < w * hh * 64; k++) h.mem[EW + 0x8000 + k] &= 15;
          yield [EW + 0x8000, EW + 4 * R.range(0, 32), w, hh];
        }
      },
    },
    {
      name: 'Tile_ExpandMasked', spec: { orig: A('Tile_ExpandMasked'), port: 'Tile_ExpandMasked', returns: 'none' },
      cases: function* () {
        for (let i = 0; i < 500; i++) {
          const w = R.range(1, 8), hh = R.range(1, 6);
          fillRandom(EW, 0x9000);
          for (let k = 0; k < w * hh * 64; k++) { const v = h.mem[EW + 0x8000 + k]; h.mem[EW + 0x8000 + k] = R() & 1 ? 0 : (R() & 3 ? v & 15 : v); }
          yield [EW + 0x8000, EW + 4 * R.range(0, 32), w, hh];
        }
      },
    },
    {
      // run from a RAM copy at 0x03003400 as the game does (the code reads its data words pc-relative and keeps
      // its table cache there: that area is not compared); random streams of puts and skips in every mode, the
      // source at every alignment, gDecodeFillByte random
      name: 'Render_DecodePicture', spec: { orig: 0x03003400, port: 'Render_DecodePicture', returns: 'none', ignore: [[0x03003400, 0x1e4 + 224]] },
      setup: () => { const a = A('Render_DecodePicture'); h.mem.copyWithin(0x03003400, a, a + 0x1e4 + 224); },
      cases: function* () {
        const fill = A('gDecodeFillByte');
        for (let i = 0; i < 4000; i++) {
          const src = EW + 0x8000 + R.range(0, 255), n = R.range(0, 600);
          for (let k = 0; k < n; k++) h.mem[src + k] = R() & 3 ? R.range(1, 223) : R.range(1, 255);
          h.mem[src + n] = 0;
          h.mem[fill] = R() & 0xff;
          yield [src, EW + R.range(0, 255), i < 32 ? i % 16 : R.range(0, 15)];
        }
      },
    },
    {
      // battle backgrounds (background_decode.s): run from a RAM copy (the original relocates its handler table
      // inside the copy, ignored), on random bit streams: uniform bytes and streams biased to each command kind,
      // the source at either halfword alignment; the whole 30720-byte output is compared
      name: 'BitDecoder_DecodeImage', spec: { orig: 0x03003400, port: 'BitDecoder_DecodeImage', returns: 'none', ignore: [[0x03003400, 0x230]] },
      setup: () => { const a = A('BitDecoder_DecodeImage'); h.mem.copyWithin(0x03003400, a, a + 0x230); },
      memoryEvery: 1,
      cases: function* () {
        for (let i = 0; i < 400; i++) {
          const src = EW + 0x10000 + 2 * R.range(0, 8), kind = i % 9;
          for (let k = 0; k < 40000; k += 2) {
            let hw = R() & 0xffff;
            if (kind < 8) { // bias: every 4th-ish nibble group forced to command kind `kind`
              if ((R() & 3) === 0) hw = (hw & ~7) | kind;
            }
            h.mem[src + k] = hw & 0xff; h.mem[src + k + 1] = hw >> 8;
          }
          yield [src, EW + 4 * R.range(0, 16)];
        }
      },
    },
    {
      // battle effect blitters: BattleEffect_BuildBlitter (vendor C in wasm, Port_CallCode5) writes the ARM routine
      // for each canvas width (128, 256 pixels), clip/mirror flags (0-15) and mode (copy, transparent, lighten,
      // additive) into heap slot 46 (preset to EWRAM 0x0203c000, so the slot keeps it), and registers the C
      // blitter for it (port/pc/blitter.c); the interpreter runs those ARM words, the port calls the address
      // (Port_CallRam6). Random canvases, pictures (zeros included), positions in and around the canvas.
      name: 'BattleEffect blitters', spec: {
        orig: 0x0203c000, port: 'Port_CallRam6', returns: 'u32',
        call: (...a) => h.m._Port_CallRam6(0x0203c000, ...a),
      },
      memoryEvery: 1,
      cases: function* () {
        const dv = new DataView(h.mem.buffer);
        const CANVAS = EW, PIC = EW + 0x10000;
        for (const ws of [7, 8]) for (let flags = 0; flags < 16; flags++) for (let mode = 0; mode < 4; mode++) {
          dv.setUint32(0x03001e50 + 46 * 4, 0x0203c000, true);
          h.m._Port_CallCode5(A('BattleEffect_BuildBlitter'), 46, ws, 7, flags, mode);
          for (let i = 0; i < 40; i++) {
            for (let k = 0; k < 0x9000; k++) h.mem[CANVAS + k] = R() & 1 ? R() & 63 : R() & 0xff;
            for (let k = 0; k < 0x1000; k++) h.mem[PIC + k] = R() & 1 ? 0 : (R() & 1 ? R() & 63 : R() & 0xff);
            const w = R() & 1 ? 8 * R.range(0, 8) : R.range(0, 64), hh = R() & 1 ? 8 * R.range(0, 8) : R.range(0, 64);
            yield [CANVAS + (i % 10 === 9 ? R.range(0, 3) : 0), PIC + R.range(0, 64), R.range(-80, (1 << ws) + 16), R.range(-80, 144), w, hh];
          }
        }
      },
    },
    // palette fade kernels (decompress_byte_lz.s): ramp-step buffers (mostly 0..63, some any byte, some words all
    // 0 or all 63), 16-1024 bytes, amounts as one step in every byte (or any word); buffer EW, backup EW+0x4000
    ...['PaletteFade_BrightenKernel', 'PaletteFade_BrightenPartialKernel', 'PaletteFade_DarkenKernel',
      'PaletteFade_DarkenPartialKernel', 'PaletteFade_ScaleThreeQuartersKernel',
      'PaletteFade_ScaleNonzeroThreeQuartersKernel', 'PaletteFade_HalveKernel', 'PaletteFade_HalveNonzeroKernel'].map((name) => ({
      name, spec: { orig: A(name), port: name, returns: 'none' },
      memoryEvery: 1,
      cases: function* () {
        const amount = !/Scale|Halve/.test(name);
        for (let i = 0; i < 1500; i++) {
          const bytes = 16 * R.range(1, 64);
          for (let k = 0; k < bytes; k += 4) {
            const kind = R() & 7;
            for (let j = 0; j < 4; j++) h.mem[EW + k + j] = kind === 0 ? 0 : kind === 1 ? 63 : kind === 2 ? R() & 0xff : R() & 63;
          }
          const a = R() & 15 ? R.range(0, 63) * 0x01010101 : R() >>> 0;
          yield amount ? [EW, a >>> 0, EW + 0x4000, bytes] : [EW, EW + 0x4000, bytes];
        }
      },
    })),
    {
      name: 'Tile_CopyStrided', spec: { orig: A('Tile_CopyStrided'), port: 'Tile_CopyStrided', returns: 'none' },
      setup: () => fillRandom(EW + 0x8000, 0x8000),
      cases: () => {
        const o = [];
        for (let i = 0; i < 1500; i++) {
          const w = R() & 3 ? 8 * R.range(0, 8) : R.range(0, 70), hh = R() & 3 ? 8 * R.range(0, 8) : R.range(0, 70);
          o.push([EW + 0x8000 + 4 * R.range(0, 64), w, hh, R() & 1 ? 0x06010000 + 32 * R.range(0, 100) : EW + 4 * R.range(0, 64)]);
        }
        return o;
      },
    },
    {
      // credits slides (menu/credits_background_decode.s, GS9): BitDecoder_DecodeImage's decoder with the pixel
      // offset as an argument; run from a RAM copy (its command table relocated inside the copy, ignored), random
      // bit streams biased to each command kind, offsets 0, 0x80808080 and random
      name: 'Credits_DecodeBackground', spec: { orig: 0x03003400, port: 'Credits_DecodeBackground', returns: 'none', ignore: [[0x03003400, 0x230]] },
      setup: () => { const a = A('Credits_DecodeBackground'); h.mem.copyWithin(0x03003400, a, a + 0x230); },
      memoryEvery: 1,
      cases: function* () {
        for (let i = 0; i < 300; i++) {
          const src = EW + 0x10000 + 2 * R.range(0, 8), kind = i % 9;
          for (let k = 0; k < 40000; k += 2) {
            let hw = R() & 0xffff;
            if (kind < 8 && (R() & 3) === 0) hw = (hw & ~7) | kind;
            h.mem[src + k] = hw & 0xff; h.mem[src + k + 1] = hw >> 8;
          }
          yield [src, EW + 4 * R.range(0, 16), [0, 0x80808080, R() >>> 0][i % 3]];
        }
      },
    },
    {
      // World Map still picture (field/picture_decode.s, GS9): 160 random affine lines (pa/pc small, large and
      // 0; x/y anywhere), a 64x64 BG2 map over a BG3 map 4096 bytes lower and 8bpp tiles over BG3's 16384 bytes
      // lower, both with many zeros (the fallback); the whole 240x160 output is compared
      name: 'TileMap_DrawRows', spec: { orig: A('TileMap_DrawRows'), port: 'TileMap_DrawRows', returns: 'none' },
      memoryEvery: 1,
      cases: function* () {
        const lines = EW, map = EW + 0x3000, tiles = EW + 0x8000, out = EW + 0xc000;
        for (let i = 0; i < 120; i++) {
          const zeros = [0, 2, 8, 32][i & 3];
          for (let k = 0; k < 0x2000; k++) h.mem[EW + 0x2000 + k] = R.range(0, 99) < zeros ? 0 : R() & 0xff;
          for (let k = 0; k < 0x8000; k++) h.mem[EW + 0x4000 + k] = R.range(0, 99) < zeros ? 0 : R() & 0xff;
          const big = i % 5 === 0, still = i % 7 === 0;
          for (let l = 0; l < 160; l++) {
            const a = lines + 32 * l;
            for (let k = 0; k < 32; k++) h.mem[a + k] = R() & 0xff;
            const pa = still ? 0 : big ? R() & 0xffff : R.range(-600, 600) & 0xffff, pc = i % 3 === 0 ? 0 : big ? R() & 0xffff : R.range(-600, 600) & 0xffff;
            h.mem[a] = pa & 0xff; h.mem[a + 1] = pa >> 8; h.mem[a + 4] = pc & 0xff; h.mem[a + 5] = pc >> 8;
          }
          yield [lines, out, tiles, map];
        }
      },
    },
    {
      // random valid streams: zero flag bytes (eight literals), literals, short matches (n 1-15), long matches
      // (count byte), distances reaching before the output (into earlier random bytes), the end marker; the
      // source at every alignment
      name: 'Decompress_ByteLzArm', spec: { orig: A('Decompress_ByteLzArm'), port: 'Decompress_ByteLzArm', returns: 'u32' },
      cases: function* () {
        for (let i = 0; i < 2500; i++) {
          const out = [];
          let items = R.range(0, 200);
          while (items > 0) {
            if ((R() & 7) === 0) { out.push(0); for (let k = 0; k < 8; k++) out.push(R() & 0xff); items -= 8; continue; }
            const bits = []; let flags = 0;
            for (let k = 0; k < 8; k++) {
              const isMatch = k === 0 || (R() & 1); // bit 7 set: a mixed flag byte (0 is the eight-literal form)
              flags |= isMatch << (7 - k);
              if (!isMatch) bits.push(R() & 0xff);
              else {
                const dist = R.range(1, 0xfff), len = R.range(0, 15);
                bits.push(((dist >> 8) << 4) | len, dist & 0xff);
                if (len === 0) bits.push(R() & 0xff);
              }
            }
            out.push(flags, ...bits); items -= 8;
          }
          out.push(0x80, 0x00, 0x00); // a match of n 0 at distance 0: the end
          const src = EW + 0x10000 + R.range(0, 255);
          h.mem.set(out, src);
          fillRandom(EW, 0x1000);
          yield [src, EW + 0x1000 + R.range(0, 64)];
        }
      },
    },
    {
      // vendor C (not a hand port): PaletteFade_Build compiled to wasm vs the ROM's Thumb code, through
      // Port_CallCode4. The storm night's dark/lit colours (PALETTE_TINT_WARM/PALE) and every other tint
      // computed per colour; one-colour and ready-buffer modes (DMA copies) are not covered.
      name: 'PaletteFade_Build', spec: {
        orig: T('PaletteFade_Build'), port: 'Port_CallCode4', returns: 'none',
        call: (...a) => h.m._Port_CallCode4(A('PaletteFade_Build'), ...a),
      },
      cases: function* () {
        const modes = [0x10000, 0x10001, 0x10002, 0x10003, 0x10004, 0x10005, 0x10006, 0x10007, 0x10008, 0x1ffff];
        for (let i = 0; i < 1200; i++) {
          let mode = modes[i % modes.length];
          if (i % 13 === 11) mode = 0x200000 | (R() & 0x7fff);
          if (i % 13 === 12) mode = 0x400000 | ((R() & 0x7fff) | 1);
          if (i % 29 === 28) mode = 0x800000 | (R() & 0x7fff);
          const src = EW + 2 * R.range(0, 64), dst = EW + 0x1000 + 2 * R.range(0, 64);
          for (let k = 0; k < 448; k++) {
            const c = (R() & 7) === 0 ? R.pick([0, 0x7fff, 0x001f, 0x03e0, 0x7c00]) : R() & 0xffff;
            h.mem[src + 2 * k] = c & 0xff; h.mem[src + 2 * k + 1] = c >> 8;
          }
          yield [mode, src, dst, R.range(0, 2)];
        }
      },
      memoryEvery: 1,
    },
    // GS-audio: the m4a track commands (clear_buffer.s) on random tracks; player at EW, track at EW+0x100, the
    // command stream at EW+0x800, a voice table at EW+0x1000; SoundInfo (for TrackStop's cgbMute) at EW+0x4000
    ...['ply_goto', 'ply_patt', 'ply_pend', 'ply_rept', 'ply_prio', 'ply_tempo', 'ply_keysh', 'ply_voice', 'ply_vol',
      'ply_pan', 'ply_bend', 'ply_bendr', 'ply_lfos', 'ply_lfodl', 'ply_mod', 'ply_modt', 'ply_tune', 'ply_port',
      'ply_endtie', 'ply_fine', 'TrackStop'].map((name) => ({
      name, spec: { orig: T(name), port: name, returns: 'none' },
      cases: function* () {
        const dv = new DataView(h.mem.buffer);
        const P = EW, TR = EW + 0x100, CMD = EW + 0x800, SI = EW + 0x4000;
        for (let i = 0; i < 1500; i++) {
          fillRandom(EW, 0x1800);
          dv.setUint32(TR + 64, CMD + R.range(0, 64), true);
          if (name === 'ply_port') for (let k = 0; k < 0x100; k++) h.mem[CMD + k] &= 0x3f; // registers 0x60-0x9f
          if (name === 'ply_rept' && R() & 1) h.mem[CMD + R.range(0, 64)] = 0;
          if (name === 'ply_endtie' && R() & 1) for (let k = 0; k < 0x100; k++) h.mem[CMD + k] &= 0x7f;
          dv.setUint32(P + 48, EW + 0x1000, true);
          h.mem[TR + 2] = R.range(0, 4);
          // a chain of 0-3 channels at EW+0x200.. linked to the track
          const n = R.range(0, 3);
          dv.setUint32(TR + 32, n ? EW + 0x200 : 0, true);
          for (let k = 0; k < n; k++) {
            const c = EW + 0x200 + 64 * k;
            dv.setUint32(c + 44, TR, true);
            dv.setUint32(c + 48, k ? c - 64 : 0, true);
            dv.setUint32(c + 52, k + 1 < n ? c + 64 : 0, true);
            if (R() & 1) h.mem[c + 1] &= 0xf8; // PCM or CGB
            if (name === 'ply_endtie' && R() & 1) h.mem[c + 17] = h.mem[TR + 5];
          }
          dv.setUint32(0x03007ff0, SI, true);
          dv.setUint32(SI + 44, A('DummyFunc') | 1, true);
          yield [P, TR];
        }
      },
    })),
    {
      // Mixer_Enter + the resident IWRAM mixer: a SoundInfo with 1-12 random channels (envelope phases, PCM waves
      // looped or not, fixed rate, synth waves of the three kinds, counts ending inside the frame), random
      // workspace, buffers and reverb code (one of the five ROM codes in IWRAM); one whole VBlank of 352 samples.
      // The original runs with its stack in IWRAM below 0x03007800 (so it never takes its sample-DMA-to-stack path)
      // and patches its own code: those areas are not compared.
      name: 'Mixer_Enter', spec: {
        orig: T('Mixer_Enter'), port: 'Mixer_Enter', returns: 'none', sp: 0x03007800,
        ignore: [[0x03000658, 0x504], [0x03000b60, 0x298], [0x03007000, 0x800]],
      },
      cases: function* () {
        const dv = new DataView(h.mem.buffer);
        const SI = 0x02030000, WAVES = 0x02034000;
        for (let i = 0; i < 300; i++) {
          fillRandom(0x02030000, 0x8000);
          fillRandom(0x03000df8, 1424);
          const code = R.range(0, 4);
          h.mem.copyWithin(0x03000bd8, 0x08000404 + 152 * code, 0x08000404 + 152 * code + 152);
          dv.setUint32(0x03007ff0, SI, true);
          dv.setUint32(SI, 0x68736d53, true);
          dv.setUint32(SI + 32, 0, true);
          dv.setUint32(SI + 40, A('DummyFunc') | 1, true);
          h.mem[SI + 4] = R.range(0, 5); h.mem[SI + 11] = 4;
          dv.setUint32(SI + 16, 352, true);
          dv.setUint32(SI + 24, R.pick([399, 400, 380, 420]), true); // rateStep: 2^23 / 21024
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
            h.mem[c] = R.pick([0x80, 0xc0, 0x83, 0x82, 0x81, 0x93, 0x92, 0x43, 0x53, 0x04, 0x14, 0x03, 0x02, 0x01, 0x00]) & 0xff;
            h.mem[c + 1] = R.pick([0, 0, 0, 8, 0x40]);
            h.mem[c + 13] = R.range(0, 3);
            let cnt = R.pick([0, 1, 5, 200, 400, 2000, size]);
            if (h.mem[c + 1] === 8 && (!cnt || !size || (h.mem[c] & 0x80))) { // a fixed-rate wave of 0 samples mixes forever in the original
              h.mem[c + 1] = 0;
            }
            dv.setUint32(c + 24, cnt, true);
            dv.setUint32(c + 40, w + 16 + R.range(0, 200), true);
            dv.setUint32(c + 28, R() & 0x7fffff, true);
            dv.setUint32(c + 32, R.pick([0x800, 0x2000, 0x5000, 0x5200, 0x8000, 0xa000, 0x14000, 0x28000]) + (R() & 0xfff), true); // steps 0.1 to 13
            if (R() & 1) h.mem[w + 16 + 1 + R.range(0, 200)] = R.range(0, 2); // synth kinds 0/1/other
          }
          yield [];
        }
      },
      memoryEvery: 1,
    },
    { name: 'Bios_SoundBiasOn', spec: { orig: T('Bios_SoundBiasOn'), port: 'Bios_SoundBiasOn', returns: 'none' }, cases: () => [[], []], setup: () => { h.mem[0x04000088] = 0x55; h.mem[0x04000089] = 0xc3; } },
    { name: 'Bios_SoundBiasOff', spec: { orig: T('Bios_SoundBiasOff'), port: 'Bios_SoundBiasOff', returns: 'none' }, cases: () => [[], []] },
    // GS11 (trap 36): the cartridge entry up to its call of System_Initialize (stacks are registers, not compared;
    // the IRQ vector word at 0x03007FFC is). setup puts a random word there first, so the store is seen.
    { name: 'System_Entry', spec: { orig: A('System_Entry'), port: 'Port_SystemEntryPrologue', returns: 'u32', stopAt: h.addr('System_Initialize') & ~1 },
      cases: () => [[], [], [], []], setup: () => { for (let i = 0; i < 4; i++) h.mem[0x03007ffc + i] = R() & 0xff; } },
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
    let n = 0, bad = null, i = 0, skipped = 0;
    for (const args of r.cases()) {
      // arguments past the fourth go on the stack (AAPCS), as the original reads them
      const d = h.compare(r.spec, args.slice(0, 4), { checkMemory: !r.memoryEvery || i % r.memoryEvery === 0, stackArgs: args.slice(4) });
      i++;
      if (d && r.skipOriginalErrors && d.startsWith('original:')) { skipped++; continue; }
      n++;
      if (d) { bad = `args ${fmt(args)}: ${d}`; break; }
    }
    total++;
    if (bad) fails++;
    console.log(`${r.name.padEnd(26)} ${bad ? 'FAIL ' + bad : `EQUIV ${n} cases`}${skipped ? ` (${skipped} inputs the original cannot run, skipped)` : ''}`);
  }
  const cov = [...h.cpu.used.entries()].sort().map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`interpreter coverage: ${cov}`);
  console.log(`${total - fails}/${total} routines EQUIV`);
  process.exit(fails ? 1 : 0);
}

function fmt(a) { return '[' + a.map((x) => '0x' + (x >>> 0).toString(16)).join(', ') + ']'; }

main().catch((e) => { console.error(e); process.exit(2); });
