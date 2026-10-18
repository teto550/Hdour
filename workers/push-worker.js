// push-worker.js — Cloudflare Worker (مجاني) لإشعارات موبايل Hdour
// بيبعت Push (FCM) لموبايلات الأدمن/المشرفين لما:
//   POST /new-request  → خادم جديد سجّل وطلبه pending
//   POST /servant-decision → الأدمن/المشرف قبل أو رفض طلب انضمام (إشعار للخادم نفسه)
//   POST /offline-pending  → بيانات اتسجلت أوفلاين ومترفعتش في الخلفية (إشعار للأدمن/المشرف باسم الفصل)
//   POST /servant-open → خادم معتمد فتح التطبيق (مرة كل 30 دقيقة للخادم الواحد)
//   POST /delete-servant → الأدمن بس: بيمسح إيميل الخادم من Firebase Authentication وحسابه من فايرستور (Admin API من غير Cloud Functions ولا Blaze)
//
// الإعدادات (Workers → Settings → Variables and Secrets):
//   SERVICE_ACCOUNT  (Secret)  محتوى ملف الـ JSON بتاع service account لمشروع hdour-d66d8 كامل
//   ALLOWED_ORIGIN   (Text)    origin موقعك بس، مثال: https://teto550.github.io  (من غير مسار ولا / في الآخر)
//   APP_URL          (Text)    رابط التطبيق اللي هيفتح لما تدوس على الإشعار
//   PROTECTED_EMAILS (Text)    اختياري: إيميلات (بينهم فاصلة) ممنوع الـ Worker يمسحها أبدًا (الأدمن الأساسي)
//
// الأمان: الـ Worker بيتحقق من Firebase ID token (توقيع + aud + iss + exp)، ونص الإشعار بيتبني من فايرستور مش من اللي الموقع بيبعته
// (ما عدا تفاصيل الفصل في /servant-open وبتتقص وبتتبعت للأدمن بس، من خادم معتمد).

const enc = new TextEncoder();

const b64uToBytes = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};
const bytesToB64u = (buf) => {
  let s = '';
  new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const strToB64u = (str) => bytesToB64u(enc.encode(str));
const b64uToJson = (s) => JSON.parse(new TextDecoder().decode(b64uToBytes(s)));

const json = (obj, status, headers) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...headers } });

// ---------- Google OAuth (service account → access token) ----------
let cachedToken = null;
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.value;

  const header = strToB64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = strToB64u(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/identitytoolkit',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey(
    'pkcs8', b64uToBytes(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${claim}`));

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${bytesToB64u(sig)}`,
    }),
  });
  if (!r.ok) throw new Error(`oauth failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  cachedToken = { value: j.access_token, exp: now + (j.expires_in || 3600) };
  return cachedToken.value;
}

// ---------- Firebase ID token verification ----------
async function verifyIdToken(idToken, projectId) {
  const parts = (idToken || '').split('.');
  if (parts.length !== 3) throw new Error('bad token');
  const header = b64uToJson(parts[0]);
  const payload = b64uToJson(parts[1]);
  if (header.alg !== 'RS256') throw new Error('bad alg');

  const jwksRes = await fetch(
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
    { cf: { cacheTtl: 3600, cacheEverything: true } });
  const jwk = (await jwksRes.json()).keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown key');

  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64uToBytes(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));

  const now = Math.floor(Date.now() / 1000);
  if (!ok || payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`
      || payload.exp < now || !payload.sub) throw new Error('invalid token');
  return payload;
}

// ---------- Firestore REST helpers ----------
const fsBase = (pid) => `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents`;
function fv(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fv);
  if ('mapValue' in v) return fvFields(v.mapValue.fields);
  return null;
}
const fvFields = (f = {}) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fv(v)]));
const splitIds = (v) => String(v || '').split(/[,;،]/).map((x) => x.trim()).filter(Boolean);

