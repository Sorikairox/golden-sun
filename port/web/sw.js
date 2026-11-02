// Offline play (GS-deploy, docs/OFFLINE.md): a service worker that keeps the whole site in one cache so the page
// works with no network once it has been loaded. tools/site.sh fills in the three values below for each site
// build: the game build id (the link hello's, build_id.js), a hash of every site file, and the file list. The
// cache name holds both ids, so a new deploy installs a fresh cache and the old one is deleted on activate.
// - install: precache every site file (bypassing the HTTP cache), then take over at once (skipWaiting); activate
//   deletes the old cache and claims open pages. A page already running keeps the files it loaded (the whole game
//   is loaded at start); main.js then shows "Update ready, Reload" and the next load runs the new version. (A
//   waiting worker activated by a message from the page proved unreliable in headless Chrome: docs/OFFLINE.md.)
// - fetch: cache-first for the site files only; a page navigation is answered with the cached page (any query);
//   /api/* (the room function) and every other URL go to the network untouched and are never cached (the ROM
//   and saves live in IndexedDB, never here);
'use strict';
const BUILD = '__GS_BUILD__';
const SITE = '__GS_SITE__';
const FILES = ['__GS_FILES__'];
const PREFIX = 'golden-sun-';
const CACHE = PREFIX + BUILD + '-' + SITE;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const scopePath = () => new URL(self.registration.scope).pathname;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const base = scopePath();
  if (!url.pathname.startsWith(base)) return;
  let rel = url.pathname.slice(base.length);
  if (rel.startsWith('api/')) return;              // the room server: always the network
  if (req.mode === 'navigate' || rel === '' || rel === 'index.html') rel = './';
  if (!FILES.includes(rel)) return;                // not a site file (e.g. a test ROM URL): network, not cached
  e.respondWith((async () => {
    const hit = await caches.match(rel, { cacheName: CACHE });
    if (hit) return hit.redirected ? new Response(hit.body, { status: hit.status, headers: hit.headers }) : hit;
    return fetch(req);
  })());
});
