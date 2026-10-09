const CACHE_VERSION = 'admin-v22';
const CACHE_NAME = `app-cache-${CACHE_VERSION}`;
const PRECACHE = ['/sora3a-admin/', '/sora3a-admin/index.html', '/sora3a-admin/manifest.json'];
const RUNTIME_CACHE_PATTERNS = [
  /^https:\/\/www\.gstatic\.com\/firebasejs/,
  /^https:\/\/cdn\.jsdelivr\.net/,
  /^https:\/\/cdnjs\.cloudflare\.com/,
  /^https:\/\/unpkg\.com/,
  /\.(?:js|css|png|jpg|jpeg|svg|woff2|woff|ttf)$/
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;
  if (url.hostname.includes('firebaseio.com') || url.hostname.includes('firebasedatabase.app') ||
      url.hostname.includes('script.google.com') || url.hostname.includes('googleapis.com') ||
      url.hostname.includes('imgbb.com') || url.hostname.includes('ibb.co')) return;
  // موقع سرعة التسويقي ليس جزءاً من التطبيق: نتركه للمتصفح مباشرة
  if (url.pathname.startsWith('/sora3a-admin/site')) return;
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(fetch(new Request(request.url, { cache: 'no-cache', credentials: 'same-origin' })).then(r => {
      // رابط بدون / بالآخر يرجع تحويل — المتصفح يرفض الرد المحوَّل للصفحات، فنعيد التحويل له
      if (r.redirected) return Response.redirect(r.url, 302);
      const clone = r.clone();
      caches.open(CACHE_NAME).then(c => c.put(request, clone)).catch(() => {});
      return r;
    }).catch(() => caches.match(request).then(r => r || caches.match('/sora3a-admin/'))));
    return;
  }
  const shouldCache = RUNTIME_CACHE_PATTERNS.some(p => p.test(url.href));
  if (shouldCache) {
    event.respondWith(caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(r => {
        if (r.ok) { const c = r.clone(); caches.open(CACHE_NAME).then(cc => cc.put(request, c)).catch(() => {}); }
        return r;
      }).catch(() => cached);
    }));
  }
});
