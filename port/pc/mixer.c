/* Camelot's PCM mixer, hand-ported to C (D6, session GS-audio): Mixer_Enter (vendor src/sound/
 * channel_update_entry.s) and the resident IWRAM mixer it jumps to (resident_mixer.s, resident_mixer_interpolate.s,
 * resident_mixer_render.s, the reverb codes and resampler kernels of system/entry.s). Once a VBlank it runs the
 * sequencer (SoundInfo.func = MPlayMain chain) and the CGB update, then for each PCM channel: the envelope, then
 * 352 samples mixed into IwramSoundMixWorkspace (one word a sample: right volume x sample in the low half, left in
 * the high half), by one of
 *   - the fixed-rate block mixer (wave type bit 3),
 *   - the synth waves (type bit 6, or a sample count of 0): pulse with a sweeping duty, a filtered noise, triangle,
 *   - the interpolating resampler: three self-patched kernels (step < 1, < 2, >= 2) when the sample does not end in
 *     this VBlank, else the general loop that loops or ends the sample;
 * then the render: halves clipped (gSoundMixerClipped set), the bytes written to the two DirectSound buffers at
 * the DMA's current period, and the reverb code (one of five 38-instruction ARM blocks that the game copies into
 * IwramSoundReverbCode) seeding the workspace for the next VBlank from this mix and the old buffer bytes.
 * Every operation keeps the original's 32-bit arithmetic (wrap, arithmetic shifts, the kernels' flag tricks), so
 * tests/arm/diff.cjs compares it against the ROM's code byte for byte. Not kept: the original's DMA of sample data
 * onto its stack (a speed trick; the stack area below sp is scratch) and its writes into its own code (kernel
 * patches and their cache, saved registers): the diff ignores those areas. */
#include "gba.h"

#define U8(p, o) (*(volatile u8 *)((uintptr_t)(p) + (o)))
#define S8A(a) (*(volatile s8 *)(uintptr_t)(a))
#define U16(p, o) (*(volatile u16 *)((uintptr_t)(p) + (o)))
#define U32(p, o) (*(volatile u32 *)((uintptr_t)(p) + (o)))
#define SOUND_INFO() (*(volatile u32 *)(uintptr_t)0x03007FF0u)
#define ID_NUMBER 0x68736D53u

#define WORKSPACE 0x03000DF8u   /* IwramSoundMixWorkspace (352 words used) */
#define CLIPPED 0x03000B5Cu     /* gSoundMixerClipped */
#define REVERB_CODE 0x03000BD8u /* IwramSoundReverbCode: the loaded reverb code */
#define REVERB_CODES 0x08000404u /* IwramSoundReverbCodes: the five codes in ROM, 152 bytes each */
#define SAMPLES 352

typedef void (*Fn1)(u32);

static inline u32 ror(u32 x, int n) { return n ? (x >> n) | (x << (32 - n)) : x; }
static inline s32 asr(u32 x, int n) { return (s32)x >> n; }

/* ---------------- per-channel mixing ---------------- */

struct Mix {
  u32 ch;        /* r4 */
  u32 loopStart; /* [sp+12] */
  u32 loopLen;   /* [sp+16] */
};

/* the fixed-rate (block) mixer: one source byte a sample */
static void mix_block(struct Mix *m, u32 fp, u32 r2, u32 r3) {
  u32 *ws = (u32 *)(uintptr_t)WORKSPACE;
  int i;
  for (i = 0; i < SAMPLES; i++) {
    ws[i] += fp * (u32)(s32)S8A(r3);
    r3++;
    if (--r2 == 0) {
      if (m->loopLen) {
        r2 = m->loopLen;
        r3 = m->loopStart;
      } else {
        U8(m->ch, 0) = 0; /* the channel ends: count and pointer not saved */
        return;
      }
    }
  }
  U32(m->ch, 24) = r2;
  U32(m->ch, 40) = r3;
}

