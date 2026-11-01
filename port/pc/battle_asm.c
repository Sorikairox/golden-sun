/* Battle assembly routines hand-ported to C (D6), each checked against the original ARM code by
 * tests/arm/diff.cjs (D20). */
#include "gba.h"

/* battle/background_decode.s: BattleBackground_Load copies BitDecoder_DecodeImage (with its dispatcher and the
 * Model_* bit commands) to HEAP_SLOT_RAM_CODE_TEMP and calls the copy (source, destination). It unpacks a
 * 240 x 256 battle background into 8bpp tiles: 15 columns of 32 tiles (2048 bytes a column, tiles one under the
 * other); per column, pixel row 0..7 of each of the 32 tiles in turn, 8 pixels a row. Every pixel is the 7-bit
 * value v (kept in bits 25..31 of a word, so it wraps mod 128) after one command from the bit stream, stored as
 * v + 0x60 (BG palettes 6 to 13). The stream is halfwords, read low bit first; a command's low 3 bits choose:
 *   x00 (0, 4)  2 bits: v unchanged
 *   001 / 101   4 bits: v += / -= 1 + bit 3
 *   011 / 111   6 bits: v += / -= 3 + bits 3..5
 *   010         8 bits: v += 11 + bits 4..7, negated when bit 3 is set
 *   110        10 bits: v = bits 3..9
 * The bit buffer holds at least 16 bits: a halfword is read whenever fewer remain (none at the end of the last
 * pixel). The original also relocates its own handler table inside its RAM copy (not kept: no table here). */
void BitDecoder_DecodeImage(const u8 *source, u8 *destination) {
  const u16 *src = (const u16 *)source;
  u32 bits = *src++; /* r3 */
  s32 extra = 0;     /* r2: bits held beyond 16 */
  u32 v = 0;         /* r5: the value in bits 25..31 */
  u8 *dst = destination;
  int band, column, row, k;

  for (band = 0; band < 15; band++) {
    for (column = 0; column < 8; column++) {
      for (row = 0; row < 32; row++) {
        for (k = 0; k < 2; k++) {
          u32 word = 0;
          int p;
          for (p = 0; p < 4; p++) {
            u32 n, ip;
            switch (bits & 7) {
            case 0:
            case 4:
              n = 2;
              break;
            case 1:
              v += ((bits & 8) + 8) << 22;
              n = 4;
              break;
            case 5:
              v -= ((bits & 8) + 8) << 22;
              n = 4;
              break;
            case 3:
              v += (((bits >> 3) & 7) + 3) << 25;
              n = 6;
              break;
            case 7:
              v -= (((bits >> 3) & 7) + 3) << 25;
              n = 6;
              break;
            case 2:
              ip = ((bits >> 4) & 15) + 11;
              if (bits & 8)
                ip = 0u - ip;
              v += ip << 25;
              n = 8;
              break;
            default: /* 6 */
              v = ((bits >> 10) | (bits << 22)) & 0xFE000000u;
              n = 10;
              break;
            }
            bits >>= n;
            extra -= (s32)n;
            if (extra < 0) {
              extra += 16;
              bits |= (u32)*src++ << extra;
            }
            word |= (v >> 25) << (8 * p);
          }
          *(u32 *)dst = word + 0x60606060u;
          dst += k ? 60 : 4;
        }
      }
      dst = dst - 2048 + 8;
    }
    dst = dst - 64 + 2048;
  }
}
