// Test-only battle bot for tests/boot.cjs --probe (GS16): records its keys. It reads the battle screen's command box
// (an md5 of x 186..233, y 142..152 of the frame): "Fight" -> A; a member's "Attack" -> A, RIGHT x BB_R, A (attacks the
// enemy right of the default target); anything else (messages) -> A every 40 frames. From BB_AT to BB_END, then prints
// "bb keys: ...". The two hashes are of the English build's rendering; a renderer change that alters them shows as a
// bot that only taps A.
'use strict';
const crypto = require('crypto');
const AT = +process.env.BB_AT, END = +process.env.BB_END, R = +(process.env.BB_R || 1);
const FIGHT = 'f2a3d0a7', ATTACK = '7cce568c';
const KEY = { A: 1, B: 2, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128 };
let spans = [], seq = null, t0 = 0, lastTap = 0, stable = 0, lastLab = '', done = false;
module.exports = (m, frame, keys) => {
  if (done || frame < AT) return;
  const press = (k) => { m._Port_SetKeys(keys | KEY[k]); const s = spans[spans.length - 1]; if (s && s.k === k && s.b === frame - 1) s.b = frame; else spans.push({ k, a: frame, b: frame }); };
  if (frame >= END) { done = true; console.log(`bb keys: ${spans.map((s) => `${s.k}@${s.a}-${s.b}`).join(',')}`); return; }
  const p = m._Port_FrameBuffer(), H = m.HEAPU8, h = crypto.createHash('md5');
  for (let y = 142; y < 153; y++) h.update(H.subarray(p + (y * 240 + 186) * 4, p + (y * 240 + 234) * 4));
  const lab = h.digest('hex').slice(0, 8);
  if (lab === lastLab) stable++; else { stable = 0; lastLab = lab; }
  if (seq) { const d = frame - t0; const st = seq.find((s) => d >= s[0] && d < s[0] + 4); if (st) press(st[1]); if (d > seq[seq.length - 1][0] + 10) seq = null; return; }
  if (lab === FIGHT && stable === 10) { seq = [[0, 'A']]; t0 = frame; return; }
  if (lab === ATTACK && stable === 10) { seq = [[0, 'A']]; for (let i = 0; i < R; i++) seq.push([25 + 20 * i, 'RIGHT']); seq.push([45 + 20 * R, 'A']); t0 = frame; return; }
  if (lab !== FIGHT && lab !== ATTACK && frame - lastTap >= 40) { lastTap = frame; seq = [[0, 'A']]; t0 = frame; }
};
