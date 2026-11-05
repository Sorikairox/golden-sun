// RTW2: GS1's online link battle in the retrowser.app build (docs/RTW.md section 7), end to end in the real host:
//   node tests/rtw_net_e2e.mjs OUTDIR            (tools/rtw_net_e2e.sh runs its variants; timing-sensitive: one at a time)
// Two pages (one browser context each, so each player has their own host storage) in ONE muted headless Chrome,
// started and closed here. The host is the local retrowser checkout's built dist (RETROWSER_DIR, default
// ~/Code/retrowser; `npm run build` there) served in this process by its Worker handler with its room server
// (tools/serve-worker.ts); the repo is served by its GitHub mock from a staged copy of what main commits
// (retrowser.json + retrowser/). Host ICE candidates only (localStorage rtw:test-net {"ice":[]}).
// Each player's host storage gets the web link test's battle save (port_work/g7/flash_battle.sav, made by
// tools/link2.sh from the regress routes' prologue save), the ROM goes to the host's file input only. Player 1 creates
// a room (the host's Online panel), player 2 joins with the code, player 1 presses Start: model "link", no reboot,
// both games keep running. Then both play tests/routes/link_*.keys (tests/web_link.cjs's routes, keys by game frame
// through the glue's test hook, shifted to start right after the session began): title, File Screen > Battle, the
// Battle Arena lobby, the attendant, the circle, the party exchange and a link battle to its end.
// Checks: session indexes (0 = room host = link parent), both linked; per-turn hashes (port/rtw/rtw_net.c's desync
// guard on channel 1) agree on both sides with none differing; the same result on both screens; link state agrees
// (bulks out on one side = bulks in on the other, battle and turn counts); no bad or refused packets.
// Then a dropped peer: player 2's page is closed (no goodbye): player 1's game gets rtw_net_peer(1, 0), the link is
// unplugged for the game (SIOCNT SD clear, the exchange hears only itself) and the game runs on.
// DROP_AT=<route frame>: close player 2's page in the middle of the battle instead (the game ends the battle with
// "The link was disconnected." and returns to the lobby; screenshots). LEAVE=1: player 2 leaves from the host's Online
// panel instead of closing the page. UNLOAD=1: the page close runs its unload handlers. SOLO=1: afterwards a fresh page plays alone
// (no session, frames run at ~60/s). Prints PASS/FAIL lines and "ALL PASS"; exit 0 only then. Captures go to OUTDIR.
import { mkdirSync, readFileSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [outArg] = process.argv.slice(2);
if (!outArg) { console.error('usage: rtw_net_e2e.mjs OUTDIR'); process.exit(2); }
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(outArg);
mkdirSync(OUT, { recursive: true });
const RTW = process.env.RETROWSER_DIR || join(homedir(), 'Code/retrowser');
const ROM = process.env.ROM || join(homedir(), 'roms/Golden_Sun_USA_Europe.gba');
const FLASH = join(ROOT, 'port_work/g7/flash_battle.sav');
if (!existsSync(FLASH)) { console.error(`no ${FLASH}: run tools/link2.sh once (it makes the battle test save)`); process.exit(2); }
const DROP_AT = Number(process.env.DROP_AT || 0), LEAVE = process.env.LEAVE === '1', SOLO = process.env.SOLO === '1';
const ROUTE_END = 5200;   // tests/web_link.cjs FRAMES: the battle is over and both are back in the Arena
const KEY = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };
const ROUTE_START = 1000;   // the routes' first key (START at the title)
function spans(shift) {
  const text = ['link_arena', 'link_lobby', 'link_fight'].map((n) => readFileSync(join(ROOT, 'tests/routes', n + '.keys'), 'utf8')
    .split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean).join(',')).join(',');
  return text.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [k, r0] = s.split('@'); const [r, per] = r0.split('/'); const [a, b] = r.split('-').map(Number);
    return { mask: k.split('+').reduce((m, n) => m | KEY[n], 0), a: a + shift, b: (b ?? a) + shift, per: +per || 0 };
  });
}

