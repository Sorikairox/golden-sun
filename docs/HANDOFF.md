# HANDOFF

Newest session first. Read `orchestrator.md` (rules, decisions, traps) and `docs/PLAN.md` before working.

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
