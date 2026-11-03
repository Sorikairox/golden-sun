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
#include <string.h>

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

/* asm2c's codemap (tla_asm.c): every translated routine, overlap entries (TLA4b, trap 66: a second routine from a
   mid-routine call target to the routine's end, such as the m4a driver's chk_adr_r2) included. Sorted here once. */
struct A2cMapRow { u32 addr; u32 overlay; void (*fn)(void); };
extern const struct A2cMapRow a2c_codemap[];
extern const unsigned a2c_codemap_count;
static struct A2cMapRow *a2cSorted;

static int a2c_row_cmp(const void *x, const void *y) {
  const struct A2cMapRow *a = x, *b = y;
  u32 ka = a->addr & ~1u, kb = b->addr & ~1u;
  if (ka != kb)
    return ka < kb ? -1 : 1;
  return a->overlay < b->overlay ? -1 : a->overlay > b->overlay;
}

/* The translated routine at `addr` (the main image's, or the loaded overlay's in the overlay area), or 0. */
u32 Port_TlaRunAddress(u32 a); /* port/tla/hw/pc_tla.c (H4): a ROM copy's address -> the IWRAM run address */

void (*a2c_lookup(u32 addr))(void) {
  unsigned lo = 0, hi = a2c_codemap_count;
  addr = Port_TlaRunAddress(addr & ~1u);
  if (!a2cSorted) {
    a2cSorted = malloc(sizeof *a2cSorted * (a2c_codemap_count ? a2c_codemap_count : 1));
    memcpy(a2cSorted, a2c_codemap, sizeof *a2cSorted * a2c_codemap_count);
    qsort(a2cSorted, a2c_codemap_count, sizeof *a2cSorted, a2c_row_cmp);
  }
  while (lo < hi) {
    unsigned mid = (lo + hi) / 2;
    if ((a2cSorted[mid].addr & ~1u) < addr)
      lo = mid + 1;
    else
      hi = mid;
  }
  for (; lo < a2c_codemap_count && (a2cSorted[lo].addr & ~1u) == addr; lo++)
    if (a2cSorted[lo].overlay == 0 || a2cSorted[lo].overlay == a2cOverlay)
      return a2cSorted[lo].fn;
  return 0;
}

void a2c_call(u32 addr) {
  A2cRegs save;
  /* a translated routine (an overlap entry has no C name, so no wrapper): call it as a direct call would, on the
     register file as it is */
  void (*raw)(void) = a2c_lookup(addr);
  if (raw) {
    raw();
    return;
  }
  save = a2c_r;
  {
  const u32 *st = (const u32 *)(uintptr_t)(save.r[13] & ~3u);
  A2cFn f = (A2cFn)Port_ResolveCode((void *)(uintptr_t)addr);
  u32 r = f(save.r[0], save.r[1], save.r[2], save.r[3], st[0], st[1], st[2], st[3]);
  save.r[0] = r;
  a2c_r = save;
  }
}

/* TLA4b: the address the last translated routine returned to (asm2c's A2C_RETJUMP, A2C_CALLK, A2C_TAILK). */
u32 a2c_ret_to;

/* A jump through a register to `t` that is not the routine's own return or local continuation: a return past the
   caller (mplay_main's `pop {pc}` after a tail-branch chain) when no code starts at t, else a computed jump. Code
   starts: a translated routine, a code map function, a RAM alias (Port_CodeAliasAt). */
void *Port_CodeAt(u32 gba);
void *Port_CodeAliasAt(u32 gba);
int a2c_is_return(u32 t) {
  t &= ~1u;
  if (t == 0x0d0ffff0u) /* A2C_RET_SENTINEL: the wrapper's return */
    return 1;
  if ((t >> 24) != 8 && (t >> 24) != 3)
    return 0;
  return !a2c_lookup(t) && !Port_CodeAt(Port_TlaRunAddress(t)) && !Port_CodeAliasAt(t);
}

