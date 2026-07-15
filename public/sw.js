// Service Worker for GRN Fleet Management System
// Network-first for authenticated data, cache-first for static assets

var CACHE_NAME = 'grn-fleet-v1';
var STATIC_CACHE = 'grn-fleet-static-v1';

var STATIC_ASSETS = [
  '/',
  '/dashboard',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

// Install event: cache static shell
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then(function(cache) { return cache.addAll(STATIC_ASSETS); })
      .then(function() { return self.skipWaiting(); })
  );
});

// Activate event: clean old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches
      .keys()
      .then(function(names) {
        return Promise.all(
          names
            .filter(function(name) { return name !== STATIC_CACHE && name !== CACHE_NAME; })
            .map(function(name) { return caches.delete(name); })
        );
      })
      .then(function() { return self.clients.claim(); })
  );
});

// Fetch event: network-first for API/data, cache-first for static
self.addEventListener('fetch', function(event) {
  var request = event.request;
  var url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // API routes: network-first with timeout
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithTimeout(request, 5000));
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

  // Page navigations: network-first
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Everything else: network-first
  event.respondWith(networkFirst(request));
});

function networkFirst(request) {
  return fetch(request)
    .then(function(response) {
      if (response.ok) {
        return caches.open(CACHE_NAME).then(function(cache) {
          cache.put(request, response.clone());
          return response;
        });
      }
      return response;
    })
    .catch(function() {
      return caches.match(request).then(function(cached) {
        return cached || new Response('Offline', { status: 503 });
      });
    });
}

function networkFirstWithTimeout(request, timeoutMs) {
  var timeoutPromise = new Promise(function(_, reject) {
    setTimeout(function() { reject(new Error('Network timeout')); }, timeoutMs);
  });

  return Promise.race([fetch(request), timeoutPromise])
    .then(function(response) {
      if (response instanceof Response && response.ok) {
        return caches.open(CACHE_NAME).then(function(cache) {
          cache.put(request, response.clone());
          return response;
        });
      }
      return response;
    })
    .catch(function() {
      return caches.match(request).then(function(cached) {
        return cached || new Response(JSON.stringify({ error: 'Offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      });
    });
}

function cacheFirst(request) {
  return caches.match(request)
    .then(function(cached) {
      if (cached) return cached;
      return fetch(request).then(function(response) {
        if (response.ok) {
          return caches.open(STATIC_CACHE).then(function(cache) {
            cache.put(request, response.clone());
            return response;
          });
        }
        return response;
      });
    })
    .catch(function() {
      return new Response('Not found', { status: 404 });
    });
}
