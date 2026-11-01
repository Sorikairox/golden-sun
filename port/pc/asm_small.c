/* Small vendor assembly routines hand-ported to C (D6), each checked against the original Thumb/ARM code by
 * tests/arm/diff.cjs (D20): trig.s, heap_release.s, umul_high.s. */
#include "gba.h"

extern const u16 Trig_SineTable[]; /* 257 halfwords: sin over a quarter turn in 0.16, ROM data */
extern u32 gHeapSlots[64];         /* words 0 and 1: the EWRAM and IWRAM pools' next free addresses */

/* Angle: 16 bits per turn. Rounded to 1/1024 turn (+32, bits 6..13 index the quarter-turn table); bit 14
 * mirrors the index within the quarter, bit 15 negates. On an axis (index 0) the result is 0 or +-0x10000. */
s32 Trig_Sin(s32 angle) {
  u32 a = (u32)angle + 32;
  u32 index = (a << 18) >> 24;
  s32 v;
  if (index == 0) { /* Trig_SinOnAxis */
    v = (s32)(((a >> 14) & 1) << 16);
    return (a >> 15) & 1 ? -v : v;
  }
  if ((a >> 14) & 1)
    index = 256 - index;
  v = Trig_SineTable[index];
  return (a >> 15) & 1 ? -v : v;
}

s32 Trig_Cos(s32 angle) { return Trig_Sin((s32)((u32)angle + 0x4000)); }

/* Puts a block's address back as its pool's next free address: bit 24 of the address (0x03xxxxxx) picks the
 * IWRAM pool (word 1), else the EWRAM pool (word 0). */
void Heap_Release(void *block) {
  u32 a = (u32)(uintptr_t)block;
  gHeapSlots[((a >> 22) & 4) >> 2] = a;
}

/* Releases heap slot `slot`: a slot holding an address (any bit above 21 set) is cleared and that address
 * becomes its pool's next free address. */
void HeapSlot_Release(s32 slot) {
  u32 a = gHeapSlots[slot];
  if (a >> 22) {
    gHeapSlots[slot] = 0;
    gHeapSlots[((a >> 22) & 4) >> 2] = a;
  }
}

/* High word of the unsigned 64-bit product */
u32 umul3232H32(u32 a, u32 b) { return (u32)(((u64)a * b) >> 32); }
