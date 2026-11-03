# Golden Sun: The Lost Age port: survey and plan (TLA0, 2026-11-03)

The user asked: "Now do the second GBA golden sun game. After it's done and working, make it so party get sent
between first and second game without doing anything except saying 'yes'".

This is a read-only survey. Nothing in our tree changed except this file. The vendor was pulled during the survey
(the user approved it): `vendor/alchemy` moved from `24b72a32` to **`f6c08e64` (2 Nov)**. All TLA numbers below are
for f6c08e64. The Lost Age ROM is at `~/roms/Golden_Sun_The_Lost_Age_USA_Europe.gba` (read-only, 16 MiB, SHA-1
`b500663220cb9bf56b9f8e8c0c544f1d6fa3a824`, equal to alchemy's `tla-en` in `rom.sha1`; header
`GOLDEN_SUN_B`, `AGFE`).

Scratch measuring scripts were kept in the session scratchpad (they are not in the repo). Every count below can be
reproduced from the files named.

---

## 1. TLA coverage in the vendor (f6c08e64)

### 1.1 How alchemy builds tla-en

- `INSTALL.md` "The Lost Age (optional)": put the dump at `roms/tla-en.gba`, then run `make tla-en` and
  `make compare-tla-en`. The Makefile (`$(BUILD)/baserom.gba`, line ~280) checks the dump against `rom.sha1` and
  links it in as `out/tla-en/baserom.gba`.
- It uses the same compilers as tbs: alchemy-gcc for the game's Thumb C, with TLA's extra flags (`CFLAGS_tla`:
  `-mtune=arm9tdmi -mthumb-split-constants -mthumb-call-via-lr -mthumb-slow-loads`, and no `-mthumb-interwork`).
  Sound and flash C are built with old_agbcc, and ARM C with GCC 2.95.2. Our `golden-sun-tools` image and the
  `golden-sun-ref` volume already hold all of them (D13, D16).
- The object list is `games/tla/objects.tsv`, with 6,518 rows for all six editions. `games/tla/main.ld` lays out
  the places (`rom_main_00..15` at fixed addresses, `rom_tail_00..02`, IWRAM resident, IWRAM mixer).
- Overlays are linked from `recon/tla/raw/overlays/resource_<id>.ld`, 114 scripts. Each mixes compiled C objects
  with `.text.x<addr>` pieces of the asm listing `resource_<id>_overlay.s`.
- **For tla-en almost nothing is copied from the cart.** `recon/tla/unidentified.s` holds 18 `.incbin
  "baserom.gba"` pieces of 1 to 64 bytes. The parts that are not rewritten yet are mostly **disassembled
  listings** (`recon/tla/raw/*.s`), not binary. The other editions still take more from their dumps
  (`recon/tla/<lang>/rom.s`). So tla-en needs the dump only to check the build, plus those ~100 bytes.

### 1.2 What is C and what is still asm (tla-en)

