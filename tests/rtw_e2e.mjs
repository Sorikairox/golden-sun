// End-to-end test of the retrowser.app build (docs/RTW.md) in the real retrowser host, one game per run:
//   node tests/rtw_e2e.mjs gs1|tla OUTDIR      (tools/rtw_e2e.sh runs both, one after the other)
// The host is the local retrowser checkout's built dist (RETROWSER_DIR, default ~/Code/retrowser; `npm run build`
// there), served in this process by its own Worker handler (tools/serve-worker.ts); the game repo is served by its
// GitHub mock (tools/mock-github.ts) from a staged copy of what main commits (retrowser.json + retrowser/, in
// OUTDIR/repo) as sorikairox/golden-sun. One muted headless Chrome, started and closed here; nothing is left
// running. The ROM is only handed to the host's file input (read only, never copied). Captures go to OUTDIR
// (port_work/..., never committed).
// Checks, in order:
//   1 boot: Download -> ROM -> the game runs; frames at the title (screenshots), the picture has colours;
//   2 audio: the module's drained samples are not all zero, and the host's audio engine received them;
//   3 save: an in-game save by real play (the regress routes' keys held by game frame through the glue's test
//     hook, so the run is the same as tools/regress.sh's): the host stores the flash image and its SHA-1 equals
//     tests/regress's (GS1 prologue_save, TLA save);
//   4 input: host keyboard keys reach the game (KEYINPUT while held; GS1: the leader walks);
//   5 reload: the save comes back (the module's flash = the stored image) and the game's Continue loads it
//     (GS1: the leader stands where it was saved);
//   6 offline: network cut (page, sandbox frame, workers), reload: the game opens from the stored ROM and runs,
//     the save still there.
import { mkdirSync, readFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

import { fileURLToPath } from 'node:url';

const [game, outArg] = process.argv.slice(2);
if (!['gs1', 'tla'].includes(game) || !outArg) { console.error('usage: rtw_e2e.mjs gs1|tla OUTDIR'); process.exit(2); }
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(outArg);
const RTW = process.env.RETROWSER_DIR || join(homedir(), 'Code/retrowser');
const R = join(ROOT, 'tests/routes');
const KEY = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };
const CFG = {
  gs1: { id: 'golden-sun', path: '', rom: process.env.ROM || join(homedir(), 'roms/Golden_Sun_USA_Europe.gba'),
    titleShots: [120, 250, 450], route: ['prologue.keys', 'first_save.keys'], saveDone: 5450, saveSha1: '351e17a2fdc44280',
    cont: ['vale_day1_continue.keys'], titleAt: 1400, contDone: 2100 },
  tla: { id: 'golden-sun-tla', path: 'retrowser/tla', rom: process.env.ROM_TLA || join(homedir(), 'roms/Golden_Sun_The_Lost_Age_USA_Europe.gba'),
    titleShots: [250, 380, 450], route: ['tla/new_game.keys', 'tla/opening.keys', 'tla/save.keys'], saveDone: 15300,
    saveSha1: 'c8b2e98842156df4', cont: ['tla/continue.keys'], titleAt: 480, contDone: 1800 },
}[game];
const spans = (files) => files.map((f) => readFileSync(join(R, f), 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean).join(','))
  .join(',').split(',').filter(Boolean).map((s) => {
    const [k, r0] = s.split('@'); const [r, per] = r0.split('/'); const [a, b] = r.split('-').map(Number);
    return { mask: k.split('+').reduce((m, n) => m | KEY[n], 0), a, b: b ?? a, per: +per || 0 };
  });
const firstKey = (sp) => Math.min(...sp.map((s) => s.a));

