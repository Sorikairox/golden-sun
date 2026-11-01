/* The GBA's sound output as the PC layer (D10, session GS-audio): DirectSound FIFOs A and B (fed by the sound
 * DMAs, hw.c Port_DmaSoundFifo, popped on their timer's overflow), the four PSG channels (two squares with
 * envelope/length/sweep, wave, noise) from their registers, mixed with SOUNDCNT_L/H/X into stereo 16-bit samples
 * at a fixed 32768 Hz (one sample every 512 cycles), into a ring the host drains (Port_AudioRead). Register writes
 * are plain memory stores in this port, so a channel's trigger (bit 7 of NRx4) and the FIFO resets (SOUNDCNT_H
 * bits 11, 15) are polled and cleared here; the game's m4a driver writes the trigger with the new settings. */
#include "gba.h"

#define REG8(o) (*(volatile u8 *)(uintptr_t)(IO_BASE + (o)))
#define CYCLES_PER_SAMPLE 512
#define RING 16384 /* stereo frames */
#define CPU_HZ 16777216u

void Port_DmaSoundFifo(int ch); /* hw.c */

/* ---------------- DirectSound ---------------- */

static struct {
  s8 data[32];
  int head, count;
  s8 dac;
} fifo[2];

void Port_ApuFifoWrite(int which, u32 word) {
  int i;
  for (i = 0; i < 4; i++) {
    if (fifo[which].count < 32) {
      fifo[which].data[(fifo[which].head + fifo[which].count) & 31] = (s8)(word >> (8 * i));
      fifo[which].count++;
    }
  }
}

static void fifo_resets(void) {
  u16 h = IO16(0x082);
  if (h & 0x0800) {
    fifo[0].count = 0;
    h &= ~0x0800;
  }
  if (h & 0x8000) {
    fifo[1].count = 0;
    h &= ~0x8000;
  }
  IO16(0x082) = h;
}

/* the DMA channel feeding FIFO `which` (destination FIFO_A 0x040000A0 / FIFO_B 0x040000A4, start timing 3) */
static int fifo_dma(int which) {
  int ch;
  for (ch = 1; ch <= 2; ch++) {
    u32 dad = IO32(0x0B0 + 12 * ch + 4) & 0x0FFFFFFF;
    u16 cnt = IO16(0x0B0 + 12 * ch + 10);
    if ((cnt & 0x8000) && ((cnt >> 12) & 3) == 3 && dad == 0x040000A0u + 4u * (u32)which)
      return ch;
  }
  return 0;
}

/* Timer `t` overflowed `n` times: each FIFO on that timer plays its next sample; at 16 bytes or less its DMA
 * refills it. */
void Port_ApuTimerOverflow(int t, u32 n) {
  u16 h;
  int w;
  if (t > 1 || !n)
    return;
  fifo_resets();
  h = IO16(0x082);
  for (w = 0; w < 2; w++) {
    u32 k;
    if (((h >> (10 + 4 * w)) & 1) != (u32)t)
      continue;
    for (k = 0; k < n && k < 64; k++) {
      if (fifo[w].count) {
        fifo[w].dac = fifo[w].data[fifo[w].head];
        fifo[w].head = (fifo[w].head + 1) & 31;
        fifo[w].count--;
      }
      if (fifo[w].count <= 16) {
        int ch = fifo_dma(w);
        if (ch)
          Port_DmaSoundFifo(ch);
      }
    }
  }
}

/* ---------------- PSG ---------------- */

struct Psg {
  int on;
  u32 timer;   /* cycles to the next step */
  u32 pos;     /* duty step / wave sample */
  int vol, envDir, envPeriod, envTimer;
  int length;  /* 1/256 s ticks left, when enabled */
  int sweepTimer, sweepFreq;
  u16 lfsr;
};
static struct Psg psg[4];
static u8 waveRam[32]; /* 64 four-bit samples (two banks) snapshotted at trigger */
static u32 frameSeqCycles;
static int frameSeqStep;

static u32 sq_freq(int c) { return (IO16(c ? 0x06C : 0x064) & 0x7FF); }

