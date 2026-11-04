/* Resource decoders and the overlay branch patcher (vendor src/system/decompress_tagged_lz.s), hand-ported to C
 * (D6). The game copies each to RAM (RamCode_Load) and calls the copy; codemap.c's aliases send those calls
 * here. Checked by tests/arm/diff.cjs on the ROM's own resources.
 *
 * Decompress_TaggedLzArm also completes overlay loading (D7): a stream decoded into gOverlayArea that is a scene
 * overlay's resource makes that overlay's functions answer for overlay-area addresses (Port_CodeMapOverlay) and
 * fills its relocated tables (Port_RelocateOverlay). */
#include "gba.h"

extern const u32 Resource_DirectoryTable[1000];
void Port_CodeMapOverlay(u32 id);
int Port_CodeMapHasOverlay(u32 id);
int Port_RelocateOverlay(u32 id);
void Port_SaveCompatOverlay(u32 id);

/* LSB-first bit stream over bytes (the ARM reader's 32-bit buffer refilled by halfwords is the same stream) */
struct Bits {
  const u8 *p;
  u32 buf;
  int n;
};

static u32 take(struct Bits *b, int count) {
  u32 v;
  while (b->n < count) {
    b->buf |= (u32)*b->p++ << b->n;
    b->n += 8;
  }
  v = count == 32 ? b->buf : b->buf & ((1u << count) - 1);
  b->buf = count == 32 ? 0 : b->buf >> count;
  b->n -= count;
  return v;
}

static int bit_length(u32 v) {
  int n = 0;
  while (v) {
    n++;
    v >>= 1;
  }
  return n;
}

/* Tagged LZ: the first byte is the form.
 * Form 0: a bit stream. Flag 1: an 8-bit literal. Flag 0: a length code (0: 2; 10: 3; 110: 4; 1110: 5;
 * 11110 then 0: 6, 1: 7; 11111 then 2 bits n: n + 7 (8-10), or n = 0 then 7 bits m: m + 10, m = 0 ends), then a
 * distance: 1 + 5 bits d, or 0 + a wide distance: 12 bits + 32 while the output (minus 33, unsigned) is at least
 * 2048, else bit_length(output - 33) bits + 32. The copy reads d bytes before the last byte written.
 * Form 1: flag bytes (MSB first); flag 1 = a match of two bytes: distance (high nibble of byte 1, byte 2),
 * count = low nibble (0: one more byte + 16; 0 with distance 0 ends), count + 1 bytes copied. 0 = a literal.
 * Any other form: nothing written, returns 4. Returns the bytes written. */
s32 Decompress_TaggedLzArm(const void *source, void *destination) {
  const u8 *s = (const u8 *)source;
  u8 *out = (u8 *)destination;
  u32 form = *s++;
  s32 result;
  if (form == 0) {
    struct Bits b = {s, 0, 0};
    u32 pos = 0;
    for (;;) {
      u32 length, distance, k;
      if (take(&b, 1)) {
        out[pos++] = (u8)take(&b, 8);
        continue;
      }
      if (!take(&b, 1))
        length = 2;
      else if (!take(&b, 1))
        length = 3;
      else if (!take(&b, 1))
        length = 4;
      else if (!take(&b, 1))
        length = 5;
      else if (!take(&b, 1))
        length = take(&b, 1) ? 7 : 6;
      else {
        length = take(&b, 2);
        if (length)
          length += 7;
        else {
          length = take(&b, 7);
          if (!length)
            break;
          length += 10;
        }
      }
      if (take(&b, 1))
        distance = take(&b, 5);
      else {
        u32 span = pos - 33;
        if (span >= 2048)
          distance = take(&b, 12) + 32;
        else {
          int w = bit_length(span);
          distance = (w ? take(&b, w) : 0) + 32;
        }
      }
      for (k = 0; k < length; k++, pos++)
        out[pos] = out[pos - 1 - distance];
    }
    result = (s32)pos;
  } else if (form == 1) {
    u8 *o = out;
    for (;;) {
      u32 flags = *s++, i;
      int end = 0;
      for (i = 0; i < 8; i++, flags <<= 1) {
        if (!(flags & 0x80)) {
          *o++ = *s++;
          continue;
        }
        {
          u32 b1 = *s++, b2 = *s++;
          u32 distance = (b1 & 0xF0) << 4 | b2, count = b1 & 15;
          if (!count) {
            if (!distance) {
              end = 1;
              break;
            }
            count = *s++ + 16u;
          }
          count++;
          while (count--) {
            *o = *(o - distance);
            o++;
          }
        }
      }
      if (end)
        break;
    }
    result = (s32)(o - out);
  } else
    return 4;

  if ((u32)(uintptr_t)destination == 0x02008000u) {
    u32 id;
    for (id = 0; id < 1000; id++)
      if (Resource_DirectoryTable[id] == (u32)(uintptr_t)source && Port_CodeMapHasOverlay(id)) {
        Port_CodeMapOverlay(id);
        Port_RelocateOverlay(id);
        Port_SaveCompatOverlay(id); /* GS28: the overlay whose buffers saved actors may name (save_compat.c) */
        break;
      }
  }
  return result;
}

