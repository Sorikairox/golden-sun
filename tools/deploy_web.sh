#!/bin/bash
# Deploy the web port to https://golden-sun-web-port.netlify.app (Netlify project golden-sun-web-port, created
# 2026-11-02 on the user's account at the user's request; orchestrator D14). Ships build/site as tools/site.sh
# assembles it (page, game.js/game.wasm, offline files) plus the room-code function (port/netlify/functions/room,
# Netlify Blobs store golden-sun-rooms) at /api/room. Nothing ROM-derived is published: the leak check runs on
# game.wasm and game.js, and any ROM/save-like file in the site stops the deploy.
# TLA8: the combined site by default (the user's layout, docs/TLA6.md 4): GS1 at /, The Lost Age at /tla/
# (`BOTH=1 tools/site.sh`); both builds leak-checked against their own ROM. TLA=0 ships GS1 alone (the old site).
#   tools/web_build.sh && tools/web_build.sh --game tla && tools/deploy_web.sh   (builds current; commit first)
#   tools/deploy_web.sh --dry-run    everything (leak checks, site, allowlist, staging, _headers, size report) except
#                                    the npm install of the function's dependencies, the upload and the live checks
# Staging lives outside the repo (~/golden-sun-site): publish/ = the files sent, fn/ = the function bundled with
# @netlify/blobs installed by npm from port/netlify/package.json (node_modules is never committed nor published).
set -euo pipefail
cd "$(dirname "$0")/.."
R=$PWD
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1
TLA=${TLA:-1}
SITE_ID=acaba387-f379-4861-96a9-00d158b65a6e
URL=https://golden-sun-web-port.netlify.app
ROM=${ROM:-$HOME/roms/Golden_Sun_USA_Europe.gba}
ROM_TLA=${ROM_TLA:-$HOME/roms/Golden_Sun_The_Lost_Age_USA_Europe.gba}
STAGE=${GS_STAGE:-$HOME/golden-sun-site}
# Netlify staff recommend files of at most 10 MB per deploy upload (answers.netlify.com, "What is the maximum allowed
# object size?"); no hard per-file limit is documented. TLA's game.wasm is ~21 MB: reported here, and the live check
# below compares the served size with the local one.
BIG=$((10 * 1024 * 1024))
# the netlify CLI: on PATH, else the copy npx already cached (no download here)
NL=$(command -v netlify || ls -d "$HOME"/.npm/_npx/*/node_modules/.bin/netlify 2>/dev/null | head -1 || true)
if [ -z "$NL" ]; then
  [ $DRY = 1 ] && echo "note: no netlify CLI found (the real deploy needs one: npx -y netlify-cli@latest login)" \
    || { echo "no netlify CLI found: run once: npx -y netlify-cli@latest login"; exit 1; }
fi

[ -f build/wasm/game.wasm ] || { echo "no build: run tools/web_build.sh"; exit 1; }
[ $TLA = 0 ] || [ -f build/wasm-tla/game.wasm ] || { echo "no TLA build: run tools/web_build.sh --game tla (or TLA=0)"; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "uncommitted changes: commit first so BUILD.txt names the deployed code"; exit 1; }
for f in game.wasm game.js; do
  python3 tools/wasm/leak_check.py build/wasm/$f "$ROM" . | grep -q 'PASS' || { echo "leak check failed on $f"; exit 1; }
done
echo "leak check: game.wasm, game.js PASS (GS1 ROM)"
if [ $TLA = 1 ]; then
  [ -f "$ROM_TLA" ] || { echo "no TLA ROM for the leak check: ROM_TLA=..."; exit 1; }
  for f in game.wasm game.js; do
    python3 tools/wasm/leak_check.py build/wasm-tla/$f "$ROM_TLA" . | grep -q 'PASS' || { echo "leak check failed on tla/$f"; exit 1; }
  done
  echo "leak check: tla/game.wasm, tla/game.js PASS (TLA ROM)"
  BOTH=1 tools/site.sh
else
  tools/site.sh
fi
# allowlist: the page's files only (no ROM, save or capture can slip in); with TLA the tla/ folder holds the same set
ALLOW='^(index\.html|[a-z_]+\.js|touch\.css|game\.wasm|manifest\.webmanifest|icon-(192|512)\.png|apple-touch-icon\.png)$'
bad=$(cd build/site && ls | grep -Eiv "$ALLOW" | grep -v '^tla$' || true)
[ -z "$bad" ] || { echo "unexpected files in build/site: $bad"; exit 1; }
if [ $TLA = 1 ]; then
  [ -d build/site/tla ] || { echo "build/site/tla missing"; exit 1; }
  bad=$(cd build/site/tla && ls | grep -Eiv "$ALLOW" || true)
  [ -z "$bad" ] || { echo "unexpected files in build/site/tla: $bad"; exit 1; }
else
  [ ! -e build/site/tla ] || { echo "build/site/tla present with TLA=0"; exit 1; }
fi

S=$STAGE/publish; rm -rf "$S"; mkdir -p "$S"
cp -R build/site/. "$S"/
git log -1 --format='%h %ad %s' --date=format:'%Y-%m-%d %H:%M' > "$S/BUILD.txt"
if [ $TLA = 1 ]; then cp "$S/BUILD.txt" "$S/tla/BUILD.txt"; fi
# Netlify serves .webmanifest as octet-stream by default; sw.js is never HTTP-cached (Netlify's default, kept explicit)
{
  printf '/manifest.webmanifest\n  Content-Type: application/manifest+json\n/sw.js\n  Cache-Control: no-cache\n'
  if [ $TLA = 1 ]; then printf '/tla/manifest.webmanifest\n  Content-Type: application/manifest+json\n/tla/sw.js\n  Cache-Control: no-cache\n'; fi
} > "$S/_headers"
n=$(find "$S" -type f | wc -l | tr -d ' ')
echo "staged: $S, $n files, $(du -sh "$S" | cut -f1)"
find "$S" -type f -size +$((BIG / 1024))k | while read -r f; do
  echo "note: ${f#$S/} is $(($(wc -c < "$f") / 1024 / 1024)) MB, above Netlify's recommended 10 MB per file (no documented hard limit)"
done
F=$STAGE/fn; mkdir -p "$F/functions"
rm -rf "$F/functions/room"; cp -R port/netlify/functions/room "$F/functions/"
if ! cmp -s port/netlify/package.json "$F/package.json" || [ ! -d "$F/node_modules/@netlify/blobs" ]; then
  if [ $DRY = 1 ]; then echo "note: the real deploy will run npm install in $F (the function's dependencies)"
  else cp port/netlify/package.json "$F/" && (cd "$F" && npm install --no-audit --no-fund --silent); fi
fi
if [ $DRY = 1 ]; then
  echo "dry run: would deploy $n files + function room to $URL (site $SITE_ID); nothing uploaded"
  echo "DEPLOY_DRY_RUN: OK"
  exit 0
fi
echo "deploying $n files + function room"
(cd "$F" && "$NL" deploy --prod --site $SITE_ID --dir "$S" --functions functions --no-build 2>&1 |
  grep -E "Deploy is live|Error|error|Function|function" | sed 's/\x1b\[[0-9;]*m//g' | head -8) || true
cd "$R"
live() { # PATH-PREFIX LOCAL-DIR: BUILD.txt, game.wasm type and size, manifest type, sw.js constants
  local P=$1 L=$2
  echo "${P:-/} BUILD.txt: $(curl -s $URL$P/BUILD.txt)"
  local h; h=$(curl -sI $URL$P/game.wasm | tr -d '\r')
  local got; got=$(echo "$h" | grep -i '^content-length' | awk '{print $2}')
  echo "${P:-/} game.wasm: $(echo "$h" | grep -i '^content-type'), length ${got:-?} (local $(wc -c < $L/game.wasm | tr -d ' '))"
  [ "${got:-}" = "$(wc -c < $L/game.wasm | tr -d ' ')" ] || echo "WARNING: ${P:-/}game.wasm length differs from the local file"
  echo "${P:-/} manifest: $(curl -sI $URL$P/manifest.webmanifest | grep -i '^content-type' | tr -d '\r')"
  echo "${P:-/} sw.js: $(curl -s $URL$P/sw.js | grep -E '^const (BUILD|SITE|PREFIX)' | tr '\n' ' ')"
}
live "" build/site
if [ $TLA = 1 ]; then live /tla build/site/tla; fi
# the room server answers (a bad request gives a JSON error; nothing is stored)
echo "api/room: $(curl -s -X POST -H 'content-type: application/json' -d '{"op":"host","code":"QQQQQ","secret":"x"}' $URL/api/room)"
