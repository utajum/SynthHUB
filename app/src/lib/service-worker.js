// SynthHub service worker. Network first: online users always get the
// current deploy, the cache is only an offline fallback. /sw.js is built per
// deploy (pages/sw.js.ts puts the build id in CACHE), so each deploy installs
// a new worker that takes over at once and deletes the older caches.
// /api/* is never cached.
const CACHE = 'synthhub-__BUILD__';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add('/'))
      .catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          event.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
        }
        return res;
      })
      .catch(async () => {
        const nav = req.mode === 'navigate';
        // the host redirects /about to /about/, so the page is cached there
        const slash = nav && !url.pathname.endsWith('/');
        return (
          (await caches.match(req)) ||
          (slash && (await caches.match(url.pathname + '/'))) ||
          (nav && (await caches.match('/'))) ||
          Response.error()
        );
      }),
  );
});
