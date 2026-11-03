#!/bin/bash
# Builds the D20 test module for asm2c (TLA3): every TLA listing routine asm2c translates, with a wrapper
# a2cw_<addr> (overlays a2cw_ov<id>_<addr>) each, plus the test runtime. Output in build/a2c (gitignored):
# tla_asm.c, report.tsv, a2c_test.js/.wasm. Needs the emsdk image (D12). Usage: tests/arm/tla/build_test.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
DOCKER=/Applications/Docker.app/Contents/Resources/bin/docker
mkdir -p build/a2c
# ONLY=name,...: translate only those (fast debug builds); TRACE=1: per-instruction trace hook (diff_tla.cjs TRACE=1)
OUT=${OUT:-a2c_test}
python3 tools/wasm/asm2c.py -o build/a2c/$OUT.c --report build/a2c/$OUT.report.tsv --export '*' ${ONLY:+--only "$ONLY"}
[ -z "${ONLY:-}" ] && cp build/a2c/$OUT.report.tsv build/a2c/report.tsv
grep -o '^u32 a2cw[a-z0-9_]*' build/a2c/$OUT.c | sed 's/^u32 /_/' | tr '\n' ',' > build/a2c/exports.txt
EXP="$(cat build/a2c/exports.txt)_a2c_regs_addr,_a2c_set_overlay"
TR=(); [ -n "${TRACE:-}" ] && TR=('-DA2C_T(a)=(A2C_SPILL(),a2c_trace(a))')
"$DOCKER" run --rm -v "$PWD":/gs -w /gs emscripten/emsdk:4.0.15-arm64 emcc -O2 -w \
  -DA2C_STACK_TOP=0x0d0ff000u ${TR[@]+"${TR[@]}"} build/a2c/$OUT.c tests/arm/tla/a2c_rt.c --js-library tests/arm/tla/a2c_lib.js \
  -sINITIAL_MEMORY=236978176 -sALLOW_MEMORY_GROWTH=0 -sMODULARIZE=1 -sENVIRONMENT=node -sSTACK_SIZE=1048576 \
  -sEXPORTED_FUNCTIONS="$EXP" -sEXPORTED_RUNTIME_METHODS=HEAPU8 -o build/a2c/$OUT.js
ls -la build/a2c/$OUT.wasm
