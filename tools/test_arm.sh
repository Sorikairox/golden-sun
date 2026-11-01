#!/bin/bash
# Differential tests of the hand-ported asm routines (D20) plus the harness's negative controls, on the host's
# node against build/wasm/game.js and the player's ROM (read only). Usage: tools/test_arm.sh [routine-filter]
set -euo pipefail
cd "$(dirname "$0")/.."
ROM=${ROM:-$HOME/roms/Golden_Sun_USA_Europe.gba}
node tests/arm/selftest.cjs build/wasm/game.js "$ROM" | tail -1
node tests/arm/diff.cjs build/wasm/game.js "$ROM" "$@"
