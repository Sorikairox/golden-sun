# Golden Sun web port: orchestrator

Read this first, then `docs/HANDOFF.md` (latest state) and `docs/PLAN.md` (phases). Section 1 is a status
snapshot to overwrite; the rest is durable. Method reference (read only, never modify): the Conker port
(`~/conker-wt/web/WEB_PORT_ORCHESTRATOR.md`) and the GoldenEye port (`~/goldeneye/orchestrator.md`,
`docs/web/ONLINE.md`).

## 0. Goal

A browser **source port** of Golden Sun (GBA, 2001, "The Broken Seal"): the game's C compiled to wasm, the
GBA's hardware replaced by our own PC layer (PPU, APU, DMA, timers, IRQs, input, flash save, serial link), all
assets read at run time from the player's own ROM, and the **two-player link-cable battle** (Battle Arena)
playable online between two browsers. Scope: Golden Sun 1 only; team trading and The Lost Age later, if ever.

## 1. Status snapshot (overwrite each session)

- GS0 (2026-11-01): repo, vendor clones, assessment, plan. No code yet. Base chosen: **alchemy**.
- User's ROM present and verified: `~/roms/Golden_Sun_USA_Europe.gba`, SHA-1 matches every vendor target.
- Blocked on approvals: GNU arm-none-eabi binutils (+ alchemy bootstrap downloads) for the matching-build
  check and the address map. See HANDOFF "Approvals".

## 2. Standing rules (from the user; apply to every session)

1. **Never modify the ROM.** It lives at `~/roms/Golden_Sun_USA_Europe.gba`, mode 444, read-only. Refer to it by
   path or a gitignored symlink (`port_work/.../baserom.gba`); never copy it into the repo.
2. **Never commit ROM-derived bytes, pictures or captures**: no extracted assets, blobs, screenshots, audio,
   fonts, text dumps. Allowed: our code, tools, symbol/address tables, sizes, hashes, docs. Captures go to the
   gitignored `port_work/`.
3. **Repos stay private.** Nothing is ever pushed to upstream projects (alchemy, gsret, Coaltergeist, pret...).
   No GitHub remote until the user asks.
4. **No `git stash`.** Never `pkill`/`pgrep`; kill only PIDs you started.
5. **Muted headless Chrome, one at a time.**
6. **No system installs without approval** (Docker is OK). Any other download needs approval: report it (source,
   size), don't do it.
7. **Every feature beyond the original game is optional** (a toggle, default off unless the user says otherwise),
   one commit per feature.
8. **If a permission is denied, report the exact command.**
9. **HANDOFF.md at the end of every session** (`docs/HANDOFF.md`), plus one row in `docs/progress/sessions.tsv`.
10. **Small commits on `main`** (or a branch if another session shares the tree).
11. **Always ship touch controls** (user rule 2026-11-01, every web port). Required for the first playable public
    build, not a later feature:
    - Playable on a phone with an on-screen GBA pad: D-pad, A, B, L, R, Start, Select.
    - Portrait: picture on top, controls below. Landscape: controls beside or over the sides.
    - Multi-touch (D-pad + button together, diagonal slides), rotation mid-game without losing state or input.
    - The ROM picker and every page menu usable by touch.
    - The touch pad feeds the **same input path** as keyboard/gamepad, so online sessions and recordings are
      unchanged.
    - Setting **Auto** (on for touch devices) / **On** / **Off**; store only the player's explicit choice.
    - Every page change is tested with real phone emulation before deploy: CDP touch events, mobile UA,
      390x844, 412x915, 844x390, and a rotation.
    - Reference: Conker `port/web/main.js`, `docs/design/PLAYING.md`, WEB_PORT_ORCHESTRATOR.md section 0 (read
      only).
12. Automate repeated command sequences with small scripts in `tools/` (compact output).
13. Keep agent sessions short (one phase step each) and at most 2-3 isolated agents at once.

## 3. The ROM

