/* retrowser.app build (docs/RTW.md): the rtw_* exports of the retrowser standard 1.2 (~/Code/retrowser
 * spec/retrowser-v1.md) over the PC layer, for GS1 and (with -DPORT_GAME_TLA) The Lost Age. Linked only into the rtw
 * target (tools/rtw_build.sh -> tools/wasm/link.py with PORT_RTW_OUT); the web build never compiles this file, so its
 * game.wasm/game.js are unchanged.
 *
 * Shape: loop "asyncify", video "framebuffer". rtw_start runs main(), which never returns: the frame driver (hw.c)
 * calls port_frame_ready at line 160, where port/rtw/rtw_glue.js (Module.onFrame) calls port_rtw_frame() below and
 * suspends the game (ASYNCIFY) until the next frame is due on the worker's timer, as port/web/main.js does on the page.
 *   - ROM: the identity map's cartridge region at 0x08000000 (D5), up to 32 MB (TLA: 16 MB).
 *   - Save: the native 64 KB flash image at 0x0E000000 (port/pc/flash.c); generation = Port_FlashGeneration.
 *   - Input: GBA KEYINPUT bits (active-high) from port 0, latched into the keypad at each frame end.
 *   - Audio: the APU's 32768 Hz stereo ring (port/pc/apu.c), drained by the host.
 *   - Options (ids = port/pc/options.c rows): 0 GBA screen colours, 1 Brightness (both presentation only: a LUT on the
 *     picture, main.js `lcd`), GS1 also 2 Map zoom and 3 Menus (the renderer's, Port_OptSet). RTW2 (standard 1.2's
 *     options rule): all are "inGame" in the manifests, so the host's menu doesn't show them; they are set in the
 *     game's own menu (GS1: GS27's Extra settings; TLA: port/rtw/rtw_tla_menu.c, L + R + SELECT), every change reaches
 *     the host through rtw_option_changed, and the host hands the stored values back with rtw_option at start.
 *   - Online link battles (GS1, RTW2): port/rtw/rtw_net.c. */
#include <math.h>
#include <stdint.h>
#include <string.h>

#define RTW __attribute__((used, visibility("default")))

typedef uint32_t u32;
typedef int16_t s16;
typedef uint16_t u16;
typedef uint8_t u8;

/* port/pc */
void Port_SetKeys(u32 keys);
u32 *Port_FrameBuffer(void);
u32 Port_AudioRate(void);
u32 Port_AudioRead(s16 *dst, u32 max);
u32 Port_FlashGeneration(void);
u8 *Port_FlashMemory(void);
void Port_KeepFlash(void);
int main(void);
#ifndef PORT_GAME_TLA
int Port_FrameWidth(void);
int Port_FrameHeight(void);
int Port_OptGet(int i);
void Port_OptSet(int i, int v);
u32 Port_OptGeneration(void);
#define OPT_COUNT 4
#else
#define OPT_COUNT 2 /* TLA: the page's two picture options (its renderer has no Map zoom / Menus) */
#endif

/* host import (standard 1.1): the game's own menu changed a manifest option (port/rtw/library_rtw.js) */
extern int rtw_option_changed(int id, int value);

#define ROM_BASE 0x08000000u
#define ROM_MAX (32u << 20)
#define FLASH_SIZE 65536
#define OPT_LCD 0
#define OPT_BRIGHT 1

static const u8 sOptCount[4] = {2, 3, 3, 2}; /* options.c sCount */
static int sOpt[4] = {0, 0, 0, 1};           /* the values the host knows */
static u32 sOptGen;
static u32 sPad;
static int sPaused, sStarted;
static u32 sFrames, sAudioFrames, sAudioNonZero;

/* ---------------- picture: GBA screen colours / Brightness (main.js lcd.build, presentation only) ---------------- */
static u32 sLut[32768];
static int sLutOn = -1, sLutBright = -1;
static u32 sPicture[336 * 224];

static int round_half_up(double v) { return (int)floor(v + 0.5); }

