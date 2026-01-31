// Doomroom News — sw.js (v3.3.0)
// Purpose: prevent "stuck on old versions" on GitHub Pages.
// Strategy:
// - Cache ONLY truly-static assets (icons/manifest)
// - NEVER cache app.js or styles.css
// - Network-first for HTML navigations (index.html), fallback offline shell

const CACHE_NAME = "doomroom-static-v3.3.0";

const STATIC_ASSETS = [
  "./manifest.webmanifest",
  "./icons/apple-touch-icon.png",
  "./icons/doomroom-192.png",
  "./icons/doomroom-512.png",
  "./icons/favicon-32.png",
  "./icons/favicon-16.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(STATIC_ASSETS);
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

// Helper: always go to network for these
function isNeverCache(url) {
  const p = url.pathname;
  return p.endsWith("/app.js") || p.endsWith("/styles.css");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never cache JS/CSS — fixes "old version showing"
  if (url.origin === self.location.origin && isNeverCache(url)) {
    event.respondWith(fetch(req, { cache: "no-store" }));
    return;
  }

  // Navigation: network-first, fallback to cached index shell if offline
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        // keep a copy of the shell
        const cache = await caches.open(CACHE_NAME);
        cache.put("./index.html", fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match("./index.html");
        return cached || new Response("Offline.", { status: 503 });
      }
    })());
    return;
  }

  // Cache-first for the tiny truly-static stuff (icons, manifest)
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      const fresh = await fetch(req);
      // Only cache if it’s one of our intended static assets
      if (STATIC_ASSETS.some((a) => url.pathname.endsWith(a.replace("./", "")))) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
      }
      return fresh;
    })());
  }
});
