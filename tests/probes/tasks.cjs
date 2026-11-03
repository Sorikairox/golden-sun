// Test-only probe for tests/boot.cjs --probe: prints the game's task table (gTasks, 20 x {u32 func, u16 priority, u8 flags,
// u8 reserved} at 0x03001a20) whenever it changes between frames TASK_FROM and TASK_TO (env): "index:func/priority" for
// every live task; a priority with bit 8 set (0xd80 for a frame task) is one Task_SuspendOverlayTasks has suspended.
// Used (GS15) to show a scene task pausing while a menu is open (trap 41).
'use strict';
const FROM = +(process.env.TASK_FROM || 0), TO = +(process.env.TASK_TO || 1e9);
let last = '';
module.exports = (m, frame) => {
  if (frame < FROM || frame > TO) return;
  const H = m.HEAPU8, B = process.env.TASK_BASE ? parseInt(process.env.TASK_BASE, 16) : 0x03001a20; // TLA: TASK_BASE=02003610 TASK_N=24
  const u32 = (a) => (H[a] | H[a + 1] << 8 | H[a + 2] << 16 | H[a + 3] << 24) >>> 0;
  const out = [];
  for (let i = 0; i < (+process.env.TASK_N || 20); i++) {
    const p = H[B + 8 * i + 4] | H[B + 8 * i + 5] << 8;
    if (p !== 0xffff && p !== 0x7fff) { const f = u32(B + 8 * i); const g = f < 0x20000 && m._Port_CodeGbaOf ? m._Port_CodeGbaOf(f) >>> 0 : 0; out.push(`${i}:${f.toString(16)}${g ? '=' + g.toString(16) : ''}/${p.toString(16)}`); }
  }
  const s = out.join(' ');
  if (s !== last) { console.log(`tasks f${frame} ${s}`); last = s; }
};