const REPO_DIR = join(OUT, 'repo');
for (const f of ['retrowser.json', 'retrowser/gs1/gs1.wasm', 'retrowser/gs1/gs1.js', 'retrowser/tla/retrowser.json', 'retrowser/tla/tla.wasm', 'retrowser/tla/tla.js']) {
  mkdirSync(dirname(join(REPO_DIR, f)), { recursive: true });
  copyFileSync(join(ROOT, f), join(REPO_DIR, f));
}
const t0 = Date.now(), say = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
let fails = 0;
const check = (ok, what) => { say(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) fails++; return ok; };

const { chromium } = await import(join(RTW, 'node_modules/playwright-core/index.mjs'));
const { startMockGithub } = await import(join(RTW, 'tools/mock-github.ts'));
const { serveWorker } = await import(join(RTW, 'tools/serve-worker.ts'));
const REPO = 'sorikairox/golden-sun', COMMIT = 'c0ffee00000000000000000000000000000000b2';
const mock = await startMockGithub({ [REPO]: { refs: { main: COMMIT }, commits: [{ sha: COMMIT, dir: REPO_DIR }] } });
const PORT = Number(process.env.RTW_SERVE || 8792);
const served = await serveWorker(PORT);
const site = `http://localhost:${PORT}`;
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: chrome, headless: true,
  args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
const players = [];
let finished = false;
const finish = async (code) => {
  if (finished) return; finished = true;
  for (const p of players) {
    try { writeFileSync(join(OUT, `host_log_p${p.n}.txt`), (await hostLog(p)) + '\n'); } catch { /* closed */ }
    if (p.errors.length) say(`P${p.n} page errors: ${p.errors.slice(0, 3).join(' | ')}`);
  }
  await browser.close().catch(() => {});
  await mock.close().catch(() => {});
  await new Promise((ok) => { served.closeAllConnections?.(); served.close(ok); });
  process.exit(code);
};
const timer = setTimeout(() => { say('TIMEOUT'); fails++; finish(3); }, Number(process.env.RTW_TIMEOUT || 480000));

