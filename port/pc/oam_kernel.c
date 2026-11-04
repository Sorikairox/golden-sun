/* Oam_BuildBufferKernel and the palette fade kernels (vendor src/system/decompress_byte_lz.s), hand-ported to C (D6); the game copies it to
 * RAM (RamCode_Load) and calls the copy, which codemap.c's alias sends here. Checked by tests/arm/diff.cjs. */
#include "gba.h"

extern u32 gVBlankCount;      /* the word after gOamDepthLists: the kernel walks the 256 slots down from it */
extern u8 gOamMatrixCount;
extern u32 gOamMatrices[];    /* 32 matrices of two words: pa | pb << 16, pc | pd << 16 */
s32 IwramFillWords(void *destination, s32 size, u32 value);

/* GS33 (port data, not GBA RAM): where each entry of the last list came from, for ppu.c's "Menus: Edges" (which OAM
 * entries are menus): the queued entry's address, its depth slot and the attribute words it wrote (attributes 0-1,
 * attribute 2). The game never reads these. */
u32 gPortOamSrc[128], gPortOamWords[128][2];
u8 gPortOamDepth[128];
s32 gPortOamCount;

/* Builds the frame's OAM list in `work`: depth slot 255 down to 0, each slot's chain in link order (an entry's
 * first word links to the next, words 1-2 are the sprite's attributes), at most 128 sprites; the rest of the
 * 128 entries are filled with 0x00C000C0 words (hidden). Then the affine matrices go into the fourth halfword
 * of each group of four entries. */
void Oam_BuildBufferKernel(void *work) {
  u32 *out = (u32 *)work;
  u32 *slot = &gVBlankCount;
  s32 left = 128;
  int b;
  u8 *o;
  gPortOamCount = 0;
  u32 n;
  const u32 *m;
  for (b = 0; b < 256; b++) {
    u32 e = *--slot;
    while (e) {
      const u32 *p = (const u32 *)(uintptr_t)e;
      s32 k = 128 - left;
      gPortOamSrc[k] = e;
      gPortOamDepth[k] = (u8)(255 - b);
      gPortOamWords[k][0] = p[1];
      gPortOamWords[k][1] = p[2] & 0xFFFF;
      gPortOamCount = k + 1;
      e = p[0];
      *out++ = p[1];
      *out++ = p[2];
      if (--left == 0)
        goto affine;
    }
  }
  IwramFillWords(out, left << 3, 0x00C000C0u);
affine:
  o = (u8 *)work + 6;
  n = gOamMatrixCount;
  m = gOamMatrices;
  for (; n; n--, m += 2, o += 32) {
    *(u16 *)o = (u16)m[0];
    *(u16 *)(o + 8) = (u16)(m[0] >> 16);
    *(u16 *)(o + 16) = (u16)m[1];
    *(u16 *)(o + 24) = (u16)(m[1] >> 16);
  }
}

/* The palette fade kernels (decompress_byte_lz.s; PaletteFade_BackupAnd* copy one to the stack and call it):
 * buffers of 8-bit colour-ramp steps (0..63) shaded four bytes a word, 16 bytes a pass, after copying each pass
 * to `backup`. Word arithmetic as the original: carries and borrows may cross bytes for values outside the
 * ramp. bytes is a nonzero multiple of 16 (0 would never end, as in the original). */
#define FADE_LOOP(body)                                                                                         \
  u32 *b = (u32 *)buffer, *k = (u32 *)backup, *end = (u32 *)(buffer + bytes);                                   \
  do {                                                                                                          \
    int i;                                                                                                      \
    for (i = 0; i < 4; i++)                                                                                     \
      k[i] = b[i];                                                                                              \
    k += 4;                                                                                                     \
    for (i = 0; i < 4; i++) {                                                                                   \
      u32 w = b[i];                                                                                             \
      body                                                                                                      \
    }                                                                                                           \
    b += 4;                                                                                                     \
  } while (b != end)

static u32 fade_brighten(u32 w, u32 amount) {
  u32 cap;
  w += amount;
  cap = w & 0x40404040u;
  w &= ~cap;
  cap -= cap >> 6;
  return w | cap;
}

static u32 fade_darken(u32 w, u32 amount) {
  u32 t = w + (0x80808080u - amount), m = 0x01010101u & (t >> 7);
  return t & ((m << 7) - m);
}

void PaletteFade_BrightenKernel(u8 *buffer, u32 amount, u8 *backup, u32 bytes) {
  FADE_LOOP(b[i] = fade_brighten(w, amount););
}

void PaletteFade_BrightenPartialKernel(u8 *buffer, u32 amount, u8 *backup, u32 bytes) {
  FADE_LOOP(if (w != 0x3f3f3f3fu) b[i] = fade_brighten(w, amount););
}

void PaletteFade_DarkenKernel(u8 *buffer, u32 amount, u8 *backup, u32 bytes) {
  FADE_LOOP(b[i] = fade_darken(w, amount););
}

void PaletteFade_DarkenPartialKernel(u8 *buffer, u32 amount, u8 *backup, u32 bytes) {
  FADE_LOOP(if (w != 0) b[i] = fade_darken(w, amount););
}

void PaletteFade_ScaleThreeQuartersKernel(u8 *buffer, u8 *backup, u32 bytes) {
  FADE_LOOP(w += w << 1; b[i] = w ? 0x3f3f3f3fu & (w >> 2) : 0;);
}

void PaletteFade_ScaleNonzeroThreeQuartersKernel(u8 *buffer, u8 *backup, u32 bytes) {
  FADE_LOOP(w += w << 1; if (w) b[i] = 0x3f3f3f3fu & (w >> 2););
}

void PaletteFade_HalveKernel(u8 *buffer, u8 *backup, u32 bytes) {
  FADE_LOOP(b[i] = 0x3f3f3f3fu & (w >> 1););
}

void PaletteFade_HalveNonzeroKernel(u8 *buffer, u8 *backup, u32 bytes) {
  FADE_LOOP(if (w) b[i] = 0x3f3f3f3fu & (w >> 1););
}
#undef FADE_LOOP

/* GS33: the tags' addresses for test probes (0 sources, 1 depths, 2 words, 3 count) */
void *Port_OamTags(s32 which) {
  return which == 0 ? (void *)gPortOamSrc : which == 1 ? (void *)gPortOamDepth : which == 2 ? (void *)gPortOamWords
                                                                                             : (void *)&gPortOamCount;
}
