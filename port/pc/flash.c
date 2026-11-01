/* The 64 KB flash save (G3): the game's flash driver replaced at its API (port/fn_overrides.tsv), over the flash
 * region of the identity map (0x0E000000, 16 sectors of 4 KB). The chip answers as an SST 39VF512 (0xD4BF), so
 * IdentifyFlash installs gFlash_ChipDefault's handlers, which are these functions. Erased bytes read 0xFF.
 * The host persists the region when Port_FlashGeneration() changes (the page: IndexedDB, later). */
#include <string.h>

#include "gba.h"

#define FLASH ((u8 *)(uintptr_t)FLASH_BASE_ADDR)
#define SECTOR 4096

static u32 generation;

u32 Port_FlashGeneration(void) { return generation; }
u8 *Port_FlashMemory(void) { return FLASH; }

/* A blank chip (power-on with no save) */
void Port_FlashReset(void) { memset(FLASH, 0xFF, 16 * SECTOR); }

s32 ReadFlashId(void) { return 0xD4BF; }

u16 ProgramFlashSectorWithEraseRetry(u16 sector, u8 *source) {
  if (sector > 15)
    return 0x80FF;
  memcpy(FLASH + sector * SECTOR, source, SECTOR);
  generation++;
  return 0;
}

u16 EraseFlashChip(void) {
  memset(FLASH, 0xFF, 16 * SECTOR);
  generation++;
  return 0;
}

u16 EraseFlashSector(u16 sector) {
  if (sector > 15)
    return 0x80FF;
  memset(FLASH + sector * SECTOR, 0xFF, SECTOR);
  generation++;
  return 0;
}

void ReadFlash(u16 sector, u32 offset, u8 *destination, s32 size) {
  const u8 *s = FLASH + ((u32)sector << 12) + offset;
  while (size-- > 0)
    *destination++ = *s++;
}

/* 0 when the sector holds the 4 KB at `source`, else the flash address of the first differing byte */
s32 Flash_VerifySector(u16 sector, s32 source) {
  const u8 *a = (const u8 *)(uintptr_t)source;
  u8 *f = FLASH + ((u32)sector << 12);
  int i;
  for (i = 0; i < SECTOR; i++)
    if (a[i] != f[i])
      return (s32)(uintptr_t)(f + i);
  return 0;
}
