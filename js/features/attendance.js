// تسجيل الحضور + فلتر التسميع + الآيات (VERSE)
import { S } from '../core/state.js';
import { addDoc, collection, db, deleteDoc, doc, onSnapshot, query, serverTimestamp, where, writeBatch } from '../core/firebase.js';
import { idbGet, idbSet } from '../core/idb-cache.js';
import { countSnapshotReads, countedGetDocs } from '../core/reads-counter.js';
import { logActivity } from './auth.js';
import { readScopeClasses } from './classes.js';
import { VERSE_CLOSED_MSG, toLocalDateKey, todayKey, verseKey, verseOpen } from './settings.js';
import { renderTodayList, updateStats } from './today-list.js';
import { tsToMillis } from '../lib/utils.js';

// ===== ATTENDANCE =====

// تاريخ بيتحسب "جلسة" لو فيه حضور فعلي مسجّل فيه بس (مفتاح النهارده الفاضي كان بيخلي الكل غايب/الفلتر يتلخبط)
export function attSessionDates() { return Object.keys(S.allAttendance).filter(d => S.allAttendance[d] && Object.keys(S.allAttendance[d]).length).sort(); }

// آخر مرة حضور النهارده اتزامن فيها مع السيرفر — لو عدّى أكتر من دقيقتين ومفيش بث لحظي شغال بنجدّده (قراءة حضور النهارده بس)
let todayAttSyncAt = 0;

const ATT_TTL = 2 * 60 * 1000;

export const attIsStale = () => !S.todayAttendanceUnsub && (Date.now() - todayAttSyncAt) > ATT_TTL;

async function refreshTodayAttendanceIfStale() {
  if (!attIsStale()) return;
  const today = todayKey();
  const snap = await countedGetDocs(todayQuery('attendance', today), 'attendance (اليوم - تجديد للفلاتر)');
  const prev = S.allAttendance[today] || {}, fresh = {};
  snap.docs.forEach(d => { fresh[d.data().studentId] = d.id; });
  for (const id in prev) if (outsideAllowed(id) && !fresh[id]) fresh[id] = prev[id];
  if (Object.keys(fresh).length) S.allAttendance[today] = fresh; else delete S.allAttendance[today];
  todayAttSyncAt = Date.now();
}

export const filterWeeks = () => Math.max(parseInt(S.absenceFilter)||0, parseInt(S.attendanceFilter)||0, parseInt(S.waAbsenceFilter)||0, parseInt(S.waAttendanceFilter)||0) + 2;

const ATT_CACHE_KEY = 'att_recent_cache_v1';

// الاستدعاءات بتتنفذ ورا بعض (مش بالتوازي) عشان تبويب الافتقاد والرسائل ميتخانقوش على allAttendance
let attLoadP = Promise.resolve();

export function ensureRecentAttendance(weeks) {
  const run = attLoadP.catch(() => {}).then(() => _ensureRecentAttendance(weeks));
  attLoadP = run;
  return run;
}

let recentAttScope = null;

