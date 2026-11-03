#!/bin/bash
# D20 batch over every asm2c translation (TLA5): runs tests/arm/tla/batch/batch.cjs in JOBS parallel shards and
# merges build/a2c/batch/shard_*.tsv into build/a2c/batch/d20_batch.tsv with a summary (EQUIV / FAIL / NOINPUT and
# the profile that gave the inputs). Needs build/a2c/a2c_test.js (tests/arm/tla/build_test.sh). Exit 1 on any FAIL.
set -uo pipefail
cd "$(dirname "$0")/../../../.."
JOBS=${JOBS:-6}
mkdir -p build/a2c/batch
rm -f build/a2c/batch/shard_*.tsv
pids=()
for ((i = 0; i < JOBS; i++)); do node tests/arm/tla/batch/batch.cjs "$i/$JOBS" > build/a2c/batch/shard_$i.log 2>&1 & pids+=($!); done
for p in "${pids[@]}"; do wait "$p"; done
{ printf 'name\toverlay\taddr\tbytes\tresult\tprofile\tcases\tnote\n'; cat build/a2c/batch/shard_*.tsv | sort; } > build/a2c/batch/d20_batch.tsv
echo "routines: $(($(wc -l < build/a2c/batch/d20_batch.tsv) - 1))"
awk -F'\t' 'NR>1{print $5}' build/a2c/batch/d20_batch.tsv | sort | uniq -c
echo "EQUIV by profile:"; awk -F'\t' 'NR>1 && $5=="EQUIV"{print $6}' build/a2c/batch/d20_batch.tsv | sort | uniq -c
awk -F'\t' 'NR>1 && $5=="FAIL"{print "FAIL " $1 "@" $2 ": " $8}' build/a2c/batch/d20_batch.tsv
! grep -q $'\tFAIL\t' build/a2c/batch/d20_batch.tsv
