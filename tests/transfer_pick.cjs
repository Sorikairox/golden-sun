// TLA9: which Golden Sun file port/web/transfer.js's gs1Export takes, against a stand-in of GS1's save routines (no game
// data): only cleared files with a leader count; several -> the longest play time (the earlier file on a tie); none
// -> nothing; a failed Save_InitializeWork or Save_ReadPart -> nothing. The real routines are tested by
// tests/web_transfer.cjs (the cleared file 2 of the test save). Usage: node tests/transfer_pick.cjs
'use strict';
const T = require('../port/web/transfer.js');
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
function fake(files, { initError = 0, readError = -1 } = {}) {
  const H = new Uint8Array(0x03002000), dv = new DataView(H.buffer), WORK = 0x02030000;
  const calls = [];
  return { HEAPU8: H, calls, _Port_CallCode4(a, x, y) {
    calls.push(a);
    if (a === T.GS1.Save_InitializeWork) { dv.setUint32(T.GS1.gSaveWork, WORK, true); return initError; }
    if (a === T.GS1.Save_LoadFileSummaries) {
      files.forEach((f, i) => { const s = WORK + 0x1040 + i * 64; H[s + 0x1c] = f.level; dv.setUint32(s + 0x20, f.play, true); H[s + 0x31] = f.clear ? 1 : 0; });
      return files.filter((f) => f.level).length;
    }
    if (a === T.GS1.Save_ReadPart) { H.fill(0x10 + x, y, y + 4096); return x % 3 === readError ? 1 : 0; }
    return 0;
  } };
}
const F = (level, play, clear) => ({ level, play, clear });
const cases = [
  ['none cleared', [F(15, 100, 0), F(10, 50, 0), F(0, 0, 0)], {}, -1],
  ['one cleared (file 2)', [F(15, 100, 0), F(15, 101, 1), F(0, 0, 0)], {}, 1],
  ['two cleared: the longer play time (file 3)', [F(15, 100, 1), F(9, 50, 0), F(30, 900, 1)], {}, 2],
  ['two cleared: the longer play time (file 1)', [F(30, 900, 1), F(9, 50, 0), F(15, 100, 1)], {}, 0],
  ['two cleared, equal play time: the earlier file', [F(9, 50, 0), F(20, 500, 1), F(21, 500, 1)], {}, 1],
  ['a cleared flag on an empty file is ignored', [F(0, 999, 1), F(0, 0, 0), F(0, 0, 0)], {}, -1],
  ['Save_InitializeWork fails', [F(15, 100, 1), F(0, 0, 0), F(0, 0, 0)], { initError: 1 }, -1],
  ['Save_ReadPart fails', [F(15, 100, 1), F(0, 0, 0), F(0, 0, 0)], { readError: 0 }, -1],
];
for (const [name, files, opt, want] of cases) {
  const m = fake(files, opt);
  const r = T.gs1Export(m);
  const got = r ? r.chosen : -1;
  const bytesOk = want < 0 ? !(r && r.bytes) : r.bytes.length === T.SEND_BYTES && r.bytes[0] === 0x10 + want && r.bytes[4096] === 0x10 + want + 3;
  check(got === want && bytesOk && m.calls[m.calls.length - 1] === T.GS1.Save_ReleaseWork, `${name}: file ${got + 1 || 'none'}`);
}
console.log(fails ? `transfer_pick: ${fails} FAIL` : 'transfer_pick: ALL PASS');
process.exit(fails ? 1 : 0);
