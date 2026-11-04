/* Calls to code by GBA address (orchestrator D7, G3). Every indirect call of the game goes through
 * Port_ResolveCode (tools/wasm/bind.py rewrites the IR): a wasm function pointer (a table index, small) passes
 * through (PORT_IS_TABLE_INDEX, gba.h); anything else is a GBA code address and is looked up:
 *   1. aliases: RAM copies of code (Port_DmaWritten registers the destination of any copy whose source is a
 *      known function start, which covers RamCode_Load and the stack copies of ARM kernels);
 *   2. the loaded overlay's functions (gOverlayArea entry table pointers and overlay code addresses);
 *   3. the main image's functions, including our C ports of ARM routines (same names, build/wasm/gen/code_map.ll).
 * An unknown address is reported once and stops the game (abort): it names the next routine to port. */
#include <stdio.h>
#include <stdlib.h>

#include "gba.h"

struct CodeMapRow {
  u32 gba;
  u32 overlay; /* 0 = main image, else the overlay's resource id */
  void *fn;
};

extern const int gPortCodeMapCount;
extern const struct CodeMapRow gPortCodeMap[];

#define MAX_ALIASES 64

static struct {
  u32 gba;
  void *fn;
} aliases[MAX_ALIASES];
static int aliasCount;
static u32 currentOverlay;
static int mainEnd = -1; /* rows [0, mainEnd) are the main image's (overlay 0 sorts first) */
static int ovFirst, ovEnd;

static void index_main(void) {
  int i = 0;
  while (i < gPortCodeMapCount && gPortCodeMap[i].overlay == 0)
    i++;
  mainEnd = i;
}

static void *search(int lo, int end, u32 gba) {
  int hi = end;
  while (lo < hi) {
    int mid = (lo + hi) / 2;
    if (gPortCodeMap[mid].gba < gba)
      lo = mid + 1;
    else
      hi = mid;
  }
  return lo < end && gPortCodeMap[lo].gba == gba ? gPortCodeMap[lo].fn : 0;
}

/* The main image's function at a GBA address (bit 0, the Thumb bit, ignored), or 0. */
void *Port_CodeAt(u32 gba) {
  if (mainEnd < 0)
    index_main();
  return search(0, mainEnd, gba & ~1u);
}

/* The GBA address of the main image's function whose wasm function pointer (table index) is `fn`, or 0. A RAM
 * copy of a vendor C routine compiled as ARM (RamCode_Load(routine, Tile_BuildCellPictures, ...)) takes the
 * function's address as data: in wasm that is a table index, not its place in the ROM. */
u32 Port_CodeGbaOf(u32 fn) {
  int i;
  if (mainEnd < 0)
    index_main();
  if (!PORT_IS_TABLE_INDEX(fn))
    return 0;
  for (i = 0; i < mainEnd; i++)
    if ((u32)(uintptr_t)gPortCodeMap[i].fn == fn)
      return gPortCodeMap[i].gba;
  return 0;
}

/* Is `fn` a scene overlay's function? On the GBA an overlay runs from EWRAM, so Task_SuspendOverlayTasks and
 * Task_ResumeOverlayTasks (system/system/task.c) pick a task's routine by its top byte (0x02); in wasm the routine
 * is a table index with no such byte (traps 26, 40): look it up among the overlays' rows (port/c_rules.tsv). */
int Port_CodeIsOverlay(u32 fn) {
  int i;
  if (mainEnd < 0)
    index_main();
  if (!PORT_IS_TABLE_INDEX(fn))
    return 0;
  for (i = mainEnd; i < gPortCodeMapCount; i++)
    if ((u32)(uintptr_t)gPortCodeMap[i].fn == fn)
      return 1;
  return 0;
}

#ifdef PORT_GAME_TLA
/* TLA9a: the overlay now loaded, for port/pc/save_compat.c (GS1 gets it from port/pc/decompress.c) */
u32 Port_CodeMapCurrentOverlay(void) { return currentOverlay; }
#endif

/* Overlay `id` is now in gOverlayArea: its functions answer for the overlay area's addresses. */
void Port_CodeMapOverlay(u32 id) {
  int i;
  if (mainEnd < 0)
    index_main();
  currentOverlay = id;
  ovFirst = ovEnd = mainEnd;
  for (i = mainEnd; i < gPortCodeMapCount && gPortCodeMap[i].overlay != id; i++)
    ;
  ovFirst = i;
  while (i < gPortCodeMapCount && gPortCodeMap[i].overlay == id)
    i++;
  ovEnd = i;
}

/* Does overlay `id` have functions in the map? */
int Port_CodeMapHasOverlay(u32 id) {
  int i;
  if (mainEnd < 0)
    index_main();
  for (i = mainEnd; i < gPortCodeMapCount; i++)
    if (gPortCodeMap[i].overlay == id)
      return 1;
  return 0;
}

