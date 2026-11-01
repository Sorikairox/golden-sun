/* Calls to code by GBA address (orchestrator D7, G3). Every indirect call of the game goes through
 * Port_ResolveCode (tools/wasm/bind.py rewrites the IR): a wasm function pointer (a table index, small) passes
 * through; anything else is a GBA code address and is looked up:
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

#define TABLE_LIMIT 0x10000u /* wasm function table indices are below this; data addresses are not */
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

/* Data was written over [to, to + bytes): any alias there is gone (a heap block reused for other code or
 * data). */
void Port_CodeUnalias(u32 to, u32 bytes) {
  int i, k = 0;
  for (i = 0; i < aliasCount; i++)
    if (aliases[i].gba < to || aliases[i].gba >= to + bytes)
      aliases[k++] = aliases[i];
  aliasCount = k;
}

void *Port_ResolveCode(void *p) {
  u32 a = (u32)(uintptr_t)p;
  void *fn;
  int i;
  if (a < TABLE_LIMIT)
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
  printf("Port_ResolveCode: no function at GBA address 0x%08x (overlay %x)\n", (unsigned)a, (unsigned)currentOverlay);
  fflush(stdout);
  abort();
}