async function _ensureRecentAttendance(weeks) {
  weeks = Math.max(weeks || 4, 4);
  { const k = readScopeClasses().join(','); if (recentAttScope !== null && recentAttScope !== k) S.recentAttWeeks = 0; recentAttScope = k; }
  if (S.recentAttWeeks >= weeks) { await refreshTodayAttendanceIfStale(); return; }
  const d = new Date(); d.setDate(d.getDate() - weeks*7);
  const fromKey = toLocalDateKey(d), nowKey = todayKey();
  // الأسابيع اللي فاتت مبتتغيّرش، فبنخزّنها على الجهاز ونقرا من آخر جلسة اتزامنت بس (جلسة النهارده تقريبًا)
  // بدل ما نقرا كل الأسابيع من فايرستور في كل فتحة. وبنعمل تحميل كامل تاني كل 7 أيام للأمان.
  const scopeKey0 = readScopeClasses().join(',');
  let c = null; try { c = JSON.parse((await idbGet(ATT_CACHE_KEY + '@' + scopeKey0)) || 'null'); } catch(e) {}
  const scope = readScopeClasses(), scopeKey = scope.join(',');
  const fresh = !!(c && c.data && c.from && c.from <= fromKey && c.through && (c.scope || '') === scopeKey && (Date.now() - (c.fullTs || 0)) < 7*24*3600*1000);
  const data = fresh ? c.data : {};
  const qFrom = fresh ? c.through : fromKey;
  let snap, usedKey = scopeKey;
  try {
    snap = await countedGetDocs(scope.length ? query(collection(db,'attendance'), where('date','>=', qFrom), where('classSection','in', scope)) : query(collection(db,'attendance'), where('date','>=', qFrom)), 'attendance (نطاق زمني)');
  } catch(e) {
    // الـ index المركب (classSection + date) لسه مش متعمل: بنرجع للقراءة القديمة ولينك إنشاء الـ index بيظهر في الـ console
    if (!scope.length) throw e;
    console.warn('أنشئ index مركب لـ attendance (classSection + date):', e && e.message);
    snap = await countedGetDocs(query(collection(db,'attendance'), where('date','>=', qFrom)), 'attendance (نطاق زمني - بدون index)'); usedKey = '';
  }
  for (const k of Object.keys(data)) if (k >= qFrom) delete data[k]; // الأيام اللي هنقراها تاني بتتستبدل بالكامل (لو حد اتشال حضوره)
  snap.docs.forEach(x => { const v = x.data(); if (!data[v.date]) data[v.date] = {}; data[v.date][v.studentId] = x.id; });
  for (const k in data) {
    if (k < fromKey) continue; // بنضيف للذاكرة الفترة المطلوبة بس زي الأول بالظبط (عدّاد الحضور في الفلتر بيعتمد عليها)
    if (k === nowKey && S.todayAttendanceUnsub) continue; // البث اللحظي أحدث من القراءة دي
    S.allAttendance[k] = { ...data[k] }; // استبدال كامل (مش دمج) عشان أي حضور اتشال ميفضلش ظاهر
  }
  todayAttSyncAt = Date.now();
  idbSet(ATT_CACHE_KEY + '@' + scopeKey0, JSON.stringify({ from: fresh ? c.from : fromKey, through: nowKey, fullTs: fresh ? c.fullTs : Date.now(), scope: usedKey, data }));
  S.recentAttWeeks = weeks;
}

export const studentHist = {};

export async function loadStudentHist(id) {
  const [a, v] = await Promise.all([
    countedGetDocs(query(collection(db,'attendance'), where('studentId','==',id)), 'attendance (بروفايل مخدوم)'),
    countedGetDocs(query(collection(db,'verses'), where('studentId','==',id)), 'verses (بروفايل مخدوم)')]);
  const H = { att:{}, ver:{}, ts: Date.now() };
  a.docs.forEach(x => { H.att[x.data().date] = x.id; });
  v.docs.forEach(x => { const y = x.data(); H.ver[y.date] = { id:x.id, verse:y.verse||'' }; });
  studentHist[id] = H;
}

async function loadAllAttendance() {
  const snap = await countedGetDocs(collection(db,'attendance'), 'attendance (الكل - غير مستخدمة)');
  S.allAttendance = {}; S.todayAttendance = {}; S.todayAttendanceTime = {};
  const today = todayKey();
  snap.docs.forEach(d => {
    const data = d.data();
    if (!S.allAttendance[data.date]) S.allAttendance[data.date] = {};
    S.allAttendance[data.date][data.studentId] = d.id;
    if (data.date === today) { S.todayAttendance[data.studentId] = d.id; S.todayAttendanceTime[data.studentId] = tsToMillis(data.timestamp); }
  });
  updateStats();
}

// حضور النهارده بس، بث لحظي: لما خادم يسجل أو يشيل حضور، كل الخدام التانيين
// الفاتحين الموقع في نفس اللحظة يشوفوا التحديث فوراً من غير reload
export const clsOf = id => (S.allStudents.find(x => x.id === id)?.classSection) || '';

