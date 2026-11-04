/* GS27: two renderers in this file. The Lost Age (PORT_GAME_TLA, port/tla/pc.tsv) builds the renderer as it was before
 * GS1's wide view, so TLA's build is unchanged by GS1's options; GS1 builds the one after #else (240 x 160, or
 * up to 336 x 224 with Map zoom, GS29). Keep both in step when the renderer changes. */
#ifdef PORT_GAME_TLA
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
#else /* GS1 */
/* Scanline renderer v1 (orchestrator D9, G3): written from GBATEK. Modes 0-2: text BGs (4bpp/8bpp, flips, all
 * four sizes), affine BGs (wrap or transparent outside, internal reference points latched at VBlank, advanced
 * per line by PB/PD and reloaded when the game rewrites BGxX/Y), sprites (normal and affine incl. double size,
 * 1D/2D tile mapping, 4bpp/8bpp, semi-transparent, OBJ window), windows 0/1/OBJ, blending (alpha, brighten,
 * darken, semi-transparent sprites), forced blank, backdrop. Not yet: mosaic, modes 3-5 (unused by the
 * title). Output: 240x160 RGBA8 in gPortFrame, read by the page. Called once per visible line by the frame
 * driver (hw.c) with the registers as they are at that line. */
#include <math.h>
#include <stdlib.h>
#include <string.h>

#include "gba.h"

#define W 240
#define H 160

/* GS29 "Map zoom" (optional, default Normal; port/pc/options.c; replaces GS27's 288 x 160 "Wide view"): on a field
 * map the frame is FW x FH, always 3:2 like the GBA's 240 x 160, and the page scales it into the same box, so the
 * picture shows more of the map at the same aspect ratio. Levels (whole 8-px tiles on every side): 0 Normal 240 x 160,
 * 1 288 x 192 (1.2x), 2 336 x 224 (1.4x). The GBA's 240 x 160 sits at (XO, YO) in the frame. The margins around it
 * come from the map grid's cells (the same cell pictures MapGrid_RenderCellPicture* write into the 32-tile BG maps,
 * which only hold the GBA's view); sprites use the wider OAM range; the window layer (BG0) stays the GBA's 240 x 160.
 * The game's camera never moves: XO/YO are chosen per frame so the frame stays inside the map's camera bounds where
 * the map is big enough (presentation only; near a map's edge the GBA's view is off-centre in the frame), else the
 * map is centred and the rest is black. Every screen that is not a field map (battles, World Map, menus outside the
 * field, title...) is 240 x 160 at every level. Normal: LW 240, LH 160, XO = YO = 0, every loop is the original. */
#define ZOOM_LEVELS 3
static const short ZOOM_W[ZOOM_LEVELS] = {240, 288, 336}, ZOOM_H[ZOOM_LEVELS] = {160, 192, 224};
#define WMAX 336
#define HMAX 224
static int LW = W, LH = H, XO = 0, YO = 0, fieldZoom = 0;
/* a field frame at a zoom level (inside the field sequence, a map scrolled this frame): its map layers are checked
 * against the grid (text_bg) and the lines where one matches counted; the next such frame is zoomed only if at
 * least ZOOM_MIN_LINES matched, so a screen drawn into the map's BGs (the File Screen after Continue, inside the
 * field sequence) stays 240 x 160 */
static int fieldCandidate = 0, sMatchLines = 0, sMatchPrev = 0, sLineMatched = 0;
#define ZOOM_MIN_LINES 80

u32 gPortFrame[WMAX * HMAX]; /* RGBA8, little endian: 0xAABBGGRR; LW pixels a row, LH rows */

static u16 *const PAL = (u16 *)(uintptr_t)PALETTE_BASE;
static u8 *const VRAM = (u8 *)(uintptr_t)VRAM_BASE;
static u16 *const OAMH = (u16 *)(uintptr_t)OAM_BASE;

/* layer ids for blending: BG0-3 = 0-3, OBJ = 4, backdrop = 5 */
#define L_OBJ 4
#define L_BD 5
#define TRANSPARENT 0x8000u

static u16 bgLine[4][WMAX];   /* BGR555 colour, or TRANSPARENT */
static u16 objLine[WMAX];     /* colour or TRANSPARENT */
static u8 objPrio[WMAX];      /* priority of the opaque sprite pixel */
static u8 objSemi[WMAX];      /* semi-transparent sprite pixel */
static u8 objWin[WMAX];       /* inside the OBJ window */

/* the field's map grid (game RAM at fixed addresses, include/system/ram_buffer.h): 128 x 128 cells of 16 x 16
 * pixels (u32, low 12 bits a cell picture), cell pictures of four tile entries (top two, bottom two), and gBgScroll
 * (BG0-3 x, y in pixels; the VBlank copies it into BGxHOFS/VOFS). Layer i of the grid is BG(3 - i), its BG map in
 * screen block 5 + i. */
#define MAP_CELLS ((const u32 *)(uintptr_t)0x02010000u)
#define CELL_PICTURES ((const u16 *)(uintptr_t)0x02020000u)
struct PortBgScroll { u16 x, y; };
extern struct PortBgScroll gBgScroll[];
int Port_ZoomLevel(void);
u32 Port_FrameCount(void);
static u32 sFieldStamp;
static int sStamped;
/* MapGrid_UpdateLayerScroll ran (port/c_rules.tsv) inside the field sequence: a field map is on screen this frame */
static int sInField;
void Port_ZoomFieldStamp(void) {
  sFieldStamp = Port_FrameCount();
  sStamped = sInField;
}
/* FieldSequence_Run starts (1) or ends (0) (port/c_rules.tsv); a power cycle or soft reset ends it too (main.c) */
void Port_ZoomFieldSequence(int on) {
  sInField = on;
  if (!on)
    sStamped = 0;
}
int Port_FrameWidth(void) { return LW; }
int Port_FrameHeight(void) { return LH; }

/* pixels the frame shows past each side of the GBA's screen this frame (0 at Normal and off the field): the field's
 * actor culling and Sprite_Draw use them (port/c_rules.tsv), so with all four 0 each of those tests is the original */
int gPortZoomL, gPortZoomR, gPortZoomT, gPortZoomB;

/* the map's camera bounds in this frame's screen coordinates (gMapGridWork[0], struct MapGridScrollWork, 0x194 bytes:
 * viewX/viewY at 0xe4/0xe8, minX, minY, maxX, maxY at 0xec-0xf8, 16.16 pixels): frame pixels past them are black,
 * not whatever the grid holds beyond the map */
#define MAP_GRID_WORK_PTR (*(volatile u32 *)(uintptr_t)0x03001e70u)
static int sBoundL, sBoundR, sBoundT, sBoundB;
/* the GBA screen's offset in the frame on one axis: centred (m), moved so the frame stays inside [lo, hi) when
 * the map is at least the frame's size, else the map centred; always with the whole GBA screen (0..gba) inside */
static int zoom_offset(int frame, int gba, int lo, int hi) {
  int m = (frame - gba) / 2, o;
  if (hi - lo >= frame) {
    o = m;
    if (o > -lo)
      o = -lo;
    if (o < frame - hi)
      o = frame - hi;
  } else
    o = (frame - lo - hi) / 2;
  if (o < 0)
    o = 0;
  if (o > frame - gba)
    o = frame - gba;
  return o;
}
/* GS31: the camera as it was at the last VBlank (Port_PpuVBlank). The VBlank copies gBgScroll into the BG registers
 * the coming frame shows, and the game's logic then runs on and moves viewX/viewY for the frame after it; read at line
 * 0, the camera was one frame ahead of the picture, so wherever the frame was held at a map's edge the picture moved
 * by the camera's last step and back (a 1-px jitter at the edge while the GBA's camera eased in). Taken here, the
 * frame's place and the BG registers come from the same moment. */
static s32 sCamView[2], sCamMin[2], sCamMax[2];
static int sCamValid;
static void zoom_camera_snapshot(void) {
  u32 g = MAP_GRID_WORK_PTR;
  sCamValid = g >= EWRAM_BASE && g + 0x194 <= EWRAM_BASE + 0x40000;
  if (sCamValid) {
    sCamView[0] = *(s32 *)(uintptr_t)(g + 0xe4) >> 16;
    sCamView[1] = *(s32 *)(uintptr_t)(g + 0xe8) >> 16;
    sCamMin[0] = *(s32 *)(uintptr_t)(g + 0xec) >> 16;
    sCamMin[1] = *(s32 *)(uintptr_t)(g + 0xf0) >> 16;
    sCamMax[0] = *(s32 *)(uintptr_t)(g + 0xf4) >> 16;
    sCamMax[1] = *(s32 *)(uintptr_t)(g + 0xf8) >> 16;
  }
}
static void zoom_frame(int level) {
  int fw = ZOOM_W[level], fh = ZOOM_H[level];
  sBoundL = -fw;
  sBoundR = W + fw;
  sBoundT = -fh;
  sBoundB = H + fh;
  if (sCamValid && sCamMin[0] < sCamMax[0] && sCamMin[1] < sCamMax[1]) {
    sBoundL = sCamMin[0] - sCamView[0];
    sBoundR = sCamMax[0] - sCamView[0];
    sBoundT = sCamMin[1] - sCamView[1];
    sBoundB = sCamMax[1] - sCamView[1];
  }
  LW = fw;
  LH = fh;
  XO = zoom_offset(fw, W, sBoundL, sBoundR);
  YO = zoom_offset(fh, H, sBoundT, sBoundB);
}

