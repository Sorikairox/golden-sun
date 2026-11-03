#!/bin/bash
# TLA4c: incremental TLA wasm build after an asm2c/hw2c or a port C change, instead of the full 5-6 min
# tools/web_build.sh --game tla. Reruns the asm2c stage, recompiles only the asm2c units whose text changed plus
# the C files named as arguments (paths in the repo, e.g. port/tla/a2c/a2c_rt.c), then links and runs the call-target
# check and the leak check. Needs a previous full build (the other objects are reused as they are).
# Usage: tools/tla_incr.sh [--no-asm2c] [repo/path.c ...]
set -euo pipefail
export PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH
cd "$(dirname "$0")/.."
D=build/wasm-tla/asm2c
OBJ=build/wasm-tla/obj
ASM=1
[ "${1:-}" = "--no-asm2c" ] && { ASM=0; shift; }
SUM=$(mktemp)
shasum $D/tla_asm_*.c > "$SUM" 2>/dev/null || true
if [ $ASM = 1 ]; then
  tools/web_build.sh --game tla --only asm2c | tail -2
fi
CH=()
for f in $D/tla_asm_*.c; do
  old=$(grep " $f\$" "$SUM" | cut -d' ' -f1 || true)
  new=$(shasum "$f" | cut -d' ' -f1)
  [ "$old" = "$new" ] && [ -f "$OBJ/$(echo "$f" | sed 's#/#__#g').o" ] || CH+=("$f")
done
rm -f "$SUM"
# units that no longer exist (fewer units after a split) must not be linked
for o in $OBJ/build__wasm-tla__asm2c__tla_asm_*.c.o; do
  src=$(basename "$o" .o | sed 's#__#/#g')
  [ -f "$src" ] || rm -f "$o"
done
CH+=("$@")
echo "recompiling ${#CH[@]}: ${CH[*]:-}"
if [ ${#CH[@]} -gt 0 ]; then
  CMDS=""
  for f in "${CH[@]}"; do
    o="$OBJ/$(echo "$f" | sed 's#/#__#g').o"
    W=""; case "$f" in *tla_asm*) W="-w";; esac
    CMDS+="echo \"emcc -O2 $W -c -o $o $f\"; "
  done
  docker run --rm -u "$(id -u):$(id -g)" -e EM_CACHE=/gs/build/emcache -e HOME=/tmp \
    -v "$PWD":/gs -v "$PWD/vendor":/gs/vendor:ro -w /gs emscripten/emsdk:4.0.15-arm64 \
    bash -c "($CMDS) | xargs -P 3 -I{} bash -c '{} || echo FAIL: {}'"
fi
tools/web_build.sh --game tla --only link,calls,leak 2>&1 | tail -8
