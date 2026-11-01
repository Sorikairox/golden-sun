/* Scanline renderer v1 (orchestrator D9, G3): written from GBATEK. Modes 0-2: text BGs (4bpp/8bpp, flips, all
 * four sizes), affine BGs (wrap or transparent outside, internal reference points latched at VBlank, advanced
 * per line by PB/PD and reloaded when the game rewrites BGxX/Y), sprites (normal and affine incl. double size,
 * 1D/2D tile mapping, 4bpp/8bpp, semi-transparent, OBJ window), windows 0/1/OBJ, blending (alpha, brighten,
 * darken, semi-transparent sprites), forced blank, backdrop. Not yet: mosaic, modes 3-5 (unused by the
 * title). Output: 240x160 RGBA8 in gPortFrame, read by the page. Called once per visible line by the frame
 * driver (hw.c) with the registers as they are at that line. */
#include <string.h>

#include "gba.h"

#define W 240
#define H 160

u32 gPortFrame[W * H]; /* RGBA8, little endian: 0xAABBGGRR */

static u16 *const PAL = (u16 *)(uintptr_t)PALETTE_BASE;
static u8 *const VRAM = (u8 *)(uintptr_t)VRAM_BASE;
static u16 *const OAMH = (u16 *)(uintptr_t)OAM_BASE;

/* layer ids for blending: BG0-3 = 0-3, OBJ = 4, backdrop = 5 */
#define L_OBJ 4
#define L_BD 5
#define TRANSPARENT 0x8000u

static u16 bgLine[4][W];      /* BGR555 colour, or TRANSPARENT */
static u16 objLine[W];        /* colour or TRANSPARENT */
static u8 objPrio[W];         /* priority of the opaque sprite pixel */
static u8 objSemi[W];         /* semi-transparent sprite pixel */
static u8 objWin[W];          /* inside the OBJ window */

/* affine BG internal reference points (BG2, BG3) */
static s32 refX[2], refY[2];
static u32 lastX[2], lastY[2];
static u8 wroteX[2], wroteY[2]; /* a DMA wrote BGxX/Y since the last line (GBA: any write reloads the reference) */

/* hw.c's DMA wrote the I/O word or halfword at `addr`: note BG2X/Y, BG3X/Y writes. A per-line HBlank DMA that
 * writes the same value as the line before must still reload the reference point (the World Map's perspective
 * view when the camera faces north: refY would otherwise step by BG2PD, which that page leaves as garbage). */
void Port_PpuIoWritten(u32 addr) {
  u32 off = addr - IO_BASE;
  int i;
  for (i = 0; i < 2; i++) {
    u32 base = R_BG2X + 0x10 * i;
    if (off >= base && off < base + 4)
      wroteX[i] = 1;
    else if (off >= base + 4 && off < base + 8)
      wroteY[i] = 1;
  }
}

static inline u16 rd16(u32 off) { return IO16(off); }

void Port_PpuVBlank(void) {
  int i;
  for (i = 0; i < 2; i++) {
    u32 x = IO32(R_BG2X + 0x10 * i), y = IO32(R_BG2X + 4 + 0x10 * i);
    refX[i] = (s32)(x << 4) >> 4;
    refY[i] = (s32)(y << 4) >> 4;
    lastX[i] = x;
    lastY[i] = y;
    wroteX[i] = wroteY[i] = 0;
  }
}

static void text_bg(int bg, int line) {
  u16 cnt = rd16(R_BG0CNT + 2 * bg);
  u32 hofs = rd16(R_BG0HOFS + 4 * bg) & 0x1FF, vofs = rd16(R_BG0HOFS + 2 + 4 * bg) & 0x1FF;
  u32 charBase = ((cnt >> 2) & 3) * 0x4000, screenBase = ((cnt >> 8) & 31) * 0x800;
  int color256 = (cnt >> 7) & 1, size = cnt >> 14;
  u32 wmask = (size & 1) ? 511 : 255, hmask = (size & 2) ? 511 : 255;
  u32 y = (line + vofs) & hmask;
  u16 *out = bgLine[bg];
  int x;
  for (x = 0; x < W; x++) {
    u32 px = (x + hofs) & wmask;
    u32 block = (px >> 8) + ((y >> 8) * ((size & 1) ? 2 : 1));
    u16 entry = *(u16 *)(VRAM + screenBase + block * 0x800 + (((y & 255) >> 3) * 32 + ((px & 255) >> 3)) * 2);
    u32 tile = entry & 0x3FF, tx = px & 7, ty = y & 7;
    u32 ci;
    if (entry & 0x400)
      tx = 7 - tx;
    if (entry & 0x800)
      ty = 7 - ty;
    if (color256) {
      u32 a = charBase + tile * 64 + ty * 8 + tx;
      ci = a < 0x10000 ? VRAM[a] : 0;
      out[x] = ci ? PAL[ci] & 0x7FFF : TRANSPARENT;
    } else {
      u32 a = charBase + tile * 32 + ty * 4 + (tx >> 1);
      ci = a < 0x10000 ? (VRAM[a] >> ((tx & 1) * 4)) & 15 : 0;
      out[x] = ci ? PAL[(entry >> 12) * 16 + ci] & 0x7FFF : TRANSPARENT;
    }
  }
}

