/* libgcc's _call_via_rX (bx rX): the vendor calls a routine whose address is in the last argument, with the
 * other registers as they are. Here the address is resolved like any GBA code address (codemap.c) and the
 * call is made with the target's own C signature: the targets the game passes are listed, anything else is
 * called as four words in, one word out. */
#include "gba.h"

void *Port_ResolveCode(void *p);
void *Port_CodeAt(u32 gba);
s32 IwramClearWords(void *destination, s32 size);
s32 IwramCopyWords(void *destination, const void *source, s32 size);
u16 ProgramFlashSectorWithEraseRetry(u16 sector, u8 *source); /* flash.c: gProgramFlashSector (Save_WriteSector) */

u32 _call_via_r3(u32 r0, u32 r1, u32 r2, u32 r3) {
  void *f = Port_ResolveCode((void *)(uintptr_t)r3);
  if (f == (void *)IwramClearWords)
    return (u32)IwramClearWords((void *)(uintptr_t)r0, (s32)r1);
  if (f == (void *)IwramCopyWords)
    return (u32)IwramCopyWords((void *)(uintptr_t)r0, (const void *)(uintptr_t)r1, (s32)r2);
  if (f == (void *)ProgramFlashSectorWithEraseRetry)
    return ProgramFlashSectorWithEraseRetry((u16)r0, (u8 *)(uintptr_t)r1);
  return ((u32(*)(u32, u32, u32, u32))f)(r0, r1, r2, r3);
}

/* Test hook (tests/arm/diff.cjs): calls the main image's function at a GBA address with four words, as r0-r3
 * would carry them (indirect calls tolerate other signatures: -sEMULATE_FUNCTION_POINTER_CASTS). Lets the
 * differential tests compare vendor C compiled to wasm against the ROM's own code. * (Not in codemap.c: bind.py routes indirect calls through Port_ResolveCode, which codemap.c defines.) */
u32 Port_CallCode4(u32 gba, u32 a, u32 b, u32 c, u32 d) {
  u32 (*fn)(u32, u32, u32, u32) = (u32 (*)(u32, u32, u32, u32))Port_CodeAt(gba);
  return fn ? fn(a, b, c, d) : 0xdeadbeefu;
}