/* GS34: full-screen menus over a zoomed map. A screen such as the field menu's Status covers the GBA's whole screen with
 * the window layer and then borrows the map's VRAM and palette under it: StatusScreen_Run (menu/menu/status.c) draws a
 * 30 x 20 border, then saves and overwrites BG palettes 0-1 (the first sprite palette, for its element icons) and 8 KB
 * of char block 1 (its text canvas), the map's own tiles there (the ground layer's), and puts them back before the
 * border goes. On the GBA nothing of the map shows meanwhile; the margins, drawn from the map grid's cells with the live
 * tiles and palette (and with "Menus: Edges" the GBA-screen pixels the moved windows leave), showed those borrowed bytes
 * as the map: pink and orange ground, a "lava" river, specks on the World Map. So while the window layer covers the
 * whole GBA screen (checked at line 0 from VRAM and the display registers: what the frame really shows), every layer
 * but the window layer is drawn in the margins from the BG VRAM and palette of the last zoomed frame that was not
 * covered: the map continued exactly as it was when the screen opened (the game's camera and actors are stopped under
 * such screens). The GBA's own 240 x 160 stays the hardware's (its window corners included), but while "Menus: Edges"
 * lays the windows out (sMenuOn) the map under them is the snapshot's there too, since moved windows uncover it.
 * Without such a frame (none since the frame zoomed) those layers are left out and the backdrop is black. Live while
 * covered: the window layer, sprites, registers, the map grid. At Normal and on frames that are not zoomed nothing
 * here runs (sCoverOn = sCoverBlack = 0). */
static int sCoverOn, sCoverBlack; /* this frame: map layers from the snapshot / left out */
static int sCoverKind;            /* the snapshot's frame kind: 1 field map, 2 World Map still picture; 0 none */
static u16 sMapPal[256];          /* its BG palette */
static u8 sMapVram[0x10000];      /* its BG VRAM (char and screen blocks) */
static const u16 *sWmPal = (const u16 *)(uintptr_t)PALETTE_BASE; /* the World Map margins' palette this frame */
static u32 sCoverFrames;          /* test probes: frames drawn with the snapshot */
/* the window layer (the BG on screen block 4, WINDOW_TILEMAP_VRAM) is in front of every other BG and opaque on the
 * GBA's 240 x 160 pixels, unblended and unwindowed (line 0's registers; the field keeps them for the frame). A window's
 * border tiles leave its corner pixel transparent (the Status screen: 12 such pixels, where the GBA itself shows the
 * borrowed palette), so up to COVER_HOLES transparent pixels still count as covered. */
#define COVER_HOLES 64
static int cover_check(void) {
  u16 dispcnt = IO16(R_DISPCNT), bldcnt = IO16(R_BLDCNT), cnt;
  int wb = -1, i, x, y, prio, color256, size, holes = 0;
  u32 hofs, vofs, charBase, screenBase, wmask, hmask;
  if ((dispcnt & 0x80) || (dispcnt & 7) != 0 || (dispcnt & 0xE000))
    return 0;
  for (i = 0; i < 4; i++)
    if (((IO16(R_BG0CNT + 2 * i) >> 8) & 31) == 4) {
      wb = i;
      break;
    }
  if (wb < 0 || !((dispcnt >> (8 + wb)) & 1) || (((bldcnt >> 6) & 3) == 1 && (bldcnt & (1u << wb))))
    return 0;
  cnt = IO16(R_BG0CNT + 2 * wb);
  prio = cnt & 3;
  for (i = 0; i < 4; i++)
    if (i != wb && ((dispcnt >> (8 + i)) & 1)) {
      int p = IO16(R_BG0CNT + 2 * i) & 3;
      if (p < prio || (p == prio && i < wb))
        return 0;
    }
  hofs = IO16(R_BG0HOFS + 4 * wb) & 0x1FF;
  vofs = IO16(R_BG0HOFS + 2 + 4 * wb) & 0x1FF;
  charBase = ((cnt >> 2) & 3) * 0x4000;
  screenBase = ((cnt >> 8) & 31) * 0x800;
  color256 = (cnt >> 7) & 1;
  size = cnt >> 14;
  wmask = (size & 1) ? 511 : 255;
  hmask = (size & 2) ? 511 : 255;
  for (y = 0; y < H; y++) {
    u32 py = ((u32)y + vofs) & hmask;
    for (x = 0; x < W; x++) {
      u32 px = ((u32)x + hofs) & wmask, block = (px >> 8) + ((py >> 8) * ((size & 1) ? 2 : 1)), tx, ty, a, ci;
      u16 entry = *(u16 *)(VRAM + screenBase + block * 0x800 + (((py & 255) >> 3) * 32 + ((px & 255) >> 3)) * 2);
      tx = (entry & 0x400) ? 7 - (px & 7) : px & 7;
      ty = (entry & 0x800) ? 7 - (py & 7) : py & 7;
      if (color256) {
        a = charBase + (entry & 0x3FF) * 64 + ty * 8 + tx;
        ci = a < 0x10000 ? VRAM[a] : 0;
      } else {
        a = charBase + (entry & 0x3FF) * 32 + ty * 4 + (tx >> 1);
        ci = a < 0x10000 ? (VRAM[a] >> ((tx & 1) * 4)) & 15 : 0;
      }
      if (!ci && ++holes > COVER_HOLES)
        return 0;
    }
  }
  return 1;
}
/* line 0 of a frame: kind 1 a zoomed field map, 2 a zoomed World Map still picture, 0 anything else */
static void cover_frame(int kind) {
  sCoverOn = sCoverBlack = 0;
  if (!kind) {
    sCoverKind = 0;
  } else if (cover_check()) {
    if (sCoverKind == kind)
      sCoverOn = 1;
    else
      sCoverBlack = 1;
  } else {
    memcpy(sMapPal, (const void *)(uintptr_t)PALETTE_BASE, sizeof sMapPal);
    memcpy(sMapVram, VRAM, sizeof sMapVram);
    sCoverKind = kind;
  }
  sCoverFrames += sCoverOn;
  sWmPal = sCoverOn ? sMapPal : PAL;
}
/* test probes (tests/probes/margins.cjs), the last frame: what 0: 0 nothing done, 1 map layers from the snapshot, 2
 * left out (no snapshot); 1: frames drawn from the snapshot so far; 2, 3: the GBA screen's place in the frame (XO, YO) */
int Port_ZoomCover(int what) {
  return what == 1 ? (int)sCoverFrames : what == 2 ? XO : what == 3 ? YO : sCoverOn ? 1 : sCoverBlack ? 2 : 0;
}

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

/* GS30: a World Map frame's top margin rows are drawn after line 159 (they need the frame's lines, docs/GS30.md) with
 * line 0's display registers, kept here */
#define IO_SNAP_BYTES 0x60
static u8 sIoSnap[IO_SNAP_BYTES];
static int sUseIoSnap;
static inline u16 rd16(u32 off) {
  if (sUseIoSnap && off < IO_SNAP_BYTES)
    return *(const u16 *)(sIoSnap + off);
  return IO16(off);
}

static void menu_snapshot(void); /* GS33 */
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
  zoom_camera_snapshot(); /* GS31 */
  menu_snapshot();        /* GS33 */
}

/* GS30 "Map zoom" on the World Map (docs/GS30.md). The World Map is DISPCNT mode 2: BG3 (screen block 8, char block 2)
 * the ground, BG2 (screen block 10, char block 3) the mountains and woods, both 512 x 512 px affine and wrapping, each
 * line given its own PA/PC/X/Y by an HBlank DMA (WorldMap_ApplyAffinePage: DMA 0, repeat, 8 words to BG2PA..BG3Y), the
 * reference point absolute (unwrapped BG px = world units / 2). At More/Most such a frame is LW x LH with the GBA's
 * lines centred:
 * - a GBA line's extra columns continue the hardware's stepping (X + n * PA);
 * - the extra rows take each term as a + b / (line - h) (h the horizon), fitted on the frame's own lines 0, 80 and 159
 *   (exact at 0 and 159); rows past the horizon are transparent;
 * - a margin sample is drawn only where the game holds that place: inside the 1024 x 1024-unit block of world tiles
 *   in RAM (Ram_CellPictures, 256 units left of and 320 above the followed point), its quarter decoded
 *   (quarterTiles == tileIds, +320 for the upper layer), and the BG map's cell equal to the RAM cell's picture
 *   (checked for all 32 x 32 cells of both layers each frame); anything else is transparent (the backdrop);
 * - the GBA's own pixels are drawn as before, never checked.
 * While a menu or an event shows the view as a still picture (BG1CNT 0x682, mode 0, BG2/BG3 still on), the margins
 * show the last moving frame's ground (a copy of its BG maps, tiles, lines and checks) as layer BG1, with the live
 * palette, windows, blending and sprites. R's world picture (BG2/BG3 off) and every other screen stay 240 x 160. */
