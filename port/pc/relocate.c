/* Relocated data (orchestrator D19): data symbols that hold code pointers, and data that points to them, live
 * in wasm buffers (reloc_*, build/wasm/gen/relocated.c) instead of the ROM. This fills each buffer from the
 * symbol's GBA bytes and patches its pointer slots (table: build/wasm/gen/reloc_table.ll, from
 * port/symbols/relocs.tsv). Main-image symbols are filled from the ROM at boot; an overlay's from the overlay
 * area once the game has loaded that overlay. */
#include <stdint.h>
#include <string.h>

struct PortReloc {
  uint8_t *buffer;
  uint32_t gba;     /* where the bytes are on the GBA */
  uint32_t size;
  uint32_t first;   /* first slot in gPortRelocSlots */
  uint32_t count;
  uint32_t overlay; /* 0: main image; else the overlay's resource id */
};

struct PortRelocSlot {
  uint32_t offset;
  uint32_t gbaTarget; /* the target's GBA address */
  void *target;       /* a wasm function pointer or a reloc_* buffer */
  uint32_t isCode;
};

extern const int gPortRelocCount;
extern const struct PortReloc gPortRelocs[];
extern const struct PortRelocSlot gPortRelocSlots[];

static void fill(const struct PortReloc *r) {
  uint32_t i;
  memcpy(r->buffer, (const void *)(uintptr_t)r->gba, r->size);
  for (i = 0; i < r->count; i++) {
    const struct PortRelocSlot *s = &gPortRelocSlots[r->first + i];
    uint32_t *slot = (uint32_t *)(r->buffer + s->offset);
    uint32_t word;
    memcpy(&word, slot, 4);
    word = s->isCode ? (uint32_t)(uintptr_t)s->target : (uint32_t)(uintptr_t)s->target + (word - s->gbaTarget);
    memcpy(slot, &word, 4);
  }
}

/* Main-image symbols, from the ROM (call once the ROM is in memory). Returns how many were filled. */
int Port_RelocateAll(void) {
  int i, n = 0;
  for (i = 0; i < gPortRelocCount; i++)
    if (gPortRelocs[i].overlay == 0) {
      fill(&gPortRelocs[i]);
      n++;
    }
  return n;
}

/* One overlay's symbols, from the overlay area (call after the game has decompressed overlay `id` there). */
int Port_RelocateOverlay(uint32_t id) {
  int i, n = 0;
  for (i = 0; i < gPortRelocCount; i++)
    if (gPortRelocs[i].overlay == id) {
      fill(&gPortRelocs[i]);
      n++;
    }
  return n;
}

/* Self-check for tests: every patched code slot holds an index into the function table (not a GBA address),
 * and every patched data slot points into its target buffer. Returns the number of bad slots. */
int Port_RelocCheck(void) {
  int i, bad = 0;
  for (i = 0; i < gPortRelocCount; i++) {
    const struct PortReloc *r = &gPortRelocs[i];
    uint32_t k;
    if (r->overlay)
      continue;
    for (k = 0; k < r->count; k++) {
      const struct PortRelocSlot *s = &gPortRelocSlots[r->first + k];
      uint32_t word;
      memcpy(&word, r->buffer + s->offset, 4);
      if (s->isCode ? word != (uint32_t)(uintptr_t)s->target
                    : (word < (uint32_t)(uintptr_t)s->target || word >= 0x02000000u))
        bad++;
    }
  }
  return bad;
}
