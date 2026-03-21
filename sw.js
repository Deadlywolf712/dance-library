const CACHE_NAME = 'dance-library-v2';
const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './data.js',
  './salsa_course.js'
];

// Assets that should use network-first (so updates are always picked up)
const NETWORK_FIRST = ['app.js', 'data.js', 'salsa_course.js'];

// Install — cache the app shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch handler
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Skip video streams — always go to network
  if (url.hostname.includes('b-cdn.net') || url.pathname.endsWith('.m3u8') || url.pathname.endsWith('.ts')) return;

  // Network-first for JS files that change often
  if (NETWORK_FIRST.some(f => url.pathname.endsWith(f))) {
    e.respondWith(
      fetch(e.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for everything else
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        // Cache fonts and CDN assets on first load
        if (response.ok && (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com') || url.hostname.includes('cdn.jsdelivr.net'))) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      });
    }).catch(() => caches.match('./index.html'))
  );
});
