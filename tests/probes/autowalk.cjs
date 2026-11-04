// Test-only route recorder for tests/boot.cjs --probe: from frame WALK_AT (env) it presses the D-pad to walk the
// party leader through the waypoint cells WALK (env, "x,z;x,z;..."; each leg moves along x first, then z) and
// prints the keys it pressed as boot.cjs key specs ("walk keys: LEFT@7000-7031,DOWN@..."), so the route can be
// committed as a plain .keys file (inputs only) and replayed without this probe. Stops at the last waypoint, or
// after WALK_STUCK frames (default 90) without reaching a new cell (prints where it stuck).
'use strict';
const AT = +(process.env.WALK_AT || 0), STUCK = +(process.env.WALK_STUCK || 90);
// a waypoint written 'vX,Z' moves along z first; 'sX,Z' walks toward X,Z until the scene changes (an exit)
// 'dX,Z' (GS19) walks diagonally (both keys held) until the cell is reached
// TLA6b: the prefixes combine ('sv6,32': z first, then on into the exit)
const pts = (process.env.WALK || '').split(';').filter(Boolean).map((p) => { const f = p.match(/^[vsd]*/)[0]; return [...p.slice(f.length).split(',').map(Number), f.includes('v'), f.includes('s'), f.includes('d')]; });
let scene0 = -1;
const TLA = process.env.WALK_GAME === 'tla', SC = TLA ? 0x02000420 : 0x02000400;
const KEY = { A: 1, B: 2, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128 };
// WALK_TAP=N: after N frames without reaching a new cell (a cutscene, a message), tap A every 24 frames, B every
// fourth tap (closes a field menu opened by a stray A); the taps are recorded with the walk keys.
const TAP = +(process.env.WALK_TAP || 0);
let taps = 0;
// WALK_FIGHT=N (GS13): random battles do not end the walk: while the field is gone (battle, scene 510) tap A every N
// frames (Fight, Attack, first target; closes the reward messages), then B once 30 frames after the field is back
// (closes a field menu a late A opened); the walk then goes on. The taps are recorded with the walk keys.
const FIGHT = +(process.env.WALK_FIGHT || 0), FLEE = !!process.env.WALK_FLEE;
let away = -1, back = -1;
const CENTER = +(process.env.WALK_CENTER || 0);
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
  // WALK_GAME=tla (TLA6b): the leader is EventWork.objects[gMainRoutineWork.currentOwner] (eventWork heap slot
  // 0x0300006c, objects at +0x14; currentOwner at gMainRoutineWork+0x214), the scene/entrance at +0x1e0/+0x1e2
  const leader = TLA ? u32(u32(0x0300006c) + 0x14 + 4 * (u32(0x02000454) & 0x7f)) : u32(u32(0x03001ebc) + 20);
  const press = (k) => {
    m._Port_SetKeys(keys | k.split('+').reduce((a, n) => a | KEY[n], 0));
    const s = spans[spans.length - 1];
    if (s && s.k === k && s.b === frame - 1) s.b = frame; else spans.push({ k, a: frame, b: frame });
  };
  const sc = H[SC] | H[SC + 1] << 8;
  if (FIGHT && (sc === 510 || leader < 0x02000000 || leader >= 0x03008000)) {
    if (away < 0) away = frame;
    lastMove = frame; back = -1;
    // WALK_FLEE=1 (GS20): take Run (RIGHT, then A 10 frames later) instead of Fight, again after a failed run
    if (FLEE && frame - away > 30 && (frame - away) % FIGHT < 2) press('RIGHT');
    else if (frame - away > 30 && (frame - away - (FLEE ? 10 : 0)) % FIGHT < 2) press('A');
    return;
  }
  if (FIGHT && away >= 0) { if (back < 0) back = frame; lastMove = frame; if (frame - back < 30) return; if (frame - back < 32) { press('B'); return; } away = -1; }
  if (leader < 0x02000000 || leader >= 0x03008000) return;
  const x = (u32(leader + 8) | 0) / 65536, z = (u32(leader + 16) | 0) / 65536;
  const cx = x >> 4, cz = z >> 4, cell = cx + ',' + cz;
  if (cell !== lastCell) { lastCell = cell; lastMove = frame; }
  if (frame - lastMove > STUCK) return finish(frame, `stuck at ${cell} (waypoint ${pts[i]})`);
  const [tx, tz, zFirst, exit, diag] = pts[i];
  const scene = (H[SC] | H[SC + 1] << 8) * 65536 + (H[SC + 2] | H[SC + 3] << 8); // gMainRoutineWork.next, .entrance (GS13: exits between rooms of one scene change only the entrance)
  if (exit && scene0 < 0) scene0 = scene;
  if (exit && scene !== scene0) { scene0 = -1; lastMove = frame; if (++i >= pts.length) return finish(frame, `exit to scene ${scene >> 16} entrance ${scene & 0xffff}`); return; }
  // aim for the cell's middle so the next leg starts clear of the edges
  const ax = tx * 16 + 8 - x, az = tz * 16 + 8 - z;
  let k = null;
  if (diag) k = [cz !== tz ? (az < 0 ? 'UP' : 'DOWN') : '', cx !== tx ? (ax < 0 ? 'LEFT' : 'RIGHT') : ''].filter(Boolean).join('+') || null;
  else if ((zFirst || (vert && Math.abs(cx - tx) <= 1)) && cz !== tz) k = az < 0 ? 'UP' : 'DOWN'; // slopes push sideways: keep on
  else if (cx !== tx) k = ax < 0 ? 'LEFT' : 'RIGHT';
  else if (cz !== tz) {
    if (!vert && Math.abs(ax) > 5) k = ax < 0 ? 'LEFT' : 'RIGHT'; // centre first, then keep to the vertical
    else { vert = true; k = az < 0 ? 'UP' : 'DOWN'; }
  }
  // WALK_CENTER=N (GS13): a waypoint counts as reached only within N pixels of the cell's middle (pillar tops and
  // jumps need the leader centred before the next leg)
  if (!k && CENTER && (Math.abs(ax) > CENTER || Math.abs(az) > CENTER)) k = Math.abs(az) > CENTER ? (az < 0 ? 'UP' : 'DOWN') : (ax < 0 ? 'LEFT' : 'RIGHT');
  if (!k && exit) return; // TLA6b: in the exit cell: wait for the scene change (else a late change ends the next 's' leg at once)
  if (!k) {
    vert = false;
    if (++i >= pts.length) return finish(frame, `arrived ${cell}`);
    return;
  }
  if (TAP && frame - lastMove > TAP && (frame - lastMove - TAP) % 24 < 2) k = ((frame - lastMove - TAP) / 24 | 0) % 4 === 3 ? 'B' : 'A';
  press(k);
};
