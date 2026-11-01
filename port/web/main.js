// Page v1 (G3): ROM picker (SHA-1 check, cached in IndexedDB), the game module (game.js/game.wasm), frames to a
// canvas, keyboard and touch input (touch.js), the flash save kept in IndexedDB. Input goes through one key state (`held`) that a
// touch pad and gamepads will feed too (orchestrator rule 11), so all of them share one path.
'use strict';

const ROM_SHA1 = '5c4695205413df7db52b9a184815a07783999971';
const ROM_SIZE = 8388608;
const FRAME_MS = 1000 / 59.7275;
const KEY = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };
const KEYMAP = {
  ArrowUp: KEY.UP, ArrowDown: KEY.DOWN, ArrowLeft: KEY.LEFT, ArrowRight: KEY.RIGHT,
  KeyX: KEY.A, KeyZ: KEY.B, Enter: KEY.START, Backspace: KEY.SELECT, KeyA: KEY.L, KeyS: KEY.R,
};

const $ = (id) => document.getElementById(id);
const status = (s) => { $('status').textContent = s; };
const params = new URLSearchParams(location.search);

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
  if (bytes.length !== ROM_SIZE) return `This file is ${bytes.length} bytes; the Golden Sun ROM is ${ROM_SIZE}.`;
  const h = await sha1(bytes);
  if (h !== ROM_SHA1) return `This file's SHA-1 is ${h}: not Golden Sun (USA, Europe).`;
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
  const image = ctx.createImageData(240, 160);
  const pixels = new Uint32Array(image.data.buffer);
  let m;
  let frames = 0;
  let next = performance.now();
  let lastFlashGen = 0;
  let run = 0;   // GS10: each (re)start of the game module is a new run; a dropped run's frame wait never resolves
  const savedFlash = await dbGet('flash');
  console.log('page: save looked up');
  // each completed frame (line 160): draw it, latch the keys, and wait for the next display refresh at the GBA's
  // rate; the game is suspended there (ASYNCIFY) until the promise resolves
  const onFrame = () => {
    frames++;
    const p = m._Port_FrameBuffer();
    image.data.set(m.HEAPU8.subarray(p, p + 240 * 160 * 4));
    if (lcd.on) lcd.apply(pixels);   // optional "GBA screen colours": presentation only, game memory untouched
    ctx.putImageData(image, 0, 0);
    m._Port_SetKeys(held | (window.GSTouch ? GSTouch.keys() : 0) | scriptKeys(frames));   // keyboard + touch pad: one key state
    if (window.GSAudio) GSAudio.feed(m);   // this frame's samples to the audio worklet (never waits)
    const gen = m._Port_FlashGeneration();
    if (gen !== lastFlashGen) {
      lastFlashGen = gen;
      const f = m._Port_FlashMemory();
      dbPut('flash', m.HEAPU8.slice(f, f + 65536));
    }
    if (frames === 1) status('');
    window.__gsFrames = frames;
    if (window.GSNet) GSNet.onFrame(m);   // G7: per-turn hash of a link battle (only in an online session)
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
    window.__gs = m;
    if (window.GSNet) { GSNet.module = m; m.linkTransport = GSNet.transport; }
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
  // GS10 "Return to title": the game's own soft reset (A+B+Select+Start -> System_SoftReset -> Cart_Start) is not
  // available in the port (Cart_Start is ROM entry code with no C port), so the page restarts the game the way a
  // power cycle would: the current run is dropped (its frame wait never resolves, its memory is garbage) and a fresh
  // module boots with the same ROM bytes (nothing re-read) and the save as it is now. The game then shows its logos
  // and title / File Screen as at power-on.
  window.GSPage = {
    restart() {
      if (!m) return null;
      const f = m._Port_FlashMemory();
      const flash = m.HEAPU8.slice(f, f + 65536);
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
  $('status').addEventListener('click', () => { if (window.GSNet) GSNet.clearNote(); });
  await launch(savedFlash);
}

// ---- optional "GBA screen colours" (GS10, orchestrator rule 7: default off, stored per browser): the picture as the
// original unlit GBA LCD showed it, darker and less saturated. Applied to the RGBA picture only (a 32768-entry LUT from
// the 15-bit colour), never to game memory, so game state, hashes and online sessions are unchanged. The transform is
// the widely used GBA colour emulation of higan/bsnes (Talarubi's curve): LCD gamma 4.0, channel mixing, output gamma
// 2.2, white at 255/280.
const lcd = {
  on: false,
  lut: null,
  build() {
    const lut = new Uint32Array(32768);
    const lcdG = 4.0, outG = 1 / 2.2, top = 255 * 255 / 280;
    for (let c = 0; c < 32768; c++) {
      const lr = Math.pow((c & 31) / 31, lcdG), lg = Math.pow((c >> 5 & 31) / 31, lcdG), lb = Math.pow((c >> 10 & 31) / 31, lcdG);
      const r = Math.round(Math.pow((0 * lb + 50 * lg + 255 * lr) / 255, outG) * top);
      const g = Math.round(Math.pow((30 * lb + 230 * lg + 10 * lr) / 255, outG) * top);
      const b = Math.round(Math.pow((220 * lb + 10 * lg + 50 * lr) / 255, outG) * top);
      lut[c] = 0xff000000 | Math.min(b, 255) << 16 | Math.min(g, 255) << 8 | Math.min(r, 255);   // little-endian RGBA
    }
    this.lut = lut;
  },
  // the renderer expands each 5-bit channel to 8 bits; its top 5 bits are the GBA's value again
  apply(px) {
    const lut = this.lut;
    for (let i = 0; i < px.length; i++) {
      const v = px[i];
      px[i] = lut[(v >> 3 & 31) | (v >> 11 & 31) << 5 | (v >> 19 & 31) << 10];
    }
  },
  set(on) {
    this.on = !!on;
    if (this.on && !this.lut) this.build();
    try { if (on) localStorage.setItem('gs-lcd', '1'); else localStorage.removeItem('gs-lcd'); } catch (e) { /* storage blocked */ }
  },
};
{
  let saved = false;
  try { saved = localStorage.getItem('gs-lcd') === '1'; } catch (e) { /* storage blocked: default off */ }
  if (params.get('lcd') !== null) saved = params.get('lcd') === '1';   // tests: ?lcd=1 / ?lcd=0 (not stored)
  lcd.on = saved;
  if (saved) lcd.build();
  const box = $('opt-lcd');
  if (box) { box.checked = saved; box.addEventListener('change', () => lcd.set(box.checked)); }
}
window.GSLcd = lcd;

async function useFile(file) {
  status('Checking the ROM...');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const err = await checkRom(bytes);
  if (err) { status(err); return; }
  await dbPut('rom', bytes);
  start(bytes);
}

$('file').addEventListener('change', (e) => { if (e.target.files[0]) useFile(e.target.files[0]); });

(async () => {
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
  const cached = await dbGet('rom');
  if (cached && !(await checkRom(cached))) { start(cached); return; }
  status('');
})();
