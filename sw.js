/* Service worker for Gacha Stamina Calculator PWA.
   Provides offline support and installability across Apple, Android and Windows.
   Bump CACHE_VERSION whenever the precached assets change. */
const CACHE_VERSION = 'v1';
const CACHE_NAME = `gacha-stamina-${CACHE_VERSION}`;
const RUNTIME_CACHE = `gacha-stamina-runtime-${CACHE_VERSION}`;

// App shell — paths are relative to the service worker's location so the app
// works whether it is hosted at the domain root or under a sub-path (GitHub Pages).
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/favicon-16.png',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // addAll is atomic; ignore failures on optional cross-navigations by
      // caching each entry individually so one 404 doesn't abort install.
      .then((cache) => Promise.allSettled(
        PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' })))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET; let the browser deal with everything else.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Navigations: network-first, fall back to the cached app shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Google Fonts (stylesheet + font files): stale-while-revalidate.
  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const network = fetch(request)
            .then((response) => {
              if (response && (response.ok || response.type === 'opaque')) {
                cache.put(request, response.clone());
              }
              return response;
            })
            .catch(() => cached);
          return cached || network;
        })
      )
    );
    return;
  }

  // Same-origin static assets: cache-first, then network (and cache the result).
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
  }
});
