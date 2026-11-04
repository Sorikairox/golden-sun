// Test-only probe for tests/boot.cjs --probe (GS33): with "Menus: Edges" on a zoomed frame, a window that stays open
// with the same rectangle must stay at the same place in the frame (no jitter, no jump), whatever the camera does.
// Between frames MJ_FROM and MJ_TO (env) it reads each window as the renderer drew it (Port_MenuWindow: frame x/y,
// size, GBA x/y) and counts a jump when a window live on two frames in a row, with the same GBA rectangle, was drawn at
// another frame position. Summary at MJ_TO: `menujitter fA-B windows N (window-frames) moved M jumps J`; M counts
// window-frames drawn away from the GBA's own place (the option at work). "CHECK FAIL" (tools/regress.sh fails the
// case) when J > 0 or fewer than MJ_MIN (default 30) moved window-frames were seen. MJ_LOG=1 prints every window.
'use strict';
const FROM = +(process.env.MJ_FROM || 0), TO = +(process.env.MJ_TO || 0), MIN = +(process.env.MJ_MIN || 30);
const LOG = !!process.env.MJ_LOG;
let prev = [], seen = 0, moved = 0, jumps = 0;
module.exports = (m, frame) => {
  if (frame < FROM || frame > TO) return;
  const cur = [];
  const XO = (m._Port_FrameWidth() - 240), YO = (m._Port_FrameHeight() - 160);
  for (let i = 0; i < 8; i++) {
    if (!m._Port_MenuWindow || m._Port_MenuWindow(i, 0) !== 1) { cur.push(null); continue; }   // (a build without it: none)
    const w = [1, 2, 3, 4, 5, 6].map((k) => m._Port_MenuWindow(i, k));
    cur.push(w);
    seen++;
    // the GBA's own place in the frame is unknown here; any frame position that is not the centred one counts as moved
    if (w[0] !== w[4] + XO / 2 || w[1] !== w[5] + YO / 2) moved++;
    const p = prev[i];
    if (p && p[2] === w[2] && p[3] === w[3] && p[4] === w[4] && p[5] === w[5] && (p[0] !== w[0] || p[1] !== w[1])) {
      jumps++;
      console.log(`menujitter f${frame} jump window ${i} (${w[4]},${w[5]} ${w[2]}x${w[3]}): ${p[0]},${p[1]} -> ${w[0]},${w[1]}`);
    }
    if (LOG) console.log(`menujitter f${frame} window ${i} gba ${w[4]},${w[5]} ${w[2]}x${w[3]} at ${w[0]},${w[1]}`);
  }
  prev = cur;
  if (frame === TO) {
    console.log(`menujitter f${FROM}-${TO} windows ${seen} moved ${moved} jumps ${jumps}`);
    if (jumps > 0 || moved < MIN) console.log(`CHECK FAIL: menujitter: ${jumps} jumps, ${moved} moved window-frames (at least ${MIN} wanted)`);
  }
};
