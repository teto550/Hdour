// كاش كبير على الجهاز (IndexedDB) للمخدومين وغيرهم

// ===== كاش كبير على الجهاز (IndexedDB) =====
// localStorage حجمه حوالي 5MB بس، والمخدومين بصورهم (base64 جوه المستند) بيعدّوه بسرعة، فالحفظ كان بيفشل بصمت
// وكل خادم كان بيقرا كل المخدومين من فايرستور في كل فتحة. IndexedDB مساحته أكبر بكتير.
const _idbP = (() => {
  try {
    return new Promise((res, rej) => {
      const r = indexedDB.open('stmina-cache', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  } catch(e) { return Promise.reject(e); }
})();

_idbP.catch(() => {});

export async function idbGet(key) {
  try {
    const idb = await _idbP;
    return await new Promise((res, rej) => {
      const q = idb.transaction('kv').objectStore('kv').get(key);
      q.onsuccess = () => res(q.result ?? null);
      q.onerror = () => rej(q.error);
    });
  } catch(e) { return null; }
}

export async function idbSet(key, val) {
  try {
    const idb = await _idbP;
    await new Promise((res, rej) => {
      const tx = idb.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
    return true;
  } catch(e) { return false; }
}

// توحيد النصوص العربية للبحث: يشيل التشكيل، الحروف الخفية (من إكسل)، ويوحّد أشكال الحروف المتشابهة
export function normalizeArabic(str) {
  return (str || '')
    .toString()
    .normalize('NFKC')
    .replace(/\u200B/g, ' ')
    .replace(/[\u200C-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00AD]/g, '')
    .replace(/[\u064B-\u065F\u0610-\u061A\u06D6-\u06ED\u0670\u0640]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[\u00A0\s]+/g, ' ')
    .trim()
    .toLowerCase();
}

// توحيد دائم لشكل الاسم قبل التخزين: أ/إ/آ ← ا (وأمثالها) عشان البحث يبقى بسيط ومضمون
export function canonicalizeName(str) {
  return (str || '')
    .toString()
    .normalize('NFKC')
    .replace(/\u200B/g, ' ')
    .replace(/[\u200C-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00AD]/g, '')
    .replace(/[\u064B-\u065F\u0610-\u061A\u06D6-\u06ED\u0670\u0640]/g, '')
    .replace(/[إأآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[\u00A0\s]+/g, ' ')
    .trim();
}
