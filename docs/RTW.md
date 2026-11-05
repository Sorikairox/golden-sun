# RTW1 (2026-11-05): the retrowser.app build of both games

A build of GS1 and The Lost Age that [retrowser.app](https://retrowser.app) can load from this repository, following
the retrowser standard v1 with the 1.1 additions (`~/Code/retrowser/spec/retrowser-v1.md`, author guide
`spec/guide.md`, skill `skills/retrowser-setup/SKILL.md`). Reference ports: GoldenEye (`~/goldeneye` branch
`web-rtw`) and Conker (`~/conker-wt/web` branch `eu`, `port/web/rtw/`), read only.

## 1. Layout on main

| Path | What |
|---|---|
| `retrowser.json` | GS1's manifest (repo root, so the plain repo link opens GS1); paths relative to the root |
| `retrowser/gs1/gs1.wasm`, `gs1.js` | GS1's module and its Emscripten glue (factory `GoldenSunRtw`) |
| `retrowser/tla/retrowser.json` | The Lost Age's manifest; its paths are relative to `retrowser/tla/` |
| `retrowser/tla/tla.wasm`, `tla.js` | The Lost Age's module and glue (factory `GoldenSunTlaRtw`) |
| `port/rtw/rtw.c` | the `rtw_*` exports over the PC layer (both games; `-DPORT_GAME_TLA` for TLA) |
| `port/rtw/rtw_glue.js` | `--pre-js`: the frame wait in the worker (Module.onFrame), test hook `__rtwGs` |
| `port/rtw/library_rtw.js` | `--js-library`: the host import `rtw_option_changed` (GS1) |
| `port/rtw/gs1.retrowser.json`, `tla.retrowser.json` | manifest templates (no hashes); copied and hashed by the publish script |
| `tools/rtw_build.sh [--game tla]` | the separate rtw target: relinks the web build's objects + port/rtw into `build/rtw/` |
| `tools/rtw_publish.sh [--no-build]` | both rtw targets -> the places above, `rtw.mjs hash` + `check --rom`, leak checks |
| `tests/rtw_e2e.mjs`, `tools/rtw_e2e.sh` | both games in a locally served retrowser host (section 5) |

Links once the repo is on GitHub as Sorikairox/golden-sun (not done: no remote yet, user rule 3): GS1
https://retrowser.app/g/Sorikairox/golden-sun, The Lost Age https://retrowser.app/g/Sorikairox/golden-sun?path=retrowser/tla
(or paste `Sorikairox/golden-sun@main:retrowser/tla`). README.md opens with the "Play on retrowser" badge
(`.github/play-on-retrowser.svg`, from ~/Code/retrowser/brand; outside retrowser/, which the publish script rebuilds). Both share one
sandbox origin (one per repo); saves are keyed by the manifest ids `golden-sun` and `golden-sun-tla`.

## 2. How to rebuild (after every change)

```
tools/web_build.sh && tools/web_build.sh --game tla     # the web builds (the rtw target reuses their objects)
(cd ~/Code/retrowser && npm run build)                  # once: dist/tools/rtw.mjs (the check tool) and the host
tools/rtw_publish.sh                                    # rtw builds, copy, hash, check --rom: RTW_PUBLISH: OK
tools/rtw_e2e.sh                                        # optional: both games in the real host (~8 min)
git add retrowser.json retrowser && git commit          # the build output is committed on main
```

`tools/rtw_build.sh` runs only the link stage of `tools/wasm/build.py` in the same emsdk container with
`PORT_RTW_OUT=/gs/build/rtw`; `link.py` then takes its `rtw_link` branch (compile `port/rtw/rtw.c`, link the same
objects with the rtw flags) **instead of** writing `game.js`/`game.wasm`. The script checks that the web build's
`game.wasm`/`game.js` are byte-identical before and after, and runs the repo's leak check
(`tools/wasm/leak_check.py`) on both rtw files against the game's own ROM. Without `PORT_RTW_OUT` link.py is unchanged.

Link flags = the web build's `LINK_FLAGS` (same memory map D5, ASYNCIFY, function-pointer casts, table/global base)
with `-sENVIRONMENT=worker,node` (worker for the sandbox, node for local smoke runs), `-sEXPORT_NAME=GoldenSunRtw` /
`GoldenSunTlaRtw`, `-sDYNAMIC_EXECUTION=0` (no eval in the sandbox), `--js-library port/web/port_lib.js` (the same frame
driver and soft reset) + `port/rtw/library_rtw.js`, `--pre-js port/rtw/rtw_glue.js`, and the exports of the web
build plus the rtw ones. The glue never fetches the wasm (the host passes `wasmBinary`).

## 3. How the port maps onto the standard

| Standard | This port |
|---|---|
| `module.loop` | `asyncify`: `rtw_start` calls `main()`, which never returns; at each frame end (line 160) `port_frame_ready` (port_lib.js) calls `Module.onFrame` (rtw_glue.js): `port_rtw_frame` (keys, options, picture), then a promise that settles when the next frame is due at 59.7275 Hz on the worker's timer (always through a timer task, so the host's messages run between frames). `rtw_pause(1)` holds that promise. Same shape as the page (port/web/main.js). |
| `video` | `framebuffer`: `rtw_fb` = the renderer's RGBA frame (`Port_FrameBuffer`), 240 x 160, or with GS1's Map zoom 288 x 192 / 336 x 224 on field maps and the World Map (`Port_FrameWidth/Height`; the host scales it into its fixed box). With GBA screen colours or Brightness on, `rtw_fb` is a copy through a 32768-entry LUT (main.js `lcd.build`, ported to C). |
| ROM | `rtw_rom_buffer(size)` = 0x08000000, the identity map's cartridge region (D5), up to 32 MB. `rom.sha1` = the one supported cartridge per game (a wrong ROM gets the host's warning). |
| Input | `rtw_input(0, buttons)`: GBA KEYINPUT bits, active-high, latched into the keypad at each frame end like the page's keys (`Port_SetKeys`). The host's keyboard, gamepads and touch pad all arrive here; no extra buttons. The game's own soft reset (A+B+Select+Start) works. |
| Audio | pull: `rtw_audio_rate` = 32768; `rtw_audio_drain` reads the APU ring (port/pc/apu.c, 16384 frames) into an int16 stereo buffer. |
| Save | native 64 KB flash image at 0x0E000000 (`kind: flash`, `size: 65536`; GBA `.sav` for emulators); `rtw_save_generation` = `Port_FlashGeneration` (bumped on every program/erase); `rtw_save_load` = `Port_KeepFlash` (the image the host copied survives power-on). Saves are build-independent (GS28/TLA9a), so updates keep them. |
| Options | ids = port/pc/options.c rows. GS1: 0 GBA screen colours (bool, 0), 1 Brightness (Normal/Bright/Brighter, 0), 2 Map zoom (Normal/More/Most, 0), 3 Menus while the map is zoomed (Centre/Edges, 1 = Edges, the web default). TLA: 0 and 1 (its renderer has no Map zoom/Menus, as on the page). Host -> `rtw_option` -> `Port_OptSet` (no echo). GS1's in-game Extra settings (START, R) -> `Port_OptGeneration` polled each frame -> `rtw_option_changed(id, value)` (standard 1.1), so the host's menu and stored value follow. |
| `rtw_wheel`, `rtw_rstick`, `rtw_mouse`, `fileInputs` | not used: the web build zooms from its menu and the game's own settings, not by wheel; no camera, no mouse, no files the player hands to the game. |
| `rtw_export_file` | not used: the page lets the player download nothing (saves are exported by the host itself). |
| `rtw_log` | not imported: Emscripten's `print`/`printErr` already go to the host's log (the factory's `print`). |
| Page features the host owns | ROM picker, touch controls, keyboard/gamepad mapping, mute/volume, offline play (the sandbox's own service worker), pause menu, save export/import. "Return to title" = the game's soft reset or the host's restart. |

## 4. What could not be ported

- **The online link battle** (port/web/net.js: WebRTC data channels, room codes, the Netlify room function): the
  sandbox has no network and the host has no netplay yet (standard 4.9 marks net as a draft). No `net` field;
  `Module.linkTransport` is absent, so link.c never connects: the game behaves as with no cable plugged in.
- **The Lost Age's one-"Yes" party transfer from a Golden Sun save** (port/web/transfer.js, TLA9): it runs a second,
  headless GS1 module over the GS1 save that the page keeps in the same origin's IndexedDB. In retrowser each game is
  a separate module and the host gives a game only its own save; the standard's `shares` (save payloads moving between
  games) is not specified far enough to use. The game's own **passwords** still work (GS1's Send, R+Left; TLA's
  password entry), as on the cartridge.
