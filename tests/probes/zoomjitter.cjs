// Test-only probe for tests/boot.cjs --probe (GS31): Map zoom's picture must not jitter at a map's edge. Between
// frames JIT_FROM and JIT_TO (env) it finds how far the whole zoomed picture moved since the previous frame (the best
// dx, dy in -4..4 over the frame minus an 8-px border, sampled; a frame matching no step within 8%, or only one of
// +-4, is skipped: fades, scene changes, full-screen menus, a scene's own scrolling picture) and counts reversals: a
// step on one axis opposite to the step on the frame before (the camera eases, so a real change of direction passes
// through a still frame), unless the GBA's camera itself turned back between the two frames shown (gMapGridWork
// viewX/viewY, one frame behind the picture: hops, shakes; counted as "the game's own").
// Summary at JIT_TO: `zoomjitter fA-B zoomed N edge E reversals R (the game's own O)`; E counts zoomed frames where the
// GBA's view is nearer a camera bound than the frame's margin (the frame is held at the map's edge there). "CHECK FAIL"
// (tools/regress.sh fails the case) when R > 0, or when E < JIT_MIN_EDGE (default 30), so a route that no longer
// reaches an edge does not pass silently. JIT_LOG=1 prints every frame: camera, bounds, step.
'use strict';
const FROM = +(process.env.JIT_FROM || 0), TO = +(process.env.JIT_TO || 0), MIN_EDGE = +(process.env.JIT_MIN_EDGE || 30);
const LOG = !!process.env.JIT_LOG;
let prev = null, pw = 0, ph = 0, last = [0, 0], zoomed = 0, edge = 0, reversals = 0, own = 0;
// the GBA's camera at the end of the last three frames (newest first): a frame shows the camera of the frame before
let views = [];
const sgn = (v) => (v > 0) - (v < 0);
module.exports = (m, frame) => {
  if (frame < FROM || frame > TO) return;
  const w = m._Port_FrameWidth(), h = m._Port_FrameHeight(), p = m._Port_FrameBuffer() >> 2;
  const cur = m.HEAPU32.slice(p, p + w * h);
  const H = m.HEAPU8;
  const s32 = (a) => H[a] | H[a + 1] << 8 | H[a + 2] << 16 | H[a + 3] << 24;
  const g = s32(0x03001e70) >>> 0;
  let cam = '';
  const gOk = g >= 0x02000000 && g + 0x194 <= 0x02040000;
  const camStep = (k, i) => views.length > k + 1 && views[k] && views[k + 1] ? views[k][i] - views[k + 1][i] : 0;
  const camNow = [camStep(0, 0), camStep(0, 1)], camPrev = [camStep(1, 0), camStep(1, 1)];
  views.unshift(gOk ? [s32(g + 0xe4) >> 16, s32(g + 0xe8) >> 16] : null);
  views.length = Math.min(views.length, 3);
  if (w > 240 && gOk) {
    const vx = s32(g + 0xe4) >> 16, vy = s32(g + 0xe8) >> 16;
    const mnx = s32(g + 0xec) >> 16, mny = s32(g + 0xf0) >> 16, mxx = s32(g + 0xf4) >> 16, mxy = s32(g + 0xf8) >> 16;
    // the frame reaches a bound (it is held there) when the GBA's view is closer to it than the margin
    const mx = (w - 240) / 2, my = (h - 160) / 2;
    if (vx - mnx < mx || mxx - vx - 240 < mx || vy - mny < my || mxy - vy - 160 < my) edge++;
    cam = ` view ${vx},${vy} b ${mnx},${mny}-${mxx},${mxy}`;
  }
  let step = '';
  if (w > 240 && prev && w === pw && h === ph) {
    zoomed++;
    let best = null, n = 0;
    for (let y = 8; y < h - 8; y += 3) for (let x = 8; x < w - 8; x += 3) n++;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      let bad = 0;
      for (let y = 8; y < h - 8; y += 3) for (let x = 8; x < w - 8; x += 3) if (cur[y * w + x] !== prev[(y + dy) * w + x + dx]) bad++;
      if (!best || bad < best.bad) best = { dx, dy, bad };
    }
    // a frame that matches no shift well (a fade, a scene change, a full-screen menu) or only one at the search's limit
    // (a scene's own scrolling picture) breaks the run
    const s = best.bad > n * 0.08 || Math.abs(best.dx) === 4 || Math.abs(best.dy) === 4 ? null : [best.dx, best.dy];
    if (!s) last = [0, 0];
    else for (let i = 0; i < 2; i++) {
      if (s[i] && last[i] && sgn(s[i]) === -sgn(last[i])) {
        // the GBA's own camera turned back on this axis between the two frames shown (a hop, a shake): not ours
        if (camNow[i] && camPrev[i] && sgn(camNow[i]) === -sgn(camPrev[i])) own++;
        else { reversals++; if (!LOG) console.log(`zoomjitter f${frame} reversal ${'xy'[i]} ${last[i]} -> ${s[i]}`); }
      }
      last[i] = s[i];
    }
    step = s ? ` step ${s[0]},${s[1]}` : ' step -';
  } else last = [0, 0];
  if (LOG) console.log(`zoomjitter f${frame} ${w}x${h}${cam}${step}`);
  prev = cur; pw = w; ph = h;
  if (frame === TO) {
    console.log(`zoomjitter f${FROM}-${TO} zoomed ${zoomed} edge ${edge} reversals ${reversals} (the game's own ${own})`);
    if (reversals > 0 || edge < MIN_EDGE) console.log(`CHECK FAIL: zoomjitter: ${reversals} reversals, ${edge} edge frames (at least ${MIN_EDGE} wanted)`);
  }
};
