// Page v1 (G3): ROM picker (SHA-1 check, cached in IndexedDB), the game module (game.js/game.wasm), frames to a
// canvas, keyboard input, the flash save kept in IndexedDB. Input goes through one key state (`held`) that a
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

// ---- the game ----
async function start(rom) {
  $('picker').style.display = 'none';
  $('screen').style.display = 'block';
  $('keys').style.display = 'block';
  status('Starting...');
  const canvas = $('screen');
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(240, 160);
  let m;
  let frames = 0;
  let next = performance.now();
  let lastFlashGen = 0;
  const savedFlash = await dbGet('flash');
  console.log('page: save looked up');
  // each completed frame (line 160): draw it, latch the keys, and wait for the next display refresh at the GBA's
  // rate; the game is suspended there (ASYNCIFY) until the promise resolves
  const onFrame = () => {
    frames++;
    const p = m._Port_FrameBuffer();
    image.data.set(m.HEAPU8.subarray(p, p + 240 * 160 * 4));
    ctx.putImageData(image, 0, 0);
    m._Port_SetKeys(held);
    const gen = m._Port_FlashGeneration();
    if (gen !== lastFlashGen) {
      lastFlashGen = gen;
      const f = m._Port_FlashMemory();
      dbPut('flash', m.HEAPU8.slice(f, f + 65536));
    }
    if (frames === 1) status('');
    window.__gsFrames = frames;
    return new Promise((resolve) => {
      const tick = (now) => {
        if (now + 1 >= next) {
          next = Math.max(next + FRAME_MS, now - FRAME_MS);
          resolve();
        } else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  };
  console.log('page: instantiating the game module');
  m = await GoldenSun({
    print: (s) => console.log(s),
    printErr: (s) => console.warn(s),
    onFrame,
  });
  m.HEAPU8.set(rom, 0x08000000);
  window.__gs = m;
  // main() resets the hardware with a blank chip unless the host put a save there first (Port_KeepFlash)
  if (savedFlash && savedFlash.length === 65536) {
    m.HEAPU8.set(savedFlash, m._Port_FlashMemory());
    m._Port_KeepFlash();
  }
  try {
    m.callMain([]);
  } catch (e) {
    status('The game stopped: ' + (e.message || e));
    console.error(e);
  }
}

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
