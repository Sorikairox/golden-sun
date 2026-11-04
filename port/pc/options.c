/* GS27: the port's own settings, shown in the game itself ("Extra settings", drawn with the game's windows, font,
 * pointing hand through the game's own window functions; no vendor code copied). GS29: no floating heading (the
 * "Settings" picture GS27 showed above it; the game shows that heading on its own Change settings screen only).
 *
 * Reached from the game's Pause menu (START on the field): press R on the Pause menu, or R in "Change settings"
 * (whose help line shows "R: More" when it fits). port/c_rules.tsv adds those two key tests and the dispatch in
 * PauseMenu_Run; nothing else in the game changes, so with the screen never opened the game runs exactly as before.
 *
 * The options themselves belong to the page (presentation only: game memory, hashes and link sessions are never
 * affected): the screen edits Port_Opt[], the page reads it each frame (Port_OptGeneration) and applies/stores it,
 * and the page's own menu writes it back (Port_OptSet). Rows:
 *   0 Screen colours  Original / GBA LCD          (page: gs-lcd, the GS10 LCD curve)
 *   1 Brightness      Normal / Bright / Brighter   (page: gs-bright, a gamma lift on the canvas copy)
 *   2 Map zoom        Normal / More / Most         (page: gs-zoom; GS29, replaces GS27's Wide view: the field map at
 *                     240 x 160, 288 x 192 or 336 x 224, scaled by the page into the same box; ppu.c, c_rules) */
#include "gba.h"

struct Window;
struct WindowSprite;
struct Window *Window_Create(s32 x, s32 y, s32 width, s32 height, s32 attrs);
void Window_Close(struct Window *window, s32 instant);
void Window_ClearInteriorTiles(const struct Window *window, u32 left, u32 top, u32 right, u32 bottom);
void Window_DrawDividerLine(struct Window *win, u32 x1, u32 y1, u32 x2, u32 y2);
void Text_DrawStringAtOffset(const u8 *text, const struct Window *window, s32 offsetX, s32 offsetY);
void Text_DrawString(const u8 *text, struct Window *window, s32 x, s32 y);
void Text_MeasureMessage(s32 message, s32 *x, s32 *y);
void WindowSprite_ClearList(void *sprites);
struct WindowSprite *WindowSprite_Create(s32 slot, s32 oamFlags, struct Window *window, s32 offsetX, s32 offsetY);
s32 VramCache_FindFreeEntry(void);
s32 VramCache_Load(u32 no, u32 size, const void *src);
void Sound_PlayFar(s32 id);
void wait(s32 frames);
struct PortMenuCursor { /* the game's struct MenuCursor (window/cursor.h, 16 bytes) */
  struct WindowSprite *anchor;
  u16 x, y;
  s16 targetX, targetY;
  s8 active, kind;
  u8 pad[2];
};
void MenuCursor_AdvanceFar(struct PortMenuCursor *cursor);
void MenuCursor_SetFar(struct PortMenuCursor *cursor, s32 targetX, s32 targetY, s32 frames);
void MenuCursor_SetPositionImmediateFar(struct PortMenuCursor *cursor, s32 x, s32 y);
extern volatile u32 gKeysPressed;
extern volatile u32 gKeysRepeat;
extern u8 gPointingHandTiles[];

#define K_A 1
#define K_B 2
#define K_START 8
#define K_RIGHT 16
#define K_LEFT 32
#define K_UP 64
#define K_DOWN 128
#define WINDOW_FLAG_INSTANT 2
#define OUTPUT_SIZE_16X16 0x40000000
#define VRAM_CACHE_ENTRIES 96

/* ---- the option values (shared with the page) ---- */
enum { OPT_LCD, OPT_BRIGHT, OPT_ZOOM, OPT_COUNT };
static const u8 sCount[OPT_COUNT] = {2, 3, 3};
static u8 sOpt[OPT_COUNT];
static u32 sOptGeneration;
s32 Port_OptGet(s32 i) { return i >= 0 && i < OPT_COUNT ? sOpt[i] : 0; }
void Port_OptSet(s32 i, s32 v) {   /* from the page: no generation bump */
  if (i >= 0 && i < OPT_COUNT && v >= 0 && v < sCount[i])
    sOpt[i] = (u8)v;
}
u32 Port_OptGeneration(void) { return sOptGeneration; }
/* Map zoom (ppu.c reads it at each frame's first line; the field's culling follows the frame, gPortZoom*) */
int Port_ZoomLevel(void) { return sOpt[OPT_ZOOM]; }

/* ---- the screen ---- */
#define ROWS 3
#define WIN_X 2
#define WIN_Y 5
#define WIN_W 26
#define VALUE_X 120
#ifndef HINT_X
#define HINT_X 22
#endif
#ifndef HINT_Y
#define HINT_Y 0
#endif
static const char *const sLabel[3] = {"Screen colours", "Brightness", "Map zoom"};
static const char *const sValue[3][3] = {{"Original", "GBA LCD", 0}, {"Normal", "Bright", "Brighter"}, {"Normal", "More", "Most"}};
static const char *const sHelp[3] = {
    "Like a real GBA screen.",
    "Lighten the picture.",
    "See more of the map.",
};
static struct PortMenuCursor sCursor;

