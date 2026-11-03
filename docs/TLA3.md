# TLA3: the asm translator (2026-11-03)

Phase TLA3 of `docs/TLA_PLAN.md`: turn The Lost Age's remaining listing asm (1,203 routines, 959 KB, TLA1 census) into
C mechanically, and prove it with D20. The user chose this route (TLA_PLAN 6.2). Decision recorded as **D23** in
`orchestrator.md`.

## 1. What was built

- **`tools/wasm/asm2c.py`** (build-time, D18 style). It reads `vendor/alchemy/recon/tla/raw/*.s` and
  `raw/overlays/resource_<id>_overlay.s` (English branch of the edition `.ifdef`s; only `TLA_EDITION_EN` is defined)
  and writes one C file plus a report into the build tree. Nothing it writes is committed.
  - **Model.** Each routine is `void a2c_<addr>(void)` (overlays `a2c_ov<id>_<addr>`). It works on a global register
    file `a2c_r` (r0-r15, NZCV): it loads the file into C locals on entry and stores it back on return or around a
    call. So every calling convention survives: AAPCS r0-r3 and stack arguments, r0:r1 results, and non-AAPCS helpers.
    Memory is the identity map (D5). The GBA stack is real memory at `sp`, as on hardware. clang keeps the locals in
    wasm locals and drops dead flag computations, so NZCV costs only where a branch reads it.
  - **Thumb.** It parses the listing's unified syntax. It also decodes the halfwords the disassembler left as
    `.2byte`/`.4byte` when control flow reaches them. Two examples: `mov lr, rX; .2byte 0xf800` is the call-via-lr
    indirect call, and `.2byte 0xf8xx` alone is `bl lr+off`.
  - **ARM.** It decodes `.inst` words, and words reached after `bx pc`. Covered: conditions; the barrel shifter with
    its carry; data processing; MUL/MLA/UMULL/SMULL/UMLAL/SMLAL; LDR/STR with every addressing mode; LDRH/STRH/LDRSB/
    LDRSH; LDM/STM in all four modes; B, BL and BX.
  - **Literal pools.** `ldr rX, .L_pool` reads the pool word. A symbol becomes `A2C_SYM(name, offset, address)`, so
    the build can bind wasm-resident data (D19) instead. `.reloc 1b, R_ARM_ABS32_NOI, sym` and numeric labels are
    handled.
  - **Calls.** `bl` to a translated routine is a direct C call. Anything else goes through `a2c_call(addr)`, the
    runtime's bridge (Port_ResolveCode in the build; in the D20 test, the interpreter). Indirect calls and jumps go
    through the generated `a2c_dispatch(addr)`. It is a switch over every translated routine and checks the loaded
    overlay (`a2c_overlay_current()`) for overlay addresses; anything else falls back to `a2c_call`.
  - **Returns and continuations.** A jump through a register (`pop {pc}`, `bx rN`, `ldm {..pc}`, `ldr pc`) returns
    when its target is the entry lr, so a routine may have any number of returns. A local call's return address goes
    back into the routine through a per-routine switch (`A2C_LOCALRET`). Any other target is a tail call; the callee
    then returns to the lr of the jump (`A2C_CONT`). The same mechanism covers:
    - gcc's far jumps (`bl .L_x` inside a routine);
    - ARM local calls into veneer stubs (`ldr pc, [pc, #-4]`);
    - the `add lr, pc, #1; bx r12` interworking trampoline;
    - `bx pc` veneers;
    - a routine that falls through into the next one (a tail call).
  - **Jump tables.** `mov pc, rX` becomes a switch over the run of label words right after the jump, or over every
    table label of the routine when the table is elsewhere.
  - **Codemap.** `a2c_codemap[]` lists {GBA address with the Thumb bit, overlay, function} for Port_ResolveCode, so
    code pointers stored in game data keep working.
  - **Symbols.** It uses `port/symbols/tla-en.tsv` and `tla-en-overlays.tsv`. bss and linker-script symbols
    (`gInput`, `IwramResident_Rom`, `gIrqVector`...) and the Thumb bit of function values are not in those tables. For
    now it takes them from the reference build in `port_work/tla1` (`syms.txt` and `overlays/*.elf`). See section 6.