static void build_lut(void) {
  const double lcdG = 4.0, outG = 1 / 2.2, top = 255.0 * 255.0 / 280.0;
  const double lifts[3] = {1, 1 / 1.25, 1 / 1.5};
  double lift = lifts[sOpt[OPT_BRIGHT] < 3 ? sOpt[OPT_BRIGHT] : 0];
  int c;
  for (c = 0; c < 32768; c++) {
    int ch[3], i;
    u32 px = 0xFF000000u;
    if (sOpt[OPT_LCD]) {
      double lr = pow((c & 31) / 31.0, lcdG), lg = pow((c >> 5 & 31) / 31.0, lcdG), lb = pow((c >> 10 & 31) / 31.0, lcdG);
      ch[0] = round_half_up(pow((0 * lb + 50 * lg + 255 * lr) / 255, outG) * top);
      ch[1] = round_half_up(pow((30 * lb + 230 * lg + 10 * lr) / 255, outG) * top);
      ch[2] = round_half_up(pow((220 * lb + 10 * lg + 50 * lr) / 255, outG) * top);
    } else { /* the renderer's own expansion of 5 bits to 8 */
      for (i = 0; i < 3; i++) {
        int v = c >> (5 * i) & 31;
        ch[i] = v << 3 | v >> 2;
      }
    }
    for (i = 0; i < 3; i++) { /* b8: the Brightness lift */
      double v = ch[i] < 255 ? ch[i] : 255;
      int o = round_half_up(255 * pow(v / 255, lift));
      px |= (u32)(o < 255 ? o : 255) << (8 * i);
    }
    sLut[c] = px;
  }
  sLutOn = sOpt[OPT_LCD];
  sLutBright = sOpt[OPT_BRIGHT];
}

static int lut_active(void) { return sOpt[OPT_LCD] || sOpt[OPT_BRIGHT]; }

#ifdef PORT_GAME_TLA
#include "rtw_tla_menu.c" /* RTW2: The Lost Age's Extra settings, drawn by the module (L + R + SELECT) */
static int menu_open(void) { return sMenuOpen; }
#else
static int menu_open(void) { return 0; }
#endif
static int own_picture(void) { return lut_active() || menu_open(); }

static int frame_w(void) {
#ifndef PORT_GAME_TLA
  return Port_FrameWidth();
#else
  return 240;
#endif
}
static int frame_h(void) {
#ifndef PORT_GAME_TLA
  return Port_FrameHeight();
#else
  return 160;
#endif
}

static void present(void) {
  const u32 *src;
  int i, n;
  if (!own_picture())
    return;
  src = Port_FrameBuffer();
  n = frame_w() * frame_h();
  if (n > (int)(sizeof sPicture / sizeof sPicture[0]))
    n = sizeof sPicture / sizeof sPicture[0];
  if (lut_active()) {
    if (sLutOn != sOpt[OPT_LCD] || sLutBright != sOpt[OPT_BRIGHT])
      build_lut();
    for (i = 0; i < n; i++) {
      u32 v = src[i];
      sPicture[i] = sLut[(v >> 3 & 31) | (v >> 11 & 31) << 5 | (v >> 19 & 31) << 10];
    }
  } else
    memcpy(sPicture, src, (size_t)n * 4);
#ifdef PORT_GAME_TLA
  if (sMenuOpen)
    menu_draw();
#endif
}

/* ---------------- options ---------------- */
static int opt_valid(int id, int v) { return id >= 0 && id < OPT_COUNT && v >= 0 && v < sOptCount[id]; }

#ifndef PORT_GAME_TLA
/* the game's Extra settings screen changed a value (Port_OptGeneration): tell the host (no echo back) */
static void poll_game_options(void) {
  u32 g = Port_OptGeneration();
  int i;
  if (g == sOptGen)
    return;
  sOptGen = g;
  for (i = 0; i < OPT_COUNT; i++) {
    int v = Port_OptGet(i);
    if (v != sOpt[i] && opt_valid(i, v)) {
      sOpt[i] = v;
      rtw_option_changed(i, v);
    }
  }
}
#endif

#ifndef PORT_GAME_TLA
#include "rtw_net.c" /* RTW2: online link battles (standard 1.2, model "link") */
#endif

