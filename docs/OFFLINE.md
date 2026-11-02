# Offline play (GS-deploy, 2026-11-02)

The user asked: "make all port work offline so anyone can play as long as they loaded the website." Once a browser
has loaded the site once, the page, scripts, wasm, audio worklet, touch files and icons work with no network. The
player's ROM and saves were already in IndexedDB (`golden-sun` database, store `files`, keys `rom` and `flash`).

## Pieces

| Piece | File |
|---|---|
| Service worker: precache, cache-first for site files, never `/api/*` | `port/web/sw.js` (template) |
| Build id, site hash and precache list written into `build/site/sw.js` | `tools/site.sh` |
| Registration, update notice, option "Offline play", `navigator.storage.persist()` | `port/web/main.js` (`offline`, `window.GSOffline`) |
| Web app manifest (standalone, any orientation) + our own drawn icon (a plain sun, no game art) | `port/web/manifest.webmanifest`, `tools/web_icon.py` -> `port/web/icon-192.png`, `icon-512.png`, `apple-touch-icon.png` |
| Online panel says "You are offline: online play needs an internet connection"; Host/Join disabled | `port/web/net.js` (`online`/`offline` events), `index.html` `#net-offline` |
| Test | `tests/web_offline.cjs` (local, and `--live URL`) |

## Design

- **Cache name** `golden-sun-<build>-<site>`: `<build>` is the game build id the link hello uses (`build_id.js`, first
  16 hex of SHA-256 of game.wasm + game.js); `<site>` is a hash of every other site file, so a page-only change is a
  new cache too. Any change gives a new `sw.js` byte-wise, which is how the browser notices a deploy.
- **Precache list**: every file in `build/site` except `sw.js` itself, with the page as `./` (13 files today,
  ~4.4 MB, almost all game.wasm). Fetched with `cache: 'reload'` (bypasses the HTTP cache).
- **Fetch**: same-origin GETs whose path is in the list are answered from the cache (network if missing); a page
  navigation with any query (`?touch=1`, ...) gets the cached page. Everything else, `/api/*` (the room function) and
  e.g. a test's `rom.gba`, goes to the network untouched and is never cached. The worker never sees the ROM: the page
  reads the ROM file locally and keeps it in IndexedDB.
- **Updates**: a new deploy's worker precaches, then calls `skipWaiting()`; on activate it deletes every other
  `golden-sun-*` cache and claims open pages. A page already running keeps what it loaded (the game is loaded whole
  at start); on `controllerchange` (when it already had a controller) it shows the small fixed notice "Update ready
  [Reload]" (top right). The next load runs the new version. Saves are written to IndexedDB as the game saves, so a
  reload loses nothing saved in game.
  - First design (dropped): the new worker waits and the page asks it to `skipWaiting` on the next load before the
    game starts. In headless Chrome the waiting worker never handled that message once the page had run the game (it
    worked in a short run without the game); the CDP trace showed it "running installed" with no event handled. The
    skip-on-install design passed every run.
  - Residual risk: a deploy whose worker finishes installing in the ~0.2 s between a page's first load and its
    `game.js` fetch could give that one page load a new game.js with the old main.js; the link hello would then
    refuse (build id mismatch) and the notice asks for a reload.
- **Option "Offline play"** (page menu, default on because the user asked for it; rule 7): unchecking stores
  `gs-offline=0`, unregisters the worker and deletes its caches; checking removes the key and registers again.
  `?offline=0/1` overrides for tests (not stored). The state shows on its own line under the options
  ("(ready offline)", "(saving for offline...)", "(not available in this browser)"), so its text never moves them.
- **Storage**: `navigator.storage.persist()` when the ROM is stored or booted (Chrome grants it silently by site
  engagement or an installed app; Firefox asks once). Without it the browser may evict the ROM under storage pressure;
  the player then picks the file again.
- **Home screen**: the manifest (`display: standalone`, `start_url: ./`) and icons make the page installable on
  Android/desktop Chrome; iOS uses `apple-touch-icon.png` and `apple-mobile-web-app-capable`. Opened offline it
  starts from the cache like any load.
- Service workers need a secure origin: https (Netlify) or 127.0.0.1 (tests). On plain http elsewhere the option
  shows "(not available in this browser)" and the page works online as before.

## Side fix found by the phone test

The page menu opens on the menu button's `pointerup`; the tap's compatibility `click` then landed on whatever was under
the finger in the menu layout. With the new option row, "GBA screen colours" sat under the button at 412x915 and in
landscape, so opening the menu toggled it (tests/web_phone.cjs failed). `port/web/touch.js` now cancels `touchend`
on the menu and back buttons, which suppresses that click.

## Tests (2026-11-02, muted headless Chrome, one at a time)

`node tests/web_offline.cjs` (phone emulation 390x844, touch), ALL PASS, 0 console errors:
1. online first visit: picker shown; worker installed and controlling, option "(ready offline)"; one cache
   `golden-sun-ef0e81fa8bd5dc64-<site>`; the cache holds exactly sw.js's 13 files; no ROM/save in it; manifest, 2 icons;
2. update: the server switches to site B (another site id, a changed main.js): "Update ready" while A runs; the
   next load runs B; only B's cache is left; notice gone;
3. CDP `Network.emulateNetworkConditions` offline + reload: `navigator.onLine` false; game.js loaded; picker shown;
   the ROM picked with `DOM.setFileInputFiles` boots (300 frames); the panel shows the offline sentence with Host/Join
   disabled; `fetch('api/room')` fails (never cached); 12 responses from the service worker, 0 from elsewhere; the
   local server got only the browser's own `sw.js` update check;
4. offline reload: the saved ROM (IndexedDB) boots (620+ frames); touch pad on; D-pad up by CDP touch -> touch keys 64,
   KEYINPUT 0x3bf; released 0x3ff;
5. option off: no registration, no `golden-sun-*` cache, `gs-offline=0` stored.

Also `tests/web_touch.cjs` ALL PASS, `tests/web_phone.cjs` ALL PASS (after the touch.js fix; it now also checks the
new option is reachable and touch-sized), `tests/web_link.cjs` (see HANDOFF GS-deploy). Live: `node tests/web_offline.cjs
--live https://golden-sun-web-port.netlify.app` runs steps 1, 3 and 4 against the deployed site.