- **`tests/arm/tla/`** (test-only, D20):
  - `build_test.sh` builds `build/a2c/a2c_test.js`: every translated routine with a wrapper `a2cw_<addr>`, emsdk in
    Docker, 52 s. `ONLY=`, `OUT=` and `TRACE=1` give fast debug builds with a per-instruction hook.
  - `diff_tla.cjs` is the D20 diff for TLA. Each routine's original bytes run from the TLA ROM in `arm7.js`. Calls out
    of a translation run in the interpreter on the same memory. It compares r0 and all GBA RAM. Modes:
    - default: the 30 proof routines;
    - `--all`: the batch;
    - `--negative`: the negative controls;
    - `TRACE=1`: replays a failure in both and prints the first instruction whose registers differ;
    - `DRAFTS=1`: tests vendor drafts instead.
  - `drafts.py` compiles the vendor's C drafts into the same kind of module (section 4).
  - The harness change in `tests/arm/harness.js` is small: `new Harness(m, { game: 'tla' })` takes TLA's symbols and
    copies TLA's resident IWRAM block (IwramResident_Rom to IwramIrqMain, 0x400 words).

## 2. Translation yield (all listings)

asm2c names 1,207 distinct global labels in the listings: the census's 1,203 routines plus data labels such as
`Data_0802146c`. Aliases (two labels at one address) translate once.

**1,202 / 1,207 translate (99.6 %).** The 5 left, all reported in `build/a2c/report.tsv`:

| routine | why |
|---|---|
| Func_080cf78c, Func_08173aac | control flow reaches halfwords that are no v4T instructions (data after a jump the analysis does not bound) |
| Func_02002f64 (ov 681) | an undefined Thumb encoding is reached (same cause) |
| Func_081c0168, Func_081c05c8 | leftover sound-driver code: raw words after `bx`, with a pool word that resolves to nothing |

Each fix along the way was found by the D20 trace:
- the fallthrough after a conditional branch;
- pool values of Thumb functions (the Thumb bit);
- `.reloc` and numeric labels;
- jump tables;
- local versus global `bl`;
- `bl` targets of the form `Sym - k`;
- `blh` offsets;
- fallthrough into the next routine.

## 3. The proof: 30/30 EQUIV

