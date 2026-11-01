# HANDOFF

Newest session first. Read `orchestrator.md` (rules, decisions, traps) and `docs/PLAN.md` before working.

## GS2 — 2026-11-01: G1 finished (exact match), G2 done

### Done
- **GS1 addendum:** the user approved `pret/agbcc` `da598c1d` and `gcc-2.95.2.tar.gz` (Docker only; D13). The
  fetch step gets both (agbcc into `vendor/agbcc`, the tarball into `vendor/downloads/`, SHA-256 checked against
  alchemy-gcc's pin). **`tools/build_ref.sh` now reports `alchemy tbs-en: 5c4695205413df7db52b9a184815a07783999971
  MATCH`**, 0 bytes differ, and alchemy's own `make compare-tbs-en` prints OK. `port/symbols` regenerated: all
  663 ROM sections check `rom`. The stand-in fit had all 47 cross-referenced addresses right, 35 of 49 offset
  guesses wrong; it stays only as a fallback.
- New symbol tables: `relocs.tsv` (22,517 pointer slots of data symbols and their targets), `absolute.tsv`
  (5,252 ids used as addresses).
- **G2** (details `docs/G2.md`): `tools/web_build.sh` -> all 124 C code objects compile and link into one
  `game.wasm` (1.7 MB, 3.4 KB of data, runs in node); 42 logged stubs (23 asm, 15 Port_*, 4 other) + 300
  veneers; leak check PASS (0 of 1.9 M ROM data windows).
- `port/overrides.tsv` updated: the seven files are handled by build-time transforms and shim macros.

### Next (G3)
1. PC layer core: frame driver with a fiber (Port_BiosHalt yields), IRQ dispatch, DMA (Port_DmaWritten),
   timers, KEYINPUT, BIOS SWIs, the IWRAM routines (Port_Iwram*), the 23 asm stubs by priority of the boot path.
2. `Port_RelocateAll` (fill reloc_* buffers from the ROM, patch slots from relocs.tsv; generate the table in C).
3. Overlay dispatch (entry tables at 0x02008000) and the code-as-data calls.
4. Renderer v1 + page v1 (ROM picker, SHA-1, keyboard); boot in muted headless Chrome (one at a time; check no
   other Chrome is running first).

## GS1 — 2026-11-01: toolchain, reference builds, address map (G1)

### Done
- User decisions recorded in orchestrator.md (D13 downloads, D14 licence/G5 gate, D15 no TURN; D16-D17 this
  session's method). Full write-up: `docs/G1.md`.
- `tools/docker/Dockerfile.tools` -> image `golden-sun-tools` (602 MB, native arm64). `tools/build_ref.sh`
  [image|fetch|bootstrap|alchemy|gsret|symbols|all] runs everything in Docker on volume `golden-sun-ref`
  (vendor read only, ROM mounted read only, outputs in `port_work/g1/`).
- Downloads (approved, in Docker): Ubuntu packages (+ `ca-certificates` for https, same archive);
  alchemy-gcc `9bc4e65a` -> `vendor/alchemy-gcc`; binutils-2.10.tar.gz.
- **gsret `make compare`: OK** (ROM SHA-1 matches; 96 overlays equal).
- **alchemy tbs-en: not yet SHA-1 equal.** `make bootstrap` also needs `pret/agbcc` (alchemy-gcc's nested
  submodule: old_agbcc for the sound and flash libraries) and `gcc-2.95.2.tar.gz` (ftp.gnu.org: three ARM C
  files). Not approved, not fetched. With stand-ins for those two compilers plus a layout fit
  (`tools/ref/standin_fix.py`), the build equals the ROM in every byte except 11,596 (0.14 %), all inside the
  ten objects those compilers build. Cause = missing steps; toolchain version and platform are fine.
- **Address map** `port/symbols/`: tbs-en.tsv (16,744 symbols), tbs-en-overlays.tsv (10,583), sections.tsv
  (1,104), objects.tsv (924: main 50 code / 23 mixed / 542 data / 3 ram; overlays 192 / 96 / 7 / 11),
  code_pointer_tables.tsv (372: 20 main, 352 overlay). 99.18 % of the ROM is in sections: data 84.4 %, code
  6.6 %, overlay streams 6.5 %, music 1.8 %; the rest is bank fill and the 8 MB pad. 649 of 663 ROM sections
  verified byte-identical; 14 are the stand-ins'.
- **wasm census** (`tools/wasm_census.py`): shims in `port/shim/` (prelude forced first; dma, iwram_call,
  transform, mul_q16, FIXED_ADDRESS, return address). Linked C objects: 105 -> 160/166 parse, 159/166 compile to
  wasm objects; all .c: 373/394 compile. Remaining 7 listed in `port/overrides.tsv`.

### Approvals needed (nothing below was downloaded)
1. `https://github.com/pret/agbcc` at `da598c1d918402c42c0c0d7128ba14567f3175e9` (alchemy-gcc's nested
   submodule, used unmodified; GPL). Fetched inside Docker into the volume's alchemy-gcc/agbcc.
