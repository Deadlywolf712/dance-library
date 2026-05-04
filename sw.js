// Self-healing service worker for Dance Masterclass Library
// Strategy: network-first for app files, cache as offline fallback only
// Cache busts automatically when this file changes (new deployment)

const CACHE_VERSION = 4;
const CACHE_NAME = `dance-library-v${CACHE_VERSION}`;

// App shell files — cached on install for offline fallback
const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './data.js',
  './salsa_course.js'
];

// ── Install: cache app shell, immediately take over ──
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: delete ALL old caches, claim all tabs ──
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: network-first for everything, cache as fallback ──
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Skip video streams entirely — never cache, never intercept
  if (url.hostname.includes('b-cdn.net') || url.pathname.endsWith('.m3u8') || url.pathname.endsWith('.ts') || url.pathname.endsWith('.mp4') || url.pathname.endsWith('.mov')) return;

  // Network-first for ALL app files (HTML, CSS, JS)
  // This ensures updates are always picked up immediately
  // Cache is ONLY used when offline
  const isAppFile = url.origin === location.origin;

  if (isAppFile) {
    e.respondWith(
      fetch(e.request).then(response => {
        // Got fresh response — update cache
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline — serve from cache
        return caches.match(e.request).then(cached => {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // External resources (fonts, hls.js CDN) — cache on first success, serve from cache after
  e.respondWith(
    caches.match(e.request).then(cached => {
      // Return cached immediately but also refresh in background
      const fetchPromise = fetch(e.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => null);

      // If cached, return it immediately (stale-while-revalidate)
      // If not cached, wait for network
      return cached || fetchPromise;
    })
  );
});

// ── Message handler: allow page to force cache clear ──
self.addEventListener('message', (e) => {
  if (e.data === 'CLEAR_CACHE') {
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => {
      // Re-cache fresh app shell
      caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES));
    });
  }
});