static void affine_bg(int bg) {
  int i = bg - 2;
  u16 cnt = rd16(R_BG0CNT + 2 * bg);
  s32 pa = (s16)rd16(R_BG2PA + 0x10 * i), pc = (s16)rd16(R_BG2PA + 4 + 0x10 * i);
  u32 charBase = ((cnt >> 2) & 3) * 0x4000, screenBase = ((cnt >> 8) & 31) * 0x800;
  u32 size = 128u << (cnt >> 14);
  int wrap = (cnt >> 13) & 1;
  s32 x0 = refX[i], y0 = refY[i];
  u16 *out = bgLine[bg];
  int x;
  for (x = 0; x < W; x++, x0 += pa, y0 += pc) {
    s32 px = x0 >> 8, py = y0 >> 8;
    u32 tile, ci;
    if (wrap) {
      px &= size - 1;
      py &= size - 1;
    } else if (px < 0 || py < 0 || (u32)px >= size || (u32)py >= size) {
      out[x] = TRANSPARENT;
      continue;
    }
    tile = VRAM[screenBase + (py >> 3) * (size >> 3) + (px >> 3)];
    ci = VRAM[(charBase + tile * 64 + (py & 7) * 8 + (px & 7)) & 0xFFFF];
    out[x] = ci ? PAL[ci] & 0x7FFF : TRANSPARENT;
  }
}

static const u8 OBJ_W[3][4] = {{8, 16, 32, 64}, {16, 32, 32, 64}, {8, 8, 16, 32}};
static const u8 OBJ_H[3][4] = {{8, 16, 32, 64}, {8, 8, 16, 32}, {16, 32, 32, 64}};

static void sprites(int line, u16 dispcnt) {
  int i;
  int map1d = (dispcnt >> 6) & 1;
  for (i = 0; i < W; i++) {
    objLine[i] = TRANSPARENT;
    objPrio[i] = 4;
    objSemi[i] = 0;
    objWin[i] = 0;
  }
  if (!(dispcnt & 0x1000))
    return;
  for (i = 0; i < 128; i++) {
    u16 a0 = OAMH[i * 4], a1 = OAMH[i * 4 + 1], a2 = OAMH[i * 4 + 2];
    int affine = (a0 >> 8) & 1, dbl = (a0 >> 9) & 1, mode = (a0 >> 10) & 3, c256 = (a0 >> 13) & 1;
    int shape = a0 >> 14, sz = a1 >> 14;
    int w, h, bw, bh, y, x, sx, prio = (a2 >> 10) & 3;
    s32 pa = 256, pb = 0, pc = 0, pd = 256;
    u32 tile = a2 & 0x3FF;
    if (!affine && dbl)
      continue; /* disabled */
    if (shape == 3 || mode == 3)
      continue;
    w = OBJ_W[shape][sz];
    h = OBJ_H[shape][sz];
    bw = w << (affine && dbl);
    bh = h << (affine && dbl);
    y = a0 & 0xFF;
    if (y >= 160)
      y -= 256;
    if (line < y || line >= y + bh)
      continue;
    x = a1 & 0x1FF;
    if (x >= 240)
      x -= 512;
    if (affine) {
      int p = (a1 >> 9) & 31;
      pa = (s16)OAMH[p * 16 + 3];
      pb = (s16)OAMH[p * 16 + 7];
      pc = (s16)OAMH[p * 16 + 11];
      pd = (s16)OAMH[p * 16 + 15];
    }
    for (sx = 0; sx < bw; sx++) {
      int px = x + sx, tx, ty;
      u32 ci, col, addr, tnum;
      if (px < 0 || px >= W)
        continue;
      if (affine) {
        s32 dx = sx - bw / 2, dy = line - y - bh / 2;
        tx = ((pa * dx + pb * dy) >> 8) + w / 2;
        ty = ((pc * dx + pd * dy) >> 8) + h / 2;
        if (tx < 0 || ty < 0 || tx >= w || ty >= h)
          continue;
      } else {
        tx = sx;
        ty = line - y;
        if (a1 & 0x1000)
          tx = w - 1 - tx;
        if (a1 & 0x2000)
          ty = h - 1 - ty;
      }
      if (c256) {
        tnum = map1d ? tile + ((ty >> 3) * (w >> 3) + (tx >> 3)) * 2 : (tile & ~1u) + (ty >> 3) * 32 + (tx >> 3) * 2;
        addr = 0x10000 + (tnum & 1023) * 32 + (ty & 7) * 8 + (tx & 7);
        ci = VRAM[addr];
        col = PAL[256 + ci];
      } else {
        tnum = map1d ? tile + (ty >> 3) * (w >> 3) + (tx >> 3) : tile + (ty >> 3) * 32 + (tx >> 3);
        addr = 0x10000 + (tnum & 1023) * 32 + (ty & 7) * 4 + ((tx & 7) >> 1);
        ci = (VRAM[addr] >> ((tx & 1) * 4)) & 15;
        col = PAL[256 + (a2 >> 12) * 16 + ci];
      }
      if (!ci)
        continue;
      if (mode == 2) {
        objWin[px] = 1;
        continue;
      }
      /* the first sprite in OAM order with the best priority wins */
      if (objLine[px] == TRANSPARENT || prio < objPrio[px]) {
        objLine[px] = col & 0x7FFF;
        objPrio[px] = (u8)prio;
        objSemi[px] = mode == 1;
      }
    }
  }
}

