// عدّاد قراءات Firestore (لقياس التكلفة) — اكتب __reads في الكونسول
import { getDocs } from './firebase.js';

// ===== عدّاد القراءات (reads) — لقياس تكلفة فايرستور فعليًا =====
// كل مستند بييجي من السيرفر بيتحسب read واحد؛ اللي بييجي من الكاش المحلي (persistentLocalCache) مجاني ومش بيتحسب.
// افتح الـ console واكتب __reads عشان تشوف الإجمالي وتفصيل كل مصدر، أو __reads.reset() تصفّره وتاخد قياس لسيناريو معين لوحده.
window.__reads = {
  total: 0,
  byLabel: {},
  reset() { this.total = 0; this.byLabel = {}; console.log('تم تصفير عداد القراءات'); }
};

function countReads(label, n) {
  if (!n) return;
  window.__reads.total += n;
  window.__reads.byLabel[label] = (window.__reads.byLabel[label] || 0) + n;
  console.debug(`📊 [reads] +${n} ${label} (إجمالي ${window.__reads.total})`);
}

// بديل getDocs بيحسب القراءة الفعلية بس لو جايه من السيرفر (مش من الكاش المحلي)
export async function countedGetDocs(q, label) {
  const snap = await getDocs(q);
  if (!(snap.metadata && snap.metadata.fromCache)) countReads(label, snap.docs.length);
  return snap;
}

// بتتنادى جوه أي onSnapshot عشان تحسب أول نتيجة + أي تغيير جديد يوصل بعد كده (مش كل المستندات تاني كل مرة)
export function countSnapshotReads(label, snap) {
  if (snap.metadata && snap.metadata.fromCache) return;
  const n = snap.docChanges ? Math.max(snap.docChanges().length, snap.docs?.length ? 0 : 1) || snap.docChanges().length : (snap.docs?.length || 1);
  countReads(label, n || 1);
}

// زي اللي فوق بس لمستند واحد (onSnapshot(doc(...))) مش استعلام على مجموعة كاملة
export function countDocSnapshotReads(label, snap) {
  if (snap.metadata && snap.metadata.fromCache) return;
  if (snap.exists && snap.exists()) countReads(label, 1);
}
