// Page test in muted headless Chrome (G3): serves (node http) build/site plus the player's ROM (a symlink in the gitignored
// port_work/webtest, local only) on 127.0.0.1, opens the page with ?romurl=, waits for N game frames, and saves
// screenshots of the canvas to port_work/g3/web_*.png. Prints console errors. One Chrome at a time: the script
// refuses to start while another headless Chrome runs, and kills only the processes it started.
// Usage: node tests/web_shot.cjs [frames,frames,...] (default 200,600,1000)
'use strict';
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROM = process.env.ROM || path.join(process.env.HOME, 'roms/Golden_Sun_USA_Europe.gba');
const shots = (process.argv[2] || '200,600,1000').split(',').map(Number);
const PORT = 8737 + (process.pid % 200);
const DEBUG_PORT = 9337 + (process.pid % 200);

function otherHeadlessChrome() {
  const out = execSync('ps -axo pid=,command=').toString();
  return out.split('\n').filter((l) => /Google Chrome/.test(l) && /--headless/.test(l));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  for (let i = 0; otherHeadlessChrome().length; i++) {
    if (i === 0) console.log('waiting: another headless Chrome is running');
    if (i > 120) throw new Error('another headless Chrome kept running for 10 minutes');
    await sleep(5000);
  }
  const dir = path.join(ROOT, 'port_work/webtest');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'build/site'))) fs.symlinkSync(path.join(ROOT, 'build/site', f), path.join(dir, f));
  fs.symlinkSync(ROM, path.join(dir, 'rom.gba'));
  const out = path.join(ROOT, 'port_work/g3');
  fs.mkdirSync(out, { recursive: true });

  // a small static server (node's own: python's http.server stalled Chrome's first load for a minute)
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };
  const server = require('http').createServer((req, res) => {
    const name = path.basename(decodeURIComponent(req.url.split('?')[0])) || 'index.html';
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(PORT, '127.0.0.1');
  const profile = fs.mkdtempSync(path.join(ROOT, 'port_work/chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, '--window-size=800,700', 'about:blank'], { stdio: 'ignore' });
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
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
        if (msg.params.type === 'error' || msg.params.type === 'warning') errors.push(text);
        else if (!/^stub:/.test(text)) console.log(`page [${((Date.now() - t0) / 1000).toFixed(1)} s]:`, text);
      }
      if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    };
    const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Runtime.enable');
    await send('Page.enable');

    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?romurl=rom.gba` });
    const frames = async () => (await send('Runtime.evaluate', { expression: 'window.__gsFrames || 0', returnByValue: true })).result.result.value;
    for (const f of shots) {
      let n = 0;
      while ((n = await frames()) < f) {
        if (Date.now() - t0 > 180000) throw new Error(`only ${n} frames after 180 s`);
        if (errors.length) break;
        await sleep(100);
      }
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(out, `web_${String(n).padStart(5, '0')}.png`);
      fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
      console.log(`frame ${n} at ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${path.relative(ROOT, file)}`);
      if (errors.length) break;
    }
    const fps = await frames() / ((Date.now() - t0) / 1000);
    console.log(`page: ~${fps.toFixed(1)} frames/s overall; ${errors.length} console errors`);
    for (const e of errors.slice(0, 10)) console.log('  error:', e.slice(0, 300));
    ws.close();
  } finally {
    cleanup();
    await sleep(1000); // Chrome writes its profile while it exits
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* removed next run */ }
  }
}

main().then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