// الخادم المقيّد بفصول بيسمع حضور وآيات فصوله بس (مش كل الفصول) عشان الـ reads متزيدش مع زيادة الفصول
function todayQuery(col, today) {
  const al = readScopeClasses();
  const f = [where('date','==', today)];
  if (al.length) f.push(where('classSection','in', al));
  return query(collection(db,col), ...f);
}

// تسجيلات الخادم لمخدومين من فصول تانية مش داخلة في الاستعلام، فبنحتفظ بيها محليًا عشان متختفيش من الشاشة
const outsideAllowed = id => { const al = readScopeClasses(); return al.length > 0 && !al.includes(clsOf(id)); };

export function restartTodayListeners() {
  if (S.todayAttendanceUnsub) { S.todayAttendanceUnsub(); S.todayAttendanceUnsub = null; }
  if (S.todayVersesUnsub) { S.todayVersesUnsub(); S.todayVersesUnsub = null; }
  startTodayListeners();
}

// نقل صامت لمرة واحدة: آيات الأربع 30/09 كانت متحفظة على تاريخ الأربع، ودلوقتي بتتحسب على حضور الأسبوع اللي فات (خميس 24/09)
async function migrateLegacyVerses() {
  if (!localStorage.getItem('vmig_0930')) try {
    const snap = await countedGetDocs(query(collection(db,'verses'), where('date','==','2026-09-30')), 'verses (نقل تاريخ قديم - مرة واحدة)');
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const b = writeBatch(db);
      docs.slice(i, i + 400).forEach(d => b.update(d.ref, { date: '2026-09-24', classSection: d.data().classSection ?? clsOf(d.data().studentId) }));
      await b.commit();
    }
    localStorage.setItem('vmig_0930', '1');
  } catch(e) { console.error(e); }
  // آيات الأربع 23/09 → خميس 17/09 (حضور أسبوعها). اللي ليه آية متسجلة أصلًا على 17/09 بنسيب آيته زي ما هي عشان ميتكررش
  if (localStorage.getItem('vmig_0923b')) return;
  try {
    const [s23, s17] = await Promise.all([
      countedGetDocs(query(collection(db,'verses'), where('date','==','2026-09-23')), 'verses (نقل تاريخ قديم 23/09 - مرة واحدة)'),
      countedGetDocs(query(collection(db,'verses'), where('date','==','2026-09-17')), 'verses (نقل تاريخ قديم 17/09 - مرة واحدة)')
    ]);
    const had = new Set(s17.docs.map(d => d.data().studentId));
    const docs = s23.docs.filter(d => !had.has(d.data().studentId));
    for (let i = 0; i < docs.length; i += 400) {
      const b = writeBatch(db);
      docs.slice(i, i + 400).forEach(d => b.update(d.ref, { date: '2026-09-17', classSection: d.data().classSection ?? clsOf(d.data().studentId) }));
      await b.commit();
    }
    localStorage.setItem('vmig_0923b', '1');
  } catch(e) { console.error(e); }
}

export function startTodayListeners() {
  if (!S.todayAttendanceUnsub) listenTodayAttendance();
  if (!S.todayVersesUnsub) migrateLegacyVerses().then(() => { if (!S.todayVersesUnsub) listenTodayVerses(); });
}

export function stopTodayListeners() {
  if (S.todayAttendanceUnsub) { S.todayAttendanceUnsub(); S.todayAttendanceUnsub = null; todayAttSyncAt = Date.now(); }
  if (S.todayVersesUnsub)     { S.todayVersesUnsub();     S.todayVersesUnsub     = null; }
}

let attListenKey = null;