#define S(t) ((const u8 *)(t))

static void draw_value(struct Window *w, s32 row) {
  s32 y = 8 + row * 24;
  Window_ClearInteriorTiles(w, VALUE_X, y, WIN_W * 8 - 24, y + 8);
  Text_DrawStringAtOffset(S(sValue[row][sOpt[row]]), w, VALUE_X, y);
}

/* SE_* sound ids come from the vendor caller (c_rules.tsv), so they track the vendor's enum */
static s32 sSeMove, sSeConfirm, sSeCancel;

void Port_ExtraSettings_Run(s32 seMove, s32 seConfirm, s32 seCancel) {
  struct Window *help, *w;
  s32 row = 0, i, slot, redraw = 1;
  sSeMove = seMove; sSeConfirm = seConfirm; sSeCancel = seCancel;
  help = Window_Create(WIN_X, 2, WIN_W, 3, WINDOW_FLAG_INSTANT);
  w = Window_Create(WIN_X, WIN_Y, WIN_W, ROWS * 3 + 1, WINDOW_FLAG_INSTANT);
  if (!help || !w) {
    Window_Close(help, 2);
    Window_Close(w, 2);
    return;
  }
  for (i = 1; i < ROWS; i++)
    Window_DrawDividerLine(w, 0, i * 3, WIN_W - 1, i * 3);
  for (i = 0; i < ROWS; i++) {
    Text_DrawStringAtOffset(S(sLabel[i]), w, 8, 8 + i * 24);
    draw_value(w, i);
  }
  slot = VramCache_FindFreeEntry();
  sCursor.anchor = 0;
  if (slot < VRAM_CACHE_ENTRIES) {
    VramCache_Load(slot, 128, gPointingHandTiles);
    sCursor.anchor = WindowSprite_Create(slot, OUTPUT_SIZE_16X16, w, 0, 0);
    MenuCursor_SetPositionImmediateFar(&sCursor, WIN_X * 8, (WIN_Y + 1) * 8 + 4);
  }
  wait(1);
  for (;;) {
    if (redraw) {
      redraw = 0;
      row = (row + ROWS) % ROWS;
      if (sCursor.anchor)
        MenuCursor_SetFar(&sCursor, WIN_X * 8, (WIN_Y + 1 + row * 3) * 8 + 4, 3);
      WindowSprite_ClearList(help);
      Text_DrawString(S(sHelp[row]), help, 0, 0);
    }
    if (sCursor.anchor)
      MenuCursor_AdvanceFar(&sCursor);
    wait(1);
    if (gKeysPressed & (K_B | K_START)) {
      Sound_PlayFar(sSeCancel);
      break;
    }
    if (gKeysRepeat & K_UP) {
      Sound_PlayFar(sSeMove);
      row--;
      redraw = 1;
    } else if (gKeysRepeat & K_DOWN) {
      Sound_PlayFar(sSeMove);
      row++;
      redraw = 1;
    } else if (gKeysRepeat & (K_LEFT | K_RIGHT) || gKeysPressed & K_A) {
      s32 n = sCount[row];
      s32 v = sOpt[row] + ((gKeysRepeat & K_LEFT) ? n - 1 : 1);
      Sound_PlayFar((gKeysPressed & K_A) ? sSeConfirm : sSeMove);
      sOpt[row] = (u8)(v % n);
      sOptGeneration++;
      draw_value(w, row);
    }
  }
  Window_Close(help, 2);
  Window_Close(w, 2);
  wait(1);
}

/* Change settings: a small window at the top right says "R: More" (the help line itself has no room left) */
static struct Window *sHintWin;
void Port_ExtraSettings_Hint(struct Window *help, s32 message, s32 windowWidth) {
  (void)help; (void)message; (void)windowWidth;
  if (sHintWin)
    return;
  sHintWin = Window_Create(HINT_X, 0, 30 - HINT_X, 3, WINDOW_FLAG_INSTANT);
  if (sHintWin)
    Text_DrawString(S("R: More"), sHintWin, 0, HINT_Y);
}
void Port_ExtraSettings_HintClose(void) {
  if (sHintWin)
    Window_Close(sHintWin, 2);
  sHintWin = 0;
}

/* Change settings returns -2 for R: open Extra settings, then reopen the Pause menu (as a cancel does) */
s32 Port_SettingsMenuResult(s32 result, s32 seMove, s32 seConfirm, s32 seCancel) {
  if (result != -2)
    return result;
  Port_ExtraSettings_Run(seMove, seConfirm, seCancel);
  return -1;
}
