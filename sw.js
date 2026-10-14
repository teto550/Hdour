// Service worker بسيط: وجوده بس هو اللي بيخلّي أندرويد يعتبر الموقع "قابل للتثبيت" ويطلّع زرار التثبيت المباشر.
// مفيش كاش هنا عن قصد، عشان التحديثات (ورفع الملفات الجديدة على GitHub) تظهر على طول من غير ما حد يمسح بيانات المتصفح.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return; // Firebase والخطوط وغيرهم بيعدّوا عادي
  e.respondWith(fetch(req));
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
      body: d.body || '', icon: 'icon-513.png', badge: 'badge-96.png',
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
