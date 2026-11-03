# TLA6: playable, part 1 (2026-11-03): new game to Jenna under control, save and continue; /tla/ site prep

## 1. Furthest real play

`tools/regress_tla.sh` (routes in tests/routes/tla, digests in tests/regress/expected_tla.tsv), node, empty save:
logos, Felix naming, "Transfer data from Golden Sun?" -> No, Isaac naming, then the opening: a Nintendo logo again
and the intro (clouds, "Camelot presents", "Golden Sun Book Two", the flight to Venus Lighthouse, "The Lost Age"),
the Venus Lighthouse talk (Jenna, Kraden, Alex: "We tried to stop Felix", "Our methods may differ...", Alex leaves),
the quake, the area name "Venus Lighthouse" and **Jenna under the player's control** at the aerie's door (~14,450).
Walking (diagonals off the door cell, down and left on the platform, up into the aerie and back), the field menu
(Psynergy: "No usable Psynergy"), **the pause menu -> Save your quest -> file 1 -> "Your game was saved"** (flash
written), and **power-on with that save -> the intro -> Continue (file 1: Jenna, Venus Lighthouse, L 5, 0:04, 200
coins) -> back in the field** all work. The first battle was not reached (the way down the lighthouse was not found
by hand in the time; no TLA path tool yet). Contact sheets (local): port_work/tla6/d/contact.png (talk to control),
port_work/tla6/s/contact.png (save), port_work/tla6/r/contact.png (continue).

## 2. Port bugs fixed (each the stop of the run before)

1. **Relative halfword jump tables** (asm2c, `Fn.rel16_table`): picture_decode.s and field_sequence/decode_picture.s
   jump into their colour-table modes with `ldrsh r4, [pc, r4]; add pc, pc, r4`. Stop: "asm2c: continuation at
   0x08020ef4" when the intro's first map picture was decoded. D20: diff_hw input rule (modes 0-15), both decoders
   60/60 EQUIV (before: 4 and 7 cases, mode 0 only).
2. **`bl` used as a long jump** (asm2c): Func_080cf78c's `bl .L_080d00e2` never returns; the chain after its return
   point ran into the pool and the whole routine failed ("thumb halfword 0xf6fd"), so it was a stub (stop at 14,549,
   "stub: Func_080cf78c"). A failure on a chain reached only from a return point now marks that point dead and the
   routine is translated again without it. hw2c's byte listing is tried first, the vendor's listing (which has the
   labels) next. Func_080cf78c, Func_08173aac and Func_02002f64@681 translate (1,423/1,428). D20 batch: these three
   are NOINPUT (generic worlds do not run them; Func_080cf78c runs in the game without a stop). Allow row 0200af64
   removed.
3. **A direct call cast to another type** (link.py): data_lookup_routines.c calls the s8 BattleEffect_GetResourceGroup
   through `((s32 (*)(s32))BattleEffect_GetResourceGroup)`. LLVM gives such a call a trapping `_bitcast_invalid` stub,
   wasm-opt made Scene_GetAreaNameIndex `unreachable`, and the area-name notice trapped (stop "RuntimeError:
   unreachable" in UiTimedNotice_Create). adapt_mismatched_calls also sends a call whose type differs from its own
   file's declaration to `NAME$c<signature>`. Check after a build: no `_bitcast_invalid` symbol in any object
   (`grep -rl _bitcast_invalid build/wasm-tla/obj` is empty). Trap 74.

## 3. The copyright line (open question of TLA4d)

The original does it. The clear overlay (0x64a: the file screen, new-game naming and the transfer question) draws its
background with Func_0200005c (scene/clear/s005c.c, "As GS1's Clear_LoadBackground"): ResourceId_LogoOnBlack, the
same 240x160 BG2 picture the title overlay shows (title/s0490.c Func_02000490), and the "©2001-2003 Nintendo /
CAMELOT" line is part of that picture. So the line is under the naming screens and the question (and under the
Continue menu with a save). The game-side task list was checked too: the only non-system task in that scene is
Func_020001f4@64a, the two secret button codes (s01f4.c), not a stale title task (tests/probes/tasks.cjs with
TASK_BASE=02003610 TASK_N=24). Not checked: why after Felix's naming the logo part of the picture is gone and the
line stays (likely the naming window's tiles over the upper part of BG2's character block); no emulator here.