/* the synth waves; r3 points one byte into the wave data (after the first sample byte) */
static void mix_synth(struct Mix *m, u32 fp, u32 r2, u32 r3, u32 r7, u32 step, s32 mode) {
  u32 *ws = (u32 *)(uintptr_t)WORKSPACE;
  int i;
  if (mode == 0) { /* pulse: duty threshold swept by r2 */
    u32 r6, sl;
    r2 += (u32)U8(r3, 2) << 24;
    r6 = r2 + ((u32)U8(r3, 4) << 24);
    if ((s32)r6 < 0)
      r6 = ~r6;
    sl = r6 >> 8;
    r6 = sl * U8(r3, 3) + ((u32)U8(r3, 1) << 24);
    for (i = 0; i < SAMPLES; i++) {
      if (r7 < r6)
        ws[i] += fp << 6;
      else
        ws[i] -= fp << 6;
      r7 += step << 3;
    }
  } else if (mode == 1) { /* noise-like: a running filter over the phase's bits */
    fp = (fp >> 1) & ~0xFF00u;
    for (i = 0; i < SAMPLES; i++) {
      u32 r9;
      r7 += step << 3;
      r9 = (r7 >> 24) - 112;
      r9 -= (r7 << 1) >> 27;
      r2 = r9 + (u32)asr(r2, 1);
      ws[i] += fp * r2;
    }
  } else { /* triangle */
    for (i = 0; i < SAMPLES; i++) {
      u32 r9;
      r7 += step << 3;
      if ((s32)r7 >= 0)
        r9 = (u32)(asr(r7, 23) - 128);
      else
        r9 = 384 - (r7 >> 23);
      ws[i] += fp * r9;
    }
  }
  U32(m->ch, 28) = r7;
  U32(m->ch, 24) = r2;
  U32(m->ch, 40) = r3 - 1;
}

/* the interpolating resampler */
static void mix_interp(struct Mix *m, u32 fp, u32 r2, u32 r3) {
  u32 *ws = (u32 *)(uintptr_t)WORKSPACE;
  u32 r7 = U32(m->ch, 28), lr = U32(m->ch, 32);
  u32 r4 = U32(SOUND_INFO(), 24) * lr; /* divFreq x frequency */
  u32 r6 = (u32)(s32)S8A(r3), ip;
  u32 type = U8(m->ch, 1);
  u64 total;
  u32 r0;
  if (r2 == 0) {
    type |= 64;
    U8(m->ch, 1) = (u8)type;
  }
  r3++;
  ip = (u32)(s32)S8A(r3);
  if (type & 64) {
    mix_synth(m, fp, r2, r3, r7, r4, (s32)ip);
    return;
  }
  ip -= r6;
  /* fp halved with rounding, per half */
  {
    u32 c = fp & 1;
    fp = ((fp >> 1) + 32768 + c) & ~0xFF00u;
  }
  total = (u64)r7 + (u64)r4 * SAMPLES;
  r0 = (u32)(total >> 23);
  if ((s32)r2 > (s32)r0) {
    /* the kernels: the sample does not end in this VBlank */
    u32 rem = r2 - r0, end = r3 + r0;
    int kernel;
    u32 r9 = 0;
    int z = 0; /* Z flag before each conditional mul */
    int i;
    r4 -= 0x800000u;
    if ((s32)r4 >= 0) {
      fp <<= 1;
      r4 -= 0x800000u;
      if ((s32)r4 >= 0) {
        kernel = 2;
        r4 += 0x800000u;
      } else
        kernel = 1;
    } else
      kernel = 0;
    for (i = 0; i < SAMPLES; i++) {
      if ((i & 3) == 0 || !z) /* each group of four starts with mul, the rest with mulne */
        r9 = r7 * ip;
      if (kernel == 0) {
        r9 = (u32)asr(r9, 22);
        r9 += r6 << 1;
        if (r9)
          ws[i] += fp * r9;
        r7 += r4;
        if ((s32)r7 >= 0) {
          r6 = ip + r6;
          r3++;
          ip = (u32)(s32)S8A(r3);
          ip -= r6;
          z = ip == 0;
        } else
          z = r7 == 0;
      } else if (kernel == 1) {
        r9 = r6 + (u32)asr(r9, 23);
        if (r9)
          ws[i] += fp * r9;
        r6 = ip + r6;
        r7 += r4;
        if ((s32)r7 >= 0) {
          r3++;
          r6 = (u32)(s32)S8A(r3);
        }
        r3++;
        ip = (u32)(s32)S8A(r3);
        ip -= r6;
        z = ip == 0;
      } else {
        u32 adv;
        r9 = r6 + (u32)asr(r9, 23);
        if (r9)
          ws[i] += fp * r9;
        r7 += r4;
        adv = r7 >> 23;
        r3 += adv;
        r6 = (u32)(s32)S8A(r3);
        r3++;
        ip = (u32)(s32)S8A(r3);
        ip -= r6;
        z = ip == 0;
      }
      r7 &= ~0xFF800000u;
    }
    U32(m->ch, 28) = r7;
    U32(m->ch, 24) = rem;
    U32(m->ch, 40) = end - 1;
    return;
  }
  /* the general loop: the sample loops or ends in this VBlank */
  {
    int n = SAMPLES, i = 0;
    while (n > 0) {
      u32 r9 = r7 * ip;
      r9 = (u32)asr(r9, 22);
      r9 += r6 << 1;
      if (r9)
        ws[i] += fp * r9;
      r7 += r4;
      r9 = r7 >> 23;
      if (r9) {
        r2 -= r7 >> 23;
        if ((s32)r2 <= 0) {
          /* refill: loop, or end the channel */
          if (m->loopLen) {
            r9 = (u32)-(s32)r2;
            r2 = m->loopLen + r2;
            r3 = m->loopStart;
            r3 += r9;
            r6 = (u32)(s32)S8A(r3);
          } else {
            U8(m->ch, 0) = 0;
            return;
          }
        } else {
          r9 -= 1;
          if (r9 == 0)
            r6 = ip + r6;
          else {
            r3 += r9;
            r6 = (u32)(s32)S8A(r3);
          }
        }
        r3++;
        ip = (u32)(s32)S8A(r3);
        ip -= r6;
        r7 &= ~0x3F800000u;
      }
      n--;
      i++;
    }
    U32(m->ch, 28) = r7;
    U32(m->ch, 24) = r2;
    U32(m->ch, 40) = r3 - 1;
  }
}

