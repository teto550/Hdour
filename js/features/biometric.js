// الدخول بالبصمة (WebAuthn كبوابة محلية على الجهاز)
import { S } from '../core/state.js';
import { EmailAuthProvider, auth, reauthenticateWithCredential, signInWithEmailAndPassword } from '../core/firebase.js';

// ===== الدخول بالبصمة (WebAuthn كبوابة محلية على الجهاز) =====
// ملحوظة: مفاتيحنا مسمّاة 'bc_*' عشان الدومين teto550.github.io مشترك بين كل تطبيقاتك
const BIO_LS = 'bc_bio_v1', BIO_DECLINED = 'bc_bio_declined';

const BIO_DB = 'bc-bio-keys', BIO_STORE = 'keys', BIO_KEY_ID = 'k1';

const bioB64 = {
  enc: b => btoa(String.fromCharCode(...new Uint8Array(b))),
  dec: s => Uint8Array.from(atob(s), c => c.charCodeAt(0))
};

function bioIdb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(BIO_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(BIO_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function bioIdbGet(k) {
  const db0 = await bioIdb();
  return new Promise((res, rej) => { const q = db0.transaction(BIO_STORE).objectStore(BIO_STORE).get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}

async function bioIdbSet(k, v) {
  const db0 = await bioIdb();
  return new Promise((res, rej) => { const t = db0.transaction(BIO_STORE, 'readwrite'); t.objectStore(BIO_STORE).put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

async function bioIdbDel(k) {
  const db0 = await bioIdb();
  return new Promise((res, rej) => { const t = db0.transaction(BIO_STORE, 'readwrite'); t.objectStore(BIO_STORE).delete(k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

async function bioSupported() {
  try { return !!(window.PublicKeyCredential && window.isSecureContext && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
  catch { return false; }
}

function bioData() { try { return JSON.parse(localStorage.getItem(BIO_LS) || 'null'); } catch { return null; } }

async function bioDisable() {
  localStorage.removeItem(BIO_LS);
  try { await bioIdbDel(BIO_KEY_ID); } catch {}
  refreshBioLoginButton();
}

// بيسجّل البصمة ويحفظ الإيميل والباسورد مشفّرين بمفتاح غير قابل للتصدير (non-extractable)
async function bioEnroll(email, pass) {
  await navigator.credentials.create({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { name: 'خدمة ابتدائي', id: location.hostname },
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name: email, displayName: email },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
    timeout: 60000, attestation: 'none'
  }}).then(async cred => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ e: email, p: pass })));
    await bioIdbSet(BIO_KEY_ID, key);
    localStorage.setItem(BIO_LS, JSON.stringify({ credId: bioB64.enc(cred.rawId), email, iv: bioB64.enc(iv), ct: bioB64.enc(ct) }));
  });
  localStorage.removeItem(BIO_DECLINED);
}

// بيطلب البصمة، ولو نجحت بيفك التشفير ويرجّع الإيميل والباسورد
async function bioUnlock() {
  const d = bioData();
  if (!d) throw new Error('no-bio');
  await navigator.credentials.get({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rpId: location.hostname,
    allowCredentials: [{ type: 'public-key', id: bioB64.dec(d.credId), transports: ['internal'] }],
    userVerification: 'required', timeout: 60000
  }});
  const key = await bioIdbGet(BIO_KEY_ID);
  if (!key) throw new Error('no-key');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bioB64.dec(d.iv) }, key, bioB64.dec(d.ct));
  const o = JSON.parse(new TextDecoder().decode(plain));
  return { email: o.e, pass: o.p };
}

export async function refreshBioLoginButton() {
  const btn = document.getElementById('bio-login-btn');
  if (!btn) return;
  btn.style.display = (bioData() && await bioSupported()) ? 'block' : 'none';
}

window.doBioLogin = async () => {
  const err = document.getElementById('login-error');
  const btn = document.getElementById('bio-login-btn');
  err.style.display = 'none';
  let creds;
  try { creds = await bioUnlock(); }
  catch (e) {
    if (e && (e.message === 'no-key' || e.message === 'no-bio' || e.name === 'OperationError')) {
      await bioDisable();
      err.textContent = 'البصمة محتاجة تتفعّل تاني — ادخل بالإيميل والباسورد وفعّلها من «ملفي»';
    } else {
      err.textContent = 'اتلغت البصمة أو معرفناش نتعرف عليها، حاول تاني أو ادخل بالإيميل';
    }
    err.style.display = 'block';
    return;
  }
  btn.disabled = true;
  S.explicitAuthAction = true;
  try { await signInWithEmailAndPassword(auth, creds.email, creds.pass); }
  catch {
    S.explicitAuthAction = false;
    // غالبًا الباسورد اتغيّر — نمسح البصمة القديمة عشان متفضلش بتفشل
    await bioDisable();
    err.textContent = 'كلمة المرور اتغيّرت — ادخل بالإيميل والباسورد وفعّل البصمة من جديد';
    err.style.display = 'block';
  }
  btn.disabled = false;
};

// عرض تفعيل البصمة بعد أول دخول بالإيميل والباسورد
export async function maybeOfferBio() {
  const c = S.pendingBioCreds; S.pendingBioCreds = null;
  if (!c || !(await bioSupported())) return;
  const d = bioData();
  if (d && d.email === c.email) return;                    // مفعّلة أصلاً لنفس الحساب
  if (!d && localStorage.getItem(BIO_DECLINED) === '1') return; // رفض قبل كده
  window._bioOfferCreds = c;
  document.getElementById('bio-offer-modal').style.display = 'block';
}

window.acceptBioOffer = async () => {
  const c = window._bioOfferCreds; window._bioOfferCreds = null;
  document.getElementById('bio-offer-modal').style.display = 'none';
  if (!c) return;
  try { await bioEnroll(c.email, c.pass); showToast('اتفعّلت البصمة ✅', 'success'); }
  catch (e) { console.error('bio enroll:', e); showToast('معرفناش نفعّل البصمة', 'error'); }
};

window.declineBioOffer = () => {
  window._bioOfferCreds = null;
  localStorage.setItem(BIO_DECLINED, '1');
  document.getElementById('bio-offer-modal').style.display = 'none';
};

// قسم «الدخول بالبصمة» جوه الإعدادات (ملفي)
export async function refreshBioSettings() {
  const sec = document.getElementById('settings-bio-section');
  if (!sec) return;
  if (!(await bioSupported())) { sec.style.display = 'none'; return; }
  sec.style.display = 'block';
  const d = bioData(), mine = d && d.email === S.currentEmail;
  document.getElementById('settings-bio-status').textContent = mine
    ? 'البصمة مفعّلة على الموبايل ده ✅ تقدر تدخل بيها من شاشة الدخول.'
    : (d ? 'البصمة مفعّلة على الموبايل ده لحساب تاني. لو فعّلتها هنا هتتبدّل.' : 'ادخل ببصمة صباعك بدل الإيميل والباسورد على الموبايل ده.');
  document.getElementById('settings-bio-btn').textContent = mine ? '🗑 إلغاء البصمة' : '🖐 تفعيل البصمة';
  document.getElementById('settings-bio-pass-wrap').style.display = 'none';
  document.getElementById('settings-bio-pass').value = '';
  window._bioSettingsStep = mine ? 'off' : 'ask';
}

window.toggleBioFromSettings = async () => {
  const step = window._bioSettingsStep;
  if (step === 'off') { await bioDisable(); showToast('اتلغت البصمة', 'info'); refreshBioSettings(); return; }
  const wrap = document.getElementById('settings-bio-pass-wrap');
  if (step === 'ask') {
    wrap.style.display = 'block';
    document.getElementById('settings-bio-btn').textContent = '✔ تأكيد وتفعيل';
    document.getElementById('settings-bio-pass').focus();
    window._bioSettingsStep = 'confirm';
    return;
  }
  // confirm: نتأكد من الباسورد الأول، وبعدين نسجّل البصمة
  const pass = document.getElementById('settings-bio-pass').value;
  if (!pass) { showToast('اكتب كلمة المرور', 'error'); return; }
  try {
    await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(S.currentEmail, pass));
  } catch { showToast('كلمة المرور غلط', 'error'); return; }
  try { await bioEnroll(S.currentEmail, pass); showToast('اتفعّلت البصمة ✅', 'success'); }
  catch (e) { console.error('bio enroll:', e); showToast('معرفناش نفعّل البصمة', 'error'); }
  refreshBioSettings();
};
