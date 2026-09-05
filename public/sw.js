const CACHE_NAME = 'warehouse-pilot-shell-v3'
const APP_SHELL = [
  './',
  './index.html',
  './favicon.svg',
  './manifest.webmanifest',
  './warehouse-pilot-order.example.json',
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('warehouse-pilot-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  // Identity, catalog, images and work records are never shared through CacheStorage.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cdn-cgi/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && !response.redirected) event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone())))
          return response
        })
        .catch(() => caches.match('./index.html').then((response) => response ?? caches.match('./'))),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
      if (response.ok && !response.redirected) event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone())))
      return response
    })),
  )
})
