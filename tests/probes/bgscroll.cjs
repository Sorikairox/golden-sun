// Test-only probe for tests/boot.cjs --probe: logs the BG0-3 scroll registers (REG_BGxHOFS/VOFS as last written, from the
// identity-mapped I/O page) whenever they change between frames SCROLL_FROM and SCROLL_TO (env), and a summary at
// SCROLL_TO: how many frames changed. Used (GS15) to show a scene task's screen shake stopping while a menu is open.
'use strict';
const FROM = +(process.env.SCROLL_FROM || 0), TO = +(process.env.SCROLL_TO || 0);
let last = '', changes = 0;
module.exports = (m, frame) => {
  if (frame < FROM || frame > TO) return;
  const H = m.HEAPU8;
  const r = (a) => H[a] | H[a + 1] << 8;
  const s = [0, 1, 2, 3].map((i) => `${r(0x04000010 + 4 * i)},${r(0x04000012 + 4 * i)}`).join(' ');
  if (s !== last) { if (last) { changes++; if (process.env.SCROLL_LOG) console.log(`scroll f${frame} ${s}`); } last = s; }
  if (frame === TO) console.log(`scroll f${FROM}-${TO}: ${changes} frames changed`);
};
