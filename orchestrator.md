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

- GS32 (2026-11-04, main): **merge of GS31 into main with GS30** (docs/GS32.md): Map zoom on field maps (VBlank camera,
  no edge jitter) and on the World Map together; GS31's traps renumbered 93-94. Regress masked = GS30's b13e7532 but
  for zoom_edges_most f2700 (the fix) and link2's own row; expected.tsv RAM rows rewritten; GS1 1dd5c2e8 / 13f7526d
  (site c413992211ebfe9b); TLA df7c39fb / d184cc2a unchanged; not deployed.

- GS30 (2026-11-04, main): **Map zoom on GS1's World Map** (docs/GS30.md): the moving view at 288 x 192 / 336 x 224,
  renderer only: extra columns continue the hardware's affine stepping, extra rows fit a + b / (line - h) on the frame's
  own lines; margin samples only where the game holds that place (RAM tile block, decoded quarter, BG cell == RAM cell),
  else black; menus keep the last moving frame's ground in the margins; R's world picture stays 240 x 160; GBA view
  centred, no clamp. Projected-sprite culling widened by gPortZoom*. Regress masked = 43130de1 (61 cases), expected.tsv
  RAM rows rewritten; GS1 b13e7532 / 13f7526d; TLA df7c39fb / d184cc2a unchanged; not deployed.
- GS31 (2026-11-04, branch, merged into main by GS32): Map zoom's picture no longer jitters at map edges (docs/GS31.md): the
  frame is placed with the camera of the last VBlank (ppu.c). GS1 e5758f47 / 13f7526d; TLA unchanged; not deployed.

- GS29 (2026-11-04, main): **Map zoom** replaces Wide view (docs/GS29.md): field maps at 288 x 192 / 336 x 224 (3:2),
  scaled into the same box, nothing on the page moves (canvas + touch boxes checked across levels, a battle, an
  interior); the GBA's view placed inside the map's camera bounds (no black at map edges; camera unchanged); our Extra
  settings' floating "Settings" heading removed (the game's own Change settings keeps its own). Regress masked = 6d08d4c8
  (61 cases), expected.tsv RAM rows rewritten; GS1 43130de1 / 13f7526d; TLA df7c39fb / d184cc2a unchanged; not deployed.

- TLA9 (2026-11-04, branch tla9, not merged): **"only say Yes"** (docs/TLA9.md): on the TLA page, with a GS1 ROM + a
  save holding a cleared file in the origin's IndexedDB, Yes to "Transfer data from Golden Sun?" brings the party: a
  headless GS1 instance runs GS1's own Save_* routines through Port_CallCode4 before TLA starts (4,100 bytes = route
  (a)'s), TLA's Transfer Method menu answers Link cable (pc_tla.c + c_rules on Func_0804d7fc, one-shot), a virtual GS1
  partner on TLA's link transport sends them; option "Bring party from Golden Sun" (tla-gs1party, default on);
  several cleared files: the longest play time. web_transfer ALL PASS (units/flags = route (a)'s 14648e8f916d /
  6ffcc5c1ef6b; off, no save, phone, offline). GS1 unchanged 6d08d4c8 / cab9b56b; TLA df7c39fb / d184cc2a; not deployed.

- TLA9a (2026-11-04): **integration** (docs/TLA9a.md): gs1-options merged into main (GS27 in-game settings + Wide view,
  GS28 build-independent saves; branch traps renumbered 83-85); **GS1 link.c BULK_MAX 4352** (both games; wire format
  unchanged): route (a) runs to the end, GS1's real 4100-byte send imported by TLA, 52/52 PASS, units/flags equal to
  the stand-in's; **TLA saves build-independent** (gSnapshotObjects in GBA spelling; asm2c port hooks around TLA's raw
  restore Func_080cae5c): padded-layout build saves byte-identical. All checks green; GS1 6d08d4c8 / cab9b56b, TLA
  2ee38c9f / 8c87348c; live-build saves migrate; deploy dry run OK, **not deployed**.

- TLA8b (2026-11-04): **the games' own transfer, by hand** (docs/TLA8.md): the test-only cleared GS1 save (6.1: warp to
  the File Screen at FILE_SCREEN_FROM_TITLE, Yes, file 2); GS1's hidden Send (R+Left) by keys; **Gold/Silver/Bronze
  passwords** read off GS1's screen and typed into TLA by keys, all accepted, TLA's party checked against the vendor's
  rules 63/67/43 PASS; **TLA link layer** (link.c at TLA's serial API); **route (a)** (tests/transfer_a.cjs): greetings
  meet, but **GS1's link.c sends the 4100-byte save part as 0 bytes (BULK_MAX 4096): a GS1 change, stopped and
  reported**; the cable import with a GS1 stand-in carrying GS1's own bytes 52/52 PASS. tools/transfer_pw.sh, all
  deterministic. TLA's save can hold build-dependent words (saved actor snapshot: script, update), none today.

- TLA8 (2026-11-04): **real play to Felix on Idejima and the World Map**: scene 7's way down is two vines (not a port
  bug, trap 79), the third Ruffian battle won (Fume + Attack), the cave (a Punch Ant won), the island adrift, Felix
  under control, Kraden/Jenna/Sheba join, Alex's departure, the World Map (scene 2). regress_tla 13 cases.
  Func_08173aac D20: EQUIV 4 capture cases (forced variants). tools/deploy_web.sh ships GS1 at / and TLA at /tla/,
  `--dry-run` OK; not deployed (TLA's 21 MB game.wasm is above Netlify's recommended 10 MB per file). docs/TLA6.md 18-22.

- TLA7 (2026-11-04): **the first battle won** (Fight/Psynergy Fume, effects drawn), Suhalla Gate, **the second Ruffian
  battle won**, on to scene 7's mountain path (stop: the way down to its trigger 5). Fixes: heap blocks drop code
  aliases when handed out fresh (trap 20), battle blitters through GS1's C blitter (trap 77, diff_blitter.cjs
  160 builds + 4,800 draws EQUIV), 11 short K&R calls given their words + build check tools/wasm/short_knr.py (trap 75).
  regress_tla 9 cases. docs/TLA6.md 14-17.

- GS28 (2026-11-04, branch gs1-options, merged into main by TLA9a): **saves are build-independent** (the saved actor snapshot holds
  GBA addresses, trap 85) and saves of the live build 687968a7 migrate on load (tested: unmasked digests equal);
  expected.tsv from the clean branch build (087d3b7e / cab9b56b); link.py refuses stale objects (docs/GS27.md 8).

- TLA6b (2026-11-04): **down Venus Lighthouse to the first battle** (the rooms by the vendor's scene tables, the
  entrance, the guards, Alex, Kraden, "Ruffian appeared!", drawn right); the battle is not won (Fight stops in a
  self-patching IWRAM blitter run through a stale decoder alias, docs/TLA6.md 9). Fixes: K&R GameFlag_Test argument
  (trap 75), render.c built. D20 batch/diff_hw seeded per routine (trap 76): 218/0/987 (captured inputs: Func_080cf78c EQUIV), 124/0/64. regress_tla 7 cases.

- TLA6 part 1 (2026-11-03): **new game to Jenna under control at Venus Lighthouse** (intro, talk, quake, area name,
  walking, menus), **in-game save -> Continue** works; fixes: asm2c rel16 jump tables, long-jump `bl` return points
  (Func_080cf78c/08173aac/02002f64@681 translate), link adapter for cast calls (trap 74); tools/regress_tla.sh 5 cases;
  /tla/ site prep local (BOTH=1 site.sh, own workers, shared IndexedDB with tla-* keys), not deployed (docs/TLA6.md).

