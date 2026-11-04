#!/bin/bash
# GS29: the masked regress comparison of two builds (traps 83-84; docs/GS27.md 4), side by side, in chunks short
# enough for one foreground command each. RAM digests with MASK_CODE=1 (wasm table indices and module data pointers
# count as 0), picture digests and save SHA-1s as they are.
#   tools/regress_cmp.sh BASE_BUILD NEW_BUILD OUT CASE...   run these cases on both builds at once (OUT/base, OUT/new;
#                                                           REUSE=1: saves of earlier chunks in the same OUT are kept);
#                                                           their rows are added to OUT/base.tsv and OUT/new.tsv
#   tools/regress_cmp.sh --compare OUT                      rows equal / differing, the differing ones listed
# Example: tools/regress_cmp.sh port_work/gs29/base_build build/wasm port_work/gs29/reg prologue_save garet
set -uo pipefail
cd "$(dirname "$0")/.."
if [ "${1:-}" = --compare ]; then
  O=$2
  sort "$O/base.tsv" > "$O/base.sorted"; sort "$O/new.tsv" > "$O/new.sorted"
  echo "rows: base $(wc -l < "$O/base.sorted"), new $(wc -l < "$O/new.sorted"), equal $(comm -12 "$O/base.sorted" "$O/new.sorted" | wc -l)"
  diff "$O/base.sorted" "$O/new.sorted" | grep '^[<>]' | head -40
  exit 0
fi
BASE=$1 NEW=$2 O=$3; shift 3
mkdir -p "$O/base" "$O/new"
for side in base new; do
  b=$BASE; [ $side = new ] && b=$NEW
  ( MASK_CODE=1 REUSE=1 LIMIT=${LIMIT:-600} REGRESS_DIR="$O/$side" REGRESS_BUILD="$b" tools/regress.sh "$@" > "$O/$side.log" 2>&1
    cat "$O/$side/actual.tsv" >> "$O/$side.tsv" ) &
done
wait
for side in base new; do echo "$side: $(grep -c . "$O/$side/actual.tsv") rows; $(grep -c 'STOPPED\|DIFFER' "$O/$side.log") stopped"; done
