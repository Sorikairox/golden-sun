<p align="center"><a href="https://retrowser.app/g/Sorikairox/golden-sun"><img src=".github/play-on-retrowser.svg" alt="Play on retrowser"></a></p>

## Play in your browser

- **Golden Sun**: open [retrowser.app/g/Sorikairox/golden-sun](https://retrowser.app/g/Sorikairox/golden-sun), or paste
  this repository's link on [retrowser.app](https://retrowser.app).
- Pick your own ROM: **Golden Sun (USA, Europe)**, a `.gba` file of 8 MiB, SHA-1
  `5c4695205413df7db52b9a184815a07783999971`. It is checked in the browser and never leaves your device.
- **Golden Sun: The Lost Age**: open
  [retrowser.app/g/Sorikairox/golden-sun?path=retrowser/tla](https://retrowser.app/g/Sorikairox/golden-sun?path=retrowser/tla)
  with **Golden Sun: The Lost Age (USA, Europe)**, a `.gba` file of 16 MiB, SHA-1
  `b500663220cb9bf56b9f8e8c0c544f1d6fa3a824`.
- Controls: keyboard (arrows, X = A, Z = B, A = L, S = R, Enter = Start, Backspace = Select; remappable), a gamepad,
  or touch controls on phones.
- Saves stay in your browser (the game's own 64 KB save; use **Export save** in the ☰ menu to keep a copy, it works
  in other GBA emulators too).
- After the first load the game also works offline.
- Link battles (two players online) are only on the port's own site for now.
- retrowser runs this repository's own build (`retrowser.json`, `retrowser/`); it hosts no game code or ROMs.

# golden-sun

A fan-made browser source port of **Golden Sun** (Game Boy Advance, 2001; "The Broken Seal"), with the
two-player link-cable battle playable online. Not affiliated with or endorsed by Nintendo or Camelot.

**No game data is included, and none ever will be.** To play or build you need your own dump of the
cartridge:

| | |
|---|---|
| No-Intro name | Golden Sun (USA, Europe) — one English cartridge sold in both regions |
| Size | 8,388,608 bytes (8 MiB) |
| SHA-1 | `5c4695205413df7db52b9a184815a07783999971` |
| Header | title `Golden_Sun_A`, game code `AGSE01`, version 0 |

Put it in `~/roms/` (read-only); `tools/check_rom.sh <path>` verifies it. The web page asks for the ROM
file and reads every asset from it in the browser.

Status: phase G1 (toolchain and address map, session GS1; see [docs/G1.md](docs/G1.md)). See [orchestrator.md](orchestrator.md), [docs/PLAN.md](docs/PLAN.md) and
[docs/HANDOFF.md](docs/HANDOFF.md).
