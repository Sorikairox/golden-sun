// Test-only probe for tests/boot.cjs --probe: at frame ACT_AT (env) lists the field's actors
// (gFieldWork->actors[id], FieldWork.h) with their pixel position and 16-pixel cell, to find what blocks a path.
'use strict';
const AT = +(process.env.ACT_AT || 0);
module.exports = (m, frame) => {
  if (frame !== AT) return;
  const H = m.HEAPU8;
  const u32 = (a) => (H[a] | H[a + 1] << 8 | H[a + 2] << 16 | H[a + 3] << 24) >>> 0;
  const fw = u32(0x03001ebc);
  const out = [];
  for (let i = 0; i < 72; i++) {
    const a = u32(fw + 20 + 4 * i);
    if (a < 0x02000000 || a >= 0x03008000) continue;
    const x = (u32(a + 8) | 0) / 65536, z = (u32(a + 16) | 0) / 65536;
    out.push(`${i}:${x.toFixed(0)},${z.toFixed(0)}(${x >> 4},${z >> 4})`);
  }
  console.log(`actors f${frame}: ${out.join(' ')}`);
};
