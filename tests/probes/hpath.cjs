// Test-only probe for tests/boot.cjs --probe (GS18): a height-aware path search over the field's cells, for maps whose
// walls are cell heights (Goma Cave) rather than wall cells. At frame HPATH_AT (env) it models the game's walking rules
// from the vendor sources (read, not copied): a cell's ground height comes from its shape's terrain kind and samples
// (gMapGrid_TerrainHeightFunctions, terrain.c; sample x 8 px), a step is allowed while the ground ahead is at most 8 px
// higher and 12 px lower than the ground the leader stands on (MapGrid_CheckCollision), behavior 255 blocks; a walk
// between two neighbour cells is traced pixel by pixel from centre to centre. Push cells (Field_RunPushCell): standing on
// a jump cell (254/249), a blocked direction jumps two cells when the cell in between is not too high and the landing is
// a legal step (Field_TryJumpForward); climb cells (253) join their north/south neighbours; a ledge (252) south of a
// cell drops to the first lower cell within 3 south. A model, not the game: trust a walk (autowalk.cjs) over it.
//   HPATH_TO=x,z    print the path (runs, autowalk waypoints, jumps as 'J>') or "none"
//   HPATH_MAP=1     print the reachable cells of each layer reached (their height / 8 in base 36, '@' leader, '#' wall
//                   cell, '.' unreachable, 'J' a reachable jump cell); HPATH_W/HPATH_H window (default 64x48 around the leader)
//   HPATH_DIAG=1    diagonal steps too (stumps on a checkerboard, Kolima Forest); waypoints 'dX,Z' for autowalk
//   HPATH_MAP=3     4-px samples around the leader: level '.', higher '^', lower 'v', wall '#' (GS19: forest stumps)
//   HPATH_MAP=2     the same window with every cell's centre height in layer HPATH_LAYER (reachable or not; '-' below 0)
//   HPATH_TO_LAYER  only a path that arrives in this layer
//   HPATH_JUMPW=20  scene step triggers that jump the leader west across a gap (Goma Cave's pillar room: behavior 20)
//   HPATH_BLOCK='x,z;...' cells to avoid (actors), HPATH_LAYER layer (default the leader's)
'use strict';
const AT = +(process.env.HPATH_AT || 0);
module.exports = (m, frame) => {
  if (frame !== AT) return;
  const H = m.HEAPU8;
  const u32 = (a) => (H[a] | H[a + 1] << 8 | H[a + 2] << 16 | H[a + 3] << 24) >>> 0;
  const s8 = (a) => (H[a] << 24) >> 24;
  const leader = u32(u32(0x03001ebc) + 20);
  const lx = (u32(leader + 8) | 0) / 65536, ly = (u32(leader + 12) | 0) / 65536, lz = (u32(leader + 16) | 0) / 65536;
  const layer = +(process.env.HPATH_LAYER ?? H[leader + 36]) & 3;
  // the layers' cells pointers: gMapGridWork's layers[] (0x30 bytes apart) point into gMapGridCellBuffer (0x02010000,
  // 48 KB, 128 cells a row); a layer is a window into that grid (Goma Cave's pillar room: layer 2 is layer 0's rows 50
  // columns east). A cell's picture halfword bits 13-12, if not 0, are the layer + 1 an actor standing on it takes
  // (actor_camera.c), so the search follows the layer as well as the height.
  const grid = u32(0x03001e70), inBuf = (p) => p >= 0x02010000 && p < 0x0201c000;
  const LP = [0x02010000, 0x02010000, 0x02010000];
  for (let o = 0; o < 0x1000; o += 4) {
    if (inBuf(u32(grid + o)) && inBuf(u32(grid + o + 0x30))) { for (let i = 0; i < 3; i++) LP[i] = u32(grid + o + 0x30 * i); break; }
  }
  const cells = LP[layer];
  const SHAPES = 0x0202c000, WEIGHT = 0x080132fc, INDEX = 0x080133fc;
  let cur = layer; // the layer cellAt/beh/height read (set by the search)
  const cellAt = (cx, cz) => LP[cur] + 4 * (cx + (cz << 7));
  const beh = (cx, cz) => (cx < 0 || cx > 127 || cz < 0 || cellAt(cx, cz) >= 0x0201c000 ? 255 : H[cellAt(cx, cz) + 2]);
  const layerOf = (cx, cz) => { const t = (H[cellAt(cx, cz) + 1] >> 4) & 3; return t ? t - 1 : cur; };
  const height = (px, pz) => { // ground height in pixels at map pixel (px, pz)
    const sh = SHAPES + 4 * H[cellAt(px >> 4, pz >> 4) + 3], kind = H[sh] & 15, x = px & 15, y = pz & 15;
    const s = (i) => s8(sh + 1 + i) * 8, u = (i) => H[sh + 1 + i] * 8;
    switch (kind) {
      case 1: return s(0) + Math.trunc((s(1) - s(0)) * x / 16);
      case 2: return s(0) + Math.trunc((s(1) - s(0)) * y / 16);
      case 3: return x + y === 15 ? Math.max(s(0), s(1)) : x + y < 15 ? s(0) : s(1);
      case 4: { const d = y - x + 15; return d === 15 ? Math.max(s(0), s(1)) : d < 15 ? s(0) : s(1); }
      case 5: { const t = x + y; return t === 15 ? s(1) : t < 15 ? s(0) + (s(1) - s(0)) * t / 15 : s(1) + (s(2) - s(1)) * (t - 15) / 15; }
      case 6: { const d = y - x + 15; return d === 15 ? s(1) : d < 15 ? s(0) + (s(1) - s(0)) * d / 16 : s(1) + (s(2) - s(1)) * (y - x) / 16; }
      case 7: return s(0) + (s(1) - s(0)) * H[WEIGHT + x + 16 * y];
      case 8: return x < 8 ? s(0) : s(1);
      case 9: return y < 8 ? s(0) : s(1);
      case 10: return x < 8 ? s(0) + (s(1) - s(0)) * x / 8 : s(1) + (s(2) - s(1)) * (x - 8) / 8;
      case 11: return y < 8 ? u(0) + (u(1) - u(0)) * y / 8 : u(1) + (u(2) - u(1)) * (y - 8) / 8;
      case 12: return s(H[INDEX + x + 16 * y]);
      case 13: return s(H[INDEX + 16 * y - x + 15]);
      default: return s(0);
    }
  };
  const ok = (dy) => dy <= 8 && dy >= -12;
  // walk from the centre of (cx,cz) towards (nx,nz) pixel by pixel in layer cur; returns [ground, layer] on arrival
  // or null (cur is left at the layer reached)
  const walk = (cx, cz, g, nx, nz) => {
    let px = cx * 16 + 8, pz = cz * 16 + 8; const dx = Math.sign(nx - cx), dz = Math.sign(nz - cz);
    for (let i = 0; i < 16; i++) {
      px += dx; pz += dz;
      if (beh(px >> 4, pz >> 4) === 255) return null;
      const h = height(px, pz);
      if (!ok(h - g)) return null;
      g = h; cur = layerOf(px >> 4, pz >> 4);
    }
    return [g, cur];
  };
  const JUMPW = new Set((process.env.HPATH_JUMPW || '').split(',').filter(Boolean).map(Number));
  const block = new Set((process.env.HPATH_BLOCK || '').split(';').filter(Boolean));
  const D = [[0, -1, 'UP'], [1, 0, 'RIGHT'], [0, 1, 'DOWN'], [-1, 0, 'LEFT']];
  const DD = [[1, -1, 'UP+RIGHT'], [1, 1, 'DOWN+RIGHT'], [-1, 1, 'DOWN+LEFT'], [-1, -1, 'UP+LEFT']], DIAG = !!process.env.HPATH_DIAG;
  const sx = Math.floor(lx / 16), sz = Math.floor(lz / 16);
  // states are cells with the layer and ground height they are reached at (a cell may hold two levels)
  const key = (x, z, l, g) => `${x},${z},${l},${Math.round(g / 8)}`;
  const g0 = height(Math.floor(lx), Math.floor(lz));
  const prev = new Map(), q = [[sx, sz, layer, g0]];
  prev.set(key(sx, sz, layer, g0), null);
  const reach = [new Map(), new Map(), new Map()]; reach[layer].set(sx + ',' + sz, g0);
  const push = (x, z, l, g, from, how) => {
    const k = key(x, z, l, g);
    if (prev.has(k) || block.has(x + ',' + z)) return;
    prev.set(k, [from, how]); reach[l].set(x + ',' + z, g); q.push([x, z, l, g]);
  };
  while (q.length) {
    const [x, z, l, g] = q.shift(), from = key(x, z, l, g);
    for (let d = 0; d < 4; d++) {
      cur = l;
      const b = beh(x, z), nx = x + D[d][0], nz = z + D[d][1];
      const w = walk(x, z, g, nx, nz);
      if (w !== null) { push(nx, nz, w[1], w[0], from, d); continue; }
      cur = l;
      if (b === 253 || beh(nx, nz) === 253) { // climb: up/down a climb column whatever the heights
        if ((d === 0 || d === 2) && beh(nx, nz) !== 255) push(nx, nz, layerOf(nx, nz), height(nx * 16 + 8, nz * 16 + 8), from, d + 8);
        continue;
      }
      if (b === 254 || b === 249 || (d === 3 && JUMPW.has(b))) { // jump two cells forward
        const mx = nx * 16 + 8, mz = nz * 16 + 8, fx = x + 2 * D[d][0], fz = z + 2 * D[d][1];
        if (beh(nx, nz) !== 255 && height(mx, mz) - g > 8) continue; // a wall in between is jumped (IMPASSABLE, not TOO_HIGH)
        if (beh(fx, fz) === 255) continue;
        const h = height(fx * 16 + 8, fz * 16 + 8);
        if (ok(h - g)) push(fx, fz, layerOf(fx, fz), h, from, d + 4);
        continue;
      }
      if (d === 2 && (b === 252 || beh(nx, nz) === 252)) { // ledge: drop south
        for (let k2 = 1; k2 <= 3; k2++) {
          const h = height(x * 16 + 8, (z + k2) * 16 + 8);
          if (beh(x, z + k2) !== 255 && h < g - 8) { push(x, z + k2, layerOf(x, z + k2), h, from, 12); break; }
        }
      }
    }
    if (DIAG) for (let j = 0; j < 4; j++) { // GS19 HPATH_DIAG=1: diagonal steps (both keys held), traced centre to centre
      cur = l;
      const w = walk(x, z, g, x + DD[j][0], z + DD[j][1]);
      if (w !== null) push(x + DD[j][0], z + DD[j][1], w[1], w[0], from, 13 + j);
    }
  }
  cur = layer;
  console.log(`hpath f${frame}: layer ${layer} (cells ${LP.map((p) => p.toString(16)).join(' ')}) leader cell ${sx},${sz} y ${ly.toFixed(1)} ground ${g0}; ${prev.size} states`);
  if (process.env.HPATH_MAP === '3') { // GS19: 4-px samples of the leader's layer: '.' level with the leader (within +8/-12 px),
    // '^' higher, 'v' lower, '#' behavior 255, '@' the leader; HPATH_W/HPATH_H in cells around the leader
    const W = +(process.env.HPATH_W || 16), Hh = +(process.env.HPATH_H || 12);
    const x0 = Math.max(0, sx - (W >> 1)), z0 = Math.max(0, sz - (Hh >> 1));
    console.log(`hpath fine map layer ${layer}: window x ${x0}.. z ${z0}.. (4 px a character, 4 a cell)`);
    for (let pz = z0 * 16; pz < (z0 + Hh) * 16; pz += 4) {
      let row = '';
      for (let px = x0 * 16; px < (x0 + W) * 16; px += 4) {
        const h = height(px + 2, pz + 2) - g0;
        row += (px >> 2) === (Math.floor(lx) >> 2) && (pz >> 2) === (Math.floor(lz) >> 2) ? '@' : beh(px >> 4, pz >> 4) === 255 ? '#' : h > 8 ? '^' : h < -12 ? 'v' : '.';
        if ((px & 15) === 12) row += ' ';
      }
      console.log(`${String(pz >> 4).padStart(3)} ${row}|`);
    }
  }
  if (process.env.HPATH_MAP && process.env.HPATH_MAP !== '3') {
    const W = +(process.env.HPATH_W || 64), Hh = +(process.env.HPATH_H || 48);
    const x0 = Math.max(0, Math.min(128 - W, sx - (W >> 1))), z0 = Math.max(0, sz - (Hh >> 1));
    for (let L = 0; L < 3; L++) {
      if (process.env.HPATH_MAP !== '2' ? !reach[L].size : L !== +(process.env.HPATH_LAYER ?? layer)) continue;
      cur = L;
      console.log(`hpath map layer ${L}: window x ${x0}.. z ${z0}.. (height/8 base 36; '.' unreachable, '#' wall cell, J jump cell)`);
      for (let z = z0; z < z0 + Hh; z++) {
        let row = '';
        for (let x = x0; x < x0 + W; x++) {
          const r = process.env.HPATH_MAP === '2' ? height(x * 16 + 8, z * 16 + 8) : reach[L].get(x + ',' + z), b = beh(x, z);
          row += x === sx && z === sz && L === layer ? '@' : b === 255 ? '#' : r === undefined ? '.' : (b === 254 || b === 249) && process.env.HPATH_MAP !== '2' ? 'J'
            : r < 0 ? '-' : Math.min(35, Math.round(r / 8)).toString(36);
        }
        console.log(`${String(z).padStart(3)} ${row}|`);
      }
    }
  }
  if (!process.env.HPATH_TO) return;
  const [tx, tz] = process.env.HPATH_TO.split(',').map(Number);
  const end = [...prev.keys()].find((k) => k.startsWith(`${tx},${tz},`) && (process.env.HPATH_TO_LAYER === undefined || k.split(',')[2] === process.env.HPATH_TO_LAYER));
  if (!end) { console.log(`hpath: none from ${sx},${sz} to ${tx},${tz}`); return; }
  const steps = []; // [cell, how]
  for (let k = end; prev.get(k); k = prev.get(k)[0]) steps.unshift([k, prev.get(k)[1]]);
  const NAME = (h) => (h >= 13 ? DD[h - 13][2] : h >= 12 ? 'LEDGE' : h >= 8 ? 'CLIMB ' + D[h - 8][2] : h >= 4 ? 'J>' + D[h - 4][2] : D[h][2]);
  const runs = []; for (const [, h] of steps) { const r = runs[runs.length - 1]; if (r && r[0] === h && (h < 4 || h >= 13)) r[1]++; else runs.push([h, 1]); }
  console.log(`hpath ${sx},${sz} -> ${tx},${tz}: ${runs.map(([h, n]) => NAME(h) + (h < 4 || h >= 13 ? ' ' + n : '')).join(', ')}`);
  // autowalk waypoints: every corner and both ends of every jump/climb/ledge (autowalk walks x first, then z)
  const wp = [];
  for (let i = 0; i < steps.length; i++) {
    const h = steps[i][1], n = steps[i + 1] ? steps[i + 1][1] : -1, c = steps[i][0].split(',').slice(0, 2).join(',');
    if (h >= 13) { if (n !== h) wp.push('d' + c); } // a diagonal run: autowalk's 'd' waypoint holds both keys
    else if (h >= 4) { const p = i ? steps[i - 1][0].split(',').slice(0, 2).join(',') : `${sx},${sz}`; if (wp[wp.length - 1] !== p) wp.push(p); wp.push(c); }
    else if (n !== h) wp.push(c);
  }
  console.log(`hpath WP ${wp.join(';')}`);
};
