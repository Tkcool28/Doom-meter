// Doomroom News — sw.js (v3.1.6)
//
// Goal:
// - Cache static assets (index/app/styles/icons) for fast loads + offline shell
// - NEVER cache news/API responses (so you don't get "stuck" on old headlines)
// - Network-first for navigation + app.js so updates show up quickly

const CACHE_NAME = "doomroom-static-v3.1.6";

// Only static site assets go here (safe to cache)
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/apple-touch-icon.png",
  "./icons/doomroom-192.png",
  "./icons/doomroom-512.png",
  "./icons/favicon-32.png",
  "./icons/favicon-16.png",
];

// Change this if your proxy host changes
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

  // Only handle GET
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // ✅ 1) NEVER cache cross-origin requests (including your proxy/news fetches)
  if (url.origin !== self.location.origin) {
    // If it's your news proxy, force true network (no cache).
    if (url.hostname === PROXY_HOST) {
      event.respondWith(fetch(req, { cache: "no-store" }));
      return;
    }
    // For any other cross-origin request, just pass-through.
    return;
  }

  // ✅ 2) For navigation (loading the page), use network-first,
  //    fall back to cached index.html if offline.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          const cache = await caches.open(CACHE_NAME);
          cache.put("./index.html", fresh.clone());
          return fresh;
        } catch (e) {
          const cached = await caches.match("./index.html");
          return cached || new Response("Offline.", { status: 503 });
        }
      })()
    );
    return;
  }

  // ✅ 3) For app.js + styles.css: network-first so updates land quickly,
  //    cache as fallback.
  if (url.pathname.endsWith("/app.js") || url.pathname.endsWith("/styles.css")) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
          return fresh;
        } catch (e) {
          return (await caches.match(req)) || fetch(req);
        }
      })()
    );
    return;
  }

  // ✅ 4) Everything else on-origin: cache-first (icons, manifest, etc.)
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      const fresh = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, fresh.clone());
      return fresh;
    })()
  );
});