#define WM_VIEW_PTR (*(volatile u32 *)(uintptr_t)0x03001e70u) /* gMapGridWork[0]: struct WorldMapView on the World Map */
#define WM_CELLS ((const u8 *)(uintptr_t)0x02020000u)         /* Ram_CellPictures: 2 layers x 32 x 32 cells, u32 each */
#define WM_CELL_PICTURES ((const u8 *)(uintptr_t)0x02010000u) /* Ram_MapGridCellBuffer: cell picture = top, bottom u16 */
struct WmLine { s32 x, y, pa, pc; };
struct WmFit { int ok, linear, la, lc; double h, a[4], b[4]; };
struct WmView {
  struct WmLine lines[2][H]; /* BG2, BG3 as the GBA's lines used them */
  struct WmFit fit[2];
  int skyTop;               /* the first ground line (0 in normal play) */
  u8 valid[2][32][32];      /* layer 0 (BG3, screen block 8) / 1 (BG2, screen block 10): the BG map cell is the RAM's */
  u8 qok[2][2][2];          /* [layer][quarter z & 1][quarter x & 1]: the RAM quarter holds its tile */
  s32 bx0, bz0;             /* the RAM block's top left, world units */
  u16 cnt[2];               /* BG2CNT, BG3CNT */
};
static struct WmView sWm, sWmSnap;
static u8 sSnapVram[0x2000 + 0x8000]; /* screen blocks 8-11, then char blocks 2-3, of the last moving frame */
static u8 sSnapCells[0x2000];         /* its Ram_CellPictures */
static int sSnapOk, worldZoom, worldStill, sZoomOn;

static int wm_ram_ok(u32 a, u32 n) {
  return (a >= EWRAM_BASE && a + n <= EWRAM_BASE + 0x40000) || (a >= IWRAM_BASE && a + n <= IWRAM_BASE + 0x8000);
}
static inline u16 wm_u16(const u8 *p) { return *(const u16 *)p; }

/* the World Map's moving view is being fed: its BG settings and the HBlank DMA into BG2PA..BG3Y */
static int wm_config(void) {
  u16 c2 = IO16(0x00C), c3 = IO16(0x00E), ctl = IO16(R_DMA0SAD + 10);
  u32 g = WM_VIEW_PTR;
  return (c2 & ~3u) == 0xaa0c && (c3 & ~3u) == 0xa808 && IO32(R_DMA0SAD + 4) == IO_BASE + R_BG2PA &&
         (ctl & 0xB660) == 0xA660 && wm_ram_ok(g, 0x35c);
}

/* a frame's checks: the RAM block, its quarters, and each BG map cell against its RAM cell (docs/GS30.md) */
static void wm_scan(struct WmView *w) {
  u32 g = WM_VIEW_PTR, org = *(const u32 *)(uintptr_t)g;
  s32 ox = 0, oz = 0, fqx, fqz;
  int L, r, c, row, col;
  const u16 *tileIds = (const u16 *)(uintptr_t)(g + 0x138), *quarterTiles = (const u16 *)(uintptr_t)(g + 0x338);
  if (wm_ram_ok(org, 12)) {
    ox = *(const s32 *)(uintptr_t)org;
    oz = *(const s32 *)(uintptr_t)(org + 8);
  }
  fqx = (ox - (256 << 16)) >> 25;
  fqz = (oz - (320 << 16)) >> 25;
  w->bx0 = fqx * 512;
  w->bz0 = fqz * 512;
  for (row = 0; row < 2; row++)
    for (col = 0; col < 2; col++) {
      s32 qx = fqx + col, qz = fqz + row;
      u16 tile = tileIds[((qz & 15) << 4) + (qx & 15)];
      for (L = 0; L < 2; L++)
        w->qok[L][qz & 1][qx & 1] = quarterTiles[(L * 2 + (qz & 1)) * 2 + (qx & 1)] == (u16)(tile + 320 * L);
    }
  w->cnt[0] = IO16(0x00C);
  w->cnt[1] = IO16(0x00E);
  /* the cell checks need Ram_MapGridCellBuffer's cell pictures, which the still picture borrows (it is drawn there
   * the frame before it shows, and the table comes back a frame after it): while the BG maps and the RAM cells are
   * those of the last moving frame, its checks stand */
  if (sSnapOk && !memcmp(VRAM + 0x4000, sSnapVram, 0x2000) && !memcmp(WM_CELLS, sSnapCells, 0x2000)) {
    memcpy(w->valid, sWmSnap.valid, sizeof w->valid);
    return;
  }
  for (L = 0; L < 2; L++) {
    const u8 *map = VRAM + 0x4000 + L * 0x1000;
    for (r = 0; r < 32; r++)
      for (c = 0; c < 32; c++) {
        u32 id = wm_u16(WM_CELLS + L * 4096 + r * 128 + c * 4) & 0x3FFF;
        const u8 *pic = WM_CELL_PICTURES + id * 4;
        w->valid[L][r][c] = wm_u16(pic) == wm_u16(map + 2 * r * 64 + 2 * c) &&
                            wm_u16(pic + 2) == wm_u16(map + (2 * r + 1) * 64 + 2 * c);
      }
  }
}

/* the frame's per-line terms as a + b / (line - h), from lines la, (la + 159) / 2 and 159 */
static void wm_fit(struct WmView *w) {
  int i, j, g;
  for (g = 0; g < H && !w->lines[0][g].pa && !w->lines[0][g].pc; g++)
    ;
  w->skyTop = g;
  for (i = 0; i < 2; i++) {
    struct WmFit *f = &w->fit[i];
    const struct WmLine *L = w->lines[i];
    int a = g, c = H - 1, b = (a + c) / 2, k;
    double fa, fb, fc, R, den;
    f->ok = 0;
    if (g >= 100)
      continue;
    f->la = a;
    f->lc = c;
    f->ok = 1;
    k = abs(L[a].x - L[c].x) > abs(L[a].y - L[c].y);
    fa = k ? L[a].x : L[a].y;
    fb = k ? L[b].x : L[b].y;
    fc = k ? L[c].x : L[c].y;
    f->linear = 1;
    if (fabs(fa - fc) >= 256 * 4 && fb != fc) {
      R = (fa - fb) / (fb - fc);
      den = (b - a) - R * (c - b);
      if (fabs(den) > 1e-9) {
        f->h = ((b - a) * (double)c - R * (c - b) * a) / den;
        if (f->h < a - 1 || f->h > c + 1)
          f->linear = 0;
      }
    }
    for (j = 0; j < 4; j++) {
      double va = j == 0 ? L[a].x : j == 1 ? L[a].y : j == 2 ? L[a].pa : L[a].pc;
      double vc = j == 0 ? L[c].x : j == 1 ? L[c].y : j == 2 ? L[c].pa : L[c].pc;
      if (f->linear) {
        f->a[j] = va;
        f->b[j] = (vc - va) / (c - a);
      } else {
        double ga = 1 / (a - f->h), gc = 1 / (c - f->h);
        f->b[j] = (va - vc) / (ga - gc);
        f->a[j] = va - f->b[j] * ga;
      }
    }
  }
}

/* frame row v's terms for BG2 (i 0) or BG3 (i 1): X, Y, PA, PC (the registers' units); 0 when the row shows nothing */
static int wm_row(const struct WmView *w, int i, int v, double t[4]) {
  const struct WmFit *f = &w->fit[i];
  int j;
  if ((v >= 0 && v < H) || (v < 0 && w->skyTop > 0)) {
    const struct WmLine *L = &w->lines[i][v < 0 ? 0 : v];
    t[0] = L->x;
    t[1] = L->y;
    t[2] = L->pa;
    t[3] = L->pc;
    return 1;
  }
  if (!f->ok)
    return 0;
  if (f->linear) {
    for (j = 0; j < 4; j++)
      t[j] = f->a[j] + f->b[j] * (v - f->la);
    return 1;
  }
  if ((v - f->h) * (f->la - f->h) <= 0 || fabs(v - f->h) < 1)
    return 0; /* past the horizon */
  for (j = 0; j < 4; j++)
    t[j] = f->a[j] + f->b[j] / (v - f->h);
  return 1;
}

/* a margin sample at unwrapped BG pixel (px, py) of layer L is the game's ground there */
static inline int wm_ok(const struct WmView *w, int L, s32 px, s32 py) {
  s32 wx = px * 2, wz = py * 2;
  if (wx < w->bx0 || wx >= w->bx0 + 1024 || wz < w->bz0 || wz >= w->bz0 + 1024)
    return 0;
  if (!w->qok[L][(wz >> 9) & 1][(wx >> 9) & 1])
    return 0;
  return w->valid[L][(py >> 4) & 31][(px >> 4) & 31];
}

/* one affine sample (256 colours, 512 px, wrapping) from VRAM laid out at `vram` (the live VRAM or the copy) */
static inline u16 wm_sample(const u8 *map, const u8 *chr, s32 px, s32 py) {
  u32 tile, ci;
  px &= 511;
  py &= 511;
  tile = map[(py >> 3) * 64 + (px >> 3)];
  ci = chr[(tile * 64 + (py & 7) * 8 + (px & 7)) & 0x3FFF];
  return ci ? sWmPal[ci] & 0x7FFF : TRANSPARENT; /* GS34: the snapshot's palette under a full-screen menu */
}

/* frame row v of a World Map BG (bg 2 or 3) from view w and VRAM copy (vram, or NULL for the live VRAM); on a GBA line
 * (real) the GBA's columns are drawn as the hardware does and the extra columns continue its stepping */
