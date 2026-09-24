/* sw.js — offline support.
   App shell: stale-while-revalidate (offline, but self-updates on next load).
   data/ (plans + their index): network-first (see edits fast), precached on install.
   Exercise images: stale-while-revalidate in a version-independent cache. */
const VERSION = "v20";
const SHELL = "shell-" + VERSION;
// Unversioned on purpose: images are immutable and cost megabytes to refetch, so a
// release must not throw them away. Keep this name in step with MEDIA_CACHE in app.js.
const MEDIA = "media";
const SHELL_FILES = [
  "./",
  "index.html",
  "css/styles.css",
  "js/db.js",
  "js/app.js",
  "js/session.js",
  "vendor/js-yaml.min.js",
  "manifest.webmanifest",
  "data/plans.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-180.png",
];

// data/plans.json is the plan index (see app.js). Precache every plan it lists so a
// plan works offline before it has ever been opened. Best-effort: a plan that fails
// to fetch must not fail the whole install.
async function cachePlans(c) {
  try {
    const res = await c.match("data/plans.json");
    if (!res) return;
    const list = await res.json();
    await Promise.all(
      list.map((p) => (p && p.file ? c.add("data/" + p.file).catch(() => {}) : null))
    );
  } catch {}
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then(async (c) => { await c.addAll(SHELL_FILES); await cachePlans(c); })
      .then(() => self.skipWaiting())
  );
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

  // Plans (.yml, any host) and the plan index: network-first so edits show up; fall
  // back to cache (ignoreSearch so it matches even with a query string present).
  if (url.pathname.endsWith(".yml") || url.pathname.endsWith("/plans.json")) {
    e.respondWith(
      fetch(req).then((res) => { const cp = res.clone(); caches.open(SHELL).then((c) => c.put(req, cp)); return res; })
        .catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  // Exercise images and gifs (external): stale-while-revalidate. Cache opaque
  // responses too so no-cors images still work offline after first view. Matched by
  // extension OR by destination, so an <img> on a URL without one still counts.
  const isImage = /\.(jpg|jpeg|png|gif|webp|avif)$/i.test(url.pathname) || req.destination === "image";
  if (isImage && url.origin !== self.location.origin) {
    e.respondWith(
      caches.open(MEDIA).then(async (c) => {
        const hit = await c.match(req);
        // An opaque cached response returned to a cors-mode request becomes a network
        // error, so ignore a stale opaque entry for cors requests and refetch.
        const good = hit && !(req.mode === "cors" && hit.type === "opaque") ? hit : null;
        const net = fetch(req).then((res) => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => hit);
        return good || net;
      })
    );
    return;
  }

  // App shell + same-origin: stale-while-revalidate — serve cache fast, refresh in
  // background so a pushed fix lands on the next load without bumping VERSION.
  // A navigation that misses both falls back to the shell, so launching offline on
  // any in-scope URL still opens the app.
  e.respondWith(
    caches.open(SHELL).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || (await net) || (req.mode === "navigate" ? c.match("index.html") : undefined);
    })
  );
});