static inline u32 rgba(u16 c) {
  u32 r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
  r = r << 3 | r >> 2;
  g = g << 3 | g >> 2;
  b = b << 3 | b >> 2;
  return 0xFF000000u | b << 16 | g << 8 | r;
}

static inline u16 blend_alpha(u16 a, u16 b, u32 eva, u32 evb) {
  u32 r = ((a & 31) * eva + (b & 31) * evb) >> 4, g = (((a >> 5) & 31) * eva + ((b >> 5) & 31) * evb) >> 4,
      bl = (((a >> 10) & 31) * eva + ((b >> 10) & 31) * evb) >> 4;
  if (r > 31) r = 31;
  if (g > 31) g = 31;
  if (bl > 31) bl = 31;
  return (u16)(r | g << 5 | bl << 10);
}

static inline u16 brighten(u16 a, u32 evy) {
  u32 r = a & 31, g = (a >> 5) & 31, b = (a >> 10) & 31;
  r += ((31 - r) * evy) >> 4;
  g += ((31 - g) * evy) >> 4;
  b += ((31 - b) * evy) >> 4;
  return (u16)(r | g << 5 | b << 10);
}

static inline u16 darken(u16 a, u32 evy) {
  u32 r = a & 31, g = (a >> 5) & 31, b = (a >> 10) & 31;
  r -= (r * evy) >> 4;
  g -= (g * evy) >> 4;
  b -= (b * evy) >> 4;
  return (u16)(r | g << 5 | b << 10);
}