| | Count | Bytes (instructions + literal pools) |
|---|---|---|
| Game C files in `games/tla/src` | 3,675 `.c` (≈6,970 function definitions, rough regex, Japanese variants included) | not measured (needs the map, TLA1) |
| Main-image C objects (en rows of objects.tsv) | 1,205 | |
| Overlay C objects (overlay .ld scripts) | 2,650 | |
| **Main asm listings** `recon/tla/raw/*.s` | 578 files, **526 functions** | **627 KB** (583 KB instructions + 44 KB pools) |
| **Overlay asm** `resource_*_overlay.s`, EN branch of `.ifdef TLA_EDITION_*` | 95 of 114 overlays, **678 functions** | **347 KB** (307 KB + 40 KB) |
| Handwritten `.s` in `games/tla/src` (asm counterparts of GS1's ~75 routines) | 346 files | 50 KB; 903 of their functions are far-call/overlay veneers |
| Byte data from the cart (en) | 18 pieces | ~100 bytes |

That makes **about 1,204 functions and about 974 KB of game code still asm**. That is about 15 % of the functions.
By bytes it is much more, because the asm is concentrated in very large routines: the battle effects.

**Exact census (TLA1, from the tla-en map; `port/symbols/tla-en-census.tsv`, docs/TLA1.md 4).** It replaces the
estimate that stood here (35 to 50 %). Bytes of linked sections; asm = the vendor's disassembled listings, pools
included; hand = handwritten `.s` in games/tla/src (veneers, mixer, kernels):

| | C | asm (listings) | hand .s | data |
|---|---|---|---|---|
| main image | 253,752 B (2,358 fn) | **628,240 B (525 fn)** | 34,346 B | 13,927,737 B + 745,180 overlay stream |
| overlays (114) | 659,332 B (4,497 fn) | **330,912 B (678 fn)** | 55,992 B | 331,070 B |
| **all code: 1,962,634 B** | **913,084 B, 46.5 %** | **959,152 B, 48.9 %** | 90,338 B, 4.6 % | |

So **49 % of TLA's code bytes are still asm** (69 % of the main image's), at the top of the old estimate. The battle
effects in `rom_main_09` are 347,520 B of it. The census comes from a near-match build (GS1's alchemy-gcc plus the
three options alchemy moved into its newer compiler: main layout identical to the cart, 2 functions differ in place;
50 of 114 overlays identical), so it is exact for the main image and within a few bytes for the overlays until the
matching build (needs alchemy-gcc 641764a5, docs/TLA1.md 2).

The pull already moved a lot: 127 files changed in `recon/tla/raw` (−37,252 lines). Before the pull (24b72a32)
there were 534 + 794 asm functions, about 1,050 KB. **Alchemy is converting TLA quickly**, and every re-pin
shrinks our job.

**Which subsystems are still asm** (main image: each listing grouped under the source folder of the C object
before it in `objects.tsv`):

| Subsystem | Asm bytes | Functions | Notes |
|---|---|---|---|
| battle_effect | 347,520 | 172 | Psynergy, summon and attack animations. Place `rom_main_09` (0x08138000–0x081a0000, 416 KB) is 84 % asm |
| field | 136,010 | 172 | event commands (47 KB), script, map, objects, field sequences, Lucky Dice / Lucky Wheels minigames |
| window | 51,120 | 52 | text output, layout, party panel |
| menu | 40,224 | 52 | item menu, title intro, credits |
| battle | 37,536 | 37 | party, presentation, a few AI helpers |
| shop / game / system / sound / gamepak | 14,916 | 41 | small |

Overlays: the asm is in **scene code**: Mars/Jupiter Lighthouse, Gaia/Magma/Air's Rock, the World Map, Trial Road
and others, plus **overlay 64A, `scene/clear`: the new-game / transfer screen** (7 asm functions, 7.7 KB). See
section 3.

**Vendor drafts.** Alchemy keeps non-matching C drafts in `recon/tla/en/main/<addr>.c` (509 files, 508 of them
for a remaining main listing) and `recon/tla/en/overlays/resource_<id>_c_<addr>.c` (663 files, 646 of them for an
overlay asm piece). Their headers give "differ N of M" instructions against the original. That difference is
about matching, not behaviour: 617 drafts differ by less than 20 %, 211 by 20 to 50 %, 338 by more. They are
readable starting points. Whether one is *equivalent* is exactly what our D20 diff decides.

### 1.3 Can our GS1 pipeline take a half-asm game?

