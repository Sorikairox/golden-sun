# Plan: phases G1..G9

Each phase has exit criteria that a fresh agent can check. Decisions and rules: `orchestrator.md`.
One phase step per session; HANDOFF.md + `docs/progress/sessions.tsv` row at the end of each.

## G1 — Toolchain and address map (done, GS1; see docs/G1.md)

- Build a `golden-sun-tools` Docker image (ubuntu:24.04 + binutils-arm-none-eabi, gcc, make, libpng-dev,
  libutf8proc-dev, pkg-config). Fetch alchemy's `alchemy-gcc` submodule; `make bootstrap`; `make compare-tbs-en`
  with `roms/`/`baserom.gba` pointing at the read-only ROM via a gitignored symlink. Optionally gsret `make compare`.
- Extract `port/symbols/tbs-en.tsv` (symbol, address, size, section, object, code|data) from `out/tbs-en/tbs-en.map`
  and the object list; classify every object as code, code-pointer table, or asset.
- `tools/build_ref.sh` runs it all with compact output.
- **Exit:** `compare-tbs-en: OK`; the symbol table committed (no bytes); counts of code vs data objects recorded.
- Done: `compare-tbs-en: OK` (SHA-1 5c469520..., GS1 addendum), gsret matches, map committed.

## G2 — Compile everything to wasm (link with stubs) (done, GS2; see docs/G2.md)

- `port/shim/` headers (dma, iwram_call, transform, io_reg, irq...) and the override list; lift the nested
  functions; fix cast-as-lvalue sites; namespaced overlays (D7). GS1 started it: 159/166 linked C objects
  compile for wasm32 (`tools/wasm_census.py --compile`); the 7 left are in `port/overrides.tsv`.
- Emscripten build in the local `emscripten/emsdk:4.0.15-arm64` image (`tools/web_build.sh`), identity memory
  map (D5), data symbols bound to ROM addresses (D4), logged stubs for every unresolved symbol and asm routine.
- Leak check: no asset object compiled, and the wasm contains none of a list of ROM strings.
- **Exit:** all tbs-en code objects compile and link to one `.wasm`; stub count reported; leak check passes.

## G3 — Boot to the title screen (done, GS4; see docs/G3.md, docs/G4.md)

- PC layer core: frame driver + fibers (D8), IRQ dispatch (VBlank/HBlank/timers/serial), DMA (immediate,
  VBlank, HBlank, sound FIFO), timers, KEYINPUT, BIOS SWIs in C, the LZ/RL decompressors, flash emulation backed
  by IndexedDB.
- Renderer v1: modes 0-2, sprites, palettes, scanline loop; canvas output.
- Page v1: ROM picker (SHA-1 check, IndexedDB cache), keyboard input.
- **Exit:** in muted headless Chrome the ROM boots through the Nintendo/Camelot logos to the title screen and the
  file menu; captures in `port_work/g3/` match an emulator capture of the same frames by eye.
- GS3: logos -> Golden Sun logo -> File Screen name entry in node and Chrome (no emulator here: compared with the
  vendor's own title assets); the title intro needs a save file (trap 21).
- GS4: **exit met**: a save made in the game (Pause menu, prologue) -> title intro, title, File Screen menu in node
  and Chrome, matching the vendor's `screen.png`/`intro_clouds.png` by eye (docs/G4.md).

## G4 — Playable single player

- Renderer complete: affine sprites/BGs, windows, blending, mosaic, HBlank effects (battle backgrounds,
  transitions, Psynergy effects). Audio: m4a mixer port + DirectSound FIFO -> AudioWorklet + PSG synth.
- New game -> Vale -> first battle -> save -> reload. Per-frame state hash, input recorder/replayer.
- **Touch controls (required, user rule)**: on-screen GBA pad (D-pad, A, B, L, R, Start, Select), portrait and
  landscape layouts, multi-touch, rotation mid-game, touch-usable ROM picker and menus, same input path as
  keyboard/gamepad, setting Auto/On/Off storing only the explicit choice; gamepad API support.
- **Exit:** a recorded e2e run from power-on through the first battle and a save replays with identical hashes;
  phone emulation tests pass (CDP touch, mobile UA, 390x844, 412x915, 844x390, rotation).
- GS9 (docs/G9.md): real play to Garet joining and past the Boulder; no real-play route to a fight yet. Battles with a
  3-member party, Psynergy, Djinn, summons, a defeat, field Psynergy and the World Map run (test-only probes);
  tools/regress.sh replays them with stored digests.

## G5 — First public build

- Deploy to Netlify (private site name until the user decides); fan-project framing, bring-your-own-ROM.
- **Gated (D14):** the user asks alchemy's author for permission or a licence before the first public deploy.
- **Exit:** the deployed site plays on desktop Chrome and on a phone (touch controls), from ROM pick to battle.

## G6 — Local link battle (two instances)

- Two wasm instances in one page wired by an in-memory SIO multiplayer link (registers, serial IRQ, timer 3).
- Battle Arena link battle from both sides with two saves; test harness records both inputs and hashes.
- **Exit:** an e2e replay of a full local link battle (connect, party exchange, 3+ turns, result) is
  deterministic across two runs.
- GS6 survey (docs/LINK.md): the cut is at serial.c's API (Serial_Initialize/PollStatus/ExchangePayloads/
  StartSend/StartReceive/StepBlockTransfer); it proposes wiring the two instances with an in-memory version of the
  G7 message channel instead of register-level SIO (which only tests code G7 replaces). Decided: D21.
- GS7: done in node (tests/link2.cjs, two instances, loopback transport): connect, party exchange, 4 turns, result,
  both sides mirror at every seed change, deterministic across runs (same RAM digests), also under delay/drop/jitter
  (docs/LINK.md section 7). Left for the exit as worded: the same in one page (two instances + recorder), optional.

## G7 — Online link battle (link transport)

- Replace `Serial_ExchangePayloads`/bulk transfers with the link transport (orchestrator section 6, B'):
  WebRTC DataChannels, per-frame payload with "no packet" on gaps, bulk sends whole, widened timeouts (option).
- Signaling: copy-paste codes first, then room codes via a Netlify Function + Blobs (local room server in tests);
  STUN only. Per-turn battle-state hash comparison and desync report. Netsim in page.
- **Exit:** two pages in one muted headless Chrome (still one browser at a time) complete an online link battle via a local room server under `netsim=lat:80,jit:20,loss:2`;
  then one real session across two machines/networks reported by the user.
- GS8: first part of the exit met locally (tests/web_link.cjs, docs/LINK.md section 8): two pages, real WebRTC on
  127.0.0.1, local room server, full link battle with 20/20 turn hashes equal and the same result, clean and under
  netsim lat:80,jit:20,loss:2 (the profile above), 100 ms + 0-20 ms jitter + 10 % frame loss (each way) and 250 ms + 0-30 ms + 10 %. Left: a real session across
  two networks (needs a deployed site: gated on D14).

## G8 — Polish and optional features

- Each one optional, default off, one commit each: e.g. fast-forward, integer scaling, filters, save
  import/export, rematch, spectator. Team trading (file screen transfer) when the user asks.

## G9 — Other editions (only if asked)

- German/French/Spanish/Italian cartridges: per-edition build (`-DTBS_EDITION_DE=1`...) + that edition's
  address map from alchemy; the page picks the build by the ROM's SHA-1.
