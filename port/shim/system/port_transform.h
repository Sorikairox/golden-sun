/* PC replacement for alchemy's include/system/transform.h (same API): the identity stores, which the GBA does
 * with three stmia in inline asm, written as plain C. */
#ifndef PORT_TRANSFORM_H
#define PORT_TRANSFORM_H
#define ALCHEMY_TRANSFORM_H 1

#include "edition.h"
#include "types.h"

extern s32 gTransform[12];
extern s32 gTransformStackDepth;
extern u8 *gTransformStackTop;

void Transform_RewindStack(void);

/* Twelve 16.16 words: the 3x3 rotation row by row, then the translation. Identity: 1.0 (0x10000) at words 0, 4
 * and 8, every other word 0 -- the same twelve stores the GBA routine makes. */
static inline void Transform_SetIdentity(void *matrix) {
  s32 *m = (s32 *)matrix;
  int i;
  for (i = 0; i < 12; i++)
    m[i] = (i % 4 == 0 && i < 12) ? 0x10000 : 0;
}

static inline void Transform_ResetCurrent(void) { Transform_SetIdentity(gTransform); }

#endif