2. `https://ftp.gnu.org/gnu/gcc/gcc-2.95.2.tar.gz` (~12 MB, SHA-256 `064e1cb0...7d72482` pinned by
   alchemy-gcc's `arm/Makefile`), fetched by `make -C alchemy-gcc arm` inside Docker.
With both, `tools/build_ref.sh bootstrap alchemy` builds the real compilers (it detects the sources) and should
print `MATCH`; then `tools/build_ref.sh symbols` refreshes the 108 stand-in rows of the address map.

### Next
1. If approved: the two fetches above (adapt `fetch` in build_ref.sh), rerun, expect MATCH.
2. G2: the 7 overrides (nested functions, IWRAM-offset calls, frame.c -> fiber yield), then the emscripten
   link with stubs: identity memory map (D5), data symbols from `port/symbols` (data objects never compiled),
   overlays namespaced (D7), leak check.
3. Notes: `port_work/g1/gen/text/msg_ids.h` comes from the build (ids only); messages.inc stays in the volume.

## GS0 — 2026-11-01: project start (planning, no code)

### Done
- Repo `~/golden-sun` on `main` (no remote: the user decides). README, .gitignore, orchestrator.md, docs/PLAN.md,
  docs/VENDOR.md, this file, `docs/progress/sessions.tsv`.
- `tools/vendor_fetch.sh`: re-clones the three reference projects at their pinned commits into gitignored `vendor/`.
- `tools/check_rom.sh [path]`: size + SHA-1 check of the player's ROM (default `~/roms/Golden_Sun_USA_Europe.gba`).
- Vendor clones (shallow): alchemy `24b72a32`, goldensun (gsret) `0fa7b312`, goldensun-decomp `d8f140af`.
  **None has a licence**; alchemy ships game-derived assets. Assessment and choice (**alchemy**) in docs/VENDOR.md.
- ROM: the user's `~/roms/Golden_Sun_USA_Europe.gba` (444) is No-Intro "Golden Sun (USA, Europe)",
  8,388,608 bytes, SHA-1 `5c4695205413df7db52b9a184815a07783999971`, `AGSE01` v0 — identical to every vendor
  target. **No USA-to-EU mapping needed**; dropped from the plan.
- Link battle protocol read from alchemy and an online design chosen (orchestrator section 6: link transport at
  the serial API over WebRTC; two-instance in-memory link as the test harness).
- wasm probe (scratch only, nothing committed): Homebrew clang `--target=wasm32 -fsyntax-only` over alchemy's 394
  tbs C files: 68 clean; failures concentrated in `system/dma.h`, `system/iwram_call.h`, `system/transform.h`,
  `field/event.h`, ~11-22 nested functions in 8 files, cast-as-lvalue sites.
- gsret build attempt with LLVM stand-ins (in gitignored `port_work/gsret`, wrappers in `port_work/bin`): fails on
  GAS divided Thumb syntax. Needs GNU binutils.

### Environment
- Host: macOS arm64, Apple clang 21 (ARM/Thumb/x86 targets), Homebrew LLVM 23 at `/opt/homebrew/opt/llvm/bin`
  (clang with wasm32+ARM, llvm-mc, llvm-objcopy; no ld.lld), cmake, ninja, make, python 3.9 (`/usr/bin`) and 3.12
  (Homebrew), node 24 (nvm). No arm-none-eabi tools, no emcc on the host.
- Docker: use `/Applications/Docker.app/Contents/Resources/bin/docker` (server 29.4.3);
  `/usr/local/bin/docker` points at a missing OrbStack. Local images: `emscripten/emsdk:4.0.15-arm64` (3.09 GB,
  emcc + lld 22, clang without ARM), `ubuntu:24.04`; Conker/GoldenEye images exist but are theirs.

### Approvals needed (nothing below was downloaded)
1. **GNU binutils for ARM**, either:
   - in Docker (preferred, no system install): `golden-sun-tools` image FROM local `ubuntu:24.04` with
     `apt-get install binutils-arm-none-eabi build-essential pkg-config libpng-dev libutf8proc-dev curl patch git`
     from the Ubuntu archive: roughly 60-90 MB of packages (build-essential is most of it); or
   - on the host: Homebrew `arm-none-eabi-binutils` (~25 MB) + `pkg-config libpng utf8proc` (small) — a system
     install.
2. **alchemy's compiler submodule** `PascalPixel/alchemy-gcc` (GitHub, GPL-2.0, repo ~18.7 MB) — for
   `make bootstrap`/`compare-tbs-en`.
3. **binutils-2.10 source** `https://ftp.gnu.org/gnu/binutils/binutils-2.10.tar.gz` (7.2 MB) — downloaded by
   alchemy's `make bootstrap` (GAS 2.10). Note: its configure uses `--build=i686-unknown-linux-gnu`; may need the
   amd64 platform image under emulation.
4. Optional: `PascalPixel/alchemy-devtools` (no licence, ~4.9 MB, needs Rust) — not needed.
5. Later (G3+): none planned; the renderer/APU are ours. mGBA (MPL-2.0) code reuse only if the user approves.

With 1-3 approved, G1 verifies alchemy's matching build of tbs-en and produces the address map; with 1 alone,
gsret's disassembly can be checked (`make compare`).

### Next (G1)
1. After approval: write `tools/docker/Dockerfile.tools` + `tools/build_ref.sh`; build alchemy tbs-en in
   `port_work/alchemy-build/` (a copy or worktree of vendor/alchemy, never edit vendor), ROM via gitignored symlink
   `roms/tbs-en.gba -> ~/roms/Golden_Sun_USA_Europe.gba`; `make compare-tbs-en`.
2. Generate `port/symbols/tbs-en.tsv` from the map; classify objects (code / code-pointer table / asset).
3. Then G2 (shims + wasm link with stubs).

### Open questions for the user
- Licence: none of the vendor projects has one. OK to build a private port on alchemy? Before any public deploy,
  ask its author?
- TURN server for online (10-20 % of pairs fail without one)?
- Approvals above.
