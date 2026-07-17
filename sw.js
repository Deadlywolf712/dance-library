// Resilient offline shell for Dance Library.
// Navigations use network-first; static assets use stale-while-revalidate.

const CACHE_VERSION = 11;
const CACHE_PREFIX = 'dance-library-v';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

const APP_FILES = [
  './',
  './index.html',
  './style.css?v=11',
  './app.js?v=11',
  './data.js?v=11',
  './salsa_course.js?v=11',
  './playback-core.js?v=11',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isMedia = request.destination === 'video'
    || request.destination === 'audio'
    || /\.(m3u8|ts|mp4|mov|m4v)(?:$|\?)/i.test(url.pathname)
    || url.hostname.includes('b-cdn.net');

  // Media can be very large and must never be cached or replaced with app HTML.
  if (isMedia) return;

  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') {
      event.respondWith((async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response.clone());
          }
          return response;
        } catch (_) {
          return (await caches.match(request))
            || (await caches.match('./index.html'))
            || new Response('Dance Library is unavailable offline.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }
      })());
      return;
    }

    const refresh = fetch(request).then(async response => {
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    });
    event.waitUntil(refresh.catch(() => undefined));
    event.respondWith(
      caches.match(request).then(cached => cached || refresh).catch(() =>
        new Response('This asset is unavailable offline.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        })
      )
    );
    return;
  }

  const refresh = fetch(request).then(async response => {
    if (response.ok || response.type === 'opaque') {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  });
  event.waitUntil(refresh.catch(() => undefined));
  event.respondWith(
    caches.match(request)
      .then(cached => cached || refresh)
      .catch(() => Response.error())
  );
});

self.addEventListener('message', event => {
  if (event.data !== 'CLEAR_CACHE') return;

  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith(CACHE_PREFIX)).map(key => caches.delete(key))
      ))
      .then(() => caches.open(CACHE_NAME))
      .then(cache => cache.addAll(APP_FILES))
  );
});