| Piece | GS1 today | TLA |
|---|---|---|
| `tools/web_build.sh` + `tools/wasm/build.py` (TBS hard-coded at line 25, `build/wasm/tbs`) | | Needs a `--game` switch and per-game tables. The stages (port_src transforms, bind, relocs, link, leak check, code-range audit) are generic |
| Data from the ROM (D4/D19) | address map from a matching build | Same, from a matching tla-en build (TLA1) |
| Overrides (`overrides.tsv` 41, `fn_overrides.tsv` 16, `c_rules.tsv` 9, `asm_rules.tsv` 8 rows) | ~75 asm routines, hand-ported | Hand-porting **1,204** routines (974 KB) under D20 is roughly 15 times GS1's whole asm job. Not realistic by hand |
| `tests/arm` (arm7.js 502 lines, diff.cjs) | proves each port EQUIV | Works unchanged for TLA: it runs the original bytes from the TLA ROM. It is the **proof** tool whatever the port strategy |
| Code-range audit | 53 rows | Must be re-run on TLA's C (new hits expected) |

**Recommendation for the asm (decide in TLA3): translate it mechanically, prove it with D20.** The listings are
complete, labelled disassembly (`recon/tla/raw/*.s` with `.thumb_func`, labels, pools, edition `.ifdef`s), so a
build-time translator (`tools/wasm/asm2c.py`, D18 style: it reads the vendor and writes into the gitignored build
tree, and nothing vendor-derived is committed) can turn each Thumb/ARM routine into C:

- **Registers and memory.** Each routine works on a register file. Memory is the identity map (D5), so loads and
  stores are plain pointer accesses, and the GBA stack lives in IWRAM as on hardware.
- **Calls.** `bl` to a C function becomes a call with r0–r3 as arguments and r0 as the result. Calls into
  translated code go through a generated wrapper per signature. Code pointers go through `Port_ResolveCode` and
  the codemap, as today.
- **Correctness.** It is correct by construction, and the D20 diff proves every routine EQUIV against the ROM in
  batch.

GS1's D6 rejected an interpreter or recompiler for ~75 routines. At 1,204 routines the trade is different. Where
a vendor draft passes the D20 diff we may compile the draft from the vendor checkout instead, because it is more
readable. Hand ports stay for the hardware-bound routines, which mostly map onto the GS1 ports we already have.

**Estimate under pure D20 hand-porting:** ~1,204 routines, ~974 KB, of which 172 routines and 348 KB are battle
effects. With the translator, the hand work falls to the ~50 KB of hardware-bound `.s` in `games/tla/src`. Most of
it already has a GS1 twin: iwram_* math/decompress/copy, resident_mixer*, color kernels, BIOS, relocated kernels.

---

## 2. Shared engine

TLA is the same engine family:

- **Save:** both carts are `FLASH_V123`, 64 KB flash (found in the ROMs). TLA builds the same `flash.c sst.c
  atmel.c program_flash_sector.c` (Makefile `FLASH_C`).
- **Sound:** the same MusicPlayer2000 (m4a) driver in C plus the Camelot resident mixer copied to IWRAM
  (`games/tla/src/sound/README.md`, `resident_mixer*.s`). In TLA the mixer is still handwritten asm, as it was in
  GS1.
- **Serial:** the same serial API (`games/tla/include/system/serial.h`: `Serial_PollStatus`,
  `Serial_StepBlockTransfer`, `Serial_StartSend`, `Serial_StartReceive`, and `Serial_ExchangePayloads` in
  `system/serial/sio_xchg.c`). It uses the same 24-byte payload: TLA's receive reads `gLinkPeerSignatures[peer]` as
  12 halfwords. So **link.c (D21) can be reused as it is**, retargeted by symbol.

PC layer (`port/pc`, 27 files, 4,557 lines):

- **Game-agnostic, shareable as they are:** ppu.c, apu.c, hw.c (DMA/timers/IRQ), bios.c, decompress.c, flash.c,
  link.c + link_transport.h, memory.c, main.c, relocate.c, call_via.c, codemap.c, blocks.c, plus the web side
  (port_lib.js, audio.js, touch.js/css, net.js, link_loopback.js, sw.js).
- **Ports of GS1-specific asm, bound by GS1 names:** m4a.c, mixer.c, sound_asm.c, iwram.c, oam_kernel.c,
  blitter.c, battle_asm.c, field_asm.c, text_asm.c, window_asm.c, asm_small.c. Their algorithms very probably
  carry over (same mixer, same kernels), but each TLA twin must be bound to TLA's symbols and re-proven with D20.

