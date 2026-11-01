// Test-only probe for tests/boot.cjs --probe: at frame MAP_AT (env) prints the cell behaviors of map layer
// MAP_LAYER (default the leader's) as ASCII around the leader, 128 cells wide (MapGrid_GetCellBehaviorAt):
// '@' leader, ' ' open ground, '#' wall (255), L ledge, C climb, J jump, 'e' encounter ground, other cells their
// event id in base 36 (1-239, the scene's step/examine triggers: '?' above 35). MAP_W/MAP_H set the window;
// MAP_MODE=height prints each cell's first height sample / 16 instead (gMapGridShapes).
'use strict';
const AT = +(process.env.MAP_AT || 0);
module.exports = (m, frame) => {
  if (frame !== AT) return;
  const H = m.HEAPU8;
  const u32 = (a) => (H[a] | H[a + 1] << 8 | H[a + 2] << 16 | H[a + 3] << 24) >>> 0;
  const fw = u32(0x03001ebc), leader = u32(fw + 20), grid = u32(0x03001e70);
  const lx = (u32(leader + 8) | 0) >> 20, lz = (u32(leader + 16) | 0) >> 20, layer = +(process.env.MAP_LAYER ?? H[leader + 36]);
  // MapGridScrollAnimView: origin, shakeX/Y/Decay, script (20 bytes), flags, wideTiles, footprints (24), 16 TilesetAnim...
  // the layer's cells pointer is found by scanning for gMapGridCellBuffer-range pointers 0x34 bytes apart
  let cells = 0x02010000;
  if (process.env.MAP_CELLS) cells = parseInt(process.env.MAP_CELLS, 16);
  const W = +(process.env.MAP_W || 64), Hh = +(process.env.MAP_H || 48);
  const x0 = Math.max(0, Math.min(128 - W, lx - (W >> 1))), z0 = Math.max(0, lz - (Hh >> 1));
  console.log(`map f${frame}: layer ${layer} cells 0x${cells.toString(16)} grid view 0x${grid.toString(16)} leader cell ${lx},${lz}; window x ${x0}.. z ${z0}..`);
  for (let z = z0; z < z0 + Hh; z++) {
    let row = '';
    for (let x = x0; x < x0 + W; x++) {
      const b = H[cells + 4 * (x + (z << 7)) + 2];
      if (process.env.MAP_MODE === 'height') { // the shape's first height sample / 16, base 36 ('#' wall behavior)
        const sh = 0x0202c000 + 4 * H[cells + 4 * (x + (z << 7)) + 3];
        row += x === lx && z === lz ? '@' : b === 255 ? '#' : Math.min(35, H[sh + 1] >> 4).toString(36);
        continue;
      }
      row += x === lx && z === lz ? '@' : b === 0 ? ' ' : b === 255 ? '#' : b === 252 ? 'L' : b === 253 ? 'C' : b === 254 ? 'J'
        : b === 240 || b === 241 ? 'e' : b < 36 ? b.toString(36) : '?';
    }
    console.log(`${String(z).padStart(3)} ${row}|`);
  }
};
