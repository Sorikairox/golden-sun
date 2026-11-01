/* Field ARM routines (vendor src/field/map_grid_convert.s...), hand-ported to C (D6); the game runs RAM copies
 * of them (codemap.c aliases). Checked by tests/arm/diff.cjs. */
#include "gba.h"

/* Makes the map's 128x128 cell words: 16384 cell-picture halfwords from `pictures` go to the low halves of the
 * words at `cells` (stride 4); a placeholder picture (low 12 bits 0xfff) becomes its high nibble plus a running
 * number from 0 (which stops counting at 0xfff). Then the two 16 KB planes at `planes` (behaviours, then shapes)
 * are interleaved bytewise into the high halves. */
void Tile_ConvertMapGrid(const u16 *pictures, u16 *cells, const u32 *planes) {
  u32 next = 0xFFFFF001u; /* -0xfff: adding it to a placeholder leaves its high nibble */
  u16 *o = cells;
  const u32 *a = planes, *b = planes + 4096;
  int i;
  for (i = 0; i < 16384; i++, o += 2) {
    u32 v = *pictures++;
    if ((v << 20) == 0xFFF00000u) {
      v += next;
      if (next)
        next++;
    }
    *o = (u16)v;
  }
  o = cells + 1;
  for (i = 0; i < 4096; i++) {
    u32 x = *a++, y = *b++;
    u32 lo = (x & 0x00FF00FFu) | (y & 0x00FF00FFu) << 8;
    u32 hi = (y & 0xFF00FF00u) | (x & 0xFF00FF00u) >> 8;
    o[0] = (u16)lo;
    o[2] = (u16)hi;
    o[4] = (u16)(lo >> 16);
    o[6] = (u16)(hi >> 16);
    o += 8;
  }
}
