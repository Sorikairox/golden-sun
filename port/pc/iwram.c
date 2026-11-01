/* The resident IWRAM routines (vendor src/system/iwram_routines.s and IwramCopyWords in
 * src/sound/resident_mixer_render.s), hand-ported to C (D6). Each keeps the original's exact results, including
 * the cases where they differ from C's operators; tests/arm/diff.cjs runs the original ARM code from the ROM in
 * the test interpreter (D20) on random and edge-case inputs and compares results and memory.
 *
 * The vendor calls them through port/shim/system/port_iwram_call.h (Port_Iwram*) and, from overlays and libgcc
 * names, through veneers to their original names (IwramUnsignedDivide...), so both are defined here. */
#include "gba.h"

/* gTransform: the current 4x3 16.16 matrix in IWRAM, read by the transform routines */
extern s32 gTransform[12];

/* The shared divide core: shift-and-subtract over 32 bits, 4 bits per group, skipping groups where the
 * divisor is larger than the dividend's top bits. Quotient in *q, remainder returned. Division by zero sets
 * every quotient bit (each step's compare succeeds) and leaves the dividend as the remainder. The group skip
 * (r1 >> k) < r2 is unsigned, so it is exact; the steps are plain long division. */
static u32 divide_core(u32 n, u32 d, u32 q0, u32 *quotient) {
  u32 q = q0;
  int k;
  if (d == 0) {
    /* every rsbs compare is n >> k >= 0: carry set, so every bit is or'ed in and nothing subtracted, except
     * that the very first test (n >> 28) and each group test still pass; the final "rsbs r3, r2, r1; bxcc"
     * passes too */
    *quotient = 0xFFFFFFFFu;
    return n;
  }
  for (k = 28; k >= 0; k -= 4) {
    int b;
    if (k > 0 && (n >> k) < d)
      continue;
    if (k == 0 && n < d) { /* rsbs r3, r2, r1; bxcc lr: return before the low group */
      *quotient = q;
      return n;
    }
    for (b = k + 3; b >= k; b--)
      if ((n >> b) >= d) {
        q |= 1u << b;
        n -= d << b;
      }
  }
  *quotient = q;
  return n;
}

u32 IwramUnsignedDivide(u32 dividend, u32 divisor) {
  u32 q;
  divide_core(dividend, divisor, 0, &q);
  return q;
}

u32 IwramUnsignedRemainder(u32 dividend, u32 divisor) {
  u32 q;
  return divide_core(dividend, divisor, 0, &q);
}

/* Quotient negated when the operands' signs differ (sign of dividend XOR divisor), magnitudes divided. */
s32 IwramSignedDivide(s32 dividend, s32 divisor) {
  u32 q;
  u32 d = divisor < 0 ? 0u - (u32)divisor : (u32)divisor;
  u32 n = dividend < 0 ? 0u - (u32)dividend : (u32)dividend;
  divide_core(n, d, 0, &q);
  return ((u32)dividend ^ (u32)divisor) >> 31 ? (s32)(0u - q) : (s32)q;
}

/* Not C's %: the remainder takes the sign of (dividend XOR divisor), not the dividend's. */
s32 IwramSignedRemainder(s32 dividend, s32 divisor) {
  u32 q, r;
  u32 d = divisor < 0 ? 0u - (u32)divisor : (u32)divisor;
  u32 n = dividend < 0 ? 0u - (u32)dividend : (u32)dividend;
  r = divide_core(n, d, 0, &q);
  return ((u32)dividend ^ (u32)divisor) >> 31 ? (s32)(0u - r) : (s32)r;
}

/* value * (0x40000000 / divisor) >> 14, with the 64-bit product */
s32 IwramRatioMulQ14(s32 divisor, s32 value) {
  s32 ratio = IwramSignedDivide(0x40000000, divisor);
  return (s32)(u32)((u64)((s64)value * ratio) >> 14);
}

/* (left * right) >> 16 */
s32 IwramMulQ16(s32 left, s32 right) { return (s32)(u32)((u64)((s64)left * right) >> 16); }

/* Fills (size & 0xe0) bytes, then 256 bytes while size - 256k stays >= 0, then the (size & 0x1c) words left:
 * size & ~3 bytes for any size >= 0. Returns the end of the filled range. */
