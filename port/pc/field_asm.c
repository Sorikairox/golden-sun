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

/* field/picture_decode.s TileMap_DrawRows (GS9): WorldMap_StartStillPicture (a menu or event opening on the World
 * Map) copies it to HEAP_SLOT_RAM_CODE_TEMP and calls (lines, pixels, tiles, map) to freeze the perspective view
 * as a 240x160 8bpp picture in tile order. Per screen line: BG2's affine line (32-byte pairs: pa at +0, pc at +4,
 * x at +8, y at +12, 20.8 fixed point) steps a point across the 512x512 ground: map byte = map[(y>>11 & 63) * 64 +
 * (x>>11 & 63)], pixel = tiles[map byte * 64 + ((y>>8) & 7) * 8 + ((x>>8) & 7)] (8bpp tiles); where the map byte
 * or that pixel is 0 it falls back to BG3: the map 4096 bytes lower and the tiles 16384 bytes lower (that pixel
 * is taken even when 0). Output: 30 tiles a row of 64 bytes, 8 rows of 8 pixels each, rows of tiles 1920 bytes. */
static inline u32 drawrows_pixel(u32 *x, u32 *y, s32 pa, s32 pc, const u8 *tiles, const u8 *map) {
  const u8 *m = map + (*x >> 26) + ((*y >> 26) << 6);
  const u8 *t = tiles + ((*y >> 20) & 0x38) + ((*x << 6) >> 29);
  u32 c = *m;
  if (c)
    c = t[c << 6];
  if (!c) {
    c = m[-4096];
    c = (t - 16384)[c << 6];
  }
  *x += (u32)pa << 15;
  *y += (u32)pc << 15;
  return c;
}

void TileMap_DrawRows(const u8 *lines, u8 *pixels, const u8 *tiles, const u8 *map) {
  u32 counters = 0xFFA00038u; /* r4: the tile counter in bits 24-31, the line counter (160) in bits 16-23 */
  u8 *out = pixels;
  do {
    s32 pc = *(const s16 *)(lines + 4), pa = *(const s16 *)lines;
    u32 x = *(const u32 *)(lines + 8) << 15, y = *(const u32 *)(lines + 12) << 15;
    lines += 32;
    counters += 0x1E000000u;
    do {
      int k;
      for (k = 0; k < 4; k++) {
        u32 lo = drawrows_pixel(&x, &y, pa, pc, tiles, map);
        u32 hi = drawrows_pixel(&x, &y, pa, pc, tiles, map);
        *(u16 *)out = (u16)(lo | hi << 8);
        out += 2;
      }
      out += 56;
      counters -= 0x01000000u;
    } while (!(counters & 0x80000000u));
    out -= 1920 - 8;
    counters -= 0x10000u;
    if (!(counters & 0x70000u))
      out += 1856;
  } while (counters & 0xFF0000u);
}
