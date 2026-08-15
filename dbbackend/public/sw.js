// Dalia Bassel Couture — service worker: network-first shell, cache-first images
const CACHE = 'dalia-v25';
const IMG_CACHE = 'dalia-img'; // uploaded files have immutable names -> safe to cache forever
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/admin.js', '/portal.js', '/manifest.json', '/icon.svg'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k !== CACHE && k !== IMG_CACHE).map((k) => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api')) return;
  // uploaded images/videos: cache-first (immutable filenames) — instant after first load
  if (url.pathname.startsWith('/uploads')) {
    e.respondWith(caches.open(IMG_CACHE).then((c) => c.match(e.request).then((hit) =>
      hit || fetch(e.request).then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; }).catch(() => hit)
    )));
    return;
  }
  // app shell: network-first, fall back to cache
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('/index.html')))
  );
});
