# TLA4: hardware-bound asm (part A, TLA4a, 2026-11-03)

Phase TLA4 of `docs/TLA_PLAN.md`, part A: The Lost Age's handwritten asm (`games/tla/src/**/*.s` at f6c08e64), plus
the listing routines asm2c (TLA3) left. Part B (boot to the title) is TLA4b.

## 1. What is there

The census (`port/tla/hw/tools/hand_census.py`, reads the reference build in `port_work/tla1` and both ROMs, writes
names and verdicts to `build/tla_hw/`) finds:

- **4,445 veneer labels** (far_call/*.s, scene `import.s` and `entry.s`): one branch to another symbol each.
- **109 objects with code** (an ARM `$a` or Thumb `$t` mapping symbol in their .text), 499 global labels.
  Many labels are data or code only entered from the label before it (`AlchemyUncredited*`).

Object against GS1 (`build/tla_hw/objects.tsv`): 24 byte-identical, 7 identical except pool words and BL offsets of
moved symbols ("reloc"), 49 differ, 29 have no GS1 counterpart. The IWRAM block is laid out differently from GS1's
(split into files), so most IWRAM routines compare as "differ" by object even where the routine itself matches.

## 2. Method

- **asm2c through a byte front end** (`port/tla/hw/tools/hw2c.py`). asm2c reads listings, not GAS source with macros.
  So hw2c writes, for each code object, a listing of the object's linked bytes from the reference ELF (compare-tla-en
  proves the image equals the cartridge). The listing sits at the run address (IWRAM code at its IWRAM address) and
  carries:
  - the object's global labels;
  - `.thumb`/`.arm` from the ELF mapping symbols;
  - Thumb code as `.2byte`, ARM code and data as `.4byte`.

  Adjacent objects are merged into one listing, because a routine may fall through into the next one. asm2c's own
  decoders and output (routines, dispatch, codemap, wrappers) are used unchanged: `hw2c.py` imports `asm2c.py`.
  Everything it writes is ROM-derived and stays in `build/` (D2/D18).
- **GS1 twins.** A TLA label counts as a twin of a GS1 port only under three conditions:
  - its bytes are identical to GS1's, or identical except for "reloc" words;
  - GS1's port of it is itself D20 EQUIV;
  - the port function is not `static`.

  The four GS1 sound ports that are not EQUIV are excluded: SoundMain, MPlayMain, ply_note and m4aSoundVSync. Their TLA
  twins take the asm2c translation.
- **Binds.** BIOS SWI wrappers, the IRQ entry, the halt and the cartridge entry use asm2c's `hand` instructions
  (swi, msr/mrs). They go to the PC layer.
- **List for the build.** `port/tla/hw/bindings.tsv` (names only, from `port/tla/hw/tools/make_bindings.py`) has one
  row per label: symbol, port function, kind, object, proof, aliases.

## 3. Results

`port/tla/hw/bindings.tsv`, 4,944 rows:

| kind | rows | what |
|---|---|---|
| gs1 | 33 | GS1 port function (bytes same/reloc, GS1 D20 EQUIV): `__divsi3` `__udivsi3` `__modsi3` `__umodsi3`, Trig_Cos, Message_FindArm, RelocatedQ16DotProduct (BattleEffect_DotProduct, ...DotProduct2), umul3232H32, SoundMainBTM, RealClearChain, 19 `ply_*` (ply_rept included), TrackStop, ply_endtie (2 labels) |
| a2c | 304 | asm2c translation `a2c_<addr>`: **164 EQUIV** (7,291 cases), 140 NOINPUT |
| bind | 10 | PC layer (section 4) |
| data | 146 | data labels / internal entry points (no entry of their own) |
| veneer | 4,445 | alias of the target symbol (TLA2b's overlay_imports.py already resolves them in the link) |
| left | 6 | section 5 |

D20 (`tests/arm/tla/build_hw.sh`, then `node tests/arm/tla/diff_hw.cjs`, CASES=60):
- the whole run over 343 translated code labels: **196 EQUIV, 6 FAIL, 141 NOINPUT**. The EQUIV count includes the
  twins and binds that were also translated for the test;
- negative controls: `--negative` gives **4/4 detected**;
- TLA3's `diff_tla.cjs` still gives **30/30**, and GS1's `tools/test_arm.sh` still gives **79/79**.

EQUIV includes:
- IWRAM: IwramDivide, IwramUnsignedDivide, the remainders, IwramCopyWords, IwramFillWords, IwramMulQ16, ratio and
  transform routines;
- Trig_Sin, the decode_2 loop, Tile_Decompress4bpp and the expand routines;
- the battle model bit commands, the credits background expanders;
- the sound sequencer commands, MPlayMain, SoundChannel_Unlink;
- Func_081c0168, a listing leftover.

NOINPUT routines need real state: the mixer lanes, the colour kernels, the blitter fragments, the relocated battle
kernels, and the sound driver entry points.

### The 5 listing labels asm2c could not translate (TLA3.md 2)

| label | now |
|---|---|
| Func_081c0168 (sound leftover) | translates through the byte listing (the pool word is in the next object). **D20 EQUIV.** Its 48 bytes are also identical to GS1's at 0x080f9eb8 |
| Func_081c05c8 (sound leftover) | translates through the byte listing; NOINPUT under generic worlds |
| Func_080cf78c, Func_08173aac | still `hand`: flow reaches halfwords that are not v4T code (0xf6fd, 0xb890), data after a jump. Needs a hand bound on the flow (TLA5) |
| Func_02002f64 @681 | overlay: not taken by the byte front end (main image only); same cause as above |

## 4. Binds and PC-layer hooks (for TLA4b / TLA2b; port/pc is not touched here)

| symbol | bound to | hook |
|---|---|---|
| IwramIrqMain | Port_RaiseIrq (port/pc/hw.c dispatch) | **H1**: TLA's irq.s differs from GS1's at +0x14. Check TLA's priority order and handler table (`gIrqHandlers` equivalent) before reusing hw.c's order |
| Iwram_Halt | Port_BiosHalt | none (frame driver, D8) |
| Bios_CpuSet, Bios_SoundBiasOn/Off | port/pc/bios.c, same names | none: object bytes identical to GS1's |
| Bios_SoundDriverMode (swi 0x1B), Bios_Swi23 (swi 0x23) | Port_BiosNop | **H2**: add a no-op `Port_BiosNop` (no BIOS sound driver in the port) |
| Bios_SoundGetJumpList (swi 0x2A) | Port_BiosSoundGetJumpList | **H2**: GS1 copies its relocated template (MPlayJumpTableCopy); expose it under this name for TLA |
| Entry | main (port/pc/main.c) | none |
| Irq_StopOnGamePakRemoved | Port_BiosStop | none |

More hooks:
- **H3 (link stage):** consume bindings.tsv:
  - `gs1` rows: turn the GS1 port file on in port/tla/pc.tsv, or link only those functions;
  - `a2c` rows: compile hw2c's output with asm2c's (one `a2c_dispatch` and codemap for both: run hw2c and asm2c in
    one pass, or merge their switch and codemap tables);
  - `veneer` rows: aliases.
  - `asm2c.py` needs no change: hw2c drives it.
- **H4:** IWRAM code addresses. Translated IWRAM routines are keyed by their IWRAM address (0x03000xxx, 0x03006000).
  Port_ResolveCode must accept those, and the ROM copy address (IwramResident_Rom + offset, `Sound_Mixer`), as aliases
  (Port_CodeAliasFn, GS1).
- **H5:** code copied or generated at run time cannot run from a static translation. That covers ColorBuffer_*KernelCode
  copied by color_scale_loader, BattleEffect_PatchTemplate, and the relocated kernels. Each needs a check of whether
  the copy is executed as is (translate at the copy address: codemap alias) or patched (GS1 trap 29: blitter code
  generation). The NOINPUT entries above include them. They need captured battle state.

## 5. Left (6 labels, plus 3 listing routines)

- **Resource_DecodeByteLz** (+ internal entry `_0800165a`) and **Resource_Decode2** (+ `_08012b72`): D20 FAIL. The
  translation's interpreter call-outs end at a bad pc, which looks like an indirect jump the translation misroutes.
  GS1's ports (Decompress_ByteLzArm, IwramDecompress) differ in bytes, so they are not twins yet. Next: trace with
  `TRACE=1 OUT=hw_trace tests/arm/tla/build_hw.sh` and `OUT=hw_trace TRACE=1 node tests/arm/tla/diff_hw.cjs <name>`.
- **Func_081c0c0c** (mplay_main): D20 FAIL. The call-out writes at a pc in EWRAM.
- **AlchemyUncreditedEnd_08013172** (heap_release): a `swi 3` stop path, so a bind to Port_BiosStop once confirmed.
- ply_rept also FAILs as a translation (`ld_r3_tp_adr_i` call-out). It is provided by GS1's EQUIV port, as a byte twin.
  The translation failure is still an asm2c lead for TLA5: a `bl` into the middle of another routine.
- Func_080cf78c, Func_08173aac, Func_02002f64 @681 (section 3).