static void trigger(int c) {
  struct Psg *p = &psg[c];
  static const u8 envReg[4] = {0x63, 0x69, 0, 0x79};
  p->on = 1;
  p->pos = 0;
  p->timer = 0;
  if (c != 2) {
    u8 e = REG8(envReg[c]);
    p->vol = e >> 4;
    p->envDir = (e >> 3) & 1;
    p->envPeriod = e & 7;
    p->envTimer = p->envPeriod;
    if (!(e & 0xF8))
      p->on = 0; /* DAC off */
  }
  if (c == 0) {
    p->sweepFreq = (int)sq_freq(0);
    p->sweepTimer = (REG8(0x60) >> 4) & 7;
  }
  if (c == 2) {
    int i;
    for (i = 0; i < 16; i++)
      waveRam[i] = waveRam[16 + i] = REG8(0x90 + i);
    if (!(REG8(0x70) & 0x80))
      p->on = 0;
  }
  if (c == 3)
    p->lfsr = 0x7FFF;
  {
    static const u8 lenReg[4] = {0x62, 0x68, 0x72, 0x78};
    u8 l = REG8(lenReg[c]);
    p->length = c == 2 ? 256 - l : 64 - (l & 63);
  }
}

static void poll_triggers(void) {
  static const u8 ctl[4] = {0x65, 0x6D, 0x75, 0x7D};
  int c;
  for (c = 0; c < 4; c++) {
    u8 v = REG8(ctl[c]);
    if (v & 0x80) {
      REG8(ctl[c]) = v & 0x7F;
      trigger(c);
    }
  }
  if (!(REG8(0x70) & 0x80))
    psg[2].on = 0;
}

/* 512 Hz frame sequencer: length at 256 Hz, sweep at 128 Hz, envelopes at 64 Hz */
static void frame_sequencer(void) {
  static const u8 ctl[4] = {0x65, 0x6D, 0x75, 0x7D};
  int c, s = frameSeqStep++ & 7;
  if (!(s & 1)) {
    for (c = 0; c < 4; c++)
      if (psg[c].on && (REG8(ctl[c]) & 0x40) && psg[c].length > 0 && --psg[c].length == 0)
        psg[c].on = 0;
  }
  if (s == 2 || s == 6) {
    u8 sw = REG8(0x60);
    int period = (sw >> 4) & 7, shift = sw & 7;
    if (psg[0].on && period && --psg[0].sweepTimer <= 0) {
      int f = psg[0].sweepFreq, d = f >> shift;
      psg[0].sweepTimer = period;
      if (shift) {
        f = (sw & 8) ? f - d : f + d;
        if (f > 2047)
          psg[0].on = 0;
        else if (f >= 0) {
          psg[0].sweepFreq = f;
          IO16(0x064) = (u16)((IO16(0x064) & ~0x7FF) | f);
        }
      }
    }
  }
  if (s == 7) {
    for (c = 0; c < 4; c++) {
      struct Psg *p = &psg[c];
      if (c == 2 || !p->envPeriod)
        continue;
      if (--p->envTimer <= 0) {
        p->envTimer = p->envPeriod;
        if (p->envDir && p->vol < 15)
          p->vol++;
        else if (!p->envDir && p->vol > 0)
          p->vol--;
      }
    }
  }
}

/* advance channel c by `cycles` and return its output (-15..15) */
static int psg_out(int c, u32 cycles) {
  struct Psg *p = &psg[c];
  if (!p->on)
    return 0;
  if (c < 2) {
    static const u8 duty[4] = {0x01, 0x81, 0x87, 0x7E};
    u32 period = (2048 - sq_freq(c)) * 4, d = (REG8(c ? 0x68 : 0x62) >> 6) & 3;
    while (cycles >= p->timer) {
      cycles -= p->timer;
      p->timer = period;
      p->pos = (p->pos + 1) & 7;
    }
    p->timer -= cycles;
    return ((duty[d] >> p->pos) & 1) ? p->vol : -p->vol;
  }
  if (c == 2) {
    u32 period = (2048 - (IO16(0x074) & 0x7FF)) * 2, n = (REG8(0x70) & 0x20) ? 64 : 32;
    u8 v32 = REG8(0x73);
    int s, bank = (REG8(0x70) & 0x20) ? 0 : 0;
    (void)bank;
    while (cycles >= p->timer) {
      cycles -= p->timer;
      p->timer = period;
      p->pos = (p->pos + 1) % n;
    }
    p->timer -= cycles;
    s = waveRam[p->pos >> 1];
    s = (p->pos & 1) ? s & 15 : s >> 4;
    s = s * 2 - 15;
    if (v32 & 0x80)
      return s * 3 / 4;
    switch ((v32 >> 5) & 3) {
    case 0: return 0;
    case 1: return s;
    case 2: return s / 2;
    default: return s / 4;
    }
  }
  {
    u8 nr43 = REG8(0x7C);
    u32 r = nr43 & 7, sh = nr43 >> 4;
    u32 period = (r ? r * 16 : 8) << sh;
    if (sh >= 14)
      return 0;
    while (cycles >= p->timer) {
      u16 bit;
      cycles -= p->timer;
      p->timer = period;
      bit = (p->lfsr ^ (p->lfsr >> 1)) & 1;
      p->lfsr = (u16)((p->lfsr >> 1) | (bit << 14));
      if (nr43 & 8)
        p->lfsr = (u16)((p->lfsr & ~0x40u) | (bit << 6));
    }
    p->timer -= cycles;
    return (p->lfsr & 1) ? -p->vol : p->vol;
  }
}