static void wm_layer(u16 *out, int bg, int v, int real, const struct WmView *w, const u8 *snap, int marginsOnly) {
  int i = bg - 2, x;
  u16 cnt = snap ? w->cnt[i] : rd16(R_BG0CNT + 2 * bg);
  u32 charBase = ((cnt >> 2) & 3) * 0x4000, screenBase = ((cnt >> 8) & 31) * 0x800;
  int L = screenBase == 0x5000;
  const u8 *map = snap ? snap + (screenBase - 0x4000) : VRAM + screenBase;
  const u8 *chr = snap ? snap + 0x2000 + (charBase - 0x8000) : VRAM + charBase;
  if (real) {
    const struct WmLine *ln = &w->lines[i][v];
    s32 pa = ln->pa, pc = ln->pc, x0 = ln->x - pa * XO, y0 = ln->y - pc * XO;
    for (x = 0; x < LW; x++, x0 += pa, y0 += pc) {
      int gx = x - XO;
      s32 px = x0 >> 8, py = y0 >> 8;
      if (gx >= 0 && gx < W) {
        if (!marginsOnly)
          out[x] = wm_sample(map, chr, px, py);
        continue;
      }
      out[x] = wm_ok(w, L, px, py) ? wm_sample(map, chr, px, py) : TRANSPARENT;
    }
  } else {
    double t[4];
    if (!wm_row(w, i, v, t)) {
      for (x = 0; x < LW; x++)
        out[x] = TRANSPARENT;
      return;
    }
    for (x = 0; x < LW; x++) {
      int gx = x - XO;
      s32 px = (s32)floor((t[0] + t[2] * gx) / 256.0), py = (s32)floor((t[1] + t[3] * gx) / 256.0);
      out[x] = wm_ok(w, L, px, py) ? wm_sample(map, chr, px, py) : TRANSPARENT;
    }
  }
}

static const u8 OBJ_W[3][4] = {{8, 16, 32, 64}, {16, 32, 32, 64}, {8, 8, 16, 32}};
static const u8 OBJ_H[3][4] = {{8, 16, 32, 64}, {8, 8, 16, 32}, {16, 32, 32, 64}};

/* GS33 "Menus: Edges" (optional, default Edges as the user asked; port/pc/options.c row "Menus", page gs-menus;
 * docs/GS33.md). On a zoomed frame (a field map or the World Map at More/Most) the game draws its windows the GBA's size
 * in the GBA's 240 x 160, which sits inside the bigger frame (off-centre near a map's edge). With Edges each window
 * moves, with the same pixels, toward the frame's edge it is near, so menus sit at the picture's edges as on the GBA;
 * the map and the actors never move.
 * - What is a menu: the window layer (the text BG whose map is screen block 4, WINDOW_TILEMAP_VRAM: BG0) inside the
 *   rectangles of the live windows of the window work (gWindowWork, heap slot 15: 8 windows of 0x24 bytes at 0x500,
 *   x/y/width/height in tiles), and the sprites the OAM kernel took from menu code (oam_kernel.c tags every entry it
 *   builds with its source): the windows' own sprites (glyphs, portraits, cursors, headings: the 64 WindowSprites at
 *   0x698, 28 bytes, queued by their link at +0x10), entries in the menus' heap slots (party status, selection screens,
 *   settings, menus, icon menu: 16, 18, 19, 20, 55, 57, 58), bare entries outside GBA RAM (C locals: the "joined"
 *   portrait) at depth 238-254, and the field sprite pool's (slot 4) at depth 238-254 (a menu's party members,
 *   Render_ApplyProjectedPlacement at 251) only when inside a window. Nothing is guessed from pictures or positions.
 * - When: the OAM tags, sprite lists and heap slots are read at the VBlank (Port_PpuVBlank), the moment the VBlank copies
 *   the OAM list the coming frame shows (trap 93); an OAM entry whose words differ from its tag is not a menu. The
 *   windows are the VBlank's plus those the game opened since (their text tiles go straight into VRAM's tilemap, so
 *   they show a frame before the VBlank sees the window).
 * - Groups per axis: across, windows side by side that touch or overlap and share rows; down, windows stacked that
 *   touch or overlap and share columns (a full-screen menu is one group each way; a shop's price window and the list
 *   below it are one group down). A menu sprite goes with the window under its centre, else its own window, else a
 *   window within 8 px, else a menu sprite within 8 px that has one (a row of icons), else it stays.
 * - Anchor, per axis, from the group's extent [a, b) on the GBA's screen (S = 240 or 160): touching one edge only ->
 *   that edge; both -> the centre; neither: b <= S / 2 -> the low edge, a >= S / 2 -> the high edge, else the centre.
 *   Edge: the window moves by the frame's margin on that side (to the frame's edge); centre: it keeps its place
 *   relative to the frame's centre. A group keeps the anchor of its oldest window while that window stays open (a
 *   window opening into a group takes the group's), so nothing jumps while open; the offsets follow the frame each
 *   frame (the VBlank camera), so an anchored window stays put in the picture while the camera moves.
 * - Drawing: the window layer at a frame pixel comes from the moved window that covers it (any row of the frame,
 *   margins included), else from the GBA's own pixel where no live window is, else nothing; menu sprites are drawn
 *   moved; the GBA windows (WIN0/WIN1/OBJ) of a moved pixel are those of its source pixel; past the map's bounds
 *   (black) a moved menu is drawn over black.
 * Normal (240 x 160 frames) and Centre never lay anything out; the VBlank read only fills port statics. */
#define MENU_WINDOW_WORK (*(volatile u32 *)(uintptr_t)0x03001e8cu)
#define MENU_HEAP_SLOTS ((const volatile u32 *)(uintptr_t)0x03001e50u)
#define MENU_WINDOWS 8
#define MENU_SPRITES 0x698
#define MENU_SPRITE_SIZE 28
#define MENU_NONE 0x7FFF
extern u32 gPortOamSrc[128], gPortOamWords[128][2];
extern u8 gPortOamDepth[128];
extern s32 gPortOamCount;
int Port_MenusEdges(void);
struct MenuSnap {
  int ok;
  u32 work;
  s16 x[MENU_WINDOWS], y[MENU_WINDOWS], w[MENU_WINDOWS], h[MENU_WINDOWS]; /* pixels, clipped to the GBA's screen */
  u8 live[MENU_WINDOWS];
  s32 n;
  u32 words[128][2];
  s8 kind[128]; /* -1 not a menu, 0..7 a sprite of that window, 8 another menu sprite, 9 one only inside a window */
};
static struct MenuSnap sMenuSnap, sMenuCur; /* the VBlank's; this frame's (menu_layout) */
static u32 sMenuWorkSeen;
static int sMenuOn;                                 /* this frame: menus drawn at the edges */
static s8 sMenuAnchor[MENU_WINDOWS][2];             /* -1 low edge, 0 centre, 1 high edge */
static u32 sMenuBorn[MENU_WINDOWS];                 /* the layout a window was first seen in; 0 not live */
static u32 sMenuLayoutCount;
static s16 sMenuDx[MENU_WINDOWS], sMenuDy[MENU_WINDOWS]; /* this frame's offset of each live window */
static s16 sObjDx[128], sObjDy[128];
static s16 sMenuXO, sMenuYO; /* the GBA screen's place in the frame as last drawn */
static s16 sMenuDrawn[MENU_WINDOWS][7]; /* live, frame x, y, width, height, GBA x, y of each window as last drawn */
static u8 sObjMenu[128];
static int sMenuBg = -1;                            /* the window layer's BG, or -1 */
static s16 sMenuSrcX[WMAX], sMenuSrcY[WMAX];        /* this row: a moved menu pixel's source (window layer) */
static s16 sObjSrcX[WMAX], sObjSrcY[WMAX];          /* this row: a moved menu sprite pixel's source */

static int menu_ram(u32 a, u32 n) {
  return (a >= EWRAM_BASE && a + n <= EWRAM_BASE + 0x40000) || (a >= IWRAM_BASE && a + n <= IWRAM_BASE + 0x8000);
}
/* the heap slot whose block holds address a (the bump heap lays blocks out in order: the nearest base below) */
static int menu_heap_slot(u32 a, const u32 *base) {
  int k, best = -1;
  for (k = 0; k < 64; k++)
    if (base[k] && base[k] <= a && (base[k] >> 24) == (a >> 24) && (best < 0 || base[k] > base[best]))
      best = k;
  return best;
}
/* window slot i of the window work at ww: live (from Window_Create until the slot is freed, also while zooming open
 * or shut) with a rectangle on the GBA's screen; r = x, y, width, height in pixels, clipped to the screen */
static int menu_read_window(u32 ww, int i, s16 *r) {
  const u8 *win = (const u8 *)(uintptr_t)(ww + 0x500 + i * 0x24);
  s32 x0, y0, x1, y1;
  if (!*(const u16 *)(win + 0x10) && !*(const u16 *)(win + 0x16) && !*(const s16 *)(win + 0x1a))
    return 0;
  x0 = *(const s16 *)(win + 0xc) * 8;
  y0 = *(const s16 *)(win + 0xe) * 8;
  x1 = x0 + *(const u16 *)(win + 8) * 8;
  y1 = y0 + *(const u16 *)(win + 0xa) * 8;
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x1 > W) x1 = W;
  if (y1 > H) y1 = H;
  if (x0 >= x1 || y0 >= y1)
    return 0;
  r[0] = (s16)x0;
  r[1] = (s16)y0;
  r[2] = (s16)(x1 - x0);
  r[3] = (s16)(y1 - y0);
  return 1;
}
/* the work arrays of menu_snapshot and menu_layout are static, not locals: a vendor routine that reads an
 * uninitialised local (Message_OpenWindow's bounds[] for lines a message does not use) would see different garbage in
 * GBA RAM if these arrays took the wasm stack (masked regress RAM digests differed at Normal) */
