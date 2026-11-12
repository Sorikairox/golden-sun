// GS37: The Lost Age's party from the Golden Sun save on the same device, in the real retrowser host (retrowser's
// manifest saveFrom: TLA's manifest names GS1's at the repository root; port/rtw/rtw_tla_party.c, rtw_glue.js).
//   node tests/rtw_party_e2e.mjs OUTDIR [GS1_SAVE]   (default GS1_SAVE: port_work/tla8/gs1_clear.sav, tools/transfer_pw.sh)
// Same host setup as tests/rtw_e2e.mjs (the local retrowser checkout's dist, its GitHub mock serving what main commits,
// one muted headless Chrome). The GS1 save is put in the host's save store under "golden-sun" (as if GS1 had been
// played on this device); TLA then gets the player's keys only: Felix named (START, A), "Transfer data from Golden
// Sun?" A (Yes), B to leave the party review. Cases:
//   auto    the Transfer Method menu is not shown (Link cable by the port), TLA receives the 4,100-byte bulk; with the
//           default save, TLA's units + flags SHA-1 = route (a)'s (tests/transfer_a.cjs: 14648e8f916d / 6ffcc5c1ef6b)
//   nosave  GS1's save removed: the menu runs as on the cartridge, nothing received
import { mkdirSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [outArg, saveArg] = process.argv.slice(2);
if (!outArg) { console.error('usage: rtw_party_e2e.mjs OUTDIR [GS1_SAVE]'); process.exit(2); }
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(outArg);
const RTW = process.env.RETROWSER_DIR || join(homedir(), 'Code/retrowser');
const GS1_SAVE = resolve(saveArg || join(ROOT, 'port_work/tla8/gs1_clear.sav'));
const ROUTE_A = !saveArg;   // the route (a) save: TLA's party is known
const WANT = { units: '14648e8f916d', flags: '6ffcc5c1ef6b' };
const KEY = { A: 1, B: 2, SELECT: 4, START: 8 };
const CFG = { id: 'golden-sun-tla', path: 'retrowser/tla', rom: process.env.ROM_TLA || join(homedir(), 'roms/Golden_Sun_The_Lost_Age_USA_Europe.gba') };
if (!existsSync(GS1_SAVE)) { console.error(`missing ${GS1_SAVE}`); process.exit(2); }
mkdirSync(OUT, { recursive: true });
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
async function untilFrame(n, ms = 300000) {
  const until = Date.now() + ms;
  let f = 0;
  while (Date.now() < until) { f = (await frames()) ?? 0; if (f >= n) return f; await page.waitForTimeout(100); }
  throw new Error(`frame ${n} not reached (at ${f})`);
}
const keys = (spec) => spec.split(',').map((s) => { const [k, r] = s.split('@'); const [a, b] = r.split('-').map(Number); return { mask: KEY[k], a, b: b ?? a, per: 0 }; });
// the host's save store (src/host/lib/db.ts): GS1's save as if GS1 had been played here
const putGs1 = (bytes) => page.evaluate(async (arr) => {
  const db = await new Promise((ok, no) => { const q = indexedDB.open('retrowser'); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); });
  await new Promise((ok, no) => {
    const t = db.transaction('saves', 'readwrite');
    if (arr) t.objectStore('saves').put({ key: 'golden-sun:flash', id: 'golden-sun', kind: 'flash', bytes: new Uint8Array(arr), generation: 1, savedAt: Date.now() });
    else t.objectStore('saves').delete('golden-sun:flash');
    t.oncomplete = ok; t.onerror = () => no(t.error);
  });
  db.close();
}, bytes ? [...bytes] : null);
const state = () => inWorker(() => {
  const M = globalThis.__rtwGs.Module, H = M.HEAPU8;
  const hex = async (a, n) => [...new Uint8Array(await crypto.subtle.digest('SHA-1', H.slice(a, a + n)))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
  return Promise.all([hex(0x02000520, 8 * 0x14c), hex(0x02000040, 0x200)]).then(([units, flags]) => ({
    party: globalThis.__rtwGs.party(), hits: M._Port_TlaAutoTransferHits(), menu: M._Port_TlaTransferMenuShown(), rx: M._Port_LinkStat(2), units, flags }));
});
async function open(script) {
  await page.goto(`${hostUrl}/g/${REPO}?path=${encodeURIComponent(CFG.path)}`);
  const cart = page.locator('[data-action=cartridge]'), stored = page.locator('[data-action=use-stored]');
  const rompick = page.locator('[data-field=rom]'), playing = page.locator('[data-state=playing]');
  await cart.waitFor({ timeout: 60000 });
  await cart.click({ force: true });
  await Promise.race([stored.first().waitFor({ timeout: 180000 }), rompick.waitFor({ timeout: 180000 }), playing.waitFor({ timeout: 180000 })]);
  if (await stored.first().isVisible().catch(() => false)) await stored.first().click();
  else if (await rompick.isVisible().catch(() => false)) await rompick.setInputFiles(CFG.rom);
  const until = Date.now() + 120000;
  let f = null;
  while (Date.now() < until) {
    f = await inWorker((sp) => { globalThis.__rtwGs.script(sp); return globalThis.__rtwGs.frames(); }, script).catch(() => null);
    if (f !== null) break;
    await page.waitForTimeout(20);
  }
  if (script[0].mask) check(`script installed before its first key (frame ${f})`, f !== null && f < 450);
}
const NAME_YES_B = 'START@450-452,A@480-482,A@650-652,B@900-902';

try {
  // a first start makes the host's stores (and remembers the ROM)
  await open([{ mask: 0, a: 100000, b: 100000, per: 0 }]);
  await untilFrame(30);
  // ---- auto
  await putGs1(readFileSync(GS1_SAVE));
  await open(keys(NAME_YES_B));
  await untilFrame(760);
  await page.screenshot({ path: join(OUT, 'party_after_yes.png') });
  await untilFrame(1000);
  const a = await state();
  await page.screenshot({ path: join(OUT, 'party_end.png') });
  say('auto: ' + JSON.stringify(a));
  check('auto: the host gave TLA the GS1 save and a cleared file was found', a.party && a.party.given === 1 && a.party.file >= 0, JSON.stringify(a.party));
  check('auto: Transfer Method answered Link cable by the port (menu not shown)', a.hits === 1 && a.menu === 0);
  check('auto: TLA received the bulk from the virtual GS1', a.rx >= 1);
  if (ROUTE_A) check(`auto: units ${a.units} flags ${a.flags} = route (a)'s`, a.units === WANT.units && a.flags === WANT.flags);
  // ---- nosave
  await putGs1(null);
  await open(keys(NAME_YES_B));
  await untilFrame(1000);
  const n = await state();
  say('nosave: ' + JSON.stringify(n));
  check('nosave: no GS1 save given', n.party && n.party.given === 0 && n.party.file === -1);
  check('nosave: the Transfer Method menu runs as on the cartridge, nothing received', n.hits === 0 && n.menu === 1 && n.rx === 0);
} catch (e) {
  say('ERROR ' + (e && e.stack || e));
  results.push(['exception', false]);
  await page.screenshot({ path: join(OUT, 'party_error.png') }).catch(() => {});
}
clearTimeout(timer);
const bad = results.filter(([, ok]) => !ok).length + (pageErrors.length ? 1 : 0);
say(bad ? `RTW_PARTY_E2E: ${bad} failure(s)` : `RTW_PARTY_E2E: ALL PASS (${results.length} checks)`);
await finish(bad ? 1 : 0);