function listenTodayAttendance() {
  if (S.todayAttendanceUnsub) { S.todayAttendanceUnsub(); S.todayAttendanceUnsub = null; }
  const today = todayKey();
  attListenKey = today;
  S.todayAttendanceUnsub = onSnapshot(
    todayQuery('attendance', today),
    snap => {
      countSnapshotReads('attendance (اليوم - live)', snap);
      const prevA = S.todayAttendance, prevAT = S.todayAttendanceTime;
      S.todayAttendance = {}; S.todayAttendanceTime = {};
      snap.docs.forEach(d => { S.todayAttendance[d.data().studentId] = d.id; S.todayAttendanceTime[d.data().studentId] = tsToMillis(d.data().timestamp); });
      for (const id in prevA) if (outsideAllowed(id) && !S.todayAttendance[id]) { S.todayAttendance[id] = prevA[id]; S.todayAttendanceTime[id] = prevAT[id]; }
      if (!S.allAttendance[today]) S.allAttendance[today] = {};
      S.allAttendance[today] = { ...S.todayAttendance };
      updateStats();
      renderTodayList();
      if (typeof onManualSearch === 'function') onManualSearch();
    },
    err => console.error('today attendance listener error:', err)
  );
}

// حضور... يعني سماع الآية النهارده، بث لحظي بنفس فكرة الحضور بالظبط: أي خادم يسجل سماع لمخدوم،
// كل الخدام التانيين الفاتحين نفس الفصل في نفس اللحظة يشوفوا التحديث فورًا من غير ما يعملوا reload
let verseListenKey = null;

function listenTodayVerses() {
  if (S.todayVersesUnsub) { S.todayVersesUnsub(); S.todayVersesUnsub = null; }
  const today = verseKey();
  verseListenKey = today;
  S.todayVersesUnsub = onSnapshot(
    todayQuery('verses', today),
    snap => {
      countSnapshotReads('verses (اليوم - live)', snap);
      const prevV = S.todayVerses, prevVT = S.todayVerseTime;
      S.todayVerses = {}; S.todayVerseTime = {};
      snap.docs.forEach(d => {
        const data = d.data();
        S.todayVerses[data.studentId] = { id: d.id, verse: data.verse || '' };
        S.todayVerseTime[data.studentId] = tsToMillis(data.timestamp);
      });
      for (const id in prevV) if (outsideAllowed(id) && !S.todayVerses[id]) { S.todayVerses[id] = prevV[id]; S.todayVerseTime[id] = prevVT[id]; }
      if (!S.allVerses[today]) S.allVerses[today] = {};
      S.allVerses[today] = { ...S.todayVerses };
      renderTodayList();
      if (typeof onManualSearch === 'function') onManualSearch();
    },
    err => console.error('today verses listener error:', err)
  );
}

// ===== فلتر التسميع في الافتقاد: بنحمّل آيات آخر كام أسبوع (بنفس فكرة تحميل الحضور) =====
let recentVerseSyncAt = 0;
let verseLoadP = Promise.resolve();

export const verseFilterWeeks = () => (parseInt(S.verseFilter) || 0) + 2;

export const verseIsStale = () => !S.todayVersesUnsub && (Date.now() - recentVerseSyncAt) > ATT_TTL;

// التاريخ بيتحسب "مرة" لو فيه سماع فعلي مسجّل فيه بس
// جلسات التسميع الحقيقية بس: تاريخها لازم يكون يوم خميس (verseKey دايمًا خميس). أي تاريخ تاني (زي 23/09 من النقل القديم) بقايا مش جلسة
const isThursdayKey = k => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d).getDay() === 4; };

// الأسبوع الجاري (verseKey) لسه ناقص لحد الجمعة بالليل، فمبنحسبوش جلسة في الفلتر عشان ميبقاش شرط "سمع كل المرات" مستحيل
export function verseSessionDates() { const cur = verseKey(); return Object.keys(S.allVerses).filter(d => d !== cur && isThursdayKey(d) && S.allVerses[d] && Object.keys(S.allVerses[d]).length).sort(); }

export function ensureRecentVerses(weeks) {
  const run = verseLoadP.catch(() => {}).then(() => _ensureRecentVerses(weeks));
  verseLoadP = run;
  return run;
}

const VERSE_CACHE_KEY = 'verse_recent_cache_v2'; // v2: الكاش القديم كان ممكن يفضل ناقص آيات اتنقلت/اتصلّحت بعد ما اتخزن

