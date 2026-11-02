// Live link-room check (GS-deploy): two pages of the deployed site in one muted headless Chrome (two browser
// contexts), real STUN, the live room function. Each page gets the player's ROM in IndexedDB as the picker would
// store it (handed over CDP from this machine, never uploaded anywhere), reloads and boots from it; page a
// presses Host, page b joins with the code; both must reach the hello ("linked as player ..."). Then both leave.
// Short: no battle. Usage: node tests/web_link_live.cjs [URL]   (default https://golden-sun-web-port.netlify.app)
'use strict';
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROM = process.env.ROM || path.join(process.env.HOME, 'roms/Golden_Sun_USA_Europe.gba');
const LIVE = (process.argv[2] || 'https://golden-sun-web-port.netlify.app').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const otherHeadlessChrome = () => execSync('ps -axo pid=,command=').toString().split('\n').filter((l) => /Google Chrome/.test(l) && /--headless/.test(l));

async function main() {
  for (let i = 0; otherHeadlessChrome().length; i++) {
    if (i === 0) console.log('waiting: another headless Chrome is running');
    if (i > 120) throw new Error('another headless Chrome kept running for 10 minutes');
    await sleep(5000);
  }
  const romB64 = fs.readFileSync(ROM).toString('base64');
  const profile = fs.mkdtempSync(path.join(ROOT, 'port_work/chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=800,900', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (e) { /* gone */ } };
  process.on('exit', cleanup);
  const t0 = Date.now();
  const T = () => ((Date.now() - t0) / 1000).toFixed(1) + ' s';
  const fail = [];
  try {
    let ver;
    for (let i = 0; i < 50 && !ver; i++) {
      await sleep(200);
      try { const port = +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch (e) { /* not up */ }
    }
    if (!ver) throw new Error('Chrome did not start');
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((r) => { ws.onopen = r; });
    let id = 0;
    const pending = new Map();
    const pages = [0, 1].map((i) => ({ i, name: 'ab'[i], session: null, errors: [] }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
      const p = pages.find((q) => q.session && q.session === msg.sessionId);
      if (!p) return;
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
        if (msg.params.type === 'error') p.errors.push(text);
        if (/^\[net\]/.test(text)) console.log(`${p.name} [${T()}]: ${text}`);
      }
      if (msg.method === 'Runtime.exceptionThrown') p.errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    };
    const send = (method, params = {}, sessionId) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
    const ev = async (p, expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, p.session);
      if (r.result && r.result.exceptionDetails) throw new Error(`${p.name}: ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}`);
      return r.result && r.result.result ? r.result.result.value : undefined;
    };
    const until = async (p, expr, what, ms) => {
      for (const t = Date.now(); Date.now() - t < ms; await sleep(200)) { try { if (await ev(p, expr)) return true; } catch (e) { /* loading */ } }
      fail.push(`${p.name}: timeout: ${what}`); return false;
    };
    for (const p of pages) {
      p.ctx = (await send('Target.createBrowserContext', { disposeOnDetach: true })).result.browserContextId;
      p.target = (await send('Target.createTarget', { url: 'about:blank', browserContextId: p.ctx })).result.targetId;
      p.session = (await send('Target.attachToTarget', { targetId: p.target, flatten: true })).result.sessionId;
      await send('Runtime.enable', {}, p.session);
      await send('Page.enable', {}, p.session);
      await send('Page.navigate', { url: LIVE + '/' }, p.session);
    }
    for (const p of pages) {
      await until(p, 'document.readyState === "complete" && !!window.GSOffline', 'page load', 30000);
      await ev(p, 'window.__rom = []; true');
      for (let o = 0; o < romB64.length; o += 1 << 21) await ev(p, `window.__rom.push(${JSON.stringify(romB64.slice(o, o + (1 << 21)))}); true`);
      const n = await ev(p, `(async () => {
        const bin = atob(window.__rom.join('')); window.__rom = null;
        const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const d = await new Promise((ok, no) => { const q = indexedDB.open('golden-sun', 1); q.onupgradeneeded = () => q.result.createObjectStore('files'); q.onsuccess = () => ok(q.result); q.onerror = no; });
        await new Promise((ok, no) => { const t = d.transaction('files', 'readwrite'); t.objectStore('files').put(bytes, 'rom'); t.oncomplete = ok; t.onerror = no; });
        d.close(); return bytes.length; })()`);
      if (n !== 8388608) throw new Error(`${p.name}: ROM not stored (${n})`);
      await send('Page.reload', {}, p.session);
    }
    for (const p of pages) await until(p, '(window.__gsFrames || 0) > 200 && !document.getElementById("net").hidden', 'game running from the saved ROM', 60000);
    console.log(`both pages running (${T()}), build ${await ev(pages[0], 'GSNet.buildId')}`);
    await ev(pages[0], `document.getElementById('net').open = true; document.getElementById('net-host').click(); true`);
    await until(pages[0], `/^[A-Z0-9]{5}$/.test(document.getElementById('net-code-show').textContent)`, 'room code', 20000);
    const code = await ev(pages[0], `document.getElementById('net-code-show').textContent`);
    console.log(`a: room ${code} (${T()})`);
    await ev(pages[1], `document.getElementById('net').open = true; document.getElementById('net-code').value = ${JSON.stringify(code)}; document.getElementById('net-join').click(); true`);
    for (const p of pages) await until(p, `/^linked as player/.test(document.getElementById('net-status').textContent)`, 'linked (hello matched)', 45000);
    const st = await Promise.all(pages.map((p) => ev(p, `document.getElementById('net-status').textContent`)));
    console.log(`a: "${st[0]}"\nb: "${st[1]}" (${T()})`);
    await sleep(2500);   // a round trip measurement (ping every 2 s)
    console.log(`round trip: a "${await ev(pages[0], `document.getElementById('net-rtt').textContent`)}"`);
    for (const p of pages) await ev(p, `document.getElementById('net-leave').click(); true`);
    for (const p of pages) if (p.errors.length) fail.push(`${p.name}: ${p.errors.length} console errors: ${p.errors[0].slice(0, 200)}`);
    ws.close();
  } finally {
    cleanup();
    await sleep(1000);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* removed next run */ }
  }
  console.log(fail.length ? 'FAIL\n  ' + fail.join('\n  ') : 'PASS: two pages linked through the live room server');
  return fail.length;
}

main().then((f) => process.exit(f ? 1 : 0), (e) => { console.error(e.message); process.exit(1); });
