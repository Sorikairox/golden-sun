# RTW1 (2026-11-05): the retrowser.app build of both games (RTW2: GS1 online link battles, section 7)

A build of GS1 and The Lost Age that [retrowser.app](https://retrowser.app) can load from this repository, following
the retrowser standard v1 with the 1.1 and 1.2 additions (`~/Code/retrowser/spec/retrowser-v1.md`, author guide
`spec/guide.md`, skill `skills/retrowser-setup/SKILL.md`). Reference ports: GoldenEye (`~/goldeneye` branch
`web-rtw`) and Conker (`~/conker-wt/web` branch `eu`, `port/web/rtw/`), read only.

## 1. Layout on main

| Path | What |
|---|---|
| `retrowser.json` | GS1's manifest (repo root, so the plain repo link opens GS1); paths relative to the root |
| `retrowser/gs1/gs1.wasm`, `gs1.js` | GS1's module and its Emscripten glue (factory `GoldenSunRtw`) |
| `retrowser/tla/retrowser.json` | The Lost Age's manifest; its paths are relative to `retrowser/tla/` |
| `retrowser/tla/tla.wasm`, `tla.js` | The Lost Age's module and glue (factory `GoldenSunTlaRtw`) |
| `retrowser/gs1/cover.png`, `retrowser/tla/cover.png` | the cartridge pictures (standard 1.2 `picture`, credit "Box art © Nintendo / Camelot · image from libretro-thumbnails"); copied by the publish script from `art/` |
| `art/cover-gs1.png`, `art/cover-tla.png` | source art: the official box art (libretro-thumbnails Nintendo_-_Game_Boy_Advance, Named_Boxarts "Golden Sun (USA, Europe)" / "Golden Sun - The Lost Age (USA, Europe)"), 512 x 512 PNG, approved by the user; outside retrowser/, which the publish script rebuilds |
| `port/rtw/rtw.c` | the `rtw_*` exports over the PC layer (both games; `-DPORT_GAME_TLA` for TLA) |
| `port/rtw/rtw_net.c` | RTW2 (GS1 only, included by rtw.c): online link battles through the host (standard 1.2, section 7) |
| `port/rtw/rtw_glue.js` | `--pre-js`: the frame wait in the worker (Module.onFrame), test hook `__rtwGs` |
| `port/rtw/library_rtw.js` | `--js-library`: the host imports `rtw_option_changed`, `rtw_net_send`, `rtw_net_stat` (GS1) |
| `port/rtw/gs1.retrowser.json`, `tla.retrowser.json` | manifest templates (no hashes); copied and hashed by the publish script |
| `tools/rtw_build.sh [--game tla]` | the separate rtw target: relinks the web build's objects + port/rtw into `build/rtw/` |
| `tools/rtw_publish.sh [--no-build]` | both rtw targets -> the places above, `rtw.mjs hash` + `check --rom`, leak checks |
| `tests/rtw_e2e.mjs`, `tools/rtw_e2e.sh` | both games in a locally served retrowser host (section 5) |
| `tests/rtw_net_e2e.mjs`, `tools/rtw_net_e2e.sh` | RTW2: two players' link battle in the local host with its room server (section 7) |

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
| Options | ids = port/pc/options.c rows. GS1: 0 GBA screen colours (bool, 0), 1 Brightness (Normal/Bright/Brighter, 0), 2 Map zoom (Normal/More/Most, 0), 3 Menus while the map is zoomed (Centre/Edges, 1 = Edges, the web default). TLA: 0 and 1 (its renderer has no Map zoom/Menus, as on the page). **RTW2: all `"inGame": true`** (standard 1.2's options rule, section 8): the host's ☰ shows none; the game's own menu sets them (GS1's Extra settings, START then R -> `Port_OptGeneration` polled each frame; TLA: the module's own Extra settings on L + R + SELECT) and every change goes to the host with `rtw_option_changed(id, value)`; the host hands the stored values back with `rtw_option` at start -> `Port_OptSet` (no echo). |
| `net` (1.2) | GS1: `{ "players": 2, "model": "link" }`, the Battle Arena's link battle (section 7). TLA: none (its online link battle was never built, TLA10). |
| `rtw_wheel`, `rtw_rstick`, `rtw_mouse`, `fileInputs` | not used: the web build zooms from its menu and the game's own settings, not by wheel; no camera, no mouse, no files the player hands to the game. |
| `rtw_export_file` | not used: the page lets the player download nothing (saves are exported by the host itself). |
| `rtw_log` | not imported: Emscripten's `print`/`printErr` already go to the host's log (the factory's `print`). |
| Page features the host owns | ROM picker, touch controls, keyboard/gamepad mapping, mute/volume, offline play (the sandbox's own service worker), pause menu, save export/import. "Return to title" = the game's soft reset or the host's restart. |

## 4. What could not be ported

- ~~The online link battle~~: ported in RTW2 (section 7) for GS1. The Lost Age has none (as on the web page: TLA10
  was never done), so its module has no `net`: link.c never connects there, as with no cable plugged in.
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
5. options (RTW1; RTW2 replaced it, section 8): host "GBA screen colours" switches the picture to the LUT copy and back; GS1 host "Map zoom" Most gives
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

## 7. RTW2 (2026-11-05): online link battles through the host (standard 1.2, model "link")

GS1's manifest says `"net": { "players": 2, "model": "link" }`. The host (retrowser 1.2) owns what port/web/net.js
does on the page: the room and its code, the WebRTC connection, the build/ROM check (net.js `hello`/`refuse`), the
roles (session index 0 = the room host = link parent; net.js's role check), the leave notice (`bye`) and the silence
watchdog (host: peer state 2 "silent" after 3 s, 0 "gone" after 15 s). With model `link` nothing reboots: the session
starts while both games run, each player keeps their own save and options. The web build and its net.js are unchanged.

`port/rtw/rtw_net.c` (GS1 only, `#include`d by rtw.c) is link.c's transport (port/pc/link_transport.h) in C; a C
definition wins over port_lib.js's JS one, so the JS transport is not linked into the rtw module. link.c is unchanged.

| link_transport.h | RTW2 |
|---|---|
| `port_link_connected()` | a session whose peer 1 − me is in state 1, or 2 (silent: it may come back): link.c's own 900-frame hold (`Port_LinkSetFreshFrames(900)` at `rtw_net_session`, net.js `FRESH_FRAMES_ONLINE`) decides when the game sees the link drop, so a network drop of up to ~10 s still resumes a battle, as on the page. State 0 = cable unplugged. |
| `port_link_player_id()` | `me` (0 = parent) |
| `port_link_send(ch)` | `rtw_net_send(1 − me, …)`: link.c's 36-byte frames on channel 0 (unreliable), its bulk messages (≤ 4360 bytes) on channel 1 (reliable, ordered) |
| `port_link_recv(ch)` | pops the queues that `rtw_net_recv` fills (only from peer 1 − me; lengths checked; 16 frames, newest kept, 16 bulks) |

- **Link epoch.** link.c forgets its peer whenever the transport says "not connected" when it looks; at
  `rtw_net_session`, and when the peer comes back (2 → 1) after the game already saw the link drop (link.c silent
  longer than its hold), `port_link_connected()` answers 0 for the next 6 calls (each link.c entry point reaches its
  `ForgetPeerIfDisconnected` within 3), so the next partner's epochs start afresh. A peer back within the hold keeps
  its epoch (the battle resumes).
- **Desync guard in C.** net.js's per-turn hash moved into rtw_net.c: at each change of `gBattleRandomSeed` during a
  battle each side hashes its party unit and the enemy unit (FNV-1a over bytes 15..331 without the side byte) and
  sends `{battle, turn, seed, own, enemy}` on channel 1 behind tag byte 0xA7 (link.c's bulks start with 2). Mine.own =
  theirs.enemy. Mismatches go to the host log (`[net] DESYNC …`); counts are in `port_rtw_net_info`.
- **Nothing resumes the game from the host's calls.** `rtw_net_recv` only queues; link.c drains at the game's VBlank.
  No Asyncify path is added (the worker-stack lesson of the other ports does not apply).
- Host log lines: `[net] linked as player 1 (room host, link parent) …`, `partner not responding …`,
  `the partner answers again`, `partner left …`.
- The Lost Age: no `net` (its online link battle, TLA10, was never built for the page either).

**Tests (tools/rtw_net_e2e.sh, take the shared Chrome lock).** tests/rtw_net_e2e.mjs: two browser contexts in one muted
headless Chrome, the local host (built dist + its room server, host ICE candidates only) and the GitHub mock serving
the staged repo. Each player's host storage gets the web link test's battle save (port_work/g7/flash_battle.sav,
made by tools/link2.sh from the regress routes' prologue save); P1 creates a room, P2 joins with the code, P1 presses
Start; both play tests/routes/link_*.keys (web_link.cjs's routes) shifted to begin right after the session started.
Results: **battle** (whole link battle: 20/20 turn hashes agree on both sides, 0 differ; the same result on both
screens; battles/turns equal; bulks out = bulks in both ways, 12/12; no bad, refused or dropped packets; then P2's
page closes: P1 sees the partner gone (15 s: the host's silence timeout, see host gaps), the game sees the cable
unplugged: SIOCNT SD clear, exchange mask 1, game runs on), **drop** (P2's page closes in the middle of the battle at
battle turn 10: the game ends the battle and returns to the Arena lobby; then a fresh page plays alone at 59.7
frames/s with no session), **leave** (whole battle, then P2 leaves from the host's Online panel: P1 sees it in 0.1 s;
then a second session in the same running games: both Arena lobbies hear each other again, SIOCNT SD set, masks 3/3).
All three ALL PASS.

**Host gaps found (retrowser, not edited):**
1. Closing a player's tab is seen by the other player only after the 15 s silence timeout (state 2 at 3 s, 0 at 15 s),
   also with the page's unload handlers run (`page.close({runBeforeUnload: true})`). Repro: `UNLOAD=1 DROP_AT=3300
   node tests/rtw_net_e2e.mjs OUT` ("partner is gone after 15.0 s"); the Online panel's Leave is seen in 0.1 s.
   Suggested fix: on `pagehide` send the `bye` control message to every peer and close the RTCPeerConnection (what
   Golden Sun's net.js does), so the peers get state 0 at once.
2. After the only other player left (state 0), the remaining player stays in the ended session: the Online panel
   shows "Player 2: left" and only "Leave the session"; Create/Join appear only after Leave. Suggested fix: end the
   session automatically when every other peer is gone (or say so and offer "New room" in the panel).

## 8. RTW2: the options rule (standard 1.2)

The host's ☰ now shows only start-up options (settings that must be applied before the game starts); every other
setting belongs in the game's own menu, declared `"inGame": true` so the host keeps the value the game reports and
passes it back at the next start. Each option was checked against the code:

| Game | Option | Before start? | Now |
|---|---|---|---|
| GS1 | 0 GBA screen colours | no: a LUT on the picture, rebuilt whenever the value changes (rtw.c `present`) | inGame (Extra settings row "Screen colours") |
| GS1 | 1 Brightness | no: the same LUT | inGame (Extra settings "Brightness") |
| GS1 | 2 Map zoom | no: ppu.c reads it at each frame's first line, the field culling follows the frame (options.c, GS29) | inGame (Extra settings "Map zoom") |
| GS1 | 3 Menus while zoomed | no: renderer only, read per frame (GS33) | inGame (Extra settings "Menus") |
| TLA | 0 GBA screen colours | no: the LUT | inGame (the module's Extra settings) |
| TLA | 1 Brightness | no: the LUT | inGame (the module's Extra settings) |

None must be set before the game starts, so the host menu shows no game option for either game; none is dropped.
All are display-only (game memory, saves and link sessions are never affected), so the link model's "each player
keeps their own options" needs no sync.

- **GS1** already had the setting screen in the game (GS27's Extra settings: START on the field, then R; also R in
  Change settings) and rtw.c already reported every change (`Port_OptGeneration` polled each frame ->
  `rtw_option_changed`).
- **The Lost Age** had none (the web page puts its two options in the page's own menu; TLA's Pause menu code is
  unnamed decomp and its objects are shared with the web build, which must stay byte-identical). RTW2 adds
  `port/rtw/rtw_tla_menu.c` (TLA rtw build only): an "Extra settings" menu the module draws over the picture with its
  own 5 x 7 font (no ROM data): **L + R + SELECT** opens/closes it, UP/DOWN pick the row, LEFT/RIGHT/A change the
  value, B closes; the game gets no keys while it is open (it keeps running underneath) and none after it closes
  until all keys are released. Every change calls `rtw_option_changed`. Test hook `port_rtw_menu(k)`.
- tests/rtw_e2e.mjs step 5 now checks: the host menu shows 0 option rows; GS1 Extra settings Screen colours -> the
  LUT picture and the host stores `{"0":1}`, Map zoom Most -> 336 x 224 stored 2, back to Normal stored 0; TLA
  L + R + SELECT opens the menu over the picture with the game's keys held at 0, A -> GBA LCD stored 1, Brightness
  Bright then Normal stored 1 then 0, B closes; after the reload the host hands Screen colours back (the LUT picture
  from the first frame). Results: GS1 ALL PASS (19 checks), TLA ALL PASS (20 checks).