| | |
|---|---|
| File | `~/roms/Golden_Sun_USA_Europe.gba` (read-only) |
| No-Intro | Golden Sun (USA, Europe) |
| Size | 8,388,608 bytes |
| SHA-1 | `5c4695205413df7db52b9a184815a07783999971` |
| Header | `Golden_Sun_A`, `AGSE01`, version 0 |
| Save | 64 KB flash, 16 sectors of 4 KB |

Check: `tools/check_rom.sh [path]` (prints OK). The web page computes the same SHA-1 and refuses anything else.

**The user's "EU" copy is the same ROM as the USA one.** Golden Sun's English cartridge was a single release for
both regions (No-Intro "USA, Europe"); its SHA-1 equals the target of gsret, Coaltergeist and alchemy (tbs-en).
So there is **no USA-to-EU address mapping** to do (unlike Conker). The other European cartridges are separate
single-language ROMs (German, French, Spanish, Italian; SHA-1s in `docs/VENDOR.md`); alchemy builds all of them
from the same source with edition macros, so supporting one later is a rebuild with `-DTBS_EDITION_DE=1` etc. plus
that edition's address map, not a port. Out of scope until asked.

## 4. Decisions

- **D1 Base: alchemy** (PascalPixel), pinned at `24b72a32`. Fully C for The Broken Seal except ~75 proven asm
  routines; best names and docs; builds byte-identical (claimed); `MODERN=1` path compiles with current GCC.
  gsret = address/label reference; Coaltergeist = second opinion. Details: `docs/VENDOR.md`.
