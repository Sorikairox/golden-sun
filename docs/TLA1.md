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

## 2. Reference tla-en build: blocked on the compiler pin (approval needed)

- `tools/check_rom_tla.sh`: the TLA ROM is OK (16,777,216 bytes, AGFE, SHA-1 b5006632…).
- `tools/build_ref_tla.sh`: the golden-sun-tools image and golden-sun-ref volume (no new image). It clones the vendor
  into the volume as `/ref/alchemy-tla` (GS1's `/ref/alchemy` untouched), copies the compilers GS1's bootstrap built
  there, links the ROM (read only) at the vendor's path `roms/tla-en.gba` inside the volume clone, and runs
  `make -j8 compare-tla-en`. A full build takes about 30 s.
- **Result: `out/tla-en/tla-en.gba: FAILED`.** The cause is the compiler, not the ROM or the tree:
  - alchemy commit 34c36297 ("The Lost Age leaves its three compiler options", 1 Nov) dropped
    `-mthumb-split-constants -mthumb-call-via-lr -mthumb-slow-loads` from `CFLAGS_tla` and moved that behaviour into
    alchemy-gcc, with "the scheduler back at the 2000-07-31 snapshot"; it redid 25 objects (29 functions) whose
    instruction order only matches the new compiler.
  - The gitlink moved from alchemy-gcc **9bc4e65a** (what we fetched in GS0/GS1, D13 b) to **641764a5**.
  - With our 9bc4e65a compiler and f6c08e64's flags, everything shifts (2.1 MB differ).
  - With our 9bc4e65a compiler and the three old options passed on the make command line (`CFLAGS_tla=...`, no
    vendor file changed): **the main image matches the cart in size and addresses**; only two functions differ, by
    18 bytes each, in place (`field/field_sequence/f0d0ca0`, `menu/title_intro/f1a78c0`), plus the overlay stream and
    its resource directory. Of 114 overlays, 50 build byte-identical (their packed bytes are found in the ROM), 64 do
    not (the order-only differences; not checked further).
- **Needed to finish:** approval to fetch `PascalPixel/alchemy-gcc` at **641764a5** (a newer commit of the D13 b
  repository, inside Docker into `vendor/alchemy-gcc` or a second checkout; check whether its nested `agbcc` gitlink
  and gcc-2.95.2 pin changed), rebuild the compilers in the volume (`make bootstrap` steps of `tools/build_ref.sh`),
  then `tools/build_ref_tla.sh` → `compare-tla-en: OK` and re-run `tools/ref/make_symbols_tla.py`. GS1's reference
  in `/ref/alchemy` keeps its own 9bc4e65a compilers.

## 3. Symbols (provisional)

`tools/ref/make_symbols_tla.py port_work/tla1/oldcc vendor/alchemy port/symbols` (names, addresses, sizes; no ROM
bytes; the inputs are the near-match build above, in the gitignored port_work/tla1/oldcc):

- `port/symbols/tla-en.tsv`: 29,350 main-image symbols (name, address, size, type, input section, object, lang).
- `port/symbols/tla-en-overlays.tsv`: 14,574 symbols of the 114 scene overlays (linked at 0x02008000).
- `port/symbols/tla-en-census.tsv`: the census below.

Each file's header says PROVISIONAL. Main addresses are exact (same layout as the cart). Overlay addresses are
exact for the 50 identical overlays and expected exact for the rest (order-only differences keep sizes), but that is
not proven until the matching build.

## 4. Census (replaces TLA_PLAN 1.2's estimate)

Bytes of linked sections, by class (definitions in `make_symbols_tla.py`): C = .text of objects built from .c; asm
= the vendor's disassembled listings (recon/tla/raw, the .text.x pieces of the overlay listings), pools included;
hand = handwritten .s in games/tla/src (far-call/import veneers, mixer, kernels); data = everything else with ROM
bytes; the packed overlay stream is counted apart because each overlay is counted from its own map.

| place | C | asm (listings) | hand .s | data |
|---|---|---|---|---|
| main | 253,752 B (2,358 fn) | **628,240 B (525 fn)** | 34,346 B (1,022 symbols) | 13,927,737 B (+ 745,180 overlay stream) |
| overlays (114) | 659,332 B (4,497 fn) | **330,912 B (678 fn)** | 55,992 B (6,999 symbols, mostly veneers) | 331,070 B |
| **all** | **913,084 B (46.5 %)** | **959,152 B (48.9 %)** | 90,338 B (4.6 %) | |

All code: 1,962,634 bytes (libgcc 60). So **about half of TLA's code bytes are still asm (48.9 %)**, at the top of the
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
- `tools/build_ref_tla.sh [fetch|build|all]`.
- `tools/ref/make_symbols_tla.py` (symbols + census).
