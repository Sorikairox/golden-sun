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

int main(void) {
  int relocated;
  printf("golden-sun wasm: heap 0x%08lx-0x%08lx, %d stubs linked\n", (unsigned long)Port_HeapBase(),
         (unsigned long)Port_HeapEnd(), gPortStubCount);
  Port_HwReset();
  relocated = Port_RelocateAll();
  printf("boot: %d relocated tables filled from the ROM\n", relocated);
  System_Initialize();
  return 0;
}
