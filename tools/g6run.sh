#!/bin/bash
# G6 node run on a private copy of the build (port_work/g6/bin, refreshed by `tools/g6run.sh --sync`), so a
# concurrent session's rebuild does not change it mid-test. tools/g6run.sh FRAMES [tests/boot.cjs options...]
# Log: port_work/g6/boot.log (LOG=...), last TAILN lines printed.
set -uo pipefail
cd "$(dirname "$0")/.."
BIN=port_work/g6/bin
if [ "${1:-}" = --sync ]; then mkdir -p $BIN; cp build/wasm/game.js build/wasm/game.wasm $BIN/; echo "synced $(stat -f %Sm $BIN/game.wasm)"; exit 0; fi
ROM=${ROM:-$HOME/roms/Golden_Sun_USA_Europe.gba}
LOG=${LOG:-port_work/g6/boot.log}
perl -e "alarm ${LIMIT:-180}; exec @ARGV" node tests/boot.cjs $BIN/game.js "$ROM" "$@" > "$LOG" 2>&1
[ $? = 142 ] && echo "boot: killed after ${LIMIT:-180}s (hang)" >> "$LOG"
grep -v '^$' "$LOG" | tail -${TAILN:-25}
