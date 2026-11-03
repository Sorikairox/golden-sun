# TLA5: asm2c wired into the TLA build (2026-11-03)

Phase TLA5a/5b of `docs/TLA_PLAN.md`: TLA's listing asm (TLA3's asm2c, D23) is now translated at build time and
linked in place of the logged stubs.

## 1. The build stage

- `tools/wasm/build.py --game tla` has a new stage, **asm2c**, between bind and obj (TLA only; GS1's stages are
  unchanged). It runs `tools/wasm/asm2c.py` over the main listings and the overlay listings and writes, under
  `build/wasm-tla/asm2c/` (never committed):
  - `tla_asm.c`: the translated routines, their dispatch, the codemap and a wrapper `a2cw_<addr>` per routine;
  - `names.tsv`: every global label of a translated routine (aliases too), with its overlay and function;
  - `report.tsv`: the routines asm2c cannot take.
- `tools/wasm/link.py` (TLA only):
  - compiles `tla_asm.c` and `port/tla/a2c/a2c_rt.c` with the other C files;
  - binds the stubs. A logged stub of a translated routine becomes an IR wrapper with the signature its callers
    use. Main routines keep their name; overlay routines are named `ovNNN_NAME`, as in TLA2b's binding. The wrapper
    calls `a2cw_<addr>(nstack, r0-r3, 8 stack words)`. Arguments are passed as words: an i64 takes two words, as GCC
    2.9x passes it. An i64 result comes from r0:r1.
  - also gives a wrapper (four words in, r0 out) to each of the 603 routines no C calls. So the codemap maps all
    1,202 translated routines, and a code pointer the asm stores resolves from C.
  - Counts: `asm2c binding: bound 1202, uncalled 603`.
- `port/tla/a2c/a2c_rt.c` holds:
  - the register file;
  - `a2c_call` (Port_ResolveCode, r0-r3 plus four GBA stack words, result in r0, the file copied on the C stack
    and put back);
  - `Port_A2cOverlayLoaded(id)` for the overlay-aware dispatch (see 5);
  - `a2c_badreturn`, which logs and aborts.
- TLA4's C ports are compiled and bound like port/pc when they exist: `code_objects` adds `port/tla/hw/*.c`.

## 2. Committed symbol table

`port/tla/symbols/tla-en-extra.tsv` holds 27,048 rows (overlay, name, address; names and addresses only):
- 11,466 main symbols: bss, linker-script symbols, and function values with their Thumb bit;
- 15,582 overlay bss symbols.

`tools/wasm/a2c_extra_symbols.py` generates it from the reference build. It writes exactly the difference that
`asm2c.load_symbols` sees with and without `port_work/tla1`. asm2c reads the table by default, and its output is
byte-identical to the output built from the port_work source (42,240,494 bytes, `cmp`). The asm2c stage itself
no longer reads port_work. The D20 harness and `game.C.overlay_bins` still do.

## 3. Results

| | before (TLA2b) | TLA5 |
|---|---|---|
| logged stubs | 647 | **47** |
| asm stubs | 638 (main 273 listing + 36 hand, overlay 328 + 1) | **38**: 36 hand .s (TLA4), Func_080cf78c, Func_08173aac |
| linker warnings | 0 | 0 |
| leak check | 0 | 0 (3,551,267 windows) |
| game.wasm | - | 15,154,886 B |
| full `tools/web_build.sh --game tla` | about 40 s | 1 min 52 s |

The extra time goes to compiling the 42 MB `tla_asm.c` (a 15.2 MB object) as one unit. It could be split per
overlay for parallel compiles.

Not bound:
- Func_02002f64 (overlay 681), Func_081c0168 and Func_081c05c8 have no wrapper and no codemap row. No C calls
  them. TLA4a's hw2c now translates two of them. A code pointer to one of them aborts in Port_ResolveCode and names it.
- The other 9 logged stubs are 7 render.c C functions and 2 unmapped names.

