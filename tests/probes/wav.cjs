// Test probe (tests/boot.cjs --probe): drains the PC layer's audio ring (port/pc/apu.c, 32768 Hz stereo s16)
// every frame and writes it as a WAV when node exits. File: $WAV (default port_work/audio/boot.wav, gitignored);
// $WAV_FROM=N skips the first N frames.
'use strict';
const fs = require('fs');
const path = require('path');
const file = path.resolve(process.env.WAV || path.join(__dirname, '../../port_work/audio/boot.wav'));
const from = +(process.env.WAV_FROM || 0);
const chunks = [];
let rate = 32768, ptr = 0;
module.exports = (m, frame) => {
  if (!ptr) { ptr = m._Port_AudioBuffer(); rate = m._Port_AudioRate(); }
  for (;;) {
    const n = m._Port_AudioDrain();
    if (!n) break;
    if (frame > from) chunks.push(Buffer.from(m.HEAPU8.buffer.slice(ptr, ptr + n * 4)));
    if (n < 4096) break;
  }
};
process.on('exit', () => {
  const data = Buffer.concat(chunks);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([h, data]));
  console.log(`wav: ${(data.length / 4 / rate).toFixed(2)} s at ${rate} Hz -> ${path.relative(process.cwd(), file)}`);
});
