// Test-only probe for tests/boot.cjs --probe (GS34): on a zoomed frame (Map zoom More/Most) whose GBA screen is
// covered by the window layer (a full-screen menu: the field menu's Psynergy, Djinn, Item, Status screens...), the
// margins must show the map exactly as the last uncovered frame showed it, or black: never the tiles and palette the
// screen borrows from the map under it (the Status screen's BG palettes 0-1 and char block 1, docs/GS34.md).
// Between MG_FROM and MG_TO (env) it keeps the last zoomed frame that was not covered as the reference; on each covered
// frame every margin pixel (outside the GBA's 240 x 160 in the frame) that is not inside a window drawn there
// (Port_MenuWindow, both frames) or a sprite's box (OAM, both frames, moved or not, 8 px around) must equal the
// reference's pixel (cover 1) or be black (cover 2). Covered: the renderer's own decision (Port_ZoomCover) when the
// build has it, else this probe's check of VRAM (window layer opaque but for MG_HOLES pixels; for older builds, the
// negative control). Summary at MG_TO: `margins fA-B covered N checked P bad B`; "CHECK FAIL" (tools/regress.sh fails
// the case) when B > 0 or fewer than MG_MIN (default 20) covered frames were checked. MG_LOG=1 prints each frame.
'use strict';
const FROM = +(process.env.MG_FROM || 0), TO = +(process.env.MG_TO || 0), MIN = +(process.env.MG_MIN || 20);
const HOLES = +(process.env.MG_HOLES || 64), LOG = !!process.env.MG_LOG;
const OBJ_W = [[8, 16, 32, 64], [16, 32, 32, 64], [8, 8, 16, 32]], OBJ_H = [[8, 16, 32, 64], [8, 8, 16, 32], [16, 32, 32, 64]];
let ref = null, refKey = '', refBoxes = [], prevBoxes = [], covered = 0, checked = 0, bad = 0, firstBad = '';
function io(H, o) { return H[0x04000000 + o] | (H[0x04000001 + o] << 8); }
function jsCover(H) { // the window layer (screen block 4) in front and opaque on the GBA's screen
  const disp = io(H, 0);
  if ((disp & 0x80) || (disp & 7) || (disp & 0xe000)) return 0;
  let wb = -1;
  for (let i = 0; i < 4; i++) if (((io(H, 8 + 2 * i) >> 8) & 31) === 4) { wb = i; break; }
  if (wb < 0 || !((disp >> (8 + wb)) & 1)) return 0;
  const cnt = io(H, 8 + 2 * wb), hofs = io(H, 0x10 + 4 * wb) & 0x1ff, vofs = io(H, 0x12 + 4 * wb) & 0x1ff;
  const cb = 0x06000000 + ((cnt >> 2) & 3) * 0x4000, sb = 0x06000000 + ((cnt >> 8) & 31) * 0x800;
  let holes = 0;
  for (let y = 0; y < 160; y++) for (let x = 0; x < 240; x++) {
    const px = (x + hofs) & 255, py = (y + vofs) & 255, ea = sb + ((py >> 3) * 32 + (px >> 3)) * 2, e = H[ea] | (H[ea + 1] << 8);
    const tx = e & 0x400 ? 7 - (px & 7) : px & 7, ty = e & 0x800 ? 7 - (py & 7) : py & 7;
    const ci = (cnt & 0x80) ? H[cb + (e & 0x3ff) * 64 + ty * 8 + tx] : (H[cb + (e & 0x3ff) * 32 + ty * 4 + (tx >> 1)] >> ((tx & 1) * 4)) & 15;
    if (!ci && ++holes > HOLES) return 0;
  }
  return 1;
}
function spriteBoxes(m, XO, YO, LW) { // every OAM entry's box in the frame, at its place and its moved place
  const H = m.HEAPU8, out = [];
  const lists = [[...Array(128).keys()].map((i) => [H[0x07000000 + i * 8] | (H[0x07000001 + i * 8] << 8) | (H[0x07000002 + i * 8] << 16) | (H[0x07000003 + i * 8] << 24), i])];
  if (m._Port_OamTags) {
    const wd = m._Port_OamTags(2) >>> 0, n = m.HEAP32[(m._Port_OamTags(3) >>> 0) >> 2];
    lists.push([...Array(Math.min(n, 128)).keys()].map((i) => [m.HEAPU32[(wd >> 2) + 2 * i], i]));
  }
  for (const list of lists) for (const [w0, i] of list) {
    const aff = (w0 >> 8) & 1, dbl = (w0 >> 9) & 1, shape = (w0 >>> 14) & 3, size = (w0 >>> 30) & 3;
    if ((!aff && dbl) || shape === 3) continue;
    let w = OBJ_W[shape][size], h = OBJ_H[shape][size];
    if (aff && dbl) { w *= 2; h *= 2; }
    let x = (w0 >>> 16) & 511; if (x >= LW - XO) x -= 512;
    const y = w0 & 255;
    let dx = 0, dy = 0;
    if (m._Port_MenuSprite && m._Port_MenuSprite(i, 0) === 1) { dx = m._Port_MenuSprite(i, 1); dy = m._Port_MenuSprite(i, 2); }
    for (const yy of [y, y - 256]) for (const [ox, oy] of [[0, 0], [dx, dy]])
      out.push([XO + x + ox - 8, YO + yy + oy - 8, w + 16, h + 16]);
  }
  return out;
}
module.exports = (m, frame) => {
  if (frame < FROM || frame > TO) return;
  step(m, frame);
  if (frame === TO) {
    console.log(`margins f${FROM}-${TO} covered ${covered} checked ${checked} bad ${bad}${firstBad ? ' first ' + firstBad : ''}`);
    if (bad > 0 || checked < MIN) console.log(`CHECK FAIL: margins: ${bad} wrong margin pixels, ${checked} covered frames checked (at least ${MIN} wanted)`);
  }
};
function step(m, frame) {
  const LW = m._Port_FrameWidth(), LH = m._Port_FrameHeight(), H = m.HEAPU8;
  if (LW === 240 && LH === 160) { ref = null; prevBoxes = []; return; }
  const hook = !!m._Port_ZoomCover;
  const XO = hook ? m._Port_ZoomCover(2) : m._Port_MenuWindow(-1, 0), YO = hook ? m._Port_ZoomCover(3) : m._Port_MenuWindow(-1, 1);
  const cover = hook ? m._Port_ZoomCover(0) : jsCover(H);
  const key = `${LW}x${LH}@${XO},${YO}`;
  const boxes = spriteBoxes(m, XO, YO, LW);
  for (let i = 0; i < 8; i++)
    if (m._Port_MenuWindow && m._Port_MenuWindow(i, 0) === 1)
      boxes.push([m._Port_MenuWindow(i, 1), m._Port_MenuWindow(i, 2), m._Port_MenuWindow(i, 3), m._Port_MenuWindow(i, 4)]);
  const p = m._Port_FrameBuffer();
  const pic = H.subarray(p, p + LW * LH * 4);
  if (!cover) { ref = Uint8Array.from(pic); refKey = key; refBoxes = boxes; prevBoxes = boxes; return; }
  covered++;
  if (cover === 1 && (!ref || refKey !== key)) { prevBoxes = boxes; return; }
  checked++;
  const ex = new Uint8Array(LW * LH); // pixels not checked: the GBA's screen, windows, sprite boxes
  for (const [bx, by, bw, bh] of [[XO, YO, 240, 160]].concat(boxes, refBoxes, prevBoxes))
    for (let y = Math.max(0, by); y < Math.min(LH, by + bh); y++) ex.fill(1, y * LW + Math.max(0, bx), y * LW + Math.max(0, Math.min(LW, bx + bw)));
  let n = 0;
  for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
    if (ex[y * LW + x]) continue;
    const o = (y * LW + x) * 4;
    const ok = cover === 1 ? pic[o] === ref[o] && pic[o + 1] === ref[o + 1] && pic[o + 2] === ref[o + 2]
                           : pic[o] === 0 && pic[o + 1] === 0 && pic[o + 2] === 0;
    if (!ok) { n++; if (!firstBad) firstBad = `f${frame} (${x},${y})`; }
  }
  bad += n;
  prevBoxes = boxes;
  if (LOG || n) console.log(`margins f${frame} cover ${cover} ${key} differing ${n}`);
}
