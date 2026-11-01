/* PC replacement for alchemy's include/system/iwram_call.h (same API). On the GBA these routines are ARM code
 * copied to IWRAM and called at fixed addresses; a wasm function pointer is a table index, not an address, so
 * every entry here is one of our C functions (port layer, written and unit-tested against the originals in
 * G2/G3). */
#ifndef PORT_IWRAM_CALL_H
#define PORT_IWRAM_CALL_H
#define ALCHEMY_IWRAM_CALL_H 1

#include "types.h"

s32 Port_IwramRatioMulQ14(s32 divisor, s32 value);
s32 Port_IwramClearWords(void *destination, s32 size);
s32 Port_IwramFillWords(void *destination, s32 size, u32 value);
s32 Port_IwramSqrt(s32 value);
s32 Port_IwramExpandBitRuns(const void *bits, void *destination, s32 value);
s32 Port_IwramTransformVector(const void *vector, s32 *result);
void Port_IwramTransformMatrix(const s32 *matrix);
s32 Port_IwramSignedDivide(s32 dividend, s32 divisor);
u32 Port_IwramUnsignedDivide(u32 dividend, u32 divisor);
void *Port_IwramDecompress(const void *source, void *destination);
s32 Port_IwramCopyWords(void *destination, const void *source, s32 size);

#define Iwram_RatioMulQ14Entry Port_IwramRatioMulQ14
#define Iwram_ClearWordsEntry Port_IwramClearWords
#define Iwram_FillWordsEntry Port_IwramFillWords
#define Iwram_SqrtEntry Port_IwramSqrt
#define Iwram_ExpandBitRuns Port_IwramExpandBitRuns
#define Iwram_TransformVectorEntry Port_IwramTransformVector
#define Iwram_TransformMatrixEntry Port_IwramTransformMatrix
#define Iwram_SignedDivideEntry Port_IwramSignedDivide
#define Iwram_UnsignedDivideEntry Port_IwramUnsignedDivide
#define Iwram_DecompressEntry Port_IwramDecompress
#define Iwram_CopyWordsEntry Port_IwramCopyWords

static inline s32 Iwram_RatioMulQ14(s32 divisor, s32 value) { return Port_IwramRatioMulQ14(divisor, value); }
static inline s32 Iwram_ClearWords(void *destination, s32 size) { return Port_IwramClearWords(destination, size); }
static inline s32 Iwram_FillWords(void *destination, s32 size, u32 value) {
  return Port_IwramFillWords(destination, size, value);
}
static inline s32 Iwram_Sqrt(s32 value) { return Port_IwramSqrt(value); }
static inline s32 Iwram_TransformVector(const void *vector, s32 *result) {
  return Port_IwramTransformVector(vector, result);
}
static inline void Iwram_TransformMatrix(const s32 *matrix) { Port_IwramTransformMatrix(matrix); }
static inline s32 Iwram_SignedDivide(s32 dividend, s32 divisor) { return Port_IwramSignedDivide(dividend, divisor); }
static inline u32 Iwram_UnsignedDivide(u32 dividend, u32 divisor) {
  return Port_IwramUnsignedDivide(dividend, divisor);
}
static inline void *Iwram_Decompress(const void *source, void *destination) {
  return Port_IwramDecompress(source, destination);
}
static inline s32 Iwram_CopyWords(volatile void *destination, const volatile void *source, s32 size) {
  return Port_IwramCopyWords((void *)destination, (const void *)source, size);
}

/* Offsets of IWRAM routines from IwramIrqMain: item.c and actor_update_arm.c call them as
 * (fn type)(IwramIrqMain + offset). In wasm a function pointer is a table index, so each offset is chosen to make
 * that sum the index of our C function (plain i32 arithmetic in wasm32). */
extern u8 IwramIrqMain[];
#define Iwram_CopyWordsOffset ((u32)(void *)Port_IwramCopyWords - (u32)(void *)IwramIrqMain)
#define Iwram_RatioMulQ14Offset ((u32)(void *)Port_IwramRatioMulQ14 - (u32)(void *)IwramIrqMain)
#define Iwram_SqrtOffset ((u32)(void *)Port_IwramSqrt - (u32)(void *)IwramIrqMain)

/* (left * right) >> 16 with a 64-bit product: the 16.16 product (IwramMulQ16ReturnIp on the GBA). */
static inline s32 Iwram_MulQ16(s32 left, s32 right) { return (s32)(((s64)left * right) >> 16); }

#endif
