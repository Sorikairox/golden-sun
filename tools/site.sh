#!/bin/bash
# Assembles the page (G3) into build/site: port/web + build/wasm/game.{js,wasm}. No ROM, nothing ROM-derived.
# GS-deploy: also the offline files (manifest, our drawn icons) and sw.js with the build id, a site hash and the
# precache list filled in (docs/OFFLINE.md).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf build/site && mkdir -p build/site
cp port/web/index.html port/web/main.js port/web/touch.js port/web/touch.css port/web/audio.js port/web/net.js build/site/
cp port/web/manifest.webmanifest port/web/icon-192.png port/web/icon-512.png port/web/apple-touch-icon.png build/site/
cp build/wasm/game.js build/wasm/game.wasm build/site/
# build id for the online hello / room check (G7): both players must run the same game code
BUILD=$(cat build/site/game.wasm build/site/game.js | shasum -a 256 | cut -c1-16)
echo "window.GS_BUILD = '$BUILD';" > build/site/build_id.js
# offline: every file above is precached (the page itself as './'); the site hash changes with any file, so any
# page change is a new cache, not only a new game build
SITE=$(cd build/site && for f in $(ls | sort); do shasum -a 256 "$f"; done | shasum -a 256 | cut -c1-12)
python3 - "$BUILD" "$SITE" <<'EOF'
import json, os, sys
build, site = sys.argv[1], sys.argv[2]
files = ['./'] + sorted(f for f in os.listdir('build/site') if f != 'index.html')
src = open('port/web/sw.js').read()
for k, v in (("'__GS_BUILD__'", repr(build)), ("'__GS_SITE__'", repr(site)), ("['__GS_FILES__']", json.dumps(files))):
    assert src.count(k) == 1, k
    src = src.replace(k, v)
open('build/site/sw.js', 'w').write(src)
EOF
echo "site: build/site ($(du -sh build/site | cut -f1)), build $BUILD, site $SITE, $(ls build/site | wc -l | tr -d ' ') files"
