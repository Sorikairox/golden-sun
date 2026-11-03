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

## 5. TLA4a2 (2026-11-03): the decompressor FAILs

Causes (all found with `TRACE=1` and the new `TRACETAIL=n` of diff_hw.cjs):
- **Routine bounds (hw2c).** TLA's hand .s name spots inside a routine (`AlchemyUncredited*`: STB_LOCAL in the ELF).
  hw2c gave each one to asm2c as a routine start, so Resource_DecodeByteLz was 2 bytes (`bx pc`) and its body was cut
  three times; its `add pc, pc, ip, lsl #3` and `beq` went to mid-routine addresses through a2c_call. hw2c now leaves
  out local labels nothing in the run enters by `bl` or a pool word, and global labels the vendor tree only ever
  branches to (`b`/`bcc`; Resource_DecodeType2Loop, Tile_Decompress4bppLoop, the mixer's IwramSoundMix*, ...). The
  dropped names go to build/tla_hw/internal_labels.txt; make_bindings.py gives them kind data. Call-out targets that
  are no symbol: 119 -> 42 (trap 66).
- **asm2c (3 ARM fixes, commit 0ab5055):** ldm/stm ignore the low two address bits (ByteLz's `ldmia r0, {r4-r6}` on
  an odd source); `sub lr, pc, #0x11c` used the unrotated immediate for the local return (Resource_Decode01);
  `add pc, pc, rm, lsl #k` (k >= 2) now jumps locally (A2C_LOCALRET) into the unrolled copy loop.
- **Func_081c0c0c** is mplay_main's `pop {pc}` epilogue (global for the `bx r3` after it): random stack words made
  both sides run garbage. diff_hw.cjs STACK rule: the return address on top.
- bound_objects() (hw2c, build mode) skipped a whole object when one label in it was bound, which dropped
  Heap_Release with its `swi 3` tail: objects with an a2c row now stay.

Results: D20 **125 EQUIV, 1 FAIL, 61 NOINPUT** of 187 code labels (fewer labels: the internal ones are no longer
routines); Resource_DecodeByteLz, Resource_Decode01, Resource_Decode2, Resource_DecodeHalfwordLz, the picture,
symbol and model decoders and Func_081c0c0c EQUIV. Negative 4/4, diff_tla 30/30, test_arm 79/79.
bindings.tsv: 33 gs1, 154 a2c (94 EQUIV, 60 NOINPUT), 11 bind, 301 data, 4,445 veneer, **0 left**.
heap_release's `swi 3` tail (AlchemyUncreditedEnd_08013172 / Irq_HaltOnGamePakRemoved) binds to Port_BiosStop, as
GS1's Irq_StopOnGamePakRemoved.

Still open:
- **ply_rept**'s translation FAILs (pre-existing). It is provided by GS1's EQUIV port (gs1 row), so nothing links
  the translation. Its `bl .L_081c1750` and `b .L_081c175e` land inside ply_goto's routine; the call-out to the
  interpreter then reads a garbage pointer, not yet understood. A fix needs asm2c entries that overlap a routine
  (a second Fn from the target to the routine's end), not a split (trap 66).
- 42 call-out targets are mid-routine sound-driver spots (same cause as ply_rept).
- Func_080cf78c, Func_08173aac, Func_02002f64 @681: not done in TLA4a2 (no time); still `hand`.
- NOINPUT counts not worked on.

## 6. Left before TLA4a2

- **Resource_DecodeByteLz** (+ internal entry `_0800165a`) and **Resource_Decode2** (+ `_08012b72`): D20 FAIL. The
  translation's interpreter call-outs end at a bad pc, which looks like an indirect jump the translation misroutes.
  GS1's ports (Decompress_ByteLzArm, IwramDecompress) differ in bytes, so they are not twins yet. Next: trace with
  `TRACE=1 OUT=hw_trace tests/arm/tla/build_hw.sh` and `OUT=hw_trace TRACE=1 node tests/arm/tla/diff_hw.cjs <name>`.
- **Func_081c0c0c** (mplay_main): D20 FAIL. The call-out writes at a pc in EWRAM.
- **AlchemyUncreditedEnd_08013172** (heap_release): a `swi 3` stop path, so a bind to Port_BiosStop once confirmed.
- ply_rept also FAILs as a translation (`ld_r3_tp_adr_i` call-out). It is provided by GS1's EQUIV port, as a byte twin.
  The translation failure is still an asm2c lead for TLA5: a `bl` into the middle of another routine.
- Func_080cf78c, Func_08173aac, Func_02002f64 @681 (section 3).

## 7. TLA4b (2026-11-03): wiring, the call-target check, boot to the first decompressor

### Wiring
- **H3.** The build's asm2c stage now runs `port/tla/hw/tools/hw2c.py --with-listings`: the vendor listings and the
  hand-asm byte listings go through asm2c in one pass (1,404 of 1,411 routines; one `a2c_dispatch`, codemap and
  names.tsv). Byte listings load first, so they win where they cover a listing routine asm2c could not take.
  bindings.tsv `bind`/`gs1` rows are veneers to their port function (link.py veneer_map). The GS1 twins come from
  port/pc files marked `twins` in port/tla/pc.tsv (asm_small, iwram, m4a, sound_asm, text_asm): build.py keep_twins
  keeps the gs1 port functions and turns every other definition into a declaration (`Trig_SineTable` read as
  `Math_SineTable`).
- **tla_asm.c is split** into 16 units, compiled three at a time after the rest: the 43 MB unit was OOM-killed
  (exit 137; the Docker VM has 8 GB), and emcc still reported success, so link.py now fails on a missing object.
- **Trap 65.** A c_rules hook in Resource_LoadCode (TLA's overlay loader, vendor C) calls Port_TlaOverlayLoaded
  (port/tla/hw/pc_tla.c): Port_CodeMapOverlay, Port_A2cOverlayLoaded, Port_RelocateOverlay.
- **H1.** TLA's IwramIrqMain reads gIrqHandlers (0x030001e4) directly, in the order 1, 0, 2, 6, 7, 4, 5, 12, 13:
  the same as hw.c's IRQ_ORDER. Differences that do not matter in the port: it sets IME and narrows IE to
  VCount/Timer3/Serial/GamePak while a handler runs (nesting), and when no listed bit is pending it calls handler 13
  (the ldr for GamePak is unconditional).
- **H2.** Port_BiosNop and Port_BiosSoundGetJumpList (pc_tla.c). Nothing in TLA calls the wrappers.
- **H4.** Port_TlaRunAddress maps the ROM load ranges of the IWRAM block (0x080006B8 -> 0x03000100, 0xFA0 bytes)
  and the mixer (0x081C1310 -> 0x03006000) to the run address: Port_ResolveCode (TLA only) and a2c_call try it.
  m4aSoundInit's mixer copy reads the ROM address (c_rules: `Sound_Mixer` was a function index, which Bios_CpuSet
  skips). `Sound_Mixer` calls go to SoundDriver_Mixer.
- **H5.** The colour kernel loaders DMA a kernel to the stack and `bl _call_via_sp`. Translated stores to I/O now
  call a2c_io_written (a DMA started by register writes runs at once). `_call_via_sp` (pc_tla.c) runs the kernel's
  translation, found by the DMA3 source, on the register file. The rest of H5 (BattleEffect_PatchTemplate, the
  relocated battle kernels) is not needed for boot and not done.
- Entry: main.c calls Func_0801319c (TLA's System_Initialize) and the IRQ vector word is 0x080006B8; soft reset
  0x08000428. Both are under PORT_GAME_TLA, which only the TLA build defines.
- VCOUNT busy-waits in driver.c and pcm_rate.c go through Port_ReadVCount (c_rules), as GS1.
- The TLA build now exports its PC layer (Port_FrameBuffer, Port_SetKeys...). link.py looked for GS1's object
  prefix only.
- Veneers no C calls by name get code map rows (codemap_gen, TLA only): translated code calls them by address.

### asm2c
- **Overlap entries** (trap 66): a constant call into the middle of a translated main-image routine gets a second
  routine from the target to the routine's end (`ROUTINE+0xOFF`; 22 in the build: chk_adr_r2, ld_r3_tp_adr_i,
  the decode_2 epilogue...). An overlay overlap entry (Func_0200039c+0x19c@6b5) failed the batch, so overlays are
  left out. a2c_call calls a translated routine raw (overlap entries have no C wrapper).
- `add pc, pc, rm, lsr #k` is a local computed jump (IwramFillWords).
- **Returns past the caller.** mplay_main's `pop {pc}` epilogue (reached by tail branches after MPlayMain's own
  `bl`s changed lr) returns to MPlayMain's caller. Callees now report where they returned (`a2c_ret_to`). A frame
  whose entry lr differs unwinds (one shared `unw:` block per routine), and a2c_enter_wrapped checks its sentinel.
  A register jump to an address with no code (a2c_is_return) counts as such a return.
- hw2c names unlabelled code at the start of a run (`HwCode_030004a8`, the shared signed-division body).

### Call-target check (trap 66)
`tools/wasm/call_targets.py`, build stage `calls` (TLA). Every constant `a2c_call` target in the generated C must
be a bound entry point (asm2c codemap, the link's code map, ROM-copy run address, soft reset) or a row of
`port/tla/call_targets_allow.tsv`. Result: 29,526 sites, 19 unbound, all allowed (render.c left out 10,
sound-driver spots 7, Func_02002f64@681 2): PASS.

### Results
- Full `tools/web_build.sh --game tla`: PASS (0 linker warnings, audit, leak 0, calls PASS; game.wasm 21.5 MB,
  about 6 min).
- D20 batch 251 EQUIV / 0 FAIL / 951 NOINPUT. diff_tla 30/30. diff_hw 124 EQUIV / 0 FAIL / 65 NOINPUT of 189
  (ply_rept no longer FAILs). test_arm 79/79.
- GS1 game.wasm 687968a7, game.js 895d45cc (sha1, identical); regress --quick 9/9 OK.

### Stop point (node, `node tests/boot.cjs --game tla 600`)
Boot passes Heap/IRQ install, sound init (SampleFreqSet, MPlayMain, the mixer copy) and stops before the first
frame is drawn:

```
asm2c: continuation at 0x08012e74, expected the return to 0x0d0ffff0
  a2c_badreturn <- Resource_Decode2 (wrapper) <- Resource_DecodeType2 <- a2c_call <- a2c_0802a6b8
```

Resource_Decode2 (src/system/decode_2.s) does `add ip, pc, #36; ldm ip, {sl, fp}`: it loads code addresses from
a pool and later jumps through them by register. 0x08012e74 is a helper inside the refill object
(`and r8, ip, fp; bx lr`, after Resource_RefillType2Bits's epilogue), with no label. A register jump there
finds no routine, so a2c_is_return takes it for a return past the caller and unwinds to the wrapper.
Hypothesis and fix: give pool-word code targets inside a byte listing an entry (an overlap entry, or an
`HwCode_` label when nothing branches across it), as was done for constant targets. The call-target check does not
see these targets because they are loaded from a pool, not constants in a2c_call. Then continue the boot. Chrome,
the title, the audio check and Func_080cf78c / Func_08173aac / Func_02002f64@681 were not reached.
