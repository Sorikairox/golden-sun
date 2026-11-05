/* RTW2 (docs/RTW.md section 8): The Lost Age's "Extra settings" in the retrowser.app build, included by
 * port/rtw/rtw.c for TLA only. Retrowser standard 1.2's options rule: the host's menu shows only start-up options,
 * every other setting lives in the game's own menu. GS1 has one (GS27's Extra settings, reached from the Pause menu);
 * The Lost Age's Pause menu code is not named in the decomp and its objects are shared with the web build, so this
 * small menu is drawn by the module itself over the picture instead, with no game code involved:
 *
 *   L + R + SELECT (all three held)   open / close
 *   UP / DOWN                         choose a row
 *   LEFT / RIGHT / A                  change the value
 *   B                                 close
 *
 * Rows = the manifest's options (both "inGame"): 0 Screen colours (Original / GBA LCD), 1 Brightness (Normal /
 * Bright / Brighter), the same LUT as before (presentation only). Every change goes to the host with
 * rtw_option_changed, which stores it and hands it back with rtw_option at the next start. While the menu is open
 * the game gets no keys (it keeps running underneath), and after it closes no keys until all are released.
 * The 5 x 7 font below is our own drawing (no ROM data). */

#define K_A 1
#define K_B 2
#define K_SELECT 4
#define K_RIGHT 16
#define K_LEFT 32
#define K_UP 64
#define K_DOWN 128
#define K_R 256
#define K_L 512
#define MENU_COMBO (K_L | K_R | K_SELECT)

static int sMenuOpen, sMenuRow, sMenuSwallow;
static u32 sMenuPrev;
static u32 sMenuChanges; /* tests */

static const char *const sMenuLabel[2] = {"SCREEN COLOURS", "BRIGHTNESS"};
static const char *const sMenuValue[2][3] = {{"ORIGINAL", "GBA LCD", 0}, {"NORMAL", "BRIGHT", "BRIGHTER"}};
static const char *const sMenuHelp[2] = {"LIKE A REAL GBA SCREEN", "LIGHTEN THE PICTURE"};

/* 5 x 7 glyphs, one byte per row (bit 4 = left) */
static const u8 sGlyphAZ[26][7] = {
    {14, 17, 17, 31, 17, 17, 17}, {30, 17, 17, 30, 17, 17, 30}, {14, 17, 16, 16, 16, 17, 14}, {30, 17, 17, 17, 17, 17, 30},
    {31, 16, 16, 30, 16, 16, 31}, {31, 16, 16, 30, 16, 16, 16}, {14, 17, 16, 23, 17, 17, 15}, {17, 17, 17, 31, 17, 17, 17},
    {14, 4, 4, 4, 4, 4, 14},      {7, 2, 2, 2, 2, 18, 12},      {17, 18, 20, 24, 20, 18, 17}, {16, 16, 16, 16, 16, 16, 31},
    {17, 27, 21, 21, 17, 17, 17}, {17, 17, 25, 21, 19, 17, 17}, {14, 17, 17, 17, 17, 17, 14}, {30, 17, 17, 30, 16, 16, 16},
    {14, 17, 17, 17, 21, 18, 13}, {30, 17, 17, 30, 20, 18, 17}, {15, 16, 16, 14, 1, 1, 30},   {31, 4, 4, 4, 4, 4, 4},
    {17, 17, 17, 17, 17, 17, 14}, {17, 17, 17, 17, 17, 10, 4},  {17, 17, 17, 21, 21, 21, 10}, {17, 17, 10, 4, 10, 17, 17},
    {17, 17, 10, 4, 4, 4, 4},     {31, 1, 2, 4, 8, 16, 31}};
static const u8 sGlyphColon[7] = {0, 12, 12, 0, 12, 12, 0}, sGlyphPlus[7] = {0, 4, 4, 31, 4, 4, 0};
static const u8 sGlyphLt[7] = {2, 4, 8, 16, 8, 4, 2}, sGlyphGt[7] = {8, 4, 2, 1, 2, 4, 8};
static const u8 sGlyphSlash[7] = {1, 1, 2, 4, 8, 16, 16};