## 4. D20 batch (`tests/arm/tla/batch/run.sh`, about 22 s on 6 shards)

`build/a2c/batch/d20_batch.tsv` gives each routine's result, the profile that gave its inputs, and a note.

Each routine is tried under four world profiles in turn, until one gives inputs the original can run:

| profile | world |
|---|---|
| generic | TLA3's |
| ptr | RAM mostly EWRAM pointers; arguments are pointers |
| deep | every RAM word points to a 256-byte EWRAM block, so pointer chains of any depth resolve |
| struct | EWRAM blocks of small numbers; every IWRAM global word points to one block |

**251 EQUIV (98 main, 153 overlay), 0 FAIL, 951 NOINPUT of 1,202.** TLA3 had 200 EQUIV.

EQUIV routines by profile: generic 215, ptr 21, deep 10, struct 5.

The first run gave 286 EQUIV and 2 FAIL:
- Func_020015e4@691 and Func_02002898@664 jumped through a random word into data, and the original "ran"
  garbage there.
- The runner now treats execution outside the ROM, the resident IWRAM block (below 0x03001100), the loaded
  overlay window and the interpreter scratch area as an input the original cannot run (trap 64).
- Both routines are NOINPUT now, as are 33 others that were EQUIV only because they executed garbage.
- Raising TRIES to 48 did not help (246).

**Still need captured game state** (NOINPUT, by first error over 48 inputs):

| first error | routines |
|---|---|
| out-of-region read of 4 | 454 (316 overlay) |
| out-of-region read of 2 | 203 |
| out-of-region write of 4 | 180 |
| out-of-region read of 1 | 55 |
| out-of-region write of 2 | 19 |
| jump into data | 29 |

That includes 106 BattleEffect_* scripts. They need:
- real heap structures: the actor and field work blocks, the battle work and battle effect state;
- the overlay's own globals.

Once the game boots (TLA4b/TLA6), capture RAM at scene and battle entry and replay each routine on it, as GS1
did with per-routine input rules.

## 5. Fibers (trap 56): not needed

- The port has no fibers. TLA's `wait()` is plain C (src/system/system.c). Task_RunPass calls each task's routine
  as an ordinary callback (system/task/resume_and_run.c). Then the BIOS halt runs the display synchronously
  (port/pc/hw.c, D8).
- The page's ASYNCIFY suspension at port_frame_ready keeps the whole C stack.
- So every switch between translated code and C is properly nested. Both crossings keep a copy of the register
  file on the C stack and restore it:
  - C into translated code: `a2c_enter_wrapped`;
  - translated code into C: `a2c_call`, new in TLA5.
- That copy is what a per-fiber swap would do, so the file stays right even if fibers are added later.
- **One limit if real fibers ever come:** the GBA stack. A wrapped entry starts at the caller's spilled sp. Two
  fibers interleaving translated frames would then need a GBA stack region per fiber (`A2C_STACK_TOP`).

## 6. Left for the next phases

1. **Overlay loading.** The overlay loader must call `Port_A2cOverlayLoaded(id)` next to `Port_CodeMapOverlay(id)`.
   In TLA neither is called yet: port/pc/decompress.c is GS1-only, and Resource_LoadCode is TLA4's. Until then,
   asm2c's dispatch never selects an overlay's routine by address. Direct calls and the codemap are not affected.
2. **TLA4a's bindings.tsv.** The `a2c` and `gs1` rows of TLA4a's `port/tla/hw/bindings.tsv` are not linked yet
   (TLA4 hook H-list). The build already compiles any `port/tla/hw/*.c`. hw2c's translated C would need the same
   stage as here: a second asm2c output, with its names fed to `a2c_names`.
3. **Captured states** for the 951 NOINPUT routines (section 4).
4. **Func_080cf78c and Func_08173aac.** Control flow runs into data. Each needs a bound on its control flow or a
   hand port.
5. **Build time.** Split `tla_asm.c` per overlay.
