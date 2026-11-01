#!/bin/bash
# Turns a tests/probes/pathfind.cjs path ("DOWN 3, LEFT 4, ...") into key specs starting at frame START, FPC frames
# per cell (default 16, Isaac walking). tools/path2keys.sh START "DOWN 3, LEFT 4" [FPC]
f=$1; fpc=${3:-16}; out=()
IFS=',' read -ra runs <<< "$2"
for r in "${runs[@]}"; do set -- $r; e=$((f + $2 * fpc - 1)); out+=("$1@$f-$e"); f=$((e + 1)); done
(IFS=,; echo "${out[*]}")
