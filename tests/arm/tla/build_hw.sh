#!/bin/bash
# Builds the D20 test module for TLA4a: TLA's handwritten asm translated by asm2c through the byte-listing front end
# (port/tla/hw/tools/hw2c.py --all: bound objects too, so the binds are tested where they can be), a wrapper
# a2cw_<addr> per routine, plus the asm2c test runtime. Output in build/a2c (gitignored): hw_test.c, hw_test.report.tsv,
# hw_test.js/.wasm; listings in build/tla_hw/listings. Needs the emsdk image (D12). Usage: tests/arm/tla/build_hw.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
DOCKER=/Applications/Docker.app/Contents/Resources/bin/docker
mkdir -p build/a2c build/tla_hw
OUT=${OUT:-hw_test}
python3 port/tla/hw/tools/hw2c.py --all -o build/a2c/$OUT.c --report build/a2c/$OUT.report.tsv --export '*' ${ONLY:+--only "$ONLY"}
grep -o '^u32 a2cw[a-z0-9_]*' build/a2c/$OUT.c | sed 's/^u32 /_/' | tr '\n' ',' > build/a2c/$OUT.exports.txt
EXP="$(cat build/a2c/$OUT.exports.txt)_a2c_regs_addr,_a2c_set_overlay"
TR=(); [ -n "${TRACE:-}" ] && TR=('-DA2C_T(a)=(A2C_SPILL(),a2c_trace(a))')
"$DOCKER" run --rm -v "$PWD":/gs -w /gs emscripten/emsdk:4.0.15-arm64 emcc -O2 -w \
  -DA2C_STACK_TOP=0x0d0ff000u ${TR[@]+"${TR[@]}"} build/a2c/$OUT.c tests/arm/tla/a2c_rt.c --js-library tests/arm/tla/a2c_lib.js \
  -sINITIAL_MEMORY=236978176 -sALLOW_MEMORY_GROWTH=0 -sMODULARIZE=1 -sENVIRONMENT=node -sSTACK_SIZE=1048576 \
  -sEXPORTED_FUNCTIONS="$EXP" -sEXPORTED_RUNTIME_METHODS=HEAPU8 -o build/a2c/$OUT.js
ls -la build/a2c/$OUT.wasm
