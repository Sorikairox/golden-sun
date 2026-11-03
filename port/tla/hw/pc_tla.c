/* TLA4b: The Lost Age's own pieces of the PC layer (port/pc is shared with GS1 and stays byte-identical for it).
 * Compiled and bound like port/pc (tools/wasm/build.py code_objects: port/tla/hw/*.c).
 *   - H2: the BIOS calls GS1 does not make (port/tla/hw/bindings.tsv kind bind);
 *   - trap 65: the overlay loader's hook; H4: ROM-copy addresses of IWRAM code; H5: _call_via_sp (colour kernels). */
#include <stdio.h>
#include <stdlib.h>

#include "../../pc/gba.h"

/* swi 0x1B (SoundDriverMode) and swi 0x23 (SoundDriverVSyncOn): the BIOS's own sound driver, which the port does
 * not have (TLA runs its m4a driver itself, as GS1). Bios_SoundDriverMode, Bios_Swi23. */
void Port_BiosNop(void) {}

/* swi 0x2A (SoundGetJumpList): the BIOS copies its 36-entry sound jump list to r0. Only a BIOS image has that
 * list; nothing in TLA calls the wrapper (it is linked but unused, as in GS1, where MPlayJumpTableCopy copies the
 * game's relocated template instead), so the copy is left zeroed. */
void Port_BiosSoundGetJumpList(void **table) {
  int i;
  for (i = 0; i < 36; i++)
    table[i] = 0;
}

/* Trap 65: TLA's overlay loader is Resource_LoadCode (src/system/resource/resource.c, vendor C; GS1's is
 * port/pc/decompress.c). A c_rules.tsv hook calls this after it has decoded resource `index` to `destination` and
 * run the Thumb-branch patcher: a scene overlay decoded into the overlay area (0x02008000) now answers for the
 * area's addresses, in the code map (C functions, Port_ResolveCode), in asm2c's dispatch, and its relocated data. */
void Port_CodeMapOverlay(u32 id);
int Port_CodeMapHasOverlay(u32 id);
void Port_A2cOverlayLoaded(u32 id);
int Port_RelocateOverlay(u32 id);

void Port_TlaOverlayLoaded(u32 index, void *destination) {
  if ((u32)(uintptr_t)destination != 0x02008000u || !Port_CodeMapHasOverlay(index))
    return;
  Port_CodeMapOverlay(index);
  Port_A2cOverlayLoaded(index);
  Port_RelocateOverlay(index);
}

/* H4: code The Lost Age copies from the ROM to IWRAM at start-up runs at its IWRAM address, where hw2c translates it
 * (port/tla/hw/tools/hw2c.py: the run address). A call by the ROM copy's address (the sound driver calls the mixer
 * by its load address, 0x081C1310 = Sound_Mixer) is the same code: these are the load -> run ranges of the
 * reference build's sections (port/tla/symbols/sections.tsv: the resident IWRAM block, IwramResident_Rom, and
 * src/sound/driver/mixer). Port_ResolveCode (codemap.c) and a2c_call (a2c_rt.c) try the run address of an address
 * they do not know. */
static const struct { u32 rom, run, size; } romCopies[] = {
    {0x080006B8u, 0x03000100u, 0xFA0u},  /* 0x03000100..0x030010A0: irq.s ... resident_mixer_modes */
    {0x081C1310u, 0x03006000u, 932u},                               /* src/sound/driver/mixer */
};

u32 Port_TlaRunAddress(u32 a) {
  unsigned i;
  for (i = 0; i < sizeof romCopies / sizeof romCopies[0]; i++)
    if (a - romCopies[i].rom < romCopies[i].size)
      return a - romCopies[i].rom + romCopies[i].run;
  return a;
}

/* H5: libgcc's _call_via_sp (`bx sp`), which port/pc/call_via.c does not have: the colour kernel loaders
   (src/system/color_kernel_loaders.s, color_backup_loaders.s) copy a kernel (ColorBuffer_*KernelCode) to the stack
   by DMA3 and call it there. The copy aliased the stack address to the kernel's translation (hw.c dma_run,
   Port_CodeAlias); the translation runs on the register file as it is (the kernel reads the loader's registers),
   and returns to the loader's lr. */
struct A2cRegsTla { u32 r[16]; u32 n, z, c, v; };
extern struct A2cRegsTla a2c_r;             /* port/tla/a2c/a2c_rt.c */
void (*a2c_lookup(u32 addr))(void);

u32 _call_via_sp(u32 r0, u32 r1, u32 r2, u32 r3) {
  u32 sp = a2c_r.r[13];
  void (*raw)(void) = a2c_lookup(sp);
  (void)r0; (void)r1; (void)r2; (void)r3;
  if (!raw) {
    /* the stack copy: the run time aliased it to the C wrapper; the raw translation is at the DMA source */
    u32 src = *(volatile u32 *)(uintptr_t)0x040000D4u;
    raw = a2c_lookup(src);
  }
  if (!raw) {
    printf("_call_via_sp: no translated kernel at sp 0x%08x\n", (unsigned)sp);
    fflush(stdout);
    abort();
  }
  raw();
  return a2c_r.r[0];
}

/* TLA4c: SoundDriver_EnterVBlankUpdate (src/sound/driver/enter_vblank_update.s, bound here). The original checks the
 * stack is in IWRAM and the SoundInfo ident, runs the two VBlank callbacks (SoundInfo.func(intp): the sequencer,
 * MPlayMain; SoundInfo.CgbSound(si)) and jumps into the resident IWRAM mixer (IwramSoundMixEntry), which mixes every
 * PCM channel into the workspace and returns 0; System_WaitForFrameInterrupt then renders (IwramSoundRenderVBlank).
 * The resident mixer and its render patch their own instructions at run time (resident_mixer_lanes.s copies mla
 * kernels over 0xfedcba98 placeholders, the render rewrites its branches), so asm2c cannot translate them, and
 * TLA's mixer differs from GS1's port/pc/mixer.c. Until it is ported: the callbacks run (music and sound state
 * advance as in the game), no PCM is mixed, and 1 is returned (the original's "not now"), so no render follows.
 * The callbacks are C function pointers (wasm table indices) or GBA addresses: Port_ResolveCode takes both. */
void *Port_ResolveCode(void *p);
typedef void (*TlaSoundFn)(u32);
u32 Port_TlaSoundEnterVBlank(void) {
  u32 si = *(volatile u32 *)(uintptr_t)0x03007FF0u;
  u32 func, cgb;
  if (si == 0 || *(volatile u32 *)(uintptr_t)si != 0x68736D53u)
    return 1;
  func = *(volatile u32 *)(uintptr_t)(si + 32);
  if (func)
    ((TlaSoundFn)Port_ResolveCode((void *)(uintptr_t)func))(*(volatile u32 *)(uintptr_t)(si + 36));
  cgb = *(volatile u32 *)(uintptr_t)(si + 40);
  if (cgb)
    ((TlaSoundFn)Port_ResolveCode((void *)(uintptr_t)cgb))(si);
  return 1;
}
