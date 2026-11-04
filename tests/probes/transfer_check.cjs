// TEST-ONLY probe for tests/boot.cjs --game tla --probe (TLA8; never in the shipped page): checks The Lost Age's
// party after a Golden Sun password was entered against the vendor's rules, field by field.
//   GS1 side (what the password holds): FileScreen_PackPasswordData (games/tbs/src/scene/file_screen.c): the four
//   members' levels (1-99), base HP/PP (0-1999, 11 bits), Attack/Defense/Agility (<= 999, 10 bits), Luck (<= 99,
//   7 bits), the Djinn held by any of them (one bit per Djinn), six story flags, for Silver/Bronze the 8 Psynergy
//   items held by anyone, for Gold the 15 inventory slots (item ids, 9 bits), 5-bit quantities of 23 stackable
//   items and the coins (24 bits).
//   TLA side (what is done with it): Func_020018e0 (recon/tla/en/overlays/resource_64a_c_020018e0.c, the native's
//   asm in our build): base stats only for Gold/Silver (Attack/Defense/Agility read back as 9 bits), the six flags
//   set or cleared from its own table, each level with experience = Unit_GetExperienceForLevel(i, level), every
//   Djinn cleared and the password's added by Djinn_AddToLeastLoadedOwner, Silver/Bronze's Psynergy items added
//   with PartyInventory_Add, Gold's slots and counts written and the coins set, then Unit_UpdateClass and
//   Unit_Calculate for each. The accepted password first starts a new game (Func_080addf0 through Func_02002350:
//   defaults, Felix and Jenna, 200 coins). The clear flow (Func_02000328, listing resource_64a_overlay.s) saves
//   0x02000000..0x02003000 to gMapCellBuffer before the entry, copies the state the password made to the buffer at
//   0x02013000 after it, restores the saved state, then runs Func_080ae410 (recon/tla/en/main/080ae410.c) on the buffer
//   with keepSettings 1: units 0-3 copied in (keeping their names), story items (item flag 0x20) removed, the units
//   recomputed; flags 0x800 + e*7 + n mirror the buffer's Djinn flags, 0x820 + i its six flags of Data_080b1284
//   (0x822 then toggled); its coins go to gMainRoutineWork+0x28c; flags 45 and 47 set. So the six story flags, the
//   Djinn flags 48+ and the coins the password set are checked in the buffer, the rest in the live state.
// Env: TC_GS1 = a dump of GS1's EWRAM from 0x02000000 taken with the cleared file loaded on the Send screen
// (gSaveBuffer is the game state's own layout: flags at 0x40, gMainRoutineWork at 0x240, units at 0x500);
// TC_MODE gold|silver|bronze; TC_AT = a frame after "Password accepted." (and its A) Prints one line per check (PASS/FAIL, no game values unless TC_VERBOSE) and a summary.
'use strict';
const fs = require('fs');
const path = require('path');
const MODE = { gold: 0, silver: 1, bronze: 2 }[process.env.TC_MODE || 'gold'];
const AT = +(process.env.TC_AT || 0), VERBOSE = !!process.env.TC_VERBOSE;
const sym = {};
for (const l of fs.readFileSync(path.resolve(__dirname, '../../port/tla/symbols/tla-en.tsv'), 'utf8').split('\n')) {
  const c = l.split('\t'); if (c[1]) sym[c[0]] = parseInt(c[1], 16);
}
const UNIT = 0x14c, GS1_UNITS = 0x500, TLA_UNITS = 0x520, GS1_FLAGS = 0x40, TLA_FLAGS = 0x40;
const GS1_COINS = 0x240 + 0x10, TLA_COINS = 0x240 + 0x10;
const GS1_PW_FLAGS = [0x941, 0x951, 0x8b3, 0x8d1, 0x81e, 0x868]; // gFileScreen_PasswordFlags
const u16 = (b, o) => b[o] | b[o + 1] << 8;
const s16 = (b, o) => (u16(b, o) << 16) >> 16;
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
const flag = (b, base, f) => (b[base + (f >> 3)] >> (f & 7)) & 1;
function unit(b, base, i) {
  const o = base + i * UNIT;
  return { level: b[o + 0x0f], hp: s16(b, o + 0x10), pp: s16(b, o + 0x12), atk: u16(b, o + 0x18), def: u16(b, o + 0x1a),
    agi: u16(b, o + 0x1c), luck: b[o + 0x1e], inv: Array.from({ length: 15 }, (_, n) => u16(b, o + 0xd8 + 2 * n)),
    djinn: [0, 1, 2, 3].map((e) => u32(b, o + 0xf8 + 4 * e)), owned: [0, 1, 2, 3].map((e) => b[o + 0x118 + e]),
    exp: u32(b, o + 0x124), cls: b[o + 0x128], maxHp: s16(b, o + 0x34) };
}
module.exports = (m, frame) => {
  if (frame !== AT) return;
  const H = m.HEAPU8, T = Buffer.from(H.subarray(0x02000000, 0x02040000)), G = fs.readFileSync(process.env.TC_GS1);
  const B = Buffer.from(H.subarray(0x02013000, 0x02016000)); // the buffer Func_080ae410 took (TLA's layout)
  const res = [];
  const check = (name, ok, detail) => { res.push(ok); console.log(`check ${ok ? 'PASS' : 'FAIL'} ${name}${VERBOSE || !ok ? ' ' + detail : ''}`); };
  // the unpacker's own tables (overlay 64A in RAM): members, Psynergy items, stack items, flags
  // (scene overlays are linked and loaded at 0x02008000: the listing's Data_020026a0 is 0x0200a6a0)
  const members = [0, 1, 2, 3].map((i) => u32(T, 0xa6a0 + 4 * i));
  const keyItems = Array.from({ length: 8 }, (_, k) => u16(T, 0xa6b0 + 2 * k));
  const stackItems = Array.from({ length: 23 }, (_, k) => u16(T, 0xa6c0 + 2 * k));
  const tlaFlags = Array.from({ length: 6 }, (_, k) => u16(T, 0xa490 + 2 * k));
  const story = (id) => id !== 0 && (H[(m._Port_CallCode4(sym.Item_GetDirect, id, 0, 0, 0) >>> 0) + 3] & 0x20) !== 0;
  check('members are Isaac, Garet, Ivan, Mia (0-3)', members.join() === '0,1,2,3', members.join());
  // the same item ids in GS1's tables (gFileScreen_PasswordKeyItems / StackItems): GS1's overlay holds them in the dump
  const find = (arr) => { const pat = Buffer.alloc(arr.length * 2); arr.forEach((v, k) => pat.writeUInt16LE(v, 2 * k)); return G.indexOf(pat); };
  check('GS1 holds the same 23 stack item ids', find(stackItems) >= 0, stackItems.join());
  check('GS1 holds the same 8 Psynergy item ids', find(keyItems) >= 0, keyItems.join());
  const gs = [0, 1, 2, 3].map((i) => unit(G, GS1_UNITS, i)), tl = [0, 1, 2, 3].map((i) => unit(T, TLA_UNITS, i));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  for (let i = 0; i < 4; i++) {
    const g = gs[i], t = tl[i];
    const lv = g.level > 99 ? 99 : g.level || 1;
    check(`unit ${i} level`, t.level === (lv & 0x7f), `${t.level} vs ${lv}`);
    const xp = m._Port_CallCode4(sym.Unit_GetExperienceForLevel, i, t.level, 0, 0) >>> 0;
    check(`unit ${i} experience = Unit_GetExperienceForLevel`, t.exp === xp, `${t.exp} vs ${xp}`);
    if (MODE !== 2) {
      const want = { hp: clamp(g.hp, 0, 1999), pp: clamp(g.pp, 0, 1999), atk: Math.min(g.atk, 999) & 0x1ff,
        def: Math.min(g.def, 999) & 0x1ff, agi: Math.min(g.agi, 999) & 0x1ff, luck: Math.min(g.luck, 99) & 0x7f };
      for (const k of Object.keys(want)) check(`unit ${i} base ${k}`, t[k] === want[k], `${t[k]} vs ${want[k]}`);
    } else {
      // Bronze carries no stats: they are the new game's (Func_080addf0), not GS1's
      const same = ['hp', 'pp', 'atk', 'def', 'agi'].filter((k) => t[k] === g[k]).length;
      console.log(`info unit ${i} Bronze: ${same}/5 base stats happen to equal GS1's (not carried)`);
    }
    if (MODE === 0) {
      const want = g.inv.map((it) => {
        const id = it & 0x1ff, m2 = stackItems.indexOf(id);
        if (m2 < 0) return id;
        let q = 0; for (const s of g.inv) if ((s & 0x1ff) === stackItems[m2]) q = (s & 0xf800) >> 11; // the last slot's
        return (q & 0x1f) << 11 | id;
      }).filter((it) => !story(it & 0x1ff)); // Func_080ae410: story items removed, the slots compacted
      while (want.length < 15) want.push(0);
      check(`unit ${i} inventory (15 slots, ids + stack counts)`, t.inv.join() === want.join(), `${t.inv.join()} vs ${want.join()}`);
    }
  }
  // Djinn: GS1's held Djinn of the four (OR of their bits), TLA's held by anyone (units 0-7) and the Djinn flags
  const gBits = gs.map((g) => g.djinn).reduce((a, d) => a.map((x, e) => x | d[e]), [0, 0, 0, 0]);
  const all = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => unit(T, TLA_UNITS, i));
  const tBits = all.map((t) => t.djinn).reduce((a, d) => a.map((x, e) => x | d[e]), [0, 0, 0, 0]);
  const flagBits = [0, 1, 2, 3].map((e) => { let v = 0; for (let n = 0; n < 7; n++) v |= flag(B, TLA_FLAGS, e * 20 + n + 48) << n; return v; });
  const g7 = gBits.map((x) => x & 0x7f);
  check('Djinn held (GS1 four, 7 per element) = Djinn held in TLA', tBits.map((x) => x & 0x7f).join() === g7.join(), `${tBits.join()} vs ${g7.join()}`);
  check('buffer: Djinn flags 48 + e*20 + n = the held Djinn', flagBits.join() === g7.join(), `${flagBits.join()} vs ${g7.join()}`);
  const per = all.map((t, i) => `${i}:${t.owned.reduce((a, b) => a + b, 0)}`).filter((s) => !s.endsWith(':0')).join(' ');
  console.log(`info Djinn per owner (Djinn_AddToLeastLoadedOwner over the active party): ${per || 'none'}`);
  for (let k = 0; k < 6; k++) check(`buffer: story flag ${k} (GS1 0x${GS1_PW_FLAGS[k].toString(16)} -> TLA 0x${tlaFlags[k].toString(16)})`,
    flag(B, TLA_FLAGS, tlaFlags[k]) === flag(G, GS1_FLAGS, GS1_PW_FLAGS[k]), `${flag(B, TLA_FLAGS, tlaFlags[k])} vs ${flag(G, GS1_FLAGS, GS1_PW_FLAGS[k])}`);
  if (MODE !== 0) {
    const held = (us, id) => us.some((u) => u.inv.some((s) => (s & 0x1ff) === id));
    for (let k = 0; k < 8; k++) {
      const want = held(gs, keyItems[k]);
      const got = held(all, keyItems[k]);
      check(`Psynergy item ${k} (id ${keyItems[k]}) held = held in GS1`, got === want, `${got} vs ${want}`);
    }
  }
  const wantCoins = MODE === 0 ? u32(G, GS1_COINS) & 0xffffff : 200; // Silver/Bronze: the new game's 200
  check('buffer: coins', u32(B, TLA_COINS) === wantCoins, `${u32(B, TLA_COINS)} vs ${wantCoins}`);
  check('live coins kept (the state saved before the entry)', u32(T, TLA_COINS) === 200, `${u32(T, TLA_COINS)}`);
  check('coins copy at gMainRoutineWork+0x28c (Func_080ae410)', u32(T, 0x240 + 0x28c) === wantCoins, `${u32(T, 0x240 + 0x28c)} vs ${wantCoins}`);
  // Func_080ae410's flags
  const mirror = [0, 1, 2, 3].map((e) => { let v = 0; for (let n = 0; n < 7; n++) v |= flag(T, TLA_FLAGS, 0x800 + e * 7 + n) << n; return v; });
  check('flags 0x800 + e*7 + n = the held Djinn', mirror.join() === g7.join(), `${mirror.join()} vs ${g7.join()}`);
  const d1284 = Array.from({ length: 6 }, (_, k) => H[0x080b1284 + 2 * k] | H[0x080b1285 + 2 * k] << 8);
  check('Data_080b1284 = the unpacker\'s six flags', d1284.join() === tlaFlags.join(), `${d1284.map((x) => x.toString(16)).join()} vs ${tlaFlags.map((x) => x.toString(16)).join()}`);
  for (let k = 0; k < 6; k++) {
    const want = flag(B, TLA_FLAGS, d1284[k]) ^ (k === 2 ? 1 : 0);
    check(`flag 0x${(0x820 + k).toString(16)} = buffer flag 0x${d1284[k].toString(16)}${k === 2 ? ' inverted (0x822 toggled)' : ''}`, flag(T, TLA_FLAGS, 0x820 + k) === want, `${flag(T, TLA_FLAGS, 0x820 + k)} vs ${want}`);
  }
  check('flags 45 and 47 set', flag(T, TLA_FLAGS, 45) === 1 && flag(T, TLA_FLAGS, 47) === 1, `${flag(T, TLA_FLAGS, 45)}${flag(T, TLA_FLAGS, 47)}`);
  for (let i = 0; i < 4; i++) check(`unit ${i} recomputed (Unit_Calculate: max HP > 0)`, tl[i].maxHp > 0, `${tl[i].maxHp}`);
  const crypto = require('crypto');
  const units = crypto.createHash('sha1').update(T.subarray(TLA_UNITS, TLA_UNITS + 8 * UNIT)).digest('hex').slice(0, 12);
  const flags = crypto.createHash('sha1').update(T.subarray(TLA_FLAGS, TLA_FLAGS + 0x200)).digest('hex').slice(0, 12);
  console.log(`transfer_check f${frame} mode ${process.env.TC_MODE}: ${res.filter(Boolean).length}/${res.length} PASS; units sha1 ${units} flags sha1 ${flags}`);
};
