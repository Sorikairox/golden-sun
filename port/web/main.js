// Page v1 (G3): ROM picker (SHA-1 check, cached in IndexedDB), the game module (game.js/game.wasm), frames to a
// canvas, keyboard and touch input (touch.js), the flash save kept in IndexedDB. Input goes through one key state (`held`) that a
// touch pad and gamepads will feed too (orchestrator rule 11), so all of them share one path.
'use strict';

// TLA4c: a page built with The Lost Age's game (tools/site.sh WASM=build/wasm-tla, local tests) takes its ROM
const GAME_TLA = window.GS_GAME === 'tla';
const ROM_SHA1 = GAME_TLA ? 'b500663220cb9bf56b9f8e8c0c544f1d6fa3a824' : '5c4695205413df7db52b9a184815a07783999971';
const ROM_SIZE = GAME_TLA ? 16777216 : 8388608;
const GAME_NAME = GAME_TLA ? 'Golden Sun: The Lost Age' : 'Golden Sun';
// TLA6 (site /tla/): one origin, one IndexedDB ('golden-sun', store 'files') for both games, so The Lost Age can
// read a GS1 save later (the party transfer); GS1's keys stay 'rom' and 'flash', TLA's are 'tla-rom' and
// 'tla-flash'. Page options likewise: gs-* for GS1, tla-* for TLA
const K_ROM = GAME_TLA ? 'tla-rom' : 'rom';
const K_FLASH = GAME_TLA ? 'tla-flash' : 'flash';
const K_OPT = GAME_TLA ? 'tla-' : 'gs-';
const CACHE_PREFIX = GAME_TLA ? 'golden-sun-tla-' : 'golden-sun-';
const FRAME_MS = 1000 / 59.7275;
const KEY = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };
const KEYMAP = {
  ArrowUp: KEY.UP, ArrowDown: KEY.DOWN, ArrowLeft: KEY.LEFT, ArrowRight: KEY.RIGHT,
  KeyX: KEY.A, KeyZ: KEY.B, Enter: KEY.START, Backspace: KEY.SELECT, KeyA: KEY.L, KeyS: KEY.R,
};

const $ = (id) => document.getElementById(id);
const status = (s) => { $('status').textContent = s; };
// iOS greys out files whose extension it has no type for (.sav, .gba) when a picker lists extensions, so there every
// file is offered and the page checks what was picked (the ROM's SHA-1, the save's 64 KB size)
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
if (IOS) for (const id of ['opt-import-file', 'file']) { const el = document.getElementById(id); if (el) el.removeAttribute('accept'); }
const params = new URLSearchParams(location.search);
// TLA6: the site has both games (GS1 at /, The Lost Age at /tla/); window.GS_SITE_BOTH (build_id.js) adds the links
if (GAME_TLA) {
  document.title = GAME_NAME + ' (web port)';
  const h = document.querySelector('#picker h1'), rn = $('rom-name');
  if (h) h.textContent = GAME_NAME;
  if (rn) rn.textContent = GAME_NAME;
}
if (window.GS_SITE_BOTH && $('other-game')) {
  const o = $('other-game'), a = document.createElement('a');
  a.href = GAME_TLA ? '../' : 'tla/';
  a.textContent = GAME_TLA ? 'Play Golden Sun (the first game)' : 'Play Golden Sun: The Lost Age';
  o.appendChild(a); o.hidden = false;
}