static u32 sMenuBase[64];
static s8 sMenuOwner[64];
static s16 sMenuR[4];
static int sMenuGrp[2][MENU_WINDOWS];
static s32 sMenuLo[2][MENU_WINDOWS], sMenuHi[2][MENU_WINDOWS];
static s16 sMenuOx0[128], sMenuOy0[128], sMenuOx1[128], sMenuOy1[128];
static s8 sMenuOw[128];
static void menu_snapshot(void) {
  struct MenuSnap *s = &sMenuSnap;
  u32 ww = MENU_WINDOW_WORK, *base = sMenuBase;
  s8 *owner = sMenuOwner;
  int i, k;
  s->ok = menu_ram(ww, MENU_SPRITES + 64 * MENU_SPRITE_SIZE);
  s->work = s->ok ? ww : 0;
  for (k = 0; k < 64; k++)
    base[k] = MENU_HEAP_SLOTS[k];
  memset(owner, -1, sizeof sMenuOwner);
  for (i = 0; i < MENU_WINDOWS; i++) {
    const u8 *win = (const u8 *)(uintptr_t)(ww + 0x500 + i * 0x24);
    s16 *r = sMenuR;
    u32 sp;
    s->live[i] = 0;
    if (!s->ok)
      continue;
    /* its sprites, whether it shows on the screen or not (a portrait's window sits off the screen) */
    if (*(const u16 *)(win + 0x10) || *(const u16 *)(win + 0x16) || *(const s16 *)(win + 0x1a))
      for (sp = *(const u32 *)win, k = 0; sp && k < 64; sp = *(const u32 *)(uintptr_t)sp, k++) {
        u32 off = sp - ww - MENU_SPRITES;
        if (sp < ww + MENU_SPRITES || off >= 64 * MENU_SPRITE_SIZE || off % MENU_SPRITE_SIZE)
          break;
        owner[off / MENU_SPRITE_SIZE] = (s8)i;
      }
    if (!menu_read_window(ww, i, r))
      continue;
    s->x[i] = r[0];
    s->y[i] = r[1];
    s->w[i] = r[2];
    s->h[i] = r[3];
    s->live[i] = 1;
  }
  s->n = gPortOamCount > 128 ? 128 : gPortOamCount < 0 ? 0 : gPortOamCount;
  for (i = 0; i < s->n; i++) {
    u32 a = gPortOamSrc[i], d = gPortOamDepth[i], off = a - ww - MENU_SPRITES - 0x10;
    int slot;
    s->words[i][0] = gPortOamWords[i][0];
    s->words[i][1] = gPortOamWords[i][1];
    s->kind[i] = -1;
    if (s->ok && a >= ww + MENU_SPRITES + 0x10 && off < 64 * MENU_SPRITE_SIZE && off % MENU_SPRITE_SIZE == 0)
      s->kind[i] = owner[off / MENU_SPRITE_SIZE] >= 0 ? owner[off / MENU_SPRITE_SIZE] : 8;
    else if (!menu_ram(a, 4))
      s->kind[i] = d >= 238 && d <= 254 ? 8 : -1;
    else if ((slot = menu_heap_slot(a, base)) == 16 || slot == 18 || slot == 19 || slot == 20 || slot == 55 ||
             slot == 57 || slot == 58)
      s->kind[i] = 8;
    else if (slot == 4 && d >= 238 && d <= 254) /* a menu's party member (Render_ApplyProjectedPlacement at 251) */
      s->kind[i] = 9;
  }
}

/* one axis: the anchor of extent [a, b) on a screen of size S */
static int menu_anchor(int a, int b, int S) {
  int lo = a <= 0, hi = b >= S;
  if (lo != hi)
    return lo ? -1 : 1;
  if (lo)
    return 0;
  return b <= S / 2 ? -1 : a >= S / 2 ? 1 : 0;
}
static int menu_offset(int anchor, int frame, int gba, int o) {
  return anchor < 0 ? -o : anchor > 0 ? frame - gba - o : (frame - gba) / 2 - o;
}
static int menu_near(int ax0, int ay0, int ax1, int ay1, int bx0, int by0, int bx1, int by1, int gap) {
  return ax0 <= bx1 + gap && bx0 <= ax1 + gap && ay0 <= by1 + gap && by0 <= ay1 + gap;
}

/* the frame's layout (line 0, after the frame's size and the GBA screen's place are known) */
static int menu_root(int *p, int i) {
  while (p[i] != i)
    i = p[i];
  return i;
}
static void menu_layout(void) {
  struct MenuSnap *s = &sMenuCur;
  int (*grp)[MENU_WINDOWS] = sMenuGrp, i, j, k, ax, changed;
  s32 (*lo)[MENU_WINDOWS] = sMenuLo, (*hi)[MENU_WINDOWS] = sMenuHi;
  s16 *ox0 = sMenuOx0, *oy0 = sMenuOy0, *ox1 = sMenuOx1, *oy1 = sMenuOy1;
  s8 *ow = sMenuOw;
  u32 ww = MENU_WINDOW_WORK;
  /* the VBlank's windows, and those the game opened since: their text tiles go straight into VRAM's tilemap
   * (text_tiles.c), so they show a frame before the VBlank sees the window */
  *s = sMenuSnap;
  if (ww != s->work) /* another window work (a scene change): only the VBlank's */
    ww = 0;
  for (i = 0; i < MENU_WINDOWS; i++) {
    s16 *r = sMenuR;
    if (!s->live[i] && ww && menu_read_window(ww, i, r)) {
      s->x[i] = r[0];
      s->y[i] = r[1];
      s->w[i] = r[2];
      s->h[i] = r[3];
      s->live[i] = 1;
    }
  }
  sMenuLayoutCount++;
  if (s->work != sMenuWorkSeen) { /* a new window work: no window carries over */
    sMenuWorkSeen = s->work;
    memset(sMenuBorn, 0, sizeof sMenuBorn);
  }
  for (i = 0; i < MENU_WINDOWS; i++)
    if (!s->live[i])
      sMenuBorn[i] = 0;
    else if (!sMenuBorn[i]) {
      sMenuBorn[i] = sMenuLayoutCount;
      sMenuAnchor[i][0] = sMenuAnchor[i][1] = 2; /* given below */
    }
  for (i = 0; i < 128; i++)
    sObjMenu[i] = 0;
  sMenuBg = -1;
  for (i = 0; i < 4; i++)
    if (((IO16(R_BG0CNT + 2 * i) >> 8) & 31) == 4) {
      sMenuBg = i;
      break;
    }
  /* groups per axis: across, windows side by side that touch or overlap and share rows; down, windows stacked that
   * touch or overlap and share columns */
  for (ax = 0; ax < 2; ax++)
    for (i = 0; i < MENU_WINDOWS; i++)
      grp[ax][i] = i;
  for (i = 0; i < MENU_WINDOWS; i++)
    for (j = i + 1; j < MENU_WINDOWS; j++) {
      s32 ax0, ax1, ay0, ay1, bx0, bx1, by0, by1;
      if (!s->live[i] || !s->live[j])
        continue;
      ax0 = s->x[i]; ax1 = ax0 + s->w[i]; ay0 = s->y[i]; ay1 = ay0 + s->h[i];
      bx0 = s->x[j]; bx1 = bx0 + s->w[j]; by0 = s->y[j]; by1 = by0 + s->h[j];
      if (ax0 <= bx1 && bx0 <= ax1 && ay0 < by1 && by0 < ay1)
        grp[0][menu_root(grp[0], j)] = menu_root(grp[0], i);
      if (ay0 <= by1 && by0 <= ay1 && ax0 < bx1 && bx0 < ax1)
        grp[1][menu_root(grp[1], j)] = menu_root(grp[1], i);
    }
  for (ax = 0; ax < 2; ax++) {
    for (i = 0; i < MENU_WINDOWS; i++)
      if (s->live[i])
        grp[ax][i] = menu_root(grp[ax], i);
    for (i = 0; i < MENU_WINDOWS; i++) {
      lo[ax][i] = 0x7FFF;
      hi[ax][i] = -0x7FFF;
    }
    for (i = 0; i < MENU_WINDOWS; i++)
      if (s->live[i]) {
        int g = grp[ax][i];
        s32 a = ax ? s->y[i] : s->x[i], b = a + (ax ? s->h[i] : s->w[i]);
        if (a < lo[ax][g]) lo[ax][g] = a;
        if (b > hi[ax][g]) hi[ax][g] = b;
      }
    /* each group's anchor: its oldest window's, or new from the group's extent */
    for (i = 0; i < MENU_WINDOWS; i++)
      if (s->live[i] && grp[ax][i] == i) {
        int old = -1, an;
        for (j = 0; j < MENU_WINDOWS; j++)
          if (s->live[j] && grp[ax][j] == i && sMenuBorn[j] < sMenuLayoutCount && sMenuAnchor[j][ax] != 2 &&
              (old < 0 || sMenuBorn[j] < sMenuBorn[old]))
            old = j;
        an = old >= 0 ? sMenuAnchor[old][ax] : menu_anchor(lo[ax][i], hi[ax][i], ax ? H : W);
        for (j = 0; j < MENU_WINDOWS; j++)
          if (s->live[j] && grp[ax][j] == i) {
            sMenuAnchor[j][ax] = (s8)an;
            if (ax)
              sMenuDy[j] = (s16)menu_offset(an, LH, H, YO);
            else
              sMenuDx[j] = (s16)menu_offset(an, LW, W, XO);
          }
      }
  }
  /* menu sprites (checked against the OAM the frame shows) and the window each goes with */
  for (i = 0; i < s->n && i < 128; i++) {
    u16 a0 = OAMH[i * 4], a1 = OAMH[i * 4 + 1], a2 = OAMH[i * 4 + 2];
    int shape = a0 >> 14, sz = a1 >> 14, w, h, x, y, cx, cy, dbl = ((a0 >> 8) & 1) && ((a0 >> 9) & 1);
    ow[i] = -1;
    if (s->kind[i] < 0 || a0 != (u16)s->words[i][0] || a1 != (u16)(s->words[i][0] >> 16) || a2 != (u16)s->words[i][1])
      continue;
    if (shape == 3 || (!((a0 >> 8) & 1) && ((a0 >> 9) & 1))) /* not drawn */
      continue;
    w = OBJ_W[shape][sz] << dbl;
    h = OBJ_H[shape][sz] << dbl;
    y = a0 & 0xFF;
    if (y >= H)
      y -= 256;
    x = a1 & 0x1FF;
    if (x >= 256)
      x -= 512;
    ox0[i] = (s16)x; oy0[i] = (s16)y; ox1[i] = (s16)(x + w); oy1[i] = (s16)(y + h);
    cx = x + w / 2;
    cy = y + h / 2;
    for (j = 0; j < MENU_WINDOWS && ow[i] < 0; j++)
      if (s->live[j] && cx >= s->x[j] && cx < s->x[j] + s->w[j] && cy >= s->y[j] && cy < s->y[j] + s->h[j])
        ow[i] = (s8)j;
    if (s->kind[i] == 9 && ow[i] < 0) /* a field sprite pool entry: a menu's only inside a window */
      continue;
    sObjMenu[i] = 1;
    if (ow[i] < 0 && s->kind[i] < MENU_WINDOWS && s->live[(int)s->kind[i]])
      ow[i] = s->kind[i];
    for (j = 0; j < MENU_WINDOWS && ow[i] < 0; j++)
      if (s->live[j] && menu_near(x, y, x + w, y + h, s->x[j], s->y[j], s->x[j] + s->w[j], s->y[j] + s->h[j], 8))
        ow[i] = (s8)j;
  }
  /* chains of sprites (a row of icons beside its window) */
  do {
    changed = 0;
    for (i = 0; i < s->n && i < 128; i++)
      if (sObjMenu[i] && ow[i] < 0)
        for (k = 0; k < s->n && k < 128; k++)
          if (sObjMenu[k] && ow[k] >= 0 &&
              menu_near(ox0[i], oy0[i], ox1[i], oy1[i], ox0[k], oy0[k], ox1[k], oy1[k], 8)) {
            ow[i] = ow[k];
            changed = 1;
            break;
          }
  } while (changed);
  for (i = 0; i < MENU_WINDOWS; i++) {
    if (!s->live[i])
      sMenuAnchor[i][0] = sMenuAnchor[i][1] = 2; /* none yet */
    /* as drawn this frame (test probes: Port_MenuWindow) */
    sMenuXO = (s16)XO;
    sMenuYO = (s16)YO;
    sMenuDrawn[i][0] = s->live[i];
    sMenuDrawn[i][1] = s->x[i] + XO + sMenuDx[i];
    sMenuDrawn[i][2] = s->y[i] + YO + sMenuDy[i];
    sMenuDrawn[i][3] = s->w[i];
    sMenuDrawn[i][4] = s->h[i];
    sMenuDrawn[i][5] = s->x[i];
    sMenuDrawn[i][6] = s->y[i];
  }
  for (i = 0; i < 128; i++) {
    sObjDx[i] = sObjDy[i] = 0;
    if (i < s->n && sObjMenu[i] && ow[i] >= 0) {
      sObjDx[i] = sMenuDx[(int)ow[i]];
      sObjDy[i] = sMenuDy[(int)ow[i]];
    }
  }
}

