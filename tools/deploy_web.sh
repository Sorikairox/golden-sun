#!/bin/bash
# Deploy the web port to https://golden-sun-web-port.netlify.app (Netlify project golden-sun-web-port, created
# 2026-11-02 on the user's account at the user's request; orchestrator D14). Ships build/site as tools/site.sh
# assembles it (page, game.js/game.wasm, offline files) plus the room-code function (port/netlify/functions/room,
# Netlify Blobs store golden-sun-rooms) at /api/room. Nothing ROM-derived is published: the leak check runs on
# game.wasm and game.js, and any ROM/save-like file in the site stops the deploy.
#   tools/web_build.sh && tools/deploy_web.sh      (the build must be current; commit first)
# Staging lives outside the repo (~/golden-sun-site): publish/ = the files sent, fn/ = the function bundled with
# @netlify/blobs installed by npm from port/netlify/package.json (node_modules is never committed nor published).
set -euo pipefail
cd "$(dirname "$0")/.."
R=$PWD
SITE_ID=acaba387-f379-4861-96a9-00d158b65a6e
URL=https://golden-sun-web-port.netlify.app
ROM=${ROM:-$HOME/roms/Golden_Sun_USA_Europe.gba}
STAGE=${GS_STAGE:-$HOME/golden-sun-site}
# the netlify CLI: on PATH, else the copy npx already cached (no download here)
NL=$(command -v netlify || ls -d "$HOME"/.npm/_npx/*/node_modules/.bin/netlify 2>/dev/null | head -1 || true)
[ -n "$NL" ] || { echo "no netlify CLI found: run once: npx -y netlify-cli@latest login"; exit 1; }

[ -f build/wasm/game.wasm ] || { echo "no build: run tools/web_build.sh"; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "uncommitted changes: commit first so BUILD.txt names the deployed code"; exit 1; }
for f in game.wasm game.js; do
  python3 tools/wasm/leak_check.py build/wasm/$f "$ROM" . | grep -q 'PASS' || { echo "leak check failed on $f"; exit 1; }
done
echo "leak check: game.wasm, game.js PASS"
tools/site.sh
bad=$(cd build/site && ls | grep -Eiv '^(index\.html|[a-z_]+\.js|touch\.css|game\.wasm|manifest\.webmanifest|icon-(192|512)\.png|apple-touch-icon\.png)$' || true)
[ -z "$bad" ] || { echo "unexpected files in build/site: $bad"; exit 1; }

S=$STAGE/publish; rm -rf "$S"; mkdir -p "$S"
cp build/site/* "$S"/
git log -1 --format='%h %ad %s' --date=format:'%Y-%m-%d %H:%M' > "$S/BUILD.txt"
F=$STAGE/fn; mkdir -p "$F/functions"
rm -rf "$F/functions/room"; cp -R port/netlify/functions/room "$F/functions/"
if ! cmp -s port/netlify/package.json "$F/package.json" || [ ! -d "$F/node_modules/@netlify/blobs" ]; then
  cp port/netlify/package.json "$F/" && (cd "$F" && npm install --no-audit --no-fund --silent)
fi
echo "deploying $(ls "$S" | wc -l | tr -d ' ') files + function room"
(cd "$F" && "$NL" deploy --prod --site $SITE_ID --dir "$S" --functions functions --no-build 2>&1 |
  grep -E "Deploy is live|Error|error|Function|function" | sed 's/\x1b\[[0-9;]*m//g' | head -8) || true
cd "$R"
echo "live BUILD.txt: $(curl -s $URL/BUILD.txt)"
echo "game.wasm: $(curl -sI $URL/game.wasm | grep -i '^content-type' | tr -d '\r')"
echo "sw.js: $(curl -s $URL/sw.js | grep -E '^const (BUILD|SITE)' | tr '\n' ' ')"
# the room server answers (a bad request gives a JSON error; nothing is stored)
echo "api/room: $(curl -s -X POST -H 'content-type: application/json' -d '{"op":"host","code":"QQQQQ","secret":"x"}' $URL/api/room)"
