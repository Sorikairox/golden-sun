/* The message decoder's ARM routines (vendor src/window/message_decode.s), hand-ported to C (D6). The game
 * copies them to RAM and calls the copy (codemap.c aliases). Checked by tests/arm/diff.cjs on real messages.
 *
 * Text is Huffman coded with one tree per previous symbol ("context"). Bit streams are read LSB first from
 * aligned words with a 1-bit sentinel above the bits left: a reader is { symbol, next word, bits }. */
#include "gba.h"

extern const u32 Text_MessageContexts[]; /* per bank of 256 contexts: tree base, table of u16 tree offsets */
extern const u32 Text_MessageBanks[];    /* per bank of 256 messages: bit stream base, u8 length table */

/* bits at byte address p: the aligned word from p's byte on, with the sentinel above (or just the sentinel
 * when p is aligned, so the first read loads a word); *pp becomes the next word to load */
static u32 bits_at(const u8 *p, const u32 **pp) {
  u32 k = (u32)(uintptr_t)p & 3;
  const u32 *w = (const u32 *)(uintptr_t)((u32)(uintptr_t)p & ~3u);
  if (!k) {
    *pp = w;
    return 1;
  }
  *pp = w + 1;
  return (*w >> (8 * k)) | (1u << (32 - 8 * k));
}

static u32 next_bit(u32 *bits, const u32 **pp) {
  u32 c = *bits & 1;
  *bits >>= 1;
  if (*bits == 0) {
    u32 w = *(*pp)++;
    c = w & 1;
    *bits = (w >> 1) | 0x80000000u;
  }
  return c;
}

/* Positions a reader at message `message` (bank = message >> 8): sums the length bytes of the messages before
 * it in its bank (a 255 byte continues the same length). */
void Message_FindArm(u32 *reader, s32 message) {
  const u32 *bank = Text_MessageBanks + ((u32)message >> 8) * 2;
  u32 addr = bank[0];
  const u8 *len = (const u8 *)(uintptr_t)bank[1];
  u32 n = (u32)message & 255;
  const u32 *next;
  u32 bits;
  while (n) {
    u32 b = *len++;
    addr += b;
    if (b != 255)
      n--;
  }
  bits = bits_at((const u8 *)(uintptr_t)addr, &next);
  reader[0] = 0;
  reader[1] = (u32)(uintptr_t)next;
  reader[2] = bits;
}

/* Decodes the next symbol with the tree of the previous one: the tree is a pre-order bit string (0 internal,
 * 1 leaf) read with the same sentinel scheme; at an internal node a message bit 0 goes to the left child (next
 * in the string), 1 skips the left subtree, counting its leaves. Leaf n's 12-bit symbol is packed 1.5 bytes
 * each, backwards, right before the tree. Returns the symbol (0 ends a message). */
s32 Text_DecodeSymbol(u32 *reader) {
  u32 prev = reader[0];
  const u32 *src = (const u32 *)(uintptr_t)reader[1];
  u32 bits = reader[2];
  const u32 *ctx = Text_MessageContexts + (prev >> 8) * 2;
  const u8 *tree = (const u8 *)(uintptr_t)(ctx[0] + ((const u16 *)(uintptr_t)ctx[1])[prev & 255]);
  const u32 *tp;
  u32 tbits = bits_at(tree, &tp);
  u32 leaves = 0, sym;
  const u8 *p;
  for (;;) {
    s32 depth;
    if (next_bit(&tbits, &tp))
      break;
    if (!next_bit(&bits, &src))
      continue;
    depth = 0;
    for (;;) {
      if (next_bit(&tbits, &tp)) {
        leaves++;
        if (--depth < 0)
          break;
      } else
        depth++;
    }
  }
  p = tree - (leaves + (leaves >> 1));
  if (leaves & 1)
    sym = p[-2] | (u32)(p[-1] & 15) << 8;
  else
    sym = (u32)p[-1] << 4 | p[-2] >> 4;
  reader[0] = sym;
  reader[1] = (u32)(uintptr_t)src;
  reader[2] = bits;
  return (s32)sym;
}
