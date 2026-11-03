# TLA1: pins, reference build, map (2026-11-03)

Phase TLA1 of `docs/TLA_PLAN.md`. Vendor: `vendor/alchemy` at **f6c08e64** (pulled with the user's approval in TLA0,
from 24b72a32).

## 1. GS1 stays byte-identical at f6c08e64: no pin needed

- `tools/web_build.sh` gained `ALCHEMY=<checkout>`: it mounts another alchemy checkout at the same container path
  (`/gs/vendor/alchemy`), so nothing else in the build changes (paths, flags, tables).
- A temporary git worktree of the vendor at 24b72a32 (`git -C vendor/alchemy worktree add --detach
  ../alchemy-24b72a32 24b72a32`, no stash) was checked inside the container: its thor.c (ff6d3d9d…) differs from
  f6c08e64's (5d32935d…), so the mount really replaced the vendor.
- Builds, both 0 linker warnings, leak check PASS:

  | build | game.wasm SHA-1 | game.js SHA-1 |
  |---|---|---|
  | vendor f6c08e64 | 687968a7f8fa454b4d148a539105dffd31af1704 | 895d45cca57d7231643fe47bf50a44928f5e92da |
  | vendor 24b72a32 (worktree) | 687968a7… (cmp: identical) | 895d45cc… (cmp: identical) |
  | live site (`~/golden-sun-site/publish`, `build/site`) | 687968a7… | |

- `tools/regress.sh` (full): **62/62 OK** (61 cases + link2), exit 0: every digest unchanged.
- Conclusion: the only tbs change in the pull (thor.c, comments) leaves GS1's wasm identical. **No
  `vendor/alchemy-tbs` pin.** GS1 builds from `vendor/alchemy` at f6c08e64. Recorded as D22 in the orchestrator. Any
  later re-pin for TLA must repeat this check (`ALCHEMY=<old worktree> tools/web_build.sh`, cmp, regress); if it ever
  differs, pin GS1 then.
- The worktree was removed afterwards (`git -C vendor/alchemy worktree remove ../alchemy-24b72a32`).

## 2. Reference tla-en build: compare-tla-en OK

- `tools/check_rom_tla.sh`: the TLA ROM is OK (16,777,216 bytes, AGFE, SHA-1 b5006632…).
- `tools/build_ref_tla.sh [fetch|bootstrap|build|all]`: the golden-sun-tools image and golden-sun-ref volume (no new
  image). It clones the vendor into the volume as `/ref/alchemy-tla` (GS1's `/ref/alchemy` untouched), links the ROM
  (read only) at the vendor's path `roms/tla-en.gba` inside the volume clone, builds TLA's own compilers and runs
  `make -j8 compare-tla-en`. A full run (compilers + ROM) takes about 35 s.
- **First attempt, with GS1's compilers: FAILED.** alchemy commit 34c36297 ("The Lost Age leaves its three compiler
  options", 1 Nov) dropped `-mthumb-split-constants -mthumb-call-via-lr -mthumb-slow-loads` from `CFLAGS_tla` and
  moved that behaviour into alchemy-gcc ("the scheduler back at the 2000-07-31 snapshot", 25 objects redone); the
  gitlink moved from alchemy-gcc **9bc4e65a** (fetched in GS0/GS1, D13 b) to **641764a5**. With 9bc4e65a and the
  three options put back on the make command line, the main image already had the cart's layout (two functions
  differed by 18 bytes in place) and 50 of 114 overlays were identical (trap 52).
- **Download approved (user, 2026-11-03, D13 f):** alchemy-gcc at 641764a5 into `vendor/alchemy-gcc-tla` (a second
  checkout; `vendor/alchemy-gcc` stays at 9bc4e65a for GS1), fetched inside Docker. Its nested pins are the ones
  already approved: `agbcc` -> https://github.com/pret/agbcc.git at **da598c1d** (D13 d), and `arm/Makefile`'s
  gcc-2.95.2 SHA-256 **064e1cb0…7d72482** (D13 e). Nothing else was downloaded; GAS 2.10 is copied from
  `/ref/alchemy` (same binutils tarball).
