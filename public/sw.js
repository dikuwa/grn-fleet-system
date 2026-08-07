// Service Worker for GRN Fleet Management System
// Network-first for authenticated data, cache-first for static assets

var CACHE_NAME = 'grn-fleet-v2';
var STATIC_CACHE = 'grn-fleet-static-v2';

var STATIC_ASSETS = ['/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

// Install event: cache static shell
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then(function (cache) {
        return cache.addAll(STATIC_ASSETS);
      })
      .then(function () {
        return self.skipWaiting();
      }),
  );
});

// Activate event: clean old caches
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names
            .filter(function (name) {
              return name !== STATIC_CACHE && name !== CACHE_NAME;
            })
            .map(function (name) {
              return caches.delete(name);
            }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
});

// Fetch event: never cache authenticated or dynamic responses. Caching these
// responses by URL can expose one signed-in user's data to the next user of the
// same browser. Only immutable public assets are safe to share across sessions.
self.addEventListener('fetch', function (event) {
  var request = event.request;
  var url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // API routes can contain user-scoped data and must always come from the network.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Next.js static assets: cache-first
  if (
    url.pathname.startsWith('/_next/static') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json'
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Page navigations can contain server-rendered user-scoped data. Do not place
  // them in a cache shared by consecutive sessions.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request));
    return;
  }

  // Everything else: network-first
  event.respondWith(networkFirst(request));
});

function networkFirst(request) {
  return fetch(request)
    .then(function (response) {
      if (response.ok) {
        return caches.open(CACHE_NAME).then(function (cache) {
          cache.put(request, response.clone());
          return response;
        });
      }
      return response;
    })
    .catch(function () {
      return caches.match(request).then(function (cached) {
        return cached || new Response('Offline', { status: 503 });
      });
    });
}

function cacheFirst(request) {
  return caches
    .match(request)
    .then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response.ok) {
          return caches.open(STATIC_CACHE).then(function (cache) {
            cache.put(request, response.clone());
            return response;
          });
        }
        return response;
      });
    })
    .catch(function () {
      return new Response('Not found', { status: 404 });
    });
}