s32 IwramFillWords(void *destination, s32 size, u32 value) {
  u32 *p = (u32 *)destination;
  s32 n;
  for (n = (size & 0xe0) / 4; n > 0; n--)
    *p++ = value;
  for (size -= 256; size >= 0; size -= 256)
    for (n = 0; n < 64; n++)
      *p++ = value;
  n = size & 0x1c;
  if (n) {
    do {
      *p++ = value;
      n -= 4;
    } while (n > 0);
  }
  return (s32)(uintptr_t)p;
}

s32 IwramClearWords(void *destination, s32 size) { return IwramFillWords(destination, size, 0); }

/* The same unrolled shape as IwramFillWords, copying. Returns the end of the destination range. */
s32 IwramCopyWords(void *destination, const void *source, s32 size) {
  u32 *d = (u32 *)destination;
  const u32 *s = (const u32 *)source;
  s32 n;
  for (n = (size & 0xe0) / 4; n > 0; n--)
    *d++ = *s++;
  for (size -= 256; size >= 0; size -= 256)
    for (n = 0; n < 64; n++)
      *d++ = *s++;
  n = size & 0x1c;
  if (n) {
    do {
      *d++ = *s++;
      n -= 4;
    } while (n > 0);
  }
  return (s32)(uintptr_t)d;
}

/* Integer square root, two bits per step from 0x8000 down; 0 for negative input. */
s32 IwramSqrt(s32 value) {
  u32 v = (u32)value, r = 0, step = 0x8000;
  if (value < 0)
    return 0;
  do {
    r += step;
    if (r * r > v)
      r -= step;
    r += step >> 1;
    if (r * r > v)
      r -= step >> 1;
    step >>= 2;
  } while (step);
  return (s32)r;
}

/* 14 halfwords of bits (the international editions), each expanding to 16 destination bytes: bit 15 - i set
 * stores `value` at byte i, for i = 0..13 (bits 1 and 0 are ignored). Returns the end of the bits. */
s32 IwramExpandBitRuns(const void *bits, void *destination, s32 value) {
  const u16 *h = (const u16 *)bits;
  u8 *row = (u8 *)destination;
  int k, i;
  for (k = 0; k < 14; k++, row += 16) {
    u32 b = h[k] & ~3u;
    for (i = 0; i < 14; i++)
      if (b & (0x8000u >> i))
        row[i] = (u8)value;
  }
  return (s32)(uintptr_t)(h + 14);
}

/* result = vector * rotation (rows of gTransform) >> 16 + translation, with 64-bit sums. Returns the address
 * after gTransform (the original's r0). */
s32 IwramTransformVector(const void *vector, s32 *result) {
  const s32 *v = (const s32 *)vector;
  s64 a0 = 0, a1 = 0, a2 = 0;
  int j;
  for (j = 0; j < 3; j++) {
    a0 += (s64)v[j] * gTransform[3 * j];
    a1 += (s64)v[j] * gTransform[3 * j + 1];
    a2 += (s64)v[j] * gTransform[3 * j + 2];
  }
  result[0] = (s32)((u32)gTransform[9] + (u32)((u64)a0 >> 16));
  result[1] = (s32)((u32)gTransform[10] + (u32)((u64)a1 >> 16));
  result[2] = (s32)((u32)gTransform[11] + (u32)((u64)a2 >> 16));
  return (s32)(uintptr_t)(gTransform + 12);
}

/* gTransform = matrix * gTransform: the 3 rotation rows and the translation row of `matrix` times
 * gTransform's rotation, plus gTransform's translation on the last row. */
void IwramTransformMatrix(const s32 *matrix) {
  s32 out[12];
  int row, k;
  for (row = 0; row < 4; row++)
    for (k = 0; k < 3; k++) {
      s64 acc = (s64)gTransform[k] * matrix[3 * row] + (s64)gTransform[3 + k] * matrix[3 * row + 1] +
                (s64)gTransform[6 + k] * matrix[3 * row + 2];
      out[3 * row + k] = (s32)(u32)((u64)acc >> 16);
    }
  for (k = 0; k < 3; k++)
    out[9 + k] = (s32)((u32)out[9 + k] + (u32)gTransform[9 + k]);
  for (k = 0; k < 12; k++)
    gTransform[k] = out[k];
}

