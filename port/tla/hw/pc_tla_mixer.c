/* TLA4d: The Lost Age's PCM mixer and its render, hand-ported to C (trap 72: both patch their own instructions, so
 * asm2c cannot translate them). The originals: SoundDriver_EnterVBlankUpdate (src/sound/driver/enter_vblank_update.s),
 * the resident IWRAM mixer it jumps to (resident_mixer.s, resident_mixer_lanes.s, resident_mixer_modes.s,
 * resident_mixer_channel.s, at 0x030007b4..0x03000d1b) and IwramSoundRenderVBlank (resident_mixer_render.s,
 * 0x03000d40), which System_WaitForFrameInterrupt calls when the mixer returns 0.
 *
 * The channel mixers are GS1's (port/pc/mixer.c, included with MIXER_KERNELS_ONLY): the same fixed-rate block mixer,
 * synth waves and interpolating resampler, here over 528 samples into IwramSoundMixWorkspace (0x03006fc0), with the
 * resampler kernels unrolled 8 samples a pass (the first multiplies unconditionally, the other seven `mulne`, as in
 * the patched lanes). What differs from GS1, from the listings:
 *   - the envelope: a release subtracts (256 - release) from the level (GS1 multiplies), the level is raised by an
 *     eighth before the two volumes are taken;
 *   - a channel whose two volumes are both 0 is skipped (no sample advances), the others count in the word at
 *     0x03000d1c (the render reads bits 2-3 of the count and shifts it up by 4);
 *   - the mixer writes nothing to the DirectSound buffer: it leaves the sample count and this VBlank's buffer half
 *     at 0x03000d20/0x03000d24 and returns 0; the render then writes two 8-bit samples per workspace word (an
 *     interpolated pair, rounded or not by that count) to the two buffers (gData_02003a90 and +0xc60), and seeds
 *     the workspace for the next VBlank with a filter of the old buffer bytes (the two packed coefficient words at
 *     0x03000d38/0x03000d3c) and a delayed tap of the left buffer (0xb0 words back), flagging clipping at
 *     0x03000ee4.
 * Every operation keeps the original's 32-bit arithmetic. The mixer's own code words (kernel patches, their cache,
 * saved registers, the render's patched branch) are not kept: tests/arm/tla/diff_mixer.cjs compares everything
 * else (all RAM, the state words above) against the ROM's code run in the interpreter. */
#include "../../pc/gba.h"

#define WORKSPACE 0x03006FC0u /* IwramSoundMixWorkspace (528 words) */
#define SAMPLES 528
#define MIXER_MUL_GROUP 8
#define MIXER_KERNELS_ONLY
#include "../../pc/mixer.c"

#define CHANNEL_COUNT 0x03000D1Cu /* mixed channels, shifted by 4 each render */
#define RENDER_SAMPLES 0x03000D20u
#define RENDER_BUFFER 0x03000D24u
#define RENDER_PREVIOUS 0x03000D2Cu /* the buffer half rendered last (gData_02003a90 at reset) */
#define RENDER_DELAY 0x03000D30u    /* 0xb0: the tap's delay, in workspace words */
#define RENDER_LEFT 0x03000D34u     /* the words left after the delayed part */
#define RENDER_K1 0x03000D38u
#define RENDER_K2 0x03000D3Cu
#define RENDER_CLIPPED 0x03000EE4u
#define SOUND_BUFFER 0x02003A90u
#define PERIOD 0x03001138u /* byte 1: this VBlank's buffer period, set by System_WaitForFrameInterrupt */

/* IwramSoundMixEntry: one channel's envelope, then its mix */
static void tla_mix_channel(u32 ch) {
  u32 wav = U32(ch, 36);
  u32 st = U8(ch, 0), r5;
  struct Mix m;
  m.ch = ch;
  m.loopStart = 0;
  m.loopLen = 0;
  if (!(st & 0xC7))
    return;
  if (st & 0x80) {
    if (st & 0x40) {
      U8(ch, 0) = 0;
      return;
    }
    st = 3;
    U32(ch, 40) = wav + 16;
    U32(ch, 24) = U32(wav, 12);
    r5 = 0;
    U8(ch, 9) = 0;
    U32(ch, 28) = 0;
    if (U8(wav, 3) >> 6)
      st |= 16;
    goto attack;
  }
  r5 = U8(ch, 9);
  if (st & 4) { /* echo */
    u32 e = U8(ch, 13);
    U8(ch, 13) = (u8)(e - 1);
    if (e > 1)
      goto volume;
    U8(ch, 0) = 0;
    return;
  }
  if (st & 0x40) { /* release: the level falls by 256 - release a VBlank */
    r5 += (u32)U8(ch, 7) - 256;
    if ((s32)r5 >= 0 && r5 > U8(ch, 12))
      goto volume;
  echo:
    r5 = U8(ch, 12);
    if (!r5) {
      U8(ch, 0) = 0;
      return;
    }
    st |= 4;
    goto store;
  }
  switch (st & 3) {
  case 2: /* decay */
    r5 = (r5 * U8(ch, 5)) >> 8;
    if (r5 > U8(ch, 6))
      goto volume;
    r5 = U8(ch, 6);
    if (!r5)
      goto echo;
    st--;
    goto store;
  case 3:
  attack:
    r5 += U8(ch, 4);
    if (r5 < 255)
      goto store;
    r5 = 255;
    st--;
    goto store;
  default:
    goto volume;
  }
store:
  U8(ch, 0) = (u8)st;
volume:
  U8(ch, 9) = (u8)r5;
  r5 += r5 >> 3;
  {
    u32 sl = (U8(ch, 2) * r5) >> 9, fpv = (U8(ch, 3) * r5) >> 9, fp;
    if (st & 16) {
      u32 ls = U32(wav, 8), size = U32(wav, 12);
      m.loopStart = wav + 16 + ls;
      m.loopLen = size - ls;
    }
    fp = sl | fpv << 16;
    if (fp == 0) /* both volumes 0: IwramSoundMixSkipChannel, nothing stored */
      return;
    U32(CHANNEL_COUNT, 0) += 1;
    if (U8(ch, 1) & 8)
      mix_block(&m, fp, U32(ch, 24), U32(ch, 40));
    else
      mix_interp(&m, fp, U32(ch, 24), U32(ch, 40));
  }
}

