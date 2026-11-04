# TLA9a: integration (2026-11-04): gs1-options merged, GS1's bulk limit, TLA build-independent saves

## 1. Merge of gs1-options (GS27 + GS28)

Merge commit fdbbbfb (no rebase, no squash). Textual conflicts only in orchestrator.md, docs/HANDOFF.md and
docs/progress/sessions.tsv: both sides kept. The branch's traps 77-79 became **83-85** (after main's 77-82), with
their references (HANDOFF, orchestrator, port/c_rules.tsv, port/pc/save_compat.c, port/shim/port_api.h,
tools/wasm/link.py comments). No code conflicts: main's TLA work did not touch ppu.c/main.c/options.c/save_compat.c,
the branch did not touch link.c or TLA's files. port/pc/save_legacy.h kept (the live build 687968a7's tables). The live
build is kept in `port_work/live_687968a7/` (game.js/wasm + tsv + its site) for migration tests. The worktree
`~/golden-sun-wt/gs1-opts` was removed (clean; its untracked `vendor` symlink deleted first, its GS28 test files copied
to `port_work/gs28_savefix/`); the branch is kept.

## 2. GS1 link.c: BULK_MAX 4096 -> 4352 (both games)

`port/pc/link.c`: one BULK_MAX 4352 for GS1 and TLA (TLA8's `#ifdef PORT_GAME_TLA` gone). GS1's FileScreen_Run cable
send is `Serial_StartSend(gSaveBuffer, 4100)`; sizes above BULK_MAX went out as 0 bytes (trap 82).

- **Wire format: unchanged.** A bulk message is still type, epoch, seq u16, size u32, then the bytes; only the
  sender's and receiver's buffer limit grew. GS1 link battles send at most 340 bytes, so a peer with the old limit
  links as before. (Old cached pages cannot link with new ones anyway: net.js's hello check refuses a different
  build id.) port_lib.js / net.js / link_loopback.js have no size limit of their own.
- GS1's module data moves 0xa00 higher (the larger static buffers), so unmasked regress RAM digests change (section 4).
- Online battles: tests/web_link.cjs (two pages, real WebRTC, local room server) PASS clean, 20/20 hashes, b won;
  link2 (node) 20/20, b won.

**Route (a)** (`node tests/transfer_a.cjs`, now run to the end by `tools/transfer_pw.sh route_a`): GS1 puts 4100 bytes
on the wire, TLA receives at f2105, "Transferring data", the review (Isaac Lv 15, Exp 12,814, HP 0/158, Down), B at
f2321, transfer_check (cable) at f2421: **52/52 PASS, units sha1 14648e8f916d, flags sha1 6ffcc5c1ef6b**, the same as
the `--virtual` stand-in run (52/52, same two SHA-1s; the 52 checks include coins -> gMainRoutineWork+0x28c). Both
deterministic (`--twice`).

## 3. TLA build-independent saves (GS28's approach)

TLA saves 0x02000000-0x02002ff0, which holds `gSnapshotObjects` (0x02001024, 32 struct Actor of 0x80; slot ids at
0x02001004). `script` (+0x00) can be a relocated buffer (module data), `update` (+0x6c) a table index.

- **Snapshot** (vendor C ObjectTable_Snapshot, field/object/table.c): a port/tla/c_rules.tsv rule ends it with
  `Port_TlaObjectsSnapshotToGba()` (port/pc/save_compat.c, PORT_GAME_TLA part): every entry's script and update in
  GBA spelling (buffer -> its symbol's GBA address, table index -> code address | 1).
- **Restore** is raw asm: Func_080cae5c, called by FieldSequence_Run when flag 265 is set (Continue): it DMA-copies
  each listed entry onto its object (ObjectTable_Get). New: **asm2c port hooks** (`port/tla/a2c_hooks.tsv`,
  `A2C_PORT_HOOK`, tools/wasm/asm2c.py `port_hooks`): a void(void) port function after the routine's register load and
  one before its single exit. build.py defines `A2C_PORT_HOOKS` for the game build only (the D20 test builds translate
  the routines without them). `Port_TlaObjectsRestoreEnter` gives the listed entries this build's buffer and table
  index; `Port_TlaObjectsRestoreLeave` puts the snapshot's own words back, so the snapshot (and the next save) stays GBA.
- save_compat.c's GS1 legacy tables (save_legacy.h) stay GS1-only; TLA gets the loaded overlay from codemap.c
  (`Port_CodeMapCurrentOverlay`, TLA only). No TLA build was deployed: no migration.

**Test** (`tests/probes/tla_snapshot.cjs`, `tests/routes/tla/save2.keys`: after save.keys, B, a second save with
"OK to save over this file?" Left/Yes): the probe sets the highest-id live object's script to this build's
gActor_StepAngleScript buffer each frame f15300-15730 (as an object running that relocated script) and a table index
(Actor_ResetMotion, 0x108d8) into the stale entry 31; the second save is written at f15721.

| build | buffer planted | saved script / update | save SHA-1 |
|---|---|---|---|
| 2ee38c9f (this) | 0x9dcb4 | 0x080f3300 / 0x08020139 | b2e0e51a... |
| same + 24 KB padding data (test only) | 0xa3cf4 | 0x080f3300 / 0x08020139 | b2e0e51a... (byte-identical) |
| eade7bef (before the fix) | 0x93114 | 0x00093114 / 0x000108d8 | differs (18 bytes) |

Continue from that save on the padded build: the restore turns entry 19's 0x080f3300 into 0xa3cf4 (its own buffer;
seen with a temporary print in the padded build only), the snapshot stays 0x080f3300; masked RAM digests of Continue
equal on both builds (5/5). (The scene then gives object 64 its own script again: the game's behaviour.)

## 4. Checks

Clean rebuilds (`rm -rf build/wasm build/wasm-tla`):

| | game.wasm SHA-1 | game.js SHA-1 | site build id |
|---|---|---|---|
| GS1 | 6d08d4c8f9bdec01bb0240991e4eeccf58856977 | cab9b56bc4f2a5fcb4fd96a336fe2d537ca6d0cf | e48c5ad1fd47a302 |
| TLA | 2ee38c9f4be445f42cb2181f00d651a7e548cd56 | 8c87348c209985b42476682b71b23a5abe5a3cd8 | dc1a9a3baba11a67 |

| check | result |
|---|---|
| GS1 regress full (62 cases + link2), DIGEST_BOTH=1, against GS28's 087d3b7e run the same way | 46/46 saves byte-identical, 503/503 pictures equal, 503/503 masked RAM equal; unmasked RAM rows all differ (data +0xa00): expected.tsv RAM rows rewritten; `--quick` 9/9 OK after |
| link2 | 20/20 agree, b won |
| web_opts / --wide | ALL PASS / ALL PASS (0 console errors) |
| web_phone / --query wide=1 | ALL PASS / ALL PASS |
| web_offline, web_touch, web_link (two pages, WebRTC) | ALL PASS, ALL PASS, PASS (clean) |
| regress_tla 13 cases vs eade7bef, DIGEST_BOTH=1 | masked RAM and pictures equal in all 13, save SHA-1 equal; pictures + save equal to the old expected rows; expected_tla.tsv RAM rows rewritten (69); re-run new_game/save/continue OK |
| tools/transfer_pw.sh --twice | gold 63/63, silver 67/67, bronze 43/43, cable 52/52, route_a 52/52; second runs identical; expected_transfer.tsv rewritten (clear save: its source ml_saturos_win.sav now from a GS28 build; TLA RAM digests; route_a fixed); units/flags rows unchanged |
| D20 batch | 219 EQUIV / 0 FAIL / 986 NOINPUT |
| diff_tla / negative | 30/30 / 4/4 |
| diff_hw / negative | 124/0/64 / 4/4 |
| diff_mixer, diff_blitter | 300/300; 160 builds + 4,800 draws EQUIV |
| test_arm | 79/79 |
| call targets, short K&R, _bitcast_invalid | PASS (9 allowed), PASS (5 allowed), none |
| leak | GS1 PASS, TLA PASS |
| TLA page: web_offline, web_phone (SITE_DIR=build/site/tla) | ALL PASS, ALL PASS |
| migration: live 687968a7 copy plays sol_star_room and saves (0x88d4c in 12 words) -> new build plays mt_aleph | 14/14 unmasked RAM digests equal to the new build's own chain (and to expected.tsv); mt_aleph save identical outside the stale sector 0x3000; web_opts with the live save ALL PASS |
| `tools/deploy_web.sh --dry-run` | DEPLOY_DRY_RUN: OK (31 files, 25 MB; tla/game.wasm 20 MB note); not deployed |

Test files (save-derived, not committed): port_work/tla9a/ (builds normal/pad/eade, saves, logs, chunk scripts),
port_work/tla9a/mig/ (migration), port_work/regress_087d, port_work/regress_tla_eade.
