/* The GBA hardware the game drives, as the PC layer (G3): DMA, timers, interrupts, keypad and the frame driver
 * (orchestrator D8). The game's registers are plain memory at 0x04000000 (identity map, D5); what hardware does
 * on its own happens here:
 *   - DMA: Dma_Set (port_dma.h) calls Port_DmaWritten after writing a channel; immediate transfers run at once,
 *     VBlank/HBlank ones at those events (also when enabled by direct register writes), sound FIFO ones are
 *     ignored (silent audio in G3). A copy whose source is a function start registers its destination as an
 *     alias of that function (codemap.c), which is how RAM copies of ARM routines run our C ports.
 *   - Time only passes while the game halts (swi 2 in wait(): Port_BiosHalt). The halt runs the display line by
 *     line: renders visible lines (ppu.c), raises HBlank/VCount/VBlank (and timer, keypad) interrupts and
 *     dispatches them like the vendor's IwramIrqMain (same priority order, handlers from gIrqHandlers), runs
 *     HBlank/VBlank DMA, and returns once an interrupt has been handled.
 *   - At line 160 the frame is complete: port_frame_ready() hands it to the host (page or node runner), which
 *     may suspend the game there (ASYNCIFY) until the next display refresh. */
#include <stdio.h>

#include "gba.h"

void Port_PpuLine(int line);
void Port_PpuVBlank(void);
void *Port_ResolveCode(void *p);
void *Port_CodeAt(u32 gba);
void Port_CodeAlias(u32 to, u32 from);
u32 Port_CodeGbaOf(u32 fn);
void Port_CodeUnalias(u32 to, u32 bytes);
void port_frame_ready(void); /* JS library (port/web/port_lib.js) */

extern void *gIrqHandlers[14];

#define CYCLES_PER_LINE 1232

static int line;      /* the line being drawn (VCOUNT) */
static int phase;     /* 0: drawing `line`, next event its HBlank; 1: in HBlank, next event the next line */
static u32 irqFlags;  /* IF: kept here, mirrored to the register for readers */
static u16 keysDown;  /* KEY_* bits held (1 = pressed), set by the host */
static u32 frames;
static int halted;    /* inside Port_BiosHalt (interrupt handlers run only there) */

/* ---------------- DMA ---------------- */

struct DmaState {
  int latched;
  u32 src, dst, count;
};
static struct DmaState dma[4];

static u32 dma_reg(int ch, int word) { return IO32(R_DMA0SAD + 12 * ch + 4 * word); }

static void dma_latch(int ch) {
  u32 ctl = dma_reg(ch, 2);
  u32 count = ctl & 0xFFFF;
  dma[ch].src = dma_reg(ch, 0) & (ch == 0 ? 0x07FFFFFFu : 0x0FFFFFFFu);
  dma[ch].dst = dma_reg(ch, 1) & (ch == 3 ? 0x0FFFFFFFu : 0x07FFFFFFu);
  dma[ch].count = count ? count : (ch == 3 ? 0x10000u : 0x4000u);
  dma[ch].latched = 1;
}

static void dma_run(int ch) {
  u32 ctl = dma_reg(ch, 2) >> 16;
  int word = (ctl >> 10) & 1;
  u32 unit = word ? 4 : 2;
  int dctl = (ctl >> 5) & 3, sctl = (ctl >> 7) & 3;
  s32 dstep = dctl == 0 || dctl == 3 ? (s32)unit : dctl == 1 ? -(s32)unit : 0;
  s32 sstep = sctl == 0 ? (s32)unit : sctl == 1 ? -(s32)unit : 0;
  u32 s = dma[ch].src & ~(unit - 1), d = dma[ch].dst & ~(unit - 1), n = dma[ch].count;
  u32 src0, dst0 = d;
  if (((ctl >> 12) & 3) == 0 && dctl == 0 && sctl == 0 && dma[ch].src < 0x10000u) {
    /* the source is a wasm function pointer (a vendor C routine copied to RAM to run): copy the ROM's bytes
     * of that function instead, as the game does, and alias the copy */
    u32 gba = Port_CodeGbaOf(dma[ch].src);
    if (gba)
      s = gba & ~(unit - 1);
  }
  src0 = s;
  if (((ctl >> 12) & 3) == 0 && dctl == 0) {
    Port_CodeUnalias(dst0, n * unit);
    if (sctl == 0 && Port_CodeAt(src0))
      Port_CodeAlias(dst0, src0);
  }
  while (n--) {
    if (word)
      *(volatile u32 *)(uintptr_t)d = *(volatile u32 *)(uintptr_t)s;
    else
      *(volatile u16 *)(uintptr_t)d = *(volatile u16 *)(uintptr_t)s;
    s += sstep;
    d += dstep;
  }
  dma[ch].src = s;
  dma[ch].dst = d;
  if ((ctl >> 14) & 1)
    irqFlags |= 1u << (8 + ch);
  if (((ctl >> 9) & 1) && ((ctl >> 12) & 3) != 0) { /* repeat: reload the count (and the destination) */
    u32 count = dma_reg(ch, 2) & 0xFFFF;
    dma[ch].count = count ? count : (ch == 3 ? 0x10000u : 0x4000u);
    if (dctl == 3)
      dma[ch].dst = dma_reg(ch, 1);
  } else {
    *(volatile u16 *)(uintptr_t)(IO_BASE + R_DMA0SAD + 12 * ch + 10) &= 0x7FFF;
    dma[ch].latched = 0;
  }
}