- The page's own "GBA screen colours"/"Brightness" are presentation in the page's canvas; here they are applied in the
  module (same LUT), so the host's screenshots show them too.

## 5. Tests (RTW1)

`tools/rtw_e2e.sh` = `tests/rtw_e2e.mjs gs1` then `tla`: the local retrowser checkout's built dist served in-process
by its Worker handler (`tools/serve-worker.ts`, host `http://localhost:8791`, sandbox `g-<hash>.localhost`), the repo
served by retrowser's GitHub mock from a staged copy of `retrowser.json` + `retrowser/` (what main commits), one muted
headless Chrome. The ROM goes only to the host's file input. Checks:

1. boot: Download, ROM, frames run; logos/title/naming screenshots (TLA's title f380); GS1's title screen with a save;
2. audio: the module drains non-zero samples and the host's worklet plays them (queue ~70-90 ms, 0 underruns);
3. save by real play: the regress routes' keys held by game frame through the glue's test hook (GS1 prologue +
   first_save to f5450; TLA new_game + opening + save to f15300): the host stores the flash and its SHA-1 equals
   tests/regress's (`351e17a2...` GS1 prologue_save, `c8b2e988...` TLA save): the rtw build plays exactly as the node
   runs;
4. input: host keys reach KEYINPUT; GS1 the leader walks a cell; TLA the picture changes;
5. options: host "GBA screen colours" switches the picture to the LUT copy and back; GS1 host "Map zoom" Most gives
   336 x 224; the game's Extra settings (START, R, Map zoom Left) give 288 x 192 and the host's stored value and menu
   show 1 (rtw_option_changed); back to Normal 240 x 160;
6. reload: the module holds the stored save; the route's Continue loads it (GS1: the leader on the saved cell; TLA:
   Jenna's menu, screenshot);
7. offline: page, sandbox frame and workers offline, reload: the game opens from the host's caches and runs, the save
   still there.

Results RTW1: GS1 ALL PASS (18 checks), TLA ALL PASS (15 checks), run one after the other (one Chrome at a time). `rtw.mjs check --rom` OK for both manifests; the
repo's leak check PASS on all four files. Web build unchanged (section 6). Captures: port_work/rtw/e2e (local).

## 6. Web build identity

The rtw target touches no web-build input except link.py's new branch (taken only with `PORT_RTW_OUT`). Before RTW1:
GS1 game.wasm `65515102` / game.js `ba95b828`, TLA `df7c39fb` / `d184cc2a` (SHA-1; site c2b70da683895670, TLA
98bd0dc1a98414c4). After (full `tools/web_build.sh` and `--game tla` rebuilds with RTW1's tree): the same four SHA-1s
and the same site build ids (`BOTH=1 tools/site.sh`); tools/regress.sh every case + link2 OK (run in chunks with
REUSE=1), tools/regress_tla.sh 13/13 OK. The rtw build itself is reproducible (a second publish gave identical files).
