#!/bin/bash
# Assembles the page (G3) into build/site: port/web + build/wasm/game.{js,wasm}. No ROM, nothing ROM-derived.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf build/site && mkdir -p build/site
cp port/web/index.html port/web/main.js port/web/touch.js port/web/touch.css port/web/audio.js build/site/
cp build/wasm/game.js build/wasm/game.wasm build/site/
echo "site: build/site ($(du -sh build/site | cut -f1))"
