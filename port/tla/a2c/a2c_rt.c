/* The run-time side of asm2c's output in the TLA build (TLA5, orchestrator D23): the register file, calls out of
 * translated code into the rest of the game, the loaded overlay. tools/wasm/asm2c.py writes the translated
 * routines (build/wasm-tla/asm2c/tla_asm.c, never committed); tools/wasm/link.py binds every logged stub of a
 * translated routine to its wrapper a2cw_<addr> (C -> translated: r0-r3, stack words, lr a sentinel).
 *
 * Fibers (orchestrator trap 56): the port has none. wait() is plain C (system/system.c: Task_RunPass calls each
 * task's routine as an ordinary callback, then the BIOS halt runs the display synchronously, port/pc/hw.c), and
 * the page's ASYNCIFY suspension at port_frame_ready keeps the whole C stack. Every crossing from translated code
 * into C (a2c_call) and from C into translated code (a2c_enter_wrapped) keeps a copy of the register file on the C
 * stack and puts it back afterwards, so the file is correct after any nesting, and would stay correct under real
 * fibers too (each fiber has its own C stack). */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

typedef uint32_t u32;
typedef struct { u32 r[16]; u32 n, z, c, v; } A2cRegs;

A2cRegs a2c_r;
static u32 a2cOverlay;

void *Port_ResolveCode(void *p);

/* The scene overlay now in the overlay area (its resource id): asm2c's dispatch picks that overlay's routines.
   The overlay loader calls it next to Port_CodeMapOverlay (TLA4: Resource_LoadCode). */
void Port_A2cOverlayLoaded(u32 id) { a2cOverlay = id; }
u32 a2c_overlay_current(void) { return a2cOverlay; }

/* Code that is not translated (the game's C, port/pc, the hand ports): Port_ResolveCode gives the wasm function;
   r0-r3 and the first four GBA stack words are its arguments (EMULATE_FUNCTION_POINTER_CASTS drops the extra ones),
   its result is r0. AAPCS: r4-r11 and sp survive the call, so the whole file comes back as it was, r0 aside. */
typedef u32 (*A2cFn)(u32, u32, u32, u32, u32, u32, u32, u32);
void a2c_call(u32 addr) {
  A2cRegs save = a2c_r;
  const u32 *st = (const u32 *)(uintptr_t)(save.r[13] & ~3u);
  A2cFn f = (A2cFn)Port_ResolveCode((void *)(uintptr_t)addr);
  u32 r = f(save.r[0], save.r[1], save.r[2], save.r[3], st[0], st[1], st[2], st[3]);
  save.r[0] = r;
  a2c_r = save;
}

/* A jump to an address that is neither the routine's return nor one of its own continuations. */
void a2c_badreturn(u32 addr, u32 expected) {
  printf("asm2c: continuation at 0x%08x, expected the return to 0x%08x\n", (unsigned)addr, (unsigned)expected);
  fflush(stdout);
  abort();
}

void a2c_trace(u32 addr) { (void)addr; }
