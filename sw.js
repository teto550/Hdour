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
