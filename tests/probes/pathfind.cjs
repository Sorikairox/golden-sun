// Test-only probe for tests/boot.cjs --probe: at frame PATH_AT (env) searches the current map layer's cells for a
// walkable path from the leader's 16-pixel cell to PATH_TO=x,z (breadth first) and prints it as runs of
// directions ("RIGHT 3, UP 5, ..."). Route-finding aid only: it models the cell grid roughly (behavior 255 walls,
// shape kind 0 = flat at height byte 1, kinds 1/2 slope west->east, other kinds unwalkable (PATH_KINDS); a step is allowed when
// the facing edges' heights differ by at most PATH_TOL (default 2)), not the game's real collision.
'use strict';
const AT = +(process.env.PATH_AT || 0);
module.exports = (m, frame) => {
  if (frame !== AT) return;
  const H = m.HEAPU8;
  const u32 = (a) => (H[a] | H[a + 1] << 8 | H[a + 2] << 16 | H[a + 3] << 24) >>> 0;
  const fw = u32(0x03001ebc), leader = u32(fw + 20);
  const sx = (u32(leader + 8) | 0) >> 20, sz = (u32(leader + 16) | 0) >> 20;
  const [tx, tz] = process.env.PATH_TO.split(',').map(Number);
  const kinds = (process.env.PATH_KINDS || '0,1,2').split(',').map(Number); // shape kinds taken as walkable (GS9: 3/4/7 behave as cliff edges)
  const tol = +(process.env.PATH_TOL || 2), ZMAX = +(process.env.PATH_ZMAX || 128);
  const cell = (x, z) => 0x02010000 + 4 * (x + (z << 7));
  const beh = (x, z) => H[cell(x, z) + 2];
  const edge = (x, z, dir) => { // height at the cell's edge facing dir (0 N, 1 E, 2 S, 3 W)
    const s = 0x0202c000 + 4 * H[cell(x, z) + 3], kind = H[s] & 15, a = H[s + 1], b = H[s + 2];
    if (kind === 0) return a;
    if (kind === 4) return dir === 0 ? a : dir === 2 ? b : (a + b) / 2;
    if (kind <= 3) return dir === 3 ? a : dir === 1 ? b : (a + b) / 2;
    return Math.max(a, b);
  };
  const block = new Set((process.env.PATH_BLOCK || '').split(';').filter(Boolean)); // 'x,z' cells to avoid (actors)
  const D = [[0, -1, 'UP'], [1, 0, 'RIGHT'], [0, 1, 'DOWN'], [-1, 0, 'LEFT']];
  const prev = new Map(); const q = [[sx, sz]]; prev.set(sx + ',' + sz, null);
  while (q.length) {
    const [x, z] = q.shift();
    if (x === tx && z === tz) break;
    for (let d = 0; d < 4; d++) {
      const nx = x + D[d][0], nz = z + D[d][1], k = nx + ',' + nz;
      if (nx < 0 || nx > 127 || nz < 0 || nz >= ZMAX || prev.has(k) || block.has(k) || beh(nx, nz) === 255) continue;
      if (!kinds.includes(H[0x0202c000 + 4 * H[cell(nx, nz) + 3]] & 15)) continue;
      if (Math.abs(edge(x, z, d) - edge(nx, nz, (d + 2) & 3)) > tol) continue;
      prev.set(k, [x, z, d]); q.push([nx, nz]);
    }
  }
  if (!prev.has(tx + ',' + tz)) { console.log(`path f${frame}: none from ${sx},${sz} to ${tx},${tz}`); return; }
  const steps = []; let k = tx + ',' + tz;
  while (prev.get(k)) { const [x, z, d] = prev.get(k); steps.unshift(d); k = x + ',' + z; }
  const runs = []; for (const d of steps) { const r = runs[runs.length - 1]; if (r && r[0] === d) r[1]++; else runs.push([d, 1]); }
  console.log(`path f${frame}: ${sx},${sz} -> ${tx},${tz}: ${runs.map(([d, n]) => D[d][2] + ' ' + n).join(', ')}`);
};
