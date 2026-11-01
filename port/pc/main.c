/* Entry point of the wasm module (G3). The host (page or node runner) first writes the player's ROM to
 * 0x08000000 (identity map, D5), then calls main: power-on state of the hardware layer, the relocated tables
 * filled from the ROM (D19), and the game's own entry, System_Initialize, which never returns: it ends in
 * MainRoutine_Run. On the GBA, System_Entry (entry.s) sets the stacks first; wasm has its own stack. */
#include <stdint.h>
#include <stdio.h>

uintptr_t Port_HeapBase(void);
uintptr_t Port_HeapEnd(void);
int Port_RelocateAll(void);
void Port_HwReset(void);
void System_Initialize(void);
extern const int gPortStubCount;

/* The cartridge entry (GS11, trap 36). Cart_Start (0x08000000, the header's `b System_Entry`) and System_Entry
 * (entry.s, ARM) are what the game's soft reset jumps to (A+B+Select+Start: Input_HandleKeyInterrupt sets
 * gResetRequested, the frame wait calls System_SoftReset). System_Entry sets the IRQ and system stacks, writes the
 * IRQ vector word at 0x03007FFC (its own pc-relative address 0x08000770, the ROM's IRQ entry; the port dispatches
 * interrupts in hw.c and never reads it), then calls System_Initialize, again if it returns. This is that entry up
 * to the call (EQUIV against the original: tests/arm/diff.cjs System_Entry); it returns the vector word, the
 * value r0 holds when the original reaches System_Initialize. wasm has its own stack. */
#define GBA_IRQ_VECTOR 0x03007FFCu
#define SYSTEM_ENTRY_IRQ_ENTRY 0x08000770u
unsigned Port_SystemEntryPrologue(void) {
  *(volatile unsigned *)(uintptr_t)GBA_IRQ_VECTOR = SYSTEM_ENTRY_IRQ_ENTRY;
  return SYSTEM_ENTRY_IRQ_ENTRY;
}

/* Runs the game from System_Entry on an empty wasm stack: power-on (main) and every soft reset (Port_Restart, called
 * by port_lib.js once the reset has unwound the old stack). The hardware keeps its state, as on the GBA. */
static void system_entry(void) {
  Port_SystemEntryPrologue();
  for (;;)
    System_Initialize();
}

void port_soft_reset(void); /* port/web/port_lib.js: unwinds the wasm stack, then calls Port_Restart */

/* What a call to Cart_Start / System_Entry runs (codemap.c Port_ResolveCode): the old stack is dropped. */
void Port_SystemEntry(void) {
  printf("soft reset: Cart_Start\n");
  port_soft_reset();
}

void Port_Restart(void) { system_entry(); }

int main(void) {
  int relocated;
  printf("golden-sun wasm: heap 0x%08lx-0x%08lx, %d stubs linked\n", (unsigned long)Port_HeapBase(),
         (unsigned long)Port_HeapEnd(), gPortStubCount);
  Port_HwReset();
  relocated = Port_RelocateAll();
  printf("boot: %d relocated tables filled from the ROM\n", relocated);
  system_entry();
  return 0;
}
