// TEST-ONLY probe for tests/boot.cjs --probe (TLA8): at frame DUMP_AT writes EWRAM (0x02000000, 256 KB) to DUMP_OUT
// (a file in port_work/: it holds game data, never commit it).
'use strict';
const fs = require('fs');
module.exports = (m, frame) => {
  if (frame !== +(process.env.DUMP_AT || 0)) return;
  fs.writeFileSync(process.env.DUMP_OUT, Buffer.from(m.HEAPU8.subarray(0x02000000, 0x02040000)));
};
