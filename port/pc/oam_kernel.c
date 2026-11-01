/* Oam_BuildBufferKernel (vendor src/system/decompress_byte_lz.s), hand-ported to C (D6); the game copies it to
 * RAM (RamCode_Load) and calls the copy, which codemap.c's alias sends here. Checked by tests/arm/diff.cjs. */
#include "gba.h"

extern u32 gVBlankCount;      /* the word after gOamDepthLists: the kernel walks the 256 slots down from it */
extern u8 gOamMatrixCount;
extern u32 gOamMatrices[];    /* 32 matrices of two words: pa | pb << 16, pc | pd << 16 */
s32 IwramFillWords(void *destination, s32 size, u32 value);

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
  u32 n;
  const u32 *m;
  for (b = 0; b < 256; b++) {
    u32 e = *--slot;
    while (e) {
      const u32 *p = (const u32 *)(uintptr_t)e;
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
