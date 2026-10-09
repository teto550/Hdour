// قايمة اليوم (فلتر وترتيب) + البحث اليدوي
import { S } from '../core/state.js';
import { db, doc, serverTimestamp, updateDoc } from '../core/firebase.js';
import { normalizeArabic } from '../core/idb-cache.js';
import { markPresent } from './attendance.js';
import { logActivity } from './auth.js';
import { babyKgClasses, classBadgeHTML, classLabel, classPickButtonsHTML, classScope, studentAvatarHTML } from './classes.js';
import { bumpStudentsRev, renderStudentsList } from './students.js';
import { searchStudents } from '../lib/arabic-match.js';

let todayListFilter = 'all'; // 'all' | 'attendance' | 'verse'
let todayListSortOrder = 'first'; // 'first' (الأول اللي سجل فوق) | 'last' (الأخير اللي سجل فوق)

// ===== فلتر وترتيب قائمة اليوم =====
window.setTodayListFilter = (mode, btn) => {
  todayListFilter = mode;
  document.querySelectorAll('#today-filter-all,#today-filter-attendance,#today-filter-verse').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTodayList();
};

window.toggleTodayListSort = () => {
  todayListSortOrder = todayListSortOrder === 'first' ? 'last' : 'first';
  const btn = document.getElementById('today-sort-btn');
  if (btn) btn.textContent = todayListSortOrder === 'first' ? '⇅ الأول ↞ الأخير' : '⇅ الأخير ↞ الأول';
  renderTodayList();
};

// وقت الحدث اللي بنرتب بيه، حسب الفلتر الحالي
function todayListRelevantTime(s) {
  const at = S.todayAttendanceTime[s.id];
  const vt = S.todayVerseTime[s.id];
  if (todayListFilter === 'attendance') return S.todayAttendance[s.id] ? (at ?? 0) : null;
  if (todayListFilter === 'verse') return S.todayVerses[s.id] ? (vt ?? 0) : null;
  const times = [at, vt].filter(t => t != null);
  return times.length ? Math.min(...times) : null;
}