void Port_PpuLine(int line) {
  u16 dispcnt = rd16(R_DISPCNT);
  int mode = dispcnt & 7, bg, x, i;
  u32 *out = gPortFrame + line * W;
  int enabled[4] = {0, 0, 0, 0};
  u16 bldcnt, bldalpha, bldy;
  u32 eva, evb, evy;
  int effect;
  u16 winin, winout;
  int winOn = (dispcnt >> 13) & 7;
  int w0x1, w0x2, w0y1, w0y2, w1x1, w1x2, w1y1, w1y2, in0, in1;
  u8 bgPrio[4];

  /* affine reference points: reloaded when the game rewrote BGxX/Y since the last line */
  for (i = 0; i < 2; i++) {
    u32 xr = IO32(R_BG2X + 0x10 * i), yr = IO32(R_BG2X + 4 + 0x10 * i);
    if (xr != lastX[i] || wroteX[i]) {
      refX[i] = (s32)(xr << 4) >> 4;
      lastX[i] = xr;
    }
    if (yr != lastY[i] || wroteY[i]) {
      refY[i] = (s32)(yr << 4) >> 4;
      lastY[i] = yr;
    }
    wroteX[i] = wroteY[i] = 0;
  }
  if (dispcnt & 0x80) { /* forced blank: white */
    for (x = 0; x < W; x++)
      out[x] = 0xFFFFFFFFu;
    return;
  }
  if (mode > 2) { /* bitmap modes: not used by the title (G4 if ever needed) */
    for (x = 0; x < W; x++)
      out[x] = 0xFF000000u;
    return;
  }
  for (bg = 0; bg < 4; bg++) {
    if (!((dispcnt >> (8 + bg)) & 1))
      continue;
    if (mode == 1 && bg == 3)
      continue;
    if (mode == 2 && bg < 2)
      continue;
    enabled[bg] = 1;
    bgPrio[bg] = rd16(R_BG0CNT + 2 * bg) & 3;
    if (mode == 0 || (mode == 1 && bg < 2))
      text_bg(bg, line);
    else
      affine_bg(bg);
  }
  sprites(line, dispcnt);

  bldcnt = rd16(R_BLDCNT);
  bldalpha = rd16(R_BLDALPHA);
  bldy = rd16(R_BLDY);
  eva = bldalpha & 31;
  evb = (bldalpha >> 8) & 31;
  if (eva > 16) eva = 16;
  if (evb > 16) evb = 16;
  evy = bldy & 31;
  if (evy > 16) evy = 16;
  effect = (bldcnt >> 6) & 3;
  winin = rd16(R_WININ);
  winout = rd16(R_WINOUT);
  w0x1 = rd16(R_WIN0H) >> 8; w0x2 = rd16(R_WIN0H) & 0xFF;
  w1x1 = rd16(R_WIN1H) >> 8; w1x2 = rd16(R_WIN1H) & 0xFF;
  w0y1 = rd16(R_WIN0V) >> 8; w0y2 = rd16(R_WIN0V) & 0xFF;
  w1y1 = rd16(R_WIN1V) >> 8; w1y2 = rd16(R_WIN1V) & 0xFF;
  in0 = (winOn & 1) && (w0y1 <= w0y2 ? line >= w0y1 && line < w0y2 : line >= w0y1 || line < w0y2);
  in1 = (winOn & 2) && (w1y1 <= w1y2 ? line >= w1y1 && line < w1y2 : line >= w1y1 || line < w1y2);

  for (x = 0; x < W; x++) {
    u32 mask = 0x3F; /* layers 0-4 and the effect bit 5 */
    u16 top = PAL[0] & 0x7FFF, second = top;
    int topL = L_BD, secondL = L_BD, topP = 4, secondP = 4;
    int semi = 0;
    if (winOn) {
      if (in0 && (w0x1 <= w0x2 ? x >= w0x1 && x < w0x2 : x >= w0x1 || x < w0x2))
        mask = winin & 0x3F;
      else if (in1 && (w1x1 <= w1x2 ? x >= w1x1 && x < w1x2 : x >= w1x1 || x < w1x2))
        mask = (winin >> 8) & 0x3F;
      else if ((winOn & 4) && objWin[x])
        mask = (winout >> 8) & 0x3F;
      else
        mask = winout & 0x3F;
    }
    /* BGs: lower priority number wins, then lower BG number */
    for (bg = 3; bg >= 0; bg--) {
      u16 c;
      if (!enabled[bg] || !((mask >> bg) & 1))
        continue;
      c = bgLine[bg][x];
      if (c == TRANSPARENT)
        continue;
      if (bgPrio[bg] <= topP) {
        second = top; secondL = topL; secondP = topP;
        top = c; topL = bg; topP = bgPrio[bg];
      } else if (bgPrio[bg] <= secondP) {
        second = c; secondL = bg; secondP = bgPrio[bg];
      }
    }
    if (objLine[x] != TRANSPARENT && ((mask >> 4) & 1)) {
      if (objPrio[x] <= topP) {
        second = top; secondL = topL;
        top = objLine[x]; topL = L_OBJ;
        semi = objSemi[x];
      } else if (objPrio[x] <= secondP) {
        second = objLine[x]; secondL = L_OBJ;
      }
    }
    if (semi && ((bldcnt >> (8 + secondL)) & 1))
      top = blend_alpha(top, second, eva, evb);
    else if ((mask >> 5) & 1 && ((bldcnt >> topL) & 1)) {
      if (effect == 1 && ((bldcnt >> (8 + secondL)) & 1))
        top = blend_alpha(top, second, eva, evb);
      else if (effect == 2)
        top = brighten(top, evy);
      else if (effect == 3)
        top = darken(top, evy);
    }
    out[x] = rgba(top);
  }
  /* affine reference points step by PB/PD for the next line */
  for (i = 0; i < 2; i++) {
    refX[i] += (s16)rd16(R_BG2PA + 2 + 0x10 * i);
    refY[i] += (s16)rd16(R_BG2PA + 6 + 0x10 * i);
  }
}

u32 *Port_FrameBuffer(void) { return gPortFrame; }
