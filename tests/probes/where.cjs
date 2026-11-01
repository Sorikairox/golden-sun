// Test-only probe for tests/boot.cjs --probe: where the party is, from RAM, to speed up route-finding.
// Prints a line whenever the scene (gMainRoutineWork.next), its entrance or the leader's 16-pixel cell changes,
// and every WHERE_EVERY frames (env, default 0 = only on change):
//   where f5040 scene 3 ValePrologue ent 2 map 12 leader x 712.0 z 488.5 cell 44,30 keys DOWN
// Scene names are read from the vendor's field/scenes.s (row order) when it is present (names, not game data).
// gFieldWork->actors[0] is the party leader (Actor_Lookup(ACTOR_PARTY_LEADER)); Actor x/y/z are 16.16 pixels.
'use strict';
const fs = require('fs');
const path = require('path');

const MRW = 0x02000240, NEXT = 0x1c0, ENTRANCE = 0x1c2, MAP_ID = 0x1da; // gMainRoutineWork offsets (area 0x1cc)
const FIELD_WORK = 0x03001ebc, ACTORS = 20, AX = 8, AY = 12, AZ = 16;  // gFieldWork, FieldWork.actors, Actor.x/y/z
const KEY = ['A', 'B', 'SELECT', 'START', 'RIGHT', 'LEFT', 'UP', 'DOWN', 'R', 'L'];
const every = +(process.env.WHERE_EVERY || 0);
let names = [];
try {
  const s = fs.readFileSync(path.resolve(__dirname, '../../vendor/alchemy/games/tbs/src/field/scenes.s'), 'utf8');
  names = [...s.matchAll(/^\tscene ([A-Za-z0-9_]*),/gm)].map((x) => x[1] || '-');
} catch (e) { /* no vendor checkout: numbers only */ }
let last = '';
module.exports = (m, frame, keys) => {
  const H = m.HEAPU8;
  const s16 = (a) => (H[a] | H[a + 1] << 8) << 16 >> 16;
  const u32 = (a) => (H[a] | H[a + 1] << 8 | H[a + 2] << 16 | H[a + 3] << 24) >>> 0;
  const s32 = (a) => u32(a) | 0;
  const scene = s16(MRW + NEXT), ent = s16(MRW + ENTRANCE), map = s16(MRW + MAP_ID);
  const fw = u32(FIELD_WORK);
  let pos = 'no field', cell = '';
  const inRam = (a) => a >= 0x02000000 && a < 0x03008000;
  if (inRam(fw)) {
    const leader = u32(fw + ACTORS);
    if (inRam(leader)) {
      const x = s32(leader + AX) / 65536, y = s32(leader + AY) / 65536, z = s32(leader + AZ) / 65536;
      cell = `${x >> 4},${z >> 4}`;
      pos = `leader x ${x.toFixed(1)} y ${y.toFixed(1)} z ${z.toFixed(1)} cell ${cell}`;
    } else pos = 'no leader';
  }
  const state = `${scene} ${ent} ${cell}`;
  if (state !== last || (every && frame % every === 0)) {
    last = state;
    const k = KEY.filter((_, i) => keys & (1 << i)).join('+') || '-';
    console.log(`where f${frame} scene ${scene} ${names[scene] || ''} ent ${ent} map ${map} ${pos} keys ${k}`);
  }
};
