/* Linear memory layout (orchestrator D5). The GBA regions sit at their real addresses: EWRAM 0x02000000, IWRAM
 * 0x03000000, I/O 0x04000000, palette 0x05000000, VRAM 0x06000000, OAM 0x07000000, ROM 0x08000000 (the player's
 * file, written by the page), flash 0x0E000000. Emscripten's data, stack and heap must stay below 0x02000000:
 * this sbrk replaces libc's and hands out memory only between __heap_base and PORT_HEAP_END. */
#include <stddef.h>
#include <stdint.h>

#define PORT_HEAP_END 0x01F00000u

extern unsigned char __heap_base;
static uintptr_t brk_now;

void *sbrk(intptr_t increment) {
  uintptr_t old;
  if (!brk_now)
    brk_now = ((uintptr_t)&__heap_base + 15) & ~(uintptr_t)15;
  old = brk_now;
  if (increment < 0 ? old < (uintptr_t)-increment : old + (uintptr_t)increment > PORT_HEAP_END)
    return (void *)-1;
  brk_now = old + increment;
  return (void *)old;
}

/* For checks: the heap's bounds. */
uintptr_t Port_HeapBase(void) { return (uintptr_t)&__heap_base; }
uintptr_t Port_HeapEnd(void) { return PORT_HEAP_END; }
