#!/bin/bash
# Assembles the page (G3) into build/site: port/web + build/wasm/game.{js,wasm}. No ROM, nothing ROM-derived.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf build/site && mkdir -p build/site
cp port/web/index.html port/web/main.js port/web/touch.js port/web/touch.css port/web/audio.js port/web/net.js build/site/
cp build/wasm/game.js build/wasm/game.wasm build/site/
# build id for the online hello / room check (G7): both players must run the same game code
BUILD=$(cat build/site/game.wasm build/site/game.js | shasum -a 256 | cut -c1-16)
echo "window.GS_BUILD = '$BUILD';" > build/site/build_id.js
echo "site: build/site ($(du -sh build/site | cut -f1)), build $BUILD"
