/* The GBA BIOS calls the game makes (vendor src/system/bios.s, irq_table.s, sound_get_jump_list.s), in C from
 * their documented behaviour (GBATEK; there is no BIOS image): CpuSet (swi 0x0B), SoundBias (swi 0x19). Halt
 * and Stop (swi 2/3) are the frame driver's (frame.c). SoundGetJumpList (swi 0x2A) copies the BIOS's own sound
 * command table, which only a BIOS image has: audio is silent in G3, so MPlayJumpTableCopy stays a stub. */
#include "gba.h"

/* CpuSet: r0 source, r1 destination, r2 = count (bits 0-20) | fixed source (bit 24) | 32-bit units (bit 26).
 * Addresses are forced to the unit's alignment. A count of 0 copies nothing. */
void Bios_CpuSet(const void *source, void *destination, u32 control) {
  u32 count = control & 0x1FFFFF;
  int fixed = (control >> 24) & 1;
  if (control & (1u << 26)) {
    const u32 *s = (const u32 *)((uintptr_t)source & ~(uintptr_t)3);
    u32 *d = (u32 *)((uintptr_t)destination & ~(uintptr_t)3);
    if (fixed) {
      u32 v = *s;
      while (count--)
        *d++ = v;
    } else
      while (count--)
        *d++ = *s++;
  } else {
    const u16 *s = (const u16 *)((uintptr_t)source & ~(uintptr_t)1);
    u16 *d = (u16 *)((uintptr_t)destination & ~(uintptr_t)1);
    if (fixed) {
      u16 v = *s;
      while (count--)
        *d++ = v;
    } else
      while (count--)
        *d++ = *s++;
  }
}

/* SoundBias: the BIOS ramps SOUNDBIAS's level (bits 1-9) to 0x200 (r0 != 0) or 0 one step per few cycles.
 * Audio is silent here; the end state is what counts. */
static void sound_bias(int on) {
  u16 bias = IO16(R_SOUNDBIAS);
  IO16(R_SOUNDBIAS) = (u16)((bias & ~0x3FEu) | (on ? 0x200u : 0u));
}

void Bios_SoundBiasOn(void) { sound_bias(1); }
void Bios_SoundBiasOff(void) { sound_bias(0); }