/* TLA4c: C calls a translated routine that has no C name by its GBA address (Func_0803a8fc calls 0x03000314,
   iwram_math.s's unlabelled Iwram_ExpandBitRuns, by a constant). Port_ResolveCode (port/pc/codemap.c) asks here
   before it gives up and gets a trampoline that runs the routine as a2c_enter_wrapped does: r0-r3 the arguments,
   lr a sentinel, the result r0. bind.py puts Port_ResolveCode just before the indirect call, so the routine kept
   here is the one the trampoline runs. Only four register arguments (stack arguments are not passed on). */
void a2c_badreturn(u32 addr, u32 expected);
static void (*a2cPointerFn)(void);
static u32 a2c_pointer_trampoline(u32 a0, u32 a1, u32 a2, u32 a3) {
  A2cRegs save = a2c_r;
  void (*f)(void) = a2cPointerFn;
  u32 rt = a2c_ret_to, res;
  memset(&a2c_r, 0, sizeof a2c_r);
  a2c_r.r[0] = a0; a2c_r.r[1] = a1; a2c_r.r[2] = a2; a2c_r.r[3] = a3;
  a2c_r.r[13] = save.r[13] ? save.r[13] : 0x03007f00u;
  a2c_r.r[14] = 0x0d0ffff0u;
  a2c_ret_to = 0x0d0ffff0u;
  f();
  res = a2c_r.r[0];
  if (((a2c_ret_to ^ 0x0d0ffff0u) & ~1u) != 0)
    a2c_badreturn(a2c_ret_to, 0x0d0ffff0u);
  a2c_ret_to = rt;
  a2c_r = save;
  return res;
}
void *Port_A2cPointer(u32 a) {
  void (*f)(void) = a2c_lookup(a);
  if (!f)
    return 0;
  a2cPointerFn = f;
  return (void *)a2c_pointer_trampoline;
}

/* A jump to an address that is neither the routine's return nor one of its own continuations. */
void a2c_badreturn(u32 addr, u32 expected) {
  printf("asm2c: continuation at 0x%08x, expected the return to 0x%08x\n", (unsigned)addr, (unsigned)expected);
  fflush(stdout);
  abort();
}

void a2c_trace(u32 addr) { (void)addr; }

/* TLA4c: the back edge of a polling loop in translated code (asm2c mark_spins: a short straight-line loop that only
   loads and tests, e.g. System_WaitForFrameInterrupt on the flag its VBlank handler sets, or a DMA busy bit). On the
   GBA an interrupt or the hardware ends the wait; in the port time passes only in the BIOS halt (port/pc/hw.c), so
   the loop halts until the next interrupt has been handled. asm2c spilled the registers first (sp). */
void Port_BiosHalt(void);
void a2c_spin(void) { Port_BiosHalt(); }

/* TLA4b: what the hardware does on a store to an I/O register from translated code (asm2c's a2c_st32/16/8). C code
   starts a DMA through Dma_Set (port_dma.h -> Port_DmaWritten); the handwritten asm writes the three DMA registers
   itself (the colour kernel loaders' `stmia r4!, {r5, r6, r7}` to DMA3 copy a kernel to the stack and call it at
   once), so a write of a channel's control half starts it here. Background registers reload as in ppu.c. */
void Port_DmaWritten(volatile u32 *channel);
void Port_PpuIoWritten(u32 addr);

void a2c_io_written(u32 a) {
  u32 o = a - 0x04000000u;
  if (o >= 0xB0u && o < 0xE0u) {
    u32 ch = (o - 0xB0u) / 12u, k = (o - 0xB0u) % 12u;
    if (k == 8u || k == 10u)
      Port_DmaWritten((volatile u32 *)(uintptr_t)(0x040000B0u + 12u * ch));
  } else if (o < 0x60u)
    Port_PpuIoWritten(a);
}

