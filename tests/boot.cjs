// Boot runner (G3): loads game.js in node, writes the player's ROM to 0x08000000, runs main (the game's own
// System_Initialize) for N frames and writes PNG captures of chosen frames to port_work/g3/ (gitignored: they
// show the game). Keys can be held over frame ranges. Prints the game's log, stub hits and a summary.
// Usage: node tests/boot.cjs build/wasm/game.js ROM FRAMES [--shot 60,120,...] [--keys START@300-305,A@400-402]
//        [--out port_work/g3] [--quiet]
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
  const keySpans = (opt('--keys', '') || '').split(',').filter(Boolean).map((s) => {
    const [k, r] = s.split('@'); const [a, b] = r.split('-').map(Number);
    return { mask: k.split('+').reduce((m, n) => m | KEY[n], 0), a, b: b ?? a };
  });
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
      if (shots.has(frame)) {
        const p = m._Port_FrameBuffer();
        const buf = Buffer.from(m.HEAPU8.buffer, p, 240 * 160 * 4);
        const file = path.join(out, `frame_${String(frame).padStart(5, '0')}.png`);
        fs.writeFileSync(file, png(Buffer.from(buf), 240, 160));
      }
      let keys = 0;
      for (const s of keySpans) if (frame >= s.a && frame <= s.b) keys |= s.mask;
      m._Port_SetKeys(keys);
      if (frame >= frames) { done(); return new Promise(() => {}); } // suspend the game for good
      return undefined;
    },
  });
  m.HEAPU8.set(fs.readFileSync(romPath), 0x08000000);
  const t0 = Date.now();
  try { m.callMain([]); } catch (e) { console.error('game stopped:', e.stack || e); done(); }
  await Promise.race([finished, new Promise((r) => setTimeout(r, 600000))]);
  const ms = Date.now() - t0;
  console.log(`boot: ${frame} frames in ${ms} ms (${(frame / (ms / 1000)).toFixed(0)} fps); ${m._Port_StubHits()} distinct stubs hit; captures in ${path.relative(process.cwd(), out)}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(2); });
