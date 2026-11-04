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
static void zoom_frame(int level) {
  u32 g = MAP_GRID_WORK_PTR;
  int fw = ZOOM_W[level], fh = ZOOM_H[level];
  sBoundL = -fw;
  sBoundR = W + fw;
  sBoundT = -fh;
  sBoundB = H + fh;
  if (g >= EWRAM_BASE && g + 0x194 <= EWRAM_BASE + 0x40000) {
    s32 viewX = *(s32 *)(uintptr_t)(g + 0xe4) >> 16, viewY = *(s32 *)(uintptr_t)(g + 0xe8) >> 16;
    s32 minX = *(s32 *)(uintptr_t)(g + 0xec) >> 16, minY = *(s32 *)(uintptr_t)(g + 0xf0) >> 16;
    s32 maxX = *(s32 *)(uintptr_t)(g + 0xf4) >> 16, maxY = *(s32 *)(uintptr_t)(g + 0xf8) >> 16;
    if (minX < maxX && minY < maxY) {
      sBoundL = minX - viewX;
      sBoundR = maxX - viewX;
      sBoundT = minY - viewY;
      sBoundB = maxY - viewY;
    }
  }
  LW = fw;
  LH = fh;
  XO = zoom_offset(fw, W, sBoundL, sBoundR);
  YO = zoom_offset(fh, H, sBoundT, sBoundB);
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

/* row v of the frame (v = line on the GBA's lines; v < 0 or >= 160 a zoom margin row, drawn with line 0's or line
 * 159's registers) */
static void text_bg(int bg, int line, int v) {
  u16 cnt = rd16(R_BG0CNT + 2 * bg);
  u32 hofs = rd16(R_BG0HOFS + 4 * bg) & 0x1FF, vofs = rd16(R_BG0HOFS + 2 + 4 * bg) & 0x1FF;
  u32 charBase = ((cnt >> 2) & 3) * 0x4000, screenBase = ((cnt >> 8) & 31) * 0x800;
  int color256 = (cnt >> 7) & 1, size = cnt >> 14;
  u32 wmask = (size & 1) ? 511 : 255, hmask = (size & 2) ? 511 : 255;
  u32 y = (line + vofs) & hmask;
  u16 *out = bgLine[bg];
  int x;
  int real = v == line;
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
      u16 vram = *(u16 *)(VRAM + screenBase + ((y >> 3) * 32 + (px >> 3)) * 2);
      s32 fx = fullX + gx;
      u32 cell = MAP_CELLS[((fullY >> 4) & 127) * 128 + ((fx >> 4) & 127)];
      if (vram != CELL_PICTURES[(cell & 0xFFF) * 4 + ((fullY >> 3) & 1) * 2 + ((fx >> 3) & 1)])
        mapLayer = 0;
    }
    if (mapLayer && real)
      sLineMatched = 1;
    if (!fieldZoom)
      mapLayer = 0;
    fullY += v - line;
  }
  for (x = 0; x < LW; x++) {
    int gx = x - XO;
    u32 px, tile, tx, ty, ci;
    u16 entry;
    if (real && gx >= 0 && gx < W) {
      u32 block;
      px = (gx + hofs) & wmask;
      block = (px >> 8) + ((y >> 8) * ((size & 1) ? 2 : 1));
      entry = *(u16 *)(VRAM + screenBase + block * 0x800 + (((y & 255) >> 3) * 32 + ((px & 255) >> 3)) * 2);
      ty = y & 7;
    } else if (mapLayer) {
      s32 fx = fullX + gx;
      u32 cell = MAP_CELLS[((fullY >> 4) & 127) * 128 + ((fx >> 4) & 127)];
      entry = CELL_PICTURES[(cell & 0xFFF) * 4 + ((fullY >> 3) & 1) * 2 + ((fx >> 3) & 1)];
      px = (u32)fx;
      ty = (u32)fullY & 7;
    } else {
      out[x] = TRANSPARENT;
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
      ci = a < 0x10000 ? VRAM[a] : 0;
      out[x] = ci ? PAL[ci] & 0x7FFF : TRANSPARENT;
    } else {
      u32 a = charBase + tile * 32 + ty * 4 + (tx >> 1);
      ci = a < 0x10000 ? (VRAM[a] >> ((tx & 1) * 4)) & 15 : 0;
      out[x] = ci ? PAL[(entry >> 12) * 16 + ci] & 0x7FFF : TRANSPARENT;
    }
  }
}

