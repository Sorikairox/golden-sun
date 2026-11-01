#!/bin/bash
# Node boot run (G3) with a wall-clock limit (an infinite loop in wasm blocks node's own timers):
# tools/boot.sh FRAMES [tests/boot.cjs options...]; log in port_work/boot.log, captures in port_work/g3/.
set -uo pipefail
cd "$(dirname "$0")/.."
ROM=${ROM:-$HOME/roms/Golden_Sun_USA_Europe.gba}
LIMIT=${LIMIT:-120}
mkdir -p port_work
perl -e "alarm $LIMIT; exec @ARGV" node tests/boot.cjs build/wasm/game.js "$ROM" "$@" > port_work/boot.log 2>&1
rc=$?
[ $rc = 142 ] && echo "boot: killed after ${LIMIT}s (hang)" >> port_work/boot.log
grep -v '^$' port_work/boot.log | tail -${TAILN:-25}
