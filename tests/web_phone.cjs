// Phone emulation test of the whole page (GS10, orchestrator rule 11): muted headless Chrome, touch + mobile UA (iPhone
// Safari string), 390x844 and 412x915 portrait and 844x390 landscape. In play: no pad control over the picture, all
// inside the viewport, the link notice off the picture and pad and cleared by a tap. In the page menu (by touch): touch
// setting, Mute, Volume, GBA screen colours, Return to title and the link panel (Host / code / Join) reachable and touch
// sized, toggles work by touch. Then three "Return to title" restarts: the old game runs must be freed (renderer
// resident memory). Reports wasm / JS / renderer memory. 0 console errors. Screenshots: port_work/phone/*.png.
// Usage: node tests/web_phone.cjs   (needs build/site). One headless Chrome at a time.
'use strict';
const LCDK = /tla/.test(process.env.SITE_DIR || '') ? 'tla-lcd' : 'gs-lcd'; // TLA6: per-game option keys
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROM = process.env.ROM || path.join(process.env.HOME, 'roms/Golden_Sun_USA_Europe.gba');
const PORT = 8537 + (process.pid % 200);
const DEBUG_PORT = 9137 + (process.pid % 200);
const K = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };
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
  const dir = path.join(ROOT, 'port_work/webphone');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const SRC = path.join(ROOT, process.env.SITE_DIR || 'build/site'); // TLA6: SITE_DIR=build/site/tla (ROM=its ROM)
  for (const f of fs.readdirSync(SRC)) fs.symlinkSync(path.join(SRC, f), path.join(dir, f));
  fs.symlinkSync(ROM, path.join(dir, 'rom.gba'));
  const out = path.join(ROOT, 'port_work/phone');
  fs.mkdirSync(out, { recursive: true });

  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
  const server = require('http').createServer((req, res) => {
    const name = path.basename(decodeURIComponent(req.url.split('?')[0])) || 'index.html';
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(PORT, '127.0.0.1');
  const profile = fs.mkdtempSync(path.join(ROOT, 'port_work/chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, '--window-size=900,900', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (e) { /* gone */ } try { server.close(); } catch (e) { /* gone */ } };
  process.on('exit', cleanup);
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
      if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning'))
        errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    };
    const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true });
      if (r.result.exceptionDetails) throw new Error(`evaluate ${expression}: ${r.result.exceptionDetails.exception?.description}`);
      return r.result.result.value;
    };
    const frames = () => ev('window.__gsFrames || 0');
    const waitFrames = async (n) => {
      const goal = (await frames()) + n;
      while ((await frames()) < goal) {
        if (Date.now() - t0 > 400000) throw new Error('timeout');
        await sleep(20);
      }
    };
    const keyinput = () => ev('new Uint16Array(__gs.HEAPU8.buffer)[0x04000130 >> 1]');
    const tkeys = () => ev('GSTouch.state().keys');
    const centre = (sel, fx = 0.5, fy = 0.5) => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
      return { x: r.left + r.width * ${fx}, y: r.top + r.height * ${fy} }; })()`);
    // CDP (Chrome here): touchStart/Move list the active points; touchEnd lists the lifted ones (empty: all of them)
    const touch = (type, points) => send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
    const snap = () => ev('(() => { const p = __gs._Port_FrameBuffer(); window.__snap = __gs.HEAPU8.slice(p, p + 240 * 160 * 4); return 1; })()');
    const diff = () => ev('(() => { const p = __gs._Port_FrameBuffer(), a = __gs.HEAPU8; let n = 0; for (let i = 0; i < 240 * 160 * 4; i += 4) if (a[p + i] !== __snap[i] || a[p + i + 1] !== __snap[i + 1] || a[p + i + 2] !== __snap[i + 2]) n++; return n; })()');
    const shot = async (name) => {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(out, name + '.png');
      fs.writeFileSync(file, Buffer.from(s.result.data, 'base64'));
      console.log(`      screenshot -> ${path.relative(ROOT, file)}`);
    };
    const phone = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true,
      screenOrientation: w < h ? { type: 'portraitPrimary', angle: 0 } : { type: 'landscapePrimary', angle: 90 } });

    // renderer memory: resident size (ps) of this Chrome's renderer processes (this test started that Chrome)
    const rss = () => {
      const rows = execSync('ps -axo pid=,ppid=,rss=,command=').toString().split('\n').map((l) => l.trim().split(/\s+/));
      const kids = new Set([String(chrome.pid)]);
      for (let k = 0; k < 4; k++) for (const r of rows) if (kids.has(r[1])) kids.add(r[0]);
      const rr = rows.filter((r) => kids.has(r[0]) && r.slice(3).join(' ').includes('--type=renderer'));
      rss.last = rr.map((r) => Math.round(r[2] / 1024)).join('+');
      rss.max = Math.max(...rr.map((r) => r[2] / 1024));   // the page's own renderer (the others are idle spares)
      return rr.reduce((s, r) => s + +r[2], 0) / 1024;
    };
    const tap = async (sel) => {
      await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' }); true`);
      await sleep(100);
      const c = await centre(sel);
      await touch('touchStart', [c]); await touch('touchEnd', []);
      await sleep(150);
    };
    const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
    const inter = (a, b) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
    // in play: the pad (and the link notice) must not cover the picture; everything inside the viewport
    const playChecks = async (label, w, h) => {
      check(await ev('document.body.classList.contains("tplay")'), `${label}: playing with the pad up`);
      const scr = await rect('#screen');
      const pads = await ev(`[...document.querySelectorAll('#touch > *')].filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'absolute').map((e) => { const r = e.getBoundingClientRect(); return [e.id, r.left, r.top, r.width, r.height]; }).filter((r) => r[3] > 0)`);
      const over = pads.filter((p) => inter(scr, p.slice(1)) > 1).map((p) => p[0]);
      check(!over.length, `${label}: no pad control over the picture (${pads.length} controls${over.length ? '; over: ' + over.join(',') : ''})`);
      const out = pads.filter((p) => p[1] < -1 || p[2] < -1 || p[1] + p[3] > w + 1 || p[2] + p[4] > h + 1).map((p) => p[0]);
      check(!out.length, `${label}: every pad control inside the ${w}x${h} viewport${out.length ? ' (outside: ' + out.join(',') + ')' : ''}`);
      // the link notice (net.js writes it to #status when the partner leaves): on top of what?
      await ev(`(() => { const s = document.getElementById('status'); s.textContent = 'Link partner left. Menu: Link battle online'; s.dataset.net = '1'; return 1; })()`);
      await sleep(100);
      const st = await rect('#status');
      const stOver = st ? pads.filter((p) => inter(st, p.slice(1)) > 1).map((p) => p[0]) : [];
      check(st && inter(st, scr) < 1 && !stOver.length, `${label}: link notice visible, off the picture and the pad (${st && st.map(Math.round)}${stOver.length ? '; covers ' + stOver.join(',') : ''})`);
      await tap('#status');
      check(await ev('document.getElementById("status").textContent === ""'), `${label}: a tap clears the notice`);
      await shot(label);
    };
    // the page menu by touch: touch setting, sound, GBA colours, Return to title, link panel (Host)
    const menuChecks = async (label, w, h) => {
      await tap('#tk-menu');
      check(await ev('document.body.classList.contains("tmenu")'), `${label}: menu open`);
      for (const sel of ['#opt-touch', '#opt-mute', '#opt-volume', '#opt-lcd', '#opt-offline', '#opt-title', '#net > summary']) {
        await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' }); true`);
        await sleep(50);
        const target = sel.startsWith('#opt-') && sel !== '#opt-title' && sel !== '#opt-touch' ? `label:has(> ${sel})` : sel;
        const r = await rect(target);
        check(r && r[0] >= -1 && r[0] + r[2] <= w + 1 && r[1] >= -1 && r[1] + r[3] <= h + 1 && r[3] >= 32 && (sel === '#opt-touch' || r[3] >= 44),
          `${label}: ${target} reachable and touch-sized (${r && r.map(Math.round)})`);
      }
      check(await ev('document.documentElement.scrollWidth <= innerWidth + 1'), `${label}: menu has no sideways scroll`);
      await tap('label:has(> #opt-lcd)');
      const lcdOn = await ev('GSLcd.on && localStorage.getItem("' + LCDK + '") === "1"');
      await tap('label:has(> #opt-lcd)');
      check(lcdOn && await ev('!GSLcd.on && localStorage.getItem("' + LCDK + '") === null'), `${label}: GBA screen colours toggles on and off by touch (stored only while on)`);
      await tap('label:has(> #opt-mute)');
      const muted = await ev('document.getElementById("opt-mute").checked');
      await tap('label:has(> #opt-mute)');
      check(muted && await ev('!document.getElementById("opt-mute").checked'), `${label}: Mute toggles by touch`);
      if (!(await ev('document.getElementById("net").open'))) await tap('#net > summary');
      check(await ev('document.getElementById("net").open'), `${label}: link panel opens by touch`);
      const host = await rect('#net-host'), join = await rect('#net-join'), code = await rect('#net-code');
      check(host && join && code && [host, join, code].every((r) => r[2] >= 44 && r[3] >= 44 && r[0] >= -1 && r[0] + r[2] <= w + 1),
        `${label}: Host / code / Join visible, >= 44 px, inside the width`);
      await tap('#net-code');
      check(await ev('document.activeElement && document.activeElement.id === "net-code"'), `${label}: the room code field takes focus by touch (keyboard)`);
      await ev('document.activeElement.blur(); true');
      await ev('scrollTo(0, 0); true');
      await sleep(100);
      await shot(label + '_menu');
      await tap('#tk-back');
      check(await ev('document.body.classList.contains("tplay")'), `${label}: Back returns to the game`);
    };

    await send('Runtime.enable');
    await send('Page.enable');
    await phone(390, 844);
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
    await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });   // the ROM picker: baseline
    await sleep(2500);
    console.log(`memory: renderer resident on the ROM picker (no game) ${rss().toFixed(0)} MiB (${rss.last}; largest ${rss.max.toFixed(0)})`);
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?romurl=rom.gba` });
    while ((await frames()) < 620) {
      if (Date.now() - t0 > 240000) throw new Error(`only ${await frames()} frames`);
      if (errors.length) throw new Error('page error: ' + errors[0]);
      await sleep(100);
    }
    const mem = await ev(`({ wasm: __gs.HEAPU8.length, js: performance.memory ? performance.memory.usedJSHeapSize : 0 })`);
    console.log(`memory: wasm linear memory ${(mem.wasm / 1048576).toFixed(1)} MiB (fixed, no growth), JS heap used ${(mem.js / 1048576).toFixed(1)} MiB, renderer resident ${rss().toFixed(0)} MiB (${rss.last}; largest ${rss.max.toFixed(0)})`);
    for (const [w, h, label] of [[390, 844, 'portrait'], [412, 915, 'portrait412'], [844, 390, 'landscape']]) {
      await phone(w, h);
      await sleep(400);
      await playChecks(label, w, h);
      await menuChecks(label, w, h);
    }
    // rotation back to portrait mid-game, then "Return to title" three times: memory must come back (old runs freed)
    await phone(390, 844);
    await sleep(300);
    await send('HeapProfiler.enable');
    rss(); const before = rss.max;
    for (let k = 0; k < 3; k++) {
      await tap('#tk-menu');
      await tap('#opt-title');
      check(await ev('document.getElementById("opt-title").classList.contains("armed")'), `restart ${k + 1}: first tap only arms "Return to title"`);
      const f0 = await frames();
      await tap('#opt-title');
      for (let i = 0; i < 100 && (await frames()) >= f0; i++) await sleep(50);
      check(await ev('document.body.classList.contains("tplay")'), `restart ${k + 1}: back in the game with the pad`);
      await waitFrames(400);
      await send('HeapProfiler.collectGarbage');
      await sleep(500);
    }
    rss(); const after = rss.max;
    console.log(`memory: the page's renderer resident before 3 restarts ${before.toFixed(0)} MiB, after (GC) ${after.toFixed(0)} MiB`);
    check(after < before + 60, `restarts free the old runs (resident ${before.toFixed(0)} -> ${after.toFixed(0)} MiB)`);
    await shot('portrait_after_restart');
    console.log(`frames ${await frames()}, ${errors.length} console errors`);
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
