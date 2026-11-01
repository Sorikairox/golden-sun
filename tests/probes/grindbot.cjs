// Test-only grind bot for tests/boot.cjs --probe (GS16): records its keys like autowalk.cjs, so a route keeps only
// inputs. From GR_AT it walks LEFT/RIGHT between cells GR_X1..GR_X2 of the field (the World Map), taps A every 40
// frames in battles (Fight, Attack), and after a battle casts Isaac's Cure (field menu, Psynergy, Isaac, Cure, target)
// on the weakest of the first GR_N members when below 55 % HP. Stops at Isaac level GR_LV, at GR_END, or off the
// World Map; prints "grind keys: ..." (Unit_Get is read only: level, hpMax, hp, pp at +15/+52/+56/+58).
'use strict';
const fs = require('fs'), path = require('path');
const AT = +process.env.GR_AT, X1 = +process.env.GR_X1, X2 = +process.env.GR_X2, LV = +(process.env.GR_LV || 6);
const N = +(process.env.GR_N || 2), ZAX = process.env.GR_AXIS === 'z', TH = +(process.env.GR_TH || 0.55), STOPDOWN = !!process.env.GR_STOPDOWN, SCENE = +(process.env.GR_SCENE || 2), FLEE = !!process.env.GR_FLEE; // GR_SCENE: grind in this field scene // GR_AXIS=z: walk UP/DOWN between rows GR_X1..GR_X2 (GS19)
const sym = {};
for (const l of fs.readFileSync(path.resolve(__dirname, '../../port/symbols/tbs-en.tsv'), 'utf8').split('\n')) { const c = l.split('\t'); if (c[1]) sym[c[0]] = parseInt(c[1], 16); }
const KEY = { A: 1, B: 2, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128 };
let flee = false, spans = [], state = 'walk', t0 = 0, target = X1, lastX = -1, lastMove = 0, done = false, plan = null, battles = 0;
const finish = (f, why) => { done = true; console.log(`grind ${why} f${f} battles ${battles}`); console.log(`grind keys: ${spans.map((s) => `${s.k}@${s.a}-${s.b}`).join(',')}`); };
module.exports = (m, frame, keys) => {
  if (done || frame < AT) return;
  if (frame === +process.env.GR_END) return finish(frame, 'end');
  const H = m.HEAPU8, u32 = (a) => (H[a] | H[a + 1] << 8 | H[a + 2] << 16 | H[a + 3] << 24) >>> 0, s16 = (a) => (H[a] | H[a + 1] << 8) << 16 >> 16;
  const press = (k) => { m._Port_SetKeys(keys | KEY[k]); const s = spans[spans.length - 1]; if (s && s.k === k && s.b === frame - 1) s.b = frame; else spans.push({ k, a: frame, b: frame }); };
  const unit = (i) => { const u = m._Port_CallCode4(sym.Unit_Get, i, 0, 0, 0, 0) >>> 0; return { lv: H[u + 15], hpMax: s16(u + 52), hp: s16(u + 56), pp: s16(u + 58) }; };
  const leader = u32(u32(0x03001ebc) + 20); const sc = H[0x02000400] | H[0x02000401] << 8;
  const field = sc !== 510 && leader >= 0x02000000 && leader < 0x03008000;
  if (!field) {
    if (state !== 'battle') {
      state = 'battle'; t0 = frame; battles++;
      // GR_FLEE (GS19): with Isaac short of two Cures or a member below half HP, take Run (RIGHT, A) instead of Fight
      const us = [...Array(N).keys()].map(unit); flee = FLEE && (us[0].pp < 6 || us.some((u) => u.hp < u.hpMax / 2));
    }
    const d = frame - t0;
    if (flee && d > 30 && d % 40 < 2) press('RIGHT');
    if (d > 30 && (d - (flee ? 10 : 0)) % 40 < 2) press('A');
    return;
  }
  if (sc !== SCENE) return finish(frame, `left the World Map (scene ${sc})`);
  if (state === 'battle') { state = 'after'; t0 = frame; }
  if (state === 'after') {
    const d = frame - t0;
    if (d >= 30 && d < 32) press('B');
    if (d === 60) {
      const us = [...Array(N).keys()].map(unit);
      console.log(`grind f${frame} ` + us.map((u, i) => `${i}:L${u.lv} ${u.hp}/${u.hpMax} pp${u.pp}`).join(' '));
      if (us[0].lv >= LV) return finish(frame, `level ${us[0].lv}`);
      if (us.every((u) => u.hp === 0 || u.hp === undefined)) return finish(frame, 'all down');
      if (STOPDOWN && us.some((u) => u.hp === 0)) return finish(frame, 'a member down'); // GS19: GR_STOPDOWN, GR_TH (Cure below this share of HP)
      let w = -1, r = TH; us.forEach((u, i) => { if (u.hp > 0 && u.hp / u.hpMax < r) { r = u.hp / u.hpMax; w = i; } });
      if (w >= 0 && us[0].pp >= 3 && us[0].hp > 0) { state = 'cure'; t0 = frame; plan = w; } else state = 'walk';
    }
    return;
  }
  if (state === 'cure') {
    const d = frame - t0, at = [0, 50, 100, 150];
    if (at.some((x) => d >= x && d < x + 2)) press('A');
    for (let i = 0; i < plan; i++) if (d >= 190 + 20 * i && d < 192 + 20 * i) press('RIGHT');
    if (d >= 260 && d < 262) press('A');
    if ([340, 380, 420, 460].some((x) => d >= x && d < x + 2)) press('B');
    if (d === 520) { state = 'after'; t0 = frame - 59; }
    return;
  }
  const x = (u32(leader + (ZAX ? 16 : 8)) | 0) >> 20;
  if (x !== lastX) { lastX = x; lastMove = frame; }
  if (x === target || frame - lastMove > 60) { target = target === X1 ? X2 : X1; lastMove = frame; }
  press(x < target ? (ZAX ? 'DOWN' : 'RIGHT') : (ZAX ? 'UP' : 'LEFT'));
};
