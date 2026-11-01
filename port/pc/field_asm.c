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

/* gDecodeFillByte (IWRAM) and the colour tables of the sprite pictures (ROM, 256 bytes each) */
extern u8 gDecodeFillByte;
extern const u8 gSpriteColorTables[];

/* Draws a sprite animation's picture (vendor field/picture_decode.s, run from RAM): a byte stream ending at a 0
 * byte; a byte above 223 skips (byte - 223) destination bytes, any other byte puts one. What it puts depends on
 * `mode`: 0 the byte itself; 1-6 and 9-12 the byte through colour table (mode, or mode - 2 for 9-12), counted
 * from 1; 7, 8 the value 15; 13 gDecodeFillByte; 14 the value 1; 15 the value 0. The original keeps a copy of
 * the table last used inside its RAM copy (a cache: same bytes as the ROM's, since the tables are const). */
void Render_DecodePicture(const u8 *src, u8 *dst, s32 mode) {
  const u8 *map = 0;
  u32 fill = 0, b;
  if (mode >= 1 && mode <= 12 && mode != 7 && mode != 8)
    map = gSpriteColorTables + ((mode <= 6 ? mode : mode - 2) - 1) * 256;
  else if (mode == 7 || mode == 8)
    fill = 15;
  else if (mode == 13)
    fill = gDecodeFillByte;
  else if (mode == 14)
    fill = 1;
  else if (mode == 15)
    fill = 0;
  for (;;) {
    b = *src++;
    if (b == 0)
      return;
    if (b > 223)
      dst += b - 223;
    else
      *dst++ = mode == 0 ? (u8)b : map ? map[b] : (u8)fill;
  }
}

/* Uploads an 8bpp sprite buffer (w x h pixels, both rounded down to multiples of 8; nothing if either is 0) as
 * 8x8 tiles, row of tiles by row of tiles, to `vram` (vendor field/map_grid_convert.s, run from RAM). Word reads
 * at word-aligned addresses, as LDM does; the counters are signed, as the ARM's subs/bgt. */
void Tile_CopyStrided(const void *src, u32 w, u32 h, void *vram) {
  u32 s = (u32)(uintptr_t)src;
  u32 *d = (u32 *)vram;
  s32 cols, rows;
  w &= ~7u;
  if (!w)
    return;
  h &= ~7u;
  if (!h)
    return;
  rows = (s32)h;
  do {
    cols = (s32)w;
    for (;;) {
      int r;
      for (r = 0; r < 8; r++) {
        const u32 *p = (const u32 *)(uintptr_t)(s & ~3u);
        *d++ = p[0];
        *d++ = p[1];
        s += w;
        if (r == 7)
          s += 8;
      }
      cols -= 8;
      if (cols <= 0)
        break;
      s -= w << 3;
    }
    s -= w;
    rows -= 8;
  } while (rows > 0);
}