/* ---------------- output ---------------- */

static s16 ring[RING * 2];
static u32 ringHead, ringCount, dropped;
static u32 cycleAcc;
static u32 nonzero;

static void emit(void) {
  s32 l = 0, r = 0;
  u16 x = IO16(0x084), h = IO16(0x082), lo = IO16(0x080);
  int c;
  int outs[4];
  for (c = 0; c < 4; c++)
    outs[c] = psg_out(c, CYCLES_PER_SAMPLE);
  if (x & 0x80) {
    s32 pl = 0, pr = 0;
    for (c = 0; c < 4; c++) {
      if (lo & (0x1000 << c))
        pl += outs[c];
      if (lo & (0x0100 << c))
        pr += outs[c];
    }
    pl *= ((lo >> 4) & 7) + 1;
    pr *= (lo & 7) + 1;
    switch (h & 3) {
    case 0: pl >>= 2, pr >>= 2; break;
    case 1: pl >>= 1, pr >>= 1; break;
    default: break;
    }
    l = pl, r = pr;
    {
      s32 a = fifo[0].dac * ((h & 4) ? 4 : 2), b = fifo[1].dac * ((h & 8) ? 4 : 2);
      if (h & 0x0100) r += a;
      if (h & 0x0200) l += a;
      if (h & 0x1000) r += b;
      if (h & 0x2000) l += b;
    }
    if (l > 511) l = 511;
    if (l < -512) l = -512;
    if (r > 511) r = 511;
    if (r < -512) r = -512;
  }
  if (l || r)
    nonzero++;
  if (ringCount == RING) { /* nobody drains: drop the oldest */
    ringHead = (ringHead + 1) % RING;
    ringCount--;
    dropped++;
  }
  {
    u32 i = (ringHead + ringCount) % RING;
    ring[2 * i] = (s16)(l * 64);
    ring[2 * i + 1] = (s16)(r * 64);
    ringCount++;
  }
}

/* hw.c: `cycles` of CPU time passed */
void Port_ApuRun(u32 cycles) {
  poll_triggers();
  cycleAcc += cycles;
  while (cycleAcc >= CYCLES_PER_SAMPLE) {
    cycleAcc -= CYCLES_PER_SAMPLE;
    frameSeqCycles += CYCLES_PER_SAMPLE;
    if (frameSeqCycles >= CPU_HZ / 512) {
      frameSeqCycles -= CPU_HZ / 512;
      frame_sequencer();
    }
    emit();
  }
}

/* ---------------- host API ---------------- */

u32 Port_AudioRate(void) { return CPU_HZ / CYCLES_PER_SAMPLE; }
u32 Port_AudioAvailable(void) { return ringCount; }
u32 Port_AudioNonZero(void) { return nonzero; }
u32 Port_AudioDropped(void) { return dropped; }

/* Copies up to `max` stereo frames (interleaved s16) to `dst`; returns the number copied. */
u32 Port_AudioRead(s16 *dst, u32 max) {
  u32 n = 0;
  while (n < max && ringCount) {
    dst[2 * n] = ring[2 * ringHead];
    dst[2 * n + 1] = ring[2 * ringHead + 1];
    ringHead = (ringHead + 1) % RING;
    ringCount--;
    n++;
  }
  return n;
}

void Port_ApuReset(void) {
  int i;
  for (i = 0; i < 2; i++)
    fifo[i].count = fifo[i].head = fifo[i].dac = 0;
  for (i = 0; i < 4; i++)
    psg[i].on = 0;
  ringHead = ringCount = cycleAcc = frameSeqCycles = 0;
  frameSeqStep = 0;
}

/* A buffer for hosts without malloc: Port_AudioDrain() fills Port_AudioBuffer() with up to 4096 frames. */
static s16 hostBuf[4096 * 2];
s16 *Port_AudioBuffer(void) { return hostBuf; }
u32 Port_AudioDrain(void) { return Port_AudioRead(hostBuf, 4096); }