export function renderTodayList() {
  const cont = document.getElementById('today-list');
  if (!S.allStudents.length) { cont.innerHTML=`<div class="empty-state"><div class="empty-icon">📋</div>أضف مخدومين أولاً</div>`; return; }

  const visibleClasses = [S.currentClassTab];
  let filtered = S.allStudents.filter(s => visibleClasses.includes(s.classSection)).filter(s => {
    if (todayListFilter === 'attendance') return !!S.todayAttendance[s.id];
    if (todayListFilter === 'verse')      return !!S.todayVerses[s.id];
    return true; // 'all'
  });

  const withTime = filtered.filter(s => todayListRelevantTime(s) != null);
  const withoutTime = filtered.filter(s => todayListRelevantTime(s) == null);
  withTime.sort((a,b) => {
    const diff = todayListRelevantTime(a) - todayListRelevantTime(b);
    return todayListSortOrder === 'first' ? diff : -diff;
  });
  withoutTime.sort((a,b) => a.name.localeCompare(b.name, 'ar'));
  const sorted = [...withTime, ...withoutTime];

  if (!sorted.length) { cont.innerHTML=`<div class="empty-state"><div class="empty-icon">🔍</div>مفيش حد يطابق الفلتر ده النهارده</div>`; return; }

  cont.innerHTML = sorted.map(s => {
    const present = !!S.todayAttendance[s.id];
    const verseEntry = S.todayVerses[s.id];
    const hasVerse = !!verseEntry;
    return `<div class="student-item ${present?'present':''}${hasVerse&&!present?' verse-only':''}">
      ${studentAvatarHTML(s,'s-avatar')}
      <div class="s-info">
        <div class="s-name">${s.name}</div>
        ${hasVerse ? `<div class="s-sub" style="color:#a07de0">📖 ${verseEntry.verse}</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
        <div class="check-box att-box${present?' checked':''}" onclick="${present?`removeAttendance('${s.id}')`:`quickToggleAttendance('${s.id}')`}">${present?'✓':''}</div>
        <div class="check-box verse-box${hasVerse?' checked':''}" title="${hasVerse?verseEntry.verse:'تسجيل آية'}" onclick="${hasVerse?`removeVerse('${s.id}')`:`showVerseModal('${s.id}')`}">${hasVerse?'✓':'📖'}</div>
      </div>
    </div>`;
  }).join('');
}

export function updateStats() {
  const classesToCount = [S.currentClassTab];
  const classStudents = S.allStudents.filter(s => classesToCount.includes(s.classSection));
  const present = classStudents.filter(s => !!S.todayAttendance[s.id]).length;
  const heardVerse = classStudents.filter(s => !!S.todayVerses[s.id]).length;
  document.getElementById('stat-total').textContent   = classStudents.length;
  document.getElementById('stat-present').textContent = present;
  document.getElementById('stat-absent').textContent  = classStudents.length - present;
}

// ===== MANUAL SEARCH =====
window.onManualSearch = () => {
  const qRaw = document.getElementById('manual-input').value.trim();
  const cont = document.getElementById('manual-results');
  if (!qRaw) { cont.innerHTML=''; return; }
  const q = normalizeArabic(qRaw);
  const visibleClasses = [S.currentClassTab];
  // بنوري كل المخدومين اللي اسمهم مطابق من أي فصل (مش بس فصل الخادم)، وبنفضّل فصله فوق،
  // وبعدين اللي لسه معندوش فصل، وأخيرًا اللي في فصل تاني، عشان الخادم يقدر يسجل لأي حد يلاقيه
  const groupRank = s => visibleClasses.includes(s.classSection) ? 0 : (!s.classSection ? 1 : 2);
  const list = classScope(searchStudents(S.allStudents, q))
    .sort((a, b) => groupRank(a) - groupRank(b))
    .slice(0,30);
  if (!list.length) {
    cont.innerHTML = `<div style="color:var(--text-dim);font-size:13px;padding:8px 4px">لا يوجد مخدوم بهذا الاسم</div>`;
    return;
  }
  // لو الخادم في بيبي كلاس 1 / بيبي كلاس 2 / كي جي 1: المخدوم اللي لسه متقسمش بيتوزع على التلات فصول دول بس
  const pickGrp = babyKgClasses();
  const pickClasses = pickGrp.some(c => c.id === S.currentClassTab) ? pickGrp : undefined;
  cont.innerHTML = list.map(s => {
    // لسه معندوش فصل؟ نوريله أزرار الفصول الأول عشان يتقسم قبل ما نسجله
    if (!s.classSection) {
      return `<div class="result-item" style="cursor:default;flex-wrap:wrap">
        ${studentAvatarHTML(s,'result-avatar')}
        <div style="flex:1;font-size:14px;font-weight:700;min-width:100%">${s.name} <span style="color:var(--text-dim);font-weight:600;font-size:11px">— هو في فصل إيه؟</span></div>
        ${classPickButtonsHTML(s.id, pickClasses)}
      </div>`;
    }
    const isPresent = !!S.todayAttendance[s.id];
    const hasVerse  = !!S.todayVerses[s.id];
    const verseText = S.todayVerses[s.id]?.verse || '';
    const otherClass = !visibleClasses.includes(s.classSection);
    const classBadge = classBadgeHTML(s.classSection, otherClass);
    return `<div class="result-item" style="cursor:default">
      ${studentAvatarHTML(s,'result-avatar')}
      <div style="flex:1;font-size:14px;font-weight:700;display:flex;align-items:center;gap:6px">${s.name} ${classBadge}</div>
      <div class="check-box att-box${isPresent?' checked':''}" onclick="event.stopPropagation();${isPresent?`removeAttendance('${s.id}')`:`manualMarkAndClear('${s.id}')`}">${isPresent?'✓':''}</div>
      <div class="check-box verse-box${hasVerse?' checked':''}" title="${hasVerse?verseText:'تسجيل آية'}" onclick="event.stopPropagation();${hasVerse?`removeVerse('${s.id}')`:`manualVerseAndClear('${s.id}')`}">${hasVerse?'✓':'📖'}</div>
    </div>`;
  }).join('');
};

// أول مرة يترقى فيها ولد: نحفظله الفصل (أ/ب) وبعدين نعرض خانة الحضور العادية بدل زرار الاختيار
window.assignClassSection = async (id, section) => {
  try {
    await updateDoc(doc(db,'students',id), { classSection: section, updatedAt: serverTimestamp() }); bumpStudentsRev();
    const idx = S.allStudents.findIndex(x => x.id === id);
    if (idx !== -1) S.allStudents[idx].classSection = section;
    const s = S.allStudents[idx];
    const already = !!S.todayAttendance[id];
    if (!already) await markPresent(id);
    showToast(`✅ ${s?.name || ''} — ${classLabel(section)} وتم تسجيل الحضور`, 'success');
    navigator.vibrate?.([60,30,60]);
    renderStudentsList();
    updateStats();
    renderTodayList();
    logActivity('تحديد الفصل وتسجيل حضور', `${s?.name || ''} — ${classLabel(section)}`);
    // نفضي خانة البحث عشان يتكتب اسم جديد على طول، زي باقي أزرار التسجيل السريع
    const input = document.getElementById('manual-input');
    if (input) { input.value = ''; document.getElementById('manual-results').innerHTML = ''; input.focus(); }
  } catch(e) {
    showToast('حصل خطأ أثناء الحفظ', 'error');
  }
};

window.manualMark = async (id) => {
  const ok = await markPresent(id);
  if (ok) {
    const s = S.allStudents.find(x => x.id === id);
    showToast(`✅ ${s.name} — تم التسجيل`, 'success');
    navigator.vibrate?.([60,30,60]);
    onManualSearch();
    logActivity('تسجيل حضور', s.name);
  }
};

// تسجيل حضور بضغطة واحدة من قائمة اليوم (المربع الأخضر) من غير ما نلمس خانة البحث
window.quickToggleAttendance = async (id) => {
  const ok = await markPresent(id);
  if (ok) {
    const s = S.allStudents.find(x => x.id === id);
    showToast(`✅ ${s?.name || ''} — تم التسجيل`, 'success');
    navigator.vibrate?.([60,30,60]);
    logActivity('تسجيل حضور', s?.name || '');
  }
};

// الدوس على مربع الحضور: يتعمل حضور فورًا (وتبقى علامة صح خضرا)، وبعدين تتفضى خانة البحث عشان يتكتب اسم جديد على طول
window.manualMarkAndClear = async (id) => {
  const ok = await markPresent(id);
  if (ok) {
    const s = S.allStudents.find(x => x.id === id);
    showToast(`✅ ${s.name} — تم التسجيل`, 'success');
    navigator.vibrate?.([60,30,60]);
    logActivity('تسجيل حضور', s.name);
  }
  const input = document.getElementById('manual-input');
  input.value = '';
  document.getElementById('manual-results').innerHTML = '';
  input.focus();
};

// نفس فكرة manualMarkAndClear بس لتسجيل السماع (الآية): يتسجل السماع فورًا، وبعدين تتفضى خانة البحث عشان تكتب اسم جديد على طول
window.manualVerseAndClear = async (id) => {
  await showVerseModal(id);
  const input = document.getElementById('manual-input');
  input.value = '';
  document.getElementById('manual-results').innerHTML = '';
  input.focus();
};
