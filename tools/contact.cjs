// Contact sheet of boot captures (our own PNGs: RGBA, filter 0, as tests/boot.cjs writes them), for looking at
// many frames at once. Usage: node tools/contact.cjs OUT.png COLS frame1.png frame2.png ...
// The sheet shows the game: write it to port_work/ (gitignored) only.
'use strict';
const fs = require('fs');
const zlib = require('zlib');

function read(file) {
  const b = fs.readFileSync(file);
  let p = 8, w = 0, h = 0; const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8), data = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) raw.copy(px, y * w * 4, y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1));
  return { w, h, px };
}

function write(file, px, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const t = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (d) => { let c = -1; for (const x of d) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([l, td, c]);
  };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const [out, colsArg, ...files] = process.argv.slice(2);
// SCALE=N (env, GS13): each frame N times larger (nearest), CROP=x,y,w,h: only that part of each frame
const S = +(process.env.SCALE || 1), [cx, cy, cw, ch] = (process.env.CROP || '0,0,240,160').split(',').map(Number);
// FIT=WxH (GS29): every frame scaled (nearest) to a W x H cell, whatever its size (Map zoom frames are 240 x 160 to
// 336 x 224, all 3:2), the way the page shows them in one box
const FIT = process.env.FIT ? process.env.FIT.split('x').map(Number) : null;
const cols = +colsArg, imgs = files.map(read), W = FIT ? FIT[0] : cw * S, H = FIT ? FIT[1] : ch * S, G = 2;
const rows = Math.ceil(imgs.length / cols), sw = cols * (W + G), sh = rows * (H + G);
const sheet = Buffer.alloc(sw * sh * 4, 255);
imgs.forEach((im, i) => {
  const ox = (i % cols) * (W + G), oy = Math.floor(i / cols) * (H + G);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = FIT ? Math.floor(x * im.w / W) : cx + Math.floor(x / S), sy = FIT ? Math.floor(y * im.h / H) : cy + Math.floor(y / S);
    if (sx < im.w && sy < im.h) im.px.copy(sheet, ((oy + y) * sw + ox + x) * 4, (sy * im.w + sx) * 4, (sy * im.w + sx) * 4 + 4);
  }
});
write(out, sheet, sw, sh);
console.log(`${out}: ${imgs.length} frames, ${cols} columns`);