- **D2 Licences:** none of the three has one. We read and build them locally; we never copy their code into
  this repo. Ask the user before any public deploy (permission/licence from alchemy's author).
- **D3 Build from vendor, overlay our layer.** The wasm build compiles `vendor/alchemy/games/tbs/src` at the
  pinned commit with our include directories placed first (`port/shim/` replacing `system/dma.h`,
  `iwram_call.h`, `transform.h`, `io_reg.h`... with PC versions) and our C replacing the ~75 asm routines and
  a few hardware-bound C files. Our repo holds only port code, shims, replacement files and scripts; a
  per-function override list (`port/overrides.tsv`) says which vendor files/functions are replaced and why.
- **D4 Assets from the ROM, code from C.** Any vendor object that is *data* (tables, pictures, text, music,
  maps) is **not** compiled; its symbol is bound to its address in the player's ROM using the address map of a
  matching alchemy tbs-en build (`port/symbols/tbs-en.tsv`: name, address, size; addresses are not ROM bytes).
  Tables that hold **code pointers** stay compiled from C (they are code, not assets); every other data symbol
  comes from the ROM.
- **D5 Identity memory map in wasm linear memory.** Reserve GBA regions at their real addresses: EWRAM
  0x02000000 (256 KB), IWRAM 0x03000000 (32 KB), I/O 0x04000000, palette 0x05000000, VRAM 0x06000000, OAM
  0x07000000, ROM 0x08000000 (8 MB, the player's file), flash 0x0E000000 (64 KB). Emscripten's own stack/heap/data
  stay below 0x02000000. Then ROM data with embedded GBA pointers, fixed addresses (`FIXED_ADDRESS`) and
  `REG_*` macros work unchanged; the PC layer reads I/O registers from 0x04000000. Linear memory ~225 MB
  (`INITIAL_MEMORY=0x0E100000`, no growth). wasm32 pointers are 32-bit like the GBA's, so struct layouts hold.
  Check memory on iOS Safari early (fallback: offset-mapped regions with a pointer relocation at load, as Conker).
- **D6 Asm routines: rewrite in C by hand (the Conker way)**, not an ARM interpreter or static recompiler: there
  are only ~75 and most are standard (BIOS SWIs: CpuSet/CpuFastSet/LZ77/RL/Div/Sqrt/ArcTan/BgAffineSet/
  ObjAffineSet; LZ/4bpp decompressors; m4a mixer; IRQ dispatch; blitters). Each port routine gets a unit test
  against the original's behaviour (run on the ROM's bytes in a test harness, results compared, not committed).
  Unported routines start as logged stubs.
- **D7 Overlays:** the game copies scene code into a shared overlay area. Every overlay is compiled natively
  into the wasm with its symbols namespaced (`-D` prefix or `objcopy --prefix-symbols` per overlay); "load
  overlay N" becomes a pointer swap to overlay N's function table; overlay data still comes from the ROM
  (decompressed into the overlay area as the game does, minus the code).
- **D8 Frame driver:** the browser drives the frame (rAF, 59.73 Hz pacing; GBA frame = 280,896 cycles). The
  game's `wait()`/VBlank wait becomes a fiber yield (emscripten fibers or asyncify-free coroutine) so the game
  loop keeps its shape. VBlank, HBlank and timer IRQ handlers are called by the PC layer at the right scanline.
- **D9 Renderer:** our own scanline software renderer in C (modes 0-2 tile/affine BGs, sprites incl. affine and
  mosaic, windows 0/1/OBJ, alpha/brightness blending), run per scanline so HBlank DMA/IRQ effects (battle
  backgrounds, screen transitions) work; output RGB to a canvas via WebGL2 texture. Write it ourselves from
  GBATEK; mGBA's renderer (MPL-2.0) is a reference only unless the user approves reuse.
- **D10 Audio:** the game's m4a mixer (C in alchemy for most of it; asm mixer core rewritten) produces the
  DirectSound PCM in its buffers; the PC layer feeds FIFO A/B to WebAudio (AudioWorklet), and synthesizes the 4
  PSG channels from SOUND1-4 registers. Timer 0/1-driven sample rate from the registers.
- **D11 Online link battle: link transport, not input lockstep** (see section 6).
- **D12 Toolchain:** host Homebrew LLVM (clang 23, wasm32 target) for probes; builds in Docker with the local
  `emscripten/emsdk:4.0.15-arm64` image (as GoldenEye/Conker). Docker CLI: `/Applications/Docker.app/Contents/
  Resources/bin/docker` (`/usr/local/bin/docker` is a dangling OrbStack link). The matching alchemy build runs in
  a `golden-sun-tools` image (ubuntu:24.04 + binutils-arm-none-eabi, libpng, utf8proc) once approved.

## 5. Method (from Conker/GoldenEye, adapted)

1. Get the address map: build alchemy tbs-en matching (verifies the base and yields `tbs-en.map`).
2. Compile all game C to wasm against shims; link with logged stubs for every missing symbol; count stubs.
3. Boot loop: power-on -> Camelot/Nintendo logos -> title, in muted headless Chrome; captures in `port_work/`.
4. Replace stubs by priority (what the boot path hits first), each with a test.
5. Determinism from day one: no wall clock, no `Math.random`, inputs indexed by frame, save image sandboxed in
   sessions, per-frame state hash (EWRAM + IWRAM + I/O minus scratch) available in debug builds.
6. e2e recordings: the page records input per frame + starting save; headless replay at 10x reports the first
   differing frame/hash and captures.

## 6. Link battle and online play

How the game does it (alchemy `system/system/serial.c`, `battle/battle/link.c`, `battle/battle/turn.c`,
`scene/battle_arena.c`): SIO **multiplayer mode** at 115,200 bps (`RCNT` SIO mode, `SIOCNT` multi, serial IRQ).
The parent clocks halfword transfers from **timer 3** (reload 0xC963, ~20 per frame); each VBlank both consoles
trade a **24-byte payload** (packet number, consoles not yet heard, checksum). Bulk data (parties: 3 x 340-byte
units + a 320-byte Djinn table; turn actions: a 20-byte header + 16 bytes per action) rides inside as numbered
20-byte blocks, resent on a gap (`Serial_StartSend`/`Serial_StartReceive`/`Serial_StepBlockTransfer`). Battles
are **turn-based**: each turn the consoles run a signature handshake (`LinkBattle_WaitSync`, "ex"/"TU"/"rn"/
"EXEC"/"tu"/"RN"), exchange the turn's actions, and the **parent sends the turn's RNG seed** while the child
checks both agree on the next random number. Timeouts: 300 frames per transfer, `LINK_MAX_MISSED_FRAMES` for
link loss, 30 frames for the sync signature.

Options:
- **A. Input lockstep of two full game instances** (Conker/GoldenEye). Each browser runs *both* GBAs (two wasm
  instances wired by an in-memory SIO), and only pad inputs cross the network; every frame waits for both
  inputs. Correct by construction, but costs 2x CPU, needs both saves on both sides, adds input delay to every
  menu and walk in the Arena, and stalls the whole game on any jitter.
- **B. SIO emulation over WebRTC** (raw halfwords). Multiplayer SIO is a synchronous ~20-transfers-per-frame
  exchange; over a network with 30-150 ms RTT every transfer would stall. Not viable at the register level.
- **B'. Link transport at the game's serial API (recommended).** A source port can replace the layer above the
  registers: `Serial_ExchangePayloads` (per-VBlank 24-byte payload) and the bulk `Serial_StartSend/Receive`
  become a transport over a WebRTC DataChannel. Each player runs only their own GBA. Per frame we deliver the
  newest peer payload if one arrived, else "no packet" (the game already tolerates missed frames and resends
  blocks); bulk transfers are sent whole (one reliable message) and delivered to the game block by block, so a
  party transfer costs ~1 RTT instead of 67 round trips. Since battles are turn-based and the game already
  carries the seed and a random-number check each turn, a turn costs ~1-2 RTT of waiting at "EXEC" and nothing
  else; menus and animations run at full local speed with zero input delay. We widen the game's frame-based
  timeouts in online mode (optional setting, documented) so a 150 ms RTT never trips the 30-frame sync window.
  Desync guard: hash the battle state (units, seed) after each turn and compare over the control channel.

Decision: **B'** for play; keep **A** (two instances in one page, in-memory link) as the **offline test
harness** for link battles and e2e replays, where determinism is exact. Transport/signaling as Conker: WebRTC
DataChannels, room codes via a Netlify Function + Netlify Blobs, copy-paste fallback, STUN only (no TURN unless
the user decides), local room server for tests, in-page netsim (`?netsim=lat:MS,jit:MS,loss:PCT`).

## 7. Traps (add as found)

1. `/usr/local/bin/docker` is a dangling OrbStack symlink; use the Docker.app path (D12).
2. zsh does not word-split `$VAR`; run multi-flag loops under `bash -c` or use arrays.
3. LLVM's assembler rejects GAS divided Thumb syntax (gsret sources); matching builds need GNU binutils.
4. alchemy's `text/msg_ids.h` is generated from `en.po` by its `po2ags` tool; a probe stub can be built from the
   `msgctxt`/`msgid` pairs (do not commit it: message ids are fine, but keep generators in scripts, not output).
5. alchemy is updated daily; never re-pin casually: a re-pin changes names and the address map.
6. alchemy ships the game's assets; a careless `-I`/glob in our build could compile them in. The build must
   compile only objects listed as code in `port/symbols/objects.tsv`, and a CI check greps the wasm for known
   ROM strings to prove no asset leaked.
7. Overlays share addresses and symbol names across scenes; namespacing is mandatory (D7).
8. GNU C89 extensions (cast as lvalue, nested functions: `turn.c` defines functions inside functions) are not
   all supported by clang; the shim must rewrite or patch them. Nested functions: ~11-22 in 8 files (turn.c,
   action.c, enemy_ai.c, playback.c, particle_streams.c, battle_djinn_preview.c, battle_party_commands.c,
   windows.c) need hand-lifted replacements (D3 override list).
