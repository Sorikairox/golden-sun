// TEST-ONLY warp for tests/boot.cjs --probe (never in the shipped page): at frame WARP_AT (env) it calls the game's
// own scene-change routine Event_SetDestination(WARP_SCENE, WARP_ENTRANCE) (field/event_commands/event.c: raises
// the exit request EXIT_KEEP_DESTINATION and writes gMainRoutineWork.next/entrance, as the Title, the File Screen
// and the World Map events do) through the test hook Port_CallCode4. Scene ids are field/scenes.s row numbers
// (2 WorldMap, 3 ValePrologue, ...). Use it only while the field runs (free walking).
'use strict';
const fs = require('fs');
const path = require('path');
const AT = +(process.env.WARP_AT || 0), SCENE = +(process.env.WARP_SCENE ?? 2), ENT = +(process.env.WARP_ENTRANCE ?? 0);
let addr = 0;
for (const l of fs.readFileSync(path.resolve(__dirname, '../../port/symbols/tbs-en.tsv'), 'utf8').split('\n')) {
  const c = l.split('\t'); if (c[0] === 'Event_SetDestination') addr = parseInt(c[1], 16);
}
module.exports = (m, frame) => {
  if (frame !== AT) return;
  m._Port_CallCode4(addr, SCENE, ENT, 0, 0);
  console.log(`warp f${frame}: Event_SetDestination(${SCENE}, ${ENT})`);
};