/* IwramSoundMixEntry: one channel's envelope, then its mix */
static void mix_channel(u32 ch) {
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
  if (st & 0x40) { /* release */
    r5 = (r5 * U8(ch, 7)) >> 8;
    if (r5 > U8(ch, 12))
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
  {
    u32 sl = (U8(ch, 2) * r5) >> 9, fpv = (U8(ch, 3) * r5) >> 9, fp;
    if (st & 16) {
      u32 ls = U32(wav, 8), size = U32(wav, 12);
      m.loopStart = wav + 16 + ls;
      m.loopLen = size - ls;
    }
    fp = sl | fpv << 16;
    if (U8(ch, 1) & 8)
      mix_block(&m, fp, U32(ch, 24), U32(ch, 40));
    else
      mix_interp(&m, fp, U32(ch, 24), U32(ch, 40));
  }
}

/* ---------------- render and reverb ---------------- */

static u32 normalize_sample(u32 r6) {
  u32 r7 = ror(r6, 16);
  if ((r7 ^ (r7 << 1)) & 0x80000000u) { /* adds r7, r7, r7 overflowed: bit 15 != bit 14 */
    int mi = (r7 << 1) >> 31;
    r6 |= 16384;
    r6 &= ~16320u;
    if (mi)
      r6 -= 64;
  }
  if ((r6 ^ (r6 << 1)) & 0x80000000u) {
    int mi = (r6 << 1) >> 31;
    r6 |= 0x40000000u;
    r6 &= ~0x3FC00000u;
    if (mi)
      r6 -= 0x400000u;
  }
  return r6;
}

static int reverb_index(void) {
  int i, k;
  for (i = 0; i < 5; i++) {
    const u32 *a = (const u32 *)(uintptr_t)REVERB_CODE, *b = (const u32 *)(uintptr_t)(REVERB_CODES + 152 * i);
    for (k = 0; k < 38 && a[k] == b[k]; k++)
      ;
    if (k == 38)
      return i;
  }
  return 2; /* the code assembled in place (resident_mixer_render.s) is code 2 */
}

/* one word of codes 2/3: acc = the mixed word, fp/ip = the old buffer words (already rotated) */
static u32 rv23(u32 acc, u32 fp, u32 ip, int sa, int sb, u32 k) {
  u32 r6 = (u32)asr(acc, sa) + (u32)asr(fp, sb), r7;
  if ((s32)r6 < 0)
    r6 += k;
  acc = ror(acc, 16);
  r7 = (u32)asr(acc, sa) + (u32)asr(ip, sb);
  if ((s32)r7 < 0)
    r7 += k;
  return r7 + (r6 << 16);
}

static u32 rv0(u32 fp, u32 ip) {
  u32 r1 = (u32)asr(fp, 20);
  if ((s32)r1 >= 0)
    r1 &= ~31u;
  r1 += (u32)asr(ip, 20);
  if ((s32)r1 < 0)
    r1 += 32;
  r1 += (u32)asr(r1, 1);
  return r1 + (r1 << 16);
}

static u32 rv1(u32 fp, u32 ip) {
  u32 r7 = (u32)asr(fp, 19) + (u32)asr(ip, 20), r6;
  if ((s32)r7 < 0)
    r7 += 48;
  r6 = (u32)asr(ip, 19) + (u32)asr(fp, 20);
  if ((s32)r6 < 0)
    r6 += 48;
  return r7 + (r6 << 16);
}

static void render(u32 out) {
  u32 *ws = (u32 *)(uintptr_t)WORKSPACE;
  int code = reverb_index(), i;
  for (i = 0; i < SAMPLES; i += 4) {
    u32 r1 = ws[i], r2 = ws[i + 1], r3 = ws[i + 2], r4 = ws[i + 3];
    u32 r6, r7, fp, ip;
    const u32 lr = 0x80008000u, r8 = 0xFF00FF00u;
    if (((r1 ^ (r1 << 1)) & lr) || ((r2 ^ (r2 << 1)) & lr) || ((r3 ^ (r3 << 1)) & lr) ||
        ((r4 ^ (r4 << 1)) & lr)) {
      r1 = normalize_sample(r1);
      r2 = normalize_sample(r2);
      r3 = normalize_sample(r3);
      r4 = normalize_sample(r4);
      *(volatile u32 *)(uintptr_t)CLIPPED = 0x80008000u;
    }
    r6 = r8 & ror(r1, 15);
    r7 = r8 & ror(r2, 15);
    r6 = r7 | r6 >> 8;
    fp = r8 & ror(r3, 15);
    r7 = r8 & ror(r4, 15);
    r7 = r7 | fp >> 8;
    fp = (r6 & 0xFFFFu) | r7 << 16;
    r7 = (r7 & 0xFFFF0000u) | r6 >> 16;
    ip = U32(out, 1584);
    U32(out, 1584) = fp;
    fp = U32(out, 0);
    U32(out, 0) = r7;
    out += 4;
    switch (code) {
    case 0:
      r4 = rv0(fp, ip);
      fp = ror(fp, 16), ip = ror(ip, 16);
      r2 = rv0(fp, ip);
      fp = ror(fp, 8), ip = ror(ip, 8);
      r3 = rv0(fp, ip);
      fp = ror(fp, 16), ip = ror(ip, 16);
      r1 = rv0(fp, ip);
      break;
    case 1:
      r4 = rv1(fp, ip);
      fp = ror(fp, 16), ip = ror(ip, 16);
      r2 = rv1(fp, ip);
      fp = ror(fp, 8), ip = ror(ip, 8);
      r3 = rv1(fp, ip);
      fp = ror(fp, 16), ip = ror(ip, 16);
      r1 = rv1(fp, ip);
      break;
    case 2:
    case 3: {
      int sa = code == 2 ? 18 : 19, sb = code == 2 ? 19 : 18;
      u32 k = code == 2 ? 40 : 72;
      r4 = rv23(r4, fp, ip, sa, sb, k);
      fp = ror(fp, 16), ip = ror(ip, 16);
      r2 = rv23(r2, fp, ip, sa, sb, k);
      fp = ror(fp, 8), ip = ror(ip, 8);
      r3 = rv23(r3, fp, ip, sa, sb, k);
      fp = ror(fp, 16), ip = ror(ip, 16);
      r1 = rv23(r1, fp, ip, sa, sb, k);
      break;
    }
    default:
      r1 = r2 = r3 = r4 = 0;
      break;
    }
    ws[i] = r1;
    ws[i + 1] = r2;
    ws[i + 2] = r3;
    ws[i + 3] = r4;
  }
}

/* Mixer_Run: sequencer and CGB callbacks, every PCM channel, the render */
static void mixer_run(u32 si) {
  u32 out, n, ch;
  s32 r7;
  if (U32(si, 32))
    ((Fn1)(uintptr_t)U32(si, 32))(U32(si, 36));
  ((Fn1)(uintptr_t)U32(si, 40))(si);
  out = si + 0x350;
  r7 = (s32)U8(si, 4) - 1;
  if (r7 > 0)
    out += (U8(si, 11) - (u32)r7) * U32(si, 16);
  n = U8(si, 6);
  ch = si + 80;
  for (;;) {
    mix_channel(ch);
    if ((s32)--n <= 0)
      break;
    ch += 64;
  }
  render(out);
}

void Mixer_Enter(void) {
  u32 si = SOUND_INFO();
  if (U32(si, 0) != ID_NUMBER)
    return;
  mixer_run(si);
}

/* SoundMain: the library's entry (unused by the game: m4aSoundMain is reached through nothing); it locks the
 * ident like the original and mixes with the game's own mixer, since SoundMainRAM (the library mixer copied to
 * 0x03007000) is not ported. */
void SoundMain(void) {
  u32 si = SOUND_INFO();
  if (U32(si, 0) != ID_NUMBER)
    return;
  U32(si, 0) = ID_NUMBER + 1;
  mixer_run(si);
  U32(si, 0) = ID_NUMBER;
}

/* The library mixer's ROM copy (m4aSoundInit copies it to 0x03007000 with CpuSet): no code to copy in this port;
 * bios.c's CpuSet skips a source that is a wasm function. */
void SoundMainRAM_Rom(void) {}
