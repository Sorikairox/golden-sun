// Test-only route recorder for tests/boot.cjs --probe: from frame WALK_AT (env) it presses the D-pad to walk the
// party leader through the waypoint cells WALK (env, "x,z;x,z;..."; each leg moves along x first, then z) and
// prints the keys it pressed as boot.cjs key specs ("walk keys: LEFT@7000-7031,DOWN@..."), so the route can be
// committed as a plain .keys file (inputs only) and replayed without this probe. Stops at the last waypoint, or
// after WALK_STUCK frames (default 90) without reaching a new cell (prints where it stuck).
'use strict';
const AT = +(process.env.WALK_AT || 0), STUCK = +(process.env.WALK_STUCK || 90);
// a waypoint written 'vX,Z' moves along z first; 'sX,Z' walks toward X,Z until the scene changes (an exit)
const pts = (process.env.WALK || '').split(';').filter(Boolean).map((p) => [...p.replace(/^[vs]/, '').split(',').map(Number), p[0] === 'v', p[0] === 's']);
let scene0 = -1;
const KEY = { A: 1, B: 2, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128 };
// WALK_TAP=N: after N frames without reaching a new cell (a cutscene, a message), tap A every 24 frames, B every
// fourth tap (closes a field menu opened by a stray A); the taps are recorded with the walk keys.
const TAP = +(process.env.WALK_TAP || 0);
let taps = 0;
let i = 0, spans = [], lastCell = '', lastMove = 0, done = false, vert = false;
const finish = (frame, why) => {
  done = true;
  console.log(`walk ${why} f${frame}`);
  console.log(`walk keys: ${spans.map((s) => `${s.k}@${s.a}-${s.b}`).join(',')}`);
};
module.exports = (m, frame, keys) => {
  if (done || frame < AT || !pts.length) return;
  const H = m.HEAPU8;
  const u32 = (a) => (H[a] | H[a + 1] << 8 | H[a + 2] << 16 | H[a + 3] << 24) >>> 0;
  const leader = u32(u32(0x03001ebc) + 20);
  if (leader < 0x02000000 || leader >= 0x03008000) return;
  const x = (u32(leader + 8) | 0) / 65536, z = (u32(leader + 16) | 0) / 65536;
  const cx = x >> 4, cz = z >> 4, cell = cx + ',' + cz;
  if (cell !== lastCell) { lastCell = cell; lastMove = frame; }
  if (frame - lastMove > STUCK) return finish(frame, `stuck at ${cell} (waypoint ${pts[i]})`);
  const [tx, tz, zFirst, exit] = pts[i];
  const scene = H[0x02000400] | H[0x02000401] << 8; // gMainRoutineWork.next
  if (exit && scene0 < 0) scene0 = scene;
  if (exit && scene !== scene0) { scene0 = -1; lastMove = frame; if (++i >= pts.length) return finish(frame, `exit to scene ${scene}`); return; }
  // aim for the cell's middle so the next leg starts clear of the edges
  const ax = tx * 16 + 8 - x, az = tz * 16 + 8 - z;
  let k = null;
  if ((zFirst || (vert && Math.abs(cx - tx) <= 1)) && cz !== tz) k = az < 0 ? 'UP' : 'DOWN'; // slopes push sideways: keep on
  else if (cx !== tx) k = ax < 0 ? 'LEFT' : 'RIGHT';
  else if (cz !== tz) {
    if (!vert && Math.abs(ax) > 5) k = ax < 0 ? 'LEFT' : 'RIGHT'; // centre first, then keep to the vertical
    else { vert = true; k = az < 0 ? 'UP' : 'DOWN'; }
  }
  if (!k) {
    vert = false;
    if (++i >= pts.length) return finish(frame, `arrived ${cell}`);
    return;
  }
  if (TAP && frame - lastMove > TAP && (frame - lastMove - TAP) % 24 < 2) k = ((frame - lastMove - TAP) / 24 | 0) % 4 === 3 ? 'B' : 'A';
  m._Port_SetKeys(keys | KEY[k]);
  const s = spans[spans.length - 1];
  if (s && s.k === k && s.b === frame - 1) s.b = frame; else spans.push({ k, a: frame, b: frame });
};
