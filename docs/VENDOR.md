# Reference projects (vendor/)

Cloned shallow on 2026-11-01 (GS0) into `vendor/<name>`; `tools/vendor_fetch.sh` re-fetches the same commits.
`vendor/` is **gitignored** and read-only for us: never edit it, never push anything to these projects.

| name | upstream | commit (date) | licence | size |
|---|---|---|---|---|
| alchemy | github.com/PascalPixel/alchemy | `24b72a325ea53017e22052eafb4f82cf3ee23ce4` (2026-10-31) | **none** | 203 MB |
| goldensun | github.com/gsret/goldensun | `0fa7b312199c10b96544e825be86cfc476493eb7` (2025-06-04) | **none** | 12 MB |
| goldensun-decomp | github.com/Coaltergeist/goldensun-decomp | `d8f140af2524babf5d4a2bd2123b7df156d8ac84` (2026-10-28) | **none** (ATTRIBUTION.md says it "does not introduce a project-wide license") | 35 MB |

Submodules not fetched: alchemy-gcc (GPL-2.0, 18.7 MB), alchemy-devtools (no licence, 4.9 MB).

## Licences: what we may do

None of the three has a licence file (GitHub API: `license: null`), so default copyright applies: we may read
them and build them locally, but **must not copy their code into this repo**. Our tree holds only our own code
(PC layer, web shell, tools, docs) plus symbol/address tables and hashes. The game C is compiled from
`vendor/alchemy` at the pinned commit, with our changes kept as our own shim headers and replacement files
rather than edited copies (see orchestrator.md, D3). Before any public deploy, ask the user whether to ask
PascalPixel for permission or a licence (a published wasm build distributes compiled alchemy code).

alchemy's own AGENTS.md forbids *its contributors* from using other projects' Golden Sun work (L2); that binds
them, not us, but it means we should not send anything back upstream (we never do anyway).

## ROM bytes in the vendor trees

- **alchemy: ships game-derived assets.** The Broken Seal builds with no ROM, so the repo contains the game's
  pictures (2,118 PNG), music (260 MIDI, 32 WAV), all text (`games/tbs/text/*.po`, 6 languages), maps
  (`map.txt`) and data tables as C/asm. Never copy any of it; never ship the wasm with those assets compiled in.
- goldensun (gsret): code only; data comes from `baserom.gba` at build time (`orig.bin` extracted by the
  Makefile). ~5.5k `.byte/.word` lines of small tables inside code.
- goldensun-decomp: same model as gsret (1,539 `orig.bin` incbins extracted from the base ROM); `data/` is 252 KB
  of hand-maintained assembly.

## Which ROM each targets

All three target **Golden Sun (USA, Europe)**, SHA-1 `5c4695205413df7db52b9a184815a07783999971`, which is the
user's `~/roms/Golden_Sun_USA_Europe.gba` (checked 2026-11-01: 8,388,608 bytes, AGSE01 v0). alchemy also builds
the other five editions (its `rom.sha1`):

| edition | SHA-1 |
|---|---|
| tbs-en (USA, Europe) | 5c4695205413df7db52b9a184815a07783999971 |
| tbs-ja | 35ef9e4c9f38183ebd6a3e3923a11ce9a4333718 |
| tbs-de | c23ab91a39434623cf1a999f387d743ade1a22a6 |
| tbs-es | de0bdc889594b012cad213ca83707feb81ada28b |
| tbs-fr | 42f3b262c16cfc5bde1fa2b25016fb74046de1b3 |
| tbs-it | ca45e04b26b2f040ac63e679a459d21869f5f28d |

## Assessment

### alchemy (PascalPixel) — chosen base

- **Coverage:** The Broken Seal is claimed DONE: all six editions byte-identical from source, no `recon/` left
  for tbs (only The Lost Age is in progress). `games/tbs/src`: 394 C files, ~298k lines; 490 `.s` files, ~31k
  lines, nearly all data tables/asset includes. Handwritten asm limited to ~75 `.arm`/`.thumb_func` routines
  with an `@ Why` proof: IWRAM routines, LZ and 4bpp decompressors, picture/background decoders, the m4a
  mixer and buffer clear, IRQ entry/table, BIOS SWI veneers, trig/dot product, blitters, the entry point.
  167 tagged FAKEMATCH devices; 19 `CAMELOT_ASM` helpers.
- **Toolchain:** alchemy-gcc (GCC 2000-07-31) for game Thumb C, GCC 2.95.2 for ARM C, pret old_agbcc for sound
  and flash, GAS 2.10; `make bootstrap` builds them (needs `arm-none-eabi` binutils, libpng, utf8proc,
  pkg-config, and downloads binutils-2.10 from ftp.gnu.org). `make modern` compiles all tbs C with a current
  `arm-none-eabi-gcc` (`-DMODERN=1`) — the path we build on.
- **Matching:** yes (its claim, checked by its CI from a clean clone). Not verified here yet: needs the toolchain
  approval in HANDOFF.
- **Symbols/structure:** the best of the three by far: modules by credits division (system, gamepak, field,
  battle, battle_effect, window, menu, shop, game, sound, graphics, map, scene, debug), `Module_PascalCase`
  names from evidence, typed structs, extensive per-folder READMEs, `objects.tsv` link order, one linker
  script per edition, overlays as one C file per scene. Link cable code is named and documented
  (`system/system/serial.c`, `battle/battle/link.c`, `battle/battle/turn.c`, `scene/battle_arena.c`).
- **wasm probe (GS0):** `clang --target=wasm32 -fsyntax-only -DMODERN=1 -DTBS_EDITION_EN=1` over the 394 C files
  (with a stub `text/msg_ids.h`): 68 parse clean; most failures come from four headers (`system/dma.h`,
  `system/iwram_call.h`, `system/transform.h` register-asm/inline asm; `field/event.h`), plus GNU
  cast-as-lvalue and a few address-constant initialisers. A shim layer of a handful of headers clears most.

### goldensun-decomp (Coaltergeist)

- Based on gsret's disassembly. Matching decomp of the USA ROM with patched GCC 2.96 (camelot-gcc) + old_agbcc.
- **Coverage (report.json):** 4,394 / 5,794 functions matched (75.8 %), 549,600 / 1,289,450 code bytes (42.6 %),
  313 units, 96 code overlays checked. The rest stays asm.
- Builds a matching ROM (its claim; `make compare`). Good names (FutureFractal's Ghidra annotations).
- Useful as a second opinion on names and on any alchemy function that looks wrong.

### goldensun (gsret)

- Full symbolized disassembly, no C. Data not disassembled; overlays built uncompressed (no matching
  compressor). Needs make + host cc + `arm-none-eabi` binutils.
- Tried with LLVM stand-ins (Homebrew clang integrated assembler, emsdk lld, llvm-objcopy): fails, the
  sources use GAS divided Thumb syntax (`add r3, r1`) that LLVM's assembler rejects. A matching check needs real
  GNU binutils (approval item).
- Useful as the address/label reference and for the overlay layout.

## Choice

**alchemy** is the base: the only one that is entirely C (bar ~75 small proven asm routines), so the browser
port is a straight source port with no ARM interpreter or static recompiler; it has the best names and
documentation, including the link-cable protocol; and its `MODERN=1` path already proves the C compiles with a
current compiler. Risks: no licence (see above), very active upstream (pin the commit, re-pin deliberately),
and its assets must never reach our build or repo.
