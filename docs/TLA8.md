# TLA8: the games' own transfer, by hand (2026-11-04)

Plan: docs/TLA_PLAN.md 3.1-3.3, phase TLA8, decision 6.1. The reference TLA9's one-"yes" version must equal.
Everything the games produce here (the cleared save, the passwords, their key routes, RAM dumps, captures) is
save-derived and stays in `port_work/tla8/` (never committed). Committed: tools, probes, key routes up to the menus,
digests.

One command runs it all: `tools/transfer_pw.sh [--twice] [gold|silver|bronze|cable|route_a ...]` (~30 s; needs
`port_work/regress/ml_saturos_win.sav`, which `tools/regress.sh ml_saturos_win` makes). Digests:
`tests/regress/expected_transfer.tsv` (`--update` rewrites them).

## 1. The test-only cleared GS1 save (6.1, as approved)

Exactly the method of 3.3, no byte patching: `ml_saturos_win.sav` (GS26, Lv 15, Isaac/Garet/Ivan/Mia) is continued
(`tests/routes/gs1_clear.keys`); at f2100 the test-only warp probe (`tests/probes/warp.cjs`, `WARP_SCENE=1
WARP_ENTRANCE=2`) calls the game's own `Event_SetDestination(SceneId_FileScreen, FILE_SCREEN_FROM_TITLE)`, the
destination Title_Run sets after the credits. The File Screen asks "Save your adventure?" -> Yes -> "You cannot resume
your adventure with this data." -> file 2 (empty) -> `Save_ToChosenFile` writes it with `gMainRoutineWork.sendFlag = 1`.
The flags of the ending are not set (the party is mid-game; the plan says so). File 1 stays the uncleared
`ml_saturos_win` file, so the Send list shows "(Not cleared yet)" / "Isaac (Clear data)" (the TLA9 several-files case
in miniature). SHA-1 565fd2ec6264..., the same on every run.

## 2. GS1's hidden Send menu, by keys

`tests/routes/gs1_send.keys`: title, Start, **R+Left held while the File Screen's menu is built** (Save_ScanFileSummaries
offers Send only then), Right x4 from Continue to the sixth icon (Send), A: the "Link" list (cleared files only), A:
"Transfer Method" (Password first, then Cable).

## 3. Passwords (Gold, Silver, Bronze)

- **Read from GS1's own screen.** The password is FileScreen_Run's local buffer, so in the port it lives on the wasm
  stack, not in GBA RAM (trap 80). `tests/probes/password.cjs` finds it by the encoding's own structure (symbol i =
  raw + i mod 64; every 10th raw symbol = the sum of the nine before it): Gold's 26 check groups locate it uniquely;
  Silver (6 groups) and Bronze (1 group: hundreds of chance matches) are read at the address Gold gave
  (`PW_ADDR`). Each was compared with the screen (first page) by eye: equal. 260 / 61 / 16 symbols.
