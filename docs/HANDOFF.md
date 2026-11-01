# HANDOFF

Newest session first. Read `orchestrator.md` (rules, decisions, traps) and `docs/PLAN.md` before working.

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
