#!/bin/bash
# The retrowser.app build of both games (docs/RTW.md), rebuilt and put where the repo publishes it on main:
#   retrowser.json                 GS1's manifest (repo root; its paths are relative to the root)
#   retrowser/gs1/gs1.{wasm,js}    GS1's module
#   retrowser/tla/retrowser.json   The Lost Age's manifest, its files beside it: retrowser/tla/tla.{wasm,js}
#   retrowser/{gs1,tla}/cover.png  the cartridge pictures (`picture`): box art from art/cover-{gs1,tla}.png
#   retrowser/{gs1,tla}/icon.png   the game icons (`icon`): the site's own sun, port/web/icon-512.png
# Steps: tools/rtw_build.sh for GS1 and TLA (relinks the current web builds' objects with port/rtw; the web build's
# game.wasm/game.js stay as they are, checked), copy, manifests from port/rtw/*.retrowser.json, then retrowser's own
# tool: `rtw.mjs hash` (sha256 + size) and `rtw.mjs check --rom` (schema, hashes, exports/imports, and no run of the
# ROM's bytes in any file) for each game, plus the repo's leak check (rtw_build.sh). Rerun after every change.
#   tools/web_build.sh && tools/web_build.sh --game tla     (first, when the game or PC-layer code changed)
#   tools/rtw_publish.sh [--no-build]                        (--no-build: reuse build/rtw/, only copy/hash/check)
# Then commit retrowser.json and retrowser/ (one commit). RTW_TOOL=path to rtw.mjs (default: the local retrowser
# checkout's dist/tools/rtw.mjs, made by `npm run build` there). Never deploys, never pushes.
set -euo pipefail
cd "$(dirname "$0")/.."
RTW_TOOL=${RTW_TOOL:-$HOME/Code/retrowser/dist/tools/rtw.mjs}
ROM=${ROM:-$HOME/roms/Golden_Sun_USA_Europe.gba}
ROM_TLA=${ROM_TLA:-$HOME/roms/Golden_Sun_The_Lost_Age_USA_Europe.gba}
[ -f "$RTW_TOOL" ] || { echo "no rtw.mjs at $RTW_TOOL (cd ~/Code/retrowser && npm run build), or set RTW_TOOL"; exit 1; }
if [ "${1:-}" != --no-build ]; then
  tools/rtw_build.sh
  tools/rtw_build.sh --game tla
fi
for f in gs1.wasm gs1.js tla.wasm tla.js; do [ -f build/rtw/$f ] || { echo "no build/rtw/$f"; exit 1; }; done
rm -rf retrowser
mkdir -p retrowser/gs1 retrowser/tla
cp build/rtw/gs1.wasm build/rtw/gs1.js retrowser/gs1/
cp build/rtw/tla.wasm build/rtw/tla.js retrowser/tla/
# cartridge pictures: the box art (approved by the user; libretro-thumbnails), kept as source art in art/
cp art/cover-gs1.png retrowser/gs1/cover.png
cp art/cover-tla.png retrowser/tla/cover.png
# game icons (tab, home-screen app): the page's own drawn sun icon (our art), the same for both games
cp port/web/icon-512.png retrowser/gs1/icon.png
cp port/web/icon-512.png retrowser/tla/icon.png
cp port/rtw/gs1.retrowser.json retrowser.json
cp port/rtw/tla.retrowser.json retrowser/tla/retrowser.json
# only our files: the two modules, their glue, TLA's manifest, the two covers and the two icons (no ROM, save or capture can slip in)
bad=$(cd retrowser && find . -type f | sort | grep -Ev '^\./(gs1/gs1\.(wasm|js)|tla/tla\.(wasm|js)|tla/retrowser\.json|(gs1|tla)/(cover|icon)\.png)$' || true)
[ -z "$bad" ] || { echo "unexpected files in retrowser/: $bad"; exit 1; }
fails=0
for d in . retrowser/tla; do
  r=$ROM; [ $d = retrowser/tla ] && r=$ROM_TLA
  node "$RTW_TOOL" hash $d | tail -1
  out=$(node "$RTW_TOOL" check $d --rom "$r" 2>&1) || true
  echo "$out" | grep -Ev '^\s*$' | sed "s|^|  check $d: |" | tail -8
  echo "$out" | grep -q '^OK' || fails=$((fails + 1))
done
id() { shasum -a 256 "$1" | cut -c1-16; }
echo "build ids (SHA-256 of the manifest): GS1 $(id retrowser.json), TLA $(id retrowser/tla/retrowser.json)"
[ $fails = 0 ] && echo "RTW_PUBLISH: OK (commit retrowser.json and retrowser/)" || { echo "RTW_PUBLISH: $fails check(s) failed"; exit 1; }
