// TEST-ONLY probe for tests/boot.cjs --probe (never in the shipped page): exercises the credits slides' decoder
// without playing to the ending. At frames CRED_AT, CRED_AT+60, ... it calls the game's own Credits_LoadBackground
// (menu/credits.c; synchronous: copies Credits_DecodeBackground to HEAP_SLOT_RAM_CODE_TEMP, runs the copy into BG
// char block 0 or 2 and queues the palette) for slide CRED_FIRST.. of the ROM's gCredits_Backgrounds, alternating
// the halves as Credits_Run does, through the test hook Port_CallCode4. The field's own BG tiles are overwritten:
// use it on a still screen and look at the captures (VRAM dumps), not at the game afterwards.
'use strict';
const fs = require('fs');
const path = require('path');
const AT = +(process.env.CRED_AT || 0), N = +(process.env.CRED_N || 4), FIRST = +(process.env.CRED_FIRST || 0);
const sym = {};
for (const l of fs.readFileSync(path.resolve(__dirname, '../../port/symbols/tbs-en.tsv'), 'utf8').split('\n')) {
  const c = l.split('\t'); if (c[1]) sym[c[0]] = parseInt(c[1], 16);
}
module.exports = (m, frame) => {
  if (frame < AT || (frame - AT) % 60 || (frame - AT) / 60 >= N) return;
  const H = m.HEAPU8, k = FIRST + (frame - AT) / 60, a = sym.gCredits_Backgrounds + 4 * k;
  const id = (H[a] | H[a + 1] << 8 | H[a + 2] << 16 | H[a + 3] << 24) >>> 0, alt = (k & 1) ^ 1;
  m._Port_CallCode4(sym.Credits_LoadBackground, id, alt, 0, 0);
  const crypto = require('crypto');
  const vram = H.subarray(0x06000000 + (alt ? 0x8000 : 0), 0x06000000 + (alt ? 0x8000 : 0) + 0x7800);
  console.log(`credits f${frame}: slide ${k} resource 0x${id.toString(16)} half ${alt}: tiles md5 ${crypto.createHash('md5').update(vram).digest('hex').slice(0, 12)}`);
};
