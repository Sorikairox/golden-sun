/* Entry point of the wasm module. G2: links the game and reports the memory layout; the frame driver and
 * the boot (G3) come next. */
#include <stdint.h>
#include <stdio.h>

uintptr_t Port_HeapBase(void);
uintptr_t Port_HeapEnd(void);
extern const int gPortStubCount;

int main(void) {
  printf("golden-sun wasm: heap 0x%08lx-0x%08lx, %d stubs linked\n", (unsigned long)Port_HeapBase(),
         (unsigned long)Port_HeapEnd(), gPortStubCount);
  return 0;
}