**Recommendation: one repo (`~/golden-sun`) with a per-game build.**

- `build/tbs` stays exactly as it is.
- `build/tla` is new. `tools/wasm/build.py --game tla`.
- Per-game tables go under `port/tla/` (overrides, fn_overrides, c_rules, asm_rules, symbols, code-range audit),
  and GS1's stay where they are, so no GS1 path churn.
- `port/pc` is shared, with `#if PORT_GAME_TLA` only where a binding differs.
- A shim directory per game is used where headers differ (`games/tla/include` is its own tree).

One site and one repo are also what make the transfer possible: a shared origin, shared IndexedDB, and one
service worker.

---

## 3. The GS1 → TLA transfer

### 3.1 How the games do it (vendor evidence)

**GS1 send side**: `games/tbs/src/scene/file_screen.c`, `FileScreen_Run`.

- **Clear data.** After the credits the File Screen opens at entrance `FILE_SCREEN_FROM_TITLE` and asks to save.
  Saving sets `gMainRoutineWork.sendFlag = 1`, which becomes `SaveFileSummary.sendFlag` (save.c:210). **Only files
  with sendFlag (cleared files) can be sent**: `Save_ChooseAndLoadFile(5)` lists only those.
- **The Send option is hidden.** `Save_ScanFileSummaries` offers Send only when a file is cleared **and R + Left
  are held** (save.c, the comment above `Save_ScanFileSummaries`).
- **Cable.** `Save_ChooseAndLoadFile` reads the file's two 4096-byte parts (`Save_ReadPart(file)` and
  `Save_ReadPart(file + 3)`) into `gSaveBuffer` (0x02000000). The game then runs `Serial_Initialize`, sets its own
  payload to "0000" and waits until the partner's payload greeting is `'S','V','T','S'` (the first letter is
  `FILE_SCREEN_LINK_LANGUAGE_TAG`: 'S' in English, 'E' German, 'F' French). It then calls
  **`Serial_StartSend(gSaveBuffer, 4100)`**, which sends **the cleared save file as stored**. The send times out
  after 600,000 frames, and 10 frames without the partner is an error.
- **Password.** `FileScreen_PackPasswordData` → `FileScreen_CalculatePasswordCrc16` → `FileScreen_EncodePassword`
  (all C):

  | Level | Bytes | Symbols | Carries |
  |---|---|---|---|
  | Gold | 173 | 260 | levels; Djinn held; six story flags; base stats; all 60 inventory slots; the counts of 23 stackable items; coins |
  | Silver | 39 | 61 | levels, Djinn, flags, base stats, the 8 Psynergy items (Orb of Force … Catch Beads) |
  | Bronze | 9 | 16 | levels, Djinn, flags, the Psynergy items |

  The six story flags are FLAG_DODONPA_LOCKED_UP, WON_COLOSSO, HSU_RESCUED_WITHOUT_PARTY,
  CROSSBONE_ISLE_DEADBEARD_DEFEATED, VISITED_SICK_DORA and VAULT_WARNED_OF_ESCAPED_THIEVES
  (`gFileScreen_PasswordFlags`). The members are Isaac, Garet, Ivan and Mia (`gFileScreen_PasswordMembers`).

**TLA receive side**: overlay 64A, `games/tla/src/scene/clear/` plus the asm in
`recon/tla/raw/overlays/resource_64a_overlay.s`. The draft headers in
`recon/tla/en/overlays/resource_64a_c_*.c` describe it.

