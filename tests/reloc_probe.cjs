// Node test: load the player's ROM into the wasm's identity-mapped memory, fill the relocated tables
// (Port_RelocateAll) and check every patched slot (Port_RelocCheck). Prints counts only.
// Usage (in the emsdk image): node tests/reloc_probe.cjs build/wasm/game.js /rom/baserom.gba
const fs = require('fs');
const path = require('path');
const [gameJs, romPath] = process.argv.slice(2);
require(path.resolve(gameJs))({ print: () => {} }).then((m) => {
  const rom = fs.readFileSync(romPath);
  m.HEAPU8.set(rom, 0x08000000);
  const filled = m.ccall('Port_RelocateAll', 'number', [], []);
  const bad = m.ccall('Port_RelocCheck', 'number', [], []);
  console.log(`reloc probe: ${filled} main-image symbols filled from the ROM, ${bad} bad slots -> ${bad ? 'FAIL' : 'PASS'}`);
  process.exit(bad ? 1 : 0);
});