async function newPlayer(n, save) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
  await ctx.addInitScript((ep) => {
    try {
      if (location.hostname !== 'localhost') return;
      localStorage.setItem('rtw:test-endpoints', ep);
      localStorage.setItem('rtw:test-net', '{"ice":[]}');
    } catch { /* ignore */ }
  }, JSON.stringify(mock.endpoints));
  const page = await ctx.newPage();
  const p = { n, ctx, page, errors: [] };
  page.on('pageerror', (e) => p.errors.push(e.message));
  players.push(p);
  if (save) {   // the player's own stored save, as the host keeps it (src/host/lib/db.ts: DB retrowser v2, store saves)
    await page.goto(site + '/');
    const r = await page.evaluate(async (bytes) => {
      const db = await new Promise((ok, no) => {
        const q = indexedDB.open('retrowser', 2);
        q.onupgradeneeded = () => {
          const d = q.result;
          if (!d.objectStoreNames.contains('roms')) d.createObjectStore('roms', { keyPath: 'sha1' }).createIndex('platform', 'platform');
          if (!d.objectStoreNames.contains('saves')) d.createObjectStore('saves', { keyPath: 'key' });
          if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings');
          if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id', autoIncrement: true }).createIndex('game', 'game');
        };
        q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error);
      });
      await new Promise((ok, no) => {
        const t = db.transaction('saves', 'readwrite');
        t.objectStore('saves').put({ key: 'golden-sun:flash', id: 'golden-sun', kind: 'flash', bytes: new Uint8Array(bytes), generation: 1, savedAt: Date.now() });
        t.oncomplete = ok; t.onerror = () => no(t.error);
      });
      db.close();
      return bytes.length;
    }, [...save]);
    if (r !== 65536) throw new Error(`P${n}: save not stored (${r})`);
  }
  return p;
}
const hostLog = (p) => p.page.getAttribute('[data-state=playing]', 'data-log', { timeout: 2000 }).then((v) => v || '').catch(() => '');
async function worker(p) {
  for (const w of p.page.workers()) {
    try { if (await w.evaluate(() => typeof globalThis.__rtwGs === 'object')) return w; } catch { /* gone */ }
  }
  return null;
}
async function inWorker(p, fn, arg) { const w = await worker(p); return w ? w.evaluate(fn, arg).catch(() => null) : null; }
const net = (p) => inWorker(p, () => globalThis.__rtwGs.net());
const frames = (p) => inWorker(p, () => globalThis.__rtwGs.frames());
// the game's own view of the cable: SIOCNT (SD = all consoles there), the exchange's current mask (gSerialWork + 3)
const cable = (p) => inWorker(p, () => { const H = globalThis.__rtwGs.Module.HEAPU8; return { siocnt: H[0x04000128] | H[0x04000129] << 8, mask: H[0x02002243] }; });
async function shot(p, name) { await p.page.screenshot({ path: join(OUT, `p${p.n}_${name}.png`) }).catch(() => {}); }
async function open(p) {
  await p.page.goto(`${site}/g/${REPO}`);
  await p.page.click('[data-action=download]', { timeout: 60000 });
  await p.page.locator('[data-field=rom]').setInputFiles(ROM, { timeout: 180000 });
  await p.page.waitForFunction(() => Number(document.querySelector('[data-state=playing]')?.getAttribute('data-frames') ?? 0) > 10, null, { timeout: 180000 });
  await p.page.click('[data-state=persist-warning] button', { timeout: 1000 }).catch(() => {});
}
async function until(what, fn, ms = 60000, every = 250) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout: ${what}`);
    await new Promise((r) => setTimeout(r, every));
  }
}
const fmt = (s) => s ? `me ${s.me} peer ${s.peerState} linked ${s.connected} hashes ok ${s.hashOk} bad ${s.hashBad} battle ${s.battle}.${s.turn} hp ${s.hpOwn}/${s.hpEnemy} ` +
  `sent ${s.sent0}/${s.sent1} recv ${s.recv0}/${s.recv1} bulks out ${s.bulkOut} in ${s.bulkIn} refused ${s.refused} bad ${s.bad} dropped ${s.dropped} rtt ${s.rtt}` : 'none';

try {
  const save = readFileSync(FLASH);
  const [A, B] = [await newPlayer(1, save), await newPlayer(2, save)];
  for (const p of [A, B]) { await open(p); say(`P${p.n} plays alone (frame ${await frames(p)})`); }
  const pre = await Promise.all([A, B].map(net));
  check(pre.every((s) => s && !s.on), 'before the session neither game is in one');
  await A.page.click('[data-action=online]');
  await A.page.click('[data-action=net-create]');
  await A.page.waitForSelector('[data-field=room-code]');
  const code = (await A.page.textContent('[data-field=room-code]')).trim();
  say(`room ${code}`);
  await B.page.click('[data-action=online]');
  await B.page.fill('[data-field=net-code]', code);
  await B.page.click('[data-action=net-join]');
  await until('the guest connected and matched', async () => (await A.page.$$('[data-field=net-players] li[data-match=ok][data-net-state="1"]')).length >= 1, 60000);
  await A.page.waitForSelector('[data-action=net-start]:not([disabled])');
  await A.page.waitForTimeout(1500);
  await A.page.click('[data-action=net-start]');
  const sts = await until('both games in the session and linked', async () => {
    const s = await Promise.all([A, B].map(net));
    return s.every((x) => x && x.on && x.peerState === 1) ? s : null;
  }, 60000);
  check(sts[0].me === 0 && sts[1].me === 1, `session indexes: room host ${sts[0].me} (link parent), guest ${sts[1].me}`);
  for (const p of [A, B]) await p.page.click('[data-action=close-online]').catch(() => {});
  // the routes, shifted to begin just after the session (both games are at their title by now)
  const starts = [];
  for (const p of [A, B]) {
    const f = await frames(p), shift = Math.max(0, f + 90 - ROUTE_START);
    p.shift = shift; starts.push(f);
    await inWorker(p, (sp) => { globalThis.__rtwGs.script(sp); }, spans(shift));
  }
  say(`linked; routes start at frames ${starts.join('/')} (shift ${A.shift}/${B.shift})`);
  const shots = [1600, 2550, 3300, 4150];
  const taken = new Set();
  let last = 0;
  const play = async (end) => {
    for (;;) {
      const fr = await Promise.all([A, B].map(frames));
      const rf = [fr[0] - A.shift, fr[1] - B.shift];
      for (const [i, p] of [[0, A], [1, B]]) for (const s of shots) if (rf[i] >= s && !taken.has(`${p.n}.${s}`)) { taken.add(`${p.n}.${s}`); await shot(p, `f${s}`); }
      if (Date.now() - last > 15000) {
        last = Date.now();
        const s = await Promise.all([A, B].map(net));
        say(`route frames ${rf.join('/')}\n    P1 ${fmt(s[0])}\n    P2 ${fmt(s[1])}`);
      }
      if (rf[0] >= end && rf[1] >= end) return;
      if ([A, B].some((p) => p.errors.length)) throw new Error('page errors');
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  if (DROP_AT) {
    await play(DROP_AT);
    const s0 = await net(A);
    say(`mid-battle at route frame ${DROP_AT}: P1 ${fmt(s0)}`);
    check(s0.battle >= 1, `P1 is in a link battle at the drop (battle ${s0.battle}, turn ${s0.turn})`);
  } else {
    await play(ROUTE_END);
    await new Promise((r) => setTimeout(r, 1000));
    const fin = await Promise.all([A, B].map(net));
    say(`end\n    P1 ${fmt(fin[0])}\n    P2 ${fmt(fin[1])}`);
    writeFileSync(join(OUT, 'net_status.json'), JSON.stringify(fin, null, 1));
    check(fin.every((s) => s.hashOk >= 3 && s.hashBad === 0), `per-turn hashes agree on both sides: P1 ${fin[0].hashOk} agree / ${fin[0].hashBad} differ, P2 ${fin[1].hashOk} / ${fin[1].hashBad}`);
    const [a, b] = fin;
    const result = a.hpOwn === 0 && b.hpEnemy === 0 ? 'P2 won (P1 down on both screens)' : a.hpEnemy === 0 && b.hpOwn === 0 ? 'P1 won (P2 down on both screens)' : `open (P1 ${a.hpOwn}/${a.hpEnemy}, P2 ${b.hpOwn}/${b.hpEnemy})`;
    check(/won/.test(result), `the link battle ended with the same result on both screens: ${result}`);
    check(a.battle >= 1 && a.battle === b.battle && a.turn === b.turn && a.turn >= 3, `link state agrees: battles ${a.battle}/${b.battle}, turns ${a.turn}/${b.turn}`);
    check(a.bulkOut === b.bulkIn && b.bulkOut === a.bulkIn && a.bulkOut > 0, `bulk transfers: P1 out ${a.bulkOut} = P2 in ${b.bulkIn}, P2 out ${b.bulkOut} = P1 in ${a.bulkIn}`);
    check(fin.every((s) => s.bad === 0 && s.refused === 0 && s.dropped === 0), 'no bad, refused or dropped packets');
    await shot(A, 'end'); await shot(B, 'end');
  }
  // a dropped peer: P2's page closes without a goodbye (or, LEAVE=1, P2 leaves the session)
  const fa0 = await frames(A), t1 = Date.now();
  if (LEAVE) {   // P2 leaves the session from the host's Online panel (the host says bye at once)
    await B.page.click('[data-action=online]');
    await B.page.click('[data-action=net-leave]');
    const sb = await until('P2 alone again', async () => { const s = await net(B); return s && s.peerState === 0 ? s : null; }, 10000, 100);
    check(sb.peerState === 0, 'P2 left: its own game sees the partner gone too, and runs on alone');
  } else await B.page.close({ runBeforeUnload: process.env.UNLOAD === '1' });
  const sg = await until('P1 sees the partner gone', async () => { const s = await net(A); return s && s.peerState === 0 ? s : null; }, 30000, 100);
  check(sg.peerState === 0 && !sg.connected, `P1: the partner is gone after ${((Date.now() - t1) / 1000).toFixed(1)} s, the link is unplugged (${fmt(sg)})`);
  await until('P1 runs on', async () => (await frames(A)) > fa0 + 400, 60000);
  const c = await until('the game sees the cable unplugged', async () => { const x = await cable(A); return x && !(x.siocnt & 8) && x.mask !== 3 ? x : null; }, 30000);
  check(!(c.siocnt & 8) && c.mask !== 3, `P1's game sees the cable unplugged: SIOCNT ${c.siocnt.toString(16)} (SD clear), exchange mask ${c.mask}; frames ${fa0} -> ${await frames(A)}`);
  const log = await hostLog(A);
  check(/partner left/.test(log), 'P1\'s host log: "' + ((log.split('\n').find((l) => /partner left/.test(l))) || 'no partner-left line') + '"');
  await A.page.waitForTimeout(3000);
  await shot(A, 'after_drop');
  if (LEAVE) {   // a second session in the same running games (both wait in the Battle Arena lobby): linked again
    await A.page.click('[data-action=online]').catch(() => {});
    await A.page.click('[data-action=net-leave]');   // the host keeps P1 in the ended session until it leaves too
    await A.page.click('[data-action=net-create]');
    await A.page.waitForSelector('[data-field=room-code]');
    const code2 = (await A.page.textContent('[data-field=room-code]')).trim();
    await B.page.fill('[data-field=net-code]', code2);
    await B.page.click('[data-action=net-join]');
    await until('the guest matched again', async () => (await A.page.$$('[data-field=net-players] li[data-match=ok][data-net-state="1"]')).length >= 1, 60000);
    await A.page.waitForSelector('[data-action=net-start]:not([disabled])');
    await A.page.click('[data-action=net-start]');
    const c2 = await until('both lobbies hear each other again', async () => {
      const x = await Promise.all([A, B].map(cable));
      return x.every((y) => y && (y.siocnt & 8) && y.mask === 3) ? x : null;
    }, 60000);
    const s2 = await Promise.all([A, B].map(net));
    check(s2.every((x) => x.sessions === 2 && x.peerState === 1) && c2.every((y) => y.mask === 3),
      `second session (room ${code2}) in the running games: both Battle Arena lobbies hear each other again (SIOCNT ${c2.map((y) => y.siocnt.toString(16)).join('/')}, masks ${c2.map((y) => y.mask).join('/')})`);
    await B.page.close();
  }
  if (SOLO) {
    const S = await newPlayer(9, null);
    await open(S);
    const f0 = await frames(S), ts = Date.now();
    await S.page.waitForTimeout(10000);
    const f1 = await frames(S), s = await net(S), fps = (f1 - f0) / ((Date.now() - ts) / 1000);
    check(s && !s.on && fps > 50, `single player: no session, ${fps.toFixed(1)} frames/s`);
  }
} catch (e) {
  say('ERROR ' + (e && e.stack || e)); fails++;
  for (const p of players) {
    const t = await p.page.evaluate(() => document.body.innerText).catch(() => '');
    writeFileSync(join(OUT, `page_text_p${p.n}.txt`), t);
  }
}
clearTimeout(timer);
say(fails ? `${fails} FAIL` : 'ALL PASS');
await finish(fails ? 1 : 0);
