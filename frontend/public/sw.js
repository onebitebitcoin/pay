const VERSION = 'v1.0.0';
const APP_CACHE = `app-cache-${VERSION}`;
const RUNTIME_CACHE = 'runtime-cache';

const APP_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => (k !== APP_CACHE && k !== RUNTIME_CACHE ? caches.delete(k) : null)))).then(() => self.clients.claim())
  );
});

// Network-first for API; Cache-first for static assets; SPA navigation fallback to index.html
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin
  if (url.origin !== location.origin) return;

  // SPA navigation fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.open(APP_CACHE).then((cache) => cache.match('/index.html')))
    );
    return;
  }

  // API requests
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Static assets: cache-first
  if (request.method === 'GET') {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((resp) => {
        const clone = resp.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
        return resp;
      }))
    );
  }
});

