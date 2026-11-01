/* Battle effect blitters (D6): BattleEffect_BuildBlitter (vendor C, battle_effect/blitter.c) writes an ARM
 * routine into a heap slot, assembled from gBlitterTemplate and the pixel fragments of blitter_fragments.s /
 * blitter_color_fragments.s for one canvas size, clip, mirroring and blend mode, and effects call the slot as a
 * DrawRectangle(destination, source, x, y, width, height). The vendor builder still runs (same heap use, same
 * words in RAM); a build-time text rule (port/c_rules.tsv) then calls Port_BlitterBuilt with the routine's
 * address and parameters, which aliases that address to one of a few C entry points that draw with those
 * parameters. Port_BlitterDraw follows the generated routine instruction block by instruction block, registers
 * as variables (named after them), including its quirks: the 16-cell horizontal wrap counter when unclipped,
 * immediates patched into ARM operand fields (decoded as the CPU would), unaligned word accesses of the
 * four-pixel fragments, carries between bytes in the additive word fragment. Checked against the generated ARM
 * code by tests/arm/diff.cjs (BattleEffect blitters). */
#include "gba.h"

void Port_CodeAliasFn(u32 to, void *fn);

enum { CLIP_X = 1, CLIP_Y = 2, FLIP_X = 4, FLIP_Y = 8 };
enum { MODE_COPY, MODE_TRANSPARENT, MODE_LIGHTEN, MODE_ADDITIVE };

struct BlitterParams {
  u32 gba; /* the routine's address, 0 = free */
  s32 widthShift, heightShift, flags;
  u32 mode;
};

#define BLITTER_ENTRIES 8
static struct BlitterParams params[BLITTER_ENTRIES];
static int nextEntry;

/* An ARM data-processing immediate field: imm8 rotated right by twice bits 8..11 (12 bits; overflow of a
 * patched field carries into the rotation exactly as in the generated word) */
static u32 arm_imm(u32 field) {
  u32 imm = field & 0xFF, rot = ((field >> 8) & 15) * 2;
  return rot ? (imm >> rot) | (imm << (32 - rot)) : imm;
}

/* ldr of a word at an unaligned address: the aligned word rotated right by 8 per byte of misalignment */
static u32 ldr_rot(u32 a) {
  u32 w = *(volatile u32 *)(uintptr_t)(a & ~3u), r = (a & 3) * 8;
  return r ? (w >> r) | (w << (32 - r)) : w;
}

