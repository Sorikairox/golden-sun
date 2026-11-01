// G7 exit test: the online link battle between two pages of one muted headless Chrome (two browser contexts, so each
// page has its own IndexedDB), over real WebRTC data channels on 127.0.0.1, signaled by the local room server
// (tools/roomserver.mjs, a child process). Both pages load the ROM (symlink in the gitignored port_work/webtest) and
// the battle test save (port_work/g7/flash_battle.sav, made by tests/link2.cjs), page 0 hosts a room, page 1 joins
// with its code (the page panel's buttons), then both play the link routes (tests/routes/link_*.keys, keys by game
// frame through the page's test hook window.__gsScript) through the Battle Arena to the end of a link battle.
// Checks: both linked, per-turn hashes agree on both pages (net.js desync guard), the same result on both screens,
// panel buttons >= 44 px, 0 console errors. Captures (they show the game; port_work/ only): a | b side by side.
// Usage: node tests/web_link.cjs [--netsim DELAY,DROP,JITTER] [--frames N] [--out DIR] [--manual [--refuse]]
//   --manual: the copy-paste codes instead of a room; --refuse: page b claims another build id, both pages must
//   refuse the link (the hello check) and the test stops there
//   --odd: before linking, the awkward ways in (GS10): a wrong room code, both pages press Host, a room someone else
//     already joined (full), Leave and Host again; each must give a clear status and leave Host/Join usable
//   --leave F [--silent]: (--silent: page a stops sending anything, as a crashed tab or a lost network; b must see
//     "not responding" then "partner left" from its watchdog, and the game's own disconnect after its 15 s window)
//   --leave F: at game frame F (in the battle) page a's tab is closed: page b must say "partner left", its game must
//     go on (the battle ends with the game's own disconnect message); then b uses "Return to title" (a fresh run of
//     the game, the same ROM bytes), a new tab a opens, b hosts, a joins (a re-join after a leave: the partner's link
//     epochs start again) and both play the whole link battle again from the start (frames count from the restart)
// One Chrome at a time (waits for another headless Chrome like web_shot.cjs); kills only what it started.
'use strict';
const { spawn, execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROM = process.env.ROM || path.join(process.env.HOME, 'roms/Golden_Sun_USA_Europe.gba');
const argOpt = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const NETSIM = argOpt('--netsim', '');
const MANUAL = process.argv.includes('--manual');    // connect with the copy-paste codes instead of a room
const REFUSE = process.argv.includes('--refuse');    // with --manual: page b claims another build; both must refuse
const FRAMES = +argOpt('--frames', 5200);
const ODD = process.argv.includes('--odd');
const LEAVE = +argOpt('--leave', 0);
const SILENT = process.argv.includes('--silent');   // with --leave: page a goes silent (no bye, no frames) instead
const OUT = path.resolve(ROOT, argOpt('--out', 'port_work/g8/' + (LEAVE ? 'leave' : NETSIM ? 'netsim' : 'clean')));
const FLASH = path.join(ROOT, 'port_work/g7/flash_battle.sav');
const SHOTS = [1600, 2000, 2550, 2800, 3300, 3900, 4000, 4150];
const PORT = 8737 + (process.pid % 200), ROOM_PORT = PORT + 400, DEBUG_PORT = 9337 + (process.pid % 200);
const KEY = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function png(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const t = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([l, td, c]);
  };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function routeScript() {
  const files = ['link_arena', 'link_lobby', 'link_fight'].map((n) => path.join(ROOT, 'tests/routes', n + '.keys'));
  const text = files.map((f) => fs.readFileSync(f, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean).join(',')).join(',');
  return text.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [k, r0] = s.split('@'); const [r, per] = r0.split('/'); const [a, b] = r.split('-').map(Number);
    return { mask: k.split('+').reduce((m, n) => m | KEY[n], 0), a, b: b ?? a, per: +per || 0 };
  });
}
const otherHeadlessChrome = () => execSync('ps -axo pid=,command=').toString().split('\n').filter((l) => /Google Chrome/.test(l) && /--headless/.test(l));