- **`Func_02000328`** (asm) is the new-game flow. It shows `MsgTransferDataFromGoldenSun` ("Transfer data from
  Golden Sun?") with a yes/no. On yes it calls `Func_020022b0(0)`, the **Transfer Method** menu: 1 is cable, 0 is
  password. Then it asks "Play on EASY level?", which is TLA's own question.
- **`Func_02000b24`** (asm) is the cable receive. It runs `Serial_Initialize` and waits for the partner's payload
  "0000". It answers "SVTS", then calls `Serial_StartReceive(Data_02012f94 + 0x6c)`, with the same 600,000-frame
  and 10-frame rules. It then copies the received flags (0x214 bytes) and units (0xd20 bytes) in and runs
  `Unit_Calculate(0..3)`.
- **`Func_02000e44`** (asm) is password entry: a 17×4 grid and pages of 50 symbols, then a CRC check (`s217c.c`,
  C). **`Func_020018e0`** (asm) unpacks password data "in the layout The Broken Seal's
  FileScreen_PackPasswordData packs". **`Func_02001c7c`** and **`Func_02002068`** (asm) pack and encode
  passwords.
- **`Func_080ae410`** (main asm, called through the far-call veneer `Func_080ad238` in `table_23.s`, imported by
  `scene/clear/import.s`) **takes over a Broken Seal save** laid out as that game's: flag bits at 0x40,
  gMainRoutineWork at 0x240, units at 0x520.
  - Its Djinn flags and six flags (`Data_080b1284`) set TLA flags 0x800/0x820.
  - Coins go to gMainRoutineWork+0x28c.
  - Each unit is copied in, keeping its own first 15 bytes (the name). Items flagged 0x20 (story items) are
    removed and the units recomputed.
  - Djinn are set, and flags 44/47 set.
  - The draft's header says so, in `recon/tla/en/main/080ae410.c`.

**What moves.** The cable route carries the whole GS1 file: levels, stats, Djinn, every item, coins, and the story
flags TLA reads. Passwords carry the subset in the table above. Both routes need a **cleared** GS1 file: the GS1
game refuses to send anything else, and a password exists only for a cleared file. **All of the TLA receive side
is still asm**, which is one more reason the asm strategy (1.3) comes first. The GS1 side is all C and already
runs in our port.

### 3.2 Design for "only say yes"

**One site, one origin.** GS1 stays at `/` and TLA goes at `/tla/` on `golden-sun-web-port.netlify.app`, with a
small chooser on the landing page. The GS1 page already keeps its ROM and save in IndexedDB database
`golden-sun`, store `files`, key `flash` (port/web/main.js:22, 88, 104). A TLA page on the same origin can read
that key. Separate sites could not share it.

- TLA gets its own keys (`tla-rom`, `tla-flash`) in the same database.
- One service worker covers both games, so the transfer works offline and the GS1 module is cached even when the
  player only opens TLA.

Options weighed:

- **(a) A hidden GS1 instance running its real send code, over link.c loopback into TLA's receive.** This is the
  most faithful. But it needs two 225 MiB modules alive at once (~450 MiB: a phone/iOS risk). It also needs GS1's
  hidden menu to be driven: R + Left, Send, file, Cable, and the send code is inline in `FileScreen_Run`, so it
  cannot be called alone. That is fragile, and costly in production.
- **(b) GS1's own password code, then typing the password into TLA's entry automatically.**
  - It uses both games' code, but Gold carries less than the cable: only 23 stack counts, six flags, no other
    events.
  - The 260 symbols would have to be fed through TLA's asm entry grid, by simulated keys or by poking its
    buffer.
  - Two fake steps, for less data.
- **(c) Recommended: "export with GS1's code, receive with TLA's code".**
  1. **GS1's code makes the bytes.** When the TLA page loads, before the TLA module starts (so only one module is
     alive), the page instantiates the GS1 module headless with the GS1 save from IndexedDB. It calls GS1's own
     `Save_InitializeWork` / `Save_LoadFileSummaries` / `Save_ReadPart` ×2 through one exported port entry. Those
     are the same calls `Save_ChooseAndLoadFile` makes, minus the menu. The page lists the cleared files (sendFlag)
     and keeps the 4,100 bytes of `gSaveBuffer`, which is exactly what GS1's cable send transmits. Then it drops
     the module.
     - If GS1 has no cleared file, nothing changes: TLA shows its normal menus.
  2. **TLA's code takes them.** When TLA asks "Transfer data from Golden Sun?" and the player answers **Yes**, a
     port hook answers the Transfer Method menu (`Func_020022b0`) with Cable. TLA's link.c is connected to a
     **virtual GS1 partner**: a ~30-line transport that plays GS1's side of the exchange. It sends payload "0000",
     sees "SVTS", then delivers the 4,100 bytes on the bulk channel, which D21 already delivers whole.
     - TLA's own `Func_02000b24` and `Func_080ae410` then do everything: windows, "Transferring data", flags,
       units, Djinn, coins.
     - The only re-implemented piece is GS1's three-line greeting. No save format is parsed by us.
  3. **Several cleared files.** Choose the newest by play time from GS1's summaries, or show a small page chooser
     (question for the user).
  4. **Optional feature** (rule 7). Toggle "Transfer from Golden Sun automatically", **default on** because the
     user asked for it. Off restores the games' own menus (cable/password), which still work: the password route
     needs nothing from us.
  5. **The proof that (c) equals (a).** A node test (link2.cjs style, two instances) runs route (a) for real once:
     GS1 driven through its hidden Send menu with keys, TLA through the Cable receive. It asserts that TLA received
     the same 4,100 bytes as the export and that TLA's RAM after the transfer equals the (c) run's.

