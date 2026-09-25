/* Service worker for Gacha Stamina Calculator PWA.
   Network-first with a short timeout, falling back to the cache: online users
   always get the latest files (so there is no version to bump on deploy), and
   offline or on a stalled connection the cached app still opens.
   Bump CACHE_VERSION only when SHELL or the caching strategy changes. */
const CACHE_PREFIX = 'gacha-stamina-';
const CACHE_VERSION = 'v3';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const NETWORK_TIMEOUT_MS = 3000;

// Paths are relative to the service worker's location so the app works whether
// it is hosted at the domain root or under a sub-path (GitHub Pages).
// Required: without these the app cannot start offline, so install fails.
const SHELL = [
  './',
  './app.js',
  './stamina.js',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
];
// Nice to have: a missing icon must not block an update.
const OPTIONAL = [
  './icons/favicon-16.png',
  './icons/favicon-32.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

// Every navigation is served from, and stored under, the app's root URL, so
// `?utm=…` links don't each grow the cache with a copy of the page.
const SHELL_URL = new URL('./', self.registration.scope).href;

const fresh = (url) => new Request(url, { cache: 'reload' });

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL.map(fresh));
    await Promise.allSettled(OPTIONAL.map((url) => cache.add(fresh(url))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Only our own old caches: other apps on this origin (every GitHub Pages
    // repo of the same user) keep theirs.
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET; let the browser deal with everything else.
  if (request.method !== 'GET') return;

  // Leave other origins alone entirely — the app has no third-party assets.
  if (new URL(request.url).origin !== self.location.origin) return;

  const key = request.mode === 'navigate' ? SHELL_URL : request;

  // Only successful responses are cached: a cached 404 or 502 would otherwise
  // be served for as long as the version lasts, and browsers refuse to use a
  // redirected response for a navigation. The write is registered with
  // waitUntil up front so it survives the timeout path below. `no-cache`
  // revalidates with the server (a cheap 304 when unchanged) instead of
  // trusting a possibly stale HTTP-cache copy.
  const network = fetch(request, { cache: 'no-cache' }).then((response) => {
    const saved = response.ok && !response.redirected
      ? caches.open(CACHE_NAME).then((cache) => cache.put(key, response.clone()))
      : null;
    return { response, saved };
  });
  event.waitUntil(network.then(({ saved }) => saved).catch(() => {}));

  event.respondWith((async () => {
    try {
      const timeout = new Promise((_, reject) => setTimeout(reject, NETWORK_TIMEOUT_MS));
      const { response } = await Promise.race([network, timeout]);
      if (response.ok) return response;
      return (await caches.match(key)) ?? response;
    } catch {
      // Offline or too slow: use the cache, or keep waiting if there is none.
      return (await caches.match(key)) ?? (await network).response;
    }
  })());
});

// Focus the app, or open it, when a "stamina full" notification is clicked.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = windows.find((client) => client.url.startsWith(self.registration.scope));
    return app ? app.focus() : self.clients.openWindow(SHELL_URL);
  })());
});