// نفس فكرة الحضور: القراءة محصورة في فصل الخادم، والأسابيع اللي فاتت متخزنة على الجهاز، وبنقرا من آخر مزامنة بس
async function _ensureRecentVerses(weeks) {
  weeks = Math.max(weeks || 4, 4);
  const scope = readScopeClasses(), scopeKey = scope.join(',');
  if (S.recentVerseScope !== null && S.recentVerseScope !== scopeKey) S.recentVerseWeeks = 0;
  S.recentVerseScope = scopeKey;
  if (S.recentVerseWeeks >= weeks && !verseIsStale()) return;
  const d = new Date(); d.setDate(d.getDate() - weeks * 7);
  const fromKey = toLocalDateKey(d), nowKey = verseKey();
  const liveToday = !!S.todayVersesUnsub; // البث اللحظي لأسبوع التسميع الحالي أحدث من أي قراءة
  // تصليح لمرة واحدة على الجهاز: آيات قديمة اتسجلت من غير فصل فكانت مش بتظهر في استعلام الفصل
  if (!localStorage.getItem('vbf_cls1') && S.allStudents.length) {
    try {
      const all = await countedGetDocs(query(collection(db,'verses'), where('date','>=', fromKey)), 'verses (تصليح فصل الآيات - مرة واحدة)');
      const miss = all.docs.filter(x => !x.data().classSection && clsOf(x.data().studentId));
      for (let i = 0; i < miss.length; i += 400) {
        const bt = writeBatch(db);
        miss.slice(i, i + 400).forEach(x => bt.update(x.ref, { classSection: clsOf(x.data().studentId) }));
        await bt.commit();
      }
      localStorage.setItem('vbf_cls1', '1');
    } catch(e) { console.warn('verse classSection backfill failed', e); }
  }
  let c = null; try { c = JSON.parse((await idbGet(VERSE_CACHE_KEY + '@' + scopeKey)) || 'null'); } catch(e) {}
  const forceFull = S.verseForceFull; S.verseForceFull = false;
  const fresh = !forceFull && !!(c && c.data && c.from && c.from <= fromKey && c.through && (c.scope || '') === scopeKey && (Date.now() - (c.fullTs || 0)) < 7*24*3600*1000);
  const data = fresh ? c.data : {};
  const qFrom = fresh ? c.through : fromKey;
  const cons = [where('date','>=', qFrom)];
  if (liveToday) cons.push(where('date','<', nowKey)); // أسبوع التسميع الحالي جاي من البث اللحظي، مفيش داعي نقراه تاني
  let snap = null, usedKey = scopeKey;
  if (!(liveToday && qFrom >= nowKey)) {
    try {
      snap = await countedGetDocs(scope.length ? query(collection(db,'verses'), ...cons, where('classSection','in', scope)) : query(collection(db,'verses'), ...cons), 'verses (نطاق زمني - فلتر الافتقاد)');
    } catch(e) {
      if (!scope.length) throw e;
      console.warn('أنشئ index مركب لـ verses (classSection + date):', e && e.message);
      snap = await countedGetDocs(query(collection(db,'verses'), ...cons), 'verses (نطاق زمني - بدون index)'); usedKey = '';
    }
  }
  if (snap) {
    for (const k of Object.keys(data)) if (k >= qFrom) delete data[k];
    snap.docs.forEach(x => {
      const v = x.data();
      if (usedKey === '' && scope.length && !scope.includes(v.classSection || clsOf(v.studentId))) return;
      if (!data[v.date]) data[v.date] = {};
      data[v.date][v.studentId] = { id: x.id, verse: v.verse || '' };
    });
  }
  for (const k in data) {
    if (k < fromKey) continue;
    if (liveToday && k === nowKey) continue;
    S.allVerses[k] = { ...data[k] };
  }
  for (const k of Object.keys(S.allVerses)) if (k >= fromKey && !(liveToday && k === nowKey) && !data[k]) delete S.allVerses[k];
  recentVerseSyncAt = Date.now();
  S.recentVerseWeeks = weeks;
  idbSet(VERSE_CACHE_KEY + '@' + scopeKey, JSON.stringify({ from: fresh ? c.from : fromKey, through: nowKey, fullTs: fresh ? c.fullTs : Date.now(), scope: usedKey, data }));
}