/* IwramSoundRenderVBlank */
static void tla_render(void) {
  const u32 r8 = 0xFF00FF00u, lr = 0x80008000u, half = 0x80008000u >> 9, r3 = 0xC60;
  u32 flags = U32(CHANNEL_COUNT, 0);
  int round = (flags & 12) == 0; /* the loop's patched branch: back to the rounding add, or past it */
  u32 *ws = (u32 *)(uintptr_t)WORKSPACE;
  u32 samples, r9, r5, sl, r2, k1, k2, a, b;
  U32(CHANNEL_COUNT, 0) = flags << 4;
  samples = U32(RENDER_SAMPLES, 0);
  r9 = U32(RENDER_DELAY, 0);
  r5 = U32(RENDER_BUFFER, 0);
  sl = U32(RENDER_PREVIOUS, 0);
  U32(RENDER_PREVIOUS, 0) = r5;
  r2 = samples - r9;
  if (r9 == 0) {
    r2 = 0;
    r9 = samples;
  }
  sl += r2 << 1;
  U32(RENDER_LEFT, 0) = r2;
  k1 = U32(RENDER_K1, 0);
  k2 = U32(RENDER_K2, 0);
  a = ws[0];
  b = ws[1];
  a += half; /* the first pass always enters at the rounding add */
  b += half;
  for (;;) {
    u32 ip, r7, fp, na, nb;
    if (((a ^ (a << 1)) & lr) || ((b ^ (b << 1)) & lr)) {
      a = normalize_sample(a);
      b = normalize_sample(b);
      U32(RENDER_CLIPPED, 0) = lr;
    }
    ip = a + ((a & lr) >> 9);
    a = ip - half;
    ip = r8 & ror(ip, 15);
    r7 = r8 & ror(a, 15);
    ip = r7 | ip >> 8;
    fp = b + ((b & lr) >> 9);
    b = fp - half;
    fp = r8 & ror(fp, 15);
    r7 = r8 & ror(b, 15);
    r7 = r7 | fp >> 8;
    na = (u32)(s32)S8A(r5) * k1;
    nb = (u32)(s32)S8A(r5 + 2) * k1;
    na += k2 * (u32)(s32)S8A(r5 + r3);
    nb += k2 * (u32)(s32)S8A(r5 + r3 + 2);
    U16(r5 + r3 + 2, 0) = (u16)r7;
    U16(r5 + r3, 0) = (u16)ip;
    r7 = (r7 & 0xFFFF0000u) | ip >> 16;
    U32(r5, 0) = r7;
    r5 += 4;
    r7 &= r8;
    r7 += r7 >> 7;
    nb += (u32)asr(r7, 19);
    r7 = ror(r7, 16);
    na += (u32)asr(r7, 19);
    na += (u32)(s32)S8A(sl) << 21;
    sl += 2;
    nb += (u32)(s32)S8A(sl) << 21;
    sl += 2;
    ws[0] = na;
    ws[1] = nb;
    ws += 2;
    r9 -= 2;
    if ((s32)r9 <= 0) {
      u32 left = U32(RENDER_LEFT, 0);
      if ((s32)left <= 0)
        break;
      U32(RENDER_LEFT, 0) = r9;
      sl = U32(RENDER_PREVIOUS, 0);
      r9 = left;
    }
    a = ws[0];
    b = ws[1];
    if (round) {
      a += half;
      b += half;
    }
  }
}

/* SoundDriver_EnterVBlankUpdate (bound: port/tla/hw/bindings.tsv). The original returns 1 at once when the stack is
 * below 0x03007900 (not in the port) or the SoundInfo is locked; else it runs the sequencer and CGB callbacks, mixes
 * every PCM channel and returns 0, and its caller (System_WaitForFrameInterrupt) then calls IwramSoundRenderVBlank.
 * Here the render runs before returning, and 1 is returned so the caller does not call the render's translation
 * (nothing runs between the two in the original). The callbacks are C function pointers (wasm table indices) or GBA
 * addresses: Port_ResolveCode takes both. */
void *Port_ResolveCode(void *p);
u32 Port_TlaSoundEnterVBlank(void) {
  u32 si = SOUND_INFO(), samples, out, period, n, ch;
  if (si == 0 || U32(si, 0) != ID_NUMBER)
    return 1;
  if (U32(si, 32))
    ((Fn1)Port_ResolveCode((void *)(uintptr_t)U32(si, 32)))(U32(si, 36));
  if (U32(si, 40))
    ((Fn1)Port_ResolveCode((void *)(uintptr_t)U32(si, 40)))(si);
  samples = U32(si, 16);
  out = SOUND_BUFFER;
  period = U8(PERIOD, 1);
  if (period > 1)
    out += (samples << 1) * (U8(si, 11) - (period - 1));
  n = U8(si, 6);
  ch = si + 80;
  for (;;) {
    tla_mix_channel(ch);
    if ((s32)--n <= 0)
      break;
    ch += 64;
  }
  U32(RENDER_SAMPLES, 0) = samples;
  U32(RENDER_BUFFER, 0) = out;
  tla_render();
  return 1;
}