`node tests/arm/tla/diff_tla.cjs`, CASES=100 (`build/a2c/proof.log`): **30 EQUIV, 0 FAIL**. Negative controls:
`--negative` gives **4/4 detected** (each original against another routine's translation must fail). GS1's
`tools/test_arm.sh` is unchanged: **79/79 EQUIV, all negative controls detected**.

The inputs are a random world before each case:
- EWRAM and IWRAM after the resident code, filled with words that are mostly small numbers and pointers into RAM;
- I/O cleared;
- `Heap_Initialize` run from the ROM;
- for overlays, the overlay's image at 0x02008000;
- four argument words and four stack words.

Inputs the original cannot run (an access outside the GBA regions) are skipped, as in GS1's `skipOriginalErrors`.

| routine | kind | why it is in the mix |
|---|---|---|
| System_InstallIwramAndIrqs | leaf, pools | installs the resident IWRAM block and IRQ table (DMA registers, IWRAM symbols from the linker script) |
| Func_080212dc | **ARM** | `.inst` words, local `bl` into `ldr pc` veneer stubs (calls into IWRAM routines), LDM/STM |
| Func_08021470 | **ARM** | long multiplies, `.reloc` pool word, `add lr, pc, #1; bx r12` Thumb trampoline, conditional execution |
| BattleEffect_BuildBuffer | big, battle effect (2,154 B) | jump table, 29 carry-flag branches, indirect calls |
| Func_080f9644 | big (3,212 B) | 163 calls, jump table, gcc far jumps (`bl` inside the routine), carry |
| Palette_Transform | jump table, flags | 25 carry-flag branches |
| Func_08021a84, Func_08122514 | 2 jump tables each | multiple returns |
| Func_080ec4d4 | 2,380 B | 55 pool symbols, 7 indirect calls |
| Func_081b3ff4, Func_080298c0, Func_08027e20 | 2 KB each | many calls (60 in 080298c0) |
| Func_0811e3ac, ScreenTransition_Start | jump tables | |
| Func_08016990 | leaf | serial/link state, 18 pool loads |
| Func_080eb01c | indirect calls | 8 dispatches through code pointers in RAM |
| ItemIcon_Compose, DebugParty_LoadPreset, Class_Determine | calls | |
| VramCache_AllocateBlocks, Render_ProjectPoint, Graphics_AdvancePaletteCycle | leaves | flags, math |
| Func_0200048c@6a8 | **overlay**, the biggest proven (13,456 B) | jupiter_lighthouse scene |
| Func_02002438@686, Func_02003144@64b (world map), Func_02004280@681, Func_02002a20@696, Func_020001f8@6b0, Func_0200065c@6a5, Func_02001c7c@64a | **overlays** | 150 calls in 02002438, a jump table and 3 returns in 02004280, 40 pools in 02002a20 |

Notes on the test:
- **IWRAM-copied code: none among the 1,203 listing routines.** All code the game copies to RAM is in hand-written
  `.s` files: the resident IWRAM block, Resource_Decode2, Tile_*, Glyph_Draw, BattleEffect_ExpandCode, Model_Decode.
  That is TLA4's scope. asm2c's address model takes it: translate at the VMA, add a codemap entry at the RAM address,
  and alias copies as GS1 does (Port_CodeAliasFn). Its ARM decoder covers what those routines use, but asm2c reads
  listings only (section 5).
- **Overlay originals:** the harness takes each overlay's linked image from the reference build
  (`port_work/tla1/overlays/resource_<id>.bin`). compare-tla-en proves its packed bytes are the cartridge's. The
  game's own loader (Resource_LoadCode) needs its RAM decoder installed first, which the harness does not model.
- **Coroutines (trap 57).** `wait` is the task scheduler's yield. Under the interpreter, a nested call to it switches
  stacks and cannot match. The harness makes `wait` return at once, and stops both runs at the YIELDS-th yield
  (default 4), comparing memory there (prefix equivalence).

### Batch over every routine (`--all`, generic inputs, 8 cases each; `build/a2c/batch.log`)

| result | routines (final translator, 1,202) |
|---|---|
| EQUIV | **200** (89 main, 111 overlay) |
| FAIL | **0** |
| NOINPUT | 1,002: none of up to 24 random worlds ran in the original (they need real game state) |

The first batch (1,147 routines) had 14 FAILs. All 14 were `wait` coroutine artifacts, and the harness was changed for
them (trap 57). The earlier FAILs found with the trace were translator bugs, each fixed for every routine at once:
the fallthrough after a conditional branch, and the Thumb bit of function values in pools.

The NOINPUT routines, the battle effect scripts above all, need captured game states (TLA4/TLA6 boot and battles).
Then TLA5's batch report can prove them as GS1 did, with per-routine input rules. A NOINPUT routine is translated but
not yet proven.

## 4. Translator against vendor drafts

`tests/arm/tla/drafts.py` compiles `recon/tla/en/main/<listing>.c` (the vendor's C drafts) for the 22 main proof
routines:
- emsdk clang, the vendor's headers, empty asm statements dropped;
- external data bound to GBA addresses in the IR, as bind.py does;
- external functions turned into interpreter thunks.

`DRAFTS=1 node tests/arm/tla/diff_tla.cjs` runs the same D20 diff.

| | asm2c | vendor drafts |
|---|---|---|
| routines with code to test | 30 / 30 | 21 / 22 main (Func_08021470 has no draft; the 8 overlay routines were not tried) |
| compiles under wasm | 30 | 11 (8 errors: 4 × register-pinned locals `register T x asm("r3")`, 2 × incomplete struct type, 1 × static size assert, 1 × missing header `mulq16.h`; 2 drafts lack the routine) |
| links (all symbols bound) | 30 | 9 (2: a message-id symbol, a function with no address) |
| **EQUIV** | **30 / 30** | **6 / 22** (Func_080298c0, Func_08027e20, ItemIcon_Compose, DebugParty_LoadPreset, VramCache_AllocateBlocks, Graphics_AdvancePaletteCycle) |
| FAIL | 0 | 3 (Func_080eb01c, Class_Determine: the draft hands C-stack pointers to ROM callees; Render_ProjectPoint: a call through a GBA code address with no Port_ResolveCode in the test) |

Drafts are readable but not mechanical. Each needs header work (TLA2 met the same kinds of errors, traps 53-55), and
some differ by design ("differ 12 of 40"). The translator's yield is the whole set.

## 5. What asm2c does not do yet

- The 5 routines of section 2: bounding control flow that runs into data needs a no-return or pool-aware analysis.
- SWI, MSR/MRS, SWP and coprocessor instructions raise "hand". None appears in the listings: those belong to the hand
  `.s` (BIOS calls, IRQ, mode switches; TLA4).
- **Hand `.s` files** (`games/tla/src/**/*.s`, 346 files, 50 KB: veneers, mixer, IWRAM kernels) are not read: they are
  GAS divided syntax with mnemonics, not listings. Most of them have GS1 twins (TLA4). A text front end for ARM
  mnemonics would let asm2c take them as well.
- `A2C_SYM` binds to the GBA address by default. The build must override it for data that lives in wasm buffers (D19
  relocated tables).
- Performance is not measured. Every call spills and reloads the 15 registers through `a2c_r`.

**Estimate of hand work among the 1,203 listing routines: about 5 to 20 (2 % or less).** That is the 5 above, plus a
reserve for routines that may fail D20 once real game states reach them. Every FAIL found so far was a translator bug
fixed for all routines at once, or a harness artifact. The hand-port load moves to TLA4's hardware-bound `.s`.

## 6. Build hooks for TLA5 (not wired: build.py belongs to TLA2/TLA5)

1. **Stage `asm2c`** before compile:
   `python3 tools/wasm/asm2c.py --vendor <alchemy> --symbols port/symbols -o build/wasm/tla/asm2c/tla_asm.c --report build/wasm/tla/asm2c/report.tsv --export <asm symbols C calls>`.
   It needs the bss and absolute symbols and the Thumb bit as a committed names-only table (for example
   `port/symbols/tla-en-extra.tsv` from `make_symbols_tla.py`, from the ELF's full symbol list). Then
   `--extra-symbols` stops depending on `port_work/tla1`.
2. **Compile** `tla_asm.c` with the game. It needs only `<stdint.h>`. Defines:
   - `A2C_SYM(name, off, addr)`: wasm-resident data. Bind.py could also rewrite the constants in IR.
   - `A2C_STACK_TOP`: the GBA sp, `a2c_r.r[13]`, set at boot to System_Entry's IWRAM stack.
3. **Runtime** in port/pc or port/tla:
   - `A2cRegs a2c_r`;
   - `a2c_call(addr)`: Port_ResolveCode, then a C function with r0-r3 as arguments (EMULATE_FUNCTION_POINTER_CASTS)
     and, beyond four arguments, words from the GBA stack, using arg counts from the vendor prototypes or link.py's
     signatures;
   - `a2c_overlay_current()`: the loaded scene overlay id;
   - `a2c_badreturn()`: log and abort.
4. **Stubs to wrappers.** Each asm symbol C calls (TLA2's 2,545 logged stubs include them) becomes
   `ret Name(args) { a2c_enter_wrapped(...) }`, with the prototype's argument count. link.py's per-signature adapters
   already exist.
5. **Codemap.** Merge `a2c_codemap[]` into Port_ResolveCode's table: GBA address (Thumb bit) to function. Overlay rows
   are selected by the loaded overlay (D7).
6. **Fibers (trap 56).** `a2c_r` is shared. A translated routine that calls `wait` (a fiber yield, D8) reloads its
   registers from `a2c_r` afterwards, after another task's translated code changed it. Save and restore `a2c_r` per
   fiber on every switch.
