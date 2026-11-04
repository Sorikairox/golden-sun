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

# TLA6b (2026-11-04): the way down, the first battle, D20 batch order, audio

## 7. Furthest real play

`tools/regress_tla.sh` cases `down` and `battle` (routes tests/routes/tla/down.keys, battle.keys; inputs only):
Jenna under control at the aerie door (~14,450) -> **down the lighthouse** -> the Venus Lighthouse entrance (15,616)
-> down the steps (16,040) -> the guards, Alex freezes them, Kraden ("Come", Yes, ~26,800) -> the walk west -> the
Ruffian's talk -> **the first battle, "Ruffian appeared!" (28,226)**, drawn correctly (forest backdrop, Ruffian, Jenna).
The battle is **not won**: the first Fight/Attack input stops the game (section 9). Contact sheet (local):
port_work/tla6b/contact.png (aerie door, the rooms, the entrance, the steps, the guards, Alex, Kraden, the battle).

**The way down (vendor tables, not guessed).** The opening ends with Jenna at entrance 22 (728,936) of scene 5
(VenusLighthouse, overlay 0x64e; scene/venus_lighthouse/data.c gSceneEntrances/gSceneExits/gSceneEvents). The map
dump (cell behaviour = trigger id, shapes = heights) gives the room graph: exit 22 (the door north of her) -> entrance
9 (a ledge above a pit: DOWN/RIGHT there are 32 px drops, rightly blocked) -> LEFT, UP through exit 10 -> entrance 12
-> exit 13 -> entrance 11 (the pit room's lower floor) -> exit 7 -> entrance 6 -> exit 3 -> entrance 2 -> exit 1 ->
scene 4 (VenusLighthouseEntrance) entrance 9. Not a port bug: "DOWN blocked on the door cell" was the wall row below the
platform, and TLA6's "UP into the aerie and back" was exits 22/9 (a door pair). TLA6's walk probe also mis-detected
exits (fixed: autowalk.cjs waits in the exit cell; WALK_GAME=tla).

**Then a port bug stopped the way down at the entrance steps** (fix 1 below): step trigger 9 (condition 0x892) never
ran, the two statues stayed on the stairs and Jenna could not go down.

## 8. Port bugs fixed

1. **GameFlag_IsConditionActive tested flag 0 for every condition** (c_rules, commit 1421ddd). is_condition_active.c
   calls the K&R-declared `GameFlag_Test()` with no argument; on the ARM the flag is the condition GCC left in r0, the
   wasm K&R adapter passed 0 (link.py adapter(): missing arguments are 0). Every trigger, placement and entrance
   condition was wrong. Two text rules pass `condition`. **18 other K&R calls passed fewer words than their target takes**
   (list below): each needs the same reading of what r0-r3 hold on the ARM. Done for one more: text.c's
   WindowSprite_PrepareForRedraw() gets `win` (the ROM keeps it in r0 up to the bl; commit dde94b0). Message_Start
   5/6 is fine as is (the vendor notes the sixth word is the 0 already on the stack, which the adapter passes).
3. Tools: autowalk.cjs WALK_GAME=tla; diff_hw and the D20 batch seeded per routine (section 10).
2. **render.c built** (asm_rules, commit 9706b35): Render_SetIdentity's three `stmia` as twelve C stores. render.c was
   the last left-out object; its 7 transform routines were stubs and the battle drew a tiled green screen. 0 objects
   left out, 0 logged stubs; 10 call-target allow rows (render.c addresses) removed.

Short K&R adapters left (caller file -> target, words passed/taken): definition_flags.c BattleEffect_GetAnimationValue
0/1 (BattleEffect_GetFlags passes its own r0 through), cell_mark.c Func_08020310 3/4 (Func_0802d7b0's height in r3),
add_action.c Func_080afb80 1/2, shop/f1082c4.c Func_0810a2c8 0/4, window/f044a58.c + f044c80.c Message_Start 5/6,
window/text.c WindowSprite_PrepareForRedraw 0/1 (fixed), menu/lifecycle.c Window_CloseFar 1/2, and 11 in scene overlays
(664 airs_rock_inside, 665 alhafra, 671 gabomba_statue x2, 674 islets, 681/68e/692 Actor_GetById, 682 champa,
6aa mars_lighthouse_entrance, 6b8 debug). To list them: in build/wasm-tla/gen/glue.ll, the `define ... @"NAME$c..."(params)`
adapters whose body calls the target with more arguments than the adapter's own parameters.

## 9. The battle stop (next)

Fight -> Attack: "asm2c: continuation at 0x0801f786, expected the return to 0x0d0ffff0", in Render_DecodePicture
called through a2c_dispatch from Func_0815e3ac (battle effect code) with r2 = 39. The call is to 0x03005381, a heap
block in IWRAM. Func_08196404 (translated asm) allocates it and copies **BattleEffect_PatchTemplate**
(battle_effect/patch_template.s, 0x081972a0) there with ldm/stm, then patches its instructions (a self-patching
blitter like GS1's BattleEffect_BuildBlitter). The port still has the alias of the picture decoder that the field
copied to the same block by DMA (trap 20: translated stores do not drop aliases), so the call runs the decoder. Two
things are needed: (a) drop RAM aliases when a heap block is reused (HeapSlot_Alloc, or the copy loop), (b) run the
patched template: a C port of the template + builder like port/pc/blitter.c (Port_CodeAliasFn), checked by D20 against
the patched words in RAM, or an ARM interpreter for RAM code.

## 10. D20 batch 251 -> 248 explained; order independence

No translation changed except the three callers of the new routines (Func_080cf554, Func_08173588,
Func_02002f30@681, NOINPUT before and after). The batch dealt routines to shards by index and drew all inputs of a
shard from one random stream, and memory outside the world (gHeapSlots, VRAM, the stack) carried over from earlier
routines. The three routines added to the report re-dealt every later routine: 55 routines moved between EQUIV and
NOINPUT (26 one way, 29 the other), net -3. A worktree of the tree before TLA6's asm2c change gave 251 again with
the old batch, so the count was sampling. Now (commit 5580884) each routine has its own stream (seeded by
name@overlay) and starts from the same memory: **217 EQUIV / 0 FAIL / 988 NOINPUT of 1,205**, and the old tree gives
the same result for each of its 1,202 routines. The 31 fewer EQUIV only ran on heap-slot pointers left by earlier
routines. Tried and not kept: filling gHeapSlots' work-area words with world pointers gave 555 EQUIV but 2 FAILs
(Func_020004a4@6ae "port: executes data at 0xd1007f2", Func_02002790@664 a cell differs; the callee Func_0802b450 gets
the same arguments in both runs, likely wild writes from random sizes, not proven): a candidate profile once those
two are triaged. diff_hw had the same single stream (131 -> 124 with nothing changed: Render_ConvertMap flipped and 9
one-case routines flipped back); now seeded per routine, 124 / 0 / 64, identical over two runs.

**Inputs for the three new translations.** batch.cjs takes captured entry states (CAPTURES=dir, default
port_work/tla6b/captures, local only: game RAM): RAM, r0-r3 and sp at the routine's entry, taken in real play by a
capture build (temporary, not committed: `#define A2C_T(a)` comparing the three entry addresses ->
`(A2C_SPILL(), a2c_capture(a))` put at the top of the asm2c units holding them, rebuilt with tools/tla_incr.sh
--no-asm2c; a2c_capture -> EM_ASM -> a boot.cjs probe that writes the RAM regions and the registers). In capture
cases code in RAM counts as code and immediate DMA3 copies run (Window_FillFromScene's RamCode_Load DMA-copies
Tile_BuildCellPictures into a heap block; without the copy both sides ran the decoder bytes left there and read
outside the GBA regions). **Func_080cf78c: EQUIV, 6 cases (capture)** from the opening. Func_08173aac (a battle
effect) and Func_02002f64@681 (Ov681Room*, Gaia Rock) are not reached in play yet: NOINPUT. Batch with the local
captures **218 EQUIV / 0 FAIL / 987 NOINPUT** (217 without them). CAPDEBUG=1 logs the calls out of a translation.

## 11. Audio (node)

Opening, frames 0-16,700 (279.6 s, tests/probes/wav.cjs, tools/audio_check.cjs 10 s windows): **27/27 windows with
sound**, RMS 3,200-9,300, peak full scale, **clipped at most 0.06 %** of samples (the mixer's 10-bit DAC clamp, as
GS1's G16-G26 notes; diff_mixer: 206 of its 300 EQUIV cases clip in the original too). Local file
port_work/tla6b/audio/opening.wav (sha1 cfed3c8a45fb7c90).

## 12. Checks (end of session)

| check | result |
|---|---|
| TLA build | 0 linker warnings, 0 objects left out, 0 logged stubs, calls PASS (9 allowed), leak 0, no _bitcast_invalid |
| D20 batch | 218 EQUIV / 0 FAIL / 987 NOINPUT of 1,205 with the local captures, 217 without (order independent; section 10) |
| diff_tla | 30/30 |
| diff_hw | 124 EQUIV / 0 FAIL / 64 NOINPUT; negative 4/4; decoders 60/60 |
| diff_mixer | 300/300 |
| test_arm (GS1) | 79/79, negative controls detected |
| regress_tla | 7/7 OK twice (new: down, battle; RAM digests of the old cases changed with render.c, pictures and the save's SHA-1 did not) |
| GS1 | game.wasm 687968a7, game.js 895d45cc; regress --quick 9/9 OK |

## 13. Next

1. The battle stop (section 9): drop aliases on heap reuse; port BattleEffect_PatchTemplate's builder (or run RAM code
   in an interpreter); then win the Ruffian battle and go on (Felix, Idejima).
2. The 16 open short K&R adapters (section 8; Window_CloseIfOpen's r1 and Func_080af794's r1 come from their callers): read each call site's r0-r3 on the ARM and give the call its words.
3. Captures for Func_08173aac (a battle with Psynergy effects, after item 1) and Func_02002f64@681 (Gaia Rock).
4. The heap-slot world profile for the D20 batch (555 EQUIV) after triaging its two FAILs.

# TLA7 (2026-11-04): the battle blitters, the first battles won, short K&R calls

## 14. Furthest real play

`tools/regress_tla.sh` cases `win` and `gate` (routes tests/routes/tla/win.keys, gate.keys; inputs only), 9 cases:
the first battle (28,300) -> Fight -> **Psynergy -> Fume** on the Ruffian (flames drawn; 53 damage) -> **"You felled
Ruffian!"**, 5 experience, 5 coins, an Herb (29,120) -> the field (29,240) -> west past the beaten Ruffian (lying at
40,248 by scene 4's prepare routine once flag 0x893 is set) to trigger 1 -> **Suhalla Gate (scene 6)** entrance 5
(29,390) -> the stairs and ledges (64, 96, 128 px) to trigger 20 (30, 22) -> "Waahhh! It's them!" -> **second Ruffian
battle, won with Attack** (~31,100) -> "Oooog. Maybe I shouldn't have underestimated her..." -> west along z 18 to
trigger 4 (x 21) -> **scene 7 (the mountain path) entrance 4** (31,480). Fight/Attack also wins the first battle (not
kept as a case). No Djinn command is offered (Jenna has none). Contact sheet (local): port_work/tla7/contact.png.

Stop point (not a port bug as far as seen): scene 7's next exit is trigger 5 at (38, 57), next to entrance 5 (616, 920,
facing south): it lies on the 32 px level (x 30-39, z 57-58). From the 128 px path the walk reaches the 96 px slope
cells (35, 57) (LEFT@31600-31735, DOWN@31736-31936 after gate.keys) but no step further down; the stairs at
x 16-17, 22-23, 28-29 (z 55) lead down to that level west of trigger 21 ("Not that way", x 31-32, z 54-55), which
turns the leader back on the path. Not judged a port bug yet: check the slope cells' kinds (collision byte 0) and
whether trigger 21 should let the leader pass (its condition) before suspecting collision. Scene 7's other triggers (vendor suhalla_gate/data.c, map dump): exit 3
(1, 56-57) -> the north part (exits 1 at x 1 and 2 at x 25), exit 1 there -> scene 6's west plateau; exit 5 -> scene 8.
Maps: a TLA map dump needs gHeapSlots.mapWork (0x03000020) -> layers[L] (+0x108, 56 bytes each): cells (+0x30, byte 2 =
behaviour / trigger id) and terrainIds (+0x34, one byte per cell) -> gMapCollision (0x0202c000) + 4 * id: byte 0 & 15
kind, byte 1 height in 8 px. GS1's mapdump.cjs reads byte 3 of the cell as the shape, which is 0 in TLA (all heights 0).

## 15. Port bugs fixed

1. **Code aliases dropped when a heap block is handed out fresh** (TLA c_rules on HeapSlot_Alloc / HeapSlot_AllocEwram,
   commit 6661b17; trap 20): the field's RamCode_Load left an alias of the picture decoder at 0x03005380; the battle's
   blitter builder got the same block and the call ran the decoder. A slot already held (cached) keeps its aliases.
2. **Battle effect blitters** (commit be42a96; trap 77): Func_08196404 (raw Thumb, TLA's twin of GS1's
   BattleEffect_BuildBlitter) is bound to Port_TlaBuildBlitter (port/tla/hw/pc_tla.c, through the new
   port/tla/hw/pc_binds.tsv that link.py reads for TLA). It runs the asm2c translation (same heap use, same words in
   RAM: ldm/stm of BattleEffect_PatchTemplate, DMA3 fragment copies, patched immediates and branch words), then aliases
   the slot (`*(u32 *)(0x03000000 + slot)`) to GS1's C blitter (port/pc/blitter.c, now linked for TLA, unchanged) with
   TLA's mode numbers mapped: 0 additive (it copies BattleEffect_Mask), 1 lighten, 2 transparent, other copy (GS1: 0
   copy, 1 transparent, 2 lighten, 3 additive). Proof: **tests/arm/tla/diff_blitter.cjs** runs the ROM's builder in the
   interpreter (arm7.js; the DMA3 copies modelled on the I/O write) and then the ARM it wrote, against the port's build
   and the aliased C: 160 builds (width shift 7/8, flags 0-15, modes 0-4; half fresh in IWRAM after a decoder alias,
   half reusing an EWRAM slot): built words and all RAM equal; 4,800 draws EQUIV; negative 80/80 (a wrong flag in the
   alias). Asm or overlay code that calls Func_08196404 through a code pointer (a2c dispatch) would miss the hook: none
   found (the C callers and the table_47 veneer all reach the binding).
3. **11 short K&R calls get their words** (commit 7ca2579; trap 75), each read in the reference ELF
   (port_work/tla1/*.elf, Thumb disassembly of the caller):
   - BattleEffect_GetFlags(void) keeps r0 to its bl: BattleEffect_FilterObjectIdByFlags(id)'s id reaches
     BattleEffect_GetAnimationValue -> ObjectTable_Get (was 0);
   - Window_CloseIfOpen leaves its callers' r1 (mode 1) to the bl Window_CloseFar (the vendor's note);
   - Func_080ea8a8(x, z, layer) keeps r3 = the asm caller's (Func_080ea8d4) object height for Func_0802d71c's base;
   - Func_080af794(owner) passes r1, the LevelUpResult pointer Owner_LevelUp writes (was a NULL write);
   - Actor_GetById() in ov68e s08f0, ov681 s2b58 / s2ac8, ov692 s0800 and ObjectTable_ReadActiveValue() in ov682 s0e04:
     the routine's a0 is still in r0;
   - event/callback wrappers whose body is only the bl (ov664 Func_020048bc, ov665 Func_02000a98, ov6aa Func_0200040c)
     and ov671 Func_02001a6c: r0/r1 from the dispatcher pass through.
   Kept, each with the reason in **port/tla/short_knr_allow.tsv**: Message_Start 5/6 (the sixth word is the caller's 0
   on the stack), Func_0810a2c8 0/4 (its asm target writes r0-r3 first), ov674 Func_020020ec 3/4 (r3 is 0 on the ARM
   too), ov671 Func_020056b4 0/1 (the veneer of Event_Start(void): the word is never read), ov6b8 debug scene.
4. **Build check** (commit 7c272bd): tools/wasm/short_knr.py, in the TLA build's `calls` stage, lists every link.py
   adapter that drops words its target takes and fails on one without an allow row (negative: removing a row fails).

RAM digests of the 7 older regress cases changed with these builds (C function pointers stored in game RAM are wasm
table indices, which move when functions are added); all 42 pictures and the save's SHA-1 are unchanged.

## 16. Checks (end of session)

| check | result |
|---|---|
| TLA build | 0 linker warnings, 0 objects left out, 0 logged stubs, calls PASS (9 allowed), short K&R PASS (5 allowed), leak 0, no _bitcast_invalid |
| D20 batch | 218 EQUIV / 0 FAIL / 987 NOINPUT of 1,205 (with the local captures; unchanged) |
| diff_tla | 30/30, negative 4/4 |
| diff_hw | 124 EQUIV / 0 FAIL / 64 NOINPUT, negative 4/4 |
| diff_mixer | 300/300 |
| diff_blitter (new) | 160 builds + 4,800 draws EQUIV, negative 80/80 |
| test_arm (GS1) | 79/79, negative controls detected |
| regress_tla | 9/9 OK (new: win, gate) |
| GS1 | game.wasm 687968a7, game.js 895d45cc; regress --quick 9/9 OK |

## 17. Next

1. Scene 7: the way down from the 128 px path to trigger 5 (38, 57) and scene 8 (read the scene's map with the
   layout in 14; the slopes are the '4'/'8' cells), then on to the next scenes (Felix, Idejima).
2. Func_08173aac captures (a battle with Psynergy effects now runs: Fume) and Func_02002f64@681.
3. The heap-slot world profile for the D20 batch (TLA6.md 10).
