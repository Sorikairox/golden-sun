// Boot runner (G3): loads game.js in node, writes the player's ROM to 0x08000000, runs main (the game's own
// System_Initialize) for N frames and writes PNG captures of chosen frames to port_work/g3/ (gitignored: they
// show the game). Keys can be held over frame ranges. Prints the game's log, stub hits and a summary.
// Usage: node tests/boot.cjs build/wasm/game.js ROM FRAMES [--shot 60,120,...] [--keys START@300-305,A@400-402]
//        [--out port_work/g3] [--quiet] [--every N] [--flash-in FILE] [--flash-out FILE]
// Keys: NAME[+NAME]@A-B holds over frames A..B; NAME@A-B/P taps (3 frames held) every P frames in A..B.
// --keys-file FILE: key specs one or more per line (comma separated, # comments), added to --keys.
// --regs F1,F2 prints the display registers at those frames (palette RAM to OUT/palette_F.bin); --every N also captures every N-th frame; --flash-in loads a 64 KB save before power-on; --flash-out writes the
// flash region whenever the game programs it (both files belong in port_work/: they hold game data).
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const KEY = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };

function png(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function main() {
  const args = process.argv.slice(2);
  const [gameJs, romPath, framesArg] = args;
  const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
  const frames = +framesArg || 300;
  const shots = new Set((opt('--shot', '') || '').split(',').filter(Boolean).map(Number));
  const out = opt('--out', path.resolve(__dirname, '../port_work/g3'));
  const quiet = args.includes('--quiet');
  const keyFile = opt('--keys-file', '');
  const keyText = [opt('--keys', ''), keyFile ? fs.readFileSync(keyFile, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean).join(',') : '']
    .filter(Boolean).join(',');
  const keySpans = keyText.split(',').filter(Boolean).map((s) => {
    const [k, r0] = s.split('@'); const [r, per] = r0.split('/'); const [a, b] = r.split('-').map(Number);
    return { mask: k.split('+').reduce((m, n) => m | KEY[n], 0), a, b: b ?? a, per: +per || 0 };
  });
  const every = +opt('--every', 0);
  const regFrames = new Set((opt('--regs', '') || '').split(',').filter(Boolean).map(Number));
  const flashIn = opt('--flash-in', ''), flashOut = opt('--flash-out', '');
  let flashGen = 0;
  fs.mkdirSync(out, { recursive: true });
  const log = [];
  let frame = 0, m, done;
  const finished = new Promise((r) => { done = r; });
  const factory = require(path.resolve(gameJs));
  m = await factory({
    print: (s) => { log.push(s); if (!quiet) console.log(s); },
    printErr: (s) => { log.push(s); console.error(s); },
    onFrame: () => {
      frame++;
      if (flashOut && m._Port_FlashGeneration() !== flashGen) {
        flashGen = m._Port_FlashGeneration();
        fs.writeFileSync(flashOut, Buffer.from(m.HEAPU8.buffer, m._Port_FlashMemory(), 65536));
        console.log(`boot: flash written at frame ${frame} -> ${flashOut}`);
      }
      if (regFrames.has(frame)) {
        const io = (o) => m.HEAPU8[0x04000000 + o] | m.HEAPU8[0x04000001 + o] << 8;
        const hx = (o) => io(o).toString(16).padStart(4, '0');
        console.log(`regs f${frame}: DISPCNT ${hx(0)} BG0-3CNT ${hx(8)} ${hx(10)} ${hx(12)} ${hx(14)} WIN0H ${hx(0x40)} WIN0V ${hx(0x44)} WININ ${hx(0x48)} WINOUT ${hx(0x4a)} MOSAIC ${hx(0x4c)} BLDCNT ${hx(0x50)} BLDALPHA ${hx(0x52)} BLDY ${hx(0x54)}`);
        fs.writeFileSync(path.join(out, `palette_${frame}.bin`), Buffer.from(m.HEAPU8.subarray(0x05000000, 0x05000400)));
      }
      if (shots.has(frame) || (every && frame % every === 0)) {
        const p = m._Port_FrameBuffer();
        const buf = Buffer.from(m.HEAPU8.buffer, p, 240 * 160 * 4);
        const file = path.join(out, `frame_${String(frame).padStart(5, '0')}.png`);
        fs.writeFileSync(file, png(Buffer.from(buf), 240, 160));
      }
      let keys = 0;
      for (const s of keySpans) if (frame >= s.a && frame <= s.b && (!s.per || (frame - s.a) % s.per < 3)) keys |= s.mask;
      m._Port_SetKeys(keys);
      if (frame >= frames) { done(); return new Promise(() => {}); } // suspend the game for good
      return undefined;
    },
  });
  m.HEAPU8.set(fs.readFileSync(romPath), 0x08000000);
  if (flashIn) { m.HEAPU8.set(fs.readFileSync(flashIn), m._Port_FlashMemory()); m._Port_KeepFlash(); }
  const t0 = Date.now();
  try { m.callMain([]); } catch (e) { console.error('game stopped:', e.stack || e); done(); }
  await Promise.race([finished, new Promise((r) => setTimeout(r, 600000))]);
  const ms = Date.now() - t0;
  console.log(`boot: ${frame} frames in ${ms} ms (${(frame / (ms / 1000)).toFixed(0)} fps); ${m._Port_StubHits()} distinct stubs hit; captures in ${path.relative(process.cwd(), out)}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(2); });