/* Move-to-front LZ (form 2): the same bit stream, lengths and distances as form 0, but a literal is two
 * nibbles, each an index into a move-to-front list of the 16 nibble values (initially 0..15); the indexed value
 * is taken and moved to the front, low nibble first. Literal index codes: 1 + two 2-bit indices, 01 + two 3-bit,
 * 00 + two 4-bit. Any other form: nothing written, returns 4. Returns the bytes written. */
s32 Decompress_MoveToFrontLzCommands(const void *source, void *destination) {
  const u8 *s = (const u8 *)source;
  u8 *out = (u8 *)destination;
  u8 list[16];
  struct Bits b;
  u32 pos = 0;
  int i;
  if (*s++ != 2)
    return 4;
  for (i = 0; i < 16; i++)
    list[i] = (u8)i;
  b.p = s;
  b.buf = 0;
  b.n = 0;
  for (;;) {
    u32 length, distance, k;
    if (take(&b, 1)) {
      int width = take(&b, 1) ? 2 : take(&b, 1) ? 3 : 4;
      u32 v = 0;
      int half;
      for (half = 0; half < 2; half++) {
        u32 idx = take(&b, width), nib = list[idx];
        for (k = idx; k > 0; k--)
          list[k] = list[k - 1];
        list[0] = (u8)nib;
        v |= nib << (4 * half);
      }
      out[pos++] = (u8)v;
      continue;
    }
    if (!take(&b, 1))
      length = 2;
    else if (!take(&b, 1))
      length = 3;
    else if (!take(&b, 1))
      length = 4;
    else if (!take(&b, 1))
      length = 5;
    else if (!take(&b, 1))
      length = take(&b, 1) ? 7 : 6;
    else {
      length = take(&b, 2);
      if (length)
        length += 7;
      else {
        length = take(&b, 7);
        if (!length)
          break;
        length += 10;
      }
    }
    if (take(&b, 1))
      distance = take(&b, 5);
    else {
      u32 span = pos - 33;
      if (span >= 2048)
        distance = take(&b, 12) + 32;
      else {
        int w = bit_length(span);
        distance = (w ? take(&b, w) : 0) + 32;
      }
    }
    for (k = 0; k < length; k++, pos++)
      out[pos] = out[pos - 1 - distance];
  }
  return (s32)pos;
}

/* Turns the overlay's stored branch targets back into pc-relative Thumb BL pairs: every halfword pair
 * (0xF000 | hi11, 0xF800 | lo11) found from byte 2 on holds (target offset from the scan start) >> 1; it
 * becomes the offset from the pair. Scans byteLength * 2 bytes (the ROM's routine doubles the count: the scan
 * runs past the code, as on the GBA). */