## 4. /tla/ site (local only, not deployed)

`BOTH=1 tools/site.sh`: build/site = GS1's page, build/site/tla = TLA's page (21 MB game.wasm). Staged locally in
~/golden-sun-site-tla/publish (with _headers for both manifests and both sw.js); ~/golden-sun-site/publish (the
live deploy's staging) untouched.
- Offline: each page has its own worker, cache keyed by build id + site hash (golden-sun-<build>-<site> at /,
  golden-sun-tla-<build>-<site> at /tla/). GS1's worker no longer answers navigations below / (as written it would have
  served GS1's page for a /tla/ navigation until TLA's worker was installed) and does not delete golden-sun-tla-* caches; "Offline play" off
  unregisters only that page's worker. tests/web_offline.cjs ALL PASS for the combined GS1 site and for
  `SITE_DIR=build/site/tla ROM=<TLA ROM>` (first visit, update, CDP offline + ROM pick + boot, saved ROM + touch).
- Touch: tests/web_phone.cjs ALL PASS for both pages (portrait 390/412, landscape, menus by touch, restarts).
- IndexedDB: one origin, one database 'golden-sun' (store 'files'): GS1's keys unchanged ('rom', 'flash'), TLA's
  'tla-rom' and 'tla-flash'; options gs-lcd/gs-offline vs tla-lcd/tla-offline.
- Links between the two pages (build_id.js GS_SITE_BOTH).

What tools/deploy_web.sh needs for the combined site: build/wasm-tla current and its leak check (game.wasm,
game.js against the TLA ROM, `ROM_TLA=...`); `BOTH=1 tools/site.sh`; the allowlist to accept the `tla/` folder and
check its files with the same pattern; `cp -R` instead of `cp build/site/*` into publish; the two `/tla/` _headers
rows; live checks for /tla/BUILD.txt-equivalent, /tla/game.wasm content type and /tla/sw.js. Netlify's per-file
limit should be checked for the 21 MB game.wasm. Deploy waits for the user's TLA6 bar (new game + opening with
sound, touch, offline: D of TLA_PLAN 6.4).

## 5. Checks (end of session)

| check | result |
|---|---|
| TLA build (tla_incr / obj,link) | 0 linker warnings, calls PASS (29,965 sites, 19 allowed), leak 0 |
| D20 batch | 248 EQUIV / 0 FAIL / 957 NOINPUT of 1,205 (was 251/0/951 of 1,202) |
| diff_tla | 30/30 |
| diff_hw | 131 EQUIV / 0 FAIL / 57 NOINPUT; negative 4/4; decoders with the new rule 60/60 |
| diff_mixer | 300/300 |
| test_arm (GS1) | 79/79, negative controls detected |
| regress_tla | 5/5 OK (twice) |
| GS1 | game.wasm 687968a7, game.js 895d45cc; regress --quick 9/9 OK; web_offline ALL PASS; web_phone ALL PASS |

The batch's EQUIV count fell by 3 with 3 more routines: not traced (candidates: Func_02002f30@681, now a direct call
of the newly translated Func_02002f64; the batch's per-routine table of the last session was not kept).

## 6. Next

- Find the way down from the aerie (read the TLA Venus Lighthouse scene's trigger table first, as GS23 did; a TLA
  port of tests/probes/hpath.cjs / where.cjs with TLA's addresses), on to the quake scenes, Felix and Idejima, the
  first battle; add regress cases per milestone.
- D20 inputs for Func_080cf78c / Func_08173aac / Func_02002f64@681 (captured states).
- The EQUIV 251 -> 248 change in the batch.
- Audio check on the opening (tools/audio_check) and the Chrome page through the opening.