async function queryServants(pid, jsonH, filters) {
  const r = await fetch(`${fsBase(pid)}:runQuery`, {
    method: 'POST', headers: jsonH,
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'servants' }],
      where: { compositeFilter: { op: 'AND', filters: filters.map(([f, v]) => ({ fieldFilter: { field: { fieldPath: f }, op: 'EQUAL', value: { stringValue: v } } })) } },
    } }),
  });
  const rows = await r.json();
  return (Array.isArray(rows) ? rows : []).filter((x) => x.document).map((x) => fvFields(x.document.fields));
}

async function sendPush(pid, jsonH, tokens, data) {
  const list = [...new Set(tokens)];
  const results = await Promise.allSettled(list.map((t) =>
    fetch(`https://fcm.googleapis.com/v1/projects/${pid}/messages:send`, {
      method: 'POST', headers: jsonH,
      body: JSON.stringify({ message: { token: t, data, webpush: { headers: { Urgency: 'high', TTL: '86400' } } } }),
    }).then((r) => r.status)));
  return { sent: results.filter((r) => r.status === 'fulfilled' && r.value === 200).length, total: list.length };
}
const tokensOf = (users) => users.flatMap((u) => (Array.isArray(u.fcmTokens) ? u.fcmTokens : []));

// أسماء الفصول (من فايرستور) + المستلمين: الأدمن + المشرفين على فصول الخادم
async function classNamesOf(pid, authH, ids) {
  const names = [];
  for (const c of ids.slice(0, 5)) {
    const cr = await fetch(`${fsBase(pid)}/classes/${encodeURIComponent(c)}`, { headers: authH });
    names.push(cr.ok ? (fvFields((await cr.json()).fields).name || c) : c);
  }
  return names;
}
const supervisedIds = (u) => splitIds(u.supervisorClass !== undefined && u.supervisorClass !== null ? u.supervisorClass : u.assignedClass);