void Resource_PatchThumbBranch(void *code, s32 byteLength) {
  u8 *start = (u8 *)code + 2;
  u8 *end = (u8 *)code + 2 * byteLength;
  u8 *p = start;
  while (p < end) {
    u32 second = *(u16 *)p, first, offset;
    p += 2;
    if ((second >> 11) != 31)
      continue;
    first = *(u16 *)(p - 4);
    if ((first >> 11) != 30)
      continue;
    offset = (((second & 0x7FF) | (first & 0x7FF) << 11) << 1) - (u32)(p - start);
    *(u16 *)(p - 4) = (u16)(((offset >> 12) & 0x7FF) | 0xF000);
    *(u16 *)(p - 2) = (u16)((offset >> 1) | 0xF800);
  }
}

void Port_DmaWritten(volatile u32 *channel);

/* Runs the queued register writes (IoWriteQueue_FlushPending): `count` entries of { value, address, control }
 * from queue + 4 (at least one: the loop tests after). Control bits 16-17: size (0: the three words go to DMA3
 * as a transfer, 1 byte, 2 halfword, 3 word); bits 18-19 zero: plain store, else read-modify: bit 18 set ORs
 * the value in, clear clears its bits. */
void Resource_ExecuteTransfer(void *queue, s32 count) {
  u32 *e = (u32 *)queue + 1;
  do {
    u32 value = e[0], address = e[1], control = e[2], size = control & 0x30000u;
    e += 3;
    if (!size) {
      volatile u32 *dma3 = (volatile u32 *)(uintptr_t)(IO_BASE + 0xD4);
      dma3[0] = value;
      dma3[1] = address;
      dma3[2] = control;
      Port_DmaWritten(dma3);
      continue;
    }
    if (control & 0xC0000u) {
      u32 old = size < 0x20000u ? *(volatile u8 *)(uintptr_t)address
              : size == 0x20000u ? *(volatile u16 *)(uintptr_t)address : *(volatile u32 *)(uintptr_t)address;
      value = (control & 0x40000u) ? old | value : old & ~value;
    }
    if (size < 0x20000u)
      *(volatile u8 *)(uintptr_t)address = (u8)value;
    else if (size == 0x20000u)
      *(volatile u16 *)(uintptr_t)address = (u16)value;
    else
      *(volatile u32 *)(uintptr_t)address = value;
  } while (--count > 0);
}

/* Byte-oriented LZ (vendor system/decompress_byte_lz.s, run from RAM): flag bytes, read MSB first, 0 a literal
 * byte, 1 a match of two bytes b0 b1: from dst - ((b0 & 0xf0) << 4 | b1), b0 & 15 = n gives n + 1 bytes; n = 0
 * reads a count byte c for c + 17 bytes, or, at distance 0, ends the stream. Copies run byte by byte (overlaps
 * repeat). A flag byte of 0 is eight literals. Returns the bytes written. */
s32 Decompress_ByteLzArm(const u8 *src, u8 *dst) {
  u8 *start = dst;
  for (;;) {
    u32 flags = *src++, lr;
    int k;
    if (!flags) {
      for (k = 0; k < 8; k++)
        *dst++ = *src++;
      continue;
    }
    lr = flags << 24 | 0x800000u;
    for (;;) {
      u32 carry = lr >> 31, b0, n;
      const u8 *from;
      lr <<= 1;
      if (!carry) {
        *dst++ = *src++;
        continue;
      }
      if (!lr)
        break;
      b0 = *src++;
      from = dst - *src++ - ((b0 & 0xF0) << 4);
      n = b0 & 15;
      if (n) {
        n += 1;
      } else {
        if (from == dst)
          return (s32)(dst - start);
        n = *src++ + 17u;
      }
      while (n--)
        *dst++ = *from++;
    }
  }
}
