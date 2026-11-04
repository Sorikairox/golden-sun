#!/bin/bash
# Assembles the page (G3) into build/site: port/web + build/wasm/game.{js,wasm}. No ROM, nothing ROM-derived.
# GS-deploy: also the offline files (manifest, our drawn icons) and sw.js with the build id, a site hash and the
# precache list filled in (docs/OFFLINE.md).
# WASM=build/wasm-tla (TLA4c): the page with The Lost Age's build alone (local tests; the default stays GS1's).
# BOTH=1 (TLA6, the user's layout: one site, GS1 at /, The Lost Age at /tla/): GS1's page in build/site and TLA's
# page in build/site/tla, each with its own service worker (scope / and /tla/, caches golden-sun-* and
# golden-sun-tla-*), both on one origin so they share IndexedDB (docs/TLA6.md).
set -euo pipefail
cd "$(dirname "$0")/.."

# assemble DIR WASMDIR GAME(gs1|tla) BOTH(0|1)
assemble() {
  local D=$1 W=$2 G=$3 B=$4
  mkdir -p "$D"
  cp port/web/index.html port/web/main.js port/web/touch.js port/web/touch.css port/web/audio.js port/web/net.js "$D"/
  cp port/web/manifest.webmanifest port/web/icon-192.png port/web/icon-512.png port/web/apple-touch-icon.png "$D"/
  cp $W/game.js $W/game.wasm "$D"/
  # TLA9: The Lost Age's page gets the one-"Yes" party transfer (port/web/transfer.js) and its option in the page menu;
  # GS1's page stays as it was
  if [ "$G" = tla ]; then
    cp port/web/transfer.js "$D"/
    python3 - "$D"/index.html <<'EOF2'
import sys
p = sys.argv[1]; s = open(p).read()
anchor = ' Wide view</label>\n'
row = ('    <label class="opt-big" id="opt-gs1party-row" hidden title="When the game asks &quot;Transfer data from Golden Sun?&quot;, '
       'Yes brings the party of your cleared Golden Sun file on this site (no link cable or password menus)">'
       '<input id="opt-gs1party" type="checkbox" checked> Bring party from Golden Sun</label> <span id="opt-gs1party-state"></span>\n')
assert s.count(anchor) == 1 and s.count('<script src="main.js"></script>') == 1
s = s.replace(anchor, anchor + row).replace('<script src="main.js"></script>', '<script src="main.js"></script>\n<script src="transfer.js"></script>')
open(p, 'w').write(s)
EOF2
  fi
  # build id for the online hello / room check (G7): both players must run the same game code
  local BUILD SITE PREFIX=golden-sun-
  BUILD=$(cat "$D"/game.wasm "$D"/game.js | shasum -a 256 | cut -c1-16)
  echo "window.GS_BUILD = '$BUILD';" > "$D"/build_id.js
  [ "$G" = tla ] && { echo "window.GS_GAME = 'tla';" >> "$D"/build_id.js; PREFIX=golden-sun-tla-; }
  [ "$B" = 1 ] && echo "window.GS_SITE_BOTH = true;" >> "$D"/build_id.js
  if [ "$G" = tla ]; then  # its own name and start URL when installed (the manifest is per page)
    sed -i '' -e 's/"name": *"[^"]*"/"name": "Golden Sun: The Lost Age (web port)"/' \
      -e 's/"short_name": *"[^"]*"/"short_name": "The Lost Age"/' "$D"/manifest.webmanifest
  fi
  # offline: every file above is precached (the page itself as './'); the site hash changes with any file, so any
  # page change is a new cache, not only a new game build. Files only: the tla/ folder has its own worker
  # TLA9: with both games (BOTH=1) The Lost Age's worker also keeps GS1's game.js/game.wasm (../), which the party
  # transfer runs headless to read the GS1 save, so it works offline even if GS1's page was never opened
  local UP=""
  [ "$G" = tla ] && [ "$B" = 1 ] && UP="../game.js ../game.wasm"
  SITE=$(cd "$D" && for f in $(ls | sort) $UP; do [ -f "$f" ] && shasum -a 256 "$f"; done | shasum -a 256 | cut -c1-12)
  UP="$UP" python3 - "$D" "$BUILD" "$SITE" "$PREFIX" <<'EOF'
import json, os, sys
d, build, site, prefix = sys.argv[1:5]
files = ['./'] + sorted(f for f in os.listdir(d) if f != 'index.html' and os.path.isfile(os.path.join(d, f))) + os.environ['UP'].split()
src = open('port/web/sw.js').read()
for k, v in (("'__GS_BUILD__'", repr(build)), ("'__GS_SITE__'", repr(site)), ("['__GS_FILES__']", json.dumps(files)),
             ("'__GS_PREFIX__'", repr(prefix))):
    assert src.count(k) == 1, k
    src = src.replace(k, v)
open(os.path.join(d, 'sw.js'), 'w').write(src)
EOF
  echo "site: $D ($(du -sh "$D" | cut -f1)), build $BUILD, site $SITE, $(ls "$D" | wc -l | tr -d ' ') entries"
}

rm -rf build/site
WASM=${WASM:-build/wasm}
if [ "${BOTH:-0}" = 1 ]; then
  assemble build/site build/wasm gs1 1
  assemble build/site/tla build/wasm-tla tla 1
else
  assemble build/site $WASM "$([ "$WASM" = build/wasm-tla ] && echo tla || echo gs1)" 0
fi
