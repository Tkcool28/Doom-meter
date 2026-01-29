// Doomroom News — sw.js (v3.1.5)
// Caches only static assets. Does NOT cache cross-origin API calls.

const CACHE_NAME = "doomroom-v3.1.5";

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/doomroom-192.png",
  "./icons/doomroom-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./icons/favicon-16.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Don’t cache cross-origin (your proxy API is cross-origin)
  if (url.origin !== self.location.origin) return;

  // Network-first for HTML navigation and JS/CSS so updates appear quickly
  if (req.mode === "navigate" || url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./")))
    );
    return;
  }

  // Cache-first for everything else
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