/* ---------------- the frame end (port/rtw/rtw_glue.js Module.onFrame, once per game frame at line 160) ---------------- */
/* `extra`: keys of a test script by game frame (rtw_glue.js, tests/rtw_e2e.mjs only; 0 otherwise) */
RTW int port_rtw_frame(int extra) {
  sFrames++;
#ifndef PORT_GAME_TLA
  poll_game_options();
  net_frame();
#endif
#ifdef PORT_GAME_TLA
  Port_SetKeys(menu_keys((sPad | (u32)extra) & 0x3FF)); /* first: the menu may open or change a value this frame */
#else
  Port_SetKeys((sPad | (u32)extra) & 0x3FF);
#endif
  present();
  return 0;
}
RTW int port_rtw_paused(void) { return sPaused; }
RTW int port_rtw_frames(void) { return (int)sFrames; }
RTW int port_rtw_audio_frames(void) { return (int)sAudioFrames; }
RTW int port_rtw_audio_nonzero(void) { return (int)sAudioNonZero; }

/* ---------------- the standard's exports ---------------- */
RTW int rtw_rom_buffer(int size) {
  if (size <= 0 || (u32)size > ROM_MAX || sStarted)
    return 0;
  return (int)ROM_BASE;
}

RTW int rtw_save_ptr(void) { return (int)(uintptr_t)Port_FlashMemory(); }
RTW int rtw_save_size(void) { return FLASH_SIZE; }
RTW int rtw_save_generation(void) { return (int)Port_FlashGeneration(); }
/* the host copied a stored image to rtw_save_ptr(): keep it at power-on (flash.c), as the page does */
RTW int rtw_save_load(int ptr, int len) {
  (void)ptr;
  if (len > 0 && !sStarted)
    Port_KeepFlash();
  return 0;
}

RTW int rtw_option(int id, int value) {
  if (!opt_valid(id, value))
    return 0;
  sOpt[id] = value;
#ifndef PORT_GAME_TLA
  Port_OptSet(id, value); /* the game's own copy (no generation bump: not echoed back) */
#endif
  return 0;
}

RTW int rtw_resize(int w, int h, int dpr) {
  (void)w, (void)h, (void)dpr; /* the host scales the GBA picture into its own box */
  return 0;
}
/* RTW5: the host calls rtw_input once per display frame (standard 4.4): port 0's call is the frame clock of
   rtw_glue.js (Module.onHostFrame), so each game frame starts on a display frame */
void port_rtw_host_frame(void);
RTW int rtw_input(int port, int buttons, int sx, int sy) {
  (void)sx, (void)sy;
  if (port == 0) {
    sPad = (u32)buttons & 0x3FF;
    port_rtw_host_frame();
  }
  return 0;
}
RTW int rtw_mouse(int dx, int dy, int buttons) {
  (void)dx, (void)dy, (void)buttons;
  return 0;
}
/* the game stops stepping while paused: rtw_glue.js holds the frame wait */
RTW int rtw_pause(int on) {
  sPaused = on ? 1 : 0;
  return 0;
}

static s16 sAudio[2 * 16384];
RTW int rtw_audio_rate(void) { return (int)Port_AudioRate(); }
RTW int rtw_audio_buffer(void) { return (int)(uintptr_t)sAudio; }
RTW int rtw_audio_drain(void) {
  u32 n = Port_AudioRead(sAudio, 16384), i;
  sAudioFrames += n;
  for (i = 0; i < 2 * n; i++)
    if (sAudio[i]) {
      sAudioNonZero += n;
      break;
    }
  return (int)n;
}

RTW int rtw_fb(void) { return (int)(uintptr_t)(own_picture() ? sPicture : Port_FrameBuffer()); }
RTW int rtw_fb_width(void) { return frame_w(); }
RTW int rtw_fb_height(void) { return frame_h(); }

/* power-on: main() never returns; at the first frame end ASYNCIFY unwinds out of here (spec 4.4) */
RTW int rtw_start(void) {
  if (sStarted)
    return 0;
  sStarted = 1;
#ifndef PORT_GAME_TLA
  sOptGen = Port_OptGeneration();
#endif
  main();
  return 0;
}
