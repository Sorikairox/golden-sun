# TLA2: multi-game build, TLA's C compiled and linked (2026-11-03)

Phase TLA2 of `docs/TLA_PLAN.md`. Vendor `vendor/alchemy` f6c08e64; TLA address map from the exact tla-en build (TLA1).

## 1. What was added

- `tools/wasm/build.py --game {tbs,tla}` (default tbs). `tools/wasm/game.py` holds the per-game paths; every stage
  and the port_src.py subprocesses read it through `PORT_GAME`. tbs keeps GS1's paths exactly (build/wasm,
  port/*.tsv, port/symbols, port/shim). tla: vendor games/tla, tables `port/tla/`, map `port/tla/symbols/`, out
  `build/wasm-tla`. `tools/web_build.sh --game tla` defaults ROM to the TLA cartridge (leak check).
- `port/tla/symbols/` (GS1-format tables) from `tools/ref/make_symbols.py port_work/tla1 <TLA ROM> port/tla/symbols
  vendor/alchemy tla-en` (new EDITION argument). The objects come from the volume (`/ref/alchemy-tla/out/tla-en/obj`,
  copied into the gitignored port_work/tla1/obj with the overlays' .bin and listing .o). 4,109/4,109 ROM sections
  equal; the names and addresses agree with port/symbols/tla-en*.tsv (0 differences). msg_ids.h (ids only) is in
  port_work/tla2/gen.
- `port/tla/`: pc.tsv (which port/pc files TLA shares: hardware, memory, PPU, APU, BIOS, codemap, relocate,
  blocks, stubs, main; GS1's tbs asm ports are off), fn_overrides/asm_rules/c_rules/overrides.tsv, `shim/` (prelude,
  port_dma.h for guard GUARD_DMA_H, port_transform.h), `tools/code_range_audit.tsv` (header only, see 4).

## 2. Compile problems (3,702 C objects incl. port/pc) and how they were handled

| class | objects | handling |
|---|---|---|
| `extern struct X a[]` with X incomplete (GCC takes it) | 419 | prelude includes scene_tables.h first; opaque `struct SceneRegion` (never defined by the vendor); gScene_CueRuleTable's declaration moved next to its struct (c_rules) |
| ARM register pins `register T x __asm__("r3")` (Dma_Set, FAKEMATCH) | 340 | port_src: pins dropped (TLA only); DMA and transform headers shimmed by guard |
| `asm("" : "+l"(x))` (not `__asm__`), `"sfp"` clobber | 129 | the GS1 empty-asm rule extended for TLA (both fixes in one statement) |
| default-error type warnings (function-pointer, int conversion, pointer types, return) | ~140 | `-Wno-...` for TLA only (game.py extra_cflags) |
| ARM struct rounding to 4 bytes (static asserts) | 59 | c_rules: `__attribute__((aligned(4)))` on SpriteEntry and ScreenTransitionDissolveState |
| root-relative includes `../../../../../games/tla/src/...` | 2 | the TLA mirror lives at build/wasm-tla/alchemy/games/tla, include/ mirrored and transformed too |
| `bx %0` (System_Reset to Cart_Restart) | 1 | asm rule: indirect call (Port_ResolveCode) |
| **left (48 objects, build/wasm-tla/ll_failed.tsv)** | 48 | 23 `extern u8 gMainRoutineWork[]` vs the struct (scene files), 10 static Effect_Create vs header, 7 struct used as integer, 4 non-empty ARM asm (render.c, s0e40, s43f8, ...), 3 conflicting types, 1 volatile gInput. Their functions are logged stubs |

Link: per-signature adapters (`NAME$c<sig>`) for every call whose TU declares another prototype than the definition
or the most common declaration (TLA only, link.py adapt_mismatched_calls); stubs take that canonical type. RAM
words named by address (`gData_020007e4`, defined in one overlay listing, read by other scenes) are bound to the
address in the name. Result: **0 linker warnings**, game.wasm 3,978,827 bytes.

## 3. Stubs: 2,545 logged stubs (491 veneers)

| place | kind | stubs |
|---|---|---|
| main | asm listing (recon/tla/raw) | 238 |
| main | hand .s (far-call veneers, kernels) | 274 |
| main | C (in the 48 left-out objects) | 12 |
| overlay | hand .s (scene import veneers, mostly) | 1,361 (+104 with no lang) |
| overlay | name both C and hand .s in different overlays | 238 + 57 + 49 |
| overlay | other (listing pieces, gen) | 98 |
| none | not in the map (Sound_Mixer, System_Initialize, ovNNN_ names of left-out C) | 113 + 1 Port_ |

The big overlay class is the scenes' own import veneers (`import` in each scene's .s, not in
system/overlay/imports.inc): link.py's veneer_map reads only far_call/*.s and imports.inc. Teaching it the scene
import files should turn most of the 1,361 into veneers (TLA4 or the next TLA2 follow-up).

## 4. Checks

- GS1: `tools/web_build.sh` game.wasm **687968a7**, game.js **895d45cc** (identical), audit 46/46 PASS, leak PASS;
  `tools/regress.sh --quick` 9/9 OK.
- TLA leak check: 3,551,267 ROM data windows, **0 found, PASS** (overlay data against port_work/tla1/overlays/*.bin).
- TLA code-range audit: **187 hits, none audited yet** (151 region, 15 below64k, 10 topmask, 6 shr24, 5 codediff;
  `PORT_GAME=tla python3 tools/wasm/code_range_audit.py --list`). Not done in TLA2: a full `--game tla` build stops
  at the audit stage; run the other stages with `--only ll,bind,obj,link,leak`. Notable: task.c:199 and
  resume_and_run.c:39 `>> 24` (GS1's trap 41 twin), flash.c codediff/topmask (flash driver: GS1 replaced it).

## TLA2b: audit, left-out objects, overlay veneers (2026-11-03)

A full `tools/web_build.sh --game tla` now passes every stage (audit, ll, bind, obj, link, leak) in about 40 s.

### Code-range audit (port/tla/tools/code_range_audit.tsv)

187/187 hits audited: **170 data, 6 safe, 3 fixed, 8 replaced**. Real fixes:

- task.c:199 and resume_and_run.c:39: `(task->func >> 24) == 2` (trap 41's twin). port/tla/c_rules.tsv adds
  Port_CodeIsOverlay, as GS1 does.
- include/gamepak/rom_header.h:6 Cart_Restart: already handled. The asm rule turns `bx` into an indirect call, and
  Port_ResolveCode sends 0x08000000 to Port_SystemEntry (trap 36).
- The flash driver. ReadFlash and Flash_VerifySector copy code to the stack using an address difference
  (`(u32)ReadFlash - (u32)ReadFlashCore`), which is a table-index difference in wasm. TLA's driver has the same six
  entry points as tbs, so port/pc/flash.c replaces it: pc.tsv flash yes, plus 6 fn_overrides rows. The other 8
  hits are inside the replaced functions.

The safe hits are message-or-routine tests (`< 0x10000`, trap 26). The data hits are VRAM/IWRAM addresses,
16.16 positions and scales, the field work pointer at 0x0300006c, and message-id differences (absolute symbols).

### Left-out objects: 48 -> 1

TLA c_rules (port_src now lets a TLA rule insert a line, written `\n` in the replacement):
- 31 files declare `extern u8 gMainRoutineWork[]`. A rule makes that a `#define` to the struct's address as `u8 *`.
- field_effect/spawn.c has a static Effect_Create. A rule renames it with a macro (10 overlays).
- camera_flag.c: Transform_ApplyLookAt and Transform_SetLookAt are declared `s32 (void *, void *)` and their
  value is returned. A rule makes the call yield 0.
- fxdisp.c: the Transform_SetLookAt redeclaration is dropped.
- f1096f8.c and flaggrid.c declare `volatile gInput`. Reads go through a volatile macro.
- timed_entries.c calls BattleEvent_Push before declaring it. A rule declares it first.
- port_src drops register pins on function-pointer declarators too (f182898.c, ankohl_ruins/s20fc.c).

**Left: src/system/render.c.** Its Render_ResetTransformState and others are a real ARM `stmia` block (an
identity 3x4 matrix), which belongs to TLA4/TLA5. 7 main C stubs come from it.

### Overlay veneers and stub classes

- `tools/wasm/overlay_imports.py` reads two kinds of veneer file:
  - every overlay's import .s (objects.tsv, `NAME:` ... `overlay_veneer TARGET`; 114 overlays, 7,001 entries;
    611 names lead to different targets in different overlays);
  - TLA's far-call files (gamepak/far_call/*.s, same macro, also `ldr r4,[pc]; bx r4; .4byte T`; 916 entries).
- bind.py renames an overlay's call to `ovNNN_NAME` in two cases:
  - its import table has NAME (14,117 calls);
  - its map has NAME as code but no C defines it there (385 calls). Before, such a call fell back to the only
    overlay whose C defines NAME, which ran another overlay's copy.
- link.py:
  - its veneer_map now includes these entries;
  - a veneer chain that ends at a routine nobody defines yet makes one stub, under that routine's name.
- C objects linked into several overlays (17 objects, e.g. field/object/set_sprite_priority in 49 overlays) are
  now bound once per overlay (`path@NNN`, game.bound_names). Before, the last overlay's binding overwrote the
  others, so 48 overlays lacked their copy. The ll stage compiles each object once.
- The link stage links only this build's vendor objects (stale `.o` files of a renamed module linked twice).

| | TLA2 | TLA2b |
|---|---|---|
| veneers | 491 | 6,003 |
| logged stubs | 2,545 | **647** |
| main: listing asm (recon/tla/raw) | 238 | 273 |
| main: hand .s | 274 | 36 (IWRAM math, m4a driver, color/OAM kernels, iwram_entry...) |
| main: C | 12 | 7 (render.c) |
| overlay: listing asm | (in 1,900) | 328 |
| overlay: hand .s | 1,361 import veneers + 104 | 1 (ov6b5_DebugParty_LoadPreset: its target is K&R-stubbed) |
| overlay: C in one overlay, asm in another / unclassified | 344 + 98 | 0 |
| not in any map | 114 | 2 (Sound_Mixer, System_Initialize) |

The real asm list, 638 routines: `build/wasm-tla/asm_stubs.tsv` (build output) and `port/tla/asm_stubs.tsv`
(committed, names and objects only). The full classes are in `build/wasm-tla/stub_classes.tsv`. To regenerate:
`PORT_GAME=tla python3 tools/wasm/stub_classes.py [--commit port/tla/asm_stubs.tsv]`. The link stage also runs it.

Checks: TLA links with 0 linker warnings, leak 0 (3,551,267 windows). GS1 is byte-identical (game.wasm
687968a7, game.js 895d45cc, SHA-1). `tools/regress.sh --quick` passes 9/9.