/* The resident LZ decoder (IwramDecompress). Stream: a 16-bit offset (from the stream's start) to its second
 * area, then the literal bytes. The second area holds flag bytes (8 flags each, LSB first) and big-endian
 * back-reference words. A set flag takes one literal; a clear flag a back reference: 12-bit distance back from
 * the literal stream's start (r6, never moved: references copy earlier *source* bytes, not output), 4-bit count
 * (0 = one more byte + 16), count + 2 bytes copied. Any byte above 223, literal or copied, is not stored: it
 * skips (byte - 223) destination bytes. A zero reference word ends it (returns 0); a zero offset returns at
 * once with r0 = source + 2. */
void *IwramDecompress(const void *source, void *destination) {
  const u8 *lit = (const u8 *)source;
  const u8 *ref;
  const u8 *base;
  u8 *out = (u8 *)destination;
  u32 offset, flags;
  offset = lit[0] | (u32)lit[1] << 8;
  lit += 2;
  if (offset == 0)
    return (void *)lit;
  base = lit;
  ref = lit + offset - 2;
  for (;;) {
    flags = *ref++ | 0x100;
    for (;;) {
      u32 bit = flags & 1;
      flags >>= 1;
      if (bit) {
        u32 b;
        if (flags == 0)
          break; /* the 0x100 sentinel: next flag byte */
        b = *lit++;
        if (b > 223)
          out += b - 223;
        else
          *out++ = (u8)b;
        continue;
      }
      {
        u32 word = (u32)ref[0] << 8 | ref[1];
        const u8 *from;
        s32 count;
        ref += 2;
        if (word == 0)
          return 0;
        from = base - (word & 0x0fff);
        count = (s32)(word >> 12);
        if (count == 0)
          count = *ref++ + 16;
        count += 1;
        do {
          u32 b = *from++;
          if (b > 223)
            out += b - 223;
          else
            *out++ = (u8)b;
        } while (--count >= 0);
      }
    }
  }
}

/* The shim's names (port/shim/system/port_iwram_call.h) */
s32 Port_IwramRatioMulQ14(s32 divisor, s32 value) { return IwramRatioMulQ14(divisor, value); }
s32 Port_IwramClearWords(void *destination, s32 size) { return IwramFillWords(destination, size, 0); }
s32 Port_IwramFillWords(void *destination, s32 size, u32 value) { return IwramFillWords(destination, size, value); }
s32 Port_IwramSqrt(s32 value) { return IwramSqrt(value); }
s32 Port_IwramExpandBitRuns(const void *bits, void *destination, s32 value) {
  return IwramExpandBitRuns(bits, destination, value);
}
s32 Port_IwramTransformVector(const void *vector, s32 *result) { return IwramTransformVector(vector, result); }
void Port_IwramTransformMatrix(const s32 *matrix) { IwramTransformMatrix(matrix); }
s32 Port_IwramSignedDivide(s32 dividend, s32 divisor) { return IwramSignedDivide(dividend, divisor); }
u32 Port_IwramUnsignedDivide(u32 dividend, u32 divisor) { return IwramUnsignedDivide(dividend, divisor); }
void *Port_IwramDecompress(const void *source, void *destination) { return IwramDecompress(source, destination); }
s32 Port_IwramCopyWords(void *destination, const void *source, s32 size) {
  return IwramCopyWords(destination, source, size);
}

/* libgcc names the vendor calls explicitly (iwram_entry.s: ldr r3, =target; bx r3) */
s32 __divsi3(s32 a, s32 b) { return IwramSignedDivide(a, b); }
s32 __modsi3(s32 a, s32 b) { return IwramSignedRemainder(a, b); }
u32 __udivsi3(u32 a, u32 b) { return IwramUnsignedDivide(a, b); }
u32 __umodsi3(u32 a, u32 b) { return IwramUnsignedRemainder(a, b); }

/* actor_update_far.s: ARM veneers (ldr r4, =target; bx r4) */
s32 ArcTan2(s32 x, s32 y);
s32 ArcTan2FarArm(s32 z, s32 x) { return ArcTan2(z, x); }
s32 Iwram_SqrtFarArm(s32 value) { return IwramSqrt(value); }
s32 Iwram_RatioMulQ14FarArm(s32 divisor, s32 value) { return IwramRatioMulQ14(divisor, value); }
