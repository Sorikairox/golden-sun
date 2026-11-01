/* m4a sound driver assembly (vendor src/sound/clear_buffer.s) hand-ported to C (D6): the pieces the driver's
 * set-up runs even with audio silent (G3). The track/mixer cores (MPlayMain, SoundMain, ply_note...) are still
 * logged stubs: audio is G4. SoundMainBTM and RealClearChain are checked by tests/arm/diff.cjs. */
#include <string.h>

#include "gba.h"

extern void *gMPlayJumpTableTemplate[36]; /* relocated: its code slots are wasm functions (D19) */

/* Clears 64 bytes (16 words) at `block`. */
void SoundMainBTM(void *block) { memset(block, 0, 64); }

/* Unlinks a sound channel from its track's channel chain: channel+44 = track (0: not linked), +48 = previous,
 * +52 = next; the track's chain head is at track+32. */
void RealClearChain(void *channel) {
  u8 *c = (u8 *)channel;
  u32 track = *(u32 *)(c + 44), prev, next;
  if (!track)
    return;
  next = *(u32 *)(c + 52);
  prev = *(u32 *)(c + 48);
  if (prev)
    *(u32 *)(uintptr_t)(prev + 52) = next;
  else
    *(u32 *)(uintptr_t)(track + 32) = next;
  if (next)
    *(u32 *)(uintptr_t)(next + 48) = prev;
  *(u32 *)(c + 44) = 0;
}

/* Copies the 36 command/driver entries of gMPlayJumpTableTemplate (chk_adr_r2 never clears an entry read from
 * the ROM table). The relocated copy holds wasm function pointers instead of GBA addresses: the one way this
 * port differs from the original's memory, so diff.cjs does not compare it. */
void MPlayJumpTableCopy(void **table) {
  int i;
  for (i = 0; i < 36; i++)
    table[i] = gMPlayJumpTableTemplate[i];
}
