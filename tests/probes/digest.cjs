// Test-only probe for tests/boot.cjs --probe (tools/regress.sh): at the frames DIGEST_AT (env, comma separated)
// prints a SHA-1 of the GBA RAM and video state (EWRAM, IWRAM, palette, VRAM, OAM) and one of the frame picture:
//   digest f6000 ram 1a2b3c4d5e6f7a8b pic 0f1e2d3c4b5a6978
// Digests only (16 hex digits each): nothing of the game is written anywhere.
'use strict';
const crypto = require('crypto');
// MASK_CODE=1 (GS27): words that look like wasm addresses count as 0: function pointers (table indices 0x10000-0x1ffff,
// trap 26) and pointers into the module's own data (relocated buffers, 0x20000 up to EWRAM). Two builds whose function
// table or data layout differ can then be compared: the game's RAM differs only in such words.
// GS28: the masked digest also counts the saved actor snapshot's script and update words as 0 (gActorSnapshot at
// 0x02001104: 32 actors of 0x70 bytes from +0x20; port/pc/save_compat.c), which GS28 builds keep as GBA addresses.
// DIGEST_BOTH=1 prints the unmasked "digest" line (tools/regress.sh reads it) and a masked "mdigest" line.
const MASK = !!process.env.MASK_CODE;
const BOTH = !!process.env.DIGEST_BOTH;
const AT = new Set((process.env.DIGEST_AT || '').split(',').filter(Boolean).map(Number));
const SNAP = 0x02001104 + 0x20;
function ramDigest(H, mask) {
  const h = crypto.createHash('sha1');
  for (const [a, n] of [[0x02000000, 0x40000], [0x03000000, 0x8000], [0x05000000, 0x400], [0x06000000, 0x18000], [0x07000000, 0x400]])
    if (!mask) h.update(H.subarray(a, a + n));
    else {
      const w = new Uint32Array(H.buffer, H.byteOffset + a, n >> 2).slice();
      for (let i = 0; i < w.length; i++) if (w[i] - 0x10000 >>> 0 < 0x02000000 - 0x10000) w[i] = 0;
      if (a === 0x02000000)
        for (let k = 0; k < 32; k++) {
          w[(SNAP - a + k * 0x70) >> 2] = 0;
          w[(SNAP - a + k * 0x70 + 0x6c) >> 2] = 0;
        }
      h.update(new Uint8Array(w.buffer));
    }
  return h.digest('hex').slice(0, 16);
}
module.exports = (m, frame) => {
  if (!AT.has(frame)) return;
  const H = m.HEAPU8;
  const p = m._Port_FrameBuffer();
  const pic = crypto.createHash('sha1').update(H.subarray(p, p + 240 * 160 * 4)).digest('hex').slice(0, 16);
  console.log(`digest f${frame} ram ${ramDigest(H, MASK && !BOTH)} pic ${pic}`);
  if (BOTH) console.log(`mdigest f${frame} ram ${ramDigest(H, true)} pic ${pic}`);
};