/* test probes (tests/probes/menujitter.cjs): window i as the last frame drew it (what: 0 live and moved, 1 frame x,
 * 2 frame y, 3 width, 4 height, 5 GBA x, 6 GBA y; pixels; i -1: what 0 / 1 the GBA screen's place in the frame), or
 * -1 when that frame did not lay menus out */
int Port_MenuWindow(int i, int what) {
  if (sMenuOn && i == -1 && (what == 0 || what == 1))
    return what ? sMenuYO : sMenuXO;
  if (!sMenuOn || i < 0 || i >= MENU_WINDOWS || what < 0 || what > 6)
    return -1;
  return sMenuDrawn[i][what];
}

/* test probes: OAM entry i as the last frame drew it (what: 0 a moved menu sprite, 1 its x offset, 2 its y offset), or
 * -1 when that frame did not lay menus out */
int Port_MenuSprite(int i, int what) {
  if (!sMenuOn || i < 0 || i >= 128 || what < 0 || what > 2)
    return -1;
  return what == 0 ? sObjMenu[i] : what == 1 ? sObjDx[i] : sObjDy[i];
}

/* frame row v: for each frame column, the window-layer pixel it shows (GBA x, line), or MENU_NONE */
static void menu_row_sources(int v) {
  const struct MenuSnap *s = &sMenuCur;
  int x, k;
  for (x = 0; x < LW; x++) {
    int gx = x - XO, sx = MENU_NONE, sy = MENU_NONE, inside = 0;
    for (k = 0; k < MENU_WINDOWS; k++) {
      int tx, ty;
      if (!s->live[k])
        continue;
      tx = gx - sMenuDx[k];
      ty = v - sMenuDy[k];
      if (tx >= s->x[k] && tx < s->x[k] + s->w[k] && ty >= s->y[k] && ty < s->y[k] + s->h[k]) {
        sx = tx;
        sy = ty;
        break;
      }
    }
    if (sx == MENU_NONE && gx >= 0 && gx < W && v >= 0 && v < H) {
      for (k = 0; k < MENU_WINDOWS && !inside; k++)
        inside = s->live[k] && gx >= s->x[k] && gx < s->x[k] + s->w[k] && v >= s->y[k] && v < s->y[k] + s->h[k];
      if (!inside) { /* the window layer's own pixel where no window is (left as the game drew it) */
        sx = gx;
        sy = v;
      }
    }
    sMenuSrcX[x] = (s16)sx;
    sMenuSrcY[x] = (s16)sy;
  }
}

/* a still-picture frame: the margins of row v as layer BG1, the last moving frame's BG2 over BG3 (by their priority) */
static u16 sStillRow[WMAX], sStillTmp[2][WMAX];
static void wm_still_row(int v, int real) {
  int x, front = (sWmSnap.cnt[1] & 3) < (sWmSnap.cnt[0] & 3); /* BG3 in front only with a lower priority number */
  wm_layer(sStillTmp[0], 2, v, real, &sWmSnap, sSnapVram, 1);
  wm_layer(sStillTmp[1], 3, v, real, &sWmSnap, sSnapVram, 1);
  for (x = 0; x < LW; x++) {
    u16 a = sStillTmp[front][x], b = sStillTmp[!front][x];
    sStillRow[x] = a != TRANSPARENT ? a : b;
  }
}

/* row v of the frame (v = line on the GBA's lines; v < 0 or >= 160 a zoom margin row, drawn with line 0's or line
 * 159's registers) */
