#!/bin/bash
# G6 local link battle (tests/link2.cjs): both instances from the File Screen through the Battle Arena lobby,
# party exchange and a whole link battle (both sides Attack every turn), checking the two sides mirror each other
# at every change of the battle seed. Inputs: tests/routes/link_*.keys. Extra args go to link2.cjs, e.g.
#   tools/link2.sh --delay 2 --drop 0.2 --jitter 1
# Log: port_work/g7/link2.log (LOG=...); prints the summary lines.
set -uo pipefail
cd "$(dirname "$0")/.."
ROM=${ROM:-$HOME/roms/Golden_Sun_USA_Europe.gba}
LOG=${LOG:-port_work/g7/link2.log}
K=tests/routes/link_arena.keys,tests/routes/link_lobby.keys,tests/routes/link_fight.keys
mkdir -p port_work/g7
perl -e "alarm ${LIMIT:-300}; exec @ARGV" node tests/link2.cjs build/wasm/game.js "$ROM" ${FRAMES:-5200} \
  --keys-file0 $K --keys-file1 $K --hash --quiet --out "${OUT:-port_work/g7/run}" "$@" > "$LOG" 2>&1
[ $? = 142 ] && echo "link2: killed after ${LIMIT:-300}s (hang)" >> "$LOG"
grep -E '^(hash|ram|link2|check 1:)|DIFFER|stopped|Error' "$LOG" | cut -c1-400
