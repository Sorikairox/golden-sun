// TEST-ONLY probe for tests/boot.cjs --probe (TLA8; never in the shipped page): at frame PW_AT (env) finds the
// password GS1's File Screen shows (FileScreen_Run's local symbol buffer, filled by FileScreen_EncodePassword) by its
// own structure: symbol i is (raw + i) mod 64, and every 10th raw symbol is the sum of the nine before it, mod 64.
// The buffer is a C local, so it lives on the wasm stack, not in GBA RAM: the whole linear memory is scanned for the
// longest run that checks, maps the symbols to the characters
// FileScreen_NameEntryCharacter draws (English), and writes them to PW_OUT (a file in port_work/: a password is
// derived from save data, never commit it). Prints only the length and a checksum.
'use strict';
const fs = require('fs');
const AT = +(process.env.PW_AT || 0), BEFORE = +(process.env.PW_BEFORE || 0), OUT = process.env.PW_OUT || '', N = +(process.env.PW_N || 0);
const glyph = (c) => (c <= 7 ? String.fromCharCode(c + 65) : c <= 12 ? String.fromCharCode(c + 66) : c <= 23 ? String.fromCharCode(c + 67)
  : c <= 31 ? String.fromCharCode(c + 26) : c <= 42 ? String.fromCharCode(c + 65) : c <= 44 ? String.fromCharCode(c + 66)
  : c <= 55 ? String.fromCharCode(c + 67) : '!?#&$%+='[c - 56]);
let snap = null;
function find(H, base, size) {
  let best = null;
  for (let p = base; p < base + size - 16; p++) {
    if (p >= 0x08000000 && p < 0x0a000000) p = 0x0a000000; // not the ROM (its tables hold runs that check)
    if (H[p] > 63) continue;
    if (snap && snap[p] === H[p] && snap[p + 1] === H[p + 1] && snap[p + 2] === H[p + 2]) continue;
    let g = 0, n = 0;
    for (;; g++) {
      let ok = true, sum = 0;
      for (let j = 0; j < 10; j++) {
        const b = H[p + 10 * g + j];
        if (b > 63) { ok = false; break; }
        const raw = (b - (10 * g + j)) & 63;
        if (j < 9) sum += raw; else if ((sum & 63) !== raw) ok = false;
      }
      if (!ok) break;
    }
    if (g < 1) continue;
    n = 10 * g;
    // a shorter last group carries no check symbol: take symbols while they are below 64 (at most 9)
    let k = 0; while (k < 9 && H[p + n + k] <= 63) k++;
    if (N) { if (n === 10 * Math.floor(N / 10) && k >= N % 10) (best = best || []).push({ p, n, tail: k }); }
    else if (!best || n > best.n) best = { p, n, tail: k };
  }
  return best;
}
// PW_BEFORE: a frame before the password is made (e.g. on the level menu); only runs that changed since are taken,
// which rules out tables and old buffers that happen to check.
module.exports = (m, frame) => {
  if (BEFORE && frame === BEFORE) snap = Buffer.from(m.HEAPU8);
  if (frame !== AT) return;
  const H = m.HEAPU8;
  // PW_ADDR: the buffer's address a longer password (Gold) was found at in the same run of FileScreen_Run (a Bronze
  // password has one check group, which hundreds of places match by chance)
  const at = parseInt(process.env.PW_ADDR || '0', 16);
  let c = at ? find(H, at, 17) : find(H, 0, H.length);
  if (at && c && !Array.isArray(c)) c = [c];
  if (N && c) { if (c.length > 1) console.log(`password f${frame}: ${c.length} candidates of the length, first taken: ${c.map((x) => '0x' + x.p.toString(16)).join(' ')}`); c = c[0]; }
  if (!c) { console.log(`password f${frame}: none found`); return; }
  console.log(`password f${frame}: ${c.n} checked symbols + up to ${c.tail} trailing at 0x${c.p.toString(16)}`);
  // PW_N: the level's symbol count (Gold 260, Silver 61, Bronze 16: FileScreen_EncodePassword of 175, 41, 11 bytes)
  const n = N || c.n + c.tail;
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ at: c.p, checked: c.n, n,
    symbols: Array.from(H.subarray(c.p, c.p + n)), text: Array.from(H.subarray(c.p, c.p + n), glyph).join('') }) + '\n');
};
