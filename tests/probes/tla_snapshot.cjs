// TLA9a test-only probe (tests/boot.cjs --probe) for TLA's build-independent saves (port/pc/save_compat.c): gives the
// saved object snapshot (gSnapshotObjects, 0x02001024: 32 struct Actor of 0x80 bytes; slot ids at 0x02001004) the
// build-dependent words a real scene can give it, so two builds with different data layouts can be compared.
//   PLANT_AT=F[-G]  at frame F (and again each frame up to G, as the script engine moves the word on): the live object
//                   with the highest id (PLANT_ID overrides) gets script = PLANT_SCRIPT (hex: this build's relocated buffer of an actor script, e.g.
//                   gActor_StepAngleScript, from tools/reloc_map.cjs), as when it runs that relocated script; the
//                   stale entry 31 (past the list: saved, never read) gets update = PLANT_UPDATE (hex: a table index)
//   CHECK_AT=F,...  prints the listed entries' script/update words and, for each, the live object's script word
//   tla_snap f<F> entry <i> id <slot> snap <script> <update> live <address> <script>
// Only addresses and pointer words are printed: nothing of the game is written anywhere.
'use strict';
const SLOTS = 0x02001004, SNAP = 0x02001024, BYTES = 0x80;
const [PLANT_AT, PLANT_TO] = (process.env.PLANT_AT || '-1').split('-').map(Number).concat([NaN]);
let planted = 0;
const CHECK_AT = new Set((process.env.CHECK_AT || '').split(',').filter(Boolean).map(Number));
const hex = (v) => (v >>> 0).toString(16);

function listed(u8) {
  const out = [];
  for (let i = 0; i < 32 && u8[SLOTS + i] !== 0xff; i++) out.push(i);
  return out;
}

// the live object with id `id`: Ram_HeapSlots->eventWork (0x0300006c) ->objects[id] (+0x14), as ObjectTable_Get
function objectOf(u32, id) {
  const ev = u32[0x0300006c >> 2];
  return ev >= 0x02000000 && ev < 0x02040000 ? u32[(ev + 0x14 + id * 4) >> 2] : 0;
}

module.exports = (m, frame) => {
  const u8 = m.HEAPU8, u32 = m.HEAPU32;
  if (frame === PLANT_AT) {
    // the last object in the table (PLANT_ID overrides)
    let id = process.env.PLANT_ID ? +process.env.PLANT_ID : -1;
    for (let k = 79; id < 0 && k >= 0; k--) if (objectOf(u32, k)) id = k;
    const a = id >= 0 ? objectOf(u32, id) : 0;
    console.log(`tla_snap plant f${frame} id ${id} live ${hex(a)} script ${hex(a ? u32[a >> 2] : 0)}`);
    planted = a;
    if (a && process.env.PLANT_SCRIPT) u32[a >> 2] = parseInt(process.env.PLANT_SCRIPT, 16);
    if (process.env.PLANT_UPDATE) u32[(SNAP + 31 * BYTES + 0x6c) >> 2] = parseInt(process.env.PLANT_UPDATE, 16);
  }
  if (planted && frame > PLANT_AT && frame <= PLANT_TO && process.env.PLANT_SCRIPT)
    u32[planted >> 2] = parseInt(process.env.PLANT_SCRIPT, 16);
  if (CHECK_AT.has(frame)) {
    for (const i of listed(u8)) {
      const e = (SNAP + i * BYTES) >> 2, a = objectOf(u32, u8[SLOTS + i]);
      console.log(`tla_snap f${frame} entry ${i} id ${u8[SLOTS + i]} snap ${hex(u32[e])} ${hex(u32[e + 0x1b])} live ${hex(a)} ${hex(a ? u32[a >> 2] : 0)}`);
    }
    const s = (SNAP + 31 * BYTES) >> 2;
    console.log(`tla_snap f${frame} entry 31 snap ${hex(u32[s])} ${hex(u32[s + 0x1b])}`);
  }
};
