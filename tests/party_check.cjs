// GS37: The Lost Age's rtw module reads the Golden Sun save itself (port/rtw/rtw_tla_party.c, retrowser's saveFrom).
// Checks that it sends exactly the 4,100 bytes GS1's own save code gives (port/web/transfer.js gs1Read: a headless GS1
// web build running Save_InitializeWork / Save_LoadFileSummaries / Save_ReadPart), and picks the same file.
// Usage: node tests/party_check.cjs GS1_SAVE [--clear N]
//   --clear N: a test copy with file N (0-2) marked cleared (summary byte 0x31 = 1, the sector's checksum fixed), for
//   saves made before the end of the game. Nothing is written to disk.
'use strict';
const fs = require('fs');
const path = require('path');
const T = require('../port/web/transfer.js');

const ROOT = path.resolve(__dirname, '..');
const GS1_ROM = process.env.GS1_ROM || path.join(process.env.HOME, 'roms/Golden_Sun_USA_Europe.gba');
const TLA_ROM = process.env.TLA_ROM || path.join(process.env.HOME, 'roms/Golden_Sun_The_Lost_Age_USA_Europe.gba');

function markCleared(flash, file) {
  // the current sector of part `file`: highest counter among valid "CAMELOT" sectors (enough for a test copy)
  let best = -1, counter = 0;
  for (let i = 0; i < 16; i++) {
    const s = flash.subarray(i * 4096, (i + 1) * 4096);
    if (String.fromCharCode(...s.subarray(0, 7)) !== 'CAMELOT' || s[7] !== file) continue;
    const c = s[10] | s[11] << 8;
    if (c > counter) { counter = c; best = i; }
  }
  if (best < 0) throw new Error(`no part ${file} in the save`);
  const s = flash.subarray(best * 4096, (best + 1) * 4096);
  s[0x31] = 1;
  let sum = 0;
  for (let k = 0; k < 4072; k++) sum += s[16 + k];
  s[8] = sum & 0xff; s[9] = (sum >> 8) & 0xff;
}

async function tlaParty(flash) {
  const m = await require(path.join(ROOT, 'build/rtw/tla.js'))({
    wasmBinary: fs.readFileSync(path.join(ROOT, 'build/rtw/tla.wasm')), print: () => {}, printErr: () => {},
    rtw: new Proxy({}, { get: () => () => 0 }),
  });
  const rom = fs.readFileSync(TLA_ROM);
  m.HEAPU8.set(rom, m._rtw_rom_buffer(rom.length));
  const p = m._rtw_save_from(0, flash.length);
  if (!p) throw new Error('rtw_save_from refused the save');
  m.HEAPU8.set(flash, p);
  try { m._rtw_start(); } catch (e) { if (e !== 'unwind' && !/unwind/.test(String(e))) throw e; }
  const ptr = m._port_rtw_party();
  return { file: m._port_rtw_party_info(0), level: m._port_rtw_party_info(1), bytes: ptr ? m.HEAPU8.slice(ptr, ptr + 4100) : null };
}

(async () => {
  const args = process.argv.slice(2);
  const flash = new Uint8Array(fs.readFileSync(args[0]));
  const ci = args.indexOf('--clear');
  if (ci >= 0) markCleared(flash, +args[ci + 1]);
  const gs1 = await T.gs1Read(require(path.join(ROOT, 'build/wasm/game.js')), fs.readFileSync(GS1_ROM), flash.slice(),
    { locateFile: (p) => path.join(ROOT, 'build/wasm', p) });
  const tla = await tlaParty(flash.slice());
  const want = gs1 && gs1.bytes, got = tla.bytes;
  console.log(`GS1's code: file ${gs1 ? gs1.chosen : '-'} (${gs1 ? gs1.files.map((f) => `${f.file}:Lv${f.level}${f.cleared ? ' cleared' : ''}`).join(', ') : 'no work'})`);
  console.log(`TLA rtw:    file ${tla.file} Lv ${tla.level}, ${got ? got.length + ' bytes' : 'nothing to send'}`);
  let ok;
  if (!want || !got) ok = !want && !got;
  else {
    let diff = 0, first = -1;
    for (let i = 0; i < 4100; i++) if (want[i] !== got[i]) { diff++; if (first < 0) first = i; }
    ok = diff === 0 && tla.file === gs1.chosen;
    console.log(`bytes differing: ${diff}${first >= 0 ? ` (first at ${first})` : ''}`);
  }
  console.log(ok ? 'PARTY_CHECK: PASS' : 'PARTY_CHECK: FAIL');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
