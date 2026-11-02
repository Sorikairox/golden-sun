// Test-only probe for tests/boot.cjs --probe (GS21): a path search on the World Map, whose walls are not map cells but
// 4-bit collision pixels (WorldMap_GetCollision, terrain.c; read from the vendor source, not copied): two tile maps of
// 64 x 64 tiles that wrap (screen blocks 8 and 10, the upper one first), each tile 16 x 16 px as 4 x 4 values in 8 bytes
// at gMapGridShapes (+0x800 for the upper layer); a value of 5..12 is walkable, no value in either layer means 7. Only
// reads memory. At frame WM_AT it searches 16-px cells around the leader (the streamed window: WM_R cells each way,
// default 26), a cell open when the samples within WM_F px (default 4) of its centre are walkable, and prints the
// path to WM_TO=x,z (16-px cells as where.cjs prints them) or, when the target is outside the window or not reached, to
// the reached cell nearest it. Output: "wmpath f..: from -> to (n steps)" and "wmpath WP a,b;..." for autowalk.cjs.
//   WM_BLOCK='x,z;...' cells to avoid (the areas' actors: touching one enters it)
//   WM_MAP=2  print each cell's centre collision value (hex) instead
//   WM_MAP=1  also print the window ('@' leader, '#' blocked, '.' open, '*' the path, 'T' the end cell)
'use strict';
const AT = +(process.env.WM_AT || 0), R = +(process.env.WM_R || 26);
module.exports = (m, frame) => {
  if (frame !== AT) return;
  const H = m.HEAPU8;
  const u32 = (a) => (H[a] | H[a + 1] << 8 | H[a + 2] << 16 | H[a + 3] << 24) >>> 0;
  const SH = 0x0202c000, VRAM = 0x06000000;
  const coll = (px, py) => { // px, py in pixels
    const hx = px >> 1, hy = py >> 1;
    const cc = (((hy >> 3) & 63) << 6) + ((hx >> 3) & 63), off = (((hy >> 1) & 3) << 1) + ((hx >> 2) & 1);
    for (const [sb, base] of [[10, SH + 0x800], [8, SH]]) {
      const t = H[VRAM + sb * 0x800 + cc], p = H[base + t * 8 + off];
      if (p) { const r = hx & 2 ? p >> 4 : p & 15; if (r) return r; }
    }
    return 7;
  };
  const walk = (px, py) => { const c = coll(px, py); return c >= 5 && c <= 12; };
  // a cell is open when the leader's centre fits there: every 2-px sample within F px of its centre is walkable; a step
  // between neighbours also needs the strip between the centres (F px each side) walkable (rivers can be 10 px wide)
  const F = +(process.env.WM_F || 4);
  const box = (x0, z0, x1, z1) => { for (let x = x0; x <= x1; x += 2) for (let z = z0; z <= z1; z += 2) if (!walk(x, z)) return false; return true; };
  const open = (cx, cz) => box(cx * 16 + 8 - F, cz * 16 + 8 - F, cx * 16 + 8 + F, cz * 16 + 8 + F);
  const pass = (x, z, nx, nz) => box(Math.min(x, nx) * 16 + 8 - F, Math.min(z, nz) * 16 + 8 - F, Math.max(x, nx) * 16 + 8 + F, Math.max(z, nz) * 16 + 8 + F);
  const fw = u32(0x03001ebc), leader = u32(fw + 20);
  const lx = (u32(leader + 8) | 0) / 65536, lz = (u32(leader + 16) | 0) / 65536, sx = lx >> 4, sz = lz >> 4;
  const [tx, tz] = (process.env.WM_TO || `${sx},${sz}`).split(',').map(Number);
  const key = (x, z) => `${x},${z}`, block = new Set((process.env.WM_BLOCK || '').split(';').filter(Boolean)), prev = new Map([[key(sx, sz), null]]), q = [[sx, sz]];
  let best = [sx, sz], bd = Infinity;
  while (q.length) {
    const [x, z] = q.shift(); const d = Math.hypot(x - tx, z - tz); if (d < bd) { bd = d; best = [x, z]; } if (d === 0) break;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz; if (Math.abs(nx - sx) > R || Math.abs(nz - sz) > R || prev.has(key(nx, nz)) || block.has(key(nx, nz)) || !open(nx, nz) || (!(x === sx && z === sz) && !pass(x, z, nx, nz))) continue;
      prev.set(key(nx, nz), [x, z]); q.push([nx, nz]);
    }
  }
  const path = []; for (let c = best; c; c = prev.get(key(...c))) path.unshift(c);
  const wp = []; for (let i = 1; i < path.length; i++) { const n = path[i + 1], c = path[i], p = path[i - 1]; if (!n || n[0] - c[0] !== c[0] - p[0] || n[1] - c[1] !== c[1] - p[1]) wp.push(key(...c)); }
  console.log(`wmpath f${frame}: ${sx},${sz} -> ${best[0]},${best[1]} (${path.length - 1} steps; target ${tx},${tz}${bd ? ` not reached, ${bd.toFixed(1)} cells left` : ''})`);
  console.log(`wmpath WP ${wp.join(';')}`);
  if (process.env.WM_MAP) {
    const on = new Set(path.map((c) => key(...c)));
    for (let z = sz - R; z <= sz + R; z++) { let s = ''; for (let x = sx - R; x <= sx + R; x++) s += process.env.WM_MAP === '2' ? coll(x * 16 + 8, z * 16 + 8).toString(16) : x === sx && z === sz ? '@' : x === best[0] && z === best[1] ? 'T' : on.has(key(x, z)) ? '*' : open(x, z) ? '.' : '#'; console.log(`wm ${String(z).padStart(4)} ${s}`); }
  }
};
