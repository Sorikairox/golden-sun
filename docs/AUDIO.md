# Audio (session GS-audio, 2026-11-01)

Status: **the game has sound.** The title music, the field/prologue music and sound effects play, in node (WAV
dumps) and in the page (AudioWorklet), from the game's own m4a sequencer and Camelot's mixer ported to C.

## Chain

1. **Sequencer** (`port/pc/m4a.c`, vendor `src/sound/clear_buffer.s`): MPlayMain (tempo ticks, track commands,
   note gate times, LFO, volume/pitch refresh), ply_note (voice/key split/drum kit lookup, PCM channel choice by
   priority, CGB channel), the ply_* commands, ply_endtie, TrackStop, m4aSoundVSync (restarts the sound DMAs
   every transferPeriod VBlanks). The vendor C around it (MPlayStart, TrkVolPitSet, FadeOutBody, CgbSound,
   MidiKeyToFreq...) is compiled as is. `gMPlayJumpTableTemplate`'s slots now point at our functions (relocs).
2. **Mixer** (`port/pc/mixer.c`, vendor `channel_update_entry.s`, `resident_mixer*.s`, the reverb codes and
   resampler kernels in `system/entry.s`): System_VBlankHandler calls Mixer_Enter. It runs the sequencer chain
   and CgbSound, then per PCM channel the envelope (attack/decay/sustain/release, echo) and 352 samples into
   IwramSoundMixWorkspace (packed words: right in the low half, left in the high half): fixed-rate block mixer,
   synth waves (pulse with swept duty, filtered noise, triangle), interpolating resampler (three self-patched
   kernels by step, or the general loop with loop/end). Then the render: clipping (gSoundMixerClipped), bytes
   into the two DirectSound buffers at the DMA's current period, and the reverb code the game loaded into
   IwramSoundReverbCode (identified by comparing it with the five ROM codes; 4 = none) seeding the next mix.
   352 samples a VBlank = 21024 Hz.
3. **GBA sound hardware** (`port/pc/apu.c`, hooks in `hw.c`): FIFO A/B (32 bytes), popped on Timer 0/1 overflow
   (SOUNDCNT_H timer select), refilled 4 words by the sound DMA (start timing 3) at 16 bytes or less
   (`Port_DmaSoundFifo`); PSG 1-4 (square duty/envelope/length/sweep, wave from wave RAM snapshotted at trigger,
   noise LFSR 15/7), triggers and FIFO resets polled (register writes are plain stores here); mixed with
   SOUNDCNT_L (NR50/NR51), SOUNDCNT_H (PSG 25/50/100 %, DMA 50/100 %, routing), SOUNDCNT_X master enable,
   clamped to 10 bits like the bias output, scaled to s16. Output **32768 Hz stereo** (one sample per 512 cycles)
   into a 16384-frame ring (`Port_AudioDrain`/`Port_AudioBuffer`/`Port_AudioRead`/`Port_AudioRate`); oldest dropped
   when nobody drains. Deterministic: same samples every run (no wall clock).
4. **Page** (`port/web/audio.js`): once a frame main.js calls `GSAudio.feed(m)`: drained samples go to an
   AudioWorklet (Blob module) queue, linearly resampled to the device rate; past 250 ms queued the oldest chunk
   is dropped; ScriptProcessor fallback with the same queue. Starts on the first user gesture (keydown, pointer,
   touchend, click: listeners on window, capture phase, so the touch pad counts). When audio is not running or
   muted, samples are drained and dropped: the game's 59.73 Hz pacing never waits on audio. Menu: Mute checkbox
   and Volume slider (44 px targets), stored in localStorage `gs-audio` (try/catch). `GSAudio.stats()` for tests.

## Tests

| | |
|---|---|
| `tools/test_arm.sh` | includes the GS-audio specs: ply_goto/patt/pend/rept/prio/tempo/keysh/voice/vol/pan/bend/bendr/lfos/lfodl/mod/modt/tune/port/endtie/fine, TrackStop (1500 random tracks each), **Mixer_Enter (300 whole VBlanks: 1-12 channels, all envelope phases, PCM looped/unlooped, fixed rate, the three synth kinds, the three kernels and the general loop, every reverb code)**. The original runs with its stack in IWRAM below 0x03007800 (never takes its sample-DMA-to-stack speed path) and patches its own code: those areas are ignored (`spec.ignore`, `spec.sp`). |
| `WAV=port_work/audio/boot.wav tools/boot.sh 900 --probe tests/probes/wav.cjs --quiet` | WAV of a node run (`WAV_FROM=N` skips N frames) |
| `node tools/audio_check.cjs FILE.wav [window_s] [from_s] [to_s]` | RMS/peak/clipping per window, top DFT peaks, SHA-1 |
| `OUT=port_work/audio/web node tests/web_shot.cjs 300,900 --flash port_work/g4/flash.sav --press 60:KeyZ --audio` | muted headless Chrome: worklet state, samples sent/received non-zero, fps |

Results (2026-11-01): boot.wav 15 s: silent until the Golden Sun logo, then music, RMS ~2500-5500, peak <= 23808
(no clipping), steady peaks around 248 Hz / 80 Hz / 664 Hz, identical SHA-1 on two runs. Title with a save and
menu moves (title_menu.wav): music throughout, no clipping, the menu SE notes start (ply_note on the SE player).
Chrome: worklet running at 48 kHz, ~594k frames sent (82 % non-zero), worklet output 82 % non-zero, 0 dropped,
59.7 fps over 4 s, 0 console errors.

## Not done / known issues

- Not EQUIV-tested yet: ply_note, MPlayMain, m4aSoundVSync (written from the asm field by field; they run the
  whole game's music without fault). Next session: specs with a SoundInfo, voice tables and channel pools.
- SoundMain (unused by the game) mixes with Camelot's mixer instead of SoundMainRAM (the library mixer copied to
  0x03007000, not ported); CpuSet skips that copy (its source is a wasm function).
- PSG is a register-level model (no zombie-mode envelope writes, wave RAM taken at trigger, no exact 10-bit bias
  quantisation); DirectSound plays sample-and-hold at 21024 Hz into the 32768 Hz output like the hardware.
- First 1 s of output carries a small DC step (the FIFO DAC before the driver runs); harmless.
- Resampling in the worklet is linear; no low-pass.
