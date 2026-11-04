// GS27 page test (muted headless Chrome, one at a time): the game's own "Extra settings" screen (START, then R) and
// its sync with the page menu: Screen colours (gs-lcd), Brightness (gs-bright) and, when present, Wide view
// (gs-wide). Keys are scripted by game frame (window.__gsScript), so the run is the same every time.
// Usage: node tests/web_opts.cjs --flash SAVE [--wide] [--out port_work/gs1-opts/web]
//   SAVE: a 64 KB save in port_work (never committed) whose file 1 continues on the field (the regress run's
//   vale_day1.sav: title START@1500, Continue A@1800, file A@1850, in Vale at ~f1960).
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
const WIDE = process.argv.includes('--wide');
const OUT = path.resolve(ROOT, argOpt('--out', 'port_work/gs1-opts/web'));
const PORT = 8937 + (process.pid % 200);
const DEBUG_PORT = 9537 + (process.pid % 200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const K = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };

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
  fs.mkdirSync(OUT, { recursive: true });
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
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
    console.log('flash: ' + await ev(`(async () => {
      const bytes = new Uint8Array(await (await fetch('flash.sav')).arrayBuffer());
      const d = await new Promise((ok, no) => { const q = indexedDB.open('golden-sun', 1); q.onupgradeneeded = () => q.result.createObjectStore('files'); q.onsuccess = () => ok(q.result); q.onerror = no; });
      await new Promise((ok, no) => { const t = d.transaction('files', 'readwrite'); t.objectStore('files').put(bytes, 'flash'); t.oncomplete = ok; t.onerror = no; });
      d.close(); localStorage.clear(); return bytes.length + ' bytes put in IndexedDB';
    })()`));
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?romurl=rom.gba&offline=0` });
    // the key script: Continue, then the Pause menu, R, the rows
    const tap = (k, f) => ({ mask: K[k], a: f, b: f + 2 });
    const script = [tap('START', 1500), tap('A', 1800), tap('A', 1850),
      tap('START', 2050), tap('R', 2120), tap('RIGHT', 2220), tap('DOWN', 2280), tap('RIGHT', 2320)];
    if (WIDE) script.push(tap('DOWN', 2380), tap('RIGHT', 2420));
    script.push(tap('B', 2500), tap('B', 2560));
    for (let i = 0; i < 100 && !(await ev('!!window.__gs')); i++) await sleep(100);
    await ev(`window.__gsScript = ${JSON.stringify(script)}; 1`);
    const frames = () => ev('window.__gsFrames || 0');
    const until = async (f) => { let n; while ((n = await frames()) < f) { if (Date.now() - t0 > 240000) throw new Error(`only ${n} frames`); if (errors.length) throw new Error(errors[0]); await sleep(25); } return n; };
    const shot = async (name) => {
      const url = await ev(`document.getElementById('screen').toDataURL('image/png')`);
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(url.split(',')[1], 'base64'));
    };
    const st = () => ev(`JSON.stringify({ lcd: GSLcd.on, bright: GSLcd.bright, wide: window.GSWide ? GSWide.on : null,
      box: document.getElementById('opt-lcd').checked, sel: document.getElementById('opt-bright').value,
      wbox: document.getElementById('opt-wide') ? document.getElementById('opt-wide').checked : null,
      ls: [localStorage.getItem('gs-lcd'), localStorage.getItem('gs-bright'), localStorage.getItem('gs-wide')],
      c: [__gs._Port_OptGet(0), __gs._Port_OptGet(1), __gs._Port_OptGet(2)], w: document.getElementById('screen').width })`).then(JSON.parse);

    await until(2010); await shot('1_field_off');
    let s = await st();
    check('defaults off', !s.lcd && s.bright === 0 && !s.box && s.ls[0] === null && s.c[0] === 0, JSON.stringify(s));
    await until(2200); await shot('2_settings_off');
    await until(2260); s = await st();
    check('in-game Screen colours -> GBA LCD: page on, checkbox, gs-lcd', s.lcd && s.box && s.ls[0] === '1' && s.c[0] === 1, JSON.stringify(s));
    await until(2360); await shot('3_settings_lcd_bright'); s = await st();
    check('in-game Brightness -> Bright: page, select, gs-bright', s.bright === 1 && s.sel === '1' && s.ls[1] === '1' && s.c[1] === 1, JSON.stringify(s));
    if (WIDE) {
      await until(2470); await shot('4_settings_wide'); s = await st();
      check('in-game Wide view -> On: page, checkbox, gs-wide, canvas', s.wide && s.wbox && s.ls[2] === '1' && s.c[2] === 1 && s.w > 240, JSON.stringify(s));
    }
    await until(2700); await shot('5_field_after');
    // the page menu writes back into the game
    await ev(`(() => { const b = document.getElementById('opt-lcd'); b.checked = false; b.dispatchEvent(new Event('change')); const s = document.getElementById('opt-bright'); s.value = '0'; s.dispatchEvent(new Event('change')); return 1; })()`);
    if (WIDE) await ev(`(() => { const b = document.getElementById('opt-wide'); b.checked = false; b.dispatchEvent(new Event('change')); return 1; })()`);
    await until(2760); s = await st();
    check('page menu off -> game values 0, storage cleared', !s.lcd && s.bright === 0 && s.c[0] === 0 && s.c[1] === 0 && s.ls[0] === null && s.ls[1] === null && (!WIDE || (s.c[2] === 0 && s.ls[2] === null && s.w === 240)), JSON.stringify(s));
    await shot('6_field_page_off');
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
