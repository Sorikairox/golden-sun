// TLA9 "Bring party from Golden Sun" in muted headless Chrome (docs/TLA9.md): the site (BOTH=1 tools/site.sh: GS1 at
// /, The Lost Age at /tla/) on a local server, one origin, one IndexedDB ('golden-sun', store 'files'): GS1's 'rom' and
// 'flash' (the test-only cleared save, port_work/tla8/gs1_clear.sav: tools/transfer_pw.sh step 1), TLA's 'tla-rom'.
// The TLA page's keys are the player's only: Felix's name accepted (START, A), "Transfer data from Golden Sun?" A
// (Yes), and B to leave the game's own party review after the import (as route (a) does). Cases:
//  auto     option on (default): GS1's code reads the cleared file before TLA starts, the Transfer Method menu is
//           answered Link cable by the port, the virtual GS1 partner sends the 4,100 bytes, TLA's own receive and
//           import run; TLA's units + flags SHA-1 = route (a)'s (tests/transfer_a.cjs: 14648e8f916d / 6ffcc5c1ef6b)
//  off      ?gs1party=0: the Transfer Method menu runs as on the cartridge (no partner, nothing received)
//  nosave   no GS1 save in IndexedDB: the normal menu; the option says so
//  phone    390x844 phone emulation, touch: Yes by a tap on the touch pad's A; the same SHA-1s
//  offline  the service worker (TLA's keeps GS1's ../game.js and ../game.wasm too) installed online, then network
//           off (CDP) and reload: the transfer runs from the cache; the same SHA-1s
// Usage: node tests/web_transfer.cjs [case ...]   (needs build/site from BOTH=1 tools/site.sh and the cleared save)
// Screenshots and the game's pictures go to port_work/web_transfer/ (they show the game: never committed); a contact
// sheet of the game pictures: port_work/web_transfer/sheet.png.
'use strict';
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HOME = process.env.HOME;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SITE = path.join(ROOT, 'build/site');
const FILES = { gs1rom: `${HOME}/roms/Golden_Sun_USA_Europe.gba`, tlarom: `${HOME}/roms/Golden_Sun_The_Lost_Age_USA_Europe.gba`,
  gs1sav: process.env.GS1_SAV || path.join(ROOT, 'port_work/tla8/gs1_clear.sav') };
const WANT = { units: '14648e8f916d', flags: '6ffcc5c1ef6b' };   // route (a), docs/TLA9a.md 2
const OUT = path.join(ROOT, 'port_work/web_transfer');
const CASES = process.argv.slice(2).length ? process.argv.slice(2) : ['auto', 'off', 'nosave', 'phone', 'offline'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const otherHeadlessChrome = () => execSync('ps -axo pid=,command=').toString().split('\n')
  .filter((l) => /Google Chrome/.test(l) && /--headless/.test(l));
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };

function png(rgba, w, h) {
  const zlib = require('zlib');
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const t = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function main() {
  for (const f of Object.values(FILES)) if (!fs.existsSync(f)) throw new Error('missing ' + f);
  if (!fs.existsSync(path.join(SITE, 'tla/transfer.js'))) throw new Error('build/site has no tla/transfer.js: BOTH=1 tools/site.sh');
  for (let i = 0; otherHeadlessChrome().length; i++) {
    if (i === 0) console.log('waiting: another headless Chrome is running');
    if (i > 120) throw new Error('another headless Chrome kept running for 10 minutes');
    await sleep(5000);
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
    '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  let offlineNow = false;
  const servedOffline = [];
  const server = require('http').createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (offlineNow) servedOffline.push(u);
    if (process.env.V) console.log('   served', u);
    let file;
    if (u.startsWith('/__test/')) file = FILES[u.slice(8)] || (u === '/__test/blank' ? null : undefined);
    if (u === '/__test/blank') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>t</title>'); return; }
    if (file === undefined) file = path.join(SITE, u.endsWith('/') ? u + 'index.html' : u);
    if (!file || !file.startsWith(SITE) && !Object.values(FILES).includes(file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const PORT = server.address().port, BASE = `http://127.0.0.1:${PORT}`;
  const profile = fs.mkdtempSync(path.join(ROOT, 'port_work/chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=user-gesture-required', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=900,900', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (e) { /* gone */ } try { server.close(); } catch (e) { /* gone */ } try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* busy */ } };
  process.on('exit', cleanup);
  let target, DEBUG_PORT = 0;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { DEBUG_PORT = DEBUG_PORT || +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch (e) { continue; }
    try { target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json()).find((t) => t.type === 'page'); } catch (e) { /* not up */ }
  }
  if (!target) throw new Error('Chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0;
  const pending = new Map();
  let errors = [], logs = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const s = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      logs.push(s);
      if (process.env.V) console.log('   console:', s.slice(0, 200));
      if (msg.params.type === 'error') errors.push(s);
    }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails) throw new Error(`evaluate ${expression.slice(0, 80)}: ${r.result.exceptionDetails.exception?.description}`);
    return r.result.result.value;
  };
  const waitFor = async (expr, what, ms = 90000) => {
    const t = Date.now();
    for (;;) {
      try { if (await ev(expr)) return true; } catch (e) { /* page loading */ }
      if (Date.now() - t > ms) { check(false, `timeout waiting for ${what}`); return false; }
      await sleep(50);
    }
  };
  const navigate = async (url) => { await send('Page.navigate', { url }); await sleep(500); await waitFor('document.readyState === "complete"', 'page load'); };
  // the page (Chrome's screenshot) and the game's own 240 x 160 picture (plain PNG, for tools/contact.cjs)
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(s.result.data, 'base64'));
    const b64 = await ev(`(() => { const p = __gs._Port_FrameBuffer(); let s = ''; const a = __gs.HEAPU8.subarray(p, p + 240 * 160 * 4);
      for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); })()`);
    fs.writeFileSync(path.join(OUT, name + '_game.png'), png(Buffer.from(b64, 'base64'), 240, 160));
  };
  // IndexedDB of the origin (on a blank page of it, so no game starts while it is filled)
  const idb = async (puts, dels) => {
    await navigate(`${BASE}/__test/blank`);
    await ev(`(async () => {
      const d = await new Promise((r, j) => { const q = indexedDB.open('golden-sun', 1); q.onupgradeneeded = () => q.result.createObjectStore('files'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
      for (const [k, u] of ${JSON.stringify(puts)}) { const b = new Uint8Array(await (await fetch(u)).arrayBuffer());
        await new Promise((r) => { const t = d.transaction('files', 'readwrite'); t.objectStore('files').put(b, k); t.oncomplete = r; }); }
      for (const k of ${JSON.stringify(dels)}) await new Promise((r) => { const t = d.transaction('files', 'readwrite'); t.objectStore('files').delete(k); t.oncomplete = r; });
      d.close(); return 1; })()`);
  };
  const KEY = { A: 1, B: 2, START: 8 };
  const script = (spec) => JSON.stringify(spec.split(',').map((s) => { const [k, r] = s.split('@'); const [a, b] = r.split('-').map(Number); return { mask: KEY[k], a, b, per: 0 }; }));
  const frames = () => ev('window.__gsFrames || 0');
  const untilFrame = async (n, what) => {
    const t = Date.now();
    while ((await frames()) < n) {
      if (errors.length) throw new Error('page error: ' + errors[0]);
      if (Date.now() - t > 180000) throw new Error(`${what}: only ${await frames()} frames`);
      await sleep(20);
    }
  };
  const sha = (a, n) => `(async () => [...new Uint8Array(await crypto.subtle.digest('SHA-1', __gs.HEAPU8.slice(${a}, ${a + n})))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12))()`;
  const state = async () => ev(`({ hits: __gs._Port_TlaAutoTransferHits(), menu: __gs._Port_TlaTransferMenuShown(), rx: __gs._Port_LinkStat(2),
    note: (document.getElementById('opt-gs1party-state') || {}).textContent, row: !(document.getElementById('opt-gs1party-row') || {}).hidden })`);
  let scriptId = null;
  const setScript = async (spec) => {
    if (scriptId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId });
    scriptId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: spec ? `window.__gsScript = ${script(spec)};` : '' })).result.identifier;
  };
  // the TLA page with the player's keys; returns its state at frame `at` (units/flags SHA-1 after the import)
  const play = async (label, query, keys, opts = {}) => {
    errors = []; logs = [];
    await setScript(keys);
    await navigate(`${BASE}/tla/${query}`);
    const t0 = Date.now();
    if (opts.touchA) {   // Yes by a tap on the touch pad's A (phone)
      await untilFrame(opts.touchA, label);
      const r = await ev(`(() => { const b = document.getElementById('tk-A').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width }; })()`);
      check(r.w > 0, `${label}: the touch pad's A is shown`);
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x, y: r.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
      const f0 = await frames();
      await untilFrame(f0 + 6, label);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      console.log(`      ${label}: A tapped at frames ${f0}-${await frames()}`);
    }
    await untilFrame(opts.shotAt || 760, label);
    await shot(label + '_after_yes');
    await untilFrame(opts.at || 1000, label);
    const s = await state();
    s.units = await ev(sha(0x02000520, 8 * 0x14c));
    s.flags = await ev(sha(0x02000040, 0x200));
    await shot(label + '_end');
    s.secs = ((Date.now() - t0) / 1000).toFixed(1);
    s.logs = logs.filter((l) => l.startsWith('transfer:'));
    console.log(`      ${label}: ${JSON.stringify(s)}`);
    check(errors.length === 0, `${label}: no page errors${errors.length ? ' (' + errors[0] + ')' : ''}`);
    return s;
  };
  const NAME_YES = 'START@450-452,A@480-482,A@650-652';
  const seedAll = () => idb([['rom', '/__test/gs1rom'], ['flash', '/__test/gs1sav'], ['tla-rom', '/__test/tlarom']], []);
  const auto = (label, s) => {
    check(s.hits === 1 && s.menu === 0, `${label}: Transfer Method answered Link cable by the port (menu not shown)`);
    check(s.rx >= 1, `${label}: TLA received the bulk from the virtual GS1 partner`);
    check(s.units === WANT.units && s.flags === WANT.flags, `${label}: units ${s.units} flags ${s.flags} = route (a)'s ${WANT.units} / ${WANT.flags}`);
    check(s.row && /ready: file 2/.test(s.note || ''), `${label}: option shown, "${s.note}"`);
    check(s.logs.some((l) => /file 2 read by GS1's code \(4100 bytes; cleared files 1;/.test(l)), `${label}: the cleared file 2 read by GS1's code`);
  };
  const normal = (label, s) => {
    check(s.hits === 0 && s.menu === 1, `${label}: the Transfer Method menu runs as on the cartridge`);
    check(s.rx === 0, `${label}: nothing received`);
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  for (const c of CASES) {
    console.log(`case ${c}`);
    if (c === 'auto') {
      await seedAll();
      auto(c, await play(c, '?offline=0', NAME_YES + ',B@850-852'));
    } else if (c === 'off') {
      await seedAll();
      const s = await play(c, '?offline=0&gs1party=0', NAME_YES);
      normal(c, s);
    } else if (c === 'nosave') {
      await seedAll();
      await idb([], ['flash']);
      const s = await play(c, '?offline=0', NAME_YES);
      normal(c, s);
      check(/no Golden Sun save/.test(s.note || ''), `${c}: option says "${s.note}"`);
    } else if (c === 'phone') {
      await seedAll();
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
      auto(c, await play(c, '?offline=0', 'START@450-452,A@480-482,B@900-902', { touchA: 655 }));
      await send('Emulation.clearDeviceMetricsOverride');
      await send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await send('Emulation.setUserAgentOverride', { userAgent: '' });
    } else if (c === 'offline') {
      await seedAll();
      await setScript('');
      await navigate(`${BASE}/tla/`);
      await waitFor('window.GSOffline && GSOffline.state === "ready"', 'the service worker ready', 120000);
      const keys = await ev(`(async () => { const out = []; for (const k of await caches.keys()) if (k.startsWith('golden-sun-tla-')) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname); return out; })()`);
      check(keys.includes('/game.js') && keys.includes('/game.wasm') && keys.includes('/tla/game.wasm') && keys.includes('/tla/transfer.js'),
        `offline: TLA's cache holds both games' files (${keys.length} entries: /game.js, /game.wasm, /tla/...)`);
      await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      offlineNow = true;
      const s = await play(c, '', NAME_YES + ',B@850-852');
      offlineNow = false;
      await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      auto(c, s);
      const game = servedOffline.filter((u) => /game\.(js|wasm)$/.test(u));
      check(game.length === 0, `offline: no game file from the network while offline (${servedOffline.join(' ') || 'nothing served'})`);
    }
  }
  ws.close();
  const pics = CASES.flatMap((c) => [`${c}_after_yes_game.png`, `${c}_end_game.png`]).map((f) => path.join(OUT, f)).filter((f) => fs.existsSync(f));
  try { execSync(`node ${path.join(ROOT, 'tools/contact.cjs')} ${path.join(OUT, 'sheet.png')} 2 ${pics.join(' ')}`); console.log('sheet: ' + path.relative(ROOT, path.join(OUT, 'sheet.png'))); } catch (e) { console.log('sheet: not made'); }
  console.log(fails ? `web_transfer: ${fails} FAIL` : 'web_transfer: ALL PASS');
  cleanup();
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