static void affine_bg(int bg, int real) {
  int i = bg - 2;
  u16 cnt = rd16(R_BG0CNT + 2 * bg);
  s32 pa = (s16)rd16(R_BG2PA + 0x10 * i), pc = (s16)rd16(R_BG2PA + 4 + 0x10 * i);
  u32 charBase = ((cnt >> 2) & 3) * 0x4000, screenBase = ((cnt >> 8) & 31) * 0x800;
  u32 size = 128u << (cnt >> 14);
  int wrap = (cnt >> 13) & 1;
  s32 x0 = refX[i] - pa * XO, y0 = refY[i] - pc * XO;
  u16 *out = bgLine[bg];
  int x;
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

static const u8 OBJ_W[3][4] = {{8, 16, 32, 64}, {16, 32, 32, 64}, {8, 8, 16, 32}};
static const u8 OBJ_H[3][4] = {{8, 16, 32, 64}, {8, 8, 16, 32}, {16, 32, 32, 64}};

/* sprites on frame row v (see text_bg). On the GBA's lines OAM y 160-255 is above the screen, as on the GBA; on a
 * margin row a sprite is below the screen up to the frame's last row (OAM y < 160 + gPortZoomB, as Sprite_Draw
 * queues them) and above it from there (the hidden entries' y 192 is never on a margin row: oam_kernel.c) */
static void sprites(int v, u16 dispcnt) {
  int below = v >= 0 && v < H ? H : H + gPortZoomB;
  int i;
  int map1d = (dispcnt >> 6) & 1;
  for (i = 0; i < LW; i++) {
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
    if (y >= below)
      y -= 256;
    if (v < y || v >= y + bh)
      continue;
    x = a1 & 0x1FF;
    if (x >= 240 + LW - W - XO) /* map zoom: OAM x up to 240 + the right margin - 1 is on screen, from 512 - XO the left */
      x -= 512;
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
      affine_bg(bg, real);
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
    u16 top = PAL[0] & 0x7FFF, second = top;
    int topL = L_BD, secondL = L_BD, topP = 4, secondP = 4;
    int semi = 0;
    int wx = x - XO; /* map zoom: the margins take the windows of the GBA screen's edge column (and edge line) */
    if (!real || wx < 0 || wx >= W) {
      if (!fieldZoom || wx < sBoundL || wx >= sBoundR || v < sBoundT || v >= sBoundB) { /* past the map's edge: black */
        out[x] = 0xFF000000u;
        continue;
      }
      wx = wx < 0 ? 0 : wx >= W ? W - 1 : wx;
    }
    if (winOn) {
      if (in0 && (w0x1 <= w0x2 ? wx >= w0x1 && wx < w0x2 : wx >= w0x1 || wx < w0x2))
        mask = winin & 0x3F;
      else if (in1 && (w1x1 <= w1x2 ? wx >= w1x1 && wx < w1x2 : wx >= w1x1 || wx < w1x2))
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
}

void Port_PpuLine(int line) {
  int i, v;
  if (line == 0) { /* GS29: the frame's size and the GBA screen's place in it, fixed for the whole frame */
    int level = Port_ZoomLevel();
    sMatchPrev = fieldCandidate ? sMatchLines : 0;
    sMatchLines = 0;
    fieldCandidate = level > 0 && level < ZOOM_LEVELS && sStamped && Port_FrameCount() - sFieldStamp <= 2;
    fieldZoom = fieldCandidate && sMatchPrev >= ZOOM_MIN_LINES;
    if (fieldZoom)
      zoom_frame(level);
    else {
      LW = W;
      LH = H;
      XO = YO = 0;
    }
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
  }
  if (line == 0)
    for (v = -YO; v < 0; v++)
      render_row(0, v);
  sLineMatched = 0;
  render_row(line, line);
  sMatchLines += sLineMatched;
  if (line == H - 1)
    for (v = H; v < LH - YO; v++)
      render_row(H - 1, v);
  /* affine reference points step by PB/PD for the next line */
  for (i = 0; i < 2; i++) {
    refX[i] += (s16)rd16(R_BG2PA + 2 + 0x10 * i);
    refY[i] += (s16)rd16(R_BG2PA + 6 + 0x10 * i);
  }
}

u32 *Port_FrameBuffer(void) { return gPortFrame; }
#endif /* PORT_GAME_TLA */
