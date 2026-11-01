/* Logged stubs: tools/wasm/link.py generates one function per symbol nothing defines yet (asm routines still
 * to port, D6; PC-layer entry points not written yet), each calling Port_StubHit with its index. The first hit
 * of each is printed; Port_StubHits() reports how many distinct stubs ran. */
#include <stdio.h>

extern const char *const gPortStubNames[];
extern const int gPortStubCount;
static unsigned char hit[8192];
static int hits;

void Port_StubHit(int index) {
  if (index >= 0 && index < gPortStubCount && index < (int)sizeof(hit) && !hit[index]) {
    hit[index] = 1;
    hits++;
    printf("stub: %s\n", gPortStubNames[index]);
  }
}

int Port_StubHits(void) { return hits; }