export default {
  async fetch(request, env) {
    const allowed = env.ALLOWED_ORIGIN || '';
    const cors = {
      'Access-Control-Allow-Origin': allowed || '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (request.method !== 'POST' || (url.pathname !== '/new-request' && url.pathname !== '/servant-open' && url.pathname !== '/servant-decision' && url.pathname !== '/offline-pending' && url.pathname !== '/delete-servant')) {
      return json({ error: 'not found' }, 404, cors);
    }
    if (allowed && request.headers.get('Origin') !== allowed) return json({ error: 'forbidden' }, 403, cors);

    try {
      const sa = JSON.parse(env.SERVICE_ACCOUNT);
      const pid = sa.project_id;
      const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const { sub: uid } = await verifyIdToken(bearer, pid);

      const at = await getAccessToken(sa);
      const authH = { Authorization: `Bearer ${at}` };
      const jsonH = { ...authH, 'Content-Type': 'application/json' };
      const patch = (fields) => fetch(`${fsBase(pid)}/servants/${uid}?${Object.keys(fields).map((k) => 'updateMask.fieldPaths=' + k).join('&')}`, {
        method: 'PATCH', headers: jsonH, body: JSON.stringify({ fields }),
      });

      const dr = await fetch(`${fsBase(pid)}/servants/${uid}`, { headers: authH });
      if (!dr.ok) return json({ error: 'no servant doc' }, 404, cors);
      const me = fvFields((await dr.json()).fields);

      // ===== طلب انضمام جديد → الأدمن + المشرفين على فصل الطالب =====
      if (url.pathname === '/new-request') {
        if (me.status !== 'pending') return json({ skipped: 'not pending' }, 200, cors);
        if (me.pushNotifiedAt) return json({ skipped: 'already notified' }, 200, cors);
        await patch({ pushNotifiedAt: { timestampValue: new Date().toISOString() } }); // منع التكرار/السبام

        const myClasses = splitIds(me.assignedClass);
        const [admins, sups] = await Promise.all([
          queryServants(pid, jsonH, [['status', 'approved'], ['role', 'admin']]),
          queryServants(pid, jsonH, [['status', 'approved'], ['role', 'supervisor']]),
        ]);
        const mySups = sups.filter((u) => splitIds(u.supervisorClass !== undefined && u.supervisorClass !== null ? u.supervisorClass : u.assignedClass).some((c) => myClasses.includes(c)));

        // أسماء الفصول من فايرستور
        const names = [];
        for (const c of myClasses.slice(0, 5)) {
          const cr = await fetch(`${fsBase(pid)}/classes/${encodeURIComponent(c)}`, { headers: authH });
          names.push(cr.ok ? (fvFields((await cr.json()).fields).name || c) : c);
        }
        const out = await sendPush(pid, jsonH, tokensOf([...admins, ...mySups]), {
          title: '📥 طلب دخول جديد',
          body: `${me.name || 'خادم جديد'} عايز يدخل${names.length ? ' — ' + names.join(' + ') : ''}`,
          url: env.APP_URL || '', tag: `join-${uid}`,
        });
        return json({ ok: true, ...out }, 200, cors);
      }

      // ===== قرار على طلب انضمام (قبول / رفض) → إشعار للخادم نفسه =====
      // بيتبعت من الأدمن/المشرف. النص بيتبني هنا، والحالة في فايرستور لازم تطابق القرار (القبول: approved | الرفض: لسه pending قبل ما يتمسح الحساب).
      if (url.pathname === '/servant-decision') {
        if (me.status !== 'approved' || (me.role !== 'admin' && me.role !== 'supervisor')) return json({ error: 'not allowed' }, 403, cors);
        let body = {}; try { body = await request.json(); } catch (e) {}
        const targetUid = String(body.targetUid || '');
        const decision = body.decision === 'rejected' ? 'rejected' : 'approved';
        if (!/^[A-Za-z0-9]{10,64}$/.test(targetUid) || targetUid === uid) return json({ error: 'bad target' }, 400, cors);
        const tr = await fetch(`${fsBase(pid)}/servants/${targetUid}`, { headers: authH });
        if (!tr.ok) return json({ skipped: 'no target' }, 200, cors);
        const target = fvFields((await tr.json()).fields);
        if (decision === 'approved' && target.status !== 'approved') return json({ skipped: 'not approved' }, 200, cors);
        if (decision === 'rejected' && target.status !== 'pending') return json({ skipped: 'not pending' }, 200, cors);
        if (me.role === 'supervisor') {
          const mine = supervisedIds(me);
          if (!splitIds(target.assignedClass).some((c) => mine.includes(c))) return json({ error: 'not your class' }, 403, cors);
        }
        const out = await sendPush(pid, jsonH, tokensOf([target]), decision === 'approved'
          ? { title: '✅ تم قبولك', body: 'طلب دخولك اتقبل — افتح البرنامج وسجّل دخول', url: env.APP_URL || '', tag: `decision-${targetUid}` }
          : { title: '⛔ تم رفض طلبك', body: 'طلب دخولك اترفض — كلّم المسؤول لو ده حصل غلط', url: env.APP_URL || '', tag: `decision-${targetUid}` });
        return json({ ok: true, ...out }, 200, cors);
      }

      // ===== خادم سجّل بيانات أوفلاين ومقدرش يرفعها في الخلفية → الأدمن + المشرفين على فصله =====
      // بيتبعت من الـ Service Worker لما الرفع التلقائي يتعذّر. مرة كل 30 دقيقة للخادم الواحد.
      if (url.pathname === '/offline-pending') {
        if (me.status !== 'approved') return json({ error: 'not approved' }, 403, cors);
        if (me.role === 'admin') return json({ skipped: 'admin' }, 200, cors);
        const lastOff = me.lastOfflinePushAt ? Date.parse(me.lastOfflinePushAt) : 0;
        if (Date.now() - lastOff < 30 * 60 * 1000) return json({ skipped: 'rate limited' }, 200, cors);
        await patch({ lastOfflinePushAt: { timestampValue: new Date().toISOString() } });
        const myClasses = splitIds(me.assignedClass);
        const [admins, sups] = await Promise.all([
          queryServants(pid, jsonH, [['status', 'approved'], ['role', 'admin']]),
          queryServants(pid, jsonH, [['status', 'approved'], ['role', 'supervisor']]),
        ]);
        const mySups = sups.filter((u) => supervisedIds(u).some((c) => myClasses.includes(c)));
        const names = await classNamesOf(pid, authH, myClasses);
        const out = await sendPush(pid, jsonH, tokensOf([...admins, ...mySups]), {
          title: '📴 بيانات أوفلاين لسه ماترفعتش',
          body: `${me.name || 'خادم'}${names.length ? ' — ' + names.join(' + ') : ''}: محتاج يفتح البرنامج والنت شغال عشان البيانات تترفع`,
          url: env.APP_URL || '', tag: `offline-${uid}`,
        });
        return json({ ok: true, ...out }, 200, cors);
      }

      // ===== حذف خادم نهائيًا: إيميله من Firebase Authentication + مستنده من فايرستور (الأدمن بس) =====
      if (url.pathname === '/delete-servant') {
        if (me.status !== 'approved' || me.role !== 'admin') return json({ error: 'not allowed' }, 403, cors);
        let body = {}; try { body = await request.json(); } catch (e) {}
        const targetUid = String(body.targetUid || '');
        if (!/^[A-Za-z0-9]{10,64}$/.test(targetUid) || targetUid === uid) return json({ error: 'bad target' }, 400, cors);
        const tr = await fetch(`${fsBase(pid)}/servants/${targetUid}`, { headers: authH });
        const target = tr.ok ? fvFields((await tr.json()).fields) : null;
        const protectedList = String(env.PROTECTED_EMAILS || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
        if (target && target.email && protectedList.includes(String(target.email).toLowerCase())) return json({ error: 'protected' }, 403, cors);
        // 1) الإيميل من Authentication (لو مش موجود أصلًا نعتبرها اتمسحت)
        const ar = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${pid}/accounts:delete`, {
          method: 'POST', headers: jsonH, body: JSON.stringify({ localId: targetUid }),
        });
        let authDeleted = ar.ok;
        if (!ar.ok) {
          const t = await ar.text();
          if (/USER_NOT_FOUND/.test(t)) authDeleted = true;
          else return json({ error: 'auth delete failed', status: ar.status, detail: t.slice(0, 300) }, 502, cors);
        }
        // 2) المستند من فايرستور
        const dd = await fetch(`${fsBase(pid)}/servants/${targetUid}`, { method: 'DELETE', headers: authH });
        return json({ ok: true, authDeleted, docDeleted: dd.ok || dd.status === 404 }, 200, cors);
      }

      // ===== خادم فتح التطبيق → الأدمن بس =====
      if (me.status !== 'approved') return json({ error: 'not approved' }, 403, cors);
      if (me.role === 'admin') return json({ skipped: 'admin' }, 200, cors);
      const last = me.lastOpenPushAt ? Date.parse(me.lastOpenPushAt) : 0;
      if (Date.now() - last < 30 * 60 * 1000) return json({ skipped: 'rate limited' }, 200, cors);
      await patch({ lastOpenPushAt: { timestampValue: new Date().toISOString() } });

      let detail = '';
      try { detail = String((await request.json()).detail || '').replace(/\s+/g, ' ').trim().slice(0, 80); } catch (e) {}
      const admins = await queryServants(pid, jsonH, [['status', 'approved'], ['role', 'admin']]);
      const out = await sendPush(pid, jsonH, tokensOf(admins), {
        title: '👤 خادم فتح التطبيق',
        body: `${me.name || 'خادم'}${detail ? ' — ' + detail : ''}`,
        url: env.APP_URL || '', tag: `open-${uid}`,
      });
      return json({ ok: true, ...out }, 200, cors);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 401, cors);
    }
  },
};