/* Runs the enabled DMAs with start timing `timing` (0 immediate, 1 VBlank, 2 HBlank). */
static void dma_event(int timing) {
  int ch;
  for (ch = 0; ch < 4; ch++) {
    u32 ctl = dma_reg(ch, 2) >> 16;
    if (!(ctl & 0x8000)) {
      dma[ch].latched = 0;
      continue;
    }
    if (((ctl >> 12) & 3) != (u32)timing)
      continue;
    if (!dma[ch].latched)
      dma_latch(ch);
    dma_run(ch);
  }
}

/* Dma_Set wrote the three registers of a channel. */
void Port_DmaWritten(volatile u32 *channel) {
  int ch = (int)(((uintptr_t)channel - (IO_BASE + R_DMA0SAD)) / 12);
  u32 ctl;
  if (ch < 0 || ch > 3)
    return;
  ctl = channel[2] >> 16;
  if (!(ctl & 0x8000)) {
    dma[ch].latched = 0;
    return;
  }
  dma_latch(ch);
  if (((ctl >> 12) & 3) == 0)
    dma_run(ch);
}

/* ---------------- timers ---------------- */

struct TimerState {
  int on;
  u32 counter; /* 16.16: counts in 1/65536 ticks to keep prescaled time exact */
  u32 frac;
};
static struct TimerState timers[4];

static void timers_step(u32 cycles) {
  int t;
  int overflowPrev = 0;
  for (t = 0; t < 4; t++) {
    u16 cnt = IO16(R_TM0CNT_L + 4 * t + 2);
    u32 overflows = 0;
    if (!(cnt & 0x80)) {
      timers[t].on = 0;
      overflowPrev = 0;
      continue;
    }
    if (!timers[t].on) { /* started: load the reload value */
      timers[t].on = 1;
      timers[t].counter = IO16(R_TM0CNT_L + 4 * t);
      timers[t].frac = 0;
    }
    if (t > 0 && (cnt & 4)) { /* cascade */
      timers[t].counter += overflowPrev;
    } else {
      static const u32 shift[4] = {0, 6, 8, 10};
      u32 ticks;
      timers[t].frac += cycles;
      ticks = timers[t].frac >> shift[cnt & 3];
      timers[t].frac -= ticks << shift[cnt & 3];
      timers[t].counter += ticks;
    }
    while (timers[t].counter > 0xFFFF) {
      u32 reload = IO16(R_TM0CNT_L + 4 * t);
      timers[t].counter = timers[t].counter - 0x10000 + reload;
      overflows++;
      if (overflows > 0x10000)
        break;
    }
    if (overflows && (cnt & 0x40))
      irqFlags |= 1u << (3 + t);
    overflowPrev = (int)overflows;
  }
}

/* ---------------- interrupts ---------------- */

/* IwramIrqMain's order: HBlank, VBlank, VCount, Timer3, Serial, Timer1, Timer2, Keypad, GamePak */
static const u8 IRQ_ORDER[] = {1, 0, 2, 6, 7, 4, 5, 12, 13};

