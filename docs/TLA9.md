# TLA9: "only say Yes" (2026-11-04): the party comes from Golden Sun with one press

Plan: docs/TLA_PLAN.md 3.2 (c), phase TLA9, user decisions 6. Reference result: route (a) of TLA8/TLA9a (units SHA-1
14648e8f916d, flags SHA-1 6ffcc5c1ef6b). Branch `tla9` (worktree ~/golden-sun-wt/tla9), not merged, not deployed.

## 1. What the player sees

The Lost Age's page (`/tla/`), new game, Felix named, "Transfer data from Golden Sun?" -> **Yes** (A, or a tap on the
touch pad's A). If the site holds a Golden Sun ROM and a Golden Sun save with a cleared file, there is no Transfer
Method menu, no link window, no password: "Transferring data", then TLA's own party review (Isaac Lv 15 ... with the
test save). B leaves the review, as on the cartridge after a cable transfer (A only pages it). Then Isaac's name, and
the game goes on with the imported party.

In the page menu (☰): **Bring party from Golden Sun** (checkbox, default on: the user's choice), with a note:
"(ready: file 2, Isaac, Lv 15)", "(no Golden Sun save on this site)", "(no cleared Golden Sun file)" or "(could not
read the Golden Sun save)". Stored as `tla-gs1party=0` only when switched off (try/catch, default on when storage is
blocked). Off, or nothing to bring: the cartridge's menus (Password / Link cable) appear unchanged, and the password
route still works.

**Several cleared files:** the one with the longest play time (the summary's playTime; the earlier file on a tie) is
taken, without a chooser. Reason: the user asked for "nothing except saying yes"; a GS1 player who cleared the game
twice almost always wants the furthest party, and the note in the menu says which file was taken. (A chooser would be
a second question the cartridge does not ask.) A file the player wants instead can be brought with the games' own
password route after switching the option off.

## 2. How it works

Port-side code only; GS1's game is unchanged (6d08d4c8 / cab9b56b, a clean rebuild in the worktree gives the same).

1. **GS1's own code reads the save** (`port/web/transfer.js`, `gs1Read`/`gs1Export`). Before the TLA module is
   made (so only one 225 MiB module is alive at a time), the page loads GS1's `../game.js` (its factory is also named
   `GoldenSun`: the page keeps TLA's and restores the global), instantiates it headless (no canvas, no audio, nothing
   written back to IndexedDB) with GS1's ROM and save, and at its first frame calls, through the call entry every GS1
   build exports (`Port_CallCode4`, port/pc/call_via.c), GS1's `Save_InitializeWork`, `Save_LoadFileSummaries`, then
   `Save_ReadPart(file, gSaveBuffer)` and `Save_ReadPart(file + 3, gSaveBuffer + 4096)`, `Save_ReleaseWork`: the calls
   `Save_ChooseAndLoadFile` makes, minus its file menu. The 4,100 bytes at gSaveBuffer are what FileScreen_Run's cable
   send puts on the wire (`Serial_StartSend(gSaveBuffer, 4100)`): compared with the route (a) dump, **all 4,100 bytes
   equal**. The instance then stays suspended for good and is dropped. Takes 10-30 ms in local headless Chrome (script,
   instantiation and the read). Addresses from port/symbols/tbs-en.tsv (no ROM bytes).
2. **TLA answers Link cable by itself.** `Func_0804d7fc` (window/f04d7fc.c, vendor C) is TLA's Transfer Method menu
   (mode 0; mode 1 is the password level menu); the clear scene's Func_02000328 calls it after Yes through the veneer
   Func_020022b0 -> Func_080381f8 and takes 1 as Link cable, -1 as back. A port/tla/c_rules.tsv rule makes it call
   `Port_TlaAutoTransferMethod(mode)` first (port/tla/hw/pc_tla.c): armed by the page (`Port_TlaAutoTransferArm(1)`)
   it returns 1 at once, one-shot; not armed it returns -1 and the menu runs as on the cartridge
   (`Port_TlaTransferMenuShown` counts those, for the tests). Then TLA's own `Func_02000b24` (greeting, receive,
   import) and `Func_080ae410` do everything, as in route (a).
