/* Service Worker — حضور (Baby Class)
 * بيخلي الموقع يفتح أوفلاين: بيحفظ ملفات الموقع نفسه + مكتبات Firebase/XLSX/jsQR + خط Cairo.
 * ملحوظة: بيانات Firestore نفسها بتتخزن في IndexedDB من الكود اللي في index.html، مش هنا.
 * لما تغيّر في الملفات وعايز كل الأجهزة تنزّلها من جديد: غيّر VERSION.
 */
const VERSION = 'hdour-v1';
const SHELL = VERSION + '-shell'; // ملفات الموقع (بتتحدّث من النت كل ما يكون فيه اتصال)
const LIBS  = VERSION + '-libs';  // مكتبات ونسخ ثابتة من CDN (cache-first)

const SHELL_FILES = ['./index.html', './manifest.json', './icon-193.png'];
const FIREBASE_BASE = 'https://www.gstatic.com/firebasejs/10.12.2/';
const FIREBASE_ENTRY = ['app', 'auth', 'firestore', 'app-check'].map(n => FIREBASE_BASE + 'firebase-' + n + '.js');
const CDN_FILES = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js'
];
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap';
const CDN_HOSTS = new Set([
  'cdnjs.cloudflare.com', 'cdn.jsdelivr.net',
  'fonts.googleapis.com', 'fonts.gstatic.com'
]);
// gstatic بنمسك منه مكتبات Firebase بس (مش سكربتات reCAPTCHA)
const isCdn = url => CDN_HOSTS.has(url.hostname) ||
  (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'));

// ===== تحميل مسبق (best-effort: أي ملف يفشل مايوقفش التثبيت) =====
async function cacheOne(cache, url) {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (res.ok) await cache.put(url, res.clone());
    return res.ok ? res : null;
  } catch (_) { return null; }
}

// وحدات Firebase بتستورد وحدات تانية (firebase-app.js وغيره) — بنلاقيها من نص الملف ونحفظها كلها
async function cacheModuleTree(cache, url, seen) {
  if (seen.has(url)) return;
  seen.add(url);
  const res = await cacheOne(cache, url);
  if (!res) return;
  const src = await res.clone().text();
  const re = /(?:\bfrom|\bimport)\s*["']([^"']+\.js)["']/g;
  const deps = [];
  let m;
  while ((m = re.exec(src))) {
    try {
      const abs = new URL(m[1], url).href;
      if (abs.startsWith(FIREBASE_BASE)) deps.push(abs);
    } catch (_) {}
  }
  await Promise.all(deps.map(d => cacheModuleTree(cache, d, seen)));
}

async function cacheFontCss(cache) {
  const res = await cacheOne(cache, FONT_CSS);
  if (!res) return;
  const css = await res.clone().text();
  const urls = [...new Set([...css.matchAll(/url\(([^)]+)\)/g)].map(m => m[1].replace(/["']/g, '')))];
  await Promise.all(urls.map(u => cacheOne(cache, u)));
}

async function precache() {
  const shell = await caches.open(SHELL);
  const libs  = await caches.open(LIBS);
  await Promise.all([
    ...SHELL_FILES.map(async f => {
      try { const r = await fetch(f, { cache: 'reload' }); if (r.ok) await shell.put(f, r); } catch (_) {}
    }),
    ...CDN_FILES.map(u => cacheOne(libs, u)),
    (async () => { const seen = new Set(); await Promise.all(FIREBASE_ENTRY.map(u => cacheModuleTree(libs, u, seen))); })(),
    cacheFontCss(libs)
  ]);
}

self.addEventListener('install', event => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, LIBS]);
    const names = await caches.keys();
    await Promise.all(names.filter(n => !keep.has(n)).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

// ===== استراتيجيات الرد =====
const MATCH = { ignoreVary: true };

// صفحة الموقع: النت الأول (عشان التحديثات توصل)، ولو النت ضعيف/مقطوع بعد ٣.٥ ثانية نفتح النسخة المحفوظة
async function networkFirst(event, req, key) {
  const cache = await caches.open(SHELL);
  const fromNetwork = fetch(req).then(async res => {
    if (res.ok) await cache.put(key, res.clone());
    return res;
  });
  event.waitUntil(fromNetwork.catch(() => {}));
  try {
    return await Promise.race([
      fromNetwork,
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 3500))
    ]);
  } catch (_) {
    const cached = await cache.match(key, MATCH);
    return cached || fromNetwork;
  }
}

// ملفات الموقع التانية (أيقونات، manifest…): نرد من المحفوظ فورًا ونحدّث في الخلفية
async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(req, MATCH);
  const refresh = fetch(req).then(async res => {
    if (res.ok) await cache.put(req, res.clone());
    return res;
  });
  event.waitUntil(refresh.catch(() => {}));
  return cached || refresh;
}

// مكتبات CDN بنسخ ثابتة وخطوط: من المحفوظ الأول، ولو مش موجود نجيبه ونحفظه
async function cacheFirst(event, req) {
  const cache = await caches.open(LIBS);
  const cached = await cache.match(req, MATCH);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') event.waitUntil(cache.put(req, res.clone()).catch(() => {}));
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      const isIndex = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
      event.respondWith(networkFirst(event, req, isIndex ? './index.html' : req));
    } else {
      event.respondWith(staleWhileRevalidate(event, req));
    }
    return;
  }

  // Firestore / Auth / reCAPTCHA / واتساب / QR وغيرهم: بنسيبهم يعدّوا عادي من غير تدخل
  if (isCdn(url)) {
    event.respondWith(cacheFirst(event, req));
  }
});