static int dispatch(void) {
  int handled = 0;
  for (;;) {
    u32 pending, i;
    int bit = -1;
    IO16(R_IF) = (u16)irqFlags;
    if (!(IO16(R_IME) & 1))
      break;
    pending = IO16(R_IE) & irqFlags;
    for (i = 0; i < sizeof IRQ_ORDER; i++)
      if (pending & (1u << IRQ_ORDER[i])) {
        bit = IRQ_ORDER[i];
        break;
      }
    if (bit < 0)
      break;
    irqFlags &= ~(1u << bit);
    IO16(R_IF) = (u16)irqFlags;
    {
      void (*handler)(void) = (void (*)(void))Port_ResolveCode(gIrqHandlers[bit]);
      handler();
    }
    handled = 1;
  }
  return handled;
}

/* ---------------- keypad ---------------- */

void Port_SetKeys(u32 keys) { keysDown = (u16)(keys & 0x3FF); }

static void keypad(void) {
  u16 cnt = IO16(R_KEYCNT);
  IO16(R_KEYINPUT) = (u16)(~keysDown & 0x3FF);
  if (cnt & 0x4000) {
    u16 want = cnt & 0x3FF;
    int hit = (cnt & 0x8000) ? (want && (keysDown & want) == want) : (keysDown & want) != 0;
    if (hit)
      irqFlags |= 1u << 12;
  }
}

/* ---------------- the display's time line ---------------- */

static void set_vcount(void) {
  u16 stat = IO16(R_DISPSTAT);
  int match = line == (stat >> 8);
  IO16(R_VCOUNT) = (u16)line;
  stat = (u16)((stat & ~7u) | (line >= 160 && line < 227 ? 1 : 0) | (match ? 4 : 0));
  IO16(R_DISPSTAT) = stat;
  if (match && (stat & 0x20))
    irqFlags |= 1u << 2;
}

/* One display event: the HBlank of `line`, or the start of the next line. */
static void step(void) {
  if (phase == 0) {
    if (line < 160)
      Port_PpuLine(line);
    IO16(R_DISPSTAT) |= 2;
    if (IO16(R_DISPSTAT) & 0x10)
      irqFlags |= 1u << 1;
    if (line < 160)
      dma_event(2);
    timers_step(960);
    phase = 1;
    return;
  }
  IO16(R_DISPSTAT) &= ~2u;
  timers_step(CYCLES_PER_LINE - 960);
  line = line == 227 ? 0 : line + 1;
  phase = 0;
  set_vcount();
  if (line == 160) {
    frames++;
    port_frame_ready(); /* the host shows the frame; the page may suspend the game here until the next one */
    keypad();
    if (IO16(R_DISPSTAT) & 8)
      irqFlags |= 1u;
    dma_event(1);
    Port_PpuVBlank();
  }
}

/* swi 2 (Halt): runs the display until an interrupt has been handled. With no interrupt enabled the game would
 * sleep forever; after two frames of nothing it gets control back (reported once). */
void Port_BiosHalt(void) {
  int guard = 0;
  static int warned;
  halted = 1;
  dma_event(0); /* immediate transfers enabled by direct register writes */
  for (;;) {
    step();
    if (dispatch())
      break;
    if (++guard > 228 * 2 * 2) {
      if (!warned++)
        printf("Port_BiosHalt: no interrupt for two frames (IE %04x IME %d)\n", IO16(R_IE), IO16(R_IME) & 1);
      break;
    }
  }
  halted = 0;
}

/* A read of VCOUNT in a busy-wait (port/c_rules.tsv): the display moves on one event, interrupts included. */
u32 Port_ReadVCount(void) {
  step();
  dispatch();
  return (u32)line;
}

/* swi 3 (Stop, sleep mode): the page has no sleep; return at once as if woken. */
void Port_BiosStop(void) {}

/* wait() keeps the GBA stack shallow by copying it aside below a fixed top (Ram_FrameWaitStackTop): report sp
 * at that top, so it never copies (wasm's stack is elsewhere). */
void *Port_FrameWaitStackTop(void) { return (void *)(uintptr_t)0x03007A00u; }

u32 Port_FrameCount(void) { return frames; }
int Port_Line(void) { return line; }

/* Power-on state of the registers the layer reads */
void Port_FlashReset(void);

void Port_HwReset(void) {
  int i;
  Port_FlashReset();
  line = 0;
  phase = 0;
  irqFlags = 0;
  for (i = 0; i < 4; i++) {
    dma[i].latched = 0;
    timers[i].on = 0;
  }
  IO16(R_KEYINPUT) = 0x3FF;
  IO16(R_VCOUNT) = 0;
  IO16(R_DISPSTAT) = 0;
}