static const u8 *glyph(char c) {
  if (c >= 'A' && c <= 'Z')
    return sGlyphAZ[c - 'A'];
  switch (c) {
  case ':': return sGlyphColon;
  case '+': return sGlyphPlus;
  case '<': return sGlyphLt;
  case '>': return sGlyphGt;
  case '/': return sGlyphSlash;
  default: return 0;
  }
}
static void menu_text(int x, int y, const char *s, u32 colour) {
  for (; *s; s++, x += 6) {
    const u8 *g = glyph(*s);
    int r, c;
    if (!g)
      continue;
    for (r = 0; r < 7; r++)
      for (c = 0; c < 5; c++)
        if (g[r] >> (4 - c) & 1 && x + c >= 0 && x + c < 240 && y + r >= 0 && y + r < 160)
          sPicture[(y + r) * 240 + x + c] = colour;
  }
}
static void menu_draw(void) { /* over sPicture (240 x 160) */
  const u32 white = 0xFFFFFFFFu, dim = 0xFFB0B0B0u, gold = 0xFF40D8F8u; /* RGBA in memory: ABGR as a u32 */
  int x, y, i;
  for (y = 36; y < 128; y++)
    for (x = 12; x < 228; x++) {
      u32 v = sPicture[y * 240 + x];
      int edge = y == 36 || y == 127 || x == 12 || x == 227;
      sPicture[y * 240 + x] = edge ? white : 0xFF000000u | ((v >> 2) & 0x3F3F3Fu) | 0x00301808u;
    }
  menu_text(20, 42, "EXTRA SETTINGS", white);
  for (i = 0; i < 2; i++) {
    int ry = 62 + i * 16, sel = i == sMenuRow;
    char buf[24];
    menu_text(20, ry, sel ? ">" : "", gold);
    menu_text(28, ry, sMenuLabel[i], sel ? gold : white);
    buf[0] = 0;
    strcpy(buf, "<");
    strcat(buf, sMenuValue[i][sOpt[i]]);
    strcat(buf, ">");
    menu_text(140, ry, buf, sel ? gold : white);
  }
  menu_text(20, 98, sMenuHelp[sMenuRow], dim);
  menu_text(20, 114, "B: CLOSE   L+R+SELECT: CLOSE", dim);
}

/* the keys for the game this frame (port_rtw_frame), after the menu took what it needs */
static u32 menu_keys(u32 pad) {
  u32 pressed = pad & ~sMenuPrev;
  sMenuPrev = pad;
  if (!sMenuOpen) {
    if ((pad & MENU_COMBO) == MENU_COMBO && (pressed & MENU_COMBO)) {
      sMenuOpen = 1;
      sMenuRow = 0;
      return 0;
    }
    if (sMenuSwallow) {
      if (pad)
        return 0;
      sMenuSwallow = 0;
    }
    return pad;
  }
  if ((pressed & K_B) || ((pad & MENU_COMBO) == MENU_COMBO && (pressed & MENU_COMBO))) {
    sMenuOpen = 0;
    sMenuSwallow = 1;
    return 0;
  }
  if (pressed & (K_UP | K_DOWN))
    sMenuRow ^= 1;
  else if (pressed & (K_LEFT | K_RIGHT | K_A)) {
    int n = sOptCount[sMenuRow], v = (sOpt[sMenuRow] + ((pressed & K_LEFT) ? n - 1 : 1)) % n;
    sOpt[sMenuRow] = v;
    sMenuChanges++;
    rtw_option_changed(sMenuRow, v);
  }
  return 0;
}
RTW int port_rtw_menu(int k) { return k == 0 ? sMenuOpen : k == 1 ? sMenuRow : (int)sMenuChanges; }