// ---- IndexedDB: the ROM (after its check) and the save ----
function db() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('golden-sun', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function dbGet(key) {
  const d = await db();
  return new Promise((resolve) => {
    const r = d.transaction('files').objectStore('files').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(undefined);
  });
}
async function dbPut(key, value) {
  const d = await db();
  return new Promise((resolve) => {
    const t = d.transaction('files', 'readwrite');
    t.objectStore('files').put(value, key);
    t.oncomplete = () => resolve(true);
    t.onerror = () => resolve(false);
  });
}

async function sha1(bytes) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function checkRom(bytes) {
  if (bytes.length !== ROM_SIZE) return `This file is ${bytes.length} bytes; the ${GAME_NAME} ROM is ${ROM_SIZE}.`;
  const h = await sha1(bytes);
  if (h !== ROM_SHA1) return `This file's SHA-1 is ${h}: not ${GAME_NAME} (USA, Europe).`;
  return null;
}

// ---- input ----
let held = 0;
addEventListener('keydown', (e) => { if (KEYMAP[e.code] !== undefined) { held |= KEYMAP[e.code]; e.preventDefault(); } });
addEventListener('keyup', (e) => { if (KEYMAP[e.code] !== undefined) { held &= ~KEYMAP[e.code]; e.preventDefault(); } });
addEventListener('blur', () => { held = 0; });

// test only (tests/web_link.cjs): window.__gsScript = [{mask, a, b, per}] holds keys by game frame (link routes)
function scriptKeys(f) {
  const sc = window.__gsScript;
  if (!sc) return 0;
  let k = 0;
  for (const s of sc) if (f >= s.a && f <= s.b && (!s.per || (f - s.a) % s.per < 3)) k |= s.mask;
  return k;
}

// ---- the game ----
async function start(rom) {
  $('picker').style.display = 'none';
  $('screen').style.display = 'block';
  $('keys').style.display = 'block';
  status('Starting...');
  const canvas = $('screen');
  const ctx = canvas.getContext('2d');
  // GS29 Map zoom: the frame is 240 x 160, or on a field map at a zoom level 288 x 192 / 336 x 224 (always 3:2;
  // Port_FrameWidth/Height). It goes to `src` at its own size, then into the page's canvas, whose box (CSS: size,
  // place, the touch layout) never changes. The canvas holds the frame times the smallest whole factor that covers
  // the box's device pixels (nearest: every GBA pixel the same size) and the browser smooths that slightly larger
  // picture down into the box ("sharp bilinear": crisp edges, no uneven pixel widths at 336 -> 720 and the like).
  const src = document.createElement('canvas');
  src.width = 240; src.height = 160;
  const sctx = src.getContext('2d');
  let image = sctx.createImageData(240, 160);
  let pixels = new Uint32Array(image.data.buffer);
  const fitCanvas = () => {
    const r = canvas.getBoundingClientRect(), dev = r.width * (window.devicePixelRatio || 1);
    const k = dev >= 1 ? Math.max(1, Math.min(8, Math.ceil(dev / image.width - 1e-3))) : Math.max(1, Math.round(canvas.width / image.width));
    if (canvas.width !== image.width * k || canvas.height !== image.height * k) {
      canvas.width = image.width * k; canvas.height = image.height * k;
    }
    ctx.imageSmoothingEnabled = false;
  };
  const fitFrame = (fw, fh) => {
    image = sctx.createImageData(fw, fh);
    pixels = new Uint32Array(image.data.buffer);
    src.width = fw; src.height = fh;
    fitCanvas();
  };
  addEventListener('resize', fitCanvas);
  if (window.ResizeObserver) new ResizeObserver(fitCanvas).observe(canvas);
  window.GSScreen = { src, fit: fitCanvas };   // tests: the frame as shown (colours applied), before scaling
  fitCanvas();
  let m;
  let frames = 0;
  let next = performance.now();
  let lastFlashGen = 0;
  let run = 0;   // GS10: each (re)start of the game module is a new run; a dropped run's frame wait never resolves
  const savedFlash = await dbGet(K_FLASH);
  console.log('page: save looked up');
  // each completed frame (line 160): draw it, latch the keys, and wait for the next display refresh at the GBA's
  // rate; the game is suspended there (ASYNCIFY) until the promise resolves
  const onFrame = () => {
    frames++;
    const p = m._Port_FrameBuffer(), fw = m._Port_FrameWidth ? m._Port_FrameWidth() : 240;
    const fh = m._Port_FrameHeight ? m._Port_FrameHeight() : 160;
    if (fw !== image.width || fh !== image.height) fitFrame(fw, fh);
    image.data.set(m.HEAPU8.subarray(p, p + fw * fh * 4));
    GSOpts.poll();   // GS27: options changed in the game's Extra settings screen
    if (lcd.lut) lcd.apply(pixels);   // optional "GBA screen colours" / brightness: presentation only, game memory untouched
    sctx.putImageData(image, 0, 0);
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    m._Port_SetKeys(held | (window.GSTouch ? GSTouch.keys() : 0) | scriptKeys(frames));   // keyboard + touch pad: one key state
    if (window.GSAudio) GSAudio.feed(m);   // this frame's samples to the audio worklet (never waits)
    const gen = m._Port_FlashGeneration();
    if (gen !== lastFlashGen) {
      lastFlashGen = gen;
      const f = m._Port_FlashMemory();
      dbPut(K_FLASH, m.HEAPU8.slice(f, f + 65536));
    }
    if (frames === 1) status('');
    window.__gsFrames = frames;
    if (window.GSNet) GSNet.onFrame(m);   // G7: per-turn hash of a link battle (only in an online session)
    if (window.GSTransfer) GSTransfer.onFrame(m);   // TLA9: the virtual Golden Sun partner's frame
    return new Promise((resolve) => {
      const tick = (now) => {
        if (now + 1 >= next) {
          next = Math.max(next + FRAME_MS, now - FRAME_MS);
          pendingTick = null;
          resolve();
        } else schedule(tick);
      };
      schedule(tick);
    });
  };
  // the frame wait runs from rAF, or, while the page is hidden in an online session, from net.js's worker ticks
  // (rAF stops in a hidden tab and the partner would see the link drop)
  let pendingTick = null, rafOut = false;
  const schedule = (f) => {
    pendingTick = f;
    if (rafOut) return;
    rafOut = true;
    requestAnimationFrame((now) => { rafOut = false; if (pendingTick) pendingTick(now); });
  };
  if (window.GSNet) GSNet.tickers.push(() => { if (document.hidden && pendingTick) pendingTick(performance.now()); });
  // one run of the game: a fresh module instance (memory, C state) with the ROM bytes we hold and the given save
  async function launch(flash) {
    const myRun = ++run;
    console.log('page: instantiating the game module');
    const mod = await GoldenSun({
      print: (s) => console.log(s),
      printErr: (s) => console.warn(s),
      onFrame: () => (myRun === run ? onFrame() : new Promise(() => {})),   // an old run stays suspended for good
    });
    m = mod;
    m.HEAPU8.set(rom, 0x08000000);
    GSOpts.attach(m);
    window.__gs = m;
    if (window.GSNet) { GSNet.module = m; m.linkTransport = GSNet.transport; }
    if (window.GSTransfer) GSTransfer.attach(m);   // TLA9: the one-"Yes" party transfer (transfer.js), TLA's page only
    // main() resets the hardware with a blank chip unless the host put a save there first (Port_KeepFlash)
    if (flash && flash.length === 65536) {
      m.HEAPU8.set(flash, m._Port_FlashMemory());
      m._Port_KeepFlash();
    }
    lastFlashGen = m._Port_FlashGeneration();
    try {
      m.callMain([]);
    } catch (e) {
      status('The game stopped: ' + (e.message || e));
      console.error(e);
    }
  }
  // GS10 "Return to title": the page restarts the game the way a power cycle would: the current run is dropped (its
  // frame wait never resolves, its memory is garbage) and a fresh module boots with the same ROM bytes (nothing
  // re-read) and the save as it is now. The game then shows its logos and title / File Screen as at power-on.
  // Since GS11 the game's own soft reset works too (A+B+Select+Start on keys, pad or touch: port_lib.js
  // port_soft_reset); the menu keeps the power cycle because it also recovers a run that has stopped.
  window.GSPage = {
    restart(replace) {   // replace: a 64 KB save image to boot with instead of the current one (Import save)
      if (!m) return null;
      const f = m._Port_FlashMemory();
      const flash = replace || m.HEAPU8.slice(f, f + 65536);
      pendingTick = null;
      if (window.GSNet && GSNet.active()) GSNet.leave();
      frames = 0; next = performance.now();
      m = null; window.__gs = null;
      status('Restarting...');
      return launch(flash);
    },
  };
  if (window.GSNet) GSNet.enable(ROM_SHA1);
  if (window.GSTouch) GSTouch.started();
  // "Return to title" (page menu): two taps within 3 s, so a stray tap never throws the game away
  const tb = $('opt-title');
  if (tb) {
    let armed = 0;
    tb.onclick = () => {
      if (!m) return;
      if (!armed) { tb.classList.add('armed'); tb.textContent = 'Tap again: restart (save kept)'; armed = setTimeout(disarm, 3000); return; }
      disarm();
      GSPage.restart();
      if (window.GSTouch && GSTouch.back) GSTouch.back();
    };
    const disarm = () => { clearTimeout(armed); armed = 0; tb.classList.remove('armed'); tb.textContent = 'Return to title'; };
    $('opts-game').hidden = false;
  }
  // Export / Import save: the raw 64 KB flash image, the same file retrowser.app's ☰ exports and imports
  // (save kind "flash", 65536 bytes), so a save moves between this site, retrowser and GBA emulators
  const saveName = GAME_TLA ? 'golden-sun-tla.sav' : 'golden-sun.sav';
  const eb = $('opt-export');
  if (eb) eb.onclick = async () => {
    const f = m ? m.HEAPU8.slice(m._Port_FlashMemory(), m._Port_FlashMemory() + 65536) : await dbGet(K_FLASH);
    if (!f || f.length !== 65536) { status('There is no save yet.'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([f], { type: 'application/octet-stream' }));
    a.download = saveName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };
  const fi = $('opt-import-file');
  if (fi) fi.onchange = async () => {
    const file = fi.files && fi.files[0];
    fi.value = '';
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length !== 65536) { status(`That file is ${bytes.length} bytes; a Golden Sun save is 65536 bytes (64 KB).`); return; }
    if (window.GSNet && GSNet.active()) { status('Leave the link battle before importing a save.'); return; }
    await dbPut(K_FLASH, bytes);
    status('Save imported. Restarting...');
    GSPage.restart(bytes);
    if (window.GSTouch && GSTouch.back) GSTouch.back();
  };
  $('status').addEventListener('click', () => { if (window.GSNet) GSNet.clearNote(); });
  // TLA9: a cleared Golden Sun file is read by GS1's own code before the TLA module is made (one module at a time)
  if (window.GSTransfer) { status('Looking for a Golden Sun save...'); await GSTransfer.prepare(dbGet); }
  await launch(savedFlash);
}

// ---- optional "GBA screen colours" (GS10, orchestrator rule 7: default off, stored per browser): the picture as the
// original unlit GBA LCD showed it, darker and less saturated. Applied to the RGBA picture only (a 32768-entry LUT from
// the 15-bit colour), never to game memory, so game state, hashes and online sessions are unchanged. The transform is
// the widely used GBA colour emulation of higan/bsnes (Talarubi's curve): LCD gamma 4.0, channel mixing, output gamma
// 2.2, white at 255/280.
// GS27: "Brightness" (Normal / Bright / Brighter, gs-bright, default Normal) lifts the picture with an output gamma
// (1 / 1.25, 1 / 1.5) in the same LUT. Both are also set in the game itself: START, then R ("Extra settings",
// port/pc/options.c): the page and the game share the values (Port_OptGet/Port_OptSet/Port_OptGeneration).
const OPT_LCD = 0, OPT_BRIGHT = 1, OPT_ZOOM = 2, OPT_MENUS = 3;
const lcd = {
  on: false,
  bright: 0,
  lut: null,
  build() {
    const lut = new Uint32Array(32768);
    const lcdG = 4.0, outG = 1 / 2.2, top = 255 * 255 / 280;
    const lift = [1, 1 / 1.25, 1 / 1.5][this.bright] || 1;
    const b8 = (v) => Math.min(255, Math.round(255 * Math.pow(Math.min(v, 255) / 255, lift)));
    for (let c = 0; c < 32768; c++) {
      let r, g, b;
      if (this.on) {
        const lr = Math.pow((c & 31) / 31, lcdG), lg = Math.pow((c >> 5 & 31) / 31, lcdG), lb = Math.pow((c >> 10 & 31) / 31, lcdG);
        r = Math.round(Math.pow((0 * lb + 50 * lg + 255 * lr) / 255, outG) * top);
        g = Math.round(Math.pow((30 * lb + 230 * lg + 10 * lr) / 255, outG) * top);
        b = Math.round(Math.pow((220 * lb + 10 * lg + 50 * lr) / 255, outG) * top);
      } else {   // the renderer's own expansion of 5 bits to 8 (v << 3 | v >> 2)
        const x = (v) => v << 3 | v >> 2;
        r = x(c & 31); g = x(c >> 5 & 31); b = x(c >> 10 & 31);
      }
      lut[c] = 0xff000000 | b8(b) << 16 | b8(g) << 8 | b8(r);   // little-endian RGBA
    }
    this.lut = lut;
  },
  active() { return this.on || this.bright > 0; },
  // the renderer expands each 5-bit channel to 8 bits; its top 5 bits are the GBA's value again
  apply(px) {
    const lut = this.lut;
    for (let i = 0; i < px.length; i++) {
      const v = px[i];
      px[i] = lut[(v >> 3 & 31) | (v >> 11 & 31) << 5 | (v >> 19 & 31) << 10];
    }
  },
  store() {
    try {
      if (this.on) localStorage.setItem(K_OPT + 'lcd', '1'); else localStorage.removeItem(K_OPT + 'lcd');
      if (this.bright) localStorage.setItem(K_OPT + 'bright', String(this.bright)); else localStorage.removeItem(K_OPT + 'bright');
    } catch (e) { /* storage blocked */ }
  },
  // from the page menu or the game's Extra settings (fromGame: no echo back into the game)
  set(on, fromGame) { this.on = !!on; this.changed(fromGame); },
  setBright(v, fromGame) { this.bright = Math.max(0, Math.min(2, v | 0)); this.changed(fromGame); },
  changed(fromGame) {
    this.lut = null;
    if (this.active()) this.build();
    this.store();
    const box = $('opt-lcd'), sel = $('opt-bright');
    if (box) box.checked = this.on;
    if (sel) sel.value = String(this.bright);
    if (!fromGame) GSOpts.push();
  },
};
{
  let saved = false, bright = 0;
  try { saved = localStorage.getItem(K_OPT + 'lcd') === '1'; bright = +(localStorage.getItem(K_OPT + 'bright') || 0); } catch (e) { /* storage blocked: defaults */ }
  if (params.get('lcd') !== null) saved = params.get('lcd') === '1';   // tests: ?lcd=1 / ?lcd=0 (not stored)
  if (params.get('bright') !== null) bright = +params.get('bright');   // tests: ?bright=0/1/2 (not stored)
  lcd.on = saved;
  lcd.bright = bright >= 0 && bright <= 2 ? bright | 0 : 0;
  if (lcd.active()) lcd.build();
  const box = $('opt-lcd');
  if (box) { box.checked = saved; box.addEventListener('change', () => lcd.set(box.checked)); }
  const sel = $('opt-bright');
  if (sel) { sel.value = String(lcd.bright); sel.addEventListener('change', () => lcd.setBright(+sel.value)); }
}
window.GSLcd = lcd;

// ---- optional "Map zoom" (GS29, replaces GS27's Wide view; default Normal, gs-zoom = 1 or 2): field maps show more
// of the map at the GBA's 3:2, 288 x 192 or 336 x 224 (port/pc/ppu.c), scaled into the same box; every other screen
// stays 240 x 160 and fills the box too, so nothing on the page moves. Applied at once, no reload: the renderer reads
// the level each frame. Also in the game's Extra settings (START, then R). A stored gs-wide=1 (GS27) becomes level 1
// (288 x 192: Wide view's 288 columns).
const GSZoom = {
  level: 0,
  set(v, fromGame) {
    this.level = Math.max(0, Math.min(2, v | 0));
    try { if (this.level) localStorage.setItem(K_OPT + 'zoom', String(this.level)); else localStorage.removeItem(K_OPT + 'zoom'); } catch (e) { /* storage blocked */ }
    const sel = $('opt-zoom');
    if (sel) sel.value = String(this.level);
    if (!fromGame) GSOpts.push();
  },
};
{
  let level = 0;
  try {
    level = +(localStorage.getItem(K_OPT + 'zoom') || 0);
    if (localStorage.getItem(K_OPT + 'wide') === '1') {   // GS27's Wide view on: the matching zoom level, once
      localStorage.removeItem(K_OPT + 'wide');
      if (!level) { level = 1; localStorage.setItem(K_OPT + 'zoom', '1'); }
    }
  } catch (e) { /* storage blocked: default Normal */ }
  if (params.get('zoom') !== null) level = +params.get('zoom');   // tests: ?zoom=0/1/2 (not stored)
  GSZoom.level = level >= 0 && level <= 2 ? level | 0 : 0;
  const sel = $('opt-zoom');
  if (sel) { sel.value = String(GSZoom.level); sel.addEventListener('change', () => GSZoom.set(+sel.value)); }
  if (GAME_TLA && $('opt-zoom-row')) $('opt-zoom-row').style.display = 'none';   // GS1's renderer only
}
window.GSZoom = GSZoom;

// ---- optional "Menus" (GS33; Edges by default, as the user asked; gs-menus = 0 stores Centre): while the map is
// zoomed (field maps and the World Map at More/Most) the game's windows move to the edges of the bigger picture they
// are near, the same size (port/pc/ppu.c); Centre leaves them in the GBA's 240 x 160 inside it. Also in the game's
// Extra settings (START, then R).
const GSMenus = {
  edges: 1,
  set(v, fromGame) {
    this.edges = v ? 1 : 0;
    try { if (this.edges) localStorage.removeItem(K_OPT + 'menus'); else localStorage.setItem(K_OPT + 'menus', '0'); } catch (e) { /* storage blocked */ }
    const sel = $('opt-menus');
    if (sel) sel.value = String(this.edges);
    if (!fromGame) GSOpts.push();
  },
};
{
  let v = 1;
  try { if (localStorage.getItem(K_OPT + 'menus') === '0') v = 0; } catch (e) { /* storage blocked: default Edges */ }
  if (params.get('menus') !== null) v = params.get('menus') === '0' ? 0 : 1;   // tests: ?menus=0/1 (not stored)
  GSMenus.edges = v;
  const sel = $('opt-menus');
  if (sel) { sel.value = String(v); sel.addEventListener('change', () => GSMenus.set(+sel.value)); }
  if (GAME_TLA && $('opt-menus-row')) $('opt-menus-row').style.display = 'none';   // GS1's renderer only
}
window.GSMenus = GSMenus;

// GS27: the option values the game's Extra settings screen shows and edits (port/pc/options.c). The page owns them
// (storage, presentation); push() copies them into the running module, poll() picks up edits made in the game.
const GSOpts = {
  m: null,
  gen: 0,
  attach(m) {
    this.m = m;
    this.gen = m._Port_OptGeneration ? m._Port_OptGeneration() : 0;
    this.push();
  },
  push() {
    const m = this.m;
    if (!m || !m._Port_OptSet) return;
    m._Port_OptSet(OPT_LCD, lcd.on ? 1 : 0);
    m._Port_OptSet(OPT_BRIGHT, lcd.bright);
    m._Port_OptSet(OPT_ZOOM, GSZoom.level);
    m._Port_OptSet(OPT_MENUS, GSMenus.edges);
  },
  poll() {
    const m = this.m;
    if (!m || !m._Port_OptGeneration) return;
    const g = m._Port_OptGeneration();
    if (g === this.gen) return;
    this.gen = g;
    const on = !!m._Port_OptGet(OPT_LCD), br = m._Port_OptGet(OPT_BRIGHT);
    if (on !== lcd.on || br !== lcd.bright) { lcd.on = on; lcd.setBright(br, true); }
    const z = m._Port_OptGet(OPT_ZOOM);
    if (z !== GSZoom.level) GSZoom.set(z, true);
    const mn = m._Port_OptGet(OPT_MENUS);
    if (mn !== GSMenus.edges) GSMenus.set(mn, true);
  },
};
window.GSOpts = GSOpts;

// ---- offline play (GS-deploy, docs/OFFLINE.md; asked for by the user, so on by default): the service worker sw.js
// keeps every site file in a cache named by the build, so once loaded the page, scripts, wasm and touch files work
// with no network; the ROM and the saves are in IndexedDB (navigator.storage.persist() asks the browser to keep
// them). A new deploy installs in the background and takes over the cache; the running page keeps what it loaded
// and shows "Update ready, Reload"; the next load runs the new version. Option "Offline play" (stored as
// gs-offline=0 only when switched off; the default stores nothing): off unregisters the worker and deletes its
// caches. Test override ?offline=0/1 (not stored).
const offline = {
  on: true,
  state: 'off',            // 'off' | 'unsupported' | 'installing' | 'ready' | 'error'
  reg: null,
  supported: () => 'serviceWorker' in navigator && (isSecureContext || location.hostname === '127.0.0.1'),
  show(s) {
    this.state = s;
    const el = $('opt-offline-state');
    if (el) el.textContent = { off: '', unsupported: '(not available in this browser)', installing: '(saving for offline...)', ready: '(ready offline)', error: '(could not save for offline)' }[s] || '';
  },
  boot() {
    if (!this.on || !this.supported()) { this.show(this.on ? 'unsupported' : 'off'); return; }
    // a page that started under one version and is now controlled by a newer one: offer the reload
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && this.on) $('update').hidden = false;
      this.show('ready');
    });
    this.register();
  },
  async register() {
    try {
      const reg = this.reg = await navigator.serviceWorker.register('sw.js');
      const track = (w) => {
        if (!w) return;
        const st = () => {
          if (w.state === 'activated') this.show('ready');
          if (w.state === 'redundant' && !reg.active) this.show('error');
        };
        w.addEventListener('statechange', st); st();
      };
      reg.addEventListener('updatefound', () => { if (!reg.active) this.show('installing'); track(reg.installing); });
      if (reg.active) this.show('ready'); else { this.show('installing'); track(reg.installing || reg.waiting); }
    } catch (e) { console.warn('offline: service worker not registered: ' + (e.message || e)); this.show('error'); }
  },
  async disable() {
    try { const r = await navigator.serviceWorker.getRegistration('./'); if (r && new URL(r.scope).pathname === new URL('./', location.href).pathname) await r.unregister(); } catch (e) { /* none */ }
    try { for (const k of await caches.keys()) if (k.startsWith(CACHE_PREFIX) && (GAME_TLA || !k.startsWith('golden-sun-tla-'))) await caches.delete(k); } catch (e) { /* none */ }
    this.reg = null; $('update').hidden = true; this.show('off');
  },
  set(on) {
    this.on = !!on;
    try { if (on) localStorage.removeItem(K_OPT + 'offline'); else localStorage.setItem(K_OPT + 'offline', '0'); } catch (e) { /* storage blocked */ }
    if (!this.supported()) { this.show(on ? 'unsupported' : 'off'); return; }
    if (on) this.register(); else this.disable();
  },
  // ask the browser not to evict the ROM and saves (IndexedDB) under storage pressure
  async persist() {
    try { if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) console.log('offline: persistent storage ' + (await navigator.storage.persist() ? 'granted' : 'not granted')); } catch (e) { /* not supported */ }
  },
};
{
  let on = true;
  try { on = localStorage.getItem(K_OPT + 'offline') !== '0'; } catch (e) { /* storage blocked: default on */ }
  if (params.get('offline') !== null) on = params.get('offline') !== '0';
  offline.on = on;
  const box = $('opt-offline');
  if (box) { box.checked = on; box.addEventListener('change', () => offline.set(box.checked)); }
  const rb = $('update-reload');
  if (rb) rb.onclick = () => location.reload();   // saves are already in IndexedDB (written as the game saves)
}
window.GSOffline = offline;

async function useFile(file) {
  status('Checking the ROM...');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const err = await checkRom(bytes);
  if (err) { status(err); return; }
  await dbPut(K_ROM, bytes);
  offline.persist();
  start(bytes);
}

$('file').addEventListener('change', (e) => { if (e.target.files[0]) useFile(e.target.files[0]); });

(async () => {
  offline.boot();
  const script = document.createElement('script');
  script.src = 'game.js';
  await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject; document.head.appendChild(script); });
  // ?romurl=... (local tests only): fetch the ROM from that URL instead of the picker; still checked
  const url = params.get('romurl');
  if (url) {
    console.log('page: game.js loaded; fetching the ROM');
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    console.log('page: ROM fetched');
    const err = await checkRom(bytes);
    if (err) { status(err); return; }
    start(bytes);
    return;
  }
  const cached = await dbGet(K_ROM);
  if (cached && !(await checkRom(cached))) { offline.persist(); start(cached); return; }
  status('');
})();
