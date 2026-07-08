/* sw.js — offline support.
   App shell: cache-first.  workout.yml: network-first (see edits fast).
   Exercise images: stale-while-revalidate (offline after first view). */
const VERSION = "v1";
const SHELL = "shell-" + VERSION;
const MEDIA = "media-" + VERSION;
const SHELL_FILES = [
  "./",
  "index.html",
  "css/styles.css",
  "js/db.js",
  "js/app.js",
  "vendor/js-yaml.min.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-180.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![SHELL, MEDIA].includes(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Plan file: always try network first so edits show up; fall back to cache.
  if (url.pathname.endsWith("workout.yml") || url.pathname.endsWith(".yml")) {
    e.respondWith(
      fetch(req).then((res) => { const cp = res.clone(); caches.open(SHELL).then((c) => c.put(req, cp)); return res; })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Exercise images (external): stale-while-revalidate.
  if (/\.(jpg|jpeg|png|gif|webp)$/i.test(url.pathname) && url.origin !== self.location.origin) {
    e.respondWith(
      caches.open(MEDIA).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  // App shell + same-origin: cache-first.
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