Why (c): it is the games' own code at both ends, with one small module at a time. It carries the most data (the
cable route), and the player's only action is the game's own "Yes".

### 3.3 Testing without beating GS1 (needs the user's approval)

Our real-play saves stop at Mercury Lighthouse: `ml_saturos_win`, Lv 15, with all four of Isaac, Garet, Ivan and
Mia (GS26). Real play to Doom Dragon is perhaps 15 to 25 more sessions. **Proposed test-only shortcut, for the
user to approve:**

- From the `ml_saturos_win` save, a probe sets the destination to the File Screen at entrance
  `FILE_SCREEN_FROM_TITLE` (`Event_SetDestination`). That is the screen the game shows after the credits.
- It answers Yes. GS1's own `Save_ToChosenFile` then writes the file with `sendFlag = 1`. No byte patching is
  done: it is the game's own clear save, reached by skipping the ending. (Trap 32's patched Arena save is the
  precedent for test-only saves.)
- The save lives in `port_work/` only. It is used for the transfer tests: route (a), route (c), and the Gold,
  Silver and Bronze passwords typed by keys into TLA.
- The party will be mid-game (no endgame flags). TLA handles any cleared file, so that tests the mechanism, not
  the endgame values.
- If the user prefers real play, the GS real-play phases continue to the ending first, and the transfer tests wait.

---

## 4. Risks and user-facing points

- **ROM:** The Lost Age (USA, Europe), 16,777,216 bytes, SHA-1 `b500663220cb9bf56b9f8e8c0c544f1d6fa3a824`,
  header `GOLDEN_SUN_B` / `AGFE`.
  - The page refuses other files, as GS1 does.
  - The English cart is one release for both regions, as with GS1. The other European TLA editions have their
    own SHA-1s in `rom.sha1` and are out of scope.
  - **Editions must match for the transfer:** GS1's greeting letter is per language.
- **Standing rules carry over:**
  - No ROM bytes, captures or vendor code committed. TLA's asm listings and drafts are read from the vendor at
    build time only; the leak check runs on the TLA wasm too, with a TLA string list.
  - Touch controls on the TLA page from its first playable build.
  - Offline play for both games.
  - Every extra is optional.
  - Online link play: TLA has its own Battle Arena / lobby (`scene/lobby/import.s` imports the serial routines), a
    later phase.
- **The deployed site changes:**
  - a landing chooser;
  - `/tla/` with its own ROM picker;
  - a service worker that precaches both builds (two ~wasm payloads);
  - a new option for the auto-transfer.
  - GS1's URL, saves and keys stay the same. A GS1 player's save is not touched; the transfer only reads it.
