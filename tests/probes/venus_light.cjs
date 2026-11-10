// TEST-ONLY probe for tests/boot.cjs --probe (never in the shipped page), with warp.cjs into Venus Lighthouse's third
// floor (WARP_SCENE 185): at frame VL_AT spawns an actor on a cell with no pillar and runs the light routine
// VenusLighthouse_RouteLight on it (overlay 3c8, through Port_CallRam6, which resolves the loaded overlay), as a light
// reaching an empty socket does. On the GBA the empty socket's reads go to the BIOS and the light goes out (vendor
// comment); the wasm build read through a null pointer and stopped (GS36). Prints whether it returned.
'use strict';
const fs = require('fs');
const path = require('path');
const AT = +(process.env.VL_AT || 0);
const sym = {}, ov = {};
for (const l of fs.readFileSync(path.resolve(__dirname, '../../port/symbols/tbs-en.tsv'), 'utf8').split('\n')) {
  const c = l.split('\t'); if (c[1]) sym[c[0]] = parseInt(c[1], 16);
}
for (const l of fs.readFileSync(path.resolve(__dirname, '../../port/symbols/tbs-en-overlays.tsv'), 'utf8').split('\n')) {
  const c = l.split('\t'); if (c[0] === '3c8' && c[2]) ov[c[1]] = parseInt(c[2], 16);
}
module.exports = (m, frame) => {
  if (frame !== AT) return;
  const actor = m._Port_CallCode4(sym.Actor_Spawn, 1, 8 << 20, 0, 8 << 20) >>> 0;
  const before = Buffer.from(m.HEAPU8.subarray(actor, actor + 128));
  console.log(`venus_light f${frame}: actor 0x${actor.toString(16)}; RouteLight 0x${ov.VenusLighthouse_RouteLight.toString(16)}`);
  try {
    m._Port_CallRam6(ov.VenusLighthouse_RouteLight | 1, actor, 0, 0, 0, 0, 0);
    const after = m.HEAPU8.subarray(actor, actor + 128);
    let changed = 0; for (let i = 0; i < 128; i++) if (before[i] !== after[i]) changed++;
    console.log(`venus_light f${frame}: RouteLight returned; ${changed} actor bytes changed (its script started)`);
  } catch (e) {
    console.log(`venus_light f${frame}: RouteLight STOPPED: ${e.message}`);
  }
};