async function main() {
  if (!fs.existsSync(FLASH)) throw new Error('no ' + FLASH + ': run tools/link2.sh once (it makes the battle test save)');
  for (let i = 0; otherHeadlessChrome().length; i++) {
    if (i === 0) console.log('waiting: another headless Chrome is running');
    if (i > 120) throw new Error('another headless Chrome kept running for 10 minutes');
    await sleep(5000);
  }
  const dir = path.join(ROOT, 'port_work/webtest-link');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'build/site'))) fs.symlinkSync(path.join(ROOT, 'build/site', f), path.join(dir, f));
  fs.symlinkSync(ROM, path.join(dir, 'rom.gba'));
  fs.symlinkSync(FLASH, path.join(dir, 'flash.sav'));
  fs.rmSync(OUT, { recursive: true, force: true });
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
  const roomLog = [];
  const rooms = spawn(process.execPath, [path.join(ROOT, 'tools/roomserver.mjs'), String(ROOM_PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
  rooms.stdout.on('data', (d) => roomLog.push(...d.toString().trim().split('\n')));
  rooms.stderr.on('data', (d) => roomLog.push('ERR ' + d.toString().trim()));
  const profile = fs.mkdtempSync(path.join(ROOT, 'port_work/chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, '--window-size=800,900', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { for (const p of [chrome, rooms]) try { p.kill('SIGKILL'); } catch (e) { /* gone */ } try { server.close(); } catch (e) { /* gone */ } };
  process.on('exit', cleanup);
  const t0 = Date.now();
  const T = () => ((Date.now() - t0) / 1000).toFixed(1) + ' s';
  let fail = [];
  try {
    let ver;
    for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json(); } catch (e) { /* not up */ } }
    if (!ver) throw new Error('Chrome did not start');
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((r) => { ws.onopen = r; });
    let id = 0;
    const pending = new Map();
    const pages = [0, 1].map((i) => ({ i, name: 'ab'[i], session: null, errors: [], warnings: [], logs: [] }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
      const p = pages.find((q) => q.session && q.session === msg.sessionId);
      if (!p) return;
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
        if (msg.params.type === 'error') p.errors.push(text);
        else if (msg.params.type === 'warning') p.warnings.push(text);
        else if (/^\[net\]|^page:/.test(text)) { p.logs.push(text); console.log(`${p.name} [${T()}]: ${text}`); }
      }
      if (msg.method === 'Runtime.exceptionThrown') p.errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    };
    const send = (method, params = {}, sessionId) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
    const ev = async (p, expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, p.session);
      if (r.result && r.result.exceptionDetails) throw new Error(`${p.name}: ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}`);
      return r.result && r.result.result ? r.result.result.value : undefined;
    };
    const openTab = async (p, url) => {
      p.target = (await send('Target.createTarget', { url: 'about:blank', browserContextId: p.ctx })).result.targetId;
      p.session = (await send('Target.attachToTarget', { targetId: p.target, flatten: true })).result.sessionId;
      await send('Runtime.enable', {}, p.session);
      await send('Page.enable', {}, p.session);
      await send('Page.navigate', { url }, p.session);
    };
    for (const p of pages) {
      p.ctx = (await send('Target.createBrowserContext', { disposeOnDetach: true })).result.browserContextId;
      await openTab(p, `http://127.0.0.1:${PORT}/setup.html`);
    }
    await sleep(600);
    for (const p of pages) {
      const r = await ev(p, `(async () => {
        const bytes = new Uint8Array(await (await fetch('flash.sav')).arrayBuffer());
        const d = await new Promise((ok, no) => { const q = indexedDB.open('golden-sun', 1); q.onupgradeneeded = () => q.result.createObjectStore('files'); q.onsuccess = () => ok(q.result); q.onerror = no; });
        await new Promise((ok, no) => { const t = d.transaction('files', 'readwrite'); t.objectStore('files').put(bytes, 'flash'); t.oncomplete = ok; t.onerror = no; });
        d.close(); return bytes.length; })()`);
      if (r !== 65536) throw new Error(`${p.name}: save not stored (${r})`);
    }
    const q = `?romurl=rom.gba&stun=none&roomapi=${encodeURIComponent(`http://127.0.0.1:${ROOM_PORT}/api/room`)}` + (NETSIM ? `&netsim=${NETSIM}` : '');
    await Promise.all(pages.map((p) => send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html${q}` }, p.session)));
    const route = routeScript();
    if (FRAMES > 5200) route.push({ mask: KEY.A, a: 4900, b: FRAMES - 300, per: 40 });   // a slower battle: keep tapping A
    const script = JSON.stringify(route);
    for (const p of pages) {
      for (let i = 0; !(await ev(p, 'typeof window.__gs === "object" && !!window.GSNet')); i++) { if (i > 300) throw new Error(p.name + ': the game did not start'); await sleep(100); }
      await ev(p, `window.__gsScript = ${script}; true`);
    }
    const frames = (p) => ev(p, 'window.__gsFrames || 0');
    const netStatus = (p) => ev(p, 'document.getElementById("net-status").textContent');
    const waitStatus = async (p, re, what, tries = 100) => {
      for (let i = 0; i < tries; i++) { const st = await netStatus(p); if (re.test(st)) return st; await sleep(100); }
      const st = await netStatus(p); fail.push(`${what}: status "${st}"`); return st;
    };
    const buttonsFree = (p) => ev(p, '!document.getElementById("net-host").disabled && !document.getElementById("net-join").disabled');
    if (ODD) {
      // 1. a wrong code
      await ev(pages[1], `document.getElementById('net').open = true; document.getElementById('net-code').value = 'QQQQQ'; document.getElementById('net-join').click(); true`);
      console.log('odd: wrong code -> b "' + await waitStatus(pages[1], /No room with the code QQQQQ/, 'wrong code') + '"');
      if (!(await buttonsFree(pages[1]))) fail.push('wrong code: Host/Join stay disabled');
      // 2. both press Host
      for (const p of pages) await ev(p, `document.getElementById('net').open = true; document.getElementById('net-host').click(); true`);
      const both = await Promise.all(pages.map((p) => waitStatus(p, /room \w+ is open/, 'both host')));
      console.log('odd: both Host -> a "' + both[0] + '" | b "' + both[1] + '"');
      // b sees its mistake: Leave, then Host is usable again; a pressing Host twice gets a clear refusal
      await ev(pages[0], `document.getElementById('net-host').disabled = false; document.getElementById('net-host').click(); true`);
      console.log('odd: a Host again while hosting -> "' + await waitStatus(pages[0], /already hosting room/, 'host twice') + '"');
      const codeA = await ev(pages[0], `document.getElementById('net-code-show').textContent`);
      await ev(pages[1], `document.getElementById('net-leave').click(); true`);
      if (!(await buttonsFree(pages[1]))) fail.push('after Leave: Host/Join disabled');
      // 3. someone else took the room's guest slot (a third player, here the test itself): b's Join -> "full"
      const third = await (await fetch(`http://127.0.0.1:${ROOM_PORT}/api/room`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'join', code: codeA, build: await ev(pages[0], 'GSNet.buildId'), rom: '5c4695205413df7db52b9a184815a07783999971' }) })).json();
      if (!third.token) fail.push('third join did not take the slot: ' + JSON.stringify(third));
      await ev(pages[1], `document.getElementById('net-code').value = ${JSON.stringify(codeA)}; document.getElementById('net-join').click(); true`);
      console.log('odd: room full -> b "' + await waitStatus(pages[1], /already has two players/, 'room full') + '"');
      if (!(await buttonsFree(pages[1]))) fail.push('room full: Host/Join stay disabled');
      // 4. a leaves its room and hosts a new one (below, as in a normal run)
      await ev(pages[0], `document.getElementById('net-leave').click(); true`);
      await sleep(300);
      if (!(await buttonsFree(pages[0]))) fail.push('a after Leave: Host/Join disabled');
      await ev(pages[0], `document.getElementById('net-code-show').textContent = ''; true`);
    }
    console.log(`both pages running at frames ${await frames(pages[0])}/${await frames(pages[1])} (${T()})`);
    // the panel: touch-size buttons, host makes a room, guest joins with the code
    const small = await ev(pages[0], `(() => { document.getElementById('net').open = true;
      return [...document.querySelectorAll('#net > .row button, #net > .row input')].filter((e) => !e.hidden).map((e) => { const r = e.getBoundingClientRect(); return e.id + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); }).filter((s) => { const [w, h] = s.split(' ')[1].split('x').map(Number); return w < 44 || h < 44; }); })()`);
    if (small.length) fail.push('panel controls below 44 px: ' + small.join(', '));
    if (MANUAL) {
      if (REFUSE) await ev(pages[1], `GSNet.buildId = 'ffffffffffffffff'; true`);
      await ev(pages[0], `document.getElementById('net-m-host').click(); true`);
      let offer = '';
      for (let i = 0; !offer; i++) { if (i > 150) throw new Error('no offer code'); await sleep(100); offer = await ev(pages[0], `document.getElementById('net-m-out').value`); }
      await ev(pages[1], `document.getElementById('net-m-in').value = ${JSON.stringify(offer)}; document.getElementById('net-m-join').click(); true`);
      let answer = '';
      for (let i = 0; !answer; i++) { if (i > 150) throw new Error('no answer code'); await sleep(100); answer = await ev(pages[1], `document.getElementById('net-m-out').value`); }
      console.log(`manual codes: offer ${offer.length} chars, answer ${answer.length} chars (${T()})`);
      await ev(pages[0], `document.getElementById('net-m-in').value = ${JSON.stringify(answer)}; document.getElementById('net-m-accept').click(); true`);
      if (REFUSE) {
        let st = [];
        for (let i = 0; i < 100; i++) { await sleep(100); st = await Promise.all(pages.map((p) => ev(p, 'document.getElementById("net-status").textContent'))); if (st.every((x) => /refused/.test(x))) break; }
        console.log('statuses: a "' + st[0] + '" | b "' + st[1] + '"');
        const rd = await Promise.all(pages.map((p) => ev(p, 'GSNet.ready()')));
        if (!st.every((x) => /refused/.test(x)) || rd.some(Boolean)) fail.push('the link was not refused on both pages');
        throw Object.assign(new Error('refuse test done'), { done: true });
      }
    } else {
    await ev(pages[0], `document.getElementById('net-host').click(); true`);
      let code = '';
      for (let i = 0; !code; i++) { if (i > 100) throw new Error('no room code'); await sleep(100); code = await ev(pages[0], `document.getElementById('net-code-show').textContent`); }
      console.log(`host: room ${code} (${T()})`);
      await ev(pages[1], `document.getElementById('net').open = true; document.getElementById('net-code').value = ${JSON.stringify(code.toLowerCase())}; document.getElementById('net-join').click(); true`);
    }
    for (let i = 0; ; i++) {
      const r = await Promise.all(pages.map((p) => ev(p, 'GSNet.ready()')));
      if (r[0] && r[1]) break;
      if (i > 300) throw new Error('not linked after 30 s: ' + (await Promise.all(pages.map((p) => ev(p, 'GSNet.state')))).join(' | '));
      await sleep(100);
    }
    const linkedAt = await Promise.all(pages.map(frames));
    console.log(`linked at frames ${linkedAt.join('/')} (${T()})`);
    // play: captures of both screens at the same game frames, until FRAMES
    const shot = async (p, f) => {
      const b64 = await ev(p, `(() => { const m = window.__gs, a = m._Port_FrameBuffer(); let s = ''; const u = m.HEAPU8.subarray(a, a + 240 * 160 * 4);
        for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); })()`);
      const file = path.join(OUT, `${p.name}_frame_${String(f).padStart(5, '0')}.png`);
      fs.writeFileSync(file, png(Buffer.from(b64, 'base64'), 240, 160));
    };
    let taken = [new Set(), new Set()];
    let last = 0;
    const play = async (until) => {
      for (;;) {
        const fr = await Promise.all(pages.map(frames));
        for (const p of pages) for (const s of SHOTS) if (fr[p.i] >= s && !taken[p.i].has(s)) { taken[p.i].add(s); await shot(p, s); }
        if (Date.now() - last > 10000) {
          last = Date.now();
          const st = await Promise.all(pages.map((p) => ev(p, 'JSON.stringify({s: GSNet.stats, last: GSNet.last, state: GSNet.state})')));
          console.log(`[${T()}] frames ${fr.join('/')}: a ${st[0]}\n            b ${st[1]}`);
        }
        if (fr[0] >= until && fr[1] >= until) { if (until === FRAMES) for (const p of pages) await shot(p, FRAMES); break; }
        if (Date.now() - t0 > (LEAVE ? 700000 : 400000)) { fail.push(`timeout at frames ${fr.join('/')}`); break; }
        if (pages.some((p) => p.errors.length)) { fail.push('console errors'); break; }
        await sleep(150);
      }
    };
    if (LEAVE) {
      await play(LEAVE);
      const [a, b] = pages;
      const fb0 = await frames(b);
      if (SILENT) await ev(a, 'RTCDataChannel.prototype.send = function () {}; window.__gsScript = null; true');
      else await send('Target.closeTarget', { targetId: a.target });
      console.log(`leave: tab a ${SILENT ? 'silent' : 'closed'} at a frame >= ${LEAVE}, b at ${fb0} (${T()})`);
      const t1 = Date.now();
      if (SILENT) console.log(`leave: b meanwhile: "${await waitStatus(b, /not responding/, 'b: not responding', 100)}"`);
      const st = await waitStatus(b, /partner left/, 'b after a closed its tab', 400);
      if (SILENT) { await shot(b, 90000 + (await frames(b))); await send('Target.closeTarget', { targetId: a.target }); }
      console.log(`leave: b saw it after ${((Date.now() - t1) / 1000).toFixed(1)} s`);
      const note = await ev(b, 'document.getElementById("status").textContent');
      console.log(`leave: b status "${st}" | notice "${note}"`);
      for (let i = 0; (await frames(b)) < fb0 + 300 && i < 100; i++) await sleep(100);
      await shot(b, 90000 + (await frames(b)));   // b's screen after the leave (the game's disconnect message)
      const fb1 = await frames(b);
      if (fb1 < fb0 + 250) fail.push(`b's game stalled after the leave (${fb0} -> ${fb1})`);
      if (await ev(b, 'GSNet.ready()')) fail.push('b still linked after a left');
      // new tab a (same browser context: the same saved game), b returns to the title, b hosts, a joins
      await openTab(a, `http://127.0.0.1:${PORT}/index.html${q}`);
      for (let i = 0; !(await ev(a, 'typeof window.__gs === "object" && !!window.GSNet')); i++) { if (i > 300) throw new Error('a (new tab): the game did not start'); await sleep(100); }
      await ev(a, `window.__gsScript = ${script}; true`);
      await ev(b, `document.getElementById('opt-title').click(); document.getElementById('opt-title').click(); true`);
      for (let i = 0; i < 100; i++) { const f = await frames(b); if (f > 0 && f < fb1) break; await sleep(50); }
      console.log(`return to title: b restarted (frames ${await frames(b)}), a new tab at ${await frames(a)} (${T()})`);
      await ev(b, `document.getElementById('net-host').click(); true`);
      let code2 = '';
      for (let i = 0; !code2; i++) { if (i > 100) throw new Error('no second room code'); await sleep(100); code2 = await ev(b, `document.getElementById('net-code-show').textContent`); }
      await ev(a, `document.getElementById('net').open = true; document.getElementById('net-code').value = ${JSON.stringify(code2)}; document.getElementById('net-join').click(); true`);
      for (let i = 0; ; i++) {
        const r = await Promise.all(pages.map((p) => ev(p, 'GSNet.ready()')));
        if (r[0] && r[1]) break;
        if (i > 300) throw new Error('not re-linked after 30 s: ' + (await Promise.all(pages.map((p) => ev(p, 'GSNet.state')))).join(' | '));
        await sleep(100);
      }
      console.log(`re-linked (b hosts room ${code2}) at frames ${(await Promise.all(pages.map(frames))).join('/')} (${T()})`);
      taken = [new Set(), new Set()];
      // the second battle's hashes on b: compare only what happens from here on
      await ev(b, 'GSNet.stats.hashOk = 0; GSNet.stats.hashBad = 0; GSNet.stats.firstBad = null; true');
    }
    await play(FRAMES);
    const fin = await Promise.all(pages.map((p) => ev(p, `({s: GSNet.stats, last: GSNet.last, state: GSNet.state, frames: window.__gsFrames,
      fps: window.__gsFrames / (performance.now() / 1000), vis: document.visibilityState})`)));
    for (const p of pages) {
      const f = fin[p.i];
      console.log(`${p.name}: frames ${f.frames} (~${f.fps.toFixed(1)}/s since load, page ${f.vis}), hashes agree ${f.s.hashOk}, differ ${f.s.hashBad}, rtt ${f.s.rtt} ms, ` +
        `sent ${f.s.sent} recv ${f.s.recv}, netsim dropped ${f.s.simDropped}, last ${JSON.stringify(f.last)}, ${p.errors.length} errors, ${p.warnings.length} warnings`);
      for (const e of p.errors.slice(0, 5)) console.log('  error:', String(e).slice(0, 300));
      for (const w of [...new Set(p.warnings)].slice(0, 5)) console.log('  warning:', String(w).slice(0, 200));
      if (f.s.hashBad) fail.push(p.name + ': hash mismatch ' + f.s.firstBad);
      if (f.s.hashOk < 3) fail.push(p.name + ': only ' + f.s.hashOk + ' turn hashes agreed');
      if (p.errors.length) fail.push(p.name + ': console errors');
    }
    const [la, lb] = [fin[0].last, fin[1].last];
    let result = 'no battle';
    if (la && lb) result = la.hp[0] === 0 && lb.hp[1] === 0 ? 'b won (a down on both screens)' : la.hp[1] === 0 && lb.hp[0] === 0 ? 'a won (b down on both screens)' : `open (a ${la.hp}, b ${lb.hp})`;
    if (!/won/.test(result)) fail.push('result: ' + result);
    console.log('result: ' + result);
    // side-by-side sheet, a | b per pair
    const files = [...SHOTS, FRAMES].filter((s, i, a) => a.indexOf(s) === i && fs.existsSync(path.join(OUT, `b_frame_${String(s).padStart(5, '0')}.png`))).filter((s) => fs.existsSync(path.join(OUT, `a_frame_${String(s).padStart(5, '0')}.png`))).flatMap((s) => ['a', 'b'].map((n) => path.join(OUT, `${n}_frame_${String(s).padStart(5, '0')}.png`)));
    if (files.length) { execFileSync(process.execPath, [path.join(ROOT, 'tools/contact.cjs'), path.join(OUT, 'sheet.png'), '4', ...files]); console.log('sheet: ' + path.relative(ROOT, path.join(OUT, 'sheet.png'))); }
    console.log('room server: ' + roomLog.filter((l) => !/listening/.test(l)).join('; '));
    ws.close();
  } catch (e) {
    if (!e.done) fail.push(e.message);
  } finally {
    cleanup();
    await sleep(1000);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* removed next run */ }
  }
  console.log(fail.length ? 'web_link: FAIL: ' + fail.join('; ') : `web_link: PASS (${REFUSE ? 'hello refusal' : NETSIM ? 'netsim ' + NETSIM : 'clean'}${MANUAL ? ', manual codes' : ''})`);
  process.exit(fail.length ? 1 : 0);
}
main();