- **Vendor churn:** alchemy converts TLA daily (−37k asm lines in this pull). Our TLA tables should key on
  **addresses**, not on `Func_XXXXXXXX` names, which re-pins rename. Re-pin deliberately (trap 5), with a script
  that re-measures and re-runs every D20 diff.
- **GS1 build safety:** the pull changed one tbs file, `games/tbs/src/battle_effect/battle_effect/thor.c`. The
  change is comment-only by inspection (`git diff 24b72a32 f6c08e64 -- games/tbs`). TLA1 must still prove the GS1
  build is identical (below).
- **Memory:** the TLA ROM is 16 MiB. The identity map's ROM window (0x08000000–0x09000000) fits under the existing
  0x0E100000 linear memory. Two modules at once are avoided by design (3.2 c).
- **Hardest part:** the battle effects (348 KB asm) and the scene asm, so the translator (TLA3) is the critical
  path. If it fails, the fallback is waiting for alchemy (TLA's conversion pace is high) while hand-porting with
  drafts and D20.

---

## 5. Phases (one agent each, GS style; each ends with HANDOFF + sessions.tsv row)

- **TLA1: Pins, reference build, map.**
  - **Check that the GS1 build is unchanged at vendor f6c08e64.** Rebuild GS1 with `tools/web_build.sh` and
    compare `game.wasm` and `game.js` byte for byte with a build at 24b72a32 (a temporary vendor worktree, no
    stash). Run `tools/regress.sh` (full), which must give every digest unchanged.
    - If anything differs, pin the GS1 build to 24b72a32 (a separate checkout `vendor/alchemy-tbs`, used by
      build.py for tbs).
    - Record the pin in the orchestrator.
  - Build tla-en in Docker (`make tla-en`, `compare-tla-en: OK`, the ROM as a gitignored symlink).
  - Write `port/symbols/tla-en.tsv` and overlays (no bytes), and `tools/check_rom.sh` for TLA.
  - Run the exact census: code bytes C / asm / data, replacing 1.2's estimate.
  - **Verify:** the GS1 wasm is identical or pinned, regress all OK, compare-tla-en OK, census committed.
- **TLA2: Multi-game build, compile TLA C.**
  - Add `build.py --game`, `port/tla/` tables, the TLA shim, and port_src rules for TLA's C.
  - Compile all TLA C objects to wasm, link with logged stubs for every asm symbol, and run the TLA code-range
    audit and leak check.
  - **Verify:** the GS1 build is still byte-identical; TLA links with 0 linker warnings; stub count reported; leak
    check 0.
- **TLA3: The asm translator (decision + proof).**
  - Write `tools/wasm/asm2c.py`: listings to C at build time, with the ABI bridge and the codemap entries.
  - Prove it with D20 on 30 varied routines: leaf, calls, pools, ARM, IWRAM-copied, overlay. Also try compiling
    the matching vendor drafts.
  - Record the decision as a new D-number.
  - **Verify:** 30/30 EQUIV and selftest negative controls pass; the doc compares translator and draft yield.
- **TLA4: Hardware-bound asm and boot.**
  - Bind or port the `games/tla/src` handwritten `.s` (mixer, IWRAM math/decompress, kernels, IRQ, BIOS), reusing
    GS1 twins, each D20-proven.
  - Boot: logos → title → File / new-game screen.
  - **Verify:** headless Chrome and node reach TLA's title and the "Transfer data from Golden Sun?" question;
    captures go to port_work only.
- **TLA5a / TLA5b: Translate all main / overlay asm.**
  - Generate the rest of the main asm (526 functions; 5a) and the overlay asm (678; 5b).
  - Batch D20 report; fix the translator until everything is EQUIV.
  - **Verify:** a D20 batch report with every remaining asm routine EQUIV (or a listed hand port), and stubs = 0.
- **TLA6: Playable.**
  - New game to the first battle by real play: Psynergy and summon effects, audio, save → reload. Then
    `tools/regress.sh --game tla` cases.
  - **Verify:** a recorded route replays with identical digests, and audio_check passes.
- **TLA7: Site.**
  - `/tla/` page (ROM picker with TLA SHA-1, its own IndexedDB keys), landing chooser, touch, one SW for both
    games, offline.
  - Deploy with `tools/deploy_web.sh` (extended with the TLA allowlist).
  - **Verify:** web_touch / web_phone / web_offline for both pages pass, the GS1 page is unchanged, and the live
    checks pass.
- **TLA8: The games' own transfer, by hand.**
  - With the test-only cleared GS1 save (3.3, if approved), run route (a) in node: two instances, GS1's hidden
    Send menu by keys, TLA's Cable receive.
  - Type a Gold, Silver and Bronze password by keys.
  - **Verify:** TLA's party after each route matches the vendor's rules (levels, Djinn, items, coins, flags), and
    route (a) is deterministic across runs.
- **TLA9: "Only say yes".**
  - Port entry for the GS1 export, the virtual GS1 partner transport, the Transfer Method hook, the option
    (default on), and handling of several cleared files.
  - **Verify:** `tests/web_transfer.cjs`: with a GS1 save in the origin's IndexedDB, the player presses only A on
    "Yes" and TLA's RAM after the transfer equals route (a)'s from TLA8. With no cleared file, or the option off,
    the normal menus appear. Also passes offline and in phone emulation.
- **TLA10 (later): TLA link battle online.** Reuse link.c/net.js with TLA's lobby, as GS6–GS8.
- **TLA11+: Real-play routes** through TLA, as GS9–GS26.

TLA1–TLA4 can start now. TLA9 waits for TLA8 and for the user's answer on 3.3.

---

## 6. User decisions 2026-11-03

The user answered the questions below (via the coordinator):

1. **Test save:** approved. A test-only cleared GS1 save is made by taking `ml_saturos_win` to GS1's own end-of-game
   save screen, so the game writes the clear flag itself. Test use only, never shipped.
2. **Assembly:** translate the remaining asm mechanically (asm2c), every routine D20-proven. Do not wait for alchemy.
3. **Site:** the same site, under `/tla/` (https://golden-sun-web-port.netlify.app/tla/), with links between the games.
4. **Deploy:** only once TLA is playable: new game plus the opening, with sound, touch and offline.

Defaults the coordinator chose for the rest:

- Several cleared GS1 files: take the newest automatically, with a chooser only if there are several.
- Auto-transfer on by default, behind an option.
- No "import GS1 save" button for now.
- TLA may re-pin alchemy while GS1 stays pinned (each re-pin repeats the TLA1 GS1 identity check, D22).

### The questions as asked (TLA0)

1. **Test save:** may we make a test-only *cleared* GS1 save by sending our mid-game real-play save to GS1's own
   end-of-game save screen (the game writes the clear flag itself, no byte patching)? The alternative is real play
   to the end of GS1 first.
2. **Several cleared GS1 files:** take the newest automatically, or show a one-tap chooser?
3. **Auto-transfer default:** on (as you asked), with an option to turn it off and use the games' own Cable /
   Password menus?
4. **GS1 saves made outside our site** (an emulator `.sav`): add an optional "import GS1 save" button so they can
   be transferred too?
5. **Asm strategy:** OK to translate TLA's ~1,200 remaining asm routines mechanically (each proven equal to the
   cartridge by our test interpreter) instead of waiting for alchemy to finish converting them?
6. **Site layout:** both games on the current site (`/` and `/tla/`, with a chooser), which is needed to share
   saves for the transfer?
7. **Deploy cadence:** deploy TLA to the live site as soon as it boots to the title, or only once it is playable
   (TLA6)?
8. **Vendor re-pins:** may TLA re-pin alchemy when its conversion removes large amounts of asm (each re-pin
   checked by the script in TLA1), while GS1 stays pinned?
