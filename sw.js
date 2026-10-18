// Service worker: تشغيل أوفلاين + إشعارات الموبايل.
// ملفات التطبيق: network-first — لو النت موجود التحديثات بتظهر على طول (من غير ما حد يمسح بيانات المتصفح)،
// ولو مفيش نت (أو النت بطيء جدًا) التطبيق بيفتح من الكاش.
// سكربتات فايربيز والخطوط والمكتبات (نسخها ثابتة): cache-first.
const APP = 'hdour';
const CACHE = APP + '-shell-v2';
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

// ===== رفع الداتا المتأجلة (حضور / مخدومين جدد اتسجلوا أوفلاين) أول ما النت يرجع — حتى لو التطبيق مقفول =====
// الصفحة بتسيب علامة "فيه كتابة أوفلاين" وبتسجّل Background Sync. لما النت يرجع المتصفح بيصحّي الـ SW هنا،
// وهو بيفتح نفس قاعدة فايرستور المحلية (نفس اسم التطبيق) ويستنى لحد ما كل الكتابات المتأجلة تترفع.
// أمان: لو مش قادر يرفع (مثلاً App Check شغال والـ SW مفيهوش reCAPTCHA) بيطلّع إشعار "افتح البرنامج" بدل ما يحاول ويضيّع كتابات.
// ملحوظة: Background Sync شغال على كروم/إيدج (أندرويد + كمبيوتر) بس — مش على iOS ولا فايرفوكس.
try {
  importScripts(
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js'
  );
} catch (err) { /* مفيش مكتبات فايربيز في الـ SW ده: الرفع في الخلفية بيتحوّل لإشعار بس، والتطبيق نفسه شغال عادي */ }
const SYNC_TAG = 'flush-pending-writes';
const SYNC_FLAG_CACHE = APP + '-sync-flag';
const PUSH_WORKER_URL = 'https://hdour-push.devidemele.workers.dev';
const FB_APP_NAME = 'babyclass-app';
const FB_CFG = { apiKey: "AIzaSyBWK4y1GjEBXMrzgKu3Hm3sSG5sd2ympEI", authDomain: "hdour-d66d8.firebaseapp.com", projectId: "hdour-d66d8", appId: "1:877333539513:web:5e36ff0a09a2924ae64968" };
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
async function hasSyncFlag() { try { return !!(await (await caches.open(SYNC_FLAG_CACHE)).match('./__pending')); } catch (e) { return false; } }
async function clearSyncFlag() { try { await (await caches.open(SYNC_FLAG_CACHE)).delete('./__pending'); } catch (e) {} }
// بيبلّغ الـ Worker (من غير App Check، بتوثيق الـ ID token بس) عشان يبعت للأدمن/المشرف باسم الفصل إن فيه بيانات أوفلاين لسه ماترفعتش
async function tellWorkerPending(token) {
  if (!token) return;
  try {
    await withTimeout(fetch(PUSH_WORKER_URL + '/offline-pending', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}'
    }), 10000, 'worker-timeout');
  } catch (e) {}
}
async function notifyPendingWrites() {
  try {
    await self.registration.showNotification('حضور', {
      body: 'فيه بيانات لسه ماترفعتش. افتح البرنامج والنت شغال عشان تترفع.',
      icon: 'icon-513.png', badge: 'badge-96.png', tag: APP + '-pending-sync', dir: 'rtl', lang: 'ar', data: { url: './' }
    });
  } catch (e) {}
}
// بيرجّع { done:true } لو كل حاجة اترفعت، أو { reason } لو مينفعش يرفع من هنا (مفيش إعادة محاولة)، أو بيرمي error لو المحاولة فشلت مؤقتًا
async function runFlush() {
  if (typeof firebase === 'undefined' || !firebase.firestore || !firebase.auth) return { reason: 'unsupported' };
  const app = firebase.apps.find(a => a.name === FB_APP_NAME) || firebase.initializeApp(FB_CFG, FB_APP_NAME);
  try {
    const unsub = { fn: null };
    const user = await withTimeout(new Promise(res => { unsub.fn = app.auth().onAuthStateChanged(u => res(u)); }), 10000, 'auth-timeout');
    if (unsub.fn) unsub.fn();
    if (!user) return { reason: 'noauth' };
    // فحص قراءة بس (من غير أي كتابة): لو السيرفر رفضها من غير App Check token يبقى الرفع من الـ SW هيتحذف بسبب الرفض، فنبطّل
    const token = await user.getIdToken();
    const probe = await withTimeout(fetch('https://firestore.googleapis.com/v1/projects/' + FB_CFG.projectId + '/databases/(default)/documents/config/meta', { headers: { Authorization: 'Bearer ' + token } }), 15000, 'probe-timeout');
    if (probe.status === 401 || probe.status === 403) return { reason: 'blocked', token };
    if (probe.status >= 500) throw new Error('probe-' + probe.status);
    const db = app.firestore();
    try { await db.enablePersistence({ synchronizeTabs: false }); }
    catch (err) { return { reason: 'persistence', token }; }  // مش قادر يفتح القاعدة المحلية (التطبيق ممكن يكون فاتحها): منكتبش حاجة
    try {
      await withTimeout(db.waitForPendingWrites(), 40000, 'flush-timeout');
      return { done: true };
    } finally {
      try { await db.terminate(); } catch (e) {}
    }
  } finally {
    try { await app.delete(); } catch (e) {}
  }
}
async function flushPending(lastChance) {
  if (!(await hasSyncFlag())) return;
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (wins.some(c => c.url.startsWith(self.registration.scope))) return; // التطبيق مفتوح: هو بيرفع بنفسه
  let res = null;
  try { res = await runFlush(); } catch (err) { console.warn('background flush failed:', err); }
  if (res && res.done) { await clearSyncFlag(); return; }
  if (res && res.reason) { await Promise.all([notifyPendingWrites(), tellWorkerPending(res.token)]); return; } // مينفعش من الـ SW: نبلّغ المستخدم ونوقف
  if (lastChance) { await notifyPendingWrites(); return; }
  throw new Error('flush-failed'); // المتصفح هيعيد المحاولة بعد شوية
}
self.addEventListener('sync', event => {
  if (event.tag === SYNC_TAG) event.waitUntil(flushPending(event.lastChance));
});
