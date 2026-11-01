// TEST-ONLY probe for tests/boot.cjs --probe (never in the shipped page): at frame PARTY_AT (env, default 5300) it
// builds a three-member party with Psynergy and set Djinn by calling the game's own routines, as the debug menu
// test scene does (vendor debug/test.c MenuTest_Initialize / MenuTest_GivePartyDjinn): Party_AddMember(GARET, IVAN),
// Unit_LevelUpTo(each, PARTY_LEVEL, default 10), Unit_LearnPsynergy (Isaac Quake, Cure, Move, Catch;
// Garet Flare; Ivan Whirlwind: the prologue's childhood classes teach none), Djinn_Give + Djinn_Set (Flint to Isaac, Forge to Garet, Gust to
// Ivan; PARTY_DJINN=0 skips), Unit_Calculate(each). Addresses from port/symbols/tbs-en.tsv; the calls go through
// the test hook Port_CallCode4 (port/pc/call_via.c), which runs our compiled C for that ROM address.
// PARTY_HP=N instead only lowers Isaac's current HP to N, in his Unit and the battle's copies (a lost battle).
'use strict';
const fs = require('fs');
const path = require('path');
const AT = +(process.env.PARTY_AT || 5300), LEVEL = +(process.env.PARTY_LEVEL || 10);
const sym = {};
for (const l of fs.readFileSync(path.resolve(__dirname, '../../port/symbols/tbs-en.tsv'), 'utf8').split('\n')) {
  const c = l.split('\t'); if (c[1]) sym[c[0]] = parseInt(c[1], 16);
}
const ISAAC = 0, GARET = 1, IVAN = 2, VENUS = 0, MARS = 2, JUPITER = 3;
module.exports = (m, frame) => {
  if (frame !== AT) return;
  const call = (name, a = 0, b = 0, c = 0, d = 0) => {
    if (!sym[name]) throw new Error(`party probe: no symbol ${name}`);
    return m._Port_CallCode4(sym[name], a, b, c, d) | 0;
  };
  if (process.env.PARTY_HP) { // PARTY_HP=N: set Isaac's current HP to N in his Unit and in every battle copy of it
    const u = call('Unit_Get', ISAAC) >>> 0, H = m.HEAPU8, s16 = (a) => H[a] | H[a + 1] << 8;
    let o = 16; // hpMax, ppMax, hp, pp lie together (struct Unit, battle/battle_unit.h)
    while (o < 0x60 && !(s16(u + o) > 0 && s16(u + o) === s16(u + o + 4) && s16(u + o + 2) === s16(u + o + 6))) o += 2;
    if (o >= 0x60) throw new Error('party probe: hp not found');
    const hit = [];
    for (const a of [...Array(0x10000).keys()].map((i) => 0x02000000 + 4 * i).concat([...Array(0x2000).keys()].map((i) => 0x03000000 + 4 * i))) { // the battle's unit copies hold the same name and stats
      let same = true;
      for (let k = 0; k < 16 && same; k++) same = H[a + k] === H[u + k]; // name + level
      same = same && s16(a + o) === s16(u + o) && s16(a + o + 2) === s16(u + o + 2); // hpMax, ppMax
      if (same) { H[a + o + 4] = +process.env.PARTY_HP; H[a + o + 5] = 0; hit.push('0x' + a.toString(16)); }
    }
    console.log(`party f${frame}: Isaac hp -> ${process.env.PARTY_HP} in ${hit.join(' ')} (+${o + 4})`);
    return;
  }
  const r = [call('Party_AddMember', GARET), call('Party_AddMember', IVAN)];
  for (const u of [ISAAC, GARET, IVAN]) call('Unit_LevelUpTo', u, LEVEL);
  for (const [u, a] of [[ISAAC, 3], [ISAAC, 90], [ISAAC, 140], [ISAAC, 148], [GARET, 45], [IVAN, 78]]) r.push(call('Unit_LearnPsynergy', u, a));
  if (process.env.PARTY_DJINN !== '0') {
    for (const [u, e] of [[ISAAC, VENUS], [GARET, MARS], [IVAN, JUPITER]]) { r.push(call('Djinn_Give', u, e, 0)); r.push(call('Djinn_Set', u, e, 0)); }
  }
  if (process.env.PARTY_STANDBY) r.push(call('Djinn_PutOnStandby', GARET, MARS, 0)); // PARTY_STANDBY=1: Forge on standby (a Mars summon)
  for (const u of [ISAAC, GARET, IVAN]) call('Unit_Calculate', u);
  console.log(`party f${frame}: added Garet, Ivan; level ${LEVEL}; Djinn ${process.env.PARTY_DJINN === '0' ? 'none' : 'Flint/Forge/Gust set'} (returns ${r.join(',')})`);
};
