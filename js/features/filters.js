// تبويب الافتقاد والفلاتر
import { S } from '../core/state.js';
import { attIsStale, attSessionDates, ensureRecentAttendance, ensureRecentVerses, filterWeeks, verseFilterWeeks, verseIsStale, verseSessionDates } from './attendance.js';
import { classScope, getAllowedAssignedClasses, readScopeClasses, studentAvatarHTML } from './classes.js';
import { NOTE_LABELS } from './settings.js';
import { computeSiblingCounts, familyKey } from './students.js';

let bdayMonth = 0;
let noteFilter = 'all';
let filterSiblings = 'all'; // 'all' | 'siblings' | 'nonSiblings' (تبويب الافتقاد)
let verseRefreshBusy = false;
let verseRetriedFull = false; // قراءة كاملة من فايرستور بدون كاش (بتتفعّل تلقائي لو الفلتر رجّع فاضي)

// ===== FILTERS =====
window.setBdayMonth = (m) => {
  bdayMonth = parseInt(m);
  renderFilterList();
};

window.setFilterSiblings = (v, btn) => {
  filterSiblings = v;
  document.querySelectorAll('#filter-siblings-chips .filter-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('fsiblings-value').textContent = btn.textContent.trim();
  btn.closest('details')?.removeAttribute('open');
  renderFilterList();
};

window.setAbsenceFilter = (v, btn) => {
  S.absenceFilter = v;
  document.querySelectorAll('#absence-chips .filter-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('absence-value').textContent = btn.textContent.trim();
  btn.closest('details')?.removeAttribute('open');
  renderFilterList();
};

window.setAttendanceFilter = (v, btn) => {
  S.attendanceFilter = v;
  document.querySelectorAll('#attendance-chips .filter-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('attendance-value').textContent = btn.textContent.trim();
  btn.closest('details')?.removeAttribute('open');
  renderFilterList();
};

window.setVerseFilter = (v, btn) => {
  S.verseFilter = v;
  verseRetriedFull = false;
  document.querySelectorAll('#verse-chips .filter-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('verse-value').textContent = btn.textContent.trim();
  btn.closest('details')?.removeAttribute('open');
  renderFilterList();
};

window.setNoteFilter = (v, btn) => {
  noteFilter = v;
  document.querySelectorAll('#note-chips .filter-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('note-value').textContent = btn.textContent.trim();
  btn.closest('details')?.removeAttribute('open');
  renderFilterList();
};

window.renderFilterList = renderFilterList;

export function renderFilterList() {
  const cont = document.getElementById('filter-list');
  if ((S.absenceFilter !== 'all' || S.attendanceFilter !== 'all') && S.recentAttWeeks < filterWeeks()) {
    cont.innerHTML = `<div class="loading"><div class="spinner"></div>جاري التحميل…</div>`;
    ensureRecentAttendance(filterWeeks()).then(renderFilterList).catch(()=>{ cont.innerHTML = '<div class="empty-state">تعذّر التحميل<br><button class="action-btn" style="margin-top:10px" onclick="renderFilterList()">🔄 حاول تاني</button></div>'; });
    return;
  }
  if ((S.absenceFilter !== 'all' || S.attendanceFilter !== 'all') && attIsStale() && !S.attRefreshBusy) {
    S.attRefreshBusy = true;
    ensureRecentAttendance(filterWeeks()).then(() => { S.attRefreshBusy = false; renderFilterList(); }).catch(() => { S.attRefreshBusy = false; });
  }
  const verseScopeChanged = S.recentVerseScope !== null && S.recentVerseScope !== readScopeClasses().join(','); // الفصل اتغيّر: لازم نحمّل تسميع الفصل الجديد
  if (S.verseFilter !== 'all' && (verseScopeChanged || S.recentVerseWeeks < verseFilterWeeks() || verseIsStale()) && !verseRefreshBusy) {
    cont.innerHTML = `<div class="loading"><div class="spinner"></div>جاري التحميل…</div>`;
    verseRefreshBusy = true;
    ensureRecentVerses(verseFilterWeeks()).then(() => { verseRefreshBusy = false; renderFilterList(); }).catch(() => { verseRefreshBusy = false; cont.innerHTML = '<div class="empty-state">تعذّر التحميل<br><button class="action-btn" style="margin-top:10px" onclick="renderFilterList()">🔄 حاول تاني</button></div>'; });
    return;
  }
  if (S.verseFilter !== 'all' && verseRefreshBusy) return;
  const dates = attSessionDates();
  let list = [...S.allStudents];
  const allowed = getAllowedAssignedClasses();
  if (S.currentRole !== 'admin' && allowed.length) {
    list = list.filter(s => allowed.includes(s.classSection));
  }
  list = classScope(list);
  if (bdayMonth > 0) {
    list = list.filter(s => s.dob && new Date(s.dob).getMonth() + 1 === bdayMonth);
  }
  if (S.absenceFilter !== 'all' && dates.length > 0) {
    const n = parseInt(S.absenceFilter);
    const lastDates = dates.slice(-n);
    list = list.filter(s => lastDates.every(d => !S.allAttendance[d]?.[s.id]));
  }
  if (S.attendanceFilter !== 'all' && dates.length > 0) {
    const n = parseInt(S.attendanceFilter);
    const lastDates = dates.slice(-n);
    list = list.filter(s => lastDates.length === n && lastDates.every(d => !!S.allAttendance[d]?.[s.id]));
  }
  if (S.verseFilter !== 'all') {
    const vDates = verseSessionDates();
    const n = parseInt(S.verseFilter);
    const lastV = vDates.slice(-n);
    window._verseMatchDbg = vDates.map(d => d + ' → ' + list.filter(s => S.allVerses[d]?.[s.id]).length + ' مطابق').join(' · ');
    list = list.filter(s => lastV.length === n && lastV.every(d => !!S.allVerses[d]?.[s.id]));
  }
  if (noteFilter === 'noReason') {
    list = list.filter(s => !Array.isArray(s.visitNotes) || s.visitNotes.length === 0);
  } else if (noteFilter !== 'all') {
    list = list.filter(s => Array.isArray(s.visitNotes) && s.visitNotes.includes(noteFilter));
  }
  if (filterSiblings !== 'all') {
    const siblingCounts = computeSiblingCounts(S.allStudents);
    if (filterSiblings === 'siblings') {
      list = list.filter(s => { const k = familyKey(s.name); return k && siblingCounts[k] > 1; });
    } else {
      list = list.filter(s => { const k = familyKey(s.name); return !k || siblingCounts[k] <= 1; });
    }
  }
  // تجميع الإخوات فوق بعض في نتايج الافتقاد بردو
  list = [...list].sort((a, b) => {
    const ka = familyKey(a.name) || `__${a.id}`;
    const kb = familyKey(b.name) || `__${b.id}`;
    const c = ka.localeCompare(kb, 'ar');
    return c !== 0 ? c : a.name.localeCompare(b.name, 'ar');
  });
  document.getElementById('filter-count').textContent = `${list.length} مخدوم`;
  if (!list.length && S.verseFilter !== 'all' && !verseRetriedFull) {
    // النتيجة فاضية: ممكن الكاش المحلي ناقص، فبنعمل قراءة كاملة مرة واحدة من فايرستور ونعيد الفلتر
    verseRetriedFull = true; S.verseForceFull = true; S.recentVerseWeeks = 0;
    renderFilterList();
    return;
  }
  if (!list.length) {
    let dbg = '';
    if (S.verseFilter !== 'all') {
      const vd = verseSessionDates();
      dbg = `<div style="margin-top:12px;font-size:11px;opacity:.7;direction:ltr;line-height:1.8">[تشخيص] جلسات التسميع: ${vd.length ? vd.map(d => d + ' (' + Object.keys(S.allVerses[d]).length + ')').join(' · ') : 'مفيش'}<br>مطابقة مع المخدومين الحاليين (من غير الأسبوع الجاري): ${window._verseMatchDbg || '-'}<br>الفصول: ${readScopeClasses().join(',') || 'الكل'} · مخدومين قبل الفلتر: ${classScope(S.allStudents.filter(s => { const al = getAllowedAssignedClasses(); return S.currentRole === 'admin' || !al.length || al.includes(s.classSection); })).length}</div>`;
    }
    cont.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div>لا يوجد نتائج${dbg}</div>`;
    return;
  }
  cont.innerHTML = list.map(s => {
    let attCount = 0;
    dates.forEach(d => { if (S.allAttendance[d]?.[s.id]) attCount++; });
    const dob = s.dob ? new Date(s.dob).toLocaleDateString('ar-EG',{day:'numeric',month:'long'}) : '';
    const notesHTML = (s.visitNotes?.length)
      ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px">${s.visitNotes.map(n => NOTE_LABELS[n]
          ? `<span style="font-size:10px;background:rgba(124,92,191,0.1);border:1px solid rgba(124,92,191,0.25);color:#a07de0;border-radius:5px;padding:2px 6px">${NOTE_LABELS[n].emoji} ${NOTE_LABELS[n].text}</span>`
          : '').join('')}</div>`
      : `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px"><span style="font-size:10px;background:rgba(255,255,255,0.05);border:1px solid var(--border);color:var(--text-dim);border-radius:5px;padding:2px 6px">${NOTE_LABELS.noReason.emoji} ${NOTE_LABELS.noReason.text}</span></div>`;
    return `<div class="student-item">
      ${studentAvatarHTML(s,'s-avatar')}
      <div class="s-info">
        <div class="s-name">${s.name}</div>
        <div class="s-sub">${dob ? '🎂 '+dob+' · ' : ''}حضر ${attCount} مرة</div>
        ${notesHTML}
      </div>
      <button class="action-btn" onclick="openProfile('${s.id}')">👤 ملف</button>
      <button class="action-btn" onclick="openEditModal('${s.id}')">✏️ تعديل</button>
    </div>`;
  }).join('');
}