/* A copy of the code at `from` now sits at `to` (RAM): calls to `to` run the same function. */
void Port_CodeAlias(u32 to, u32 from) {
  void *fn = Port_CodeAt(from);
  int i;
  if (!fn)
    return;
  to &= ~1u;
  for (i = 0; i < aliasCount; i++)
    if (aliases[i].gba == to) {
      aliases[i].fn = fn;
      return;
    }
  if (aliasCount < MAX_ALIASES) {
    aliases[aliasCount].gba = to;
    aliases[aliasCount].fn = fn;
    aliasCount++;
  } else {
    /* reuse the oldest slot */
    for (i = 1; i < MAX_ALIASES; i++)
      aliases[i - 1] = aliases[i];
    aliases[MAX_ALIASES - 1].gba = to;
    aliases[MAX_ALIASES - 1].fn = fn;
  }
}

/* RAM code that is no copy of a known routine (a blitter BattleEffect_BuildBlitter assembled): calls to `to`
 * run the C function fn (port/pc/blitter.c) */
void Port_CodeAliasFn(u32 to, void *fn) {
  int i;
  to &= ~1u;
  for (i = 0; i < aliasCount; i++)
    if (aliases[i].gba == to) {
      aliases[i].fn = fn;
      return;
    }
  if (aliasCount == MAX_ALIASES) {
    for (i = 1; i < MAX_ALIASES; i++)
      aliases[i - 1] = aliases[i];
    aliasCount--;
  }
  aliases[aliasCount].gba = to;
  aliases[aliasCount].fn = fn;
  aliasCount++;
}

/* Data was written over [to, to + bytes): any alias there is gone (a heap block reused for other code or
 * data). */
void Port_CodeUnalias(u32 to, u32 bytes) {
  int i, k = 0;
  for (i = 0; i < aliasCount; i++)
    if (aliases[i].gba < to || aliases[i].gba >= to + bytes)
      aliases[k++] = aliases[i];
  aliasCount = k;
}

#ifdef PORT_GAME_TLA
/* TLA4b: the function a RAM copy at `gba` runs (Port_CodeAlias), or 0; asm2c's run time asks before it takes a
 * jump to an unknown address for a return past the caller (port/tla/a2c/a2c_rt.c a2c_is_return). */
void *Port_CodeAliasAt(u32 gba) {
  int i;
  gba &= ~1u;
  for (i = aliasCount - 1; i >= 0; i--)
    if (aliases[i].gba == gba)
      return aliases[i].fn;
  return 0;
}
#endif

void Port_SystemEntry(void);

#ifdef PORT_GAME_TLA
static int resolveQuiet;
void *Port_ResolveCode(void *p);
/* TLA4d: the function at a code address, or 0 (no abort): Port_TlaTaskKey (port/tla/hw/pc_tla.c). */
void *Port_TryResolveCode(void *p) {
  void *fn;
  resolveQuiet = 1;
  fn = Port_ResolveCode(p);
  resolveQuiet = 0;
  return fn;
}
#endif

void *Port_ResolveCode(void *p) {
  u32 a = (u32)(uintptr_t)p;
  void *fn;
  int i;
  if (a < PORT_TABLE_END) /* a wasm function pointer (or null) */
    return p;
  a &= ~1u;
  for (i = aliasCount - 1; i >= 0; i--)
    if (aliases[i].gba == a)
      return aliases[i].fn;
  if (currentOverlay && a >= 0x02008000u && a < 0x02010000u) {
    fn = search(ovFirst, ovEnd, a);
    if (fn)
      return fn;
  }
  fn = Port_CodeAt(a);
  if (fn)
    return fn;
#ifdef PORT_GAME_TLA
  if (a == 0x08000000u || a == 0x08000428u) /* TLA4b: Cart_Start, TLA's Entry: the soft reset (main.c, trap 36) */
#else
  if (a == 0x08000000u || a == 0x080003C0u) /* Cart_Start, System_Entry: the soft reset (main.c, trap 36) */
#endif
    return (void *)Port_SystemEntry;
#ifdef PORT_GAME_TLA
  { /* TLA4b (H4): the ROM load address of code copied to IWRAM (port/tla/hw/pc_tla.c) */
    u32 Port_TlaRunAddress(u32 a);
    u32 run = Port_TlaRunAddress(a);
    if (run != a)
      return Port_ResolveCode((void *)(uintptr_t)run);
  }
  if (resolveQuiet) /* TLA4d: Port_TryResolveCode: C functions only (not the shared a2c trampoline), no abort */
    return 0;
  { /* TLA4c: a translated routine with no C name (port/tla/a2c/a2c_rt.c) */
    void *Port_A2cPointer(u32 a);
    fn = Port_A2cPointer(a);
    if (fn)
      return fn;
  }
#endif
  printf("Port_ResolveCode: no function at GBA address 0x%08x (overlay %x)\n", (unsigned)a, (unsigned)currentOverlay);
  fflush(stdout);
  abort();
}
