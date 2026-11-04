#!/usr/bin/env node
// TLA8: key spans that type a Golden Sun password into The Lost Age's password entry (overlay 64A, Func_02000e44),
// as a player would: the cursor walks the 16 x 4 grid (row-major, the same 64 symbols in the same order as GS1's
// FileScreen_NameEntryCharacter: A-H J-N P-Z 2-9 / a-k m n p-z ! ? # & $ % + =) and A enters each symbol, then the
// cursor goes right to the side column and down to "Finish". Output: tests/boot.cjs key syntax. The input is a
// password file from tests/probes/password.cjs (PW_OUT); keys and passwords stay in port_work/ (save-derived data).
// Usage: node tools/pw2keys.cjs PASSWORD.json START_FRAME [STEP] > keys
'use strict';
const fs = require('fs');
const [file, start, stepArg] = process.argv.slice(2);
const pw = JSON.parse(fs.readFileSync(file, 'utf8'));
const step = +stepArg || 8; // frames per press: 3 held, the rest released
let f = +start, r = 0, c = 0;
const out = [];
const press = (k) => { out.push(`${k}@${f}-${f + 2}`); f += step; };
const go = (tr, tc) => {
  while (r < tr) { press('DOWN'); r++; }
  while (r > tr) { press('UP'); r--; }
  while (c < tc) { press('RIGHT'); c++; }
  while (c > tc) { press('LEFT'); c--; }
};
for (const s of pw.symbols) { go(s >> 4, s & 15); press('A'); }
// Finish: the side column (col 16), row 3
const FIN_ROW = +(process.env.PW_FINISH_ROW ?? 3);
go(FIN_ROW, 16);
press('A');
console.log(`# ${pw.symbols.length} symbols, ends at f${f}`);
console.log(out.join(','));