static s32 Port_BlitterDraw(const struct BlitterParams *p, u32 r0, u32 r1, s32 r2, s32 r3, s32 r4, s32 r5) {
  const s32 ws = p->widthShift, hs = p->heightShift, flags = p->flags;
  const u32 mode = p->mode;
  const s32 step = (flags & FLIP_X) ? -1 : 1; /* source direction: Reverse fragments read r1 backwards */
  s32 r6, r7 = 0, fp = 0, lr, ip;
  u32 r9, end;
  const u32 sl = 0x40404040u; /* BattleEffect_Mask (additive only) */
  int i;

  /* Block 1: the start of the picture and the step between its rows */
  switch (flags & (FLIP_X | FLIP_Y)) {
  case FLIP_X:
    r6 = (s32)r1 + r4;
    r1 = (u32)(r6 - 1);
    r6 = r4 << 1;
    break;
  case FLIP_Y:
    r6 = r5 - 1;
    r1 = (u32)(r6 * r4) + r1;
    r6 = (-r4) << 1;
    break;
  case FLIP_X | FLIP_Y:
    r1 = (u32)(r4 * r5) + r1;
    r1 -= 1;
    r6 = 0;
    break;
  default:
    r6 = 0;
    break;
  }
  /* Block 2: vertical clip */
  if (flags & CLIP_Y) {
    ip = (s32)(0u - (u32)r3);
    if (ip >= 0) {
      r5 += r3;
      r1 += (flags & FLIP_Y) ? (u32)(r3 * r4) : (u32)(ip * r4);
      r3 = 0;
    }
    ip = (s32)((u32)r3 + (u32)r5);
    if (ip > (s32)arm_imm(1u << hs))
      r5 = (s32)arm_imm(1u << hs) - r3;
  }
  /* Block 3: columns */
  if (r5 <= 0)
    return (s32)r0;
  if (!(flags & CLIP_X))
    r2 &= (s32)arm_imm((1u << ws) - 1);
  if (flags & CLIP_X) {
    s32 width = (s32)arm_imm(ws < 8 ? 1u << ws : (u32)((12 - (ws - 8) / 2) << 8 | 1 << (ws & 1)));
    ip = (s32)(0u - (u32)r2);
    if (ip >= 0) {
      r4 += r2;
      if (flags & FLIP_X) {
        r6 += r2;
        r1 += (u32)r2;
      } else {
        r6 -= r2;
        r1 -= (u32)r2;
      }
      r2 = 0;
    }
    ip = (s32)((u32)r2 + (u32)r4); /* subs ip, ip, #width; ..gt: the signed comparison */
    if (ip > width) {
      ip = (s32)((u32)ip - (u32)width);
      if (flags & FLIP_X)
        r6 -= ip;
      else
        r6 += ip;
      r4 = width - r2;
    }
  }
  if (r4 <= 0)
    return (s32)r0;
  r7 = r2 & 7;
  if (r7 != 0) {
    r7 = 8 - r7;
    r4 -= r7;
    if (r4 < 0) {
      r7 = r4 + r7;
      r4 = 0;
    }
  }
  ip = (s32)((u32)r2 >> 3);
  if (!(flags & CLIP_X))
    fp = 16 - ip;
  r2 = (r2 & 7) + (ip << 6);
  r0 += (u32)r2;
  r3 <<= 3;
  end = (u32)r3 + ((u32)r5 << 3);

  /* Block 4: the rows */
  do {
    u32 lrMask = arm_imm(0xD00u + (1u << (hs - 3)) - 1);
    ip = (s32)(((u32)r3 & 56) | (((u32)r3 & lrMask) << (ws - 3)));
    r9 = r0 + (u32)ip;
    lr = fp;
#define PIXEL1()                                                                                                \
  do {                                                                                                          \
    u32 b = *(volatile u8 *)(uintptr_t)r1, c;                                                                   \
    r1 += (u32)step;                                                                                            \
    switch (mode) {                                                                                             \
    default:                                                                                                    \
    case MODE_COPY:                                                                                             \
      *(volatile u8 *)(uintptr_t)r9 = (u8)b;                                                                    \
      break;                                                                                                    \
    case MODE_TRANSPARENT:                                                                                      \
      if (b)                                                                                                    \
        *(volatile u8 *)(uintptr_t)r9 = (u8)b;                                                                  \
      break;                                                                                                    \
    case MODE_LIGHTEN:                                                                                          \
      c = *(volatile u8 *)(uintptr_t)r9;                                                                        \
      if ((s32)b > (s32)c)                                                                                      \
        *(volatile u8 *)(uintptr_t)r9 = (u8)b;                                                                  \
      break;                                                                                                    \
    case MODE_ADDITIVE:                                                                                         \
      c = *(volatile u8 *)(uintptr_t)r9 + b;                                                                    \
      if (c >= 63)                                                                                              \
        c = 63;                                                                                                 \
      *(volatile u8 *)(uintptr_t)r9 = (u8)c;                                                                    \
      break;                                                                                                    \
    }                                                                                                           \
    r9++;                                                                                                       \
  } while (0)
    /* the leading partial run, to the end of its cell */
    if (r7 != 0) {
      u32 stop = r1 + (u32)(step * r7);
      do
        PIXEL1();
      while (r1 != stop);
      r9 += 56;
      if (!(flags & CLIP_X) && --lr == 0)
        r9 -= 1024;
    }
    /* whole cells, eight pixels a pass */
    ip = (s32)((u32)r4 >> 3);
    if (ip != 0) {
      do {
        if (mode == MODE_LIGHTEN) { /* Max4 twice: one word read, byte compares, byte stores */
          int h;
          for (h = 0; h < 2; h++) {
            u32 r8 = ldr_rot(r9);
            r9 += 4;
            for (i = 0; i < 4; i++) {
              u32 b = *(volatile u8 *)(uintptr_t)r1;
              r1 += (u32)step;
              if ((s32)b > (s32)((r8 >> (8 * i)) & 255))
                *(volatile u8 *)(uintptr_t)(r9 - 4 + i) = (u8)b;
            }
          }
        } else if (mode == MODE_ADDITIVE) { /* Color twice: four bytes added into a word, capped through sl */
          int h;
          for (h = 0; h < 2; h++) {
            u32 r8 = ldr_rot(r9), r5w;
            for (i = 0; i < 4; i++) {
              r8 += (u32)*(volatile u8 *)(uintptr_t)r1 << (8 * i);
              r1 += (u32)step;
            }
            r5w = r8 & sl;
            r8 &= ~sl;
            r5w -= r5w >> 6;
            r8 |= r5w;
            *(volatile u32 *)(uintptr_t)(r9 & ~3u) = r8;
            r9 += 4;
          }
        } else { /* Copy x8 or Transparent8 (same as eight one-pixel fragments) */
          for (i = 0; i < 8; i++)
            PIXEL1();
        }
        r9 += 56;
        if (!(flags & CLIP_X) && --lr == 0)
          r9 -= 1024;
      } while (--ip != 0);
    }
    /* the trailing partial run */
    ip = r4 & 7;
    if (ip != 0) {
      u32 stop = r1 + (u32)(step * ip);
      do
        PIXEL1();
      while (r1 != stop);
    }
#undef PIXEL1
    r1 += (u32)r6;
    r3 += 8;
  } while ((u32)r3 != end);
  return (s32)r0;
}

#define ENTRY(n)                                                                                                \
  static s32 Port_Blitter##n(u32 dst, u32 src, s32 x, s32 y, s32 w, s32 h) {                                    \
    return Port_BlitterDraw(&params[n], dst, src, x, y, w, h);                                                  \
  }
ENTRY(0)
ENTRY(1)
ENTRY(2)
ENTRY(3)
ENTRY(4)
ENTRY(5)
ENTRY(6)
ENTRY(7)
static void *const entries[BLITTER_ENTRIES] = {Port_Blitter0, Port_Blitter1, Port_Blitter2, Port_Blitter3,
                                               Port_Blitter4, Port_Blitter5, Port_Blitter6, Port_Blitter7};

/* Called by BattleEffect_BuildBlitter (port/c_rules.tsv) once the routine is written at gba */
void Port_BlitterBuilt(u32 gba, s32 widthShift, s32 heightShift, s32 flags, u32 mode) {
  int i, n = -1;
  for (i = 0; i < BLITTER_ENTRIES; i++)
    if (params[i].gba == gba)
      n = i;
  if (n < 0) {
    n = nextEntry;
    nextEntry = (nextEntry + 1) % BLITTER_ENTRIES;
  }
  params[n].gba = gba;
  params[n].widthShift = widthShift;
  params[n].heightShift = heightShift;
  params[n].flags = flags;
  params[n].mode = mode;
  Port_CodeAliasFn(gba, entries[n]);
}
