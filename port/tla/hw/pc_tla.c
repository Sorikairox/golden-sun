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

/* SoundDriver_EnterVBlankUpdate is bound to Port_TlaSoundEnterVBlank: the mixer and its render, ported to C in
 * port/tla/hw/pc_tla_mixer.c (TLA4d). */

/* TLA4d (trap 73): a task's routine is compared as a word (src/system/task: Task_Add finds an existing entry,
 * Task_Remove / Task_Find / Task_SetFlags / Task_SuspendAll / Task_ResumeAll pick one by it). Translated asm passes
 * the GBA address of a C routine (`ldr r0, =Func_0200815c + 1; bl Task_Add` in the clear scene, Ov64a), the C
 * routine passes its own pointer (a wasm table index: Task_RemoveFar(Func_0200015c)), so the blend task was never
 * removed and BLDALPHA kept counting (the naming and transfer windows pulsed over the logo). port/tla/c_rules.tsv
 * makes each of those routines compare this key instead: a code address the code map knows becomes its wasm
 * function pointer; anything else (table indices, 0, unknown words) stays as it is. */
void *Port_TryResolveCode(void *p);
u32 Port_TlaTaskKey(u32 f) {
  void *fn;
  if (f < PORT_TABLE_END)
    return f;
  fn = Port_TryResolveCode((void *)(uintptr_t)f);
  return fn ? (u32)(uintptr_t)fn : f;
}
