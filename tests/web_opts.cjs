// GS27 page test (muted headless Chrome, one at a time): the game's own "Extra settings" screen (START, then R) and
// its sync with the page menu: Screen colours (gs-lcd), Brightness (gs-bright) and Map zoom (gs-zoom, GS29). Keys are
// scripted by game frame (window.__gsScript), so the run is the same every time.
// Usage: node tests/web_opts.cjs --flash SAVE [--battle SAVE2] [--out port_work/gs29/web]
//   SAVE: a 64 KB save in port_work (never committed) whose file 1 continues on the field (the regress run's
//   vale_day1.sav: title START@1500, Continue A@1800, file A@1850, in Vale at ~f1960).
//   GS29: Map zoom set in the game (Normal -> More -> Most) and by the page; the frame's size follows it, the canvas's
//   box does not move or resize; a stored gs-wide=1 becomes gs-zoom=1.
//   --battle SAVE2 (GS29): then, with the touch pad on and ?zoom=2, SAVE2's file 1 (the regress run's
//   kolima_forest.sav) plays tests/routes/kolima_grind.keys into a random battle and back: the canvas's and every
//   touch control's box are the same at each zoom level, in the battle (240 x 160) and after it.
// Prints PASS/FAIL per check and writes canvas captures (they show the game: port_work only).
'use strict';
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROM = process.env.ROM || path.join(process.env.HOME, 'roms/Golden_Sun_USA_Europe.gba');
const argOpt = (n, d = '') => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const FLASH = argOpt('--flash');
const BATTLE = argOpt('--battle');
// --shots DIR (GS29): page screenshots (the whole 900 x 800 page, as the player sees it) at the main steps, and with
// --interior a new game's first room (tests/routes/prologue.keys) at each zoom level; DIR/sheet.png puts them together
const SHOTS = argOpt('--shots') ? path.resolve(ROOT, argOpt('--shots')) : '';
const INTERIOR = process.argv.includes('--interior');
// --worldmap (GS30): with the touch pad on and ?zoom=2, the --flash save continued, then the game's own
// Event_SetDestination(WorldMap, 0) through the test hook Port_CallCode4 (as tests/probes/warp.cjs; test only): the
// World Map at Most (336 x 224), its field menu (the still picture, still 336 x 224), R's world picture (240 x 160) and
// back, the three levels: the canvas's and every touch control's box are the same throughout
const WORLDMAP = process.argv.includes('--worldmap');
const OUT = path.resolve(ROOT, argOpt('--out', 'port_work/gs29/web'));
const PORT = 8937 + (process.pid % 200);
const DEBUG_PORT = 9537 + (process.pid % 200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const K = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };

function png(rgba, w, h) {   // RGBA8, filter 0 (tools/contact.cjs reads these)
  const zlib = require('zlib');
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const tab = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = tab[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function otherHeadlessChrome() {
  const out = execSync('ps -axo pid=,command=').toString();
  return out.split('\n').filter((l) => /Google Chrome/.test(l) && /--headless/.test(l) && !/Helper/.test(l));
}

async function main() {
  if (!FLASH) throw new Error('--flash SAVE needed');
  for (let i = 0; otherHeadlessChrome().length; i++) {
    if (i === 0) console.log('waiting: another headless Chrome is running');
    if (i > 120) throw new Error('another headless Chrome kept running for 10 minutes');
    await sleep(5000);
  }
  const dir = path.join(ROOT, 'port_work/webtest-opts');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'build/site'))) fs.symlinkSync(path.join(ROOT, 'build/site', f), path.join(dir, f));
  fs.symlinkSync(ROM, path.join(dir, 'rom.gba'));
  fs.symlinkSync(path.resolve(FLASH), path.join(dir, 'flash.sav'));
  if (BATTLE) fs.symlinkSync(path.resolve(BATTLE), path.join(dir, 'flash2.sav'));
  fs.mkdirSync(OUT, { recursive: true });
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png' };
  const server = require('http').createServer((req, res) => {
    const name = path.basename(decodeURIComponent(req.url.split('?')[0])) || 'index.html';
    if (name === 'setup.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>setup</title>'); return; }
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(PORT, '127.0.0.1');
  const profile = fs.mkdtempSync(path.join(ROOT, 'port_work/chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, '--window-size=900,800', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (e) { /* gone */ } try { server.close(); } catch (e) { /* gone */ } };
  process.on('exit', cleanup);
  let fails = 0;
  const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ': ' + extra : ''}`); if (!ok) fails++; };
  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      await sleep(200);
      try { target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json()).find((t) => t.type === 'page'); } catch (e) { /* not up */ }
    }
    if (!target) throw new Error('Chrome did not start');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => { ws.onopen = r; });
    let id = 0;
    const t0 = Date.now();
    const pending = new Map();
    const errors = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error')) errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    };
    const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result.value;
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/setup.html` });
    await sleep(500);
    const putFlash = (name, ls) => ev(`(async () => {
      const bytes = new Uint8Array(await (await fetch('${name}')).arrayBuffer());
      const d = await new Promise((ok, no) => { const q = indexedDB.open('golden-sun', 1); q.onupgradeneeded = () => q.result.createObjectStore('files'); q.onsuccess = () => ok(q.result); q.onerror = no; });
      await new Promise((ok, no) => { const t = d.transaction('files', 'readwrite'); t.objectStore('files').put(bytes, 'flash'); t.oncomplete = ok; t.onerror = no; });
      d.close(); localStorage.clear(); ${ls || ''} return bytes.length + ' bytes put in IndexedDB';
    })()`);
    // a GS27 player's stored Wide view: the page migrates it (gs-wide=1 -> gs-zoom=1), then the test sets Normal
    console.log('flash: ' + await putFlash('flash.sav', "localStorage.setItem('gs-wide', '1');"));
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?romurl=rom.gba&offline=0` });
    // the key script: Continue, then the Pause menu, R, the rows
    const tap = (k, f) => ({ mask: K[k], a: f, b: f + 2 });
    const script = [tap('START', 1500), tap('A', 1800), tap('A', 1850),
      tap('START', 2050), tap('R', 2120), tap('RIGHT', 2220), tap('DOWN', 2280), tap('RIGHT', 2320),
      tap('DOWN', 2380), tap('RIGHT', 2420), tap('RIGHT', 2470), tap('B', 2560),
      tap('DOWN', 2600), tap('DOWN', 2630), tap('A', 2660), tap('B', 2760), tap('B', 2800)];   // + the game's Change settings
    for (let i = 0; i < 100 && !(await ev('!!window.__gs')); i++) await sleep(100);
    const mig = await ev(`JSON.stringify([GSZoom.level, localStorage.getItem('gs-zoom'), localStorage.getItem('gs-wide')])`).then(JSON.parse);
    check('stored gs-wide=1 migrates to gs-zoom=1', mig[0] === 1 && mig[1] === '1' && mig[2] === null, JSON.stringify(mig));
    await ev(`(() => { const z = document.getElementById('opt-zoom'); z.value = '0'; z.dispatchEvent(new Event('change')); return 1; })()`);
    await ev(`window.__gsScript = ${JSON.stringify(script)}; 1`);
    const frames = () => ev('window.__gsFrames || 0');
    const until = async (f) => { let n; while ((n = await frames()) < f) { if (Date.now() - t0 > 240000) throw new Error(`only ${n} frames`); if (errors.length) throw new Error(errors[0]); await sleep(25); } return n; };
    const shot = async (name) => {   // the frame as the player sees it (colours applied, before scaling into the box), as a plain RGBA PNG
      const r = await ev(`(() => { const c = GSScreen.src, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let s = ''; for (let i = 0; i < d.length; i += 8192) s += String.fromCharCode.apply(null, d.subarray(i, i + 8192)); return [c.width, c.height, btoa(s)]; })()`);
      fs.writeFileSync(path.join(OUT, name + '.png'), png(Buffer.from(r[2], 'base64'), r[0], r[1]));
    };
    const st = () => ev(`JSON.stringify({ lcd: GSLcd.on, bright: GSLcd.bright, zoom: GSZoom.level,
      box: document.getElementById('opt-lcd').checked, sel: document.getElementById('opt-bright').value,
      zsel: document.getElementById('opt-zoom').value,
      ls: [localStorage.getItem('gs-lcd'), localStorage.getItem('gs-bright'), localStorage.getItem('gs-zoom')],
      c: [__gs._Port_OptGet(0), __gs._Port_OptGet(1), __gs._Port_OptGet(2)], fw: __gs._Port_FrameWidth(), fh: __gs._Port_FrameHeight() })`).then(JSON.parse);
    // the boxes that must never move: the canvas, and (touch pad on) every touch control
    const boxes = () => ev(`JSON.stringify(['screen', 'tk-dpad', 'tk-A', 'tk-B', 'tk-L', 'tk-R', 'tk-SELECT', 'tk-START', 'tk-menu'].map((id) => {
      const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect();
      return id + ' ' + [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 100) / 100).join(',') + (e.offsetParent || id === 'screen' ? '' : ' hidden'); }))`).then(JSON.parse);
    const shotNames = [];
    const pshot = async (name) => {   // the page as the player sees it
      if (!SHOTS) return;
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.result.data, 'base64'));
      shotNames.push(name);
    };
    if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
    const sameBoxes = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) === JSON.stringify(b) ? a[0] : JSON.stringify(a) + ' vs ' + JSON.stringify(b));

    await until(2010); await shot('1_field_off');
    let s = await st();
    const box0 = await boxes();
    check('defaults off', !s.lcd && s.bright === 0 && !s.box && s.ls[0] === null && s.c[0] === 0 && s.zoom === 0 && s.c[2] === 0 && s.ls[2] === null && s.fw === 240 && s.fh === 160, JSON.stringify(s));
    await until(2200); await shot('2_settings_off'); await pshot('a1_extra_settings');
    await until(2260); s = await st();
    check('in-game Screen colours -> GBA LCD: page on, checkbox, gs-lcd', s.lcd && s.box && s.ls[0] === '1' && s.c[0] === 1, JSON.stringify(s));
    await until(2360); await shot('3_settings_lcd_bright'); s = await st();
    check('in-game Brightness -> Bright: page, select, gs-bright', s.bright === 1 && s.sel === '1' && s.ls[1] === '1' && s.c[1] === 1, JSON.stringify(s));
    await until(2450); await shot('4_settings_zoom1'); s = await st();
    check('in-game Map zoom -> More: page, select, gs-zoom, frame 288 x 192', s.zoom === 1 && s.zsel === '1' && s.ls[2] === '1' && s.c[2] === 1 && s.fw === 288 && s.fh === 192, JSON.stringify(s));
    sameBoxes('canvas box unchanged at More', await boxes(), box0);
    await until(2500); await shot('4_settings_zoom2'); await pshot('a2_extra_settings_most'); s = await st();
    check('in-game Map zoom -> Most: page, select, gs-zoom, frame 336 x 224', s.zoom === 2 && s.zsel === '2' && s.ls[2] === '2' && s.c[2] === 2 && s.fw === 336 && s.fh === 224, JSON.stringify(s));
    sameBoxes('canvas box unchanged at Most', await boxes(), box0);
    await until(2720); await pshot('a3_change_settings_most');
    await until(2900); await shot('5_field_zoom2'); await pshot('b3_vale_most');
    // the page menu writes back into the game
    await ev(`(() => { const z = document.getElementById('opt-zoom'); z.value = '1'; z.dispatchEvent(new Event('change')); return 1; })()`);
    await until(2930); s = await st(); await shot('5_field_zoom1'); await pshot('b2_vale_more');
    check('page menu More -> game 1, frame 288 x 192', s.c[2] === 1 && s.ls[2] === '1' && s.fw === 288 && s.fh === 192, JSON.stringify(s));
    sameBoxes('canvas box unchanged (page menu More)', await boxes(), box0);
    await ev(`(() => { const b = document.getElementById('opt-lcd'); b.checked = false; b.dispatchEvent(new Event('change')); const s = document.getElementById('opt-bright'); s.value = '0'; s.dispatchEvent(new Event('change'));
      const z = document.getElementById('opt-zoom'); z.value = '0'; z.dispatchEvent(new Event('change')); return 1; })()`);
    await until(2960); s = await st(); await pshot('b1_vale_normal');
    check('page menu off -> game values 0, storage cleared, frame 240 x 160', !s.lcd && s.bright === 0 && s.c[0] === 0 && s.c[1] === 0 && s.ls[0] === null && s.ls[1] === null && s.c[2] === 0 && s.ls[2] === null && s.fw === 240 && s.fh === 160, JSON.stringify(s));
    sameBoxes('canvas box unchanged (Normal again)', await boxes(), box0);
    await shot('6_field_page_off');
    if (BATTLE) {   // GS29: the touch pad on, Most, a field map with random battles: nothing moves across the battle
      const keys = ['tests/routes/vale_day1_continue.keys', 'tests/routes/kolima_grind.keys'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
        .split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean).join(',')).join(',');
      const spans = keys.split(',').filter(Boolean).map((x) => {
        const [k, r0] = x.split('@'); const [r, per] = r0.split('/'); const [a, b] = r.split('-').map(Number);
        return { mask: k.split('+').reduce((m, n) => m | K[n], 0), a, b: b ?? a, per: +per || 0 };
      }).filter((x) => x.a < 4600);
      console.log('flash: ' + await putFlash('flash2.sav'));
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?romurl=rom.gba&offline=0&touch=on&zoom=2` });
      await sleep(300);
      for (let i = 0; i < 100 && !(await ev('!!window.__gs && window.__gsFrames < 50')); i++) await sleep(100);
      await ev(`window.__gsScript = ${JSON.stringify(spans)}; 1`);
      const t1 = Date.now();
      const until2 = async (f) => { let n; while ((n = await frames()) < f) { if (Date.now() - t1 > 240000) throw new Error(`only ${n} frames`); if (errors.length) throw new Error(errors[0]); await sleep(25); } return n; };
      await until2(1700); const title = await boxes(); s = await st();
      check('touch: title at 240 x 160', s.fw === 240 && s.fh === 160 && s.zoom === 2, JSON.stringify(s));
      await until2(2500); await shot('7_kolima_zoom2'); await pshot('d1_kolima_touch_most'); s = await st();
      check('touch: field at Most, 336 x 224', s.fw === 336 && s.fh === 224, JSON.stringify(s));
      sameBoxes('touch: canvas + controls unchanged, title -> field at Most', await boxes(), title);
      for (const z of [1, 0, 2]) {
        await ev(`(() => { GSZoom.set(${z}); return 1; })()`);
        const f = await frames(); await until2(f + 5); s = await st();
        check(`touch: field at level ${z}`, s.fw === [240, 288, 336][z] && s.fh === [160, 192, 224][z], JSON.stringify(s));
        sameBoxes(`touch: canvas + controls unchanged at level ${z}`, await boxes(), title);
      }
      let inBattle = 0;
      while (await frames() < 4300) {
        s = await st();
        if (s.fw === 240 && (await frames()) > 2900) { inBattle++; if (inBattle === 1) { await sleep(1500); await shot('8_battle'); await pshot('d2_battle_touch_most'); sameBoxes('touch: canvas + controls unchanged in the battle', await boxes(), title); } }
        await sleep(200);
      }
      check('touch: a battle (240 x 160) was reached', inBattle > 0);
      await until2(4500); s = await st(); await shot('9_kolima_after'); await pshot('d3_kolima_after_touch_most');
      check('touch: field at Most again after the battle', s.fw === 336 && s.fh === 224, JSON.stringify(s));
      sameBoxes('touch: canvas + controls unchanged after the battle', await boxes(), title);
    }
    if (INTERIOR) {   // a new game's first room (Isaac's house in the storm), the same spot at each level
      const spans = fs.readFileSync(path.join(ROOT, 'tests/routes/prologue.keys'), 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean).join(',')
        .split(',').filter(Boolean).map((x) => {
          const [k, r0] = x.split('@'); const [r, per] = r0.split('/'); const [a, b] = r.split('-').map(Number);
          return { mask: k.split('+').reduce((m, n) => m | K[n], 0), a, b: b ?? a, per: +per || 0 };
        }).filter((x) => x.a < 2900);
      await ev(`(async () => { const d = await new Promise((ok, no) => { const q = indexedDB.open('golden-sun', 1); q.onsuccess = () => ok(q.result); q.onerror = no; });
        await new Promise((ok, no) => { const t = d.transaction('files', 'readwrite'); t.objectStore('files').delete('flash'); t.oncomplete = ok; t.onerror = no; }); d.close(); localStorage.clear(); return 1; })()`);
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?romurl=rom.gba&offline=0` });
      await sleep(300);
      for (let i = 0; i < 100 && !(await ev('!!window.__gs && window.__gsFrames < 50')); i++) await sleep(100);
      await ev(`window.__gsScript = ${JSON.stringify(spans)}; 1`);
      const t2 = Date.now();
      const until3 = async (f) => { let n; while ((n = await frames()) < f) { if (Date.now() - t2 > 240000) throw new Error(`only ${n} frames`); if (errors.length) throw new Error(errors[0]); await sleep(25); } return n; };
      for (const [z, f] of [[0, 2930], [1, 2960], [2, 2990]]) {
        await until3(f - 12); await ev(`(() => { GSZoom.set(${z}); return 1; })()`);
        await until3(f); s = await st(); await pshot(`c${z + 1}_interior_${['normal', 'more', 'most'][z]}`); await shot(`10_interior_${z}`);
        check(`interior (a small map) at level ${z}: frame ${[240, 288, 336][z]} wide`, s.fw === [240, 288, 336][z], JSON.stringify(s));
        sameBoxes(`interior: canvas box unchanged at level ${z}`, await boxes(), box0);
      }
    }
    if (WORLDMAP) {
      let warpAddr = 0;
      for (const l of fs.readFileSync(path.join(ROOT, 'port/symbols/tbs-en.tsv'), 'utf8').split('\n')) { const c = l.split('\t'); if (c[0] === 'Event_SetDestination') warpAddr = parseInt(c[1], 16); }
      const tap = (k, f) => ({ mask: K[k], a: f, b: f + 2 });
      const spans = [tap('START', 1500), tap('A', 1800), tap('A', 1850), tap('A', 2400), tap('B', 2500), tap('R', 2600), tap('B', 2800)];
      console.log('flash: ' + await putFlash('flash.sav'));
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?romurl=rom.gba&offline=0&touch=on&zoom=2` });
      await sleep(300);
      for (let i = 0; i < 100 && !(await ev('!!window.__gs && window.__gsFrames < 50')); i++) await sleep(100);
      await ev(`window.__gsScript = ${JSON.stringify(spans)}; 1`);
      const t3 = Date.now();
      const until4 = async (f) => { let n; while ((n = await frames()) < f) { if (Date.now() - t3 > 240000) throw new Error(`only ${n} frames`); if (errors.length) throw new Error(errors[0]); await sleep(10); } return n; };
      await until4(1700); const title = await boxes(); s = await st();
      check('world map: title at 240 x 160', s.fw === 240 && s.fh === 160 && s.zoom === 2, JSON.stringify(s));
      await until4(2100); await ev(`(() => { __gs._Port_CallCode4(${warpAddr}, 2, 0, 0, 0); return 1; })()`);
      await until4(2300); await shot('11_worldmap_most'); await pshot('e1_worldmap_touch_most'); s = await st();
      check('world map: at Most, 336 x 224', s.fw === 336 && s.fh === 224, JSON.stringify(s));
      sameBoxes('world map: canvas + controls unchanged, title -> World Map at Most', await boxes(), title);
      await until4(2460); await shot('12_worldmap_menu'); await pshot('e2_worldmap_menu_most'); s = await st();
      check('world map: field menu (still picture) at 336 x 224', s.fw === 336 && s.fh === 224, JSON.stringify(s));
      sameBoxes('world map: canvas + controls unchanged in the menu', await boxes(), title);
      await until4(2700); await shot('13_world_picture'); s = await st();
      check('world map: R\'s world picture at 240 x 160', s.fw === 240 && s.fh === 160, JSON.stringify(s));
      sameBoxes('world map: canvas + controls unchanged on the world picture', await boxes(), title);
      await until4(2900); s = await st();
      check('world map: back at Most after the world picture', s.fw === 336 && s.fh === 224, JSON.stringify(s));
      for (const z of [1, 0, 2]) {
        await ev(`(() => { GSZoom.set(${z}); return 1; })()`);
        const f = await frames(); await until4(f + 5); s = await st(); await shot(`14_worldmap_${z}`);
        check(`world map: level ${z}`, s.fw === [240, 288, 336][z] && s.fh === [160, 192, 224][z], JSON.stringify(s));
        sameBoxes(`world map: canvas + controls unchanged at level ${z}`, await boxes(), title);
      }
    }
    if (SHOTS && shotNames.length) {   // the screenshots side by side, at their own (equal) page size
      const names = shotNames.slice().sort();
      for (const n of names) fs.copyFileSync(path.join(SHOTS, n + '.png'), path.join(dir, 'sh_' + n + '.png'));
      fs.writeFileSync(path.join(dir, 'sheet.html'), '<!doctype html><style>body{margin:0;background:#222;color:#ddd;font:14px sans-serif;display:grid;grid-template-columns:repeat(3,450px);gap:6px;padding:6px}' +
        'figure{margin:0}img{width:450px;height:400px;display:block}</style>' + names.map((n) => `<figure><img src="sh_${n}.png"><figcaption>${n}</figcaption></figure>`).join(''));
      await send('Emulation.setDeviceMetricsOverride', { width: 1370, height: Math.ceil(names.length / 3) * 428 + 12, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/sheet.html` });
      await sleep(1500);
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOTS, 'sheet.png'), Buffer.from(r.result.data, 'base64'));
      console.log(`sheet: ${path.relative(ROOT, path.join(SHOTS, 'sheet.png'))} (${names.length} page screenshots)`);
    }
    check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    console.log(`captures in ${path.relative(ROOT, OUT)}; ${fails ? fails + ' FAILED' : 'ALL PASS'}`);
    ws.close();
  } finally {
    cleanup();
    await sleep(1000);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* removed next run */ }
  }
  process.exitCode = fails ? 1 : 0;
}

main().catch((e) => { console.error(e.message); process.exit(1); });
