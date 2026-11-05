#!/bin/bash
# The retrowser.app build (docs/RTW.md), a separate target: relinks the web build's objects (build/wasm or
# build/wasm-tla, made by tools/web_build.sh) with port/rtw/ into build/rtw/gs1.{js,wasm} or build/rtw/tla.{js,wasm}
# (tools/wasm/link.py rtw_link, env PORT_RTW_OUT). The web build's game.js/game.wasm are never written.
#   tools/rtw_build.sh [--game tbs|tla]        (needs a complete tools/web_build.sh [--game tla] first)
# Then the leak check against the game's own ROM. tools/rtw_publish.sh runs this for both games and fills retrowser/.
set -euo pipefail
cd "$(dirname "$0")/.."
GAME=tbs
case " $* " in *" --game tla "*|*" --game=tla "*) GAME=tla ;; esac
if [ $GAME = tla ]; then W=build/wasm-tla; N=tla; ROM=${ROM_TLA:-$HOME/roms/Golden_Sun_The_Lost_Age_USA_Europe.gba}
else W=build/wasm; N=gs1; ROM=${ROM:-$HOME/roms/Golden_Sun_USA_Europe.gba}; fi
[ -f $W/game.wasm ] && [ -d $W/obj ] || { echo "no web build in $W: run tools/web_build.sh${GAME/tbs/} first"; exit 1; }
mkdir -p build/rtw
rm -f build/rtw/$N.js build/rtw/$N.wasm
SUM=$(shasum $W/game.wasm $W/game.js)
# link stage only, in the web build's container (tools/web_build.sh's docker command plus PORT_RTW_OUT): the objects
# are the web build's; the output goes to /gs/build/rtw (the repo is mounted at /gs)
export PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH
docker run --rm -u "$(id -u):$(id -g)" -e EM_CACHE=/gs/build/emcache -e HOME=/tmp -e PORT_RTW_OUT=/gs/build/rtw \
  -v "$PWD":/gs -v "$PWD/vendor":/gs/vendor:ro -v "$ROM":/rom/baserom.gba:ro -w /gs \
  emscripten/emsdk:4.0.15-arm64 python3 tools/wasm/build.py --game $GAME --only link 2>&1 | grep -E "^rtw|FAIL|rror" | head -30 || true
[ -f build/rtw/$N.wasm ] || { echo "rtw link failed (the grep above shows the link errors)"; exit 1; }
[ "$SUM" = "$(shasum $W/game.wasm $W/game.js)" ] || { echo "ERROR: the web build's game.wasm/game.js changed"; exit 1; }
for f in $N.wasm $N.js; do
  PORT_GAME=$GAME python3 tools/wasm/leak_check.py build/rtw/$f "$ROM" . | grep -q PASS || { echo "leak check failed on build/rtw/$f"; exit 1; }
done
echo "rtw $N: $(wc -c < build/rtw/$N.wasm | tr -d ' ') + $(wc -c < build/rtw/$N.js | tr -d ' ') bytes, leak check PASS, web build unchanged"
