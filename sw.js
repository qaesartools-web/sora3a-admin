// Service Worker - sora3a-admin only
const CACHE = 'sora3a-admin-v2';
const SCOPE = '/sora3a-admin/';

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll([SCOPE])));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => 
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Only handle requests within sora3a-admin scope
  if (!e.request.url.includes('/sora3a-admin/')) {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
