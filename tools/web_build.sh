#!/bin/bash
# wasm build (G2+) in the local emscripten/emsdk image: tools/wasm/build.py with the repo at /gs, vendor/ read
# only and the ROM read only (only the leak check reads it). Usage: tools/web_build.sh [build.py args]
# ALCHEMY=<checkout> builds against another alchemy checkout (e.g. a git worktree at an older pin), mounted at the
# same path /gs/vendor/alchemy so the build is otherwise unchanged (TLA1 identity check).
set -euo pipefail
export PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH
cd "$(dirname "$0")/.."
ROM=${ROM:-$HOME/roms/Golden_Sun_USA_Europe.gba}
ALT=()
[ -n "${ALCHEMY:-}" ] && ALT=(-v "$(cd "$ALCHEMY" && pwd)":/gs/vendor/alchemy:ro)
docker run --rm -u "$(id -u):$(id -g)" -e EM_CACHE=/gs/build/emcache -e HOME=/tmp \
  -v "$PWD":/gs -v "$PWD/vendor":/gs/vendor:ro ${ALT[@]+"${ALT[@]}"} -v "$ROM":/rom/baserom.gba:ro -w /gs \
  emscripten/emsdk:4.0.15-arm64 python3 tools/wasm/build.py "$@"
