// Offline play test (GS-deploy, docs/OFFLINE.md) in muted headless Chrome under phone emulation (390x844, touch):
//  1. online: the ROM picker page loads, the service worker installs and controls the page, its cache holds exactly
//     the site files (no ROM);
//  2. update (local only): the server switches to site B (another site id); the waiting worker shows "Update ready";
//     the next load activates it; only B's cache is left (before 3-4);
//  3. network off (CDP Network.emulateNetworkConditions offline) + reload: the page, scripts and wasm come from the
//     cache (the local server sees only the browser's sw.js update check), the picker takes the ROM file (DOM.setFileInputFiles) and the game
//     boots; the online panel says online play needs a connection and Host/Join are disabled; /api/room fails;
//  4. still offline, reload: the saved ROM (IndexedDB) boots, the touch pad drives the game (D-pad up -> KEYINPUT);
//  5. option "Offline play" off: no registration, no golden-sun-* cache.
// Usage: node tests/web_offline.cjs            (needs build/site: tools/web_build.sh && tools/site.sh)
//        node tests/web_offline.cjs --live URL (steps 1, 3, 4 against a deployed site)
'use strict';
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROM = process.env.ROM || path.join(process.env.HOME, 'roms/Golden_Sun_USA_Europe.gba');
const LIVE = process.argv.includes('--live') ? process.argv[process.argv.indexOf('--live') + 1] : null;
const K = { UP: 64 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const otherHeadlessChrome = () => execSync('ps -axo pid=,command=').toString().split('\n')
  .filter((l) => /Google Chrome/.test(l) && /--headless/.test(l));

let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };

async function main() {
  for (let i = 0; otherHeadlessChrome().length; i++) {
    if (i === 0) console.log('waiting: another headless Chrome is running');
    if (i > 120) throw new Error('another headless Chrome kept running for 10 minutes');
    await sleep(5000);
  }
  const work = path.join(ROOT, 'port_work/weboffline');
  fs.rmSync(work, { recursive: true, force: true });
  const dirA = path.join(work, 'a'), dirB = path.join(work, 'b');
  let dir = dirA, served = 0, offlineNow = false;
  const servedOffline = [];
  let server = null, PORT = 0;
  if (!LIVE) {
    // site A = build/site; site B = the same with another site id in sw.js and a changed main.js (a new deploy)
    for (const d of [dirA, dirB]) fs.mkdirSync(d, { recursive: true });
    // SITE_DIR (TLA6): another page folder, e.g. build/site/tla (The Lost Age's page; ROM=its ROM); folders skipped
    const SRC = path.join(ROOT, process.env.SITE_DIR || 'build/site');
    for (const f of fs.readdirSync(SRC)) {
      if (!fs.statSync(path.join(SRC, f)).isFile()) continue;
      fs.copyFileSync(path.join(SRC, f), path.join(dirA, f));
      fs.copyFileSync(path.join(SRC, f), path.join(dirB, f));
    }
    const sw = fs.readFileSync(path.join(dirB, 'sw.js'), 'utf8').replace(/const SITE = '[0-9a-f]+'/, "const SITE = 'bbbbbbbbbbbb'");
    fs.writeFileSync(path.join(dirB, 'sw.js'), sw);
    fs.appendFileSync(path.join(dirB, 'main.js'), '\nwindow.__siteB = 1;\n');
    const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
      '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
    server = require('http').createServer((req, res) => {
      served++; if (offlineNow) servedOffline.push(req.url); if (process.env.V) console.log('   served', req.url);
      const name = path.basename(decodeURIComponent(req.url.split('?')[0])) || 'index.html';
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    });
    // a free port chosen by the system (fixed ports collided with another port's test server on 127.0.0.1)
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    PORT = server.address().port;
  }
  const URL0 = LIVE ? LIVE.replace(/\/?$/, '/') : `http://127.0.0.1:${PORT}/`;
  const profile = fs.mkdtempSync(path.join(ROOT, 'port_work/chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=900,900', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (e) { /* gone */ } try { server && server.close(); } catch (e) { /* gone */ } };
  process.on('exit', cleanup);
  try {
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
    const t0 = Date.now();
    const pending = new Map();
    const errors = [];
    let netFromSw = 0, netOther = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      if (msg.method === 'Runtime.consoleAPICalled' && process.env.V) console.log('   console:', msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error')
        errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      if (process.env.V && msg.method === 'ServiceWorker.workerVersionUpdated') for (const v of msg.params.versions) console.log(`   sw v${v.versionId} ${v.scriptURL.split('/').pop()} ${v.runningStatus} ${v.status}`);
      if (process.env.V && msg.method === 'ServiceWorker.workerErrorReported') console.log('   sw error', JSON.stringify(msg.params));
      if (msg.method === 'Network.responseReceived') {
        const r = msg.params.response;
        if (r.fromServiceWorker) netFromSw++; else if (!/^(data|blob|chrome)/.test(r.url)) netOther.push(r.url);
      }
    };
    const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.result.exceptionDetails) throw new Error(`evaluate ${expression}: ${r.result.exceptionDetails.exception?.description}`);
      return r.result.result.value;
    };
    const waitFor = async (expr, what, ms = 60000) => {
      const t = Date.now();
      for (;;) {
        try { if (await ev(expr)) return true; } catch (e) { /* page reloading */ }
        if (Date.now() - t > ms) { check(false, `timeout waiting for ${what}`); return false; }
        await sleep(200);
      }
    };
    const frames = () => ev('window.__gsFrames || 0');
    const navigate = async (url) => { await send('Page.navigate', { url }); await sleep(800); await waitFor('document.readyState === "complete"', 'page load'); };
    const reload = async () => { await send('Page.reload', { ignoreCache: false }); await sleep(800); await waitFor('document.readyState === "complete"', 'page reload'); };
    const setOffline = (offline) => { offlineNow = offline; return send('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); };
    const keyinput = () => ev('new Uint16Array(__gs.HEAPU8.buffer)[0x04000130 >> 1]');
    const centre = (sel, fx = 0.5, fy = 0.5) => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
      return { x: r.left + r.width * ${fx}, y: r.top + r.height * ${fy} }; })()`);
    const touch = (type, points) => send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
    const cacheNames = () => ev('caches.keys()');
    const cacheFiles = () => ev(`(async () => { const out = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname.split('/').pop() || './'); return out.sort(); })()`);
    // (TLA9: each URL once, as the worker installs them: '../game.js' is 'game.js' when the page folder is the root)
    const swFiles = () => ev(`fetch('sw.js').then((r) => r.text()).then((t) => [...new Set(JSON.parse(t.match(/const FILES = (\\[.*\\]);/)[1])
      .map((f) => new URL(f, new URL('sw.js', location.href)).pathname))].map((p) => p.split('/').pop() || './').sort())`);

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('DOM.enable');
    if (process.env.V) await send('ServiceWorker.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });

    // 1. online, first visit
    console.log(`-- 1. first visit (online): ${URL0}`);
    await navigate(URL0);
    check(await ev('getComputedStyle(document.getElementById("picker")).display !== "none"'), 'ROM picker shown');
    await waitFor('navigator.serviceWorker.controller !== null && GSOffline.state === "ready"', 'service worker ready and controlling');
    check(await ev('GSOffline.state') === 'ready' && await ev('document.getElementById("opt-offline-state").textContent') === '(ready offline)', 'option shows "(ready offline)"');
    const names1 = await cacheNames();
    check(names1.length === 1 && /^golden-sun-(tla-)?[0-9a-f]{16}-[0-9a-f]{12}$/.test(names1[0]), `one cache named by build and site: ${names1}`);
    const want = await swFiles(), have = await cacheFiles();
    check(JSON.stringify(want) === JSON.stringify(have), `cache holds exactly the ${want.length} site files (${have.join(' ')})`);
    check(!have.some((f) => /\.(gba|bin|sav)$/i.test(f)), 'no ROM or save in the cache');
    check(await ev('document.querySelector(\'link[rel="manifest"]\') !== null') && (await ev('fetch("manifest.webmanifest").then((r) => r.json()).then((m) => m.icons.length)')) === 2, 'manifest linked, 2 icons');

    // 2 runs before the offline steps, so 3-4 also prove that the updated site works offline
    if (!LIVE) {
      // 2. a new deploy (site B)
      console.log('-- 2. update: site A -> site B');
      dir = dirB;
      await reload();   // the browser checks sw.js on navigation: B installs and takes over the cache
      await waitFor('!document.getElementById("update").hidden', '"Update ready" notice');
      check(await ev('!document.getElementById("update").hidden && !window.__siteB'), '"Update ready" shown; page still runs A');
      await reload();   // the next load runs B
      await waitFor('window.__siteB === 1', 'site B running', 30000);
      if (process.env.V) console.log(await ev('navigator.serviceWorker.getRegistration().then((r) => JSON.stringify({ a: r.active && r.active.state, w: r.waiting && r.waiting.state, i: r.installing && r.installing.state, c: !!navigator.serviceWorker.controller }))'));
      await sleep(500);
      const names2 = await cacheNames();
      check(await ev('window.__siteB === 1'), 'next load runs site B');
      check(names2.length === 1 && names2[0].endsWith('-bbbbbbbbbbbb') && names2[0] !== names1[0], `old cache deleted, only B's: ${names2}`);
      check(await ev('document.getElementById("update").hidden'), 'no notice after the update');
    }
    {
    // 3. offline: page from the cache, ROM picked by file, the game boots
    console.log('-- 3. network off, reload, pick the ROM');
    await setOffline(true);
    netOther = []; netFromSw = 0;
    await reload();
    check(await ev('navigator.onLine') === false, 'navigator.onLine is false');
    check(await ev('typeof GoldenSun === "function"') || (await waitFor('typeof GoldenSun === "function"', 'game.js loaded', 15000)), 'game.js loaded offline');
    check(await ev('getComputedStyle(document.getElementById("picker")).display !== "none"'), 'ROM picker shown offline');
    const doc = await send('DOM.getDocument');
    const node = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#file' });
    await send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [ROM] });
    await waitFor('(window.__gsFrames || 0) > 300', 'the game running (300 frames) from the picked ROM', 120000);
    check((await frames()) > 300, `game boots offline from the picked ROM (${await frames()} frames)`);
    check(await ev('!document.getElementById("net").hidden && !document.getElementById("net-offline").hidden && document.getElementById("net-host").disabled && document.getElementById("net-join").disabled'),
      'online panel: "online play needs an internet connection", Host/Join disabled');
    check(await ev('fetch("api/room", { method: "POST", body: "{}" }).then(() => "answered", () => "failed")') === 'failed', '/api/room is not served offline (never cached)');
    // the browser itself checks sw.js for updates on navigation (outside the page's emulated network); nothing else
    if (!LIVE) check(servedOffline.every((u) => u === '/sw.js'), `local server got only sw.js update checks while offline (${servedOffline.join(' ') || 'none'})`);
    check(netOther.length === 0 && netFromSw >= 8, `${netFromSw} responses from the service worker, ${netOther.length} from elsewhere ${netOther.slice(0, 3).join(' ')}`);

    // 4. offline again: the saved ROM boots, touch works
    console.log('-- 4. offline reload: saved ROM boots, touch pad');
    await reload();
    await waitFor('(window.__gsFrames || 0) > 620', 'the saved ROM booting to frame 620', 120000);
    check(await ev('getComputedStyle(document.getElementById("picker")).display === "none"') && (await frames()) > 620, `saved ROM (IndexedDB) boots offline (${await frames()} frames)`);
    check(await ev('GSTouch.state().on && !document.getElementById("touch").hidden'), 'touch pad on and visible');
    check(await keyinput() === 0x3FF, 'nothing held at rest');
    const up = await centre('#tk-dpad', 0.5, 0.15);
    await touch('touchStart', [up]);
    await sleep(150);
    const ki = await keyinput(), tk = await ev('GSTouch.state().keys');
    check(tk === K.UP && ki === (0x3FF & ~K.UP), `touch D-pad up -> keys ${tk}, KEYINPUT 0x${ki.toString(16)}`);
    await touch('touchEnd', []);
    await sleep(150);
    check(await keyinput() === 0x3FF, 'released');
    check(await ev('navigator.storage.persisted ? navigator.storage.persisted().then(() => true) : true'), 'navigator.storage.persist() path ran (persisted() answers)');
    await setOffline(false);
    }

    if (!LIVE) {
      // 5. option off
      console.log('-- 5. option "Offline play" off');
      await ev('(() => { const b = document.getElementById("opt-offline"); b.checked = false; b.dispatchEvent(new Event("change")); return 1; })()');
      await sleep(1000);
      check(await ev('navigator.serviceWorker.getRegistrations().then((r) => r.length)') === 0, 'worker unregistered');
      check((await cacheNames()).filter((k) => k.startsWith('golden-sun-')).length === 0, 'caches cleared');
      const OK = /tla/.test(process.env.SITE_DIR || '') ? 'tla-offline' : 'gs-offline'; // TLA6: per-game option keys
      check(await ev(`localStorage.getItem("${OK}")`) === '0', `choice stored as ${OK}=0`);
    }

    console.log(`${errors.length} console errors`);
    for (const e of errors.slice(0, 10)) console.log('  error:', e.slice(0, 300));
    if (errors.length) fails++;
    ws.close();
  } finally {
    cleanup();
    await sleep(1000);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* removed next run */ }
  }
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  return fails;
}

main().then((f) => process.exit(f ? 1 : 0), (e) => { console.error(e.message); process.exit(1); });
