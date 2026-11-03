/* PC replacement for TLA's include/system/transform.h (same API, guard ALCHEMY_TRANSFORM_H): the identity stores,
 * which the GBA does with three stmia in inline asm, as plain C (as GS1's port/shim/system/port_transform.h). */
#ifndef PORT_TLA_TRANSFORM_H
#define PORT_TLA_TRANSFORM_H
#define ALCHEMY_TRANSFORM_H 1

#include "edition.h"
#include "types.h"

extern s32 gTransform[12];
extern s32 gTransformStackDepth;
extern u8 *gTransformStackTop;

void SceneTransform_RewindStack(void);
void Transform_Push(void);
void Transform_Store(void *destination);
void Transform_Load(const void *source);
void Transform_BuildLookAt(s32 *eye, s32 *target, s32 *out);
void Transform_SetLookAt(s32 *eye, s32 *target);
void Transform_ApplyLookAt(s32 *eye, s32 *target);

/* Twelve 16.16 words: the 3x3 rotation row by row, then the translation; identity = 1.0 at words 0, 4, 8. */
static inline void Transform_SetIdentity(void *matrix) {
  s32 *m = (s32 *)matrix;
  int i;
  for (i = 0; i < 12; i++)
    m[i] = (i % 4 == 0) ? 0x10000 : 0;
}

static inline void Transform_ResetCurrent(void) { Transform_SetIdentity(gTransform); }

#endif