static void text_bg(int bg, int line, int v) {
  u16 cnt = rd16(R_BG0CNT + 2 * bg);
  u32 hofs = rd16(R_BG0HOFS + 4 * bg) & 0x1FF, vofs = rd16(R_BG0HOFS + 2 + 4 * bg) & 0x1FF;
  u32 charBase = ((cnt >> 2) & 3) * 0x4000, screenBase = ((cnt >> 8) & 31) * 0x800;
  int color256 = (cnt >> 7) & 1, size = cnt >> 14;
  u32 wmask = (size & 1) ? 511 : 255, hmask = (size & 2) ? 511 : 255;
  /* GS30: on a World Map frame the plain layers but BG0 (BG1's fill on the lines a transition switches to mode 0, as
   * the encounter's centre line does) go on past the GBA's screen as the hardware wraps them; BG0 holds windows */
  int wrapOn = worldZoom && bg != 0;
  u32 y = ((wrapOn ? v : line) + vofs) & hmask;
  u16 *out = bgLine[bg];
  int x;
  int real = v == line;
  if (sMenuOn && bg == sMenuBg) { /* GS33: the window layer with its windows moved (menu_row_sources) */
    menu_row_sources(v);
    for (x = 0; x < LW; x++) {
      u32 px, py, tile, tx, ty, ci, block;
      u16 entry;
      if (sMenuSrcX[x] == MENU_NONE) {
        out[x] = TRANSPARENT;
        continue;
      }
      px = ((u32)sMenuSrcX[x] + hofs) & wmask;
      py = ((u32)sMenuSrcY[x] + vofs) & hmask;
      block = (px >> 8) + ((py >> 8) * ((size & 1) ? 2 : 1));
      entry = *(u16 *)(VRAM + screenBase + block * 0x800 + (((py & 255) >> 3) * 32 + ((px & 255) >> 3)) * 2);
      tile = entry & 0x3FF;
      tx = px & 7;
      ty = py & 7;
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
    return;
  }
  /* GS34: under a full-screen menu every layer but the window layer comes from the last uncovered frame (cover_frame) */
  int frozen = (sCoverOn || sCoverBlack) && screenBase != 4 * 0x800;
  const u8 *vram = sCoverOn && frozen ? sMapVram : VRAM;           /* margins */
  const u16 *pal = sCoverOn && frozen ? sMapPal : PAL;
  const u8 *gvram = sMenuOn ? vram : VRAM;                         /* the GBA's pixels */
  const u16 *gpal = sMenuOn ? pal : PAL;
  /* map zoom: a field map layer's margins from the map grid, at its full scroll (gBgScroll, with this line's
   * register offsets); other layers are empty there */
  int mapLayer = fieldCandidate && bg >= 1 && size == 0 && screenBase == (u32)(5 + 3 - bg) * 0x800;
  s32 fullX = 0, fullY = 0;
  if (mapLayer) {
    s32 sx = gBgScroll[bg].x, sy = gBgScroll[bg].y;
    int e;
    fullX = sx + ((s32)(((hofs - (u32)sx) & 0x1FF) << 23) >> 23);
    fullY = sy + ((s32)(((vofs - (u32)sy) & 0x1FF) << 23) >> 23) + line;
    /* only where the BG map is what the grid says: its first and last columns on this line must match the cells
     * (a scene that draws its own pictures into these BGs, e.g. the title's naming screen, gets empty margins) */
    for (e = 0; e < 2 && mapLayer; e++) {
      s32 gx = e ? W - 1 : 0;
      u32 px = (gx + hofs) & 255;
      u16 got = *(u16 *)(vram + screenBase + ((y >> 3) * 32 + (px >> 3)) * 2);
      s32 fx = fullX + gx;
      u32 cell = MAP_CELLS[((fullY >> 4) & 127) * 128 + ((fx >> 4) & 127)];
      if (got != CELL_PICTURES[(cell & 0xFFF) * 4 + ((fullY >> 3) & 1) * 2 + ((fx >> 3) & 1)])
        mapLayer = 0;
    }
    if (mapLayer && real)
      sLineMatched = 1;
    if (!fieldZoom)
      mapLayer = 0;
    fullY += v - line;
  }
  int black = frozen && sCoverBlack; /* no uncovered frame to take them from: left out (the GBA's own pixels kept) */
  if (worldStill && bg == 1) /* GS30: the still picture's margins: the last moving frame's ground */
    wm_still_row(v, real);
  for (x = 0; x < LW; x++) {
    int gx = x - XO;
    u32 px, tile, tx, ty, ci;
    u16 entry;
    int gba = (real && gx >= 0 && gx < W) || wrapOn;
    const u8 *vm = gba ? gvram : vram;
    const u16 *pl = gba ? gpal : pal;
    if (black && (sMenuOn || !gba)) {
      out[x] = TRANSPARENT;
      continue;
    }
    if (gba) {
      u32 block;
      px = (gx + hofs) & wmask;
      block = (px >> 8) + ((y >> 8) * ((size & 1) ? 2 : 1));
      entry = *(u16 *)(vm + screenBase + block * 0x800 + (((y & 255) >> 3) * 32 + ((px & 255) >> 3)) * 2);
      ty = y & 7;
    } else if (mapLayer) {
      s32 fx = fullX + gx;
      u32 cell = MAP_CELLS[((fullY >> 4) & 127) * 128 + ((fx >> 4) & 127)];
      entry = CELL_PICTURES[(cell & 0xFFF) * 4 + ((fullY >> 3) & 1) * 2 + ((fx >> 3) & 1)];
      px = (u32)fx;
      ty = (u32)fullY & 7;
    } else {
      out[x] = worldStill && bg == 1 ? sStillRow[x] : TRANSPARENT;
      continue;
    }
    tile = entry & 0x3FF;
    tx = px & 7;
    if (entry & 0x400)
      tx = 7 - tx;
    if (entry & 0x800)
      ty = 7 - ty;
    if (color256) {
      u32 a = charBase + tile * 64 + ty * 8 + tx;
      ci = a < 0x10000 ? vm[a] : 0;
      out[x] = ci ? pl[ci] & 0x7FFF : TRANSPARENT;
    } else {
      u32 a = charBase + tile * 32 + ty * 4 + (tx >> 1);
      ci = a < 0x10000 ? (vm[a] >> ((tx & 1) * 4)) & 15 : 0;
      out[x] = ci ? pl[(entry >> 12) * 16 + ci] & 0x7FFF : TRANSPARENT;
    }
  }
}

static void affine_bg(int bg, int real, int v) {
  int i = bg - 2;
  u16 cnt = rd16(R_BG0CNT + 2 * bg);
  s32 pa = (s16)rd16(R_BG2PA + 0x10 * i), pc = (s16)rd16(R_BG2PA + 4 + 0x10 * i);
  u32 charBase = ((cnt >> 2) & 3) * 0x4000, screenBase = ((cnt >> 8) & 31) * 0x800;
  u32 size = 128u << (cnt >> 14);
  int wrap = (cnt >> 13) & 1;
  s32 x0 = refX[i] - pa * XO, y0 = refY[i] - pc * XO;
  u16 *out = bgLine[bg];
  int x;
  if (worldZoom) { /* GS30: the World Map's moving view */
    wm_layer(out, bg, v, real, &sWm, NULL, 0);
    return;
  }
  if (!real) { /* map zoom: a margin row */
    for (x = 0; x < LW; x++)
      out[x] = TRANSPARENT;
    return;
  }
  for (x = 0; x < LW; x++, x0 += pa, y0 += pc) {
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


/* sprites on frame row v (see text_bg). On the GBA's lines OAM y 160-255 is above the screen, as on the GBA; on a
 * margin row a sprite is below the screen up to the frame's last row (OAM y < 160 + gPortZoomB, as Sprite_Draw
 * queues them) and above it from there. The OAM build fills unused entries with 0x00C000C0 words (y 192, x 192,
 * tile 0xC0: off the GBA's screen; oam_kernel.c): with a bottom margin over 32 rows y 192 is on it, so margin rows
 * skip exactly those entries */
/* GS34: a sprite the GBA shows nowhere on its 240 x 160, which the zoomed frame's wider OAM range would draw in the
 * margins: menus park unused sprites off the screen (the Status screen's page arrows at x 256 / y 216 or x 248 / y 168,
 * its Djinn figures at y 210 on the pages that do not show them). Not drawn on a zoomed frame when it is a menu's (by
 * the VBlank's OAM tags) or when a full-screen menu covers the GBA's screen (then the margins hold only the map's
 * snapshot and the menus; the Djinn figures are field sprites, like the actors). Field actors in the margins of an
 * uncovered frame are still drawn. */
static int menu_parked(int i, u16 a0, u16 a1, int bw, int bh) {
  const struct MenuSnap *s = &sMenuSnap;
  int y = a0 & 0xFF, x = a1 & 0x1FF, rows, cols;
  if (!sCoverOn && !sCoverBlack &&
      (!s->ok || i >= s->n || s->kind[i] < 0 || s->words[i][0] != ((u32)a0 | (u32)a1 << 16)))
    return 0;
  rows = y < H || y + bh > 256;  /* some line 0..159 is inside (the 8-bit y wraps past 255) */
  cols = x < W || x + bw > 512;  /* some column 0..239 is inside (the 9-bit x wraps past 511) */
  return !rows || !cols;
}
static void sprites(int v, u16 dispcnt) {
  int real = v >= 0 && v < H, below = real ? H : H + gPortZoomB;
  int i;
  int map1d = (dispcnt >> 6) & 1;
  for (i = 0; i < LW; i++) {
    objLine[i] = TRANSPARENT;
    objPrio[i] = 4;
    objSemi[i] = 0;
    objWin[i] = 0;
    sObjSrcX[i] = MENU_NONE;
  }
  if (!(dispcnt & 0x1000))
    return;
  for (i = 0; i < 128; i++) {
    u16 a0 = OAMH[i * 4], a1 = OAMH[i * 4 + 1], a2 = OAMH[i * 4 + 2];
    int affine = (a0 >> 8) & 1, dbl = (a0 >> 9) & 1, mode = (a0 >> 10) & 3, c256 = (a0 >> 13) & 1;
    int shape = a0 >> 14, sz = a1 >> 14;
    int w, h, bw, bh, y, x, sx, prio = (a2 >> 10) & 3;
    int menu = sMenuOn && sObjMenu[i]; /* GS33: a menu sprite, placed as on the GBA and moved with its block */
    s32 pa = 256, pb = 0, pc = 0, pd = 256;
    u32 tile = a2 & 0x3FF;
    if (!affine && dbl)
      continue; /* disabled */
    if (!real && !menu && a0 == 0x00C0 && a1 == 0x00C0 && a2 == 0x00C0)
      continue; /* a hidden entry (map zoom margin rows only) */
    if (shape == 3 || mode == 3)
      continue;
    w = OBJ_W[shape][sz];
    h = OBJ_H[shape][sz];
    bw = w << (affine && dbl);
    bh = h << (affine && dbl);
    y = a0 & 0xFF;
    x = a1 & 0x1FF;
    if (LW != W && menu_parked(i, a0, a1, bw, bh))
      continue;
    if (menu) {
      if (y >= H)
        y -= 256;
      if (x >= 256)
        x -= 512;
      y += sObjDy[i];
      x += sObjDx[i];
    } else {
      if (y >= below)
        y -= 256;
      if (x >= 240 + LW - W - XO) /* map zoom: OAM x up to 240 + the right margin - 1 is on screen, from 512 - XO the left */
        x -= 512;
    }
    if (v < y || v >= y + bh)
      continue;
    if (affine) {
      int p = (a1 >> 9) & 31;
      pa = (s16)OAMH[p * 16 + 3];
      pb = (s16)OAMH[p * 16 + 7];
      pc = (s16)OAMH[p * 16 + 11];
      pd = (s16)OAMH[p * 16 + 15];
    }
    for (sx = 0; sx < bw; sx++) {
      int px = x + sx + XO, tx, ty;
      u32 ci, col, addr, tnum;
      if (px < 0 || px >= LW)
        continue;
      if (affine) {
        s32 dx = sx - bw / 2, dy = v - y - bh / 2;
        tx = ((pa * dx + pb * dy) >> 8) + w / 2;
        ty = ((pc * dx + pd * dy) >> 8) + h / 2;
        if (tx < 0 || ty < 0 || tx >= w || ty >= h)
          continue;
      } else {
        tx = sx;
        ty = v - y;
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
        sObjSrcX[px] = menu ? (s16)(px - XO - sObjDx[i]) : MENU_NONE;
        sObjSrcY[px] = (s16)(v - sObjDy[i]);
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

/* frame row v (the GBA's line `line`, or a zoom margin row drawn with that line's registers) */
static void render_row(int line, int v) {
  u16 dispcnt = rd16(R_DISPCNT);
  int mode = dispcnt & 7, bg, x;
  u32 *out;
  int enabled[4] = {0, 0, 0, 0};
  u16 bldcnt, bldalpha, bldy;
  u32 eva, evb, evy;
  int effect;
  u16 winin, winout;
  int winOn = (dispcnt >> 13) & 7;
  int w0x1, w0x2, w0y1, w0y2, w1x1, w1x2, w1y1, w1y2, in0, in1;
  u8 bgPrio[4];

  int real = v == line;
  /* GS34: under a full-screen menu the backdrop is the snapshot's too (or black without one) */
  u16 bdLive = PAL[0] & 0x7FFF, bdMap = (sCoverOn ? sMapPal[0] : sCoverBlack ? 0 : PAL[0]) & 0x7FFF;
  out = gPortFrame + (v + YO) * LW;
  if (dispcnt & 0x80) { /* forced blank: white */
    for (x = 0; x < LW; x++)
      out[x] = 0xFFFFFFFFu;
    return;
  }
  if (mode > 2) { /* bitmap modes: not used by the title (G4 if ever needed) */
    for (x = 0; x < LW; x++)
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
      text_bg(bg, line, v);
    else
      affine_bg(bg, real, v);
  }
  sprites(v, dispcnt);

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

  for (x = 0; x < LW; x++) {
    u32 mask = 0x3F; /* layers 0-4 and the effect bit 5 */
    u16 top = sMenuOn || !real || x < XO || x >= XO + W ? bdMap : bdLive, second = top;
    int topL = L_BD, secondL = L_BD, topP = 4, secondP = 4;
    int semi = 0;
    int wx = x - XO; /* map zoom: the margins take the windows of the GBA screen's edge column (and edge line) */
    int onlyMenu = 0, i0 = in0, i1 = in1;
    if (sMenuOn) { /* GS33: a moved menu's pixel takes its source pixel's windows */
      int sx = MENU_NONE, sy = 0;
      if (sMenuBg >= 0 && enabled[sMenuBg] && sMenuSrcX[x] != MENU_NONE && bgLine[sMenuBg][x] != TRANSPARENT) {
        sx = sMenuSrcX[x];
        sy = sMenuSrcY[x];
      } else if (sObjSrcX[x] != MENU_NONE && objLine[x] != TRANSPARENT) {
        sx = sObjSrcX[x];
        sy = sObjSrcY[x];
      }
      if (sx != MENU_NONE) {
        int oob = wx < sBoundL || wx >= sBoundR || v < sBoundT || v >= sBoundB;
        if ((!real || wx < 0 || wx >= W) && oob) {
          onlyMenu = 1; /* past the map's edge: the menu over black */
          top = second = 0;
        }
        wx = sx < 0 ? 0 : sx >= W ? W - 1 : sx;
        sy = sy < 0 ? 0 : sy >= H ? H - 1 : sy;
        if (sy != line) {
          i0 = (winOn & 1) && (w0y1 <= w0y2 ? sy >= w0y1 && sy < w0y2 : sy >= w0y1 || sy < w0y2);
          i1 = (winOn & 2) && (w1y1 <= w1y2 ? sy >= w1y1 && sy < w1y2 : sy >= w1y1 || sy < w1y2);
        }
      }
    }
    if (!onlyMenu && (!real || wx < 0 || wx >= W)) {
      if (!sZoomOn || wx < sBoundL || wx >= sBoundR || v < sBoundT || v >= sBoundB) { /* past the map's edge: black */
        out[x] = 0xFF000000u;
        continue;
      }
      wx = wx < 0 ? 0 : wx >= W ? W - 1 : wx;
    }
    if (winOn) {
      if (i0 && (w0x1 <= w0x2 ? wx >= w0x1 && wx < w0x2 : wx >= w0x1 || wx < w0x2))
        mask = winin & 0x3F;
      else if (i1 && (w1x1 <= w1x2 ? wx >= w1x1 && wx < w1x2 : wx >= w1x1 || wx < w1x2))
        mask = (winin >> 8) & 0x3F;
      else if ((winOn & 4) && objWin[x])
        mask = (winout >> 8) & 0x3F;
      else
        mask = winout & 0x3F;
    }
    /* BGs: lower priority number wins, then lower BG number */
    for (bg = 3; bg >= 0; bg--) {
      u16 c;
      if (!enabled[bg] || !((mask >> bg) & 1) || (onlyMenu && bg != sMenuBg))
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
    if (objLine[x] != TRANSPARENT && ((mask >> 4) & 1) && (!onlyMenu || sObjSrcX[x] != MENU_NONE)) {
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
}

void Port_PpuLine(int line) {
  int i, v;
  if (line == 0) { /* GS29: the frame's size and the GBA screen's place in it, fixed for the whole frame */
    int level = Port_ZoomLevel();
    sMatchPrev = fieldCandidate ? sMatchLines : 0;
    sMatchLines = 0;
    fieldCandidate = level > 0 && level < ZOOM_LEVELS && sStamped && Port_FrameCount() - sFieldStamp <= 2;
    /* GS30: the World Map: its moving view, or its still picture with the last moving frame kept */
    worldZoom = worldStill = 0;
    if (level > 0 && level < ZOOM_LEVELS && sInField && wm_config()) {
      u16 dispcnt = IO16(R_DISPCNT);
      if (IO16(0x00A) != 0x682)
        worldZoom = 1;
      else if (sSnapOk && (dispcnt & 7) == 0 && (dispcnt & 0x0C00) == 0x0C00)
        worldStill = 1;
    }
    if (!worldZoom && !worldStill)
      sSnapOk = 0;
    if (worldZoom || worldStill)
      fieldCandidate = 0;
    fieldZoom = fieldCandidate && sMatchPrev >= ZOOM_MIN_LINES;
    sZoomOn = fieldZoom || worldZoom || worldStill;
    if (fieldZoom)
      zoom_frame(level);
    else if (worldZoom || worldStill) {
      LW = ZOOM_W[level];
      LH = ZOOM_H[level];
      XO = (LW - W) / 2;
      YO = (LH - H) / 2;
      sBoundL = sBoundT = -WMAX;
      sBoundR = sBoundB = WMAX + W;
      memcpy(sIoSnap, (const void *)(uintptr_t)IO_BASE, IO_SNAP_BYTES);
      if (worldZoom)
        wm_scan(&sWm);
    } else {
      LW = W;
      LH = H;
      XO = YO = 0;
    }
    cover_frame(fieldZoom ? 1 : worldStill ? 2 : 0); /* GS34 */
    /* GS33: menus at the frame's edges */
    sMenuOn = sZoomOn && (LW != W || LH != H) && Port_MenusEdges() && sMenuSnap.ok;
    if (sMenuOn)
      menu_layout();
    gPortZoomL = XO;
    gPortZoomR = LW - W - XO;
    gPortZoomT = YO;
    gPortZoomB = LH - H - YO;
  }
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
    if (worldZoom) { /* GS30: the line's terms, for its extra columns and the fit */
      struct WmLine *ln = &sWm.lines[i][line];
      ln->x = refX[i];
      ln->y = refY[i];
      ln->pa = (s16)rd16(R_BG2PA + 0x10 * i);
      ln->pc = (s16)rd16(R_BG2PA + 4 + 0x10 * i);
    }
  }
  if (line == 0 && !worldZoom && !worldStill)
    for (v = -YO; v < 0; v++)
      render_row(0, v);
  sLineMatched = 0;
  render_row(line, line);
  sMatchLines += sLineMatched;
  if (line == H - 1) {
    if (worldZoom)
      wm_fit(&sWm);
    for (v = H; v < LH - YO; v++)
      render_row(H - 1, v);
    if (worldZoom || worldStill) { /* the top rows, with line 0's registers */
      sUseIoSnap = 1;
      for (v = -YO; v < 0; v++)
        render_row(0, v);
      sUseIoSnap = 0;
    }
    if (worldZoom) { /* kept for a still picture's margins */
      sWmSnap = sWm;
      memcpy(sSnapVram, VRAM + 0x4000, 0x2000);
      memcpy(sSnapVram + 0x2000, VRAM + 0x8000, 0x8000);
      memcpy(sSnapCells, WM_CELLS, 0x2000);
      sSnapOk = 1;
    }
  }
  /* affine reference points step by PB/PD for the next line */
  for (i = 0; i < 2; i++) {
    refX[i] += (s16)rd16(R_BG2PA + 2 + 0x10 * i);
    refY[i] += (s16)rd16(R_BG2PA + 6 + 0x10 * i);
  }
}

u32 *Port_FrameBuffer(void) { return gPortFrame; }
#endif /* PORT_GAME_TLA */
