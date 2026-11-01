/* Window/icon ARM routines (vendor src/window/decompress_4bpp.s, expand_opaque.s), hand-ported to C (D6). The
 * game runs RAM copies (codemap.c aliases). Checked by tests/arm/diff.cjs. */
#include "gba.h"

static u32 bits_at(const u8 *p, const u32 **pp) {
  u32 k = (u32)(uintptr_t)p & 3;
  const u32 *w = (const u32 *)(uintptr_t)((u32)(uintptr_t)p & ~3u);
  if (!k) {
    *pp = w;
    return 1;
  }
  *pp = w + 1;
  return (*w >> (8 * k)) | (1u << (32 - 8 * k));
}

static u32 next_bit(u32 *bits, const u32 **pp) {
  u32 c = *bits & 1;
  *bits >>= 1;
  if (*bits == 0) {
    u32 w = *(*pp)++;
    c = w & 1;
    *bits = (w >> 1) | 0x80000000u;
  }
  return c;
}

/* Pixels (one byte each, values 0-15) from a bit stream (LSB first, sentinel words as the text decoder): bit 0
 * emits the front of a move-to-front list of the 16 values (initially 0..15); bit 1 + a code takes list entry
 * k (1-15) to the front and emits it. Codes: 00 1, 010 2, 011 3, 100 4, 101 5, 110 6, 11100 7, 11101 8,
 * 11110 9, 1111100 10, 1111101 11, 111110 12... (see the tree below); the last code ends the stream. */
void Tile_Decompress4bpp(const void *source, u8 *destination) {
  const u32 *src;
  u32 bits = bits_at((const u8 *)source, &src);
  u8 list[16];
  int i;
  for (i = 0; i < 16; i++)
    list[i] = (u8)i;
#define B() next_bit(&bits, &src)
  for (;;) {
    int k;
    if (B()) {
      if (!B())
        k = !B() ? 1 : B() ? 3 : 2;
      else if (!B())
        k = B() ? 5 : 4;
      else if (!B())
        k = 6;
      else if (!B())
        k = B() ? 8 : 7;
      else if (!B())
        k = 9;
      else if (!B())
        k = B() ? 11 : 10;
      else if (!B())
        k = 12;
      else if (!B())
        k = B() ? 14 : 13;
      else if (B())
        break;
      else
        k = 15;
      {
        u8 v = list[k];
        for (i = k; i > 0; i--)
          list[i] = list[i - 1];
        list[0] = v;
      }
    }
    *destination++ = list[0];
  }
#undef B
}

/* Packs 8 one-byte pixels into a 4bpp tile row word exactly as the ARM does (high nibbles of the bytes
 * bleed into their neighbours as in the original) */
static u32 pack_row(const u8 *p) {
  u32 a = *(const u32 *)p, b = *(const u32 *)(p + 4);
  a = ((a | a >> 4) & 0x00FF00FFu);
  a = (a | a >> 8) & 0x0000FFFFu;
  b = ((b | b >> 4) & 0x00FF00FFu);
  b = b | b >> 8;
  return a | b << 16;
}

/* Converts width x height tiles of one-byte pixels (rows of width * 8 bytes) to 4bpp tiles, tile by tile. */
void Tile_ExpandOpaque(u8 *source, u8 *destination, u32 width, u32 height) {
  u32 *out = (u32 *)destination;
  u8 *row = source;
  do {
    u8 *end = row + width * 8;
    u8 *p = row;
    do {
      int r;
      for (r = 0; r < 8; r++)
        *out++ = pack_row(p + r * width * 8);
      p += 8;
    } while (p != end);
    row = p + width * 64 - width * 8;
  } while (--height);
}

/* As Tile_ExpandOpaque, but pixel 0 keeps what the destination had (outlined text over a background). */
void Tile_ExpandMasked(u8 *source, u8 *destination, u32 width, u32 height) {
  u32 *out = (u32 *)destination;
  u8 *row = source;
  do {
    u8 *end = row + width * 8;
    u8 *p = row;
    do {
      int r;
      for (r = 0; r < 8; r++) {
        u32 v = pack_row(p + r * width * 8);
        u32 m = v | v >> 1;
        m = (m | m >> 2) & 0x11111111u;
        m *= 15;
        if (m != 0xFFFFFFFFu)
          v |= *out & ~m;
        *out++ = v;
      }
      p += 8;
    } while (p != end);
    row = p + width * 64 - width * 8;
  } while (--height);
}
