// Service worker: تشغيل أوفلاين + إشعارات الموبايل.
// ملفات التطبيق: network-first — لو النت موجود التحديثات بتظهر على طول (من غير ما حد يمسح بيانات المتصفح)،
// ولو مفيش نت (أو النت بطيء جدًا) التطبيق بيفتح من الكاش.
// سكربتات فايربيز والخطوط والمكتبات (نسخها ثابتة): cache-first.
const APP = 'hdour';
const CACHE = APP + '-shell-v1';
const CORE = ['./', './index.html', './manifest.json', './icon-193.png', './icon-513.png', './badge-96.png'];
const STATIC_CDN = [
  /^https:\/\/www\.gstatic\.com\/firebasejs\//,
  /^https:\/\/fonts\.googleapis\.com\//,
  /^https:\/\/fonts\.gstatic\.com\//,
  /^https:\/\/cdnjs\.cloudflare\.com\//,
  /^https:\/\/cdn\.jsdelivr\.net\//
];
const isStatic = url => STATIC_CDN.some(rx => rx.test(url));
const inScope = url => url.startsWith(self.registration.scope);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(APP + '-shell-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (isStatic(req.url)) { e.respondWith(cacheFirst(req)); return; }
  if (inScope(req.url)) e.respondWith(networkFirst(req));
  // أي حاجة تانية (طلبات Firestore / Auth وغيرها) بتعدّي عادي
});
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
  return res;
}
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const nav = req.mode === 'navigate';
  const hit = (await cache.match(req, { ignoreSearch: true }))
    || (nav ? ((await cache.match('./index.html')) || (await cache.match('./'))) : undefined);
  const net = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()).catch(() => {}); return res; });
  net.catch(() => {});
  if (!hit) return net;                                   // أول مرة: مفيش كاش، نستنى النت
  const slow = new Promise(r => setTimeout(() => r(null), 4000));
  try { return (await Promise.race([net, slow])) || hit; } // النت بطيء جدًا → من الكاش
  catch (err) { return hit; }                              // مفيش نت → من الكاش
}
// أول جلسة: الصفحة بتبعت قايمة الملفات اللي حمّلتها عشان تتحفظ ويفتح التطبيق أوفلاين من أول مرة
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type !== 'CACHE_URLS' || !Array.isArray(d.urls)) return;
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const u of d.urls) {
      try {
        if (typeof u !== 'string' || !(isStatic(u) || inScope(u))) continue;
        if (await cache.match(u)) continue;
        const res = await fetch(u);
        if (res && res.ok) await cache.put(u, res);
      } catch (err) {}
    }
  })());
});

// ===== PUSH: إشعارات الموبايل (طلبات الانضمام / خادم فتح التطبيق) =====
// الـ Worker بيبعت data-only payload، وإحنا اللي بنعرض الإشعار. لو التطبيق مفتوح قدامك بنسيب التنبيه الداخلي يشتغل.
self.addEventListener('push', event => {
  let d = {};
  try {
    const payload = event.data ? event.data.json() : {};
    d = payload.data || payload.notification || payload;
  } catch (err) { return; }
  if (!d.title && !d.body) return;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some(c => c.visibilityState === 'visible')) return;
    await self.registration.showNotification(d.title || 'حضور', {
      body: d.body || '', icon: 'icon-513.png', image: 'icon-513.png', badge: 'badge-96.png',
      tag: d.tag || 'hdour-push', dir: 'rtl', lang: 'ar', data: { url: d.url || './' }
    });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
    return self.clients.openWindow(target);
  }));
});
