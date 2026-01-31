// Doomroom News — sw.js (v3.2.8)
//
// Phone-proof updating:
// - Cache only safe static assets for offline shell
// - Network-first for app.js and styles.css (so updates actually land)
// - Never cache cross-origin (proxy/news) responses
// - Bump CACHE_NAME to kill old caches

const CACHE_NAME = "doomroom-static-v3.2.8";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/apple-touch-icon.png",
  "./icons/doomroom-192.png",
  "./icons/doomroom-512.png",
  "./icons/favicon-32.png",
  "./icons/favicon-16.png",
];

const PROXY_HOST = "doom-proxy.toddkirschman.workers.dev";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never cache cross-origin (including proxy/news)
  if (url.origin !== self.location.origin) {
    if (url.hostname === PROXY_HOST) {
      event.respondWith(fetch(req, { cache: "no-store" }));
    }
    return;
  }

  // Navigation: network-first, fallback to cached index
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          const cache = await caches.open(CACHE_NAME);
          cache.put("./index.html", fresh.clone());
          return fresh;
        } catch {
          return (await caches.match("./index.html")) || new Response("Offline.", { status: 503 });
        }
      })()
    );
    return;
  }

  // app.js + styles.css: network-first always
  if (url.pathname.endsWith("/app.js") || url.pathname.endsWith("/styles.css")) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          return (await caches.match(req)) || fetch(req);
        }
      })()
    );
    return;
  }

  // Everything else on-origin: cache-first
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      const fresh = await fetch(req, { cache: "no-store" });
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, fresh.clone());
      return fresh;
    })()
  );
});
