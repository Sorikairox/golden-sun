/* GS28: build-independent saves (docs/GS27.md 8, trap 79).
 *
 * Saving the game snapshots up to 32 field actors into gActorSnapshot (Actor_Snapshot, field/field_sequence/actors.c),
 * which lies in the save buffer: each saved actor's `script` (+0x00, the actor script it runs) and `update` (+0x6c,
 * a callback) go to flash as they are. On the GBA they are ROM or overlay-area (EWRAM) addresses. In wasm a script
 * that is a relocated data symbol (orchestrator D19: it holds code pointers) is a pointer into the module's own
 * data (a reloc_* buffer), and a callback is a function table index; both move whenever the module's layout does,
 * so a save kept the build's address (sol_star_room: 380_gSolSanctumElementalStarRoom_AngleScript, 0x88d2c on one
 * build, 0x908bc on another).
 *
 * Here the snapshot holds the GBA spelling: Actor_Snapshot ends with Port_ActorSnapshotToGba (a relocated buffer's
 * address -> its symbol's GBA address, a table index -> its function's GBA address | 1), and Actor_Restore copies
 * each actor from Port_ActorFromSnapshot, which turns them back for the overlay now loaded (port/c_rules.tsv). A
 * save is then what the GBA writes there, and the same on every build; a GBA save's values work as they are.
 *
 * Old saves (made before GS28): Actor_Restore first calls Port_ActorSnapshotMigrate. A script in module data is read
 * as a buffer of the live site's build 687968a7 (port/pc/save_legacy.h), else of main's clean be42a96 build (the same
 * layout 0x20 lower: 687968a7 also linked a stale probe object, trap 78), else of gs1-options 1a0c602 (0x7b70
 * higher), each limited to the main image and the overlay now loaded; a table index as 687968a7's (the same as every
 * later build's so far, but not guaranteed). */
#include <stdio.h>
#include <string.h>

#include "gba.h"

struct PortReloc {
  u8 *buffer;
  u32 gba;
  u32 size;
  u32 first;
  u32 count;
  u32 overlay;
};
extern const int gPortRelocCount;
extern const struct PortReloc gPortRelocs[];

struct CodeMapRow {
  u32 gba;
  u32 overlay;
  void *fn;
};
extern const int gPortCodeMapCount;
extern const struct CodeMapRow gPortCodeMap[];

struct LegacyReloc {
  u32 buffer;
  u32 gba;
  u32 size;
  u32 overlay;
};
struct LegacyCode {
  u32 gba;
  u16 index; /* - PORT_TABLE_BASE */
  u16 overlay;
};
#include "save_legacy.h"

/* Where the older builds kept the same buffers, relative to 687968a7; tried in this order. */
static const s32 kLegacyDelta[] = {
    0,       /* 687968a7: the live site (GS-deploy .. GS27) */
    -0x20,   /* fdd0e5e2: main be42a96 built clean (no probe_tmp) */
    0x7b70,  /* f0a86799: gs1-options 1a0c602 (GS27, not deployed) */
};

#define SNAPSHOT_CAPACITY 32
#define SNAPSHOT_EMPTY 0xff
#define ACTORS_OFFSET 0x20 /* struct ActorSnapshot: slots[32], then the actors */
#define ACTOR_BYTES 0x70
#define ACTOR_SCRIPT 0x00
#define ACTOR_UPDATE 0x6c
#define OVERLAY_AREA 0x02008000u
#define OVERLAY_END 0x02010000u

extern u8 gActorSnapshot[];

static u32 overlayNow; /* the scene overlay in gOverlayArea (port/pc/decompress.c) */
static int unknownReported;

void Port_SaveCompatOverlay(u32 id) { overlayNow = id; }

static int inModuleData(u32 v) { return v >= PORT_TABLE_END && v < 0x02000000u; }

static u32 rd(const u8 *p) {
  u32 v;
  memcpy(&v, p, 4);
  return v;
}

static void wr(u8 *p, u32 v) { memcpy(p, &v, 4); }

static int overlayOk(u32 overlay) { return overlay == 0 || overlay == overlayNow; }

/* A relocated buffer's address (this build) -> its symbol's GBA address; anything else as it is. */
static u32 dataToGba(u32 v) {
  int i;
  if (!inModuleData(v))
    return v;
  for (i = 0; i < gPortRelocCount; i++) {
    const struct PortReloc *r = &gPortRelocs[i];
    u32 b = (u32)(uintptr_t)r->buffer;
    if (v >= b && v - b < r->size)
      return r->gba + (v - b);
  }
  if (!unknownReported++)
    printf("save_compat: 0x%08x in module data is no relocated buffer\n", (unsigned)v);
  return v;
}

/* A relocated symbol's GBA address (main image, or the overlay now loaded) -> this build's buffer. */
static u32 gbaToData(u32 v) {
  int i;
  if (v < 0x02000000u)
    return v;
  for (i = 0; i < gPortRelocCount; i++) {
    const struct PortReloc *r = &gPortRelocs[i];
    if (overlayOk(r->overlay) && v >= r->gba && v - r->gba < r->size)
      return (u32)(uintptr_t)r->buffer + (v - r->gba);
  }
  return v;
}

/* An older build's buffer address (a save made before GS28) -> the GBA address. anyOverlay: also other overlays'
 * symbols (an entry past the snapshot's list, which nothing reads: only its spelling must not depend on the build). */