3. **The virtual Golden Sun partner** (`VirtualGs1`, transfer.js): when `Port_TlaAutoTransferHits` changes, the page's
   link transport for TLA (`m.linkTransport`, which otherwise passes through to whatever the page had) becomes a JS
   partner playing FileScreen_Run's side on link.c's wire format, as tests/transfer_a.cjs's stand-in: payload "0000"
   each frame, TLA's "UVTS" greeting awaited, 20 frames, one 4,100-byte bulk. TLA receives it (link stat), the partner
   sees rxDone and, 600 frames later, leaves and re-arms (another Yes in the same run works again; a failed receive
   is not re-armed, so the menu appears instead of a loop). Its frame queue keeps the newest 8 (unreliable channel).
4. **Offline**: TLA's service worker (scope /tla/) also precaches GS1's `../game.js` and `../game.wasm` (tools/site.sh
   with BOTH=1; the site hash covers them), and answers them, so the transfer works offline even if the GS1 page was
   never opened. The worker installs each resolved URL once (a TLA folder served at the root makes ../game.js
   game.js again; Cache.addAll refuses duplicates).
5. **GS1's page is untouched** in content: tools/site.sh copies transfer.js and injects the option row and its script
   tag into TLA's index.html only; main.js's three calls are guarded by `window.GSTransfer` (undefined on GS1's page).

## 3. Tests

| check | result |
|---|---|
| `node tests/web_transfer.cjs` (new; muted headless Chrome; GS1 ROM + test-only cleared save + TLA ROM in the origin's IndexedDB; keys: START, A on the name, **A on Yes**, B on the review) | **ALL PASS (29)** |
| - auto: menu not shown, bulk received, cleared file 2 read by GS1's code | units **14648e8f916d**, flags **6ffcc5c1ef6b** = route (a) |
| - off (`?gs1party=0`) | the Transfer Method menu runs (count 1), nothing received |
| - nosave (GS1 ROM, no save) | the menu runs; note "(no Golden Sun save on this site)" |
| - phone (390x844, touch, mobile UA; Yes by a tap on the touch pad's A) | same SHA-1s |
| - offline (worker installed online: TLA's cache holds /game.js, /game.wasm and /tla/*; then CDP offline + reload) | same SHA-1s; no game file from the network |
| `node tests/transfer_pick.cjs` (new; GS1's save routines stood in: which file is taken) | 8/8 PASS (none, one, two cleared either order, tie, empty, init/read failure) |
| node run of the page flow (scratch, the same transfer.js API) | export equal to route (a)'s 4,100 bytes; auto cable at f662; review left with B -> same SHA-1s |
| TLA build df7c39fb / d184cc2a (clean): call targets, short K&R, leak | PASS (9 allowed), PASS (5 allowed), PASS |
| regress_tla, DIGEST_BOTH=1, against the TLA9a build 2ee38c9f | masked RAM and pictures equal at every point of all 13 cases, save SHA-1 equal; expected_tla.tsv RAM rows rewritten; ALL OK after |
| tools/transfer_pw.sh --twice | gold 63/63, silver 67/67, bronze 43/43, cable 52/52, route_a 52/52; second runs identical; units/flags and picture rows unchanged; RAM rows rewritten |
| GS1 clean rebuild | 6d08d4c8 / cab9b56b (unchanged), site build id e48c5ad1fd47a302 |
| GS1 page: web_opts (vale_day1.sav), web_phone, web_offline, web_link | ALL PASS, ALL PASS, ALL PASS, PASS (clean) |
| TLA page (SITE_DIR=build/site/tla): web_offline, web_phone | ALL PASS, ALL PASS |

D20 not rerun: no translated routine changed (the rule is on vendor C; no asm2c hook added). GS1 regress not rerun:
GS1's game.wasm/game.js are byte-identical.

Save-derived files (not committed): port_work/tla8/ (the cleared save, dumps), port_work/web_transfer/ (screenshots,
the game's pictures, `sheet.png`), port_work/tla9/ (regress logs of both builds).

## 4. Notes

- The headless GS1 instance runs only when the option is on and the origin holds both a GS1 ROM and a GS1 save: a
  TLA player without GS1 pays nothing. With them, the TLA page also fetches GS1's 4.5 MB module (cached by the worker).
- The GS1 module's memory is left to the garbage collector (no handle kept); the TLA module is created after.
- Isaac and Ivan arrive down when they were down in the GS1 save (vendor behaviour, TLA8 8.3).
- Not done: a chooser for several cleared files (decided against, 1); an "import GS1 save" button (user decision 6:
  not for now); the GS1 module is not unloaded explicitly (no API for that in emscripten's factory).