- Bootstrap: generated tables match; xgcc, cpp0 and as equal GS1's, cc1, gcc2952_arm and old_agbcc differ.
- **Result: `out/tla-en/tla-en.gba: OK`** (SHA-1 b500663220cb9bf56b9f8e8c0c544f1d6fa3a824). All 114 overlays'
  packed bytes are found in the ROM.

## 3. Symbols (exact)

`tools/ref/make_symbols_tla.py port_work/tla1 vendor/alchemy port/symbols` (names, addresses, sizes; no ROM bytes):

- `port/symbols/tla-en.tsv`: 29,352 main-image symbols (name, address, size, type, input section, object, lang).
- `port/symbols/tla-en-overlays.tsv`: 14,576 symbols of the 114 scene overlays (linked at 0x02008000).
- `port/symbols/tla-en-census.tsv`: the census below.

Against the provisional near-match tables: in the main image only the packed overlay stream's symbols moved (111
rows); in the overlays only overlay 661 (yampi_desert) moved, by 4 bytes from one C function on (217 rows). All
other overlay addresses were already right.

## 4. Census (replaces TLA_PLAN 1.2's estimate)

Bytes of linked sections, by class (definitions in `make_symbols_tla.py`): C = .text of objects built from .c; asm
= the vendor's disassembled listings (recon/tla/raw, the .text.x pieces of the overlay listings), pools included;
hand = handwritten .s in games/tla/src (far-call/import veneers, mixer, kernels); data = everything else with ROM
bytes; the packed overlay stream is counted apart because each overlay is counted from its own map.

| place | C | asm (listings) | hand .s | data |
|---|---|---|---|---|
| main | 253,752 B (2,358 fn) | **628,240 B (525 fn)** | 34,346 B (1,022 symbols) | 13,927,737 B (+ 744,912 overlay stream) |
| overlays (114) | 659,328 B (4,497 fn) | **330,912 B (678 fn)** | 55,992 B (6,999 symbols, mostly veneers) | 331,070 B |
| **all** | **913,080 B (46.5 %)** | **959,152 B (48.9 %)** | 90,338 B (4.6 %) | |

All code: 1,962,630 bytes (libgcc 60). So **about half of TLA's code bytes are still asm (48.9 %)**, at the top of the
plan's 35–50 % estimate, and 68.6 % of the main image's code. By functions it is 1,203 asm routines of
8,058 C + asm (15 %).

Biggest asm areas:

- `rom_main_09` (0x08138000–0x081a0000), the battle effects: **347,520 B** of the 628,240 main asm bytes.
  Largest routines: Func_0815f16c 18,276 B; BattleEffect_RunIris 10,928; RunCharon 9,996; Func_081848ec 9,488;
  Func_08173aac 9,416; RunDaedalus 8,764; RunCoatlicue 6,484; RunHaures 6,132; RunCruelRuin 6,072; RunJudgment 6,052.
- Outside battle effects (main): BattleTarget_Execute 8,300 B (0x08120454), Func_081b83c4 8,008, Func_08046b08
  7,044, LuckyDice_Run 4,588, Func_0804bc08 4,512.
- Overlays by listing asm: airs_rock_inside (664) 13,068 B; jupiter_lighthouse_aerie_beacon (6a5) 12,776; airs_rock
  (663) 10,664; gaia_rock_inside (681) 10,520; garoh (65f) 10,504; mars_lighthouse_entrance (6aa) 9,972; world_map
  (64b) 9,920. 88 of 114 overlays hold listing pieces.

## 5. Tools added

- `tools/web_build.sh` `ALCHEMY=` (vendor override, same mount path).
- `tools/check_rom_tla.sh` (SHA-1, size, AGFE).
- `tools/build_ref_tla.sh [fetch|bootstrap|build|all]`.
- `tools/ref/make_symbols_tla.py` (symbols + census).
