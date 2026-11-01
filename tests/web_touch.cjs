// Touch controls test in muted headless Chrome (orchestrator rule 11): phone emulation (touch, coarse pointer), the
// page with the player's ROM (a symlink in gitignored port_work, as in web_shot.cjs), portrait then landscape. On the
// File Screen's name entry (~frame 600) it dispatches CDP touch events on the on-screen pad and checks the touch key
// state, the game's KEYINPUT register (active low, at GBA 0x04000130 in the flat wasm memory), that the picture
// changes (the cursor moves), multi-touch, a D-pad slide, release on rotation, and that the keyboard still works.
// Screenshots: port_work/touch/portrait*.png, landscape*.png (gitignored). One headless Chrome at a time.
// Usage: node tests/web_touch.cjs   (needs build/site: tools/web_build.sh && tools/site.sh)
'use strict';
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROM = process.env.ROM || path.join(process.env.HOME, 'roms/Golden_Sun_USA_Europe.gba');
const PORT = 8937 + (process.pid % 200);
const DEBUG_PORT = 9537 + (process.pid % 200);
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
  const dir = path.join(ROOT, 'port_work/webtouch');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'build/site'))) fs.symlinkSync(path.join(ROOT, 'build/site', f), path.join(dir, f));
  fs.symlinkSync(ROM, path.join(dir, 'rom.gba'));
  const out = path.join(ROOT, 'port_work/touch');
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
        if (Date.now() - t0 > 240000) throw new Error('timeout');
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

    await send('Runtime.enable');
    await send('Page.enable');
    await phone(390, 844);
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?romurl=rom.gba` });   // no ?touch: Auto
    while ((await frames()) < 620) {
      if (Date.now() - t0 > 240000) throw new Error(`only ${await frames()} frames`);
      if (errors.length) throw new Error('page error: ' + errors[0]);
      await sleep(100);
    }
    const st = await ev('GSTouch.state()');
    check(st.on && st.playing, `Auto turns the pad on under phone emulation (state ${JSON.stringify(st)})`);
    check(await ev('!document.getElementById("touch").hidden'), 'pad visible');
    const scr = await ev('(() => { const r = document.getElementById("screen").getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()');
    check(scr[1] < 2 && Math.abs(scr[2] - 390) < 2, `portrait: picture on top at full width (${scr.map(Math.round)})`);
    check(await ev('document.documentElement.scrollHeight <= innerHeight + 1'), 'portrait: no page scroll');
    await shot('portrait');

    // the hand cursor starts on END; D-pad up moves it (picture changes), down brings it back
    const pass = async (label) => {
      check((await keyinput()) === 0x3FF && (await tkeys()) === 0, `${label}: nothing held at rest (KEYINPUT 0x3FF)`);
      const up = await centre('#tk-dpad', 0.5, 0.15);
      await snap();
      await touch('touchStart', [up]);
      await waitFrames(3);
      const k1 = await tkeys(), ki = await keyinput();
      check(k1 === K.UP && ki === (0x3FF & ~K.UP), `${label}: D-pad up -> touch keys ${k1}, KEYINPUT 0x${ki.toString(16)}`);
      check(await ev('document.querySelector("#tk-dpad .u").classList.contains("on")'), `${label}: up arm lit`);
      await shot(label + '_up_held');
      // multi-touch: keep up, press R with a second finger
      const r = await centre('#tk-R');
      await touch('touchStart', [up, { ...r, id: 2 }]);
      await waitFrames(2);
      const k2 = await tkeys();
      check(k2 === (K.UP | K.R) && (await keyinput()) === (0x3FF & ~(K.UP | K.R)), `${label}: multi-touch up + R -> ${k2}`);
      await touch('touchEnd', [{ ...r, id: 2 }]);   // R lifted, up still down
      await waitFrames(1);
      { const k = await tkeys(); check(k === K.UP, `${label}: R lifted, up still held (${k})`); }
      // slide: up -> up-right diagonal -> right
      const ur = await centre('#tk-dpad', 0.85, 0.15), rt = await centre('#tk-dpad', 0.9, 0.5);
      await touch('touchMove', [ur]);
      await waitFrames(1);
      const k3 = await tkeys();
      await touch('touchMove', [rt]);
      await waitFrames(1);
      const k4 = await tkeys();
      check(k3 === (K.UP | K.RIGHT) && k4 === K.RIGHT, `${label}: slide to diagonal ${k3} then right ${k4}`);
      await touch('touchEnd', []);
      await waitFrames(20);
      check((await tkeys()) === 0 && (await keyinput()) === 0x3FF, `${label}: all released after touchEnd`);
      const moved = await diff();
      check(moved > 50, `${label}: the game reacted (cursor moved: ${moved} pixels changed)`);
      await shot(label + '_moved');
      // A button lights up while held (tap on B: deletes a letter at worst; harmless here)
      const b = await centre('#tk-B');
      await touch('touchStart', [b]);
      await waitFrames(2);
      check((await tkeys()) === K.B && await ev('document.getElementById("tk-B").classList.contains("on")'), `${label}: B held and lit`);
      await touch('touchEnd', []);
      await waitFrames(2);
      check((await tkeys()) === 0, `${label}: B released`);
    };
    await pass('portrait');

    // rotate while a finger holds the D-pad: everything must be released, then landscape works
    const down = await centre('#tk-dpad', 0.5, 0.85);
    await touch('touchStart', [down]);
    await waitFrames(2);
    check((await tkeys()) === K.DOWN, 'before rotation: D-pad down held');
    await phone(844, 390);
    await waitFrames(5);
    check((await tkeys()) === 0 && (await keyinput()) === 0x3FF, `rotation releases every key (touch ${await tkeys()})`);
    await touch('touchEnd', []);
    await waitFrames(3);
    const scl = await ev('(() => { const r = document.getElementById("screen").getBoundingClientRect(); const d = document.getElementById("tk-dpad").getBoundingClientRect(), a = document.getElementById("tk-A").getBoundingClientRect(); return [r.left, r.top, r.width, r.height, d.right, a.left]; })()');
    check(Math.abs(scl[0] + scl[2] / 2 - 422) < 2 && scl[4] <= scl[0] + 1 && scl[5] >= scl[0] + scl[2] - 1,
      `landscape: picture centred, D-pad left of it, A right of it (${scl.map(Math.round)})`);
    check(await ev('document.documentElement.scrollWidth <= innerWidth + 1 && document.documentElement.scrollHeight <= innerHeight + 1'), 'landscape: no page scroll');
    await shot('landscape');
    await pass('landscape');

    // keyboard unchanged
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'ArrowLeft', key: 'ArrowLeft', windowsVirtualKeyCode: 37 });
    await waitFrames(3);
    const kk = await keyinput();
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ArrowLeft', key: 'ArrowLeft', windowsVirtualKeyCode: 37 });
    await waitFrames(3);
    check(kk === (0x3FF & ~K.LEFT) && (await keyinput()) === 0x3FF, `keyboard still drives the same key state (0x${kk.toString(16)})`);

    // page menu by touch: opens the setting, back returns to the game
    const menu = await centre('#tk-menu');
    await touch('touchStart', [menu]); await touch('touchEnd', []);
    await sleep(200);
    check(await ev('document.body.classList.contains("tmenu") && !document.getElementById("tk-back").hidden && document.getElementById("opt-touch").offsetParent !== null'), 'menu button opens the page menu (setting visible)');
    await shot('landscape_menu');
    const bk = await centre('#tk-back');
    await touch('touchStart', [bk]); await touch('touchEnd', []);
    await sleep(200);
    check(await ev('document.body.classList.contains("tplay")'), 'Back returns to the game');

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