// the repo as main commits it: GS1's manifest at the root, the files under retrowser/
const REPO_DIR = join(OUT, 'repo');
for (const f of ['retrowser.json', 'retrowser/gs1/gs1.wasm', 'retrowser/gs1/gs1.js', 'retrowser/tla/retrowser.json', 'retrowser/tla/tla.wasm', 'retrowser/tla/tla.js']) {
  mkdirSync(dirname(join(REPO_DIR, f)), { recursive: true });
  copyFileSync(join(ROOT, f), join(REPO_DIR, f));
}
const t0 = Date.now(), say = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
const results = [];
const check = (name, ok, detail) => { results.push([name, ok]); say(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`); };

const { chromium } = await import(join(RTW, 'node_modules/playwright-core/index.mjs'));
const { startMockGithub } = await import(join(RTW, 'tools/mock-github.ts'));
const { serveWorker } = await import(join(RTW, 'tools/serve-worker.ts'));
const REPO = 'sorikairox/golden-sun', COMMIT = 'c0ffee00000000000000000000000000000000a1';
const mock = await startMockGithub({ [REPO]: { refs: { main: COMMIT }, commits: [{ sha: COMMIT, dir: REPO_DIR }] } });
const PORT = Number(process.env.RTW_SERVE || 8791);
const served = await serveWorker(PORT);
const hostUrl = `http://localhost:${PORT}`;
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addInitScript((ep) => { try { if (location.hostname === 'localhost') localStorage.setItem('rtw:test-endpoints', ep); } catch { /* ignore */ } },
  JSON.stringify(mock.endpoints));
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
let finished = false;
const finish = async (code) => {
  if (finished) return; finished = true;
  try { const log = await page.getAttribute('[data-state=playing]', 'data-log', { timeout: 2000 }); if (log) say('host log tail: ' + log.split('\n').slice(-6).join(' | ')); } catch { /* none */ }
  if (pageErrors.length) say('page errors: ' + pageErrors.slice(0, 5).join(' | '));
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  await mock.close().catch(() => {});
  await new Promise((ok) => { served.closeAllConnections?.(); served.close(ok); });
  process.exit(code);
};
const timer = setTimeout(() => { say('TIMEOUT'); finish(3); }, Number(process.env.RTW_TIMEOUT || 1500000));

const gameWorker = async () => {
  for (const w of page.workers()) {
    try { if (await w.evaluate(() => typeof globalThis.__rtwGs === 'object')) return w; } catch { /* gone */ }
  }
  return null;
};
const inWorker = async (fn, arg) => { const w = await gameWorker(); return w ? w.evaluate(fn, arg) : null; };
const frames = () => inWorker(() => globalThis.__rtwGs.frames());
async function waitFrames(n, ms = 900000) {
  const until = Date.now() + ms;
  let f = 0;
  while (Date.now() < until) { f = (await frames()) ?? 0; if (f >= n) return f; await page.waitForTimeout(f + 120 < n ? 1000 : 50); }
  return f;
}
// the module's flash image (rtw_save_ptr / rtw_save_size) and the host's stored save for this id
const moduleSave = () => inWorker(async () => {
  const M = globalThis.__rtwGs.Module, p = M._rtw_save_ptr() >>> 0, n = M._rtw_save_size();
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', M.HEAPU8.slice(p, p + n)));
  return { sha1: [...h].map((b) => b.toString(16).padStart(2, '0')).join(''), generation: M._rtw_save_generation() };
});
const hostSave = (id) => page.evaluate(async (key) => {
  const db = await new Promise((ok, no) => { const q = indexedDB.open('retrowser'); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); });
  const v = await new Promise((ok) => { const q = db.transaction('saves').objectStore('saves').get(key); q.onsuccess = () => ok(q.result); q.onerror = () => ok(null); });
  db.close();
  if (!v) return null;
  const b = v.bytes instanceof ArrayBuffer ? new Uint8Array(v.bytes) : new Uint8Array(v.bytes.buffer || v.bytes);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', b));
  return { size: b.length, sha1: [...h].map((x) => x.toString(16).padStart(2, '0')).join(''), generation: v.generation };
}, `${id}:flash`);
// GS1 only (tests/probes/where.cjs): scene and the party leader's 16-pixel cell
const where = () => inWorker(() => {
  const H = globalThis.__rtwGs.Module.HEAPU8;
  const s16 = (a) => (H[a] | H[a + 1] << 8) << 16 >> 16, u32 = (a) => (H[a] | H[a + 1] << 8 | H[a + 2] << 16 | H[a + 3] << 24) >>> 0;
  const inRam = (a) => a >= 0x02000000 && a < 0x03008000;
  const scene = s16(0x02000240 + 0x1c0), fw = u32(0x03001ebc);
  if (!inRam(fw) || !inRam(u32(fw + 20))) return { scene, cell: null };
  const l = u32(fw + 20), x = (u32(l + 8) | 0) / 65536, z = (u32(l + 16) | 0) / 65536;
  return { scene, x: +x.toFixed(1), z: +z.toFixed(1), cell: `${x >> 4},${z >> 4}` };
});
const picture = () => inWorker(() => {
  const M = globalThis.__rtwGs.Module, p = M._rtw_fb() >>> 0, w = M._rtw_fb_width(), h = M._rtw_fb_height();
  const px = new Uint32Array(M.HEAPU8.buffer, p, w * h), colours = new Set();
  let hash = 2166136261;
  for (let i = 0; i < px.length; i++) { colours.add(px[i]); hash = Math.imul(hash ^ px[i], 16777619) >>> 0; }
  return { w, h, colours: colours.size, hash: hash.toString(16) };
});
const keyinput = () => inWorker(() => { const H = globalThis.__rtwGs.Module.HEAPU8; return (~(H[0x04000130] | H[0x04000131] << 8)) & 0x3ff; });
const shot = async (name) => { await page.screenshot({ path: join(OUT, `${game}_${name}.png`) }); };

// the host's own menu: option ID to V (checkbox or select), then back to the game (the host pauses it meanwhile)
async function hostOption(id, v) {
  await page.click('[data-action=menu]');
  const row = page.locator(`[data-option="${id}"]`);
  await row.waitFor({ timeout: 5000 });
  const box = row.locator('input[type=checkbox]');
  if (await box.count()) { if ((await box.isChecked()) !== !!v) await box.click(); }
  else await row.locator('select').selectOption(String(v));
  await page.waitForTimeout(300);
  await page.click('[data-action=close-menu]').catch(() => {});
  await page.waitForTimeout(500);
}
const hostStored = () => page.evaluate((id) => JSON.parse(localStorage.getItem(`rtw:options:${id}`) || '{}'), CFG.id);
const hostMenuValue = async (id) => {
  await page.click('[data-action=menu]');
  const row = page.locator(`[data-option="${id}"]`);
  await row.waitFor({ timeout: 5000 });
  const box = row.locator('input[type=checkbox]');
  const v = (await box.count()) ? ((await box.isChecked()) ? 1 : 0) : Number(await row.locator('select').inputValue());
  await page.click('[data-action=close-menu]').catch(() => {});
  await page.waitForTimeout(300);
  return v;
};
const press = async (code, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.down(code); await page.waitForTimeout(100); await page.keyboard.up(code); await page.waitForTimeout(450); } };