- TLA4d (2026-11-03): **new game to "Transfer data from Golden Sun?"** (empty save: logos, logo, Felix naming, the
  question, No -> Isaac naming: the original's order; the pulsing windows were a task never removed, trap 73);
  **sound**: TLA mixer + render in C (pc_tla_mixer.c, GS1's channel mixers shared), D20-style 300/300 vs the ROM's
  self-patching code in the interpreter; music audible in node and Chrome. diff_hw negative controls 4/4 (docs/TLA4.md 9).

- TLA4c (2026-11-03): **TLA boots to the logos, the title and the new-game naming screen** in node (1,500 frames, no
  stop) and in headless Chrome (59.7 fps, 0 errors); naming is interactive; audio silent (resident mixer self-patches,
  bound to a callbacks-only port). asm2c: table calls, polling loops, adr+bx, A2C_THUMB (traps 69-72, docs/TLA4.md 8).

- TLA3 (2026-11-03): **asm2c** (tools/wasm/asm2c.py, D23): 1,202/1,207 TLA listing routines translate to C; D20 proof
  30/30 EQUIV (ARM, overlays, jump tables, battle effect, 13 KB overlay routine), negative controls 4/4, vendor drafts
  6/22; GS1 tests/arm 79/79 (docs/TLA3.md). Build hooks for TLA5 in TLA3.md 6.
- TLA2b (2026-11-03): TLA code-range audit 187/187 (3 fixed: task overlay test, flash driver -> port/pc/flash.c); 47/48
  left-out objects compile (render.c's ARM asm left); scene import and far-call veneers resolved (6,003 veneers), stubs
  2,545 -> 647 (638 asm, list port/tla/asm_stubs.tsv); full `web_build.sh --game tla` passes. GS1 still 687968a7/895d45cc.
- TLA2 (2026-11-03): `build.py --game tla` (tools/wasm/game.py); TLA C 3,654/3,702 objects, link 0 warnings, 2,545 stubs,
  leak 0; TLA code-range audit 187 hits not yet audited (docs/TLA2.md). GS1 still 687968a7/895d45cc.

- TLA1 (2026-11-03): **GS1 byte-identical at vendor f6c08e64** (wasm/js equal to a 24b72a32 worktree build and to the
  live site, regress full 62/62 OK; D22, no alchemy-tbs pin). TLA reference build tools (tools/build_ref_tla.sh,
  check_rom_tla.sh) in the existing image with alchemy-gcc 641764a5 (D13 f, trap 52): **compare-tla-en OK**;
  all 114 overlays identical. Exact port/symbols/tla-en*.tsv and the census: TLA code 1.96 MB, C 46.5 %, listing asm 48.9 % (959 KB, 1,203 fn), hand .s
  4.6 % (docs/TLA1.md).

- GS-deploy (2026-11-02): **public at https://golden-sun-web-port.netlify.app** (user's request; D14 replaced) with
  the room function at /api/room; `tools/deploy_web.sh` redeploys (leak check, site allowlist, staging outside the
  repo). **Offline play** (docs/OFFLINE.md, option on by default): service worker precaches every site file in a cache
  named by build id + site hash, cache-first, never /api/*; update notice; manifest + our own icon; offline sentence
  in the link panel. tests/web_offline.cjs ALL PASS locally and live; tests/web_link_live.cjs: two pages linked
  through the live room server; web_touch, web_phone (after a touch.js ghost-click fix), web_link ALL PASS.

- GS8 (2026-11-01): **online link battle works between two pages** (G7, local): port/web/net.js puts link.c's
  transport on WebRTC data channels (frame unreliable/unordered, bulk reliable; control JSON as text on bulk), room
  codes (port/netlify/functions/room, local tools/roomserver.mjs) + manual codes, hello check (build id, ROM SHA-1,
  English), fresh window 300 online, worker ticks while hidden, per-turn hash guard, page panel "Link battle online",
  ?netsim. tests/web_link.cjs: two pages in one headless Chrome reach the end of a link battle with 20/20 turn hashes
  equal and the same winner, clean and at ~210 ms / ~510 ms round trips with 10 % frame loss; no WaitSync override
  needed. (Deployed since GS-deploy.) Details: docs/LINK.md section 8.
- GS10 (2026-11-01): link robustness: a lost link never freezes the game (both sides: "The link was disconnected.",
  Arena lobby); online fresh window 900 (a ~10 s drop resumes the battle); link.c forgets the peer between sessions
  (re-join after a partner restart works); page: partner-left notice, silence watchdog, clear Host/Join errors,
  "Return to title" (fresh module, same ROM bytes), optional "GBA screen colours" (default off); tests/web_phone.cjs
  (phone emulation of the whole page, ALL PASS). Memory: 225 MiB fixed linear memory, ~10 MiB of it touched. LINK.md 9.
- GS9 (2026-11-01): prologue by real play to Garet joining, the elders holding back the Boulder and into
  ValeKradensCottage (tests/routes/vale_garet.keys, vale_boulder.keys); the prologue's monster fights are not reached
  yet (rocks and Garet wall every way found: docs/G9.md 1). Test-only probes through the game's own routines: 3-member
  party, Psynergy (battle + field Move/Catch/Cure), Djinn unleash, Mars summon, a lost battle (wakes at home), World
  Map (warp), credits slides. Fixed the World Map idle-camera garbage (trap 38); ported TileMap_DrawRows and
  Credits_DecodeBackground (78/78 EQUIV). tools/regress.sh: 11 cases with stored digests, all OK.
- GS11 (2026-11-01): **the whole prologue by real play**: the four stormy-night monster fights won (Vermin, Bat, Wild
  Mushrooms, Bat + Vermin), Felix, the plaza, the Boulder sweeping them away, the strangers' battle, the title, Vale
  three years later (tests/routes/vale_monsters, vale_felix, vale_plaza.keys; docs/G11.md). The game's own soft reset
  (A+B+Select+Start) works (trap 36). tools/regress.sh 15 cases, digests rewritten on the soft-reset build (RAM only).
- GS12 (2026-11-02): **Vale day one by real play** from a reproducible in-game save (tests/routes/vale_day1_save.keys,
  vale_day1_continue.keys): Saturos and Menardi, Kraden's plan, Mt. Aleph, Sol Entrance, Sol Sanctum's stepping stones and
  the **first random battle won** (vale_sanctum.keys, sol_sanctum.keys; docs/G12.md). No port bug found on the new
  screens; regress 17 cases.
- GS13 (2026-11-02): **Sol Sanctum by real play to both Small Jewels** from a new in-game save inside the Sanctum
  (sol_sanctum_save.keys, sol_jewels.keys, sol_jewels_save.keys; docs/G13.md): pillar room, chest, first relief, Kraden,
  **Move** on statues (incl. from a pillar across water), the maze, the second relief. **Port bug fixed**: examine events ran
  as locked chests (trap 40). Regress 19 cases.
- GS14 (2026-11-02): **code-range audit** (port/tools/code_range_audit.tsv, build-time guard; task.c overlay-task fix, trap 41)
  and **Sol Sanctum by real play to the Elemental Star Room** (statues 2/6 Moved, Luna/Sol rooms, the statue puzzle, Venus,
  Mercury and Jupiter Stars, Saturos/Felix/Alex), saved before the Mars Star (sol_star_room.keys, regress 20 cases; docs/G14.md).
- GS15 (2026-11-02): **the Mars Star to Vault's inn by real play** (mt_aleph.keys, vault.keys, vault_inn.keys; docs/G15.md): the
  eruption and the Wise One, Retreat, Vale's eruption, the quest, the World Map, Flint and his lesson battle, Hammet's caravan,
  **Ivan joins**, the suspects flee in the inn; three saves, regress 23 cases. Menu pause of scene tasks confirmed (probe), the
  GS14 jagged wipe is the game's WINDOW_TRANSITION_NOISE, audio checked on all routes. No port bug found.
- GS16 (2026-11-02): **Vault by real play to the Shaman's Rod** (vault_crate, vault_grind, vault_thieves.keys; docs/G16.md): the
  cornering chase, Mind Read, Move on the crate, Ivan staying behind and rejoining, 78 World Map battles (Isaac Lv 6), the loft,
  the thieves' battle won, the rod; three saves, regress 26 cases. New test-only bots: tests/probes/grindbot.cjs, battlebot.cjs.
  No port bug found (encounter transition and battle backgrounds checked against the vendor).
- GS17 (2026-11-02): **Vault Sanctum to Goma Cave by real play** (goma_entrance, goma_ivan, goma_pillar.keys; docs/G17.md): Revive
  at the Vault healer, the north gate, the Goma Cave Entrance (pillars by push and Move, **Ivan rejoins** with Whirlwind, the stump
  leaps into the pool, Whirlwind on the ivy), the stream room, the pillar room (east pillar settled); battles with Djinn set and
  unleash, Ray and a **Venus summon** (battlebot BB_SEQ). Three saves, regress 29 cases, `regress.sh --quick`. No port bug found.
- GS18 (2026-11-02): **Goma Cave to Kolima Forest by real play** (goma_forge, bilibin, mccoy, kolima, kolima_forest.keys;
  docs/G18.md): the pond room, Move on the west pillar and both stumps, **Forge's battle won**, the bridge, Bilibin (**Mind Read**
  via the L shortcut, McCoy's audience), the barricade's crates, **Kolima's curse scene**. New `tests/probes/hpath.cjs`
  (height- and layer-aware path search, trap 43); mapdump height scale fixed. Five saves, regress 34 cases. No port bug found.
- GS19 (2026-11-02): **Kolima Forest to the Tret Tree by real play** (kolima_grind, kolima_glade, kolima_cliff,
  kolima_floodgate, tret_tree, tret_battle.keys; docs/G19.md): grindbot in the forest (82 battles, Lv 9; GR_SCENE/GR_FLEE),
  the entrance's, glade's and cliff's **log puzzles** (river logs tip in), the **Floodgate Switch** (river drained, a log
  rolled on the riverbed, refilled, the floating logs), **Laurel and Tret** (the wrathful side's purple tint), the vine into
  the **Tret Tree**, a battle with **Flint unleashed and Mars summoned**. Six saves, regress 40 cases. No port bug found.
  Story order: the curse lifts only with Hermes' Water from Mercury Lighthouse (after the Tret Tree's battle).
- GS20 (2026-11-02): **through the Tret Tree to Tret by real play** (tret_cocoon, tret_grind.keys; docs/G20.md): the cocoon
  webs (torn cocoons are jumped from), the branches' vines, the floors in order, cocoon 50's falls to Tret's room; grinding
  in Tret's glade (Lv 10/10/9). **Tret fought twice and lost** (summon Venus seen). Two saves, regress 42 cases. No port bug
  found. New tool options: HPATH_JUMPB, WALK_FLEE, GR_CUREFIRST/GR_FLEEMID/GR_NOFIGHT, BB_LOOP/BB_BATTLEONLY.
- GS21 (2026-11-02): **Tret beaten by real play** (tret_win, bilibin_cave, bilibin_ice.keys; docs/G21.md): the damage check
  first (Tret's stats/elements = vendor + ROM, every hit within the formulas: no port bug; Mars resistance 25), then Flint
  unleashed, Venus summoned, Volcano, Cure Well: Tret falls at Lv 10; Retreat, the World Map, the barricade's crates (Move),
  north into Bilibin Cave to the ice room. New tests/probes/wmpath.cjs (World Map collision, trap 46). Three saves, regress
  45 cases. No port bug found.
- GS22 (2026-11-02): **across Bilibin Cave's ice room, Imil, Mercury Lighthouse to Mia joining, by real play** (bilibin_exit,
  imil, lizard_man, ml_lower, mia_joins.keys; docs/G22.md): the torch pushed beside the ice pillar (it melts), the World Map to Imil, Megan, **Mia
  heals the old man with Ply**, the item shop (weapon/armor sellers sick by the story), Move on the lighthouse's door statue and
  Mia's Ply, the **Lizard Man** beaten with **Flint unleashed and Venus summoned**, into the lower floor, **Mia joins** (Move on the statue blocking
  her). Five saves, regress 50 cases. No port bug found.
- GS23 (2026-11-02): **Mercury Lighthouse to Ply at the pool and the three pipes, by real play** (ml_ply, ml_pipes.keys;
  docs/G23.md): the vendor's tables put Ply first (the pipe room is reached only through the Entrance's eastern pools, crossed
  with the golden rings Ply unlocks); the Middle's stair pipe, water jets and passages under the pipes, the gate statue on its
  floor switch, the Lower's hole into the pool's heart, **Mia's Ply** (the pool's lights and shimmer); the rings' hops, the
  **three pipe sections** joined, the water ride. Two saves, regress 52 cases. No port bug found.
- GS24 (2026-11-02): **Mercury Lighthouse's Upper and Middle to Sleet, by real play** (ml_upper, ml_sleet.keys;
  docs/G24.md): the interlaced wipe GS23 saw is the overlay's own transition (measured: as screen_transition.c writes it);
  the stone doors' two pipes in the order the statue's slide table needs, **the statue falls**, onto the stair gate's
  switch, Move on the last crossing statue, **the fountain pipe**, **Sleet joins Ivan**. Two saves, regress 54 cases. No
  port bug found.
- GS25 (2026-11-02): **the Exterior to the Lighthouse Aerie by real play** (ml_aerie, ml_saturos_loss.keys; docs/G25.md):
  GS24's "Use it on whom?" at the waterfall was the leader 21 px from the statue (Ply reaches 16 px; trap 50), not a port bug;
  the gap statue, the waterfall's Ply, the rising, the aerie and its platforms; **Saturos lost at Lv 10** (his row and one
  Fireball's damage match the vendor exactly). One save, regress 56 cases. No port bug found.
- GS26 (2026-11-02): **Saturos beaten by real play at Lv 15** (docs/G26.md): the lift is out of reach before the fight
  (the confrontation cells span the way), so down by GS25's loss to Imil; Sanctum revives, inn; 121 World Map battles
  (grindbot + Mia's field Ply, new GR_HEALER/GR_STOPLOW) to Lv 15; back up the lighthouse reusing GS23-25's key spans
  shifted (CHANNELS_OPEN's entrance rows shorten the way); Saturos falls (summons turn 1, Forge unleashed, Mia's Ply);
  Alex's scene. Six saves/regress cases (62 + link2). No port bug found.
- Next: user: one real online session across two networks on the live site (LINK.md 8); tests for partner-leaves mid-battle and failed exchange + retry;
  from the ml_saturos_win save (aerie, 20,12, Saturos beaten): the lift down, Hermes' Water (the Empty Bottle from
  Imil's Sanctum), Imil's opened shops and Mia's farewell, then Kolima (G26.md 3); `tools/regress.sh --quick` between
  builds, the full run at the end.

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
- **D12 Toolchain:** host Homebrew LLVM (clang 23, wasm32 target) for probes and the census; builds in Docker
  with the local `emscripten/emsdk:4.0.15-arm64` image (as GoldenEye/Conker). Docker CLI: `/Applications/
  Docker.app/Contents/Resources/bin/docker` (`/usr/local/bin/docker` is a dangling OrbStack link). The reference
  builds run in `golden-sun-tools` (`tools/docker/Dockerfile.tools`, ubuntu:24.04 + Ubuntu packages) on the
  Docker volume `golden-sun-ref`, via `tools/build_ref.sh`.
- **D13 Downloads (user, 2026-11-01):** approved, all inside Docker, nothing on the host: (a) the Ubuntu apt
  packages of `golden-sun-tools` (binutils-arm-none-eabi build-essential pkg-config libpng-dev libutf8proc-dev
  curl patch git), image FROM the local ubuntu:24.04; (b) the `PascalPixel/alchemy-gcc` submodule (GPL-2.0);
  (c) `binutils-2.10.tar.gz` from ftp.gnu.org as fetched by alchemy's `make bootstrap`. Nothing else: any other
  download needs approval (stop and report). `alchemy-devtools` is **not** approved. Approved later the same day
  (user, via the coordinator, GS1 addendum), inside Docker only: (d) `github.com/pret/agbcc` at `da598c1d`
  (alchemy-gcc's nested submodule) and (e) `ftp.gnu.org/gnu/gcc/gcc-2.95.2.tar.gz`, SHA-256 verified against
  alchemy-gcc's `arm/Makefile` pin (`064e1cb0...7d72482`). Kept in `vendor/agbcc`, `vendor/downloads/`. Approved
  2026-11-03 (user, via the coordinator, TLA1), inside Docker only: (f) `PascalPixel/alchemy-gcc` at `641764a5` (alchemy
  f6c08e64's gitlink) in a second checkout `vendor/alchemy-gcc-tla`, for TLA's reference build; its nested pins are
  (d) and (e) unchanged (agbcc da598c1d, gcc-2.95.2 064e1cb0...).
- **D14 Licence (user, 2026-11-01; replaced 2026-11-02):** none of the vendor projects has a licence. The first
  rule was: build privately and ask alchemy's author before any public deploy. **On 2026-11-02 the user told us to
  deploy** ("Deploy everything with Netlify so I can play. Also make all port work offline..."), which replaces the
  wait for permission: the site is public at https://golden-sun-web-port.netlify.app (tools/deploy_web.sh). Still:
  never copy vendor code into our tree (our tree holds our headers, shims and tools and builds from the pinned vendor
  checkout; the compiled wasm is the deliverable), and never publish ROM bytes or anything ROM-derived.
- **D15 Online without TURN (user, 2026-11-01):** STUN only, no TURN server, the same as GoldenEye.
- **D16 Stand-ins (fallback only since the GS1 addendum):** while old_agbcc and GCC 2.95.2 are not built, `tools/build_ref.sh`
  compiles their ten objects with alchemy GCC and fits them to the original layout (`tools/ref/standin_fix.py`,
  docs/G1.md); every other byte of the ROM is verified equal. The address map marks those symbols
  `standin-xref`/`standin-offset`. When the sources are approved the script uses the real compilers.
- **D17 Shims by include guard (GS1):** the wasm build forces `port/shim/prelude.h` first; it includes our PC
  versions of hardware-bound vendor headers and defines the vendor include guards, so vendor headers are never
  edited or copied. Whole-file replacements are listed in `port/overrides.tsv`.
- **D18 Build-time transforms, not copies (GS2):** vendor C that clang cannot take is rewritten by generic rules
  (`tools/wasm/port_src.py`, `port/asm_rules.tsv`) into the gitignored build tree at build time; our tree holds
  the rules only.
- **D19 Data binding in IR (GS2):** data symbols are bound to their GBA addresses by rewriting the IR
  (`tools/wasm/bind.py`); data holding code pointers (and data pointing to it) is copied from the ROM into wasm
  buffers at run time with its pointer slots patched (`port/symbols/relocs.tsv`).
- **D20 Test interpreter for the asm ports (coordinator, GS3):** the hand ports of D6 are proven against the
  original code by our own small ARM7TDMI interpreter (ARM + Thumb, ARMv4T), test-only, no download:
  `tests/arm/arm7.js` runs the original routine's bytes from the player's ROM (or where the game copies them,
  e.g. IWRAM) on the game module's identity-mapped memory; `tests/arm/diff.cjs` runs it and our C port on the
  same random and edge-case inputs and compares results and every byte of the GBA RAM regions (EQUIV or the
  first difference); `tests/arm/selftest.cjs` holds negative controls. Unimplemented opcodes throw a clear
  error. BIOS calls in original code use a GBATEK reference in the harness (no BIOS image). Lives in tests/,
  never shipped in the site.
- **D21 G6 link harness at the serial API (coordinator, GS7):** G6 wires two game instances with an in-memory
  implementation of the **same message channel G7 uses online**, not register-level SIO emulation (that would only
  test code G7 replaces). `port/pc/link.c` replaces Serial_Initialize, Serial_PollStatus, Serial_ExchangePayloads,
  Serial_StartSend, Serial_StartReceive and Serial_StepBlockTransfer (port/fn_overrides.tsv): per-frame payloads on an
  unreliable newest-wins channel, bulk data whole on a reliable channel, SIOCNT id bits (4-5) kept plausible. The
  transport is a small interface (`port/pc/link_transport.h`: send/recv per channel, player id, connected) so G7 swaps
  in WebRTC data channels without touching link.c. Supersedes PLAN G6's register-level wording.
- **D22 One vendor checkout for both games; GS1 proven identical at f6c08e64 (TLA1, 2026-11-03):** the TLA0 pull moved
  `vendor/alchemy` 24b72a32 -> f6c08e64 (tbs: thor.c comments only). GS1 built against both (`ALCHEMY=<worktree at
  24b72a32> tools/web_build.sh` mounts the other checkout at the same container path): game.wasm 687968a7... and game.js
  895d45cc... byte-identical to each other and to the live site; regress full unchanged. **No `vendor/alchemy-tbs` pin
  is needed**; GS1 builds from `vendor/alchemy` at f6c08e64 (D1's pin is now f6c08e64 for the wasm build). Every later
  re-pin (TLA may re-pin, user 2026-11-03) repeats this check; the first time GS1's wasm differs, pin GS1 in a separate
  checkout `vendor/alchemy-tbs` used by build.py for tbs. GS1's reference build (`/ref/alchemy` in the volume,
  port/symbols/tbs-en*.tsv) stays at 24b72a32 with alchemy-gcc 9bc4e65a. TLA's reference (`/ref/alchemy-tla`) uses
  alchemy-gcc 641764a5 (D13 f; alchemy 34c36297 moved TLA's three options into the compiler); GS1's wasm uses no
  alchemy-gcc at all (emsdk clang), rebuilt after the TLA bootstrap: still 687968a7.
- **D23 TLA's listing asm is translated mechanically by asm2c, every routine D20-proven (TLA3, 2026-11-03; user decision
  TLA_PLAN 6.2):** `tools/wasm/asm2c.py` reads the vendor's listings (`recon/tla/raw`, overlay listings) at build time and
  writes C into the build tree (never committed, D2/D18): a register file `a2c_r` loaded into C locals, identity memory,
  the GBA stack in memory, NZCV as locals, direct calls between translated routines, `a2c_call` (Port_ResolveCode) for
  everything else, `a2c_dispatch` for code pointers (overlay-aware), lr continuations for returns, local calls and tail
  calls, jump tables as switches, and a codemap. Evidence (docs/TLA3.md): 1,202 of 1,207 routines translate; 30 varied
  routines EQUIV against the ROM (`tests/arm/tla/diff_tla.cjs`, 100 cases each), negative controls 4/4; the vendor's C
  drafts for the same routines give 6 EQUIV of 22 (compile, link and semantic failures). **asm2c is the default** for all
  listing routines. A vendor draft replaces a translation only when it is D20 EQUIV and wanted for readability; a hand port
  only where asm2c cannot go (the 5 routines of TLA3.md 2, the hardware-bound hand `.s`, TLA4). Supersedes D6 for TLA.

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
checks both agree on the next random number. Timeouts (GS6, docs/LINK.md): 300 frames per turn transfer (turn.c), 600/900 in the Arena, 600,000 in serial.c itself, `LINK_MAX_MISSED_FRAMES` for
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
DataChannels, room codes via a Netlify Function + Netlify Blobs, copy-paste fallback, STUN only (no TURN: D15), local room server for tests, in-page netsim (`?netsim=lat:MS,jit:MS,loss:PCT`).

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
9. alchemy-gcc has a **nested submodule** (`agbcc` -> pret/agbcc) and its `arm/Makefile` **downloads
   gcc-2.95.2.tar.gz**: `make bootstrap` needs both, beyond the three GS0 listed. Never run plain
   `make bootstrap` or `git submodule update --recursive` until approved; `tools/build_ref.sh` avoids both.
10. The Broken Seal builds with **no ROM** (alchemy ships its assets); the ROM is only the comparison target.
11. GAS 2.10 marks Thumb functions `STT_ARM_TFUNC` (type 13), not `STT_FUNC`; GCC 2.96 puts const data in
    `.text` where old_agbcc uses `.rodata`.
12. A vendor header that includes `"dma.h"` finds the vendor copy next to it before any `-I` path: override
    headers by include guard (D17), not by include order.
13. Do not copy `out/<ed>/text/messages.inc` anywhere outside the Docker volume: it is the game's text.
    `port_work/g1/gen/text/msg_ids.h` (ids only) is enough for the census.
14. A data symbol in IR is `ptr @name` (opaque pointers): binding it to an address is a token substitution with
    `inttoptr (i32 ADDR to ptr)`. Keep it that way (no typed-pointer IR, no -O0 frontend tricks).
15. alchemy's code objects are aggregates: `battle/battle.c` #includes `turn.c`, `action.c`... Transform the
    whole include closure (the build mirrors the tree), not just the files clang names first.
16. Far-call names declared K&R style (`f()`) are variadic in IR; their veneers take the target's signature.
17. ASYNCIFY re-enters a suspended import when it rewinds: run the import's side effects (onFrame) only when
    `Asyncify.state` is Normal, or every frame happens twice (port/web/port_lib.js).
18. python's `http.server` stalled headless Chrome's first page load for ~60 s: tests serve with node's http.
19. clang inlines vendor functions into their callers at -O2 before bind.py sees the IR: a function replaced
    by port/pc (port/fn_overrides.tsv) is marked noinline by port_src.py first.
20. A heap block that held a RAM copy of code is reused for data or other code: aliases must be dropped when
    anything is copied over them (Port_CodeUnalias), or a later call runs the wrong port.
21. With no save file the game skips the title intro (Title_Run: Save_ScanFileSummaries() > 0): logos, Golden
    Sun logo, then the File Screen. The full title screen needs a save.
22. Busy-waits on VCOUNT (m4a SampleFreqSet) never end unless reading VCOUNT advances time: port/c_rules.tsv.
23. A vendor C routine copied to RAM to run (`RamCode_Load(r, Tile_BuildCellPictures, n)`) has a wasm table index
    as its address: the DMA must copy the function's ROM bytes and alias the copy (hw.c, Port_CodeGbaOf).
24. Calls of K&R-declared functions (`f()`) with other argument counts than the definition become traps in
    wasm-ld (signature mismatch): link.py routes them through per-signature adapters; keep "0 linker warnings".
25. Headless Chrome shows its own error page (another origin) for an empty 404: a test that needs the page's
    origin before start (IndexedDB) loads a real page of the test server (web_shot.cjs setup.html).
26. The game tells code addresses from message ids by size (TRIGGER_RESULT_MESSAGE_END = 65536): wasm function
    pointers must be >= 65536 (link.py -sTABLE_BASE=65536, data at -sGLOBAL_BASE=131072; gba.h
    PORT_IS_TABLE_INDEX), or a routine shows as a message.
27. Indirect calls with another type than the target (routines called as void(s32) taking nothing) trap in
    wasm: -sEMULATE_FUNCTION_POINTER_CASTS=1 (ARM-like tolerance). Do not drop it without another answer.
28. bind.py routes every indirect call in port/pc through Port_ResolveCode: the file that defines it (codemap.c)
    cannot contain an indirect call (IR "invalid redefinition"); put pointer-calling hooks elsewhere (call_via.c).
29. BattleEffect_BuildBlitter assembles ARM blitters at run time from gBlitterTemplate (code generation, not a copy):
    no alias to a fixed port exists. The vendor builder still runs; a c_rules.tsv hook (Port_BlitterBuilt) aliases
    the built address to a C blitter holding the same parameters (port/pc/blitter.c, Port_CodeAliasFn).
30. wasm's i32.div/rem trap on a zero divisor; the GBA calls libgcc (__divsi3...), which returns a value, and its
    `%` takes the sign of dividend XOR divisor. bind.py sends every vendor division by a variable to our EQUIV
    libgcc ports (G6); port/pc is left alone (iwram.c implements them).
31. Shared test files (tests/arm/diff.cjs, harness.js) may hold another session's uncommitted edits: `git add` of the
    file commits theirs too. Stage only your hunks (an index blob built from HEAD + your edits, `git update-index
    --cacheinfo`), and check `git diff --cached` before committing.
32. The File Screen offers Battle only for a file whose summary counts a Djinn flag (Save_ScanFileSummaries); the
    prologue save has none. tests/link2.cjs patches a copy (summary byte 50 = 1, sector checksum + 1) in port_work/.
33. A frame-scripted route through the Arena lobby keeps working under delay/drop only because the waits are the
    game's (it polls the peer's state); tap A over a long window, and B (not A) to close the last message, or a new
    talk with the attendant starts.
34. A hidden page's timers run at ~1 Hz: anything paced by setTimeout (netsim delays, polling) is distorted there. The
    game loop runs from a Worker's ticks while hidden (net.js); the netsim queue is drained every game frame.
35. In headless Chrome the second page target (another browser context) is `visibilityState: hidden` while the first
    is visible: tests/web_link.cjs's page b exercises the hidden-page path (it must still run ~60 frames/s).
36. The game's soft reset (A+B+Select+Start) works since GS11. It was dead for two reasons: (a) System_InstallIwramAndIrqs
    copies 14 handlers from gDefaultIrqHandlers, whose symbol covers 10; the last 4 (Keypad among them) are unnamed section
    pieces after it, so the relocated 40-byte buffer handed the IRQ table garbage (port/symbols/reloc_extents.tsv widens it);
    (b) System_SoftReset calls the constant Cart_Start (`call inttoptr (i32 0x08000000)`), which bind.py did not route
    through Port_ResolveCode. Now Cart_Start/System_Entry resolve to main.c Port_SystemEntry: port_lib.js unwinds the wasm
    stack with ASYNCIFY, drops the saved state, resets the C stack pointer and runs Port_Restart (System_Entry again;
    memory and hardware keep their state, as on the GBA). Holding the keys resets again each boot, as on hardware.
37. `offsetParent` is null for `position: fixed` elements (the picture and pad in play): page tests must test
    visibility with `getClientRects().length`, not offsetParent.
38. The PPU must reload an affine reference point (BG2X/Y, BG3X/Y) on every write, not only when the value changes: the
    World Map's per-line HBlank DMA can write a line's value equal to the previous one, and stepping by BG2PD there
    shows garbage (GS9: hw.c reports DMA writes to I/O, ppu.c Port_PpuIoWritten).
39. Routing on the field: a cell's height is shape byte 1 x 8 pixels; shape kinds 1/2 are walkable west->east slopes,
    kinds 3/4/7 behave as cliff edges (the game slides the leader off). tests/probes/pathfind.cjs models it roughly;
    trust a walk (tests/probes/autowalk.cjs) over the model. GS11: slopes push the leader sideways when he turns north/south on
    them (end the leg on the flat cell past the slope); bridges live on another map layer (the river looks walled in
    layer 0); kind-4 pairs on a diagonal are cliff edges; read the scene's story order before walking (docs/G11.md 1).
40. Vendor C that tells code from data by the **bits of a code address** breaks on wasm table indices (trap 26): Field_ExamineCell
    takes a search result as an event routine only when bits 27-24 are set (FIND_FUNCTION_BITS), so every examine event (the
    minotaur reliefs) ran as a locked chest ("but Isaac can't open it..."). GS13: c_rules.tsv adds PORT_IS_CODE_INDEX (port_api.h)
    to that test. Look for the same pattern when an event shows the wrong message (task.c `func >> 24 == 2` is another one).
41. Code-range audit (GS14): every vendor C test of a value's range/high bits that may see code is listed in
    `port/tools/code_range_audit.tsv` (46 hits: 29 data, 8 safe, 7 fixed, 2 replaced; the 7 fixed are Cart_Start (trap 36), FIND_FUNCTION_BITS
    and its two tests (trap 40) and task.c's two tests); `tools/wasm/code_range_audit.py`
    runs as the build's first stage and fails on a hit with no row (re-pin or new pattern). Real fix: task.c's
    `(task->func >> 24) == 2` (overlay tasks suspended while a menu is open) never matched a table index, so scene
    tasks (World Map, Luna/Sol rooms' falling lights, eruption...) kept running under menus; c_rules.tsv adds
    Port_CodeIsOverlay (codemap.c). Before "fixing" an address difference, check build/wasm/code_as_data.tsv: bind.py
    binds asm routines declared as data to their ROM address, so `End - (u32)Routine` is already right there
    (sprite_draw.c:66; a Port_CodeGbaOf rule broke it).
    Only the Djinn, Status and (international) Item screens call Menu_SuspendFieldTasks; the Start pause menu and the English
    Psynergy screen do not, so scene tasks keep running under them by design (GS15, tests/probes/tasks.cjs).
42. Field Psynergy that "does nothing" is usually a missed target, not a bug (GS17): Field_FindNearbyPsynergyTarget takes an actor
    only within 8 px of height (Catch 48, Douse 64, Mind Read 16) and, past 11 px, within ~34 degrees of the facing rounded to a
    quarter turn; stand level and in line. Move pushes once per cast and ends on A/B/L/R. The cast tint colour is chosen by
    `gFrameCount & 7` (eight colours), so it differs from cast to cast. Diagonal stairs need diagonal input.
43. Cave routing (GS18): walls in caves are heights, and a room's levels can be separate map layers. gMapGridWork's layers[] are
    0x30 apart and each is a window into the 128-wide gMapGridCellBuffer; a cell's picture halfword bits 13-12 (if not 0) put an
    actor standing on it on that layer - 1 (actor_camera.c). A step is legal up to 8 px up and 12 px down from the actor's ground
    (MapGrid_CheckCollision); jump cells are stood on and pushed against for 12 frames. tests/probes/hpath.cjs models all of
    this; search again after Move or a scene event copies cells. Move reaches 32 px (2/3 for ACTOR_NEAR_PSYNERGY): push into the
    cliff edge before casting across a gap. Where A examines something (its reach exceeds Mind Read's), cast from the L/R
    shortcut (Psynergy menu member row: L on the member, pick the Psynergy).
44. Forest routing and losses (GS19): Kolima Forest's stumps fill their cell; the player control probes 8 px ahead at the
    heading and +-22.5/+-45 degrees (player_control.c), so stumps touching at a corner block a diagonal (hpath HPATH_MAP=3
    shows stumps; HPATH_DIAG overstates corners). Logs roll until a cell does not fit, so their order matters; push from the
    log's middle. A party wipe sends the party to the scene's restart point (scene_rules.s) with only the leader at 1 HP,
    by the game's rule. PP returns one per 160 px walked outside towns: grind with GR_FLEE when Cure's PP runs short.
45. Tret Tree routing (GS20): cocoons (behaviors 21-29, 31, 32, 50-59) tear on the first landing and drop the leader on the
    next; torn ones are jumped from like jump cells (hpath HPATH_JUMPB, HPATH_BLOCK the four drawn torn: 22, 52, 54, 58).
    Branch vines are step triggers that move the leader 5-6 cells: give autowalk the destination cell. Climbs change height,
    not the cell (WALK_STUCK=500). The tree's battles (Troll pairs) wipe a Lv 9 party; grind in Tret's glade instead.
46. World Map walls (GS21) are 4-bit collision pixels (WorldMap_GetCollision: two 64 x 64 tile maps in screen blocks 8 and
    10, values 5-12 walkable), not map cells: hpath finds nothing there; use tests/probes/wmpath.cjs. Rivers can be 10 px
    wide and bridges 12-16 px, so check a fine grid at the leader; autowalk's cell targets can miss a bridge (use keys).
    Area actors enter on touch (WM_BLOCK their cells). Bilibin Cave's walls are 16-px outlines over height 0: hpath
    over-reaches there; read MAP_MODE=height.
47. Routing (GS22): autowalk ends a vertical leg as soon as the leader enters the cell, so the next leg runs along that cell's
    edge, where an actor's collision (Bilibin Cave's ice pillars) can block a row that is open in its middle: end the leg one row
    further and come back. Push puzzles (BilibinCave_PushTorch) take ~80 frames a push before the leader can move again. Tap B,
    not A, through event text (A opens the command menu once the event ends; B answers No to a yes/no). macOS's file system is
    case-insensitive: scratch key files named `I7.txt` and `i7.txt` are one file.
48. Mercury Lighthouse routing (GS23): read the scene's trigger table first (TRIGGER_EXIT rows name the behavior of each exit
    cell; cells.cjs CL_B finds them) and the entrance rows (an exit sits by the entrance that leads back): the story order is
    in those tables (Ply before the pipes). Grates beside pipes are passages under them (stairs to y -32): walk the whole row,
    a leg ending on the stairs cannot turn. Pushed statues/pipes move only onto cells whose ground takes them; Move needs the
    target in line within 32 px (from 11 px offset the hand misses). Golden-ring pools: hold ~22 frames a hop, wait ~120 after
    a heart, plan the hops (a rim takes every ring). Menus open faster after the first cast in a run: one cast per check.
49. Mercury Lighthouse's Upper (GS24): passages under movable pipes open and close with the pipe (its column's cells are
    redrawn), so search again after every push; a pipe slides until a blocker (the other pipe), so the stone doors' stops at
    47/48/53/54 come from where the door room pipe is. Move across a gap: walk into the edge first (25 px, not 40). The
    Exterior's paths have many battles: heal first. After a field cast the menu ignores keys ~250 frames: B out and reopen.
50. Field Psynergy reach (GS25): Field_FindNearbyPsynergyTarget searches gFieldEffect_TargetRangeByMode's range per kind, 16 px for
    Ply, Frost, Lift, Carry and Growth, 32 for Move, Mind Read, Whirlwind, Douse and Halt, 48 for Force and Catch, and needs
    `distance < range` (whole pixels): standing in the next cell is not enough for Ply (a cell is 16 px; GS24's leader was 21 px
    from the waterfall statue). Walk into the target until the leader stops, then cast. The menu asks "Use it on whom?" whenever
    the scene's PSYNERGY_ON_ACTOR row does not match the actor found. Battle: Saturos (Agi 51) acts before Mia (35).
51. Re-climbing and rematches (GS26): Scene_Arrive clears FLAG_SCENE_TEMP on every entry and FLAG_AREA_TEMP (and the lit
    lighthouse's PP bonus) on every area change, the World Map included; permanent story flags change entrance rows (Mercury
    Lighthouse's CHANNELS_OPEN lands the party in the filled room). An old route's key span replays exactly when the arrival
    cell and the frames since arrival match and no random battle falls inside it (port_work/g26/shift.sh): reuse puzzle spans,
    autowalk the battle-prone legs. A lost boss fight leaves summoned Djinn on standby: the Djinn command then *sets* them (no
    unleash); summon first. The aerie's lift is behind the confrontation cells (no way down before Saturos except a loss).
52. A vendor re-pin can move the **alchemy-gcc gitlink** too (TLA1): f6c08e64 pins alchemy-gcc 641764a5, not the 9bc4e65a
    our volume's compilers come from. TLA's C then compiles with different instruction order (everything after shifts);
    the build "works" and only `compare-tla-en` fails. Check `git ls-tree <pin> alchemy-gcc` on every re-pin
    (`tools/build_ref_tla.sh fetch` refuses when `vendor/alchemy-gcc-tla` is not at the vendor's gitlink). TLA builds its
    own compilers in `/ref/alchemy-tla`; GS1's `/ref/alchemy` keeps 9bc4e65a's.
53. TLA's headers are not tbs's: other include guards (GUARD_DMA_H), register-pinned locals (`register T x __asm__("r3")`) and
    `asm("" : "+l"(x))` spelled `asm`, so TLA has its own shim (port/tla/shim) and port_src transforms TLA's headers too (the
    mirror is build/wasm-tla/alchemy/games/tla, include/ mirrored; vendor files still never edited). GCC 2.9x also took
    `extern struct X a[]` with X incomplete; clang does not (TLA prelude includes scene_tables.h first).
54. ARM GCC rounds every struct's size to 4 (STRUCTURE_SIZE_BOUNDARY 32); clang's wasm does not. TLA's static asserts caught two
    (SpriteEntry 7 -> 8, ScreenTransitionDissolveState 0x53c -> 0x540; c_rules aligned(4)); a struct with an odd size and no
    assert is laid out differently in wasm than in ROM data: check sizes before trusting ROM-bound arrays of such structs.
55. In TLA many routines are declared with other prototypes in other files (Func_020007bc taking (s32) in one scene and nothing in
    another): one wasm import with several types, ~1,100 wasm-ld warnings. link.py adapt_mismatched_calls (TLA only) routes each
    odd call through a NAME$c<sig> adapter; attribute lists (`captures(none)`, `initializes((8, 12))`) and return attributes
    (`call zeroext i8`) must be parsed or the canonical type is wrong.
56. asm2c's register file `a2c_r` is one global (TLA3): a translated routine reloads all registers from it after every call.
    If the callee yields (`wait`, a fiber switch, D8) and another task's translated code runs, the reload picks up that
    task's registers. Save and restore `a2c_r` per fiber on every switch (docs/TLA3.md 6) before translated code runs under
    the scheduler.
    **Answered (TLA5): not needed.** The port has no fibers: wait() is plain C, tasks are callbacks, the BIOS halt is
    synchronous, and ASYNCIFY keeps the C stack. a2c_call and a2c_enter_wrapped copy the file onto the C stack and
    restore it (port/tla/a2c/a2c_rt.c). If real fibers ever come, the file is still right, but the GBA stack would
    need one region per fiber (docs/TLA5.md 5).
57. D20 on coroutine routines (TLA3): under the interpreter `wait` switches task stacks, and a call out of a translation
    (a nested interpreter call) cannot follow, so the original and the translation diverge at the first yield (14 false
    FAILs in the first batch). tests/arm/tla/diff_tla.cjs makes `wait` return at once and stops both runs at the YIELDS-th
    yield, then compares memory. Battle effect scripts still need real battle state (NOINPUT under generic worlds).
58. TLA listing facts asm2c depends on (TLA3): port/symbols/tla-en.tsv has no bss or linker-script symbols (gInput,
    IwramResident_Rom, gIrqVector) and stores Thumb functions without bit 0, but a pool word `.4byte Func` holds
    address|1 (a jump table or callback built from it differs by one); the listings hide code in `.2byte`/`.4byte`
    (`mov lr, rX; .2byte 0xf800` = call via lr), use `1:` + `.reloc 1b, R_ARM_ABS32_NOI, sym` for a pool word, alias two
    global labels to one address, and let a routine fall through into the next. Check the D20 trace (TRACE=1) first when a
    translation fails.
59. TLA's veneers are all one macro, `NAME:` then `overlay_veneer TARGET` (TLA2b). They live in each overlay's import .s,
    and in gamepak/far_call/*.s, which also has two labels on one veneer and `ldr r4,[pc]; bx r4; .4byte T`.
    The same NAME can lead to different targets in different overlays (611 names), so an overlay's call must be
    renamed ovNNN_NAME (bind.py, tools/wasm/overlay_imports.py), never resolved globally. The same goes for an overlay's
    own asm routine: link.py's "only one overlay defines it" fallback would otherwise call another overlay's C copy.
60. One TLA C object can be linked into many overlays (field/object/set_sprite_priority: 49). Bound modules were named
    by object path, so the last overlay's binding overwrote the others. They are now `path@NNN` (game.bound_names),
    and link.py links only this build's vendor objects (a stale `.o` duplicates every symbol). In bind.py the name
    `bname` was already in use (the relocated buffer name) inside the module loop: reusing it silently dropped 13 modules.
61. GCC 2.9x took redeclarations clang rejects. A file's `extern u8 gMainRoutineWork[]` meets the struct the TLA prelude
    brings in; a `static` definition of a header's extern function (spawn.c Effect_Create); `s32` vs `void` and
    volatile redeclarations; and an implicit declaration before the real one. TLA c_rules fix each per file text;
    a TLA replacement may contain `\n` to put a `#define` on its own line.
62. TLA's handwritten asm is GAS source with macros, which asm2c does not read (TLA4a). port/tla/hw/tools/hw2c.py gives asm2c
    the linked bytes instead, as a listing per run of adjacent objects:
    - from the reference ELF, at the run address (IWRAM code at 0x03000xxx / 0x03006000, not its ROM copy);
    - modes from the ELF's `$a`/`$t`/`$d` mapping symbols.

    Thumb function values in syms.txt carry bit 0: mask them before reading bytes, or every Thumb routine is read one
    byte off. Per-object byte compares against GS1 mislead for the IWRAM block (TLA splits GS1's iwram_routines.s into
    files): compare per label.
63. A GS1 port is a TLA twin only when three things hold (TLA4a): the TLA bytes equal GS1's (pool words and BL offsets
    of moved symbols excepted), GS1's port is itself EQUIV, and the port is not `static`. SoundMain, MPlayMain, ply_note
    and m4aSoundVSync are GS1 C without EQUIV, and clear_modM is static. Several TLA labels alias a GS1 port under
    another name (BattleEffect_DotProduct = RelocatedQ16DotProduct, SoundNote_Detach = RealClearChain): find twins by
    bytes, not by name.
64. In D20 a random word used as a code pointer makes the original run garbage. The garbage can even "return" and
    match (TLA5: 2 false FAILs and 35 false EQUIVs). tests/arm/tla/batch/batch.cjs counts execution outside these
    places as no input: the ROM, the resident IWRAM block below 0x03001100, the loaded overlay window and the
    interpreter scratch area.
65. asm2c's dispatch picks an overlay routine by a2c_overlay_current() (TLA5). The overlay loader must call
    Port_A2cOverlayLoaded(id) next to Port_CodeMapOverlay(id), or overlay code pointers taken in translated code go
    to a2c_call and the codemap instead. In TLA nothing calls either yet: port/pc/decompress.c is GS1's, and
    Resource_LoadCode is TLA4's.
66. A routine boundary must be a real entry (TLA4a2). TLA's hand .s label many spots inside a routine (AlchemyUncredited*,
    local to the object, and a few globals such as Resource_DecodeType2Loop that are only ever branched to). As asm2c
    routine starts they cut the routine: a computed `add pc, pc, ip, lsl #3` or a back branch then leaves for a spot
    that is no entry, and a2c_call goes to Port_ResolveCode with a mid-routine address. D20 does not catch this: the
    harness's a2cCall interprets ANY address, so such translations pass (TLA4a counted 119 such call-out targets;
    hw2c now leaves those labels out, 42 remain, all sound-driver jumps into other routines). Splitting at the targets
    instead (a new routine start) turns loop back edges into nested tail calls (unbounded C recursion): do not.
    Check the generated C's constant a2c_call targets against the symbol table after any front-end change.
    **TLA4b:** the build now checks this (tools/wasm/call_targets.py, stage `calls`, allow list
    port/tla/call_targets_allow.tsv), and asm2c gives a constant mid-routine target of the main image an overlap entry
    (a second routine from the target to the end), which needs no split.
67. A routine can return past its caller (TLA4b). mplay_main's `pop {pc}` epilogue, reached by tail branches after
    MPlayMain's own `bl`s changed lr, pops the return address MPlayMain pushed. asm2c's "callee returns to the lr it was
    given" then dispatched the wrapper's sentinel as code. Callees now report where they returned (a2c_ret_to), and
    frames unwind to the one that returns there. Register jumps to code with no entry still break this: decode_2 loads
    helper addresses from a pool (`ldm ip, {sl, fp}`) and jumps to 0x08012e74, so the target must get an entry
    (docs/TLA4.md 7, the TLA4b stop point).
68. Translated code writes the hardware registers itself (TLA4b). The colour kernel loaders `stmia` the three DMA3
    registers and call the copy at once. C goes through Dma_Set, but a2c stores did not, so the DMA ran only at the
    next halt. asm2c's stores now call a2c_io_written. Also: one 43 MB translation unit was OOM-killed at -O2 (exit
    137; the 8 GB Docker VM), and emcc still exited 0. link.py now splits it (16 units, 3 at a time) and fails on a
    missing object.
69. A computed call into a table of helpers (TLA4c). decode_2's `add r9, pc, #imm; mov lr, pc; add pc, r9, r8, lsl #5`
    (r8 masked by `and r8, r2, #M`) calls one of 16 helpers 0x20 bytes apart that have no label. Constant-target checks
    do not see them: asm2c lists the slots as `a2c_table(...)` and gives each an overlap entry; call_targets.py counts
    them. Look for `add pc, rB, rI, lsl #k` whenever a register jump lands on "continuation at <code address>".
70. In the port time passes only in the BIOS halt (port/pc/hw.c). A translated loop that polls memory or a DMA bit
    (System_WaitForFrameInterrupt) spins for ever unless its back edge halts: asm2c `mark_spins` adds a2c_spin() to
    short load-and-test loops (TLA4c). A loop that also stores, calls, or carries a register is no poll.
71. Bit 0 means Thumb only on a GBA address (TLA4c). Game data can hold C function pointers (m4a SoundInfo.func,
    CgbSound: wasm table indices); `index | 1` is the next function in the table. asm2c's `blh` uses A2C_THUMB; never
    mask or set bit 0 of a value below 0x20000 (PORT_TABLE_END). Symptom here: the VBlank handler ran from the sound
    callback, the frame flag was always set, wait() never halted, no frame ever completed.
72. TLA's resident sound mixer and its render patch their own instructions (TLA4c): resident_mixer_lanes.s copies mla
    kernels over `.4byte 0xfedcba98` placeholders, the render rewrites its branch words. asm2c cannot translate them
    (once `adr; bx` is followed, the flow reaches the placeholders: "ARM NV"). SoundDriver_EnterVBlankUpdate is bound
    to Port_TlaSoundEnterVBlank which since TLA4d mixes and renders in C (port/tla/hw/pc_tla_mixer.c, checked by tests/arm/tla/diff_mixer.cjs:
    the interpreter runs the self-patching original from memory).
73. A code pointer stored as data has two spellings in TLA (TLA4d): translated asm writes a C routine's GBA address
    (`ldr r0, =Func+1; bl Task_Add`), C writes its wasm table index. Any vendor C that compares such words (the task
    list: Task_Remove/Find/Add/SetFlags/SuspendAll/ResumeAll) must compare one key: Port_TlaTaskKey (pc_tla.c). Symptom:
    the clear scene's blend task never ended, BLDALPHA kept counting, windows pulsed over the logo. Look for the same
    pattern wherever C stores or compares callbacks that asm also passes (event/script handlers, IRQ slots).
74. A direct call through a cast to another function type (TLA6: `((s32 (*)(s32))BattleEffect_GetResourceGroup)(x)`
    on an s8 function) is valid on the ARM and a trap in wasm: LLVM emits a `NAME_bitcast_invalid` stub and wasm-opt
    turns the caller into `unreachable` (Scene_GetAreaNameIndex). link.py's adapt_mismatched_calls sends such calls to
    the `NAME$c<signature>` adapter. After a link, `grep -rl _bitcast_invalid build/wasm-tla/obj` must be empty.
75. A K&R call that passes fewer words than the callee's definition gets 0 for the missing ones in wasm (link.py
    adapter()); on the ARM they are whatever the caller's registers hold, often its own incoming argument passed
    through. TLA6b: is_condition_active.c's `GameFlag_Test()` meant GameFlag_Test(condition) (r0), so every trigger
    condition tested flag 0 and the Venus Lighthouse statues never moved. TLA7: 11 more given their words (c_rules,
    docs/TLA6.md 15); the build's `calls` stage runs tools/wasm/short_knr.py, which fails on any adapter that drops words
    unless port/tla/short_knr_allow.tsv says why that is right (5 rows). Read the caller in port_work/tla1/*.elf (Thumb).
76. A D20 run that draws all routines' inputs from one random stream is order dependent: adding a routine to the
    report or one routine stopping early moves EQUIV/NOINPUT elsewhere (TLA6b: 251 -> 248 with no translation
    changed). The batch and diff_hw seed each routine by name, and the batch restores the same memory before each.
77. TLA's battle effect blitters are built by raw asm (Func_08196404: BattleEffect_PatchTemplate copied with ldm/stm,
    fragments by DMA3, immediates and branch words patched), the twin of GS1's vendor C BattleEffect_BuildBlitter (trap
    29). It is bound to Port_TlaBuildBlitter (port/tla/hw/pc_binds.tsv, link.py): the translation runs, then the slot is
    aliased to GS1's port/pc/blitter.c with TLA's mode numbers (0 additive, 1 lighten, 2 transparent, else copy).
    tests/arm/tla/diff_blitter.cjs checks it against the ROM's builder and its ARM in the interpreter. The same block
    held the field's picture decoder alias (trap 20): HeapSlot_Alloc/AllocEwram drop aliases in a block handed out fresh.
78. tools/wasm/leak_check.py picks its section table by PORT_GAME (default tbs). Run by hand on TLA's game.wasm with
    the TLA ROM it looks up GS1's sections in the TLA ROM and gives a false FAIL (TLA8: 1 hit in "direct_sound_samples");
    use `PORT_GAME=tla` (build.py sets it; tools/deploy_web.sh now does too).
79. TLA field maps (TLA8): layer L's cells are the same 128-column buffers (0x02010000 / terrain ids 0x02024000) offset
    by 64 * L columns, so layer 1's cell (x, z) is column x + 64 (Map_CopyCellAttributeRect(108, 38, ..., 102, 56) in
    Suhalla Gate's prepare writes layer 1). Climbable vines are cell byte 3 bit 0x40 (byte 3 is 0 elsewhere), climbed
    by holding the direction into them; a cliff with no slope cells (kinds 3/4 are diagonal height splits, 7 a pixel
    mask) is not a port bug before the vines and layer-1 passages are checked.
80. A vendor C local (a buffer on the GBA stack) lives on the wasm stack in the port, not in GBA RAM (TLA8: GS1's
    password buffer in FileScreen_Run was at 0x19c580). A probe that looks for game data in 0x02000000-0x0203ffff
    misses it: scan the whole linear memory, and identify the data by its own structure (tests/probes/password.cjs).
81. TLA's scene overlays are linked and loaded at 0x02008000: a listing name Data_0200xxxx / gData_0200xxxx in an
    overlay draft is RAM 0x0200xxxx + 0x8000 (the clear overlay's tables at 0x0200a490-0x0200a6c0). Absolute names
    of the main image (gData_02000000, Data_02012f94) are not shifted.
82. link.c's bulk limit (TLA8): Serial_StartSend sends a buffer larger than BULK_MAX as 0 bytes (and the receiver
    imports its stale buffer). GS1's clear-data send is 4100 bytes; TLA8's GS1 limit 4096 carried nothing. **Since
    TLA9a BULK_MAX is 4352 in both games** (wire format unchanged: the size is a u32 in the bulk header). Shared port/pc
    files differ per game only under PORT_GAME_TLA; when a change is meant for one game, check the other's IR of the
    file is unchanged (emcc -S -emit-llvm before/after).
83. (GS27) **regress RAM digests are build-specific**: the game keeps wasm table indices and pointers into the module's own
    data (relocated buffers) in its RAM, and even writes such a pointer into its save. Any change to code or data layout
    changes them; pictures do not. Compare two builds with `MASK_CODE=1` (tests/probes/digest.cjs: words in 0x10000-0x1ffffff
    count as 0), `--update` with one build and compare with the other (docs/GS27.md 4).
84. (GS27) **stale objects are linked**: the wasm build links every object left in build/wasm*/obj, also those of deleted or
    renamed port files (main's build/wasm had `probe_tmp.ll.o`, Port_ProbeMsg, in the "GS1 687968a7" build). Hash or
    compare builds only after `rm -rf build/wasm` (or deleting the stale ll/bound/obj files).
85. (GS28) **the save holds the actor snapshot; keep it in GBA spelling**: gActorSnapshot (0x02001104, in the save
    buffer) gets DMA copies of live actors, whose `script` may be a reloc buffer (module data) and `update` a table
    index. port/pc/save_compat.c turns them into GBA addresses at the end of Actor_Snapshot and back in Actor_Restore,
    and migrates pre-GS28 saves with the live build 687968a7's tables (port/pc/save_legacy.h, never remove). Any other
    saved structure that gets a relocated pointer or a callback needs the same; find them by diffing the saves of one
    route on two builds (docs/GS27.md 8). Since GS28, link.py refuses stale port/pc and probe/tmp objects.
    **TLA (TLA9a)**: the same for gSnapshotObjects (0x02001024, 32 x 0x80; slots at 0x02001004): ObjectTable_Snapshot
    (c_rules) ends with Port_TlaObjectsSnapshotToGba; the raw restore Func_080cae5c runs inside asm2c port hooks
    (trap 86) that hand it this build's values and put the snapshot back. Test: tests/probes/tla_snapshot.cjs.
86. (TLA9a) **asm2c port hooks**: a translated raw routine can run port code on entry and before its single exit
    (port/tla/a2c_hooks.tsv: routine, enter, leave; void(void), registers untouched; emitted as A2C_PORT_HOOK). Only the
    game build defines A2C_PORT_HOOKS (build.py stage_asm2c), so the D20 test modules still test the plain translation.
    Use it when a raw routine must see port-side values (pc_binds.tsv rows only catch calls by symbol: a translated
    caller's direct `a2c_XXXX()` call bypasses them).
87. (TLA9) **worktree builds: copy port_work inputs, do not symlink them**: tools/web_build.sh runs build.py in Docker
    with the repo mounted at /gs; a symlink in port_work/ pointing outside the worktree (tla1/overlays, g1/alchemy) is
    dangling inside the container, and the TLA build then quietly links with stubs (106 logged stubs, 5 new call
    targets, a smaller game.wasm). Needed: port_work/tla1/{tla-en.map,syms.txt,tla-en.elf,overlays}, tla2/gen,
    g1/gen, g1/alchemy/overlays (copies). The vendor/ symlink is fine (Docker resolves a bind source's symlink).
88. (TLA9) **two games in one page**: both game.js factories are the global `GoldenSun`; transfer.js keeps TLA's, loads
    GS1's ../game.js, takes it and puts TLA's back (MODULARIZE; locateFile to ../). A service worker's FILES may name
    files above its scope ('../game.js'); Cache.addAll refuses duplicate URLs, so it installs each resolved URL once.
89. (GS29) **the OAM build's hidden entries are y 192**: oam_kernel.c fills unused entries with 0x00C000C0 words (y 192,
    x 192, tile 0xC0). Off the GBA's 160 lines, but a renderer that draws more lines (Map zoom's bottom margin, up to 64
    rows when the frame is clamped to a map's top) reaches them: ppu.c's margin rows skip exactly those entries.
90. (GS29) **"inside the field sequence and a map scrolled" is not "a field map on screen"**: the File Screen after
    Continue runs inside FieldSequence_Run with MapGrid_UpdateLayerScroll stamping. Map zoom zooms a frame only when the
    previous field frame's map layers matched the map grid's cells on at least 80 lines (ppu.c ZOOM_MIN_LINES).
91. (GS29) **a class's `display` beats the `hidden` attribute**: `.opt-big { display: inline-flex }` keeps a `hidden`
    label visible (the TLA page's zoom row); hide such rows with `style.display = 'none'` or a `[hidden]` rule.
92. (GS30) **the World Map's cell-picture table is borrowed by the still picture**: WorldMap_StartStillPicture draws
    the frozen view into Ram_MapGridCellBuffer (0x02010000) a frame before it shows, and WorldMap_LoadAreaGraphics
    decodes the table back a frame after the moving view returns. Anything that reads cell pictures there on those
    frames (ppu.c's World Map cell checks) reads picture bytes: keep the last moving frame's result while the BG maps
    and Ram_CellPictures are unchanged. Also: World Map lines switch DISPCNT mode per line (VCount/HBlank handlers:
    the opening letterbox, the encounter's centre line), so a margin row must take its line's mode, not the frame's.
93. (GS31) **game RAM at line 0 is one frame ahead of the BG registers**: the VBlank loads BGxHOFS/VOFS from gBgScroll,
    then the game's logic (at once, in the port) moves gMapGridWork's camera for the next frame. Anything that places
    or masks the picture from the camera (Map zoom's frame placement) must take it at Port_PpuVBlank, not at line 0,
    or a frame held at an edge jitters by the camera's last step. tests/probes/zoomjitter.cjs measures it.
94. (GS31) **a worktree TLA build also needs build/a2c/report.tsv** (copy main's build/a2c): without it hw2c skips the
    extra listings, the call-target check FAILs (0x081c0168 new, 2 stale) and game.wasm differs (c1bdbbd2, not df7c39fb).
