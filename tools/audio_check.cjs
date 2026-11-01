// Audio sanity of a WAV dumped by tests/probes/wav.cjs: per window (default 1 s) RMS, peak, clipped share and the
// strongest frequencies (a plain DFT of the mono mix, 20 Hz bins up to 4 kHz); SHA-1 of the samples for
// run-to-run determinism. Usage: node tools/audio_check.cjs FILE.wav [window_s] [from_s] [to_s]
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const [file, winArg, fromArg, toArg] = process.argv.slice(2);
const b = fs.readFileSync(file);
const rate = b.readUInt32LE(24), data = b.subarray(44);
const n = data.length / 4, win = Math.round((+winArg || 1) * rate);
const from = Math.round((+fromArg || 0) * rate), to = Math.min(n, toArg ? Math.round(+toArg * rate) : n);
console.log(`${file}: ${(n / rate).toFixed(2)} s, ${rate} Hz, sha1 ${crypto.createHash('sha1').update(data).digest('hex').slice(0, 16)}`);
let nonSilentWindows = 0, windows = 0;
for (let s = from; s + win <= to; s += win) {
  let sl = 0, sr = 0, peak = 0, clip = 0;
  const mono = new Float32Array(win);
  for (let i = 0; i < win; i++) {
    const l = data.readInt16LE((s + i) * 4), r = data.readInt16LE((s + i) * 4 + 2);
    sl += l * l; sr += r * r;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    if (Math.abs(l) >= 32704 || Math.abs(r) >= 32704) clip++;
    mono[i] = (l + r) / 65536;
  }
  const rmsL = Math.sqrt(sl / win), rmsR = Math.sqrt(sr / win);
  // DFT magnitudes on a 4096-sample slice, bins of rate/4096 (8 Hz), report the top 3 peaks between 40 Hz and 4 kHz
  const N = Math.min(4096, win), mags = [];
  for (let k = Math.ceil(40 * N / rate); k < 4000 * N / rate; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < N; i++) { const a = 2 * Math.PI * k * i / N; re += mono[i] * Math.cos(a); im -= mono[i] * Math.sin(a); }
    mags.push([Math.hypot(re, im), k * rate / N]);
  }
  mags.sort((x, y) => y[0] - x[0]);
  const top = [];
  for (const [m, f] of mags) { if (top.every((t) => Math.abs(t - f) > 30)) top.push(f); if (top.length === 3) break; }
  windows++;
  if (rmsL + rmsR > 200) nonSilentWindows++;
  console.log(`  ${(s / rate).toFixed(1).padStart(6)}s rms L ${rmsL.toFixed(0).padStart(5)} R ${rmsR.toFixed(0).padStart(5)} peak ${String(peak).padStart(5)} clipped ${(100 * clip / win).toFixed(2)}% top ${top.map((f) => f.toFixed(0) + ' Hz').join(', ')}`);
}
console.log(`${nonSilentWindows}/${windows} windows not silent`);
