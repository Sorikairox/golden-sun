/* PC replacement for alchemy's include/system/mul_q16.h (same API): the 16.16 multiply, whose GBA version is
 * smull + orr in inline asm, as a 64-bit product in C (the middle 32 bits of left * right). */
#ifndef PORT_MUL_Q16_H
#define PORT_MUL_Q16_H
#define ALCHEMY_MUL_Q16_H 1

#include "types.h"

static inline s32 MulQ16(s32 left, s32 right) { return (s32)(((s64)left * right) >> 16); }

#endif