- **Typed into TLA by keys.** New game, Felix named, "Transfer data from Golden Sun?" Yes, "Transfer Method":
  Password, the level (`tests/routes/tla/transfer_pw.keys`), then `tools/pw2keys.cjs` walks TLA's entry grid: 16 x 4
  symbols, row-major, **the same 64 symbols in the same order as GS1's FileScreen_NameEntryCharacter**
  (A-H J-N P-Z 2-9 / a-k m n p-z ! ? # & $ % + =), 8 frames per press; the last symbol completes the entry
  ("Password accepted."), A, Isaac's name (END, A), a party review (B leaves it).
- All three accepted. Gold ~16,400 frames of typing.

## 4. What TLA does with it (vendor code read) and the checks

The clear flow (Func_02000328, overlay 64A, `resource_64a_overlay.s`; overlays are linked at 0x02008000, so the
listing's `Data_020026a0` is RAM 0x0200a6a0) does, around either entry:

1. **saves 0x02000000-0x02003000** (flags, gMainRoutineWork, units: the whole state) to gMapCellBuffer;
2. runs the entry: password (Func_02000e44: CRC check, a **new game** by Func_080addf0 through Func_02002350,
   party 0-3 made active, **Func_020018e0** unpacks) or cable (Func_02000b24: greeting, receive into 0x02013000,
   flag bytes 0x214 from +0x40, GS1's work + 8 units 0xd20 from +0x240 to TLA's 0x260: TLA's work is 0x20 longer,
   so GS1's units land on TLA's at 0x520 and GS1's coins on TLA's), then the review screen (Func_080f8010);
3. copies the resulting state to the buffer at 0x02013000, **restores** the state saved in step 1;
4. runs **Func_080ae410(buffer, keepSettings)** (1 password, 0 cable): units 0-3 copied in keeping their TLA names
   (cable: u16 +0x14a = byte +0x128), story items (item flag 0x20) removed with the slots compacted, recomputed;
   Func_080ae16c refills HP/PP of the **active** party only; flags 0x800 + e*7 + n = the buffer's Djinn flags
   48 + e*20 + n; 0x820 + k = the buffer's six flags of Data_080b1284 (= GS1's six password flags), then **0x822
   toggled** (GS1's "Hsu rescued without party" arrives inverted); the buffer's coins go to **gMainRoutineWork+0x28c**
   (the live coins stay TLA's); flag 44 + keepSettings and 47 set; cable: five settings bytes copied (GS1 work
   +0x205, +0x206, +0x20c, +0x20a, +0x22a).

So the six story flags, the TLA Djinn flags 48+ and the coins the entry set exist only in the buffer; the live state
holds units 0-3 and the 0x800/0x820 flags. `tests/probes/transfer_check.cjs` checks both, field by field, against the
vendor's rules (GS1 side: FileScreen_PackPasswordData; TLA side: the drafts of Func_020018e0, Func_02000b24,
Func_080ae410 and the listing):

| Route | Checks | Carried (beyond levels, experience = Unit_GetExperienceForLevel, Djinn) |
|---|---|---|
| Gold | 63/63 PASS | base stats (Attack/Defense/Agility read back as 9 bits), 15 slots per member (item ids, 5-bit counts of 23 stack items; the equipped bit is not carried, so the party arrives unequipped), coins 17,744 -> +0x28c |
| Silver | 67/67 PASS | base stats, the 8 Psynergy items held by anyone (added by PartyInventory_Add) |
| Bronze | 43/43 PASS | Psynergy items; base stats are the new game's (none equal GS1's) |
| Cable (GS1 stand-in, 6) | 52/52 PASS | the whole units as stored (base stats, experience 12,814 not the level's, inventory with equipped bits and counts), HP as GS1 had it (Isaac and Ivan arrive **down**, as they were in the save after Saturos), settings, coins -> +0x28c |

The Djinn: GS1's four held Djinn (1 Venus, 2 Mercury, 1 Mars) are dealt one per member by
Djinn_AddToLeastLoadedOwner on the password routes; the cable keeps GS1's owners. No port bug was found on these
routes: every difference from the plan's summary (3.1) is the vendor's code (corrections in section 7).

Determinism: every route run twice gives identical checks, unit/flag SHA-1s and RAM/picture digests
(`tools/transfer_pw.sh --twice`).

## 5. Route (a), the cable, in node: `tests/transfer_a.cjs`

TLA had no link layer: its serial driver (src/system/serial + raw Func_08016180 / Func_08016990) drove the SIO
registers. **Added (commit 5027ea8):** port/pc/link.c serves TLA too (TLA's driver has GS1's globals, layouts and
entry points): Serial_PollStatus / ExchangePayloads / StartSend / StartReceive through port/tla/fn_overrides.tsv;
Serial_Initialize = Func_08016180 and Serial_StepBlockTransfer = Func_08016990 through port/tla/hw/pc_binds.tsv with
a new `replace` column (hw2c leaves them untranslated, so the translated VBlank handler reaches link.c through
a2c_call); under PORT_GAME_TLA only, the receive global's name (gSerialReceiveDest) and BULK_MAX 4352. GS1's link.c
IR is byte-identical (checked), GS1's build unchanged (687968a7 / 895d45cc).

`node tests/transfer_a.cjs` runs GS1 (player 0, the cleared save, Send -> Cable: `gs1_send.keys` +
`gs1_send_cable.keys`) and TLA (player 1, empty save, Yes -> Cable: `tests/routes/tla/transfer_cable.keys`) in
lockstep on link_loopback:

- **The greetings meet**: GS1 "0000", TLA answers "UVTS" (English: 'U' on both sides; the plan's 'S' is Spanish),
  GS1 shows "Sending data" and calls `Serial_StartSend(gSaveBuffer, 4100)` at f2105.
- **GS1's link.c puts 0 bytes on the wire: `BULK_MAX` is 4096 < 4100** (`if (size > BULK_MAX) size = 0`). GS1's send
  completes (GS1 back to its menu), and TLA's Func_02000b24, seeing the receive finish, imports **whatever was in its
  buffer**: the review shows a garbage member (Lv 40, no name, down). Route (a) needs a GS1 change (BULK_MAX >= 4100
  in port/pc/link.c's GS1 path: a new GS1 game.wasm), which this phase was told not to make: **stopped and
  reported**. Nothing is deployed with TLA linking, so no player meets this; the fix should land before TLA9.
- `--virtual FILE` replaces the GS1 instance by a stand-in on the same transport that plays FileScreen_Run's side
  (payload "0000", waits for "UVTS", one 4100-byte bulk) with the bytes GS1's own `Save_ChooseAndLoadFile` loaded
  (a dump of 0x02000000 on the Transfer Method screen; equal to the dump on the password screen). TLA receives
  4,100 bytes, "Transferring data", the review shows Isaac Lv 15 Exp 12,814 HP 0/158 Down, and the cable checks pass
  52/52 (section 4). This is TLA9's design (c) in a test, and route (a)'s expected result once GS1 sends 4100 bytes.

`tools/transfer_pw.sh` runs both as cases `cable` and `route_a` (digests stored; both deterministic).

## 6. Read-only: does TLA's save hold build-dependent wasm values? (GS27 section 4)

Yes, by the same mechanism as GS1, in the same structure; none in today's TLA saves.

- **GS1 (located for GS27's finding):** the value 0x88d4c (this build) in 6 places of each saved copy is
  `gActorSnapshot.actors[i].script` (+0x00 of each 0x70-byte struct Actor from 0x02001124): actors running a
  relocated actor script (D19 `reloc_*` buffers live in the module's memory). Actor_Snapshot DMAs whole actors into
  the save area before saving.
- **TLA** saves 0x02000000-0x02002ff0 (three 4 KB sectors), which holds `gSnapshotObjects` (0x02001024, 32 x 0x80
  struct Actor, filled by field/object/table.c the same way). Its words that can be build-dependent:
  - `script` (+0x00): a pointer into a relocated buffer when the actor runs a relocated script; TLA relocates 25
    symbols, among them **gActor_StepAngleScript, gData_0802f204, gData_080f0ef8, gData_080f32e0 (Func_080d3070
    starts actors on it), gData_080f34e8/34f4/3500, gData_080f373c/3750/3764, Data_080f01b8**;
  - `update` (+0x6c, `void (*)(void)`): a wasm table index when an actor has a per-frame hook;
  - `animation` (+0x50) holds IWRAM addresses (0x0300xxxx: GBA addresses, fine) and `callback` (+0x60) small values
    (0x10000, not code: Port_CodeGbaOf says no) in the save checked.
- In `port_work/regress_tla/save.sav` (Venus Lighthouse aerie): all 20 saved actors run ROM script 0x0802ec48,
  `update` is 0: no build-dependent word. The units, flags and work hold none (their words in 0x10000-0x1ffffff are
  experience values and 16.16 numbers). Not fixed (as asked): a save made where an actor runs one of the relocated
  scripts or has an update hook would carry this build's value.

## 7. Plan corrections (3.1)

- The cable greeting's first letter is 'U' in English on both games ('S' is the Spanish edition's).
- Func_080ae410 takes the buffer in TLA's layout (work 0x240, units 0x520); the cable path makes it so (GS1's work
  lands at TLA's 0x260). Coins go to gMainRoutineWork+0x28c, not to TLA's coins; HP is not refilled for units 0-3.
- The whole state is saved before the entry and restored after; only Func_080ae410's fields survive (section 4).
- Gold carries no equipped bits; TLA reads Attack/Defense/Agility as 9 bits (GS1 packs 10).
- TLA's password grid is GS1's alphabet in GS1's order (16 x 4): TLA9 could type a password by index, no lookup.

## 8. For TLA9

1. **GS1 link.c BULK_MAX >= 4100** (a GS1 change: new GS1 game.wasm, needs the go-ahead), then
   `node tests/transfer_a.cjs` runs route (a) to the end; compare TLA's state with the `--virtual` run (the stand-in
   is design (c)'s virtual partner; arrival frames differ, so compare units 0-3, flags and +0x28c, not whole RAM).
2. The page: GS1's export (`Save_ChooseAndLoadFile`'s 4100 bytes), the stand-in on TLA's link transport, the
   Transfer Method hook (Cable), the option (default on), several cleared files (file 1 uncleared + file 2 cleared
   is the case `gs1_clear.keys` already makes).
3. Note for the page: Isaac and Ivan arrive down when they were down in GS1 (vendor behaviour).

## 9. Checks (this session)

Build: calls PASS (9 allowed), short K&R PASS, leak 0. D20 batch 219 EQUIV / 0 FAIL / 986 NOINPUT; diff_tla 30/30,
negative 4/4; diff_hw 124/0/64, negative 4/4; diff_mixer 300/300; diff_blitter 160 builds + 4,800 draws EQUIV;
test_arm 79/79. The link-layer build against the previous one (eade7bef, rebuilt from HEAD): the 64,200-frame
regress_tla route with words in 0x10000-0x1ffffff masked gives equal RAM and pictures at 15 frames; then
`expected_tla.tsv` rewritten (71 RAM rows; pictures and the save SHA-1 unchanged), regress_tla 13/13 OK; GS1
687968a7 / 895d45cc, regress --quick 9/9 OK. TLA build 4ee60983 / 17dd6895.
