// Service Worker — Despensa PWA v2
//
// Estrategia híbrida:
//  - network-first para HTML/JS/JSON: siempre intenta lo último de la red,
//    cae a caché solo si no hay conexión. Garantiza actualizaciones inmediatas.
//  - cache-first para iconos: rara vez cambian, sirve desde caché para velocidad.
//
// CACHE_NAME versionado: cualquier cache anterior se borra al activar este SW.
// Cambia la versión en cada deploy importante para forzar limpieza.

const CACHE_NAME = 'despensa-v2';
const STATIC_ASSETS = [
  './icon-192.png',
  './icon-512.png',
  './manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
  );
  // Activar inmediatamente sin esperar a que se cierren pestañas viejas
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Cache-first para imágenes/iconos (cambian raramente)
  const isStaticAsset = /\.(png|jpg|jpeg|webp|svg|ico|gif)$/i.test(url.pathname);

  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return resp;
        });
      })
    );
    return;
  }

  // Network-first para todo lo demás (HTML, JS, JSON)
  // Siempre intenta red primero; si falla, sirve desde caché.
  event.respondWith(
    fetch(event.request)
      .then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