async function open(script) {
  const q = CFG.path ? `?path=${encodeURIComponent(CFG.path)}` : '';
  await page.goto(`${hostUrl}/g/${REPO}${q}`);
  const download = page.locator('[data-action=download]'), stored = page.locator('[data-action=use-stored]');
  const rompick = page.locator('[data-field=rom]'), playing = page.locator('[data-state=playing]');
  await Promise.race([download.waitFor({ timeout: 60000 }), playing.waitFor({ timeout: 60000 }), stored.waitFor({ timeout: 60000 }), rompick.waitFor({ timeout: 60000 })]);
  if (await download.isVisible().catch(() => false)) { say('download'); await download.click(); }
  await Promise.race([stored.first().waitFor({ timeout: 180000 }), rompick.waitFor({ timeout: 180000 })]);
  if (await stored.first().isVisible().catch(() => false)) { say('the stored ROM'); await stored.first().click(); }
  else { say('ROM through the file input'); await rompick.setInputFiles(CFG.rom); }
  // the test script (keys by game frame) as soon as the worker has the glue: before the route's first key
  if (script) {
    const until = Date.now() + 120000;
    let f = null;
    while (Date.now() < until) {
      f = await inWorker((sp) => { globalThis.__rtwGs.script(sp); return globalThis.__rtwGs.frames(); }, script).catch(() => null);
      if (f !== null) break;
      await page.waitForTimeout(20);
    }
    check(`script installed before its first key (frame ${f} < ${firstKey(script)})`, f !== null && f < firstKey(script));
  }
  await page.waitForFunction(() => Number(document.querySelector('[data-state=playing]')?.getAttribute('data-frames') ?? 0) > 10, null, { timeout: 120000 });
  await page.click('[data-state=persist-warning] button', { timeout: 1000 }).catch(() => {});
  say('playing');
}
async function network(offline) {
  for (const f of [page.mainFrame(), ...page.frames().filter((x) => x !== page.mainFrame())]) {
    try { const s = await context.newCDPSession(f === page.mainFrame() ? page : f); await s.send('Network.enable'); await s.send('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); } catch { /* same process */ }
  }
  await context.setOffline(offline);
}

try {
  mkdirSync(OUT, { recursive: true });
  // ---- 1-4: fresh profile, power-on, the save route by real play
  const route = spans(CFG.route);
  await open(route);
  for (const f of CFG.titleShots) { await waitFrames(f); await shot(`title_f${f}`); }
  const pic = await picture();
  check('boot: picture at the title', pic && pic.colours > 8, JSON.stringify(pic));
  // audio starts on the player's first gesture: a click on the host page beside the picture (no game key)
  await page.mouse.click(5, 300);
  await page.waitForFunction(() => JSON.parse(document.querySelector('[data-state=playing]')?.getAttribute('data-audio') ?? '{}').queuedMs !== undefined, null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const au = await inWorker(() => globalThis.__rtwGs.audio());
  const hostAudio = JSON.parse(await page.getAttribute('[data-state=playing]', 'data-audio').catch(() => 'null') || 'null');
  check('audio: the module drains non-zero samples', au && au.nonZero > 0, JSON.stringify(au));
  check('audio: the host plays them (worklet running, samples played, queue filled)', hostAudio && hostAudio.state === 'running' && hostAudio.played > 0 && hostAudio.queuedMs > 0, JSON.stringify(hostAudio));
  say(`real play to the save (frame ${CFG.saveDone}, ~${Math.round(CFG.saveDone / 60)} s)`);
  await waitFrames(CFG.saveDone);
  await shot('saved');
  const ms = await moduleSave();
  let hs = null;
  for (let i = 0; i < 40 && !(hs && hs.sha1 === ms.sha1); i++) { hs = await hostSave(CFG.id); await page.waitForTimeout(250); }
  check('save: the game wrote its flash', ms.generation > 0, JSON.stringify(ms));
  check(`save: the host stored it, SHA-1 = tests/regress's ${CFG.saveSha1}`, hs && hs.size === 65536 && hs.sha1 === ms.sha1 && hs.sha1.startsWith(CFG.saveSha1), JSON.stringify(hs));
  const savedAt = game === 'gs1' ? await where() : null;
  if (savedAt) say('saved at ' + JSON.stringify(savedAt));
  // input through the host's keyboard (its default keymap: arrows, X = A, Z = B, Enter = Start)
  // B (Z) twice closes the menu the save left open, then Down walks
  for (let i = 0; i < 2; i++) { await page.keyboard.down('KeyZ'); await page.waitForTimeout(120); await page.keyboard.up('KeyZ'); await page.waitForTimeout(700); }
  const before = game === 'gs1' ? await where() : null, picBefore = await picture();
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(300);
  const held = await keyinput();
  await page.waitForTimeout(900);
  await page.keyboard.up('ArrowDown');
  await page.waitForTimeout(300);
  const after = game === 'gs1' ? await where() : null, picAfter = await picture();
  await shot('input_after');
  check('input: a host key reaches KEYINPUT (Down)', held === KEY.DOWN, `keys 0x${(held ?? 0).toString(16)}`);
  if (game === 'gs1') check('input: the leader walks', before && after && (before.x !== after.x || before.z !== after.z), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  else check('input: the picture changes', picBefore.hash !== picAfter.hash, `${picBefore.hash} -> ${picAfter.hash}`);

  // options: the host's menu sets them in the module (rtw_option); GS1's own Extra settings tell the host
  // (rtw_option_changed, standard 1.1)
  const raw = () => inWorker(() => { const M = globalThis.__rtwGs.Module; return M._rtw_fb() >>> 0 === M._Port_FrameBuffer() >>> 0; });
  await hostOption(0, 1);
  const lcdPic = await picture(), lcdRaw = await raw();
  await shot('option_lcd');
  await hostOption(0, 0);
  check('options: host "GBA screen colours" changes the picture (and back)', lcdRaw === false && (await raw()) === true && lcdPic.hash !== (await picture()).hash, `lcd ${lcdPic.hash}`);
  if (game === 'gs1') {
    await hostOption(2, 2);
    const z = await picture();
    await shot('option_zoom_most');
    check('options: host "Map zoom" Most -> 336 x 224 field picture', z.w === 336 && z.h === 224, `${z.w} x ${z.h}`);
    // in the game: START (Pause menu), R (Extra settings), Down Down (Map zoom), Left (Most -> More), B, B
    await press('Enter'); await page.waitForTimeout(600);
    await press('KeyS'); await page.waitForTimeout(600);
    await shot('extra_settings');
    await press('ArrowDown', 2); await press('ArrowLeft');
    await press('KeyZ'); await page.waitForTimeout(400); await press('KeyZ'); await page.waitForTimeout(800);
    const z2 = await picture(), st = await hostStored(), mv = await hostMenuValue(2);
    check('options: the in-game Extra settings change reaches the host (stored + menu)', z2.w === 288 && st['2'] === 1 && mv === 1, `picture ${z2.w} x ${z2.h}, stored ${JSON.stringify(st)}, menu ${mv}`);
    await hostOption(2, 0);
    const z3 = await picture();
    check('options: host "Map zoom" back to Normal', z3.w === 240, `${z3.w} x ${z3.h}`);
  }

  // ---- 5: reload, the save is loaded, Continue
  await page.reload();
  const cont = spans(CFG.cont);
  await open(cont);
  const ms2 = await moduleSave();
  check('reload: the module holds the stored save', ms2.sha1 === ms.sha1, JSON.stringify(ms2));
  await waitFrames(CFG.titleAt);   // with a save the game shows its title screen first (START there)
  await shot('title_with_save');
  const tp = await picture();
  check('boot: the title screen (with a save) has a picture', tp && tp.colours > 8, JSON.stringify(tp));
  await waitFrames(CFG.contDone);
  await shot('continued');
  if (game === 'gs1') {
    const w = await where();
    check('reload: Continue loads the save (leader where it was saved)', w && savedAt && w.scene === savedAt.scene && w.cell === savedAt.cell, JSON.stringify(w));
  } else {
    const p2 = await picture();
    check('reload: Continue reaches the field (picture has colours; see tla_continued.png)', p2 && p2.colours > 16, JSON.stringify(p2));
  }

  // ---- 6: offline reload
  await network(true);
  say('network off');
  await page.reload();
  await open(null);
  const f0 = (await frames()) ?? 0;
  await page.waitForTimeout(3000);
  const f1 = (await frames()) ?? 0;
  const ms3 = await moduleSave();
  await shot('offline');
  check('offline: the game opens and runs with no network', f1 > f0 && f1 > 60, `frames ${f0} -> ${f1}`);
  check('offline: the save is still there', ms3 && ms3.sha1 === ms.sha1, JSON.stringify(ms3));
  await network(false);
} catch (e) {
  say('ERROR ' + (e && e.stack || e));
  results.push(['exception', false]);
  await page.screenshot({ path: join(OUT, `${game}_error.png`) }).catch(() => {});
  say('page text: ' + (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 1500));
}
clearTimeout(timer);
const bad = results.filter(([, ok]) => !ok).length;
if (pageErrors.length) results.push(['page errors', false]);
say(bad || pageErrors.length ? `RTW_E2E ${game}: ${bad + (pageErrors.length ? 1 : 0)} failure(s)` : `RTW_E2E ${game}: ALL PASS (${results.length} checks)`);
await finish(bad || pageErrors.length ? 1 : 0);