static u32 legacyToGba(u32 v, int anyOverlay) {
  unsigned k;
  int i, n = (int)(sizeof(kLegacy687968a7) / sizeof(kLegacy687968a7[0]));
  for (k = 0; k < sizeof(kLegacyDelta) / sizeof(kLegacyDelta[0]); k++)
    for (i = 0; i < n; i++) {
      const struct LegacyReloc *r = &kLegacy687968a7[i];
      u32 b = r->buffer + (u32)kLegacyDelta[k];
      if ((anyOverlay || overlayOk(r->overlay)) && v >= b && v - b < r->size)
        return r->gba + (v - b);
    }
  if (!unknownReported++)
    printf("save_compat: saved 0x%08x is no known build's relocated buffer (overlay %x)\n", (unsigned)v,
           (unsigned)overlayNow);
  return v;
}

/* A function table index -> its function's GBA address (| 1: the game's C is Thumb; IWRAM ARM routines even). */
static u32 codeToGba(u32 v) {
  int i;
  if (!PORT_IS_TABLE_INDEX(v))
    return v;
  for (i = 0; i < gPortCodeMapCount; i++)
    if ((u32)(uintptr_t)gPortCodeMap[i].fn == v) {
      u32 a = gPortCodeMap[i].gba;
      return (a >> 24) == 3 ? a : a | 1;
    }
  return v;
}

/* A table index of build 687968a7 (an older save's callback) -> its function's GBA address | 1. */
static u32 legacyCodeToGba(u32 v) {
  int lo = 0, hi = (int)(sizeof(kLegacyCode687968a7) / sizeof(kLegacyCode687968a7[0]));
  if (!PORT_IS_TABLE_INDEX(v))
    return v;
  while (lo < hi) {
    int mid = (lo + hi) / 2;
    if (kLegacyCode687968a7[mid].index + PORT_TABLE_BASE < v)
      lo = mid + 1;
    else
      hi = mid;
  }
  if (lo < (int)(sizeof(kLegacyCode687968a7) / sizeof(kLegacyCode687968a7[0])) &&
      kLegacyCode687968a7[lo].index + PORT_TABLE_BASE == v) {
    u32 a = kLegacyCode687968a7[lo].gba;
    return (a >> 24) == 3 ? a : a | 1;
  }
  return codeToGba(v);
}

/* A function's GBA address -> its table index (the overlay now loaded first, then the main image). */
static u32 gbaToCode(u32 v) {
  int i;
  u32 a = v & ~1u;
  if (v < 0x02000000u)
    return v;
  if (a >= OVERLAY_AREA && a < OVERLAY_END && overlayNow)
    for (i = 0; i < gPortCodeMapCount; i++)
      if (gPortCodeMap[i].overlay == overlayNow && gPortCodeMap[i].gba == a)
        return (u32)(uintptr_t)gPortCodeMap[i].fn;
  for (i = 0; i < gPortCodeMapCount; i++)
    if (gPortCodeMap[i].overlay == 0 && gPortCodeMap[i].gba == a)
      return (u32)(uintptr_t)gPortCodeMap[i].fn;
  return v;
}

/* End of Actor_Snapshot: the saved actors' script and update in their GBA spelling. The entries past the list
 * (ACTOR_SNAPSHOT_EMPTY) are older snapshots' actors, saved too but never read: theirs are GBA already, or an
 * older build's when a save made before GS28 was loaded. */
void Port_ActorSnapshotToGba(void) {
  int i, live = 1;
  for (i = 0; i < SNAPSHOT_CAPACITY; i++) {
    u8 *a = gActorSnapshot + ACTORS_OFFSET + i * ACTOR_BYTES;
    u32 script = rd(a + ACTOR_SCRIPT);
    if (gActorSnapshot[i] == SNAPSHOT_EMPTY)
      live = 0;
    if (live)
      script = dataToGba(script);
    else if (inModuleData(script))
      script = legacyToGba(script, 1);
    wr(a + ACTOR_SCRIPT, script);
    wr(a + ACTOR_UPDATE, live ? codeToGba(rd(a + ACTOR_UPDATE)) : legacyCodeToGba(rd(a + ACTOR_UPDATE)));
  }
}

/* Start of Actor_Restore: a save made before GS28 holds an older build's buffer addresses; turn them into GBA
 * addresses in the snapshot itself (the listed actors' for the overlay now loaded, the rest for any), so the snapshot
 * and saving again are as if the save had been made by this build. A no-op on GBA spellings. */
void Port_ActorSnapshotMigrate(void) {
  int i, live = 1;
  for (i = 0; i < SNAPSHOT_CAPACITY; i++) {
    u8 *a = gActorSnapshot + ACTORS_OFFSET + i * ACTOR_BYTES;
    u32 script = rd(a + ACTOR_SCRIPT);
    if (gActorSnapshot[i] == SNAPSHOT_EMPTY)
      live = 0;
    if (inModuleData(script))
      wr(a + ACTOR_SCRIPT, legacyToGba(script, !live));
    wr(a + ACTOR_UPDATE, legacyCodeToGba(rd(a + ACTOR_UPDATE)));
  }
}

/* Actor_Restore's copy source: the snapshot's actor with this build's script buffer and update index. */
void *Port_ActorFromSnapshot(void *snapshot) {
  static u32 actor[ACTOR_BYTES / 4];
  memcpy(actor, snapshot, ACTOR_BYTES);
  wr((u8 *)actor + ACTOR_SCRIPT, gbaToData(rd((u8 *)actor + ACTOR_SCRIPT)));
  wr((u8 *)actor + ACTOR_UPDATE, gbaToCode(rd((u8 *)actor + ACTOR_UPDATE)));
  return actor;
}
