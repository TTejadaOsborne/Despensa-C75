const CACHE_NAME = "despensa-v1";
const PRECACHE = ["./", "index.html", "style.css", "app.js", "data.js", "firebase-config.js", "manifest.json", "icon-192.png", "icon-512.png"];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)).catch(() => {})
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // no interceptar Firebase/CDN

  const isImage = /\.(png|jpg|jpeg|svg|webp)$/.test(url.pathname);

  if (isImage) {
    // Cache-first para imágenes
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request).then(resp => {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        return resp;
      }))
    );
  } else {
    // Network-first para HTML/JS/JSON, para no servir versiones antiguas tras un despliegue
    event.respondWith(
      fetch(event.request).then(resp => {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        return resp;
      }).catch(() => caches.match(event.request))
    );
  }
});