// لو الموقع فاضل مفتوح عدّى سبت: بنصفّر قايمة التسميع ونسمع على أسبوع التسميع الجديد
setInterval(() => {
  if (S.todayAttendanceUnsub && attListenKey && todayKey() !== attListenKey) {
    S.todayAttendance = {}; S.todayAttendanceTime = {};
    listenTodayAttendance();
    updateStats(); renderTodayList();
  }
  if (S.todayVersesUnsub && verseListenKey && verseKey() !== verseListenKey) {
    S.todayVerses = {}; S.todayVerseTime = {};
    listenTodayVerses();
    renderTodayList();
  }
}, 60 * 1000);

async function loadAllVerses() {
  const snap = await countedGetDocs(collection(db,'verses'), 'verses (الكل - غير مستخدمة)');
  S.allVerses = {}; S.todayVerses = {}; S.todayVerseTime = {};
  const today = todayKey();
  snap.docs.forEach(d => {
    const data = d.data();
    if (!S.allVerses[data.date]) S.allVerses[data.date] = {};
    S.allVerses[data.date][data.studentId] = { id: d.id, verse: data.verse || '' };
    if (data.date === today) { S.todayVerses[data.studentId] = { id: d.id, verse: data.verse || '' }; S.todayVerseTime[data.studentId] = tsToMillis(data.timestamp); }
  });
}

export async function markPresent(studentId) {
  if (S.todayAttendance[studentId]) return false;
  const ref = await addDoc(collection(db,'attendance'), { studentId, date:todayKey(), classSection: clsOf(studentId), timestamp:serverTimestamp() });
  S.todayAttendance[studentId] = ref.id;
  S.todayAttendanceTime[studentId] = Date.now();
  if (!S.allAttendance[todayKey()]) S.allAttendance[todayKey()] = {};
  S.allAttendance[todayKey()][studentId] = ref.id;
  updateStats(); renderTodayList();
  return true;
}

// ===== VERSE (independent from attendance) =====
window.showVerseModal = async function(studentId) {
  if (!verseOpen()) { showToast(VERSE_CLOSED_MSG, 'error'); return; }
  const today = verseKey();
  if (S.todayVerses[studentId]) return; // already marked
  try {
    const ref = await addDoc(collection(db,'verses'), { studentId, date: today, verse: '', classSection: clsOf(studentId), timestamp: serverTimestamp() });
    S.todayVerses[studentId] = { id: ref.id, verse: '' };
    S.todayVerseTime[studentId] = Date.now();
    if (!S.allVerses[today]) S.allVerses[today] = {};
    S.allVerses[today][studentId] = { id: ref.id, verse: '' };
    renderTodayList();
    onManualSearch();
    showToast('✅ تم تسجيل السماع', 'success');
    navigator.vibrate?.([60,30,60]);
    const s = S.allStudents.find(x => x.id === studentId);
    logActivity('تسجيل سماع آية', s?.name || '');
  } catch(e) {
    showToast('خطأ في الحفظ', 'error');
  }
};

window.removeVerse = async (studentId) => {
  const entry = S.todayVerses[studentId];
  if (!entry) return;
  if (!confirm('هتشيل السماع؟')) return;
  await deleteDoc(doc(db,'verses',entry.id));
  delete S.todayVerses[studentId];
  delete S.todayVerseTime[studentId];
  const today = verseKey();
  if (S.allVerses[today]) delete S.allVerses[today][studentId];
  renderTodayList();
  onManualSearch();
  showToast('تم حذف السماع', 'success');
};

window.removeAttendance = async (studentId) => {
  const s = S.allStudents.find(x => x.id === studentId);
  if (!confirm(`هتشيل حضور "${s?.name}" من النهارده؟`)) return;
  const docId = S.todayAttendance[studentId];
  if (docId) await deleteDoc(doc(db,'attendance',docId));
  delete S.todayAttendance[studentId];
  delete S.todayAttendanceTime[studentId];
  if (S.allAttendance[todayKey()]) delete S.allAttendance[todayKey()][studentId];
  updateStats(); renderTodayList();
  onManualSearch();
  showToast('تم حذف الحضور', 'success');
};
