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
