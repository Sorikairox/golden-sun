#!/bin/bash
# Route-finding helper (G4, test only): runs the boot with key files plus extra key specs, logs where the party
# goes (tests/probes/where.cjs) and captures the last frame. tools/route.sh FRAMES "KEYS" [key files...]
# Example: tools/route.sh 5600 "UP@5320-5600" tests/routes/prologue.keys tests/routes/vale1.keys
set -uo pipefail
cd "$(dirname "$0")/.."
F=$1; K=$2; shift 2
files=$(IFS=,; echo "$*")
OUT=${OUT:-port_work/g5/route}
LIMIT=${LIMIT:-300} TAILN=0 tools/boot.sh "$F" ${files:+--keys-file "$files"} ${K:+--keys "$K"} --probe tests/probes/where.cjs \
  --shot "${SHOTS:-$F}" --out "$OUT" --quiet > /dev/null
grep '^where' port_work/boot.log | awk -v from="${FROM:-0}" '{f=substr($2,2)+0; if (f>=from) print}' | tail -${TAILN:-25}
grep -v '^where\|^$' port_work/boot.log | tail -5
