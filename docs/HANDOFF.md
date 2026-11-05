# HANDOFF

Newest session first. Read `orchestrator.md` (rules, decisions, traps) and `docs/PLAN.md` before working.

## RTW2 — 2026-11-05: retrowser standard 1.2 (GS1 online link battles; options rule)

- Read docs/RTW.md sections 7-8 and orchestrator D25. On `main` (f8d4f4e link battles, 0a49081 options rule, then
  docs), **not deployed, not pushed, no remote**.
- Link battles (GS1 only; TLA has no online link battle, TLA10): manifest `net {players 2, model link}`;
  port/rtw/rtw_net.c = link.c's transport over rtw_net_send/recv (frames ch 0, bulks ch 1), player id = me (0 = room
  host = parent), connected = peer state 1 or 2 (link.c's 900-frame hold), epoch reset at rtw_net_session and on a
  comeback after the game saw the link drop, per-turn hash on ch 1 (tag 0xA7). Nothing resumes the game from
  rtw_net_recv (queues only).
- Options rule: all 6 options are display-only and live-changeable -> `"inGame": true`, host ☰ shows none, none
  dropped. GS1: its Extra settings (START, R). TLA: new module-drawn Extra settings (L + R + SELECT; rtw only).
- Tests: tools/rtw_net_e2e.sh (under the shared Chrome lock; ~2 min per run): battle (20/20 hashes both sides, same
  result, bulks 12/12, then tab close -> cable unplugged), drop (mid-battle tab close -> battle ends, lobby; solo
  59.7 fps), leave (Online panel Leave seen in 0.1 s; second session relinks both lobbies) ALL PASS; tools/rtw_e2e.sh
  GS1 19/19, TLA 20/20 (new options checks + offline); rtw_publish OK (GS1 e191ff715f283489, TLA 91d6a459f1d67ca1);
  web byte-identical (GS1 65515102/ba95b828 site c2b70da683895670, TLA df7c39fb/d184cc2a 98bd0dc1a98414c4);
  regress.sh all 67 cases + link2 OK (5 chunks + kolima_grind alone, REUSE=1), regress_tla 13/13.
- Host gaps (retrowser, not edited; RTW.md section 7): a closed tab is seen only after the 15 s silence timeout (no
  bye on pagehide); after the partner left, the remaining player stays in the ended session until Leave.
- Next: user pushes to GitHub; real two-network session on retrowser.app; TLA10 (TLA link battle) if wanted; a test of
  the silent -> back path (needs a way to stall one peer's channel in the host).

## RTW1 — 2026-11-05: retrowser.app build of GS1 and The Lost Age

- Read docs/RTW.md and orchestrator D24. On `main`, **not deployed, not pushed, no remote** (README's links assume
  GitHub `Sorikairox/golden-sun`).
- Published on main: `retrowser.json` (GS1, root; files `retrowser/gs1/gs1.{wasm,js}`), `retrowser/tla/retrowser.json`
  (+ `tla.{wasm,js}`); retrowser standard 1.1, loop asyncify, framebuffer, native 64 KB flash save, options (GS1: GBA
  screen colours, Brightness, Map zoom, Menus; TLA: the first two), GS1's in-game Extra settings -> rtw_option_changed.
  Build ids GS1 dcf975b85ce47033, TLA 55b6e0b2d4960e21. Not ported: online link battles (no host netplay), TLA's
  party transfer from a GS1 save (needs a second module + the other game's save); passwords still work.
- Code: port/rtw/ (rtw.c, rtw_glue.js, library_rtw.js, manifest templates); link.py `rtw_link` branch taken only with
  PORT_RTW_OUT; tools/rtw_build.sh (one game, link stage only, ~15-40 s), **tools/rtw_publish.sh** (both + hash +
  `rtw.mjs check --rom`), tests/rtw_e2e.mjs + tools/rtw_e2e.sh. deploy_web.sh / regress.sh / regress_tla.sh mention it.
  README opens with the "Play on retrowser" badge (.github/play-on-retrowser.svg) and play instructions.
- Rebuild after every game change: `tools/web_build.sh && tools/web_build.sh --game tla && tools/rtw_publish.sh`,
  commit `retrowser.json retrowser/`. The check tool is ~/Code/retrowser/dist/tools/rtw.mjs (`npm run build` there).
- Tests: rtw.mjs check --rom OK (both), leak_check PASS (4 files); tests/rtw_e2e.mjs in a local retrowser host (one
  muted headless Chrome at a time): GS1 18/18, TLA 15/15 (boot, audio, an in-game save by real play whose SHA-1 =
  tests/regress's 351e17a2 / c8b2e988, keys, options both ways, reload + Continue, offline reload). Web build
  byte-identical after full rebuilds: GS1 65515102 / ba95b828 (site c2b70da683895670), TLA df7c39fb / d184cc2a
  (98bd0dc1a98414c4); regress.sh all cases + link2 OK (chunked, REUSE=1), regress_tla 13/13 OK.
- Process note: the tool's 10-minute limit moved one long `tools/regress.sh` into the background and it was killed;
  run the full regress in chunks of case names (REUSE=1) in the foreground, each under 10 minutes.
- Next: push to GitHub (user) and open the links on retrowser.app; then real-device checks (phone touch, gamepad).

## GS34 — 2026-11-05: bug fix: full-screen menus showed borrowed tiles as the map in the zoomed margins

- Read docs/GS34.md and trap 97. On `main` (8442a83 margins, ae64e65 parked sprites, 374ff7f Djinn figures, then
  expected.tsv + docs), **not deployed, not pushed**.
- Cause: the Status screen (also Djinn/Item, World Map Status/Djinn) covers the GBA screen with windows and overwrites
  BG palettes 0-1 + 8 KB of char block 1 under them (registers and tilemaps unchanged, so GS29's map-layer check
  passed); the margins drew the map grid with those borrowed bytes.
- Fix (ppu.c GS1 half): covered frames (window layer opaque over the GBA screen, checked at line 0 from VRAM) draw the
  margins' map layers from the last uncovered zoomed frame's BG VRAM + palette (black if none); GBA view unchanged
  unless Edges lays windows out. Also: menu sprites parked off the GBA screen are not drawn in the margins; the Status
  screen's Djinn figures (depth 255) move with their window. Normal never runs it.
- Tests: regress masked vs 2e11d4d0 577/588 (link2's own row; zoom_menus_field f2180/f2400/f2600 pictures: the fix;
  new cases' rows); new probe tests/probes/margins.cjs + cases zoom_menus_status (Most, Edges) / zoom_menus_status_more
  (More, Centre): fail on the base build, pass now; expected.tsv rewritten (533 RAM rows + link2, 3 pictures = the
  fix, 0 saves, 8 new rows), --quick OK; web_opts --worldmap ALL PASS (51), web_phone
  zoom 0/1/2 + plain ALL PASS, web_offline/web_touch/web_link/web_transfer PASS.
- Builds: GS1 65515102 / ba95b828 (site c2b70da683895670); TLA df7c39fb / d184cc2a unchanged.
- Contact sheet: port_work/gs34/sheet/sheet.png (local). Next: deploy when the user says so.

## GS33 — 2026-11-05: "Menus: Edges": windows pinned to the zoomed picture's edges

- Read docs/GS33.md and traps 95-96. On `main` (d92eb27 feature, a719675 expected.tsv + docs), **not deployed, not pushed**.
- User report: at Map zoom Most near a map's top edge the field menu's status window floated mid-picture (windows are
  drawn in the GBA's 240 x 160 inside the frame). User's choice "Pin to edges". New option **Menus: Centre / Edges**
  (Extra settings row 4, page select gs-menus; default Edges as asked): at More/Most (field maps and the World Map)
  each window with its sprites moves to the frame edge it is near: per-axis groups of touching windows; one edge touched
  -> that edge, both -> centre, else by half (spanning the middle -> centre); a group keeps its oldest window's anchor.
- Renderer only (ppu.c GS1 half): window rectangles from gWindowWork (VBlank + windows opened since: their text goes
  straight to VRAM, trap 95); menu sprites by source (oam_kernel.c tags each entry: window sprites, menu heap slots,
  C locals, the menus' party members at depth 251 inside a window). Map/actors never move (pixel check: 0 pixels outside
  the menus differ, Edges vs Centre). Work arrays static (trap 96).
- Tests: regress masked vs 1dd5c2e8 566/580 (link2's row + the new zoom_menus_* rows); new cases zoom_menus_field (Kolima
  Forest entrance at the top edge: field menu, Psynergy/Djinn/Item/Status, Pause, Extra settings, World Map menu) and
  zoom_menus_shop (Imil dialogues + item shop) with tests/probes/menujitter.cjs: 0 jumps; zoom_edges_* 0 reversals;
  expected.tsv RAM rows rewritten (0 pictures, 0 saves), --quick OK; web_opts --worldmap ALL PASS (51), web_phone zoom
  0/1/2 + plain ALL PASS, web_offline/web_touch/web_link/web_transfer PASS.
- Builds: GS1 2e11d4d0 / ac048173 (site de3551885fbd8107); TLA df7c39fb / d184cc2a unchanged.
- Contact sheet: port_work/gs33/sheet/sheet.png (local). Seen, not fixed: the Status screen's zoomed margins show wrong
  tiles (GS29's, GS33.md 5).
- Next: deploy when the user says so; the user may want to judge dialogues pinned away from their speakers.

## GS32 — 2026-11-04: merge GS31 (Map zoom edge jitter fix) with GS30 (World Map zoom)

- Read docs/GS32.md. On `main` (merge 80b89c7, expected.tsv dce7d1d + docs), **not deployed, not pushed**.
- ppu.c merged without conflict (GS30's wm_* block + GS31's VBlank camera snapshot); the World Map path does no
  camera-based placement at line 0 (wm_scan's line-0 reads are validity checks, consistent with the RAM they check).
  GS31's traps renumbered to 93-94.
- Tests: regress full masked vs GS30's b13e7532 563/565 (link2's own row; zoom_edges_most f2700, GS30 lacks the fix);
  expected.tsv RAM rows rewritten (0 pictures, 0 saves changed), --quick OK; zoom_edges_most/more 0 reversals; jitter
  probe on World Map routes at More/Most 0 reversals (one probe match across a map cut on bilibin, same on GS31's
  build); web_opts --worldmap, web_phone zoom 0/1/2 + plain, web_offline, web_touch, web_link, web_transfer PASS.
- Builds: GS1 1dd5c2e8 / 13f7526d (site c413992211ebfe9b); TLA df7c39fb / d184cc2a unchanged.
- GS31 worktree removed, branch deleted. Next: deploy when the user says so.

## GS31 — 2026-11-04: Map zoom's picture jittered at map edges (bug fix, worktree branch)

- Read docs/GS31.md and traps 93-94 (renumbered by GS32). Branch `worktree-agent-a4be33ad62c902936` (aac4389 + docs),
  merged into main by GS32, not deployed. GS30 (World Map zoom) works in ppu.c on main at the same time: merge by hand (GS31.md 7).
- Cause: zoom_frame read the GBA camera at line 0, one frame ahead of the BG registers (VBlank copies gBgScroll, then
  the game's logic moves the camera); held at a map's edge the picture stepped a pixel and back. Fix: snapshot the camera
  in the GS1 Port_PpuVBlank. Normal and TLA unchanged.
- Tests: new probe tests/probes/zoomjitter.cjs + regress cases zoom_edges_most / zoom_edges_more (fail on 43130de1,
  pass now); regress full masked vs 43130de1 563/565 (link2's own row, one zoomed picture of the new case);
  expected.tsv RAM rows rewritten; web_opts, web_phone zoom 0/1/2, web_offline, web_touch, web_link PASS; TLA
  df7c39fb / d184cc2a identical.
- Builds: GS1 e5758f47 / 13f7526d (site 6bdeaf7f10220d1e).
- Next: merge with GS30, rerun regress --update (RAM rows), deploy when the user says so.

## GS30 — 2026-11-04: Map zoom on GS1's World Map

- Read docs/GS30.md and trap 92. On `main` (fc337a4, b8473a3, a1f42b4 + docs), **not deployed, not pushed**.
- Phase 1 (feasibility): the World Map is mode 2, BG2/BG3 affine 512 px wrapping, per-line PA/PC/X/Y by HBlank DMA 0,
  reference points absolute; RAM holds a 1024 x 1024-unit block of world tiles around the party and the BG maps the
  same toroid, far beyond the GBA's view (and the margins'); every line term is a + b / (line - h): feasible in the
  renderer without game changes.
- Built (ppu.c GS1 branch, own `wm_*` block; one c_rules row pair): at More/Most the moving view is 288 x 192 / 336 x
  224, GBA lines centred (no GS29 clamp, so nothing moves when the camera stops); margins truthful (black where the
  game has not loaded the ground: seen only with L held at Most); menus/events keep the last moving frame's ground in
  the margins; R's world picture, battles and other screens stay 240 x 160; actors in the margins projected
  (Render_PlaceProjectedSprite bounds + gPortZoom*).
- Tests: GBA view equal to Normal in 516/522 frames (6: an actor animated a step ahead after crossing the margins);
  regress full masked vs 43130de1 549/550 (link2's own row), expected.tsv RAM rows rewritten, --quick OK; web_opts
  --worldmap (new) + GS29 steps ALL PASS (canvas + touch boxes across World Map, menu, world picture, levels);
  web_phone zoom 0/1/2 ALL PASS, boxes identical; web_offline/web_touch/web_link PASS; TLA rebuilt df7c39fb / d184cc2a
  unchanged, web_transfer ALL PASS.
- Builds: GS1 b13e7532 / 13f7526d (site b6c0cf6796471d30). Contact sheet: port_work/gs30/sheet/sheet.png (local).
- GS31 (other agent) fixes GS29's field-map edge jitter in zoom_offset; the World Map path does not use it.
- Next: merge with GS31; deploy when the user says so.

## GS29 — 2026-11-04: Map zoom (3:2, nothing on the page moves) replaces Wide view; our floating heading removed

- Read docs/GS29.md and traps 89-91. On `main` (1efad3f, c6b8b35, 54edecb, 941426a, e434de5 + docs), **not deployed**.
- **Map zoom** (option, default Normal; in-game Extra settings row and page select, gs-zoom; gs-wide=1 migrates to 1):
  field maps at 288 x 192 or 336 x 224 (3:2, whole tiles), scaled by the page into the same 3:2 box; battles, World Map,
  title, File Screen stay 240 x 160 and fill the box. Margins down and across from the map grid; the GBA's view is placed
  so the frame stays inside the map's camera bounds (camera itself unchanged); culling via gPortZoomL/R/T/B (0 at
  Normal). Page: frame x whole factor, smoothed into the box (sharp bilinear).
- **Heading**: the bobbing "Settings" tab on our Extra settings screen was ours (MenuTitle_Create in options.c):
  removed. GS1's own Change settings (and Pause menu) draw theirs: kept. "R: More" is an ordinary window, not floating.
- Tests: regress full masked vs 6d08d4c8 549/550 (link2's own row), then all OK vs the rewritten expected.tsv;
  web_opts ALL PASS (levels, sync, migration, canvas + touch boxes across levels / a battle / an interior), web_phone
  --flash --query zoom=0/1/2 ALL PASS with identical boxes, web_offline/web_touch/web_link PASS; TLA rebuilt df7c39fb /
  d184cc2a unchanged, web_transfer + TLA page offline/phone ALL PASS. tools/regress_cmp.sh for two-build masked runs.
- Builds: GS1 43130de1 / 13f7526d (site 1d2a4fb6f65558c0). Contact sheet: port_work/gs29/sheet/sheet.png (local).
- Next: deploy when the user says so.

## TLA9 — 2026-11-04: "only say Yes": the party from Golden Sun with one press (branch tla9)

- Read docs/TLA9.md and traps 87-88. Worktree ~/golden-sun-wt/tla9, branch `tla9` (4 commits on ac16be5 + docs),
  **not merged, not deployed**.
- TLA page: with a GS1 ROM + a cleared GS1 save in IndexedDB, Yes to "Transfer data from Golden Sun?" -> TLA's own
  cable import with no other menu. port/web/transfer.js (headless GS1 instance runs GS1's Save_* routines through
  Port_CallCode4 at its first frame, before the TLA module exists; virtual GS1 partner on TLA's link transport);
  port/tla/hw/pc_tla.c + c_rules on Func_0804d7fc (Transfer Method -> Link cable, one-shot, when armed);
  option "Bring party from Golden Sun" (tla-gs1party, default on) injected into TLA's page by tools/site.sh; TLA's
  service worker keeps GS1's ../game.js/../game.wasm. Several cleared files: the longest play time, no chooser.
- Tests: tests/web_transfer.cjs ALL PASS (auto = route (a)'s units 14648e8f916d / flags 6ffcc5c1ef6b; option off and
  no save -> the menu; phone touch A; offline), tests/transfer_pick.cjs 8/8. regress_tla masked = 2ee38c9f in all 13
  cases (RAM rows rewritten), transfer_pw --twice OK, calls/K&R/leak PASS; GS1 clean rebuild 6d08d4c8 / cab9b56b
  unchanged; GS1 page web_opts/web_phone/web_offline/web_link PASS; TLA page web_offline/web_phone PASS.
- Builds: TLA df7c39fb / d184cc2a (site 98bd0dc1a98414c4); GS1 e48c5ad1fd47a302.
- Next: merge tla9 into main (coordinator); deploy when the user says so; the review screen after the import is left
  with B (the cartridge's own screen).

## TLA9a — 2026-11-04: integration: gs1-options merged, GS1 bulk limit, TLA build-independent saves

- Read docs/TLA9a.md and traps 82, 85, 86.
- **Merge** fdbbbfb (gs1-options -> main, merge commit): conflicts only in docs (both kept; the branch's traps 77-79
  renumbered 83-85 with their references). Worktree ~/golden-sun-wt/gs1-opts removed (clean), branch kept. Live build
  687968a7 copied to port_work/live_687968a7/ (migration tests); port/pc/save_legacy.h kept.
- **GS1 link.c BULK_MAX 4352** (both games, one define): wire format unchanged (u32 size in the bulk header; battles
  <= 340 bytes). Route (a) now completes: GS1's 4100 bytes -> TLA, 52/52 PASS, units 14648e8f916d / flags 6ffcc5c1ef6b
  equal to the --virtual run; tools/transfer_pw.sh route_a runs it to the check.
- **TLA saves build-independent**: gSnapshotObjects in GBA spelling (c_rules on ObjectTable_Snapshot; new asm2c port
  hooks, port/tla/a2c_hooks.tsv, around the raw restore Func_080cae5c). Padded-layout test build: saves byte-identical
  (tests/probes/tla_snapshot.cjs + tests/routes/tla/save2.keys); the pre-fix build saves raw buffer/index words.
- Expected digests rewritten, RAM rows only, each against a masked comparison with the previous build: expected.tsv
  (GS1 data +0xa00 from link.c's buffers; saves/pictures/masked all equal vs 087d3b7e), expected_tla.tsv (vs eade7bef),
  expected_transfer.tsv (route_a fixed, cleared save from a GS28-built source, TLA RAM).
- All checks green (table in TLA9a.md 4). GS1 6d08d4c8 / cab9b56b (site e48c5ad1fd47a302), TLA 2ee38c9f / 8c87348c
  (dc1a9a3baba11a67). `tools/deploy_web.sh --dry-run` OK. **Not deployed** (the merge, Wide view and the bulk change
  reach players only with the next deploy; live saves migrate, tested).
- Next: deploy when the user says so (TLA's 20 MB wasm note stands); TLA9: the page's transfer (GS1 export, stand-in
  on TLA's transport, the option), per docs/TLA8.md 8.

## TLA8b — 2026-11-04: the games' own transfer by hand (passwords, TLA link layer, route (a) stopped at GS1's bulk limit)

- Read docs/TLA8.md and traps 80-82. One command: `tools/transfer_pw.sh [--twice]` (~30 s; needs
  port_work/regress/ml_saturos_win.sav).
- Cleared GS1 save (test only, 6.1 as approved): ml_saturos_win continued, warp probe to the File Screen at
  FILE_SCREEN_FROM_TITLE, Yes, file 2 -> sendFlag set by Save_ToChosenFile (port_work/tla8/gs1_clear.sav, SHA-1 565fd2ec6264).
- GS1's hidden Send by keys (R+Left while the menu is built); Gold/Silver/Bronze passwords read off GS1's screen
  (tests/probes/password.cjs: the buffer is on the wasm stack, trap 80), typed into TLA's grid by keys
  (tools/pw2keys.cjs): all accepted; tests/probes/transfer_check.cjs vs the vendor's rules: Gold 63/63, Silver 67/67,
  Bronze 43/43 PASS. The clear flow saves and restores the whole state around the entry; Func_080ae410 keeps units
  0-3, flags 0x800/0x820 (0x822 toggled), coins to work+0x28c (TLA8.md 4).
- TLA link layer: port/pc/link.c at TLA's serial API (fn_overrides + pc_binds `replace`, hw2c skips those two raw
  routines); GS1's link.c IR identical, GS1 build unchanged.
- **Route (a)** (`node tests/transfer_a.cjs`): greetings meet ("0000"/"UVTS"), GS1 sends at f2105 but **GS1's link.c
  BULK_MAX 4096 < 4100 puts 0 bytes on the wire** and TLA imports its stale buffer (garbage member). Needs a GS1 change
  (BULK_MAX >= 4100, new GS1 game.wasm): **not made, reported**. `--virtual`: a stand-in with GS1's own 4100 bytes ->
  TLA receives them, cable checks 52/52 PASS (Isaac/Ivan arrive down, as in the save).
- Determinism: every route twice identical (digests in tests/regress/expected_transfer.tsv).
- TLA save pointers (read only): yes, same mechanism as GS1 (GS1: gActorSnapshot.actors[i].script = 0x88d4c, a
  relocated script): TLA's saved gSnapshotObjects (0x02001024, 32 x 0x80) .script (+0) and .update (+0x6c) can hold
  module addresses / table indices; none in today's TLA save. Not fixed.
- Checks: build calls/short K&R PASS, leak 0; D20 batch 219/0/986; diff_tla 30/30 neg 4/4; diff_hw 124/0/64 neg 4/4;
  diff_mixer 300; diff_blitter 160/4800; test_arm 79/79; masked RAM + pictures of the 64,200-frame TLA route equal to
  the previous build; expected_tla.tsv RAM rows rewritten (pictures/save unchanged), regress_tla 13/13; GS1
  687968a7 / 895d45cc, regress --quick 9/9. TLA build 4ee60983 / 17dd6895. Not deployed.
- Local only: port_work/tla8/contact.png, port_work/tla8/ (save, passwords, keys, dumps, shots).
- **Next (TLA9):** the user's go-ahead for GS1's BULK_MAX >= 4100 (GS1 rebuild), then route (a) to the end and
  compare with `--virtual`; then the page side (export, stand-in partner, Transfer Method hook, option, file choice).

## TLA8 — 2026-11-04: scene 7's vines; Felix on Idejima; the World Map; combined deploy script (dry run)

- Read docs/TLA6.md sections 18-22 and traps 78-79.
- Scene 7 was not a port bug: trigger 21 always turns back; the way down is two vines (cell byte 3 = 0x40) at (34,54)
  and (33,56), then UP into the cave mouth (layer 1, trigger 5).
- Real play (regress_tla 13 cases, new cave/idejima/party/worldmap): third Ruffian battle won, scene 8's cave (Punch
  Ant won), the island adrift, **Felix under control on Idejima**, Kraden/Jenna/Sheba join, Alex's departure, **the
  World Map** (scene 2, ~63,860).
- Func_08173aac: 4 capture inputs (Gasp/Reflux/DjinnCounter/CounterRush variants forced into Fume's slot in a temporary
  capture build) -> D20 EQUIV 4 cases (r0 is a wasm data address: TLA6.md 20).
- tools/deploy_web.sh: combined site (GS1 /, TLA /tla/), TLA leak check (PORT_GAME=tla), tla/ allowlist, /tla/ headers,
  live checks, `--dry-run` -> DEPLOY_DRY_RUN: OK. NOT deployed. User: `tools/deploy_web.sh`. TLA's 21.8 MB game.wasm is
  above Netlify's recommended 10 MB per file (no documented hard limit).
- Checks: regress_tla 13/13; GS1 687968a7 / 895d45cc, regress --quick 9/9, web_offline + web_phone ALL PASS; TLA page
  offline ALL PASS; TLA build unchanged (eade7bef / 3a44f9e0).
- Local only: port_work/tla8/contact.png, port_work/tla8/captures.
- Next: World Map to Daila; full D20 batch with the new captures; the user's deploy + live /tla/ check.

## TLA7 — 2026-11-04: the battle blitters; the first two battles won; short K&R calls

- Read docs/TLA6.md sections 14-17 and traps 75, 77.
- Real play (node, tools/regress_tla.sh 9 cases): the first battle **won** with Fight -> Psynergy -> Fume (and with
  Fight/Attack) -> Suhalla Gate (scene 6) -> its ledges -> "Waahhh! It's them!" -> **second Ruffian battle won** ->
  scene 7's mountain path (31,480). Stop: scene 7's trigger 5 (38, 57) is entered from the lower ground; the way down
  from the 128 px path was not found (TLA6.md 14 has the map layout to read it).
- Fixed: heap blocks drop code aliases when handed out fresh (TLA c_rules on HeapSlot_Alloc/AllocEwram; trap 20);
  battle effect blitters: Func_08196404 bound to Port_TlaBuildBlitter (translation, then GS1's C blitter aliased,
  TLA mode map; port/tla/hw/pc_binds.tsv), proven by tests/arm/tla/diff_blitter.cjs (ROM builder + its ARM in the
  interpreter: 160 builds + 4,800 draws EQUIV, negative 80/80); 11 short K&R calls given their words (c_rules, each read
  in the reference ELF); 5 kept with reasons in port/tla/short_knr_allow.tsv; build check tools/wasm/short_knr.py.
- Checks: D20 batch 218/0/987; diff_tla 30/30 (neg 4/4); diff_hw 124/0/64 (neg 4/4); diff_mixer 300/300; diff_blitter
  EQUIV (neg 80/80); test_arm 79/79; regress_tla 9/9; GS1 687968a7 / 895d45cc, regress --quick 9/9.
- RAM digests of the older regress cases changed (wasm table indices in game RAM), pictures and save SHA-1 did not.
- Local only: port_work/tla7/contact.png (both battles, Suhalla Gate, scene 7).
- Next: scene 7 -> scene 8 (trigger 5), then on (Felix, Idejima); Func_08173aac captures (Psynergy effects run now).

## GS28 — 2026-11-04: build-independent saves; live saves migrate (branch gs1-options)

- Read docs/GS27.md section 8 and trap 85. Worktree `~/golden-sun-wt/gs1-opts`, branch `gs1-options` (not merged).
- **Cause**: the save holds gActorSnapshot (32 actors, 0x70 bytes each): `script` (+0x00) of a relocated actor script
  was the module's reloc buffer (sol_star_room's statues: 0x88d4c on the live build 687968a7; GBA 0x0200cbd0), `update`
  (+0x6c) a table index (GBA: code address | 1). Nothing else in the save is build-specific.
- **Fix** (port/pc/save_compat.c, 3 c_rules on actors.c): Actor_Snapshot writes GBA addresses, Actor_Restore copies
  each actor from a copy turned back for the loaded overlay. **Migration**: Actor_Restore first maps old values with the
  live build's tables (port/pc/save_legacy.h), then main-clean (-0x20) and gs1-options (+0x7b70) layouts.
- Tests: live-build saves (sol_star_room, Vale day one) load on the new build and replay with **unmasked RAM digests
  equal** to the new build's own saves, re-saves byte-identical; a 24 KB-padded build saves byte-identically; web_opts
  with the live Vale save ALL PASS. Full regress vs clean HEAD: pictures 61/61 equal, 46/46 saves differ only in the
  snapshot words (each HEAD value -> its GBA value), masked RAM equal but the save workspace's heap copy after saving;
  link2 20/20. expected.tsv rewritten from the clean branch build. web_opts (+wide), web_phone (+wide=1), web_offline,
  web_touch ALL PASS; regress --quick 9/9.
- link.py refuses stale port/pc objects and any probe/tmp object (trap 84).
- GS1 game.wasm SHA-1 087d3b7e..., game.js cab9b56b... (site build fadab39f727e70df).
- **Next:** the user merges and deploys (tools/deploy_web.sh) from a clean build; keep port/pc/save_legacy.h.

## GS27 — 2026-11-04: in-game "Extra settings" (colours, brightness) and the optional "Wide view" (branch gs1-options)

- Read docs/GS27.md and traps 83-84. Worktree `~/golden-sun-wt/gs1-opts`, branch `gs1-options` (not merged; the user merges).
- **Feature 1** (commit 6a5ad51): START on the field, then **R** (on the Pause menu, or in Change settings, which now shows
  an "R: More" window) opens **Extra settings**, drawn with the game's windows, font, hand and Setup heading
  (port/pc/options.c + c_rules hooks): Screen colours Original/GBA LCD (gs-lcd), Brightness Normal/Bright/Brighter (new,
  gs-bright), Wide view Off/On (gs-wide). The page menu and the game stay in sync (Port_OptSet / Port_OptGeneration).
- **Feature 2** (the next commit): **Wide view** 288 x 160 for the field sequence's maps only (margins from the map grid's
  cells; centre exactly as before; black past the map's bounds; actor culling widened by c_rules); battles, World Map,
  title/naming/File screens stay 240 with black bars; applied without reload; canvas, CSS and touch layout follow the width.
  TLA's ppu.c branch is the old renderer: TLA byte-identical.
- Checks: web_opts (new) ALL PASS with/without wide; web_phone ALL PASS off and `--query wide=1`; web_offline, web_touch
  ALL PASS; regress with options off vs a clean HEAD build, MASK_CODE=1: all 61 cases' RAM and picture digests equal, 28 save
  rows differ only by a module-data pointer the game saves (trap 83); link2 20/20 both. GS1 game.wasm SHA-1 f0a86799...,
  game.js f606f720... (clean HEAD fdd0e5e2... / 7dd28c21...; main's build/wasm 687968a7 links a stale probe_tmp, trap 84).
- **Next:** decide on the saved module pointer (docs/GS27.md 4: which structure, relocate on load); gamepad input on the
  page (none yet); update tests/regress/expected.tsv after the merge with a clean build (RAM rows are build-specific);
  deploy after the user's merge.

## TLA6b — 2026-11-04: the way down, the first battle reached (not won); D20 batch order explained; audio

- Read docs/TLA6.md sections 7-13 and traps 75-76.
- Real play (node, tools/regress_tla.sh 7 cases): the aerie door -> **down the lighthouse's rooms** (vendor tables:
  exits 22, 10, 13, 7, 3, 1; the "blocked DOWN" was the room's wall, not a port bug) -> the entrance -> the steps ->
  the guards, Alex, Kraden -> the Ruffian -> **first battle shown** (28,226). Not won: Fight/Attack stops the game
  (a self-patching IWRAM blitter, BattleEffect_PatchTemplate, run through a stale decoder alias; TLA6.md 9).
- Fixed: GameFlag_IsConditionActive passed 0 instead of its condition to the K&R GameFlag_Test() (every trigger
  condition tested flag 0; the steps' statues never moved; trap 75); render.c builds (identity stmia as C; battle
  backdrop and units drawn; 0 objects left out, 0 stubs).
- D20: 251 -> 248 was input sampling (one random stream per shard dealt by index, leftover memory): 55 routines moved
  both ways, no translation changed. Batch and diff_hw now seeded per routine (batch also resets memory): batch
  217/0/988 (same per routine on the pre-TLA6 tree), diff_hw 124/0/64. Captured-state inputs (CAPTURES=dir, local game
  RAM; DMA3 modelled in capture cases): **Func_080cf78c EQUIV 6 cases**, batch 218/0/987; Func_08173aac and
  Func_02002f64@681 not reached in play (NOINPUT).
- Audio (node, opening 280 s): 27/27 windows with sound, clipped <= 0.06 % (the DAC clamp, as GS1).
- Checks: build 0 warnings/0 stubs, calls PASS, leak 0; batch 218/0/987 (217 without local captures); diff_tla 30/30; diff_hw 124/0/64 neg 4/4;
  diff_mixer 300/300; test_arm 79/79; regress_tla 7/7 twice; GS1 687968a7 / 895d45cc, regress --quick 9/9.
- **Next:** the battle stop (alias drop on heap reuse + a port of the patch template builder), win the Ruffian battle,
  Felix/Idejima; the 16 open short K&R calls (text.c's window fixed); captures for the other two new translations; deploy after the user's bar.

## TLA6 (part 1) — 2026-11-03: new game to Jenna under control; save -> continue; /tla/ site prep (local)

- Read docs/TLA6.md and trap 74.
- Real play (node, tools/regress_tla.sh): naming, transfer No, the intro, the Venus Lighthouse talk, the quake, the
  area name, **Jenna walks**, field menu, **in-game save -> power-on -> Continue -> back in the field**. First battle
  not reached (the way down the aerie not found by hand).
- Fixed: asm2c relative halfword jump tables (picture decoders, D20 60/60); asm2c long-jump `bl` return points +
  vendor listing fallback (Func_080cf78c, Func_08173aac, Func_02002f64@681 translate; D20 NOINPUT); link.py adapter
  for calls cast to another type (Scene_GetAreaNameIndex was `unreachable`, trap 74).
- Copyright line: the original's (the clear overlay's background is the title's LogoOnBlack picture, which holds it).
- Site: `BOTH=1 tools/site.sh` -> GS1 at /, TLA at /tla/ (own workers/caches, one IndexedDB: rom/flash vs
  tla-rom/tla-flash); web_offline + web_phone ALL PASS for both; staged in ~/golden-sun-site-tla/publish. Not deployed;
  deploy_web.sh needs: TLA leak check, BOTH=1, the tla/ allowlist, cp -R, /tla/ headers and live checks (TLA6.md 4).
- Checks: D20 batch 248/0/957; diff_tla 30/30; diff_hw 131/0/57, negative 4/4; diff_mixer 300/300; test_arm 79/79;
  calls PASS; leak 0; regress_tla 5/5; GS1 687968a7 / 895d45cc, regress --quick 9/9.
- **Next:** the Venus Lighthouse trigger table -> the way down, Felix/Idejima, the first battle (a TLA path probe);
  D20 inputs for the three new translations; audio check of the opening; then deploy (user's bar).

## TLA4d — 2026-11-03: new game to the transfer question; TLA sound in C

- Read docs/TLA4.md section 9 and trap 73.
- Title flow: with an empty save the original skips the intro and the "Press START" screen (Title entrance 1 runs them
  only when the file count is > 0) and starts a new game in the clear overlay (0x64a): Felix naming, then
  **"Transfer data from Golden Sun?"** (Yes: "Transfer Method", password or cable; No: Isaac naming). The port now shows exactly
  that (node keys: START@450, A@480, RIGHT@620, A@650). The "naming over the title" look was a blend task never
  removed (asm adds it by GBA address, C removes it by wasm pointer): Port_TlaTaskKey in the task routines (trap 73).
  Contact sheet port_work/tla4d/contact.png (local).
- Sound: port/tla/hw/pc_tla_mixer.c (mixer + IwramSoundRenderVBlank; GS1's channel mixers shared from port/pc/mixer.c
  under MIXER_KERNELS_ONLY, GS1 identical). tests/arm/tla/diff_mixer.cjs: the ROM's self-patching code in the
  interpreter vs the C, 300/300 EQUIV (negative 89/90). Music in node (tools/audio_check: 11/15 windows non-silent,
  from the title logo on) and in headless Chrome (worklet running, non-zero frames, 0 errors).
- diff_hw negative controls: 4/4 again (memory restored after a failing case; NOINPUT pair = miss).
- Checks: full TLA build PASS (leak 0, calls PASS); D20 batch 251/0/951; diff_tla 30/30; diff_hw 131/0/57, negative
  4/4; diff_mixer 300/300; test_arm 79/79; GS1 687968a7 / 895d45cc; regress --quick 9/9 OK; Chrome 59.7 fps, 0 errors.
- **Next:** say Yes to the transfer question and take the password route with a GS1 password (or the cable route
  with two pages: GS1 sends, TLA receives) — the user's end goal; check the 0x64a password grid and its CRC
  (scene/clear/s217c.c) against a GS1-generated password. Nothing deployed (TLA is not on the site).

## TLA4c — 2026-11-03: TLA boots to the logos, the title and the new-game naming screen (node and Chrome)

- Read docs/TLA4.md section 8 and traps 69-72.
- `node tests/boot.cjs --game tla 1500`: no stop. Nintendo and Camelot logos, the title logo (~300-390), then the
  naming screen for Felix at ~400 over the title picture, interactive (cursor, A, START -> END). Headless Chrome
  (`WASM=build/wasm-tla tools/site.sh`; `ROM=<TLA ROM> node tests/web_shot.cjs ...`): same frames, 59.7 fps,
  0 console errors. Contact sheet port_work/tla4/contact.png (local). **Audio silent** (no PCM mixed).
- Fixed: decode_2's computed table call (16 helpers at 0x08012e74: `a2c_table` slots, overlap entries, counted by
  call_targets.py); polling loops halt (asm2c mark_spins -> a2c_spin = Port_BiosHalt); the unlabelled `bx pc` stub
  0x03000314 that C calls by address (hw2c entry + Port_A2cPointer trampoline in Port_ResolveCode); bit 0 forced on
  wasm table indices in `blh` calls (A2C_THUMB: the sound callback ran the VBlank handler, no frame ever ended);
  `add rd, pc; bx rd` local jumps; the self-patching resident mixer: SoundDriver_EnterVBlankUpdate bound to
  Port_TlaSoundEnterVBlank (callbacks only); stack kernels run from the DMA3 source.
- Tools: tools/tla_incr.sh (incremental TLA build, ~70 s); site.sh `WASM=build/wasm-tla`; the page takes the TLA
  ROM when build_id.js says GS_GAME = 'tla'.
- Checks: full TLA build PASS (0 linker warnings, leak 0, calls PASS 20 allowed); D20 batch 251/0/951; diff_tla
  30/30; diff_hw 131/0/57 of 188 (5 stack-kernel loaders NOINPUT by rule); negative 2/3 (as with TLA4b's module);
  test_arm 79/79; GS1 687968a7 / 895d45cc; regress --quick 9/9 OK.
- **Next:** check the title -> naming step without a key against the real game; port TLA's resident mixer (and
  IwramSoundRenderVBlank) to C for sound; Func_080cf78c / Func_08173aac / Func_02002f64@681 were not reached.
  Nothing deployed (TLA is not on the site).

## TLA4b — 2026-11-03: TLA wiring (H1-H5, trap 65), call-target check; node boot stops in Resource_Decode2

- Read docs/TLA4.md section 7 and traps 66-68.
- Wired: one asm2c pass over the listings and hw2c's byte listings (1,404/1,411); bindings.tsv binds/GS1 twins;
  `twins` port/pc files; tla_asm.c split in 16 units (the monolith was OOM-killed); overlay loader hook; IRQ order
  checked; Port_BiosNop/SoundGetJumpList; ROM-copy run addresses; `_call_via_sp` for the colour kernels; translated
  I/O stores start DMAs; TLA entry Func_0801319c; VCOUNT busy-waits; mixer copy from its ROM address.
- asm2c: main-image overlap entries for mid-routine call targets, `add pc, pc, rm, lsr #k`, returns past the
  caller (a2c_ret_to).
- Call-target check: 29,526 sites, 19 unbound, all allowed, PASS (stage `calls`).
- Checks: full TLA build PASS (0 linker warnings, leak 0); batch D20 251/0/951; diff_tla 30/30; diff_hw 124/0/65;
  test_arm 79/79; GS1 687968a7 / 895d45cc; regress --quick 9/9 OK.
- **Stop:** `node tests/boot.cjs --game tla 600` passes sound init, then gets `asm2c: continuation at 0x08012e74`
  in Resource_Decode2. Decode_2 jumps by register to a pool-loaded helper with no entry. Next: give pool-word code
  targets in byte listings an entry, then continue to the logos and title.
- Not done: Chrome page, title, audio check, Func_080cf78c / Func_08173aac / Func_02002f64@681, the rest of H5.

## TLA4a2 — 2026-11-03: TLA decompressors EQUIV (hw2c routine bounds, 3 asm2c ARM fixes); bindings 0 left

- Read docs/TLA4.md section 5 and trap 66.
- Causes: hw2c used labels inside a routine (AlchemyUncredited*, branch-only globals) as routine starts. asm2c had
  three ARM bugs: ldm/stm ignored address alignment, `sub lr, pc, #imm` was not rotated, and `add pc, pc, rm, lsl #k`
  was not local. Func_081c0c0c is a `pop {pc}` epilogue and needed a stack rule.
- D20 hw: 125 EQUIV, 1 FAIL (ply_rept, gs1-bound, pre-existing), 61 NOINPUT; negative 4/4. diff_tla 30/30,
  test_arm 79/79.
- bindings.tsv: 0 left. heap_release `swi 3` binds to Port_BiosStop.
- TLA5: the asm2c fixes change tla_asm.c, so re-run the batch D20.
- Not done: Func_080cf78c / Func_08173aac / Func_02002f64@681, NOINPUT generators, ply_rept (needs
  overlapping asm2c entries).

## TLA5 — 2026-11-03: asm2c wired into the TLA build (asm stubs 638 -> 38); D20 batch 251 EQUIV, 0 FAIL

- Read docs/TLA5.md. A new build stage, asm2c (TLA only), translates the 1,202 listing routines into
  build/wasm-tla/asm2c. link.py turns every logged stub of a translated routine into an IR wrapper (NAME or
  ovNNN_NAME) into `a2cw_<addr>`. The 603 routines no C calls get a wrapper too, so the codemap covers all of them.
  The run time is port/tla/a2c/a2c_rt.c.
- Logged stubs went from 647 to 47. Asm stubs went from 638 to 38: 36 hand .s, plus Func_080cf78c and Func_08173aac.
  0 linker warnings, leak 0, game.wasm 15.15 MB, full build 1 min 52 s.
- port/tla/symbols/tla-en-extra.tsv (tools/wasm/a2c_extra_symbols.py) replaces port_work/tla1 as asm2c's source
  for bss, absolute and Thumb-bit symbols. The output is byte-identical.
- D20 batch (tests/arm/tla/batch/run.sh, 4 world profiles): 251 EQUIV, 0 FAIL, 951 NOINPUT. A jump into data is
  no input (trap 64).
- Fibers (trap 56): none in the port. wait() is synchronous C, and a2c_call / a2c_enter_wrapped keep the file on
  the C stack.
- Checks: diff_tla 30/30, test_arm 79/79, GS1 687968a7 / 895d45cc, regress --quick OK.
- Next:
  - (1) the overlay loader calls Port_A2cOverlayLoaded with Port_CodeMapOverlay (trap 65);
  - (2) link TLA4a's bindings.tsv (hw2c output through the same stage);
  - (3) captured states for the NOINPUT routines;
  - (4) split tla_asm.c per overlay for build time.

## TLA4a — 2026-11-03: TLA's handwritten asm ported or bound (asm2c byte front end, GS1 twins, binds); bindings.tsv

- Read docs/TLA4.md. The census (port/tla/hw/tools/hand_census.py) finds 4,445 veneer labels and 109 code objects
  (499 labels).
- port/tla/hw/tools/hw2c.py feeds asm2c with byte listings from the reference ELF. Of 503 labels, 462 translate; the
  rest are data, SWI and msr/mrs.
- tests/arm/tla/build_hw.sh and diff_hw.cjs: 196 EQUIV, 6 FAIL, 141 NOINPUT; negative 4/4. TLA3 30/30 and GS1 79/79
  unchanged.
- port/tla/hw/bindings.tsv (names only, make_bindings.py) has 33 gs1 twins, 304 a2c (164 EQUIV), 10 binds, 146 data,
  4,445 veneers and 6 left.
- TLA3's 5 untranslated listing labels:
  - Func_081c0168: now EQUIV;
  - Func_081c05c8: translates, NOINPUT;
  - 3 still need a bound on control flow.
- Next:
  - (1) TLA4b/TLA2b: hooks H1-H5 in TLA4.md 4: the IRQ order, Port_BiosNop and SoundGetJumpList, linking
    bindings.tsv, IWRAM code aliases, kernels copied at run time;
  - (2) trace the 4 decompressor FAILs and Func_081c0c0c;
  - (3) NOINPUT routines need captured states (mixer, colour kernels, battle kernels).

## TLA2b — 2026-11-03: TLA audit 187/187, 47 of 48 left-out objects fixed, overlay veneers resolved (stubs 2,545 -> 647)

- Read docs/TLA2.md, section "TLA2b". A full `tools/web_build.sh --game tla` passes every stage (about 40 s):
  0 linker warnings, audit 187/187, leak 0.
- Audit (port/tla/tools/code_range_audit.tsv): 170 data, 6 safe, 3 fixed, 8 replaced.
  - task.c and resume_and_run.c get Port_CodeIsOverlay through c_rules.
  - TLA's flash driver is replaced by port/pc/flash.c (pc.tsv, fn_overrides).
- Left out: only src/system/render.c (real ARM stmia: TLA4/TLA5).
- Veneers:
  - `tools/wasm/overlay_imports.py` reads every overlay's import .s and the far_call files.
  - bind names each overlay's import and asm calls `ovNNN_NAME`.
  - Shared overlay C objects are bound once per overlay (`path@NNN`).
- Stubs: 647. Of these, 638 are asm (main 273 listing + 36 hand; overlay 328 listing + 1); 7 are render.c C and
  2 are unmapped. The list for TLA4/TLA5 is `port/tla/asm_stubs.tsv` (names only) and
  `build/wasm-tla/asm_stubs.tsv`.
- GS1 unchanged: game.wasm 687968a7, game.js 895d45cc, regress --quick 9/9 OK.
- Next:
  - (1) TLA5: wire asm2c's output in place of the 601 listing stubs (TLA3.md 6);
  - (2) TLA4: the 36 hand .s plus render.c's matrix block;
  - (3) camera_flag.c's Transform_*LookAt return value (0 now) if a caller reads it.

## TLA3 — 2026-11-03: asm2c translates TLA's listing asm; D20 proof 30/30 EQUIV; D23

- Read docs/TLA3.md. `tools/wasm/asm2c.py -o build/a2c/x.c --report build/a2c/report.tsv` translates every listing
  (1 s); 1,202 of 1,207 routines translate, the 5 left are listed in TLA3.md 2.
- Proof: `tests/arm/tla/build_test.sh` (emsdk, 52 s, build/a2c/a2c_test.js), then `node tests/arm/tla/diff_tla.cjs`:
  30/30 EQUIV at 100 cases (2 ARM, 8 overlays, jump tables, flags, multiple returns, indirect calls, a 2 KB battle
  effect builder, a 13 KB overlay routine); `--negative` 4/4; `tools/test_arm.sh` (GS1) 79/79 + negative controls OK.
- Vendor drafts (`tests/arm/tla/drafts.py`, `DRAFTS=1 diff_tla.cjs`): 6 EQUIV of 22 main routines; asm2c 22/22. D23:
  asm2c is the default, drafts/hand ports are fallbacks. Traps 56 (one a2c_r across fibers), 57 (wait in D20), 58
  (listing facts).
- Debugging: `ONLY=a,b OUT=a2c_trace TRACE=1 tests/arm/tla/build_test.sh`, then `OUT=a2c_trace TRACE=1 node
  tests/arm/tla/diff_tla.cjs --all` prints the first instruction where the original and the translation differ.
- Next (TLA5): wire the build hooks of TLA3.md 6 (asm2c stage, runtime a2c_call/a2c_r per fiber, stubs to wrappers,
  codemap into Port_ResolveCode); commit bss/absolute symbols + Thumb bit as a names-only table so asm2c stops reading
  port_work/tla1; per-routine input rules or captured states for the ~960 routines generic worlds cannot run (battle
  effect scripts first).
- Untouched: build.py and its stages, tools/web_build.sh, port/tla, port/pc, port/web, the site. Nothing deployed.

## TLA2 — 2026-11-03: build.py --game tla; TLA's C compiled and linked (0 warnings), leak check 0; audit not done

- Read docs/TLA2.md. `tools/web_build.sh --game tla --only ll,bind,obj,link,leak` builds build/wasm-tla (about 40 s).
  The `audit` stage fails for tla until port/tla/tools/code_range_audit.tsv has rows for the 187 hits.
- GS1 unchanged: game.wasm 687968a7, game.js 895d45cc, regress --quick 9/9 OK.
- TLA: 3,654/3,702 C objects compiled (48 left out, build/wasm-tla/ll_failed.tsv), 0 linker warnings, 2,545 stubs
  (main 238 listing asm + 274 hand .s + 12 C; overlays ~1,900, mostly scene import veneers link.py does not read yet;
  113 names not in the map). Leak check 0 windows.
- Next: (1) audit the 187 TLA hits (task.c:199 and resume_and_run.c:39 first, trap 41's twins); (2) teach
  link.py's veneer_map the scenes' import .s files; (3) the 48 objects (gMainRoutineWork as u8[], static
  Effect_Create, 4 ARM asm); (4) TLA3's asm2c output replaces the listing stubs.
- Untouched: asm2c.py, tests/arm (TLA3's uncommitted files are in the tree: tests/arm/harness.js, tests/arm/tla/,
  tools/wasm/asm2c.py), port/web, the site.

## TLA1 — 2026-11-03: GS1 identical at vendor f6c08e64; compare-tla-en OK; exact TLA symbols and census

Phase TLA1 of docs/TLA_PLAN.md. Details: docs/TLA1.md.

### Done
- **GS1 byte-identical, no pin.** `tools/web_build.sh` takes `ALCHEMY=<checkout>` (mounted at the same container path).
  Built at f6c08e64 and against a temporary worktree at 24b72a32 (removed afterwards): game.wasm 687968a7 and game.js
  895d45cc identical to each other and to the live site. `tools/regress.sh` full: 62/62 OK. Rebuilt again after the TLA
  compiler bootstrap: still 687968a7 (GS1's wasm uses emsdk clang, no alchemy-gcc). Orchestrator D22. Nothing deployed.
- **TLA reference build:** `tools/check_rom_tla.sh` (ROM OK), `tools/build_ref_tla.sh [fetch|bootstrap|build|all]`
  (existing image and volume, clone `/ref/alchemy-tla`, ROM read only at `roms/tla-en.gba` inside the volume clone).
  With GS1's alchemy-gcc 9bc4e65a it failed: alchemy 34c36297 moved TLA's three options into alchemy-gcc 641764a5
  (trap 52). The user approved that commit (D13 f): fetched in Docker into `vendor/alchemy-gcc-tla`; nested pins
  unchanged (agbcc da598c1d, gcc-2.95.2 SHA-256 064e1cb0...). **compare-tla-en: OK**, all 114 overlays identical.
- **Symbols (exact):** `port/symbols/tla-en.tsv` (29,352), `tla-en-overlays.tsv` (14,576), `tools/ref/make_symbols_tla.py`.
  The earlier provisional tables were off only in overlay 661 (4 bytes) and the overlay stream.
- **Census** (`port/symbols/tla-en-census.tsv`, TLA_PLAN 1.2 replaced): code 1,962,630 B; C 913,080 (46.5 %); listing
  asm 959,152 (48.9 %: main 628,240 / 525 fn, overlays 330,912 / 678 fn); hand .s 90,338 (4.6 %). Battle effects
  (rom_main_09) 347,520 B. TLA_PLAN 6 holds the user's decisions of 2026-11-03.

### Notes / traps
- Trap 52: a re-pin can move the alchemy-gcc gitlink; `build_ref_tla.sh fetch` refuses if vendor/alchemy-gcc-tla is not
  at the vendor's gitlink (fetching a new commit needs approval).

### Next
- TLA2: `build.py --game tla`, port/tla tables, compile TLA C, stubs, audit, leak check (GS1 still identical).

## GS-deploy — 2026-11-02: public Netlify site + offline play

The user: "Deploy everything with Netlify so I can play. Also make all port work offline so anyone can play as long
as they loaded the website." This replaces D14's wait for alchemy's author (orchestrator D14 updated).

### Done
- **Live: https://golden-sun-web-port.netlify.app** (new Netlify project `golden-sun-web-port`, id
  `acaba387-f379-4861-96a9-00d158b65a6e`, team `sorikairox`): build/site + the room function `/api/room` (Blobs store
  `golden-sun-rooms`). `tools/deploy_web.sh` does it all: refuses uncommitted changes, leak check on game.wasm and
  game.js, tools/site.sh, a site file allowlist, staging in `~/golden-sun-site/{publish,fn}` (`@netlify/blobs` npm
  installed there only), `deploy --prod` with the netlify CLI (PATH or npx's cached copy), live checks. Build current:
  `tools/web_build.sh` 0 linker warnings, leak check 0 of 1903772 windows (game.wasm and game.js).
- **Offline play** (docs/OFFLINE.md): `port/web/sw.js` (template; site.sh fills build id, site hash, precache list):
  cache `golden-sun-<build>-<site>`, precache all 13 site files, cache-first, never `/api/*` or other URLs (no ROM
  ever cached), skipWaiting on install + old caches deleted on activate; page shows "Update ready [Reload]"; option
  "Offline play" (default on, off = unregister + clear, `gs-offline=0`); `navigator.storage.persist()`; manifest +
  our own drawn sun icon (`tools/web_icon.py`); link panel: "You are offline: online play needs an internet
  connection", Host/Join disabled offline (the game and manual codes still work).
- **Fix found by web_phone.cjs**: opening the page menu by touch let the tap's compatibility click toggle the option
  now under the finger ("GBA screen colours" at 412x915 and landscape once the menu grew); touch.js cancels touchend
  on the menu/back buttons.
- **Tests** (muted headless Chrome, one at a time): `tests/web_offline.cjs` ALL PASS locally (first visit, update A ->
  B with the old cache gone, CDP offline reload with ROM picker + boot, saved-ROM boot + touch offline, option off)
  and `--live` ALL PASS; `tests/web_link_live.cjs` PASS (two pages, live /api/room, real STUN, hello in ~6 s);
  web_touch, web_phone, web_link (20/20 hashes) ALL PASS. `curl`: game.wasm `application/wasm`, manifest
  `application/manifest+json`, /rom.gba 404.

### Notes / traps
- First update design (waiting worker activated by a page message on the next load) failed in headless Chrome once
  the page had run the game: the waiting worker never handled the message. Replaced by skipWaiting on install
  (OFFLINE.md "Updates").
- Fixed test ports collided with another port's test server on 127.0.0.1 (a GoldenEye cache appeared in our
  profile): web_offline.cjs and web_link_live.cjs use system-chosen ports (`listen(0)`, `--remote-debugging-port=0`).
- `Network.emulateNetworkConditions` offline does not stop the browser's own sw.js update check (the test allows it).

### Next
- User: play on the live site; one real online session across two networks (LINK.md 8, D15 STUN only).
- Redeploy after any web change: `tools/web_build.sh`, commit, `tools/deploy_web.sh`.

## GS26 — 2026-11-02: down to Imil, Lv 10 -> 15, back up Mercury Lighthouse, Saturos beaten by real play (no port bug)

### Done
- **Level target** (docs/G26.md 1): Fireball is Psynergy (element x fall-off), so levels add only HP, Attack and turn order; Wish
  needs four Mercury Djinn (two exist). Target Lv 15 (party HP 433 -> 570), ~8000 exp each = ~120 World Map battles.
- **The way down**: the aerie's lift (behavior 6 calls, 12 rides) lies past the confrontation cells (behavior 5 at 20-21,14,
  the only way west), so before Saturos the way down is a loss (GS25's route): the party wakes in Imil's Sanctum. GS25's note
  that the lift was usable before the fight is corrected. Sanctum Revive (200 coins each, back at full HP), the inn (32).
- **Grind** (World Map south of Imil, row 18): grindbot + the scratch smartbot, Mia's field Ply after battles (new grindbot
  GR_HEALER=3) and a stop for the inn (new GR_STOPLOW): cycle 1 37 battles to Lv 12, cycle 2 84 battles to Lv 15; coins 16944.
- **Back up the lighthouse** (G26.md 3): FLAG_AREA_TEMP puzzles reset (Scene_Arrive), but CHANNELS_OPEN's entrance rows send the
  party from the Lower's pipe room straight into the filled room; GS23/GS24/GS25 key spans replayed exactly after the same
  arrival (scratch shift.sh), autowalk on the battle-prone legs: the pool room's ring hops, the filled room, the Upper, the
  five statues, the fountain pipe, Sleet's room, the Exterior, the gap statue, the waterfall's Ply, the aerie.
- **Saturos beaten** (G26.md 4): at Lv 15 the old plan still lost (543, 306 left); the Djinn were on standby from the lost fight
  (the Djinn command set them). Summons on turn 1 (Venus, Mercury), Garet unleashes Forge on turn 4, Mia's Ply below 85 %, Ivan
  Ray/Defend; one event B tap 16 frames later (battle RNG follows input timing): Saturos falls in 13 turns (Isaac and Ivan
  down), 331 exp; **Alex's scene** (Saturos rises, the Mars Star question, they leave by the lift); save.
- Six saves + regress cases: `imil_rest`, `imil_grind1` (~65 s), `imil_grind2` (~404k frames, ~140 s), `ml_upper_return`,
  `ml_aerie_lv15`, `ml_saturos_win`; each regress save has the scratch run's SHA-1. Highlights in story order
  `port_work/g26/final/sheet.png` (final/frames.txt, 30 frames). Furthest saved point: the aerie after Alex's scene (20,12).
- **No port bug found**; 0 distinct stubs hit. No asm/C change, wasm unchanged (no EQUIV spec, no leak check). Trap 51.
- **Audio per second**: imil_rest 538/545 s with sound, imil_grind1 (first 20k frames) 331/334, ml_upper_return 216/219,
  ml_aerie_lv15 468/472, ml_saturos_win 965/972; silences only at power-on, the confrontation's fade (79-82 s) and the World
  Map hand-over (1 s); clamp <= 0.35 %.

### Next
1. From `ml_saturos_win` (aerie, 20,12): ride the lift down (behavior 6 then 12: the lift effect), Hermes' Water (search Imil's
   Sanctum for the Empty Bottle, then use it at the Exterior's fountain, behavior 5), Imil's opened weapon/armor shops, Mia's
   farewell in the Sanctum (first entry after Saturos), then back to Kolima with Hermes' Water (check kolima_forest_tree.c first).
2. User items unchanged: permission from alchemy's author (D14), then deploy.

### Notes
- Tests at the end: REGRESS_RESULT; test_arm 79/79 EQUIV; leak check not needed (wasm unchanged).
- Scratch tools in port_work/g26 (smartbot SB_PLAN=3/SB_GRIND, grind.sh, cycle.sh, inn.sh, sv.sh, shift.sh, rtrace.sh).
- No downloads, installs, deploys or permission denials.

## GS25 — 2026-11-02: the Exterior to the Lighthouse Aerie by real play; the waterfall statue was a position miss (no port bug); Saturos lost at Lv 10

### Done
- **The waterfall statue (verdict (a), not a port bug)**, docs/G25.md 1: the menu's choice is Scene_HasFieldPsynergyTrigger ->
  Scene_FindPsynergyTrigger, which takes the Exterior's `PSYNERGY_ON_ACTOR(ABILITY_PLY), ACTOR_WATERFALL_STATUE` row only when
  Field_FindNearbyPsynergyTarget finds that actor; **Ply's range is 16 px** (gFieldEffect_TargetRangeByMode) and the test is
  `distance < range`. GS24's leader stood at x 834.6, 21 px from the statue (856,216): no target, so the heal path. Walking
  into the statue stops at 840.6 (15 px) and the same keys cast Ply on it. Ply is the right Psynergy; trap 50.
- **Real play, no probe**, one save + two regress cases (docs/G25.md 3):
  - `ml_aerie.keys`: Mia's Ply heals all four, back through the Upper and the Middle, the Exterior's west side (battles fled),
    the waterfalls room, **Move on the gap statue**, the east path, **the waterfall's riddle**, **Ply on its statue**: the
    waterfall stops, Mia rises, the party follows; the World Map's lit beam, the **Lighthouse Aerie** (beacon already lit), the
    dipping platforms, Ply heals; save at 24,12. Furthest saved point `port_work/g25/final/furthest_ml_aerie.png`.
  - `ml_saturos_loss.keys`: the confrontation (Jenna, Felix, Menardi leaves, Saturos), **Saturos's battle** with Flint and
    Garet's first Djinni unleashed, a summon (Mars), Ivan's Ray, Mia's Tundra/Ply (endless PP): lost at Saturos 805/1200;
    the party wakes in Imil. Highlights in story order `port_work/g25/final/sheet.png` (final/frames.txt, 30 frames).
- **Saturos checked against the vendor** (G25.md 4): unit = enemy_table.c's row (L18, HP 1200, Atk 113, Def 35, Agi 51,
  Mars 110/175, Mercury res 72); one Fireball's four hits (63/57/59/46) = power 65 x (200 + 110 - res)/200 x falloff
  100/80/60 + random 0-3. He out-speeds Mia, so her heals come after his hits. Scratch plans (port_work/g25/smartbot.cjs, HP-aware: Cure Well,
  Ply, Ray, Defend, Djinn) got him to 438 at best (644-804 over five timing retries). Game behaviour: the Lv 10 party needs levels.
- Grinding on the Exterior's east path did not work at Lv 10 (members fall in 4-8 battles, no revive there; G25.md 5).
- **No port bug found**; 0 distinct stubs hit. No asm/C change: no EQUIV spec, the wasm was not rebuilt.
- **Audio per second**: ml_sleet (GS24 had skipped it) 161/164 s with sound, ml_aerie 436/440, ml_saturos_loss 336/343;
  silences only at power-on, the World Map hand-over (1 s) and the confrontation's SOUND_FADE_OUT_BGM (3 s); clamp <= 0.16 %.
- Trap 50 (field Psynergy reach per kind; walk into the target).

### Next
1. From `ml_aerie` (aerie, 24,12, full HP, Lv 10/10/10/10): Saturos needs levels. Options, read the vendor first: (a) the lift
   down (behavior 6 calls it, 12 rides it, both usable before the fight) to the Exterior's ground by the fountain, Imil's inn
   and sanctum, grind on the World Map near Imil (weaker battles, revive in reach), then climb back (the lighthouse's
   FLAG_AREA_TEMP puzzle flags reset on leaving: expect to redo the pipes); (b) a tighter battle plan: Isaac's Cure Well,
   Defend, the summons on Mercury-weak Saturos. Then the story events (Alex), the beacon scene, Hermes' Water, Imil's shops.
2. User items unchanged: permission from alchemy's author (D14), then deploy.

### Notes
- Tests at the end (build unchanged since GS14): regress full run 56/56 OK (55 cases + link2, incl. ml_aerie and ml_saturos_loss); test_arm 79/79 EQUIV; leak check not needed (wasm unchanged).
- No downloads, installs, deploys or permission denials.

## GS24 — 2026-11-02: Mercury Lighthouse's Upper and Middle to Sleet by real play; the interlaced wipe checked (no port bug)

### Done
- **Transition check** (GS23's open item, docs/G24.md 1): the Lower's exit 1 into the Entrance uses
  WINDOW_TRANSITION_INTERLACED_WIPE, which MercuryLighthouse_Initialize sets for every scene of that overlay; measured on our
  frames, even lines' window ends at v and odd lines' starts at 240 - v with v = 240 * (value & 31) / 32 (f7208 v 135, f7212
  v 195), outside BG0 only, exactly as screen_transition.c writes it. Game behaviour; the PPU's per-line windows are right.
- **Real play, no probe**, two saves + regress cases (puzzles read from the vendor first; docs/G24.md 3):
  - `ml_upper.keys`: the filled room's ring hops to the stairs (36,34), the Lower's SW room up to the **Upper**; the stone
    doors room: the door switch pipe and the door room pipe pushed in the order StartStatueSlide's table needs (47, 54, door
    pipe south, 53, 54, door pipe north, 47, door pipe south, 48): **the statue slides off its ledge and falls** into the gate
    room; pushed onto **the switch at 10,23**: the stair gate opens for good; the five statues: **Move on the last statue**
    from 58,7 (57: the crossing jump cell), exit 58,4 to the Middle's fountain room; **the fountain pipe to row 40** (the
    fountain sprays); up to the Upper, the sparkling passage to **Sleet's room**; Mia's Ply heals; save.
  - `ml_sleet.keys`: **Sleet** beaten (battlebot BB_SEQ ';;LEFT A;LEFT A': Ivan and Mia defend): "The Mercury Djinni Sleet
    joined Ivan."; save. Furthest saved point `port_work/g24/final/furthest_ml_sleet.png`; highlights in story order
    `port_work/g24/final/sheet.png` (final/frames.txt).
  - Scratch only (not committed): the Exterior's west side, the Upper's waterfalls room, **Move on the gap statue** (31,20
    crossing), the Exterior's east path to **the waterfall's riddle**; six battles left Isaac and Ivan down, and field Ply at
    52,13 asked for a member (target missed). Not committed for that reason.
- **No port bug found**; 0 distinct stubs hit. Checked against the vendor: the wipe, the pipes' slides and the statue's
  scripts, the statue falling via another room, Sleet's numbers (L10, HP 290, Mercury power 125; Tundra power 45 range 2
  gives 54 centre / 43 beside: seen 55 / 42; "runs!" ends the battle twice), the join tint. No asm/C change: no EQUIV spec,
  the wasm was not rebuilt.
- **Audio per second**: ml_upper 405/408 s with sound (silent only at power-on), DAC clamp up to 0.10 %.
- Trap 49 (passages under moved pipes change; Move from a cell's edge; heal before the Exterior).

### Next
1. From `ml_sleet` (Sleet's room, party hurt: heal with Ply/Cure Well first; Isaac 38, Garet 81, Ivan 6, Mia 28): the way
   GS24 walked in scratch (G24.md 3: Upper 16,7 passage back, 5,12, the Middle's NE room 45,12, the Exterior's west side to
   14,31, the waterfalls room 28,37, the gap statue by Move from 31,20 to 28, 29,19, the Exterior's east path 25,20) to the
   waterfall; find Ply's target reach on ACTOR_WATERFALL_STATUE (53,13; Field_FindNearbyPsynergyTarget, trap 42), then
   MercuryLighthouse_PlyOpensWaterfallPassage, the aerie and **Saturos** (BB_SEQ with a Djinn unleash, a summon, Mia's
   Ply/Frost; Sleet is Ivan's now). Then Hermes' Water, Imil's shops, Kolima, Tret.
2. User items unchanged: permission from alchemy's author (D14), then deploy.

### Notes
- Tests at the end (build unchanged since GS14): regress full run 53/53 OK after ml_upper was added (52 cases + link2), then the final full run 54/54 OK (53 cases + link2, incl. ml_upper and ml_sleet), test_arm 79/79 EQUIV; leak check not needed (wasm unchanged).
- No downloads, installs, deploys or permission denials.

## GS23 — 2026-11-02: Mercury Lighthouse by real play to Ply at the pool and the three pipe sections (no port bug)

### Done
- **Full regress at the start** (GS22 had added mia_joins without a full run): 50/50 OK (49 cases + link2).
- **Story order from the vendor first** (mercury_lighthouse.c, mercury_lighthouse_entrance.c's trigger table, scene_exits.h,
  entrance/exit rows read at run time from the overlay data): the plan's order was pipes then Ply; the tables put **Ply first**:
  the Lower's pipe room is entered only from the Entrance's exit TO_LOWER_EAST_NORTHEAST (behavior 63), in rooms reached over
  pools crossed with the golden rings that Ply unlocks, and the Ply cell (12,32) is reached only by the Lower's hole (docs/G23.md 2).
- **Real play, no probe**, two saves + regress cases (docs/G23.md 3):
  - `ml_ply.keys`: the waterfalls room, the Middle's pipe maze (the stair pipe to column 11 raises the stairs: water jets carry
    the leader; passages under the pipes; the pipe pushed back; a chest at 24,34), the gate room (two battles fled), the gate
    statue moved by Move and walk-pushed along row 16 and up column 5 onto the floor switch: the gate opens; the ladder, exit 1
    to the Lower's hole room, south into the hole: the leader **drops into the pool's heart**, the inscription; **Mia's Ply
    from 12,32**: the room dims, sparks, a flash, the heart and goddess glow, the colours shimmer; save.
  - `ml_pipes.keys`: the **golden rings** (three from a heart, one spent per water landing, a rim takes all): the goddess's pool,
    the twin fountains, exit 61, the Lower's pool room (path from a hop search, port_work/g23/hop.py) to exit 1, the west twin
    fountains, the west waterfalls room, the sparkling passage to the dry fountain room, up into the **pipe room**: **the three
    pipe sections pushed into place** (rows 8 and 12, column 40): the floor shakes, the water fills the room below and carries
    the party back up (FLAG_MERCURY_LIGHTHOUSE_CHANNELS_OPEN); save.
  - Furthest saved point: `port_work/g23/final/furthest_ml_pipes.png`; highlights in story order `port_work/g23/final/sheet.png`
    (final/frames.txt).
- **No port bug found**; 0 distinct stubs hit. Checked against the vendor: the jets (MercuryLighthouse_WalkLeaderIn's fixed
  landings), the passages under the pipes, the gate statue's refused pushes (PushedActor_AdvancePair), Move's misses (trap 42),
  Ply's winged figures (ply.c SPRITE_WINGED_FIGURE), the dim/pale/shimmer sequence (ActivateWithPly, CyclePalette), the rings and
  hops, the water ride down and back. Not yet checked: the centre-window transition into the Entrance from the Lower's exit 1
  (G23.md 4). No asm/C change: no EQUIV spec, the wasm was not rebuilt.
- **Audio per second**: ml_ply 345/348 s with sound, ml_pipes 191/194; silent only at power-on; DAC clamp up to 0.05 %.
- Trap 48 (Mercury Lighthouse routing: trigger tables first, passages under pipes, push/Move rules, ring pools, menu timing).

### Next
1. From `ml_pipes` (the Lower's pipe room, 44,16, channels open): the Middle's remaining parts (the fountain pipe at 44,42 to
   row 40, Sleet the Mercury Djinni at 55,24, exits up: Middle exits 3/5/8/9/10 to the Upper), the Upper's stone doors (the
   door switch pipe, the falling statue onto the stair gate's switch at 10,23), the five statues and the gap statue, the
   Exterior's waterfall riddle (Ply on its statue), the aerie and **Saturos** (battlebot BB_SEQ with a Djinn unleash, a summon,
   Mia's Ply/Frost; heal first; check his numbers against the vendor if he wins). Then Hermes' Water, Imil's shops, Kolima, Tret.
2. Look at the centre-window transition (G23.md 4) against the vendor's transition code.
3. User items unchanged: permission from alchemy's author (D14), then deploy.

### Notes
- Tests at the end (build unchanged since GS14): regress full run 52/52 OK at the end (51 cases + link2, incl. ml_ply and ml_pipes; 50/50 at the start, 51/51 after ml_ply), test_arm 79/79 EQUIV; leak check not needed (wasm unchanged).
- No downloads, installs, deploys or permission denials.

## GS22 — 2026-11-02: across Bilibin Cave's ice room, Imil, Mercury Lighthouse to Mia joining, by real play (no port bug)

### Done
- **Real play, no probe**, five saves + regress cases (story order from the vendor scene sources first; docs/G22.md 2):
  - `bilibin_exit.keys`: the ice room was never boxed in (autowalk's legs ran along the pillars' edge; ending a leg in row 20
    clears them); the **torch puzzle** (bilibin_cave.c BilibinCave_PushTorch): the fourth torch pushed south, then east twice
    to 35,23: the ice pillar melts, 36,22/36,24 become jump cells; south down column 34 to the World Map; save.
  - `imil.keys`: the World Map to **Imil**; **Megan** (Sanctum); the old couple's house: **Mia heals the old man with Ply**,
    the lighthouse flashes, she runs out; the **item shop** (3 Elixirs, 2 Antidotes: 4896 -> 4766 coins); the weapon and armor
    house (sellers sick until Saturos is beaten: no gear on sale, by the story); save.
  - `lizard_man.keys`: north to **Mercury Lighthouse**; Mia blocked by a statue, **Move** pushes it (from 54,37 facing west),
    **Mia opens the door with Ply**; inside, the **Lizard Man** beaten with battlebot BB_SEQ: **Isaac unleashes Flint (31)**,
    **summons Venus (33)**, Cure Well on Garet; Mia goes on; save.
  - `ml_lower.keys`: the inner door, the goddess's room, the twin fountains, exit 61 into the **lower floor**; save.
  - `mia_joins.keys`: the stepping stones and stairs to the statue part; Move from 47,39 facing east, LEFT pulls the statue
    blocking Mia to column 48: **"Mia joined your party."** (with Fizz); her Psynergy (Ply, Cure Poison, Frost) and Djinn
    menus; save. Furthest saved point: `port_work/g22/final/furthest_mia_joins.png`; highlights in story order
    `port_work/g22/final/sheet.png` (final/frames.txt).
- **No port bug found**; 0 distinct stubs hit. Checked against the vendor: the closed weapon/armor shops, Megan's Yes reply,
  Imil's lavender chimney smoke (dust puff + SPRITE_COLOR_BLUE_TINT), the Psynergy cast tints, Mercury Lighthouse's purple
  margins (BG2 map layer, mode 0, black backdrop), the Venus summon's 33 on the Lizard Man (preset 33 in the ROM: Venus
  resistance 100), Continue's restore spot (G22.md 3). No asm/C change: no EQUIV spec, the wasm was not rebuilt.
- **Audio per second**: bilibin_exit 79/82 s with sound, imil 249/252, lizard_man 236/239, ml_lower 60/63; silent only at
  power-on (mia_joins 100/103); DAC clamp up to 0.11 %.
- Trap 47 (routing: autowalk leg edges, B for event text, case-insensitive scratch names).

### Next
1. From `mia_joins` (lower floor, 47,39, Mia in the party): the three pipe sections (FLAG_PIPE_1..3_JOINED) down to the
   entrance, **Ply at the pool's inscription** from 12,32 (the pool's lights), up the floors to Saturos (heal first; Imil's
   weapon/armor shops open only after Saturos).
2. New effects to watch: the pool's lights and colour shimmer after Ply (MERCURY_LIGHTHOUSE_POOL_* cells), the pipes' water,
   Mia in battle (Ply, Frost, Fizz).
3. User items unchanged: permission from alchemy's author (D14), then deploy.

### Notes
- Tests at the end (build unchanged since GS14): regress full run full run 49/49 OK before mia_joins was added (incl. bilibin_exit, imil, lizard_man, ml_lower), then mia_joins + ml_lower OK, test_arm 79/79 EQUIV; leak check not needed
  (wasm unchanged).
- No downloads, installs, deploys or permission denials.

## GS21 — 2026-11-02: Tret beaten by real play (damage check: no port bug), north to Bilibin Cave's ice room

### Done
- **Tret damage check first** (docs/G21.md 1): Tret's unit in RAM = the vendor row and ROM tables (L14, HP 710, Atk 89,
  Def 27; elements preset 8: Mars resistance 25); every hit seen (ours and his: attacks, criticals, Quake, Thorn, Ray,
  Volcano, Spire, the Venus summon) falls in the range the vendor formulas give. The battle code has no override. Not a
  port bug: GS20 lost by attacking (16-21) instead of using Volcano on the Mars weakness (~64).
- **Real play, no probe**, three saves + regress cases (story order from the vendor scene sources first; G21.md 3):
  - `tret_win.keys`: battlebot BB_SEQ: Flint set, **Flint unleashed**, **Venus summoned**, Garet's Volcano each turn, Ray,
    Cure Well on Ivan and Isaac, Spire: **Tret beaten at Lv 10/10/9, all standing**; Tret's thanks, the party resolves to
    heal him; save.
  - `bilibin_cave.keys`: Retreat twice, the World Map round the river, the bridge, the **Bilibin Barricade** from the east
    (**Move** on the crates), west past Bilibin, north, two narrow bridges, the **Bilibin Cave Entrance**; save.
  - `bilibin_ice.keys`: the south mouth into **Bilibin Cave**, its corridors, the hole into the **ice room**; save.
    Furthest saved point: `port_work/g21/final/furthest_bilibin_ice.png`; highlights in story order
    `port_work/g21/final/sheet.png` (final/frames.txt).
- Grinding was not needed (the plan's Lv 12-13 grind and Breeze skipped once the damage check showed the weakness).
- **Tools**: `tests/probes/wmpath.cjs`, a World Map path search over the collision pixels (hpath reads map cells, which the
  World Map does not use for walls; trap 46).
- **No port bug found**; 0 distinct stubs hit. Checked against the vendor: Tret's numbers, the post-battle silence
  (SOUND_FADE_OUT_BGM), Flint's set raising Isaac's HP, the forest's cursed palette, the World Map collision (our reading
  equals WorldMap_GetCollision at the leader), the forest's area actor re-entering on touch. No asm/C change: no EQUIV
  spec, the wasm was not rebuilt (leak check not needed).
- **Audio per second**: tret_win 379/385 s with sound (power-on and a 3-s post-battle fade-out, game), bilibin_cave 306/309,
  bilibin_ice 82/85; DAC clamp up to 0.40 %.

### Next
1. From `bilibin_ice` (ice room, 7,26): reach the slope cells at x 30-33 (rows 19-24) past the ice pillars (the leader is
   boxed at 25,18-19 on the direct way), move a torch beside the pillar at 35,23 (Move or push) so 36,22/36,24 become jump
   cells, exit 3 (36-38,36) to the World Map, then **Imil** (370,16) and **Mercury Lighthouse** (376,10), Mia.
   G21.md 4 has the cells and actors.
2. Party: Lv 10/10/9, 4896 coins: equipment in Imil's shop if any; heal before the lighthouse.
3. User items unchanged: permission from alchemy's author (D14), then deploy.

### Notes
- Tests at the end (build unchanged since GS14): regress full run 45/45 OK (incl. tret_win, bilibin_cave, bilibin_ice), test_arm 79/79 EQUIV; leak check not
  needed (wasm unchanged).
- No downloads, installs, deploys or permission denials.

## GS20 — 2026-11-02: through the Tret Tree to Tret by real play: the webs, branches and vines, cocoon 50's falls; Tret not beaten yet

### Done
- **Real play, no probe** (layout and order from tree_rooms.c / tret_tree_branch.c first; docs/G20.md 1), two saves + regress cases:
  - `tret_cocoon.keys`: Cure x3, the vine to the second floor, the **cocoon webs** (torn cocoons are jumped from), the east
    exit, the branches' three **vines** (step triggers), the third floor's climb to the fourth, the fifth floor's east part,
    cocoon 58 drops back, the west part, cocoons 53, 55, **50** (torn), 57 and back onto 50: **the falls 50-40-30-20-10 land
    in a ring of dust in front of Tret**; save. Furthest saved point: `port_work/g20/final/furthest_tret_cocoon.png`.
  - `tret_grind.keys`: out to Tret's glade, grindbot 38 battles (Lv 10/10/9, Cure Well), back up the vine; save.
  - **Tret fought twice, lost both** (Lv 9 and Lv 10; Isaac summons Venus for 60; Tret's Quake/Thorn wipe the party in ~4
    turns): Tret is the next milestone (G20.md 4). Highlights in story order `port_work/g20/final/sheet.png` (final/frames.txt).
- **Tools**: hpath HPATH_JUMPB (cocoons as jump spots), autowalk WALK_FLEE, grindbot GR_CUREFIRST/GR_FLEEMID/GR_NOFIGHT,
  battlebot BB_LOOP/BB_BATTLEONLY (grindbot + battlebot together).
- **No port bug found**; 0 distinct stubs hit. Checked against the vendor: the falls' noise wipe (WINDOW_TRANSITION_NOISE),
  the rooms' tint and 9/10 scale, Flint on standby since GS19 ("Flint is set"), max HP changes on Djinn set, the
  unreachable SSW branch (a real gap). No asm/C change: no EQUIV spec or audit row, the wasm was not rebuilt.
- **Audio per second**: tret_cocoon 206/209 s with sound, tret_grind 2714/2717; silent only at power-on; DAC clamp up to 0.50 %.

### Next
1. Beat Tret: from `tret_grind` (in the entrance room, Ivan 44/71), grind more in Tret's glade (GR_SCENE=44, x 20-26 at row
   16-17; Lv 12-13), maybe get Breeze (branch 40,5: not reached from the branch networks of exits 1, 2/4, 5, 6/7/8 — look
   at exit 3's), then walk port_work/g20/legs2.txt (whole route as one autowalk list) and fight with Cure Well in BB_SEQ.
2. Then north in story order (check the vendor first): Fuchin Temple, Imil, Mercury Lighthouse with Mia; back with Hermes' Water.
3. User items unchanged: permission from alchemy's author (D14), then deploy.

### Notes
- Tests at the end (build unchanged since GS14): regress full run 41/41 OK (before tret_grind was added; tret_cocoon and
  tret_grind then OK on their own), test_arm 79/79 EQUIV; leak check not needed (wasm unchanged).
- No downloads, installs, deploys or permission denials.

## GS19 — 2026-11-02: Kolima Forest to the Tret Tree by real play: grinding, the log puzzles, the floodgate, Laurel and Tret, a summon

### Done
- **Real play, no probe** (story order from the vendor scene sources first; docs/G19.md 2), six new saves + regress cases:
  - `kolima_grind.keys`: grindbot in the forest's entrance, 82 battles, Isaac Lv 6 -> 9 (Retreat), Garet 8, Ivan 8; save.
    A first grind on the World Map and a later one without fleeing ended in a wipe: the party woke at Kolima's restart
    point with the leader at 1 HP (the game's rule, G19.md 3); grindbot got GR_FLEE (Run while Cure's PP is short).
  - `kolima_glade.keys`: the entrance's **river log** (walking west rolls it into the river; over it), the north log, through
    the stumps to the glade; the glade's logs (one rolled west, one rolled south opens column 10); save at the cliff.
  - `kolima_cliff.keys`: the cliff's three logs in order (the river log west, back east, the west-east log north, the other
    log south to get out), the river log tips in, the west bank's slope onto the cliff top; save at the floodgate.
  - `kolima_floodgate.keys`: the **Floodgate Switch** drains the river (spray, line shake), a log rolled on the riverbed, the
    switch again, across the **floating logs** (jump cells) to the north bank; save where Tret stands.
  - `tret_tree.keys`: **Laurel** ("Soon, Tret will die"), **Tret's wrathful side** (purple background tint), the vine into
    the **Tret Tree**; save.
  - `tret_battle.keys`: a Tret Tree battle by battlebot BB_SEQ: **Isaac unleashes Flint, then summons Mars**; save.
    Furthest saved point: `port_work/g19/final/furthest_tret_battle_5800.png` (inside the Tret Tree); highlights in story
    order `port_work/g19/final/sheet.png` (frames in final/frames.txt).
- **Story order correction**: the curse lifts only with Hermes' Water from Mercury Lighthouse after the Tret Tree's battle
  (kolima_forest_tree.c, tree_rooms.c); Kolima restored, Granite and McCoy's reward come after that.
- **Tools**: grindbot GR_SCENE, GR_AXIS=z, GR_TH, GR_FLEE, GR_STOPDOWN; hpath HPATH_MAP=3 (4-px heights: stumps, slopes)
  and HPATH_DIAG; autowalk 'd' (diagonal) waypoints.
- **No port bug found**; 0 distinct stubs hit. Checked against vendor sources and reference images: the forest and Tret Tree
  battle backgrounds (kolima_forest.png, tret_tree_interiors.png), the log rolls and river-log cell copies, the floodgate's
  levels/spray/shake, Tret's PALETTES_BG tint, the cursed palettes, the wipe's restart. No asm/C change: no EQUIV spec or
  audit row, the wasm was not rebuilt (web tests not rerun).
- **Audio per second** on the six routes: sound in every window but power-on's three; DAC clamp up to 0.33 % (G19.md 5).

### Next
1. From the tret_battle save (party 43/49/22 HP: Cure first): the Tret Tree's rooms and cocoons (tree_rooms.c: cocoon 50
   and the falls through entrances 50, 40, 30, 20 to 10 in front of Tret; tret_tree_branch.c outside), the battle with Tret
   (grind in the tree first if needed), then north: Fuchin Temple, Mercury Lighthouse, Imil, Mia; back to Tret with Hermes'
   Water (curse lifted), Kolima, Granite, McCoy's reward.
2. hpath: HPATH_MAP=3 to see stumps; logs change cells: search again after each roll.
3. User items unchanged: permission from alchemy's author (D14), then deploy.

### Notes
- Tests at the end (build unchanged since GS14): regress full run 40/40 OK, `--quick` 9/9 OK in ~25 s, test_arm 79/79
  EQUIV, leak check PASS; `--update` only for the six new cases. Do not edit tools/regress.sh while a run is going (bash
  reads the script as it runs; a mid-run edit broke one run with "$4: unbound variable").
- No downloads, installs, deploys or permission denials.

## GS18 — 2026-11-02: Goma Cave to Kolima Forest by real play: Forge, the way out, Bilibin (Mind Read, McCoy), the barricade, Kolima's curse

### Done
- **Tooling**: `tests/probes/hpath.cjs`, a height- and layer-aware path search (terrain kinds and samples, step +8/-12 px from
  MapGrid_CheckCollision, jump/climb/ledge cells, scene gap jumps HPATH_JUMPW, the cell picture's layer bits; maps of reachable
  cells or raw heights); mapdump MAP_MODE=height now prints shape byte 1 in 8-px units (y 32 printed 0 before). It found the
  pillar room's way (the pond room) at once.
- **Real play, no probe** (story order from the vendor scene sources first; docs/G18.md 2), five new saves + regress cases:
  - `goma_forge.keys`: the pond room, **Move** on the west pillar and on the stump (it falls into the pond), across the pond on
    its jump cells, the east ledge, Cure x3, **Forge's battle won** (battlebot: Quake, Ray, Flint unleashed), Forge joins, the
    witness leaves; save. (A first try at Forge with low HP was lost: the party woke at the Vault Sanctum.)
  - `bilibin.keys`: exit 9, **Move** on the stream room's stump (it leaps into the stream), the bridge, diagonal stairs, the
    World Map to **Bilibin**; save.
  - `mccoy.keys`: **Mind Read** (L shortcut) on the tree man ("Help me... Somebody..."), the palace gate, **McCoy's audience**,
    the captain's barricade hint; save.
  - `kolima.keys`: back out, the **Bilibin Barricade** (**Move** on the crates), the World Map to **Kolima**, the curse scene
    (Tret and Laurel); save.
  - `kolima_forest.keys`: Cure x5, the World Map to **Kolima Forest**; save. Furthest saved point:
    `port_work/g18/final/furthest_kolima_forest_4400.png`; highlights in story order `port_work/g18/final/sheet.png` (frames in
    final/frames.txt).
- **No port bug found**; 0 distinct stubs hit. Checked: the interlaced wipe's grey-looking half (WIN0 = BG0 only on even lines,
  the old scene on odd lines; pixel and register check), Kolima's silences (the scene's own BGM fade-outs), Mind Read's tint.
  No asm/C change: no EQUIV spec or audit row, the wasm was not rebuilt (web tests not rerun).
- **Audio per second** on the five routes: sound in every window except power-on, and the curse scene's fade-outs in kolima
  (G18.md 5); DAC clamp up to 0.41 % in battle music.

### Next
1. From the kolima_forest save: the entrance's logs (roll one west into the river, cross; KolimaForest_HopEast), the glade,
   the forest's scenes to **Tret** (the curse lifted), back to Kolima (Granite in the village), McCoy's reward. Grind first: the
   party is Lv 6 (Forge nearly won); use battlebot for Djinn/summons.
2. Use hpath (HPATH_MAP=1, then HPATH_TO) in every new cave; search again after Move/scene events change cells.
3. User items unchanged: permission from alchemy's author (D14), then deploy.

### Notes
- Tests at the end (build unchanged since GS14): regress full run 33/33 OK (before the last case was added; `kolima_forest` then OK on its own, 34 cases; `--update`
  only for the five new cases), `--quick` 9/9 OK in 33 s, test_arm 79/79 EQUIV, leak
  check PASS, code-range audit untouched.
- Routing: Move reaches 32 px (2/3 counted for the stump): push into the cliff edge before casting. A examines the Bilibin tree
  man from Mind Read's range: use the L shortcut. START is swallowed while a message is up. autowalk's WALK_TAP opens menus.
- No downloads, installs, deploys or permission denials.

## GS17 — 2026-11-02: Vault Sanctum to Goma Cave by real play: Revive, Ivan rejoins (Whirlwind), the cave's stream and pillar rooms, Djinn/Psynergy/summon in battle

### Done
- **Real play, no probe** (story order from sanctum.c, vault.c, goma_cave_*.c first; docs/G17.md 2), three new saves + regress cases:
  - `goma_entrance.keys` (+ `_save`): from the loft down to Vault, the **Vault Sanctum: Revive** Isaac (120 coins), the north
    gate, the World Map east (a Bat battle) to the **Goma Cave Entrance**, Cure on Garet; save (regress `goma_entrance`).
  - `goma_ivan.keys` (+ `_save`): the west pillar pushed off the ladder, **Move** pulls the east pillar into place, the y-64 level,
    **Move on the ivy-bound stump**: "It's no use...", **Ivan rejoins** and blows the ivy off with **Whirlwind**; Move sends the
    stump leaping into the pool; Ivan's **Whirlwind** on the tall ivy opens the cave mouth; into Goma Cave; save (regress `goma_ivan`).
  - `goma_pillar.keys` (+ `_save`): the stream room's jump cells, diagonal stairs into the pillar room, four Skeleton battles with
    **Isaac's Djinn command (Flint set), Flint unleashed, Ivan's Ray, Isaac summons Venus**, the east pillar pushed and Moved
    three times to (38,14) where it settles; save (regress `goma_pillar`). Furthest saved point:
    `port_work/g17/final/furthest_goma_pillar_10500.png`; highlights in story order `port_work/g17/final/sheet.png` (frames in
    final/frames.txt).
- **Tools**: battlebot `BB_SEQ` (per-command-box macros: Djinn, Psynergy, Summon); `tools/regress.sh --quick` (core probes +
  newest 3 story cases, saves reused, ~30 s) and `REUSE=1`.
- **No port bug found**; 0 distinct stubs hit. Checked against the vendor: Move/Whirlwind tints vary per cast by design
  (`gFrameCount & 7`), a Move that only plays and ends had no target (8 px height, ~34 degree cone: trap 42), the cave battle
  background matches `goma_cave.png`. No asm/C change: no EQUIV spec or audit row, the wasm was not rebuilt (web tests not rerun).
- **Audio per second**: goma_entrance 154/157 s with sound, goma_ivan 216/219, goma_pillar 172/175; silent only at power-on;
  battle music reaches the DAC clamp in up to 0.29 % of a window's samples (as GS16).

### Next
1. From the goma_pillar save: reach the pillar room's y-32 ledges (the pond room via exit 6 or 7; the stump on the central ledge
   falls into the pond and makes jump cells), Forge (Djinni battle) and Mind Read on the man, exit 9 to the stream room's north
   (its stump on column 24 is a stepping stone), the bridge, the World Map to **Bilibin** (McCoy, the curse), Kolima Forest.
2. Write a height-aware BFS for caves (hdump.cjs heights: 4 = y 32, 8 = y 64; walls are heights there, not behavior 255) before
   routing more caves; fix mapdump's MAP_MODE=height scale (byte 1 is in 8-px units).
3. User items unchanged: permission from alchemy's author (D14), then deploy.

### Notes
- Tests at the end (build unchanged since GS14): regress 29/29 OK (full run 4:40; `--update` only for the three new cases), `--quick` 9/9 OK in 28 s, test_arm 79/79 EQUIV, leak check PASS, code-range audit untouched.
- Routing: Vault Sanctum door 3,17 from 3,19 (villager on 5,18); the counter 12,9 facing north. Diagonal stairs need diagonal
  input. Move pushes once per cast and ends on A/B/L/R; Ivan's first battle Psynergy entry is Ray.
- No downloads, installs, deploys or permission denials.

## GS16 — 2026-11-02: Vault by real play: the chase, Mind Read, Move on the crate, grinding, the thieves' battle won, the Shaman's Rod

### Done
- **Real play, no probe** (story order from log_rooms_a.c / vault.c first; docs/G16.md 2), three new saves + regress cases:
  - `vault_crate.keys` (+ `_save`): the **cornering chase** (Isaac up the east crossbar and west along the top row squeezes
    both suspects against Ivan: "Uh-oh! I'm surrounded!"), **Ivan's Mind Read**, out of the inn, Vault's ladder into the
    room with the crate, **Move** on the crate (LEFT to column 42); save (regress `vault_crate`).
  - `vault_grind.keys` (+ `_save`): out by the south gate (**Ivan stays behind**), **78 World Map battles** (Isaac Lv 2 -> 6,
    Garet 2 -> 5; Cure between battles); save on the World Map (regress `vault_grind`, ~75 s).
  - `vault_thieves.keys` (+ `_save`): back in (**Ivan rejoins**), the way behind the crate to **the loft**, the tied-up
    villager, **the thieves' battle won** (thieves first: their Herbs fully heal the Bandit), the thieves jailed, the
    chests, **the Shaman's Rod**, Ivan leaves for Lunpa; save (regress `vault_thieves`). Furthest saved point:
    `port_work/g16/final/furthest_vault_thieves_35300.png`; highlights in story order `port_work/g16/final/sheet.png`
    (frames in final/frames.txt). Lost-battle path (wake in the Sanctum) also seen in scratch runs.
- **Tools**: `tests/probes/grindbot.cjs` (walk, fight, Cure after battles, stop at a level) and `tests/probes/battlebot.cjs`
  (reads the battle command box on screen; Fight, Attack with a target shift), both record plain keys like autowalk.
- **No port bug found**; 0 distinct stubs hit. The encounter transition (white backdrop, an ellipse round the leader on odd
  frames, fade to black) matches Field_StartEncounterTransition + WINDOW_TRANSITION_LEADER_INVERSE; the loft and World Map
  battle backgrounds match the vendor's interior.png / grassland.png. No asm/C change: no EQUIV spec or audit row, the
  wasm was not rebuilt.
- **Audio per second**: vault_crate 125/128 s with sound, vault_grind (first 334 s) 331/334, vault_thieves 570/591 (silent:
  power-on, and the loft's scripted SOUND_FADE_OUT_BGM until the thieves come out). Battle music reaches the 10-bit DAC limit
  in up to 0.36 % of a window's samples (0.02 % at the title, also on GS15's routes): apu.c clamps to -512..511 as the GBA
  does. G16.md 5.

### Next
1. From the vault_thieves save: Isaac is down (0 HP) after the battle: revive at the Vault Sanctum; then out by the north
   gate (route in G16.md 2 end: World Map 365,96 at f3064) to the Goma Range (Goma Cave Entrance actor at cell ~401,81):
   Ivan rejoins at the stump (Whirlwind), pillars, Bilibin, Kolima, Lunpa.
2. Use grindbot/battlebot for later fights (battlebot only attacks; Psynergy/Djinn choices would need more box hashes).
3. User items unchanged: permission from alchemy's author (D14), then deploy.

### Notes
- Tests at the end (build unchanged since GS14, web tests not rerun): regress 26/26 OK (`--update` only for the three new
  cases), test_arm 79/79 EQUIV, leak check PASS, code-range audit untouched.
- Battle menus need key presses of 3+ frames; the stairs down on the inn's guests' floor are LEFT from 22,39; Vault's
  ladder climbs only near x 152; after entering the loft, A closes the groan before the party can move.
- No downloads, installs, deploys or permission denials.

## GS15 — 2026-11-02: the Mars Star to Vault's inn by real play (eruption, Vale, World Map, Flint, Ivan); menu pause confirmed; the wipe is the game's

### Done
- **Real play, no probe** (story order from the vendor scene sources first; docs/G15.md 2), three new saves + regress cases:
  - `mt_aleph.keys` (+ `_save`): round the captors (diagonal past Alex), the north loop to the **Mars Star**, the quake, the
    **eruption** (floating rock, the Wise One, Saturos/Menardi take Jenna and Kraden), the Wise One's rescue, Luna/Sol rooms,
    **Retreat** to the Sanctum's first room, Sol Entrance (off the door platform by the west steps), **Vale's eruption**, the
    Great Healer's Sanctum (sepia account, the quest: Yes), Vale's farewell, **World Map**; save there (regress `mt_aleph`).
  - `vault.keys` (+ `_save`): **Flint** and his Djinn lesson (Set/Standby, the lesson battle), the forest and river, a random
    battle, **Hammet's caravan** (the falling rock), **Vault** (round the cliff: the steps at 14,10), the mayor's house:
    **Ivan** reads Isaac's mind and joins; save (regress `vault`).
  - `vault_inn.keys` (+ `_save`): the inn, the guests' floor: **the two suspects flee Ivan**, the plan to corner one; save
    (regress `vault_inn`). Furthest: `port_work/g15/final/furthest_vault_inn_07300.png`; highlights in story order
    `port_work/g15/final/sheet.png` (frames in final/frames.txt).
- **Menu pause (trap 41) confirmed** at Sol Entrance after the eruption: `tests/probes/tasks.cjs` shows the overlay task
  ov37f_SolSanctumEntrance_UpdateEruptionRumbles go c80 -> d80 (suspended) while the Status screen is open and back to c80
  when it closes; main-image tasks untouched. Only the Djinn/Status/(intl) Item screens suspend; the Start pause menu and the
  English Psynergy screen do not (by design: under the pause menu the field keeps shaking, `tests/probes/bgscroll.cjs` counts
  the same 541 scroll changes as with no menu). G15.md 3, trap 41 note.
- **Wipe verdict** (GS14 f23880-23900): the game's own `TRANSITION_WINDOW` variant 2 = WINDOW_TRANSITION_NOISE
  (sol_sanctum_statue.c:369; screen_transition.c:223): our frames show exactly 16 x step + 0..15 px per line. Not a port bug.
- **Audio per second** on sol_star_room (1253/1267 s with sound), mt_aleph (964/992), vault (462/465), vault_inn (119/122):
  every silent stretch is power-on or a scripted SOUND_FADE_OUT_BGM (G15.md 5); no clipping.
- **No port bug found** on any new screen; 0 distinct stubs hit. No asm/C change, so no new EQUIV spec or audit row; the wasm
  was not rebuilt.

### Next
1. From the vault_inn save: the cornering chase on the guests' floor (block a suspect half a second), Ivan's reading, the crate
   room (Move), the loft, the thieves' battle, the Shaman's Rod, then the way to Lunpa (G15.md 2 end).
2. User items unchanged: permission from alchemy's author (D14), then deploy.

### Notes
- Tests at the end (build unchanged since GS14, so web tests not rerun): regress 23/23 OK (`--update` only for the three new
  cases; old rows unchanged), test_arm 79/79 EQUIV, leak check PASS, code-range audit untouched (no vendor C change).
- B answers No at Yes/No prompts; A taps say Yes (the quest, Ivan's request). A late A opens the field menu: B taps after.
- No downloads, installs, deploys or permission denials.

## GS14 — 2026-11-02: code-range audit with a build guard (task.c overlay tasks fixed, trap 41); Sol Sanctum to the Elemental Star Room

### Done
- **Audit** (docs/G14.md 1): `tools/wasm/code_range_audit.py` + `port/tools/code_range_audit.tsv` (file:line + pattern id +
  verdict, no code text): 46 hits in the vendor C, 29 data, 8 safe, 7 fixed, 2 replaced. Runs as build stage `audit`; a
  new unaudited hit fails the build (negative control done). **Real fix**: task.c Task_Suspend/ResumeOverlayTasks
  (`func >> 24 == 2`) never matched a wasm index, so menus never suspended scene tasks; c_rules.tsv + Port_CodeIsOverlay
  (codemap.c). Old regress digests unchanged (no tested path suspends an overlay task). A sprite_draw.c "code-difference"
  rule was tried and reverted (bind.py already binds that routine to its ROM address; trap 41 note).
- **Real play** (`sol_star_room.keys`, story order from the scene sources first; G14.md 3): statue 2 Moved, the round
  passage (a loop; battle), statue 6 Moved to the doorway the second jewel opened, Luna/Sol rooms (Kraden's two events),
  **the statue puzzle** (both beam statues pushed, centre statue Moved into the hole, four seals, Kraden's trap-disarmed
  visit), the Luna/Sol pictures and floor symbol, **rise into the Elemental Star Room**, Venus, Mercury and **Jupiter Stars**
  (Saturos, Menardi, Felix unmasked, Alex). **Save** there (`sol_star_room_save.keys`, regress `sol_star_room`, SHA-1
  571a90a0...). Furthest: Elemental Star Room after the Jupiter event (save-run f75700). Highlights
  `port_work/g14/final/sheet.png`, furthest `port_work/g14/final/frame_75700.png`.
- **No new port bug** on the new screens (G14.md 4); 0 stubs hit.

### Next
1. Mars Star (route in G14.md 3 end: north loop to 19,12 then 14,9), the eruption, Mt. Aleph escape (save + regress case),
   World Map, Vault (Ivan, Inn; save + regress case).
2. Confirm on screen that a menu now freezes a scene task (e.g. the statue room clouds or the World Map), or with a probe.
3. Audio per-second check of the sol_star_room route (tests/probes/wav.cjs + tools/audio_check.cjs) was not run.

### Notes
- Tests at the end (one wasm build kept, probe builds reverted): regress 20/20 OK (`--update` only for sol_star_room; the
  other 19 cases' rows unchanged), test_arm 79/79 EQUIV, leak check PASS, web_touch ALL PASS, web_phone ALL PASS, web_link
  clean PASS (0 console errors).
- B answers No at Yes/No prompts (loops in the star room intro): use A taps through events, B once after.
- No downloads, installs, deploys or permission denials.

## GS13 — 2026-11-02: Sol Sanctum by real play to both Small Jewels; examine events fixed (trap 40)

### Done
- **Save start points**: `tests/routes/sol_sanctum_save.keys` (in SolSanctumCorridor after the first random battle;
  regress `sol_sanctum_save`, SHA-1 6f18f61b...) and `sol_jewels_save.keys` (second relief room, both jewels set;
  regress `sol_jewels`, SHA-1 949d2596...). Both continue with `vale_day1_continue.keys` + `--flash-in`. regress.sh makes
  the saves a case starts from first when asked for alone (chained: vale_day1 -> sol_sanctum -> sol_jewels).
- **Real play, no probe** (`sol_jewels.keys`, story order read from sol_sanctum_entrance.c / _corridor.c / _maze.c first;
  docs/G13.md 2): corridor west exit, the pillar room over water (jump cells), the chest (**first Small Jewel**), the
  first minotaur relief (menu opens itself, Item, Use: the west wall opens), Kraden suspects a hidden passage, **Move** on
  the east statue (the doorway behind it), the room of steps, the maze and its chest (**second Small Jewel**, Isaac Lv 2),
  the second relief room (Kraden: statues out of reach), **Move from a pillar across the water** (range 32 px: only from
  the pillar's north edge), the jump, **the second jewel set**; save. 8 random battles won on the way (A every 40).
  Furthest: second relief room, both jewels set, saved (save-run f33800). Highlights `port_work/g13/final/sheet.png`,
  furthest `port_work/g13/final/frame_33800.png`.
- **Port bug fixed (trap 40)**: searching the relief said "but Isaac can't open it...": Field_ExamineCell tells an event
  routine from a search result by bits 27-24 (FIND_FUNCTION_BITS, set in GBA code addresses); a wasm function pointer
  is a table index 0x10000-0x1ffff (trap 26), so every EVENT examine trigger ran as a locked chest. port/c_rules.tsv rule
  + PORT_IS_CODE_INDEX (port/shim/port_api.h); all FIND_ values are >= 0x100000, so unambiguous. Vendor C, no asm: no
  EQUIV spec needed (79/79 unchanged). Every old regress digest unchanged with the fix.
- **Checked**: every new screen (G13.md 4); the battle background matches the vendor's sol_sanctum.png; audio of the
  whole sol_jewels route 561/564 one-second windows with sound (silent: power-on before the title); 0 stubs hit.
- **Tools**: autowalk `WALK_FIGHT` (battles do not end a walk), `WALK_CENTER` (centre on pillar tops before jumps),
  `s` waypoints end on an entrance change; tools/contact.cjs `SCALE`/`CROP` zoom.

### Next
1. From the sol_jewels save: Move statue 2 off the round passage (104,31) the same way, the Luna/Sol rooms, the
   Elemental Star room, the eruption, Mt. Aleph's escape (save there), the World Map, Vault (save).
2. Grinding only if needed (Isaac Lv 2 at 31 exp; the Sanctum fights are easy with A every 40).
3. task.c's `(task->func >> 24) == 2` is the same code-address-bits pattern as trap 40: check if a task misbehaves.

### Notes
- Tests at the end (one wasm build this session): regress 19/19 OK (`--update` only for the two new cases; old rows
  unchanged), test_arm 79/79 EQUIV, leak check PASS, web_touch ALL PASS, web_phone ALL PASS, web_link clean PASS (0
  console errors).
- Routing: A on a relief while the jewel is held opens the field menu; Item is one RIGHT from Psynergy; Move needs the
  target within 32 px and 8 px of height. Scratch helpers in port_work/g13 (s.sh, walk.sh, bfs.js, r*.keys).
- No downloads, installs, deploys or permission denials.

## GS12 — 2026-11-02: Vale day one by real play from a reproducible save; Saturos and Menardi, Kraden, Sol Sanctum, first random battle won

### Done
- **A reproducible save start point**: `tests/routes/vale_day1_save.keys` (after vale_plaza: A through the opening,
  the roof, Dora's send-off; Start, Save, file 1 at ~f56890) and `vale_day1_continue.keys` (power-on with
  `--flash-in`: title, Continue, in Vale at f1958). `tools/regress.sh vale_day1_save` rebuilds the save in
  port_work/regress/ and checks its SHA-1; later routes start from it (~2,000 frames instead of 57,000).
- **Real play, no probe** (docs/G12.md 2, story order read from vale.c / vale_kradens_cottage.c /
  sol_sanctum_entrance.c first): `vale_sanctum.keys`: the puppies shut the south way until the strangers are met, so the
  north exit past the woman ("Do you need to go past here?"); **Saturos and Menardi** (f3478-6920); Kraden overheard,
  **Kraden plans the Sol Sanctum visit**, his cottage, he sets off (f9060-14500); past the man guarding Mt. Aleph (asks
  at his patrol pauses); **Sol Entrance** (side stairs: the platform's middle is a 16-px step); **Sol Sanctum** and
  Kraden's introduction. `sol_sanctum.keys`: the **stepping stones** (jump cells), the corridor, the **first random
  battle** (three Wild Mushrooms, won; f19052-21532). Furthest: SolSanctumCorridor after the battle (save-run f21800).
  Highlights `port_work/g12/final/sheet.png`, furthest `port_work/g12/final/frame_21800.png`.
- **No port bug found** on any new screen (cutscenes, Save list, Continue, Yes/No prompts, field menu, Kraden's cottage,
  Sol Entrance, the Sanctum rooms and jumps, the Sol Sanctum battle background, rewards); audio present in 330/331
  one-second windows of the route from the save; 0 distinct stubs hit. So no routine ported this session (79/79 EQUIV
  unchanged), no runtime fix, no wasm build.
- **tools/regress.sh**: 17 cases (+ vale_day1_save with its save SHA-1, vale_sanctum from that save); any `--flash-out`
  case now records its save's SHA-1. Old digests unchanged (`--update` only for the two new cases).

### Next
1. Sol Sanctum on (docs/G12.md 2 end): the corridor's west exit (3,37) to the chest room and the first Small Jewel,
   the minotaur reliefs, statues (push or Move), the maze, the Elemental Star room, the eruption, Mt. Aleph's escape;
   then the World Map and Vault (Ivan, Move/Catch use, the Inn). Make a second save inside the Sanctum when the route
   grows (same pattern: a `*_save.keys` + regress case with `--flash-out`).
2. Grinding loop for levels before Vault if fights get hard (Isaac Lv 1, 11 exp now).
3. Run `tools/regress.sh` after every build (~2.5 min now).

### Notes
- Tests at the end (on the GS11 build, unchanged): regress 17/17 OK, test_arm 79/79 EQUIV, leak check PASS, web_touch
  ALL PASS, web_phone ALL PASS, web_link clean PASS (0 console errors).
- Routing: A in the field opens the menu (close the last messages with B); autowalk needs a high WALK_STUCK on event
  cells; mapdump 'J' cells are jumps (G12.md 4). Scratch helpers in port_work/g12 (run.sh, c.sh, walk.sh, probes).
- No downloads, installs, deploys or permission denials.

## GS11 — 2026-11-01: the whole prologue by real play (four monster fights won, to Vale three years later); soft reset works

### Done
- **Story order** read from the vendor scenes first (docs/G11.md 1): the way on from ValeKradensCottage is the rockslide
  survivor's escape path, down the W->E slope at 5-6,29 on the **west** side (GS9 tried the kind-3/4 cliff edges).
- **Real play, no probe** (tests/routes, inputs only): `vale_monsters.keys`: survivor ("No", he runs off), **Vermin won**
  (f11465-12392), **Bat won** (f12686-13252), south exit, **Wild Mushrooms won** (f13553-14762); `vale_felix.keys`:
  Felix in the river and Dora's scene, the south bridge, **Bat + Vermin won** (f20159-21727), into ValePlaza;
  `vale_plaza.keys`: the mayor sends the boys back, the Boulder sweeps Felix, his parents and Kyle away, Garet follows,
  the strangers' battle (lost as scripted), the title after the prologue (f36728), **Vale three years later** (scene 4,
  f36842), Garet's Move lesson (f40000, furthest point). Screens: `port_work/g11/final/sheet.png`,
  `frame_12300.png` (first win), `frame_35500.png` (strangers), `frame_40000.png` (furthest).
- **Soft reset (trap 36)** works (a fork of this session; commits 1be5bc6, 45a3d09): the keypad IRQ slot held garbage
  (gDefaultIrqHandlers relocated for 10 of the 14 handlers the game copies: port/symbols/reloc_extents.tsv) and
  System_SoftReset's constant call of Cart_Start was not routed through Port_ResolveCode. Cart_Start/System_Entry run
  Port_SystemEntry (port_lib.js unwinds with ASYNCIFY, drops the stack, Port_Restart = System_Entry again); System_Entry's
  prologue EQUIV. Tested in node from the field (no save: logos + naming; with a save: title, Continue loads), a battle,
  the link lobby (link2: a resets, b stays in the lobby), the page (web_shot keys). Route `soft_reset.keys`. The page's
  "Return to title" keeps the fresh-module restart (also recovers a stopped run).
- **tools/regress.sh**: 15 cases (+ soft_reset, vale_monsters, vale_felix, vale_plaza), all OK twice. **expected.tsv
  rewritten for every case** on the soft-reset build: only RAM digests changed (function-table indices +1 for the new
  address-taken Port_SystemEntry, emscripten data +0x60, IRQ table entries 10-13 now correct); every picture digest,
  the prologue save SHA-1 and link2's 20/20 agreement were unchanged (checked case by case before `--update`).

### Next
1. Day one in Vale by real play (G11.md 1, row 16 onwards): Garet's Move lesson, Jenna, Kraden's cottage (Saturos and
   Menardi, Kraden's plan), Sol Sanctum; then the first real World Map walk and a town (Vault).
2. Optional: "Return to title" could press the game's own reset when the run is healthy (fresh module only on a stop).
3. Run `tools/regress.sh` after every build (~75 s now); `--update` only for intended changes.

### Notes
- Tests on the final build: regress 15/15 OK (twice), test_arm 79/79 EQUIV, leak check PASS, web_touch ALL PASS,
  web_phone ALL PASS, web_link clean PASS (all 0 console errors). 0 distinct stubs hit in every run.
- One wasm build this session (the fork's); the routing used a private copy of the GS10 build and was replayed on the
  new build with the same scenes and frames.
- No downloads, installs, deploys or permission denials.

## GS9 — 2026-11-01: prologue to the Boulder by real play; Psynergy/Djinn/summon/defeat/World Map exercised; regress.sh

### Done
- **Real play** (no probe): `tests/routes/vale_garet.keys` (Garet heard, drops his chest, joins: 2-member party,
  f~6650), `vale_boulder.keys` (the elders hold back the Boulder with Psynergy, the third rock falls, out west into
  ValeKradensCottage, to 17,22 by the rocks, f~9772). Furthest: `port_work/g9/route/frame_10200.png`, sheet
  `port_work/g9/route/sheet.png`. **The prologue's monster fights are not reached by real play**: every way found is
  walled by the story's rocks, Garet's turn-back, or a level step the game refuses (docs/G9.md section 1).
- **Unported paths exercised** with test-only probes through the game's own routines (Port_CallCode4):
  `tests/probes/party.cjs` (Party_AddMember Garet+Ivan, Unit_LevelUpTo, Unit_LearnPsynergy, Djinn_Give/Set/
  PutOnStandby), `warp.cjs` (Event_SetDestination), `credits.cjs` (Credits_LoadBackground). Played: Quake, Forge
  unleashed, Ray, Mars summon, enemies calling allies, a party member downed, a lost battle (Isaac wakes at home,
  coins 0), field Move/Catch/Cure, World Map walking/idle/menu/random encounter (Zombie), credits slide decoding.
  Routes `battle_party.keys`, `battle_summon.keys`, `battle_lost.keys`, `field_psynergy.keys`, `worldmap.keys`.
- **Fixes/ports**: World Map garbage when standing still (ppu.c reloads BG2/3 X/Y on every DMA write, not only on a
  changed value; trap 38); `TileMap_DrawRows` (menu still picture on the World Map) in C, EQUIV 120;
  `Credits_DecodeBackground` in C (BitDecoder's body with the offset as argument), EQUIV 300. **78/78 EQUIV.**
- **tools/regress.sh**: 11 cases (prologue_save, garet, boulder, battle_fight, battle_party, battle_summon,
  battle_lost, field_psynergy, worldmap, credits, link2), RAM + picture digests (tests/probes/digest.cjs) vs
  `tests/regress/expected.tsv` (digests only); `--update` rewrites; ~32 s; all OK twice (deterministic).
- Routing tools: `tests/probes/pathfind.cjs`, `autowalk.cjs` (records keys; commit them as .keys), `actors.cjs`,
  `tools/path2keys.sh`; `tools/g6run.sh` takes `BIN=`.

### Next
1. Real route to a prologue fight: work out the story order (plaza? survivor in ValeKradensCottage at 4-5,21?) from
   the scene sources before walking; then the plaza, Jenna's family, the river, the next day (G9.md 1).
2. Credits as the game plays them (the ending) and Decompress_HalfwordLz (debug palette editor only) remain unhit.
3. Run `tools/regress.sh` after every build; `--update` only for intended changes (say which case changed and why).

### Notes
- Stubs: 0 distinct hit in every run; 1 logged stub as before. Leak check PASS on every build (4 builds), 0 linker
  warnings. Prologue save byte-identical to GS4's. tools/link2.sh 20/20 agree, b won.
- ppu.c/hw.c are shared with the page: the World Map fix applies there too. port/web, link.c, netlify and
  tests/web_* not touched. tests/web_touch.cjs / web_phone.cjs not run this session (GS10's Chrome runs).
- No downloads, no installs, nothing deployed, no permission denials.

## GS10 — 2026-11-01: link robustness, Return to title, phone check + memory, optional GBA screen colours

### Done
- **Link loss (node, tests/link2.cjs `--silence F-G`, `--cut F`, `--rejoin G`, `--stop0 F`)**: a lost link **never froze
  the game** (LINK.md 3's "permanent pause" reading did not show up anywhere): ~25 frames after "both heard" drops, the
  battle ends on **both** screens with the game's own "The link was disconnected." and the Battle Arena lobby; the lobby
  re-links by itself if messages come back. Tried at battle start, menus, animations, SyncTurn waits (f2450-f3800 in
  150-frame steps) and inside the party exchange. Captures: `port_work/g10/cut2_sheet.png`, `sil_sheet.png`, `ex2_sheet.png`.
- **Short drops**: fresh 300: 2 s / 4 s drops resume; 6.7 s ends the battle cleanly. **Online fresh window now 900**
  (15 s): 10 s drops at 8 points of the battle all resume (20/20 checkpoints agree, same winner); only a 10 s drop over
  the party exchange / battle start ends it (Arena's own 600/900 windows), cleanly. A 5 s drop inside the exchange: the
  exchange completes afterwards.
- **Epoch fix (port/pc/link.c)**: link.c forgets the peer while the transport is not connected, so a new session with a
  partner whose game restarted (reload / Return to title: epochs start again at 1) is accepted; before, every message of
  it would have been dropped as stale. Clean-run RAM digests unchanged (a 48b30b8b, b 032b7941). Stale bulk after a failed
  exchange: dropped by the epoch rule (tested: failure inside the exchange, link back clean). Not routed: a second
  application in the same Arena visit after a failed exchange (the re-join test plays a whole second exchange instead).
- **Page (net.js)**: partner closes the tab -> `bye` on pagehide, the other page at once: "partner left (they left). A
  battle in progress ends ("The link was disconnected.") ... Host or Join to link again, or Return to title." plus a notice
  in the status line (visible over the touch layout, tap clears). Silent partner: watchdog "partner not responding for N s"
  after 4 s, "partner left (no answer for 21 s ...)" after 20 s. Odd Host/Join (all tested, `web_link --odd`): wrong code,
  both Host, Host twice, room full (third player), Leave + Host again: clear statuses, Host/Join never stuck (a failed
  join or expired room used to leave a half-open session). Hash keys now count battles per session.
- **Return to title** (page menu, two taps within 3 s): the game's own soft reset does not work in the port (trap 36), so
  the page drops the running module and boots a fresh one with the ROM bytes it holds (nothing re-read) and the current
  save. Leaves a link session first. `tests/web_link.cjs --leave 3000 [--silent]`: a's tab closes (or goes silent)
  mid-battle, b sees partner left (0.0 s / 20.6 s), b returns to title, a new tab a, b hosts, a joins, the **whole link
  battle plays again**, 20/20 hashes on both, same winner on both screens. PASS both.
- **Memory (phones)**: game.wasm memory section min = max = 3600 pages = **225 MiB, no growth** (identity map up to flash
  at 0x0E000000, D5); C stack 1 MiB, ASYNCIFY stack 64 KiB, audio queue a few KiB. Only **~9.3 MiB of the 225 is ever
  written** (149 non-zero 64 KiB pages at f3000 of a link battle; 8 MiB of it the ROM). Chrome (phone emulation): the
  page's renderer 147 MiB on the ROM picker -> 209 MiB with the game running (+62: wasm code, ROM copies, touched pages);
  JS heap 11 MiB; three restarts: 243 -> 254 MiB (old runs freed). Not changed: under 256 MiB, and shrinking needs D5's
  offset-mapped fallback (a C/bind.py change) — not justified by these numbers. Real iOS Safari still has to confirm the
  225 MiB reservation is granted (older 2-3 GB iPhones are the risk).
- **tests/web_phone.cjs** (new; mobile iPhone UA, touch): 390x844, 412x915, 844x390: no pad control over the picture,
  all inside the viewport, link notice off picture and pad (fixed for landscape: status strip under the picture),
  menu by touch: touch setting, Mute, Volume, GBA screen colours, Return to title, link panel Host/code/Join all
  reachable and >= 44 px, toggles work, code field focuses; restarts; **ALL PASS, 0 console errors**. Screenshots
  `port_work/phone/{portrait,portrait_menu,portrait412,portrait412_menu,landscape,landscape_menu,portrait_after_restart}.png`.
- **GBA screen colours** (rule 7: default off, localStorage `gs-lcd` in try/catch, page menu checkbox, `?lcd=1/0` test
  override): higan/bsnes GBA LCD curve (LCD gamma 4.0, channel mix, out gamma 2.2, white 255/280) as a 32768-entry LUT
  on the canvas copy only; game memory, hashes and online untouched. Storm-night Vale before/after:
  `port_work/g10/lcd0/web_02101.png` / `port_work/g10/lcd1/web_02100.png` (save port_work/g4/flash.sav, Continue).

### Next
1. C side (another session, hw.c/codemap): make the game's own soft reset work (trap 36), then "Return to title" can
   press it instead of restarting the module.
2. Real phones: iOS Safari memory (225 MiB reservation), touch feel, pagehide `bye`, a backgrounded tab > 15 s (ends the
   battle the game's way). Real network drops between two machines.
3. Optional: a route for "failed exchange -> apply again in the same Arena visit".

### Notes
- Regressions: tools/link2.sh (private copy of my build) 20/20, b won, same digests; 76/76 EQUIV + negative controls;
  prologue save cmp OK; leak check PASS; tests/web_touch.cjs ALL PASS; tests/web_link.cjs clean PASS and
  `--netsim 100,0.1,20` PASS (RTT ~213 ms, 20/20); `--odd --leave 3000` PASS; `--leave 3000 --silent` PASS.
- One wasm rebuild (link.c only) at 20:53 while the tree had no foreign C edits; GS9's later hw.c/ppu.c edits are not in
  it and were not staged. No downloads, installs, deploys or permission denials.
- Confidence: high for the link-loss behaviour and page handling (seen on both screens, node + two-page Chrome); high for
  the restart (three restarts, memory flat, full second battle); medium for phones (emulation only).

## GS8 — 2026-11-01: online link battle between two pages (G7, local): WebRTC transport, rooms, hello, hash guard

### Done
- **port/web/net.js**: `Module.linkTransport` on one RTCPeerConnection, negotiated channels `frame` (id 1, unordered,
  maxRetransmits 0) and `bulk` (id 2, reliable); our control JSON (hello/refuse/bye/ping/pong/hash) as text on bulk.
  link.c and the wasm unchanged. playerId 0 = room host.
- **Rooms**: `port/netlify/functions/room/{core,room}.mjs` (adapted from GoldenEye's: 2 players, ROM SHA-1; Netlify
  Function v2 on Blobs, `@netlify/blobs` declared in `port/netlify/package.json`, NOT installed, NOT deployed);
  `tools/roomserver.mjs PORT` local copy for tests, `--selftest` 21/21. Manual copy-paste codes as fallback.
- **hello**: build id (`build_id.js` from tools/site.sh: SHA-256 of game.wasm + game.js, 16 hex), ROM SHA-1,
  edition 'en', roles; mismatch -> both pages "link refused: ..." (tested with --manual --refuse).
- **Online settings**: `Port_LinkSetFreshFrames(300)` on accept; Worker ticks (4 ms) drive the frame wait while the
  page is hidden; per-turn hash at each gBattleRandomSeed change, non-blocking panel warning + `[net] DESYNC` log on
  mismatch. **No WaitSync override needed** (passes at a ~510 ms round trip; LINK.md section 8 table).
- **Page**: panel "Link battle online" (details): Host (room code shown big), code field + Join, status line,
  round trip, Leave, manual codes, desync warning; 44 px targets (checked by the test). `?netsim=DELAY,DROP,JITTER` or
  `lat:,jit:,loss:`; `?roomapi=`, `?stun=none` test aids. Test key hook `window.__gsScript` (frame-indexed keys).
- **tests/web_link.cjs**: one muted headless Chrome, two browser contexts (own IndexedDB), local static + room server,
  host/join by the panel buttons, link routes to the end of the battle. Results (all PASS, 0 console errors/warnings):
  clean: linked at f~250, 20/20 hashes equal, "b won (a down on both screens)", tally saved; `--netsim 100,0.1,20`:
  RTT ~210 ms, ~380 frames dropped per side, 20/20, same result; `--netsim lat:80,jit:20,loss:2` (the PLAN exit profile): RTT ~170 ms, 20/20, same result;
  `--netsim 250,0.1,30 --frames 8000`: RTT ~510 ms,
  20/20, same result (battle ends ~f5700 instead of ~f3850); `--manual --refuse`: both refuse. Page b is hidden in
  headless (trap 35) and still ran 59.6 frames/s on worker ticks.
- Captures (gitignored): `port_work/g8/clean/sheet.png`, `port_work/g8/netsim/sheet.png`,
  `port_work/g8/netsim250/sheet.png` (a | b side by side: lobby, apply, battle start, attacks, down/felled, results saved).
- Docs: LINK.md section 8 (implementation, timing table, going-live steps), PLAN G7 note, orchestrator status, traps 34-35.

### Next
1. User: permission from alchemy's author (D14). Then deploy per LINK.md 8 "Going live" (site + function; npm install
   of @netlify/blobs in the deploy step) and one real session across two networks (PLAN G7 exit, second half).
2. Tests: partner leaves mid-battle (expect the game's link-lost message after 5 s), failed exchange + retry, a real
   hidden desktop tab, phones (iOS memory, D5).

### Notes
- Regressions: tools/link2.sh 20/20 agree, b won, same digests as before; 76/76 EQUIV; prologue save cmp OK; leak
  check PASS; tests/web_touch.cjs ALL PASS. No downloads, no installs, nothing deployed, no permission denials.
- First netsim run failed (RTT 1.1 s on the hidden page, battle stalled after two turns): netsim's setTimeout delays
  were throttled in the hidden page; fixed by draining the netsim queue every game frame (trap 34). Not a transport bug.
- Confidence: high for the local online path (seen on both screens, hashes, three network profiles); medium for real
  networks (STUN-only NAT traversal untested; D15 means some pairs cannot connect).

## GS7 — 2026-11-01: local link battle end to end (G6, D21): link.c over a message transport, two instances

### Done
- **D21** recorded (coordinator): G6 uses an in-memory version of the G7 message channel, not register-level SIO.
- **port/pc/link.c** replaces Serial_Initialize, Serial_PollStatus, Serial_ExchangePayloads, Serial_StartSend,
  Serial_StartReceive, Serial_StepBlockTransfer (port/fn_overrides.tsv, 12 overrides now): 24-byte payload per VBlank
  on an unreliable newest-wins channel, bulk transfers whole on a reliable channel (send done when the peer's frames
  report it consumed), sender epochs per Serial_Initialize, SIOCNT SD/SI/id bits plausible, "both heard" held for
  `Port_LinkSetFreshFrames` (12) frames after the newest peer frame. No asm ported (all C), so no new EQUIV spec.
- **Transport interface** `port/pc/link_transport.h` -> JS imports in `port/web/port_lib.js` -> `Module.linkTransport`
  {connected, playerId, send, recv}; **in-memory pair** `port/web/link_loopback.js` (delay, drop, jitter, seed).
  link.py: the four imports are not stubs.
- **Runner** `tests/link2.cjs` (+ `tools/link2.sh`): two wasm instances in one node process, frame lockstep (A then
  B), own flash each, inputs per instance, `--hash` mirror check at every gBattleRandomSeed change (a's party unit =
  b's enemy unit and the reverse, names/side byte excluded), RAM digests, side-by-side contact sheets.
  Routes `tests/routes/link_arena.keys`, `link_lobby.keys`, `link_fight.keys` (inputs only).
- **How far**: all the way. Title -> File Screen Battle -> Battle Arena lobby (link up f1510) -> attendant, apply Yes
  (both `0123`) -> circle (`ABC1`) -> party exchange (4 bulks each way, f2353-2427) -> `EXEC` -> "EnemyIsaac appeared!"
  on both -> 4 turns, both Attack (12 bulks each way in all) -> the parent's Isaac falls: a "Isaac goes down in
  defeat...", b "You felled EnemyIsaac!" -> back to the Arena, tally a 000 / b 001, "Battle results were saved.".
  20/20 checkpoints agree, same winner on both screens.
- **Delay/drop**: `--delay 1/2/3`, `--drop 0.2`, `--delay 2 --drop 0.3 --jitter 2`, `--delay 3 --drop 0.5 --jitter 3`
  (3696 of 7380 frame messages dropped): all reach the end, all checkpoints agree, same result. Same args -> same RAM
  digests run to run (deterministic). No desync.
- Captures (gitignored): side by side (a | b per pair, 2 pairs a row) `port_work/g7/shots/sheet_00.png` (lobby, apply,
  circle, exchange, battle start, attacks, defeat/felled, results saved); whole runs `port_work/g7/r8/sheet_0*.png`.
- Docs: docs/LINK.md section 7 (implementation, results, **what G7 needs**), orchestrator D21 + traps 32-33, PLAN G6.

### Next
1. G7: WebRTC transport object (frame channel `ordered:false, maxRetransmits:0`, bulk reliable) behind the same
   interface; rooms/signaling after GoldenEye's net.js + Netlify room function (read only); `hello` with build id, ROM
   SHA-1, edition; `Port_LinkSetFreshFrames(~300)` online; keep stepping when the tab is hidden; per-turn hash message.
2. Tests not done: link loss mid-battle, failed party exchange + retry (stale bulk), parties with Psynergy/Djinn.
3. Optional for PLAN G6's exit wording: two instances in one page with a recorder.

### Notes
- Tests: 76/76 EQUIV; leak check PASS (every build); 0 linker warnings, 1 logged stub (`_call_via_r0`); prologue save
  byte-identical to GS4's (`cmp` OK); tests/web_touch.cjs ALL PASS (0 console errors). No downloads, no installs, no
  permission denials. Trap 2 bit once (zsh loop args): matrix rerun under bash.
- Confidence: high for the local path (seen on screen and by the mirror check); medium for online timing (the fixed
  game windows were not stressed beyond 3 frames + jitter 3).

## GS6 — 2026-11-01: battles run (node + Chrome); battle-path ports EQUIV; link battle survey

### Done
- **Battle entry (test only)**: `tests/probes/battle.cjs` writes the ROM's formation for zone 12 slot 2 (the stormy
  night's monster, formation 3: two Wild Mushrooms) into `gFieldWork->encounter` at frame 5400 of the prologue
  route. That is what `Field_RequestBattleFromEncounterTable` writes; the game's own path does the rest (transition,
  SEQUENCE_BATTLE, Battle_RunFar, return to the scene). In Chrome: `tests/web_shot.cjs --battle FRAME`. No scripted
  route to the prologue's own fights yet (they are past the bridge, docs/G6.md section 1).
- **What plays** (node and muted headless Chrome, 59 fps, 0 console errors): the transition, the rainy Vale
  background, Isaac and the mushrooms, "appeared!", Fight/Attack/target menus, Isaac's slash with damage, the enemy
  attacking (HP 30 -> 26), both enemies felled, 2 XP and 4 coins, back to ValePrologue. Flee works too. Psynergy:
  Isaac knows none in the prologue. Routes `tests/routes/battle_fight.keys`, `battle_flee.keys`.
- **Ports (D6/D20)**: BitDecoder_DecodeImage (the last battle-path asm stub), RelocatedQ16DotProduct, the eight
  PaletteFade_*Kernel routines, and the generated battle-effect blitters (vendor builder kept; Port_BlitterBuilt
  hook aliases each built routine to a C blitter with the same parameters; EQUIV over every width/flag/mode set,
  negative controls fail). Harness: arguments 5+ on the stack. **76/76 EQUIV** (incl. GS-audio's 22).
- **Division fix**: vendor divisions by a variable now call our libgcc ports (bind.py): a zero divisor no longer
  traps (Unit_UpdateGauges, enemy ppMax 0) and `%` has the ROM's sign rule. Prologue save byte-identical.
- **Link survey** (task 3): `docs/LINK.md`: call graph File Screen -> Battle Arena -> serial.c/link.c/turn.c, partner
  detection (multiplayer SIO, SD/SI, timer 3 reload 0xC963 clocking ~20 halfwords a frame on the parent), the
  per-VBlank 24-byte payload, party exchange (3 x 340-byte units + 320-byte Djinn table), the per-turn header +
  actions and RNG check, the sync signatures, timeouts, sub-frame assumptions (timer-3 handler reads SIOMULTI
  without a busy check; a packet must fit between VBlanks; nested IRQs), PC-layer gaps (no SIO emulation, no serial
  IRQ, no nesting), and the proposed B' cut at serial.c's API via fn_overrides. Written by a research subagent,
  reviewed here.
- Captures (gitignored): `port_work/g6/t/sheet.png` (whole fight), `port_work/g6/b/sheet.png` (opening),
  `port_work/g6/p/sheet.png` (flee), Chrome `port_work/g6/web/web_02401.png`, `web_02900.png`.

### Next
1. A real route to the prologue's monster cells (behavior 16 at cells 4-5,54 across the bridge; 17 at 23,85):
   walking west stops at 15,56, so find the way down to the bridge (mapdump/where).
2. Psynergy, Djinn and summon effects (other effect handlers, particle streams) once a party has them; a lost battle.
3. G6 per docs/LINK.md section 6: port/pc/link.c behind fn_overrides (Serial_*), in-memory message channel
   between two instances (the survey suggests this over register-level SIO: orchestrator decision, PLAN G6 note).

### Notes
- Traps 29-31 (new): generated blitters; wasm division traps; committing shared test files holds other sessions'
  edits (it happened once this session: undone with `git reset --soft`, re-staged hunk-only, nothing of GS-audio's
  went in under GS6's name).
- `tools/g6run.sh`: node runs on a private copy of build/wasm (a concurrent session's rebuild cannot change it).
- Build: leak check PASS on every build; 0 linker warnings; 1 logged stub (`_call_via_r0`, dead code).
- No downloads, no installs, no permission denials. port/web/ not touched; audio files not touched.

## GS-audio — 2026-11-01: sound: m4a sequencer and Camelot's mixer in C, GBA sound output, page AudioWorklet

### Done
- **Ports (D6/D20)**: `port/pc/m4a.c` (MPlayMain, ply_note, ply_* commands, ply_endtie, TrackStop,
  m4aSoundVSync) and `port/pc/mixer.c` (Mixer_Enter + the resident IWRAM mixer: envelopes, block mixer, three
  resampler kernels and the general loop, synth waves, clipping, render to the DirectSound buffers, the five
  reverb codes). The 9 audio asm stubs are gone (2 stubs left: BitDecoder_DecodeImage, _call_via_r0).
  **EQUIV**: the 20 ply_* commands + TrackStop (1500 random tracks each) and **Mixer_Enter on 300 whole VBlanks**
  (1-12 channels, every path, every reverb code). **67/67 EQUIV**, negative controls detected. Two bugs found by
  the specs and fixed (ply_rept's untruncated count; kernel group mul).
- **GBA sound output** (`port/pc/apu.c`, hooks in hw.c, CpuSet guard in bios.c): FIFO A/B popped on Timer 0/1
  overflow, refilled by the sound DMAs (timing 3); PSG 1-4; SOUNDCNT_L/H/X mix; 32768 Hz stereo s16 ring.
- **Page** (`port/web/audio.js`, small edits to main.js/index.html/site.sh): AudioWorklet (ScriptProcessor
  fallback), first-gesture start (window capture listeners, touch pad counts; touch.js untouched), Mute + Volume
  in the page menu (localStorage `gs-audio`), never paces the game.
- **Plays**: title music (from the Golden Sun logo on), title with a save, menu SEs, the prologue's music.
  WAVs (gitignored): `port_work/audio/boot.wav` (900 frames, SHA-1 b0e0c62d.. on two runs), `title.wav`,
  `title_menu.wav`. Spectral check: no clipping, peaks <= 23808, steady tones ~248/80/664 Hz.
- **Chrome** (muted, `node tests/web_shot.cjs 300,900 --flash port_work/g4/flash.sav --press 60:KeyZ --audio`):
  worklet running at 48 kHz, 82 % of received samples non-zero, 0 dropped, 60 fps over 4 s, 0 console errors.
  `tests/web_touch.cjs` ALL PASS. Leak check PASS on every build.
- Tools: `tests/probes/wav.cjs` (boot.cjs --probe, `WAV=`, `WAV_FROM=`), `tools/audio_check.cjs`, web_shot `--audio`,
  harness `spec.sp`. Notes: **docs/AUDIO.md**.

### Next
1. EQUIV specs for ply_note, MPlayMain, m4aSoundVSync (need SoundInfo + voice tables + channel pools in the
   harness).
2. Listen on a real browser (the user) for pitch/balance; compare a WAV with an emulator recording if one is
   allowed. PSG details (wave RAM banks, zombie envelopes) if something sounds off.
3. A gamepad-free mobile check of the Mute control on a real phone (iOS needs the gesture: touchend counts).

### Notes
- No downloads, no installs, no permission denials. Shared files touched additively: hw.c (timer/DMA hooks),
  bios.c (CpuSet skips wasm-function sources), web_shot.cjs (`--audio`), harness.js (`spec.sp`), overrides.tsv rows.
- Trap: the resampler kernels are patched code; their "mulne" keeps a stale product when the previous delta is 0
  (kept in C). The original DMAs sample data onto its stack when the sample does not end in the frame: tests run
  it with sp in IWRAM so it never does (pure speed trick, same values).

## GS5 — 2026-11-01: storm colours checked (game logic, EQUIV), RAM position readout, route into CottageRoomsA

### Done
- **Storm night (task 1)**: not a port bug. The bright yellow-green night is the ROM's own PALETTE_TINT_WARM
  (Weather_StartLightning): palette RAM = the tint of the scene's source palette, 224/224 colours (house and Vale),
  and **PaletteFade_Build (vendor C) is EQUIV to the ROM's code** (new diff spec, 1200 cases, every per-colour
  mode; negative control fails as it should). No BLDY/brightness or window darkening is set; the lightning flashes
  and fades play. A real GBA's unlit LCD makes it look much darker: if wanted, an optional "GBA LCD colours"
  page filter (rule 7, default off): a user decision, not done. Frames: `port_work/g5/storm/frame_05470.png`
  (night), `frame_05478.png` (flash), `sheet.png`. Notes: docs/G5.md section 1.
- **Test hook** `Port_CallCode4(gba, a, b, c, d)` (port/pc/call_via.c): calls the vendor C function at a GBA
  address, so diff.cjs can check vendor C against the ROM (harness `spec.call`). **43/43 EQUIV.**
- **Routing tools (task 2, test only)**: boot.cjs `--probe` hooks; `tests/probes/where.cjs` (scene + name,
  entrance, map id, leader x/y/z and cell from RAM); `tests/probes/mapdump.cjs` (cell behaviors or heights as
  ASCII); `tools/route.sh`. RAM offsets in docs/G5.md section 2.
- **Route (task 3)**: `tests/routes/vale_cottage.keys`: past the first rock, north past Isaac's house, east up the
  slope, into **CottageRoomsA** by its east door (scene 7, f~5755) and back out; no new stubs or unknown
  addresses. Furthest: `port_work/g5/furthest_cottage.png`. No battle reached.
- **Touch test (task 4)**: `tests/web_touch.cjs` on the current game.wasm: **ALL PASS**, 0 console errors; no test
  fallout, nothing changed.

### Next
1. Route on: through CottageRoomsA's other doors back into Vale, toward Garet (step triggers 30/31 near cells
   19-21,38-42) and the plaza exit (trigger 5 at 30,86); plan with mapdump/where (docs/G5.md section 3).
2. Before the first battle: BitDecoder_DecodeImage and the battle blitters (not hit yet).
3. Ask the user about an optional LCD colour filter for the page.

### Notes
- Build: leak check PASS; 0 linker warnings; 12 logged stubs (10 asm). The build compiled whatever was in
  port/pc at the time, including the audio session's untracked m4a.c/mixer.c (not committed by GS5).
- Trap 28 (new): bind.py routes every indirect call in port/pc through Port_ResolveCode, so codemap.c (which
  defines it) cannot hold an indirect call ("invalid redefinition"); test hooks that call through pointers live
  in call_via.c.
- No downloads, no installs, no permission denials. port/web/ not touched.

## GS4 — 2026-11-01: G3 exit met (title + file menu from an in-game save); prologue plays, Isaac walks in Vale

### Done
- **Ports (D6/D20)**: Render_DecodePicture, Tile_CopyStrided, Decompress_ByteLzArm in C, each EQUIV against the
  ROM's own code (diff.cjs specs; harness `spec.ignore` for a routine's writes into its own RAM copy). **42/42
  EQUIV**, negative controls detected. 16 of the 51 code-as-data routines ported.
- **Runtime**: DMA copies of vendor C routines by wasm function pointer now copy the ROM's bytes and alias the copy
  (Tile_BuildCellPictures); link.py adapters for K&R calls with differing argument counts and for veneers with
  differing signatures (0 linker warnings, was 8; START no longer traps); `_call_via_r3` fixed (c_rules.tsv +
  call_via.c, also the flash program call of Save_WriteSector).
- **Function pointers above message ids**: a step trigger's word is a message id or a routine, told apart by
  size (< 65536); our table indices were small, so the first rock's routine showed message 2891 ("Power").
  `-sTABLE_BASE=65536`, `-sGLOBAL_BASE=131072`, `PORT_IS_TABLE_INDEX`, and `-sEMULATE_FUNCTION_POINTER_CASTS=1`
  (indirect calls with differing types no longer trap). game.wasm 4.4 MB, node ~2500 fps, Chrome 58 fps.
- **Plays**: name entry -> Isaac's house (Dora, Kyle, lightning) -> outside in the rain -> Yes to Dora -> free
  walking in Vale (ValePrologue, stage SENT_TO_PLAZA) -> ValePrologue_FirstRockFalls (the rock drops across
  the path south of the house) -> west past the tree to the bridge. Start -> Pause menu -> Save your quest -> file 1 ->
  "Your game was saved." (frame 5170, deterministic bytes). Reboot with that flash: **the real title intro and
  title** (Mt. Aleph, clouds, sun, PRESS START, (c)2001 Nintendo / CAMELOT) and the File Screen icon menu with
  Continue, in node and in muted headless Chrome (58 fps, 0 console errors). Matches the vendor's `screen.png` and
  `intro_clouds.png` by eye.
- Tools: boot.cjs key taps (`A@700-4400/40`), `--keys-file a,b`, `--every`, `--flash-in/--flash-out`, `--regs`;
  web_shot.cjs `--flash` (IndexedDB before start), `--press FRAME:CODE`, `OUT=`; `tools/contact.cjs` sheets;
  routes `tests/routes/prologue.keys`, `first_save.keys`, `first_rock.keys` (inputs only).
- Captures (gitignored): `port_work/g4/sheet1.png` (logos -> house -> Vale), `sheet7.png` (save), title
  `port_work/g4/title/frame_00900.png`, file menu `title/frame_01200.png`, Chrome `port_work/g4/web/web_00901.png`
  (title), `web_01201.png` (file menu); the rock: `port_work/g4/sheet13.png`, `sheet_rock.png`; flash
  `port_work/g4/flash.sav`. Notes: docs/G4.md.

### Next
1. Script the rest of the prologue (route north of Isaac's house, then the plaza; stages in vale_prologue.c's
   header). A RAM position readout for the leader would make routing much faster than blind key scripts.
2. Run tests/web_touch.cjs again on the new game.wasm (not rerun here: Chrome desktop run is 0 errors).
3. G4: palette fade kernels, BitDecoder_DecodeImage + battle blitters before the first battle; m4a audio; mosaic.

### Notes
- Tests: `tools/test_arm.sh` 42/42 EQUIV; leak check PASS on every build; web_shot 0 console errors. No downloads,
  no installs, no permission denials. `port/web/` not touched (the touch agent's); no page change needed: the save
  is put into IndexedDB by the test before the page starts.

## GS-touch — 2026-11-01: touch controls (orchestrator rule 11)

### Done
- `port/web/touch.js` + `touch.css` (design from GoldenEye's touch.js / Conker): 8-way D-pad (one zone, the finger
  slides between directions incl. diagonals, pointer capture), A, B, L, R, Start, Select, a page-menu button (the
  page with the setting and "Back to the game"). Multi-touch (per-pointer state), buttons light up, short vibration
  where supported. Portrait: picture on top at full width, pad below; landscape: picture centred, D-pad/L/Select left,
  A/B/R/Start right. Every key released on rotation (layout sees portrait<->landscape, orientationchange,
  screen.orientation change), touchcancel, blur, hidden page. No scroll/zoom/selection while playing (viewport
  user-scalable=no, touch-action, user-select, gesture/dblclick/touchmove blocked).
- Setting "Touch controls" Auto (default; coarse pointer or touch + mobile UA) / On / Off: only an explicit choice is
  stored (localStorage `gs-touch`, try/catch); `?touch=1` / `?touch=0` override. On touch devices the ROM picker
  drops its `accept` filter (iOS greys out .gba).
- One input path: main.js does `Port_SetKeys(held | GSTouch.keys())` once per frame; keyboard unchanged.
- `tests/web_touch.cjs` (muted headless Chrome, phone emulation 390x844 then 844x390, waits for other headless
  Chromes): **ALL PASS** — Auto on, layout checks, D-pad up -> KEYINPUT 0x3bf, multi-touch up+R, lift one finger,
  slide up -> up-right -> right, release, name-entry cursor moves (~470 px changed) in both orientations, rotation
  while holding releases everything, keyboard still drives KEYINPUT, menu/back by touch, 0 console errors.
  `tests/web_shot.cjs` (desktop) still 0 errors, pad hidden. Screenshots: `port_work/touch/portrait*.png`,
  `landscape*.png`, `landscape_menu.png` (gitignored).

### Notes
- CDP trap: in `Input.dispatchTouchEvent`, touchStart/Move list the active points but **touchEnd lists the lifted
  ones** (empty = all); leaving a point out of a touchMove does not release it.
- Not done: gamepad API (would OR into the same `held`), a full-screen button, real-device check (iOS Safari).

## GS3 — 2026-11-01: G3 partial: test interpreter (D20), 39 EQUIV ports, boot to the File Screen, page v1

### Done
- **D20** (coordinator decision): our own ARMv4T interpreter for tests (`tests/arm/arm7.js`), the differential
  harness (`tests/arm/diff.cjs`, `harness.js`) and negative controls (`selftest.cjs`); `tools/test_arm.sh`.
  **39/39 routines EQUIV** against the ROM's own code: the IWRAM routines, trig, heap release, CpuSet and
  SoundBias (vs a GBATEK reference), the decoders on all 1000 ROM resources, the message decoder on real
  messages, the OAM builder, tile packers, map grid converter, register write queue... (list in docs/G3.md).
- Of the 23 asm stubs of G2, 13 are gone; **10 asm stubs left**: MPlayMain, SoundMain, Mixer_Enter, TrackStop,
  m4aSoundVSync, ply_note/endtie/lfos/mod (audio, G4) and BitDecoder_DecodeImage (battle). Plus
  SoundMainRAM_Rom and _call_via_r0 (other). 13 of the 51 code-as-data routines ported.
- **Runtime**: indirect calls by GBA address through `Port_ResolveCode` (bind.py IR rewrite + generated code map
  + DMA-registered aliases for RAM copies); overlay switching from the overlay decode (D7); frame driver with
  HBlank/VCount/VBlank/timer/keypad IRQs dispatched in IwramIrqMain's order (D8); DMA immediate/VBlank/HBlank;
  timers; keypad; flash at the driver API (`port/fn_overrides.tsv`: new mechanism, bind.py drops the vendor body,
  port_src.py marks it noinline); VCOUNT busy-waits via `port/c_rules.tsv` (new text rule table).
- **PPU v1** (modes 0-2, sprites incl. affine, windows, blending; no mosaic/bitmap modes).
- **Page v1** (`port/web`, `tools/site.sh`): picker with size + SHA-1, IndexedDB ROM and save cache, canvas,
  keyboard, 59.73 Hz with ASYNCIFY suspension; `tests/web_shot.cjs` (muted headless Chrome over CDP, node static
  server, waits for any other headless Chrome, kills only its own). ~59 fps, 0 console errors.
- **Boot**: Nintendo logo (f120), Camelot logo (f250), Golden Sun logo (f380), File Screen name entry (f600),
  same frames in node (4000 fps) and Chrome. Checked by eye against the vendor's own `nintendo_splash.png`,
  `camelot_logo.png`, `golden_sun.png`. Captures: `port_work/g3/frame_00120/00250/00380/00600.png`,
  `web_00121/00254/00381/00600.png` (gitignored). The full title screen (`screen.png`: sky, peak, copyright,
  PRESS START) only shows when a save file exists (Title_Run); not reached.
- Leak check: halfword counting runs are trivial now (the wasm's element section encodes such runs); PASS on
  every build. game.wasm 3.7 MB (ASYNCIFY + names section).

### Next
1. `tools/boot.sh 1000 --keys A@650-652` confirms the name and enters Isaac's house (overlay 377); it stops at
   `Port_ResolveCode: no function at 0x03003400` = a RAM copy of **Render_DecodePicture** (field/picture_decode.s).
   Port it with a diff.cjs spec, then follow the next unknown address (Tile_CopyStrided, TileMap_DrawRows,
   Decompress_ByteLzArm, palette fade kernels are likely next on the field path).
2. A save file, to reach the real title screen: play the prologue to the first save (scripted keys) or record a
   run; then G3's exit (title + file menu) is met.
3. G4: m4a audio (the 9 sound stubs + mixer), mosaic, touch controls (rule 11).
4. Watch: `_call_via_r3` is one C function taking four words; field_psynergy.c declares it void(s32, s32), which
   wasm-ld turns into a trap stub (signature mismatch warning).

### Notes
- No downloads, no system installs, no permission denials that blocked work. One `rm` with a relative glob was
  refused by the safety check (`rm .../port_work/g3/*` after a `cd`); re-run with absolute paths.

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

- **G3 started** (one step): relocated tables filled at run time (`Port_RelocateAll`/`Port_RelocateOverlay`,
  412 symbols, 3,022 patched slots), the PC layer compiled through the same binding, game.js is a factory
  (`GoldenSun`, no auto-run). `tests/reloc_probe.cjs` (node, in the emsdk image) passes.

### Next (G3)
1. **Decide how to test the hand ports of the asm routines (D6).** Their exact behaviour matters and is not
   always C's (e.g. IwramSignedRemainder gives the remainder the sign of dividend XOR divisor). GS0 planned
   unit tests against the original ARM code run on the ROM's bytes: that needs an ARM/Thumb interpreter for
   tests. Options: write our own small one (no download), or use an existing emulator core (a download: needs
   approval). Ask the user/coordinator before writing the 23 boot-path ports.
2. PC layer core: frame driver (Port_BiosHalt yields: synchronous in node tests, a fiber/asyncify in the page,
   D8), IRQ dispatch in the dispatcher's priority order (HBlank, VBlank, VCount, Timer3, Serial, Timer1,
   Timer2, Keypad, GamePak; handlers that are still GBA addresses after the IWRAM copy need a GBA->wasm map),
   DMA (Port_DmaWritten: immediate now, VBlank/HBlank/FIFO later), timers, KEYINPUT, Port_Iwram*, BIOS SWIs.
3. Overlay dispatch (entry tables at 0x02008000) + Port_RelocateOverlay in the load path; the 51 code-as-data
   uses (`build/wasm/code_as_data.tsv`).
4. Renderer v1 + page v1 (ROM picker, SHA-1, keyboard; touch controls are required before the first public
   build); boot in muted headless Chrome (one at a time; wait until no other Chrome runs).

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
