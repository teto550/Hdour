// الفصول (ديناميكي) + نطاق الفصول لكل خادم + إدارة الفصول (أدمن)
import { S } from '../core/state.js';
import { addDoc, collection, db, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from '../core/firebase.js';
import { normalizeArabic } from '../core/idb-cache.js';
import { countSnapshotReads } from '../core/reads-counter.js';
import { restartTodayListeners } from './attendance.js';
import { loadServantsOnce } from './class-servants.js';
import { renderFilterList } from './filters.js';
import { renderMonitorClassChips } from './monitor.js';
import { applyClassRestrictionUI, renderAdminClassCards, renderClassPicker } from './navigation.js';
import { loadStudents, renderStudentsList, updateStuCount } from './students.js';
import { renderTodayList, updateStats } from './today-list.js';

export function normalizeAssignedClasses(raw) {
  const items = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  return [...new Set(items.map(v => String(v).trim()).filter(Boolean))];
}

export function formatAssignedClasses(raw) {
  const list = normalizeAssignedClasses(raw);
  if (!list.length) return 'كل الفصول';
  return list.map(cls => classLabel(cls)).join(' + ');
}

export function getAllowedAssignedClasses(raw = S.currentAssignedClass) {
  const allowed = normalizeAssignedClasses(raw);
  return S.currentRole === 'admin' || !allowed.length ? [] : allowed;
}

export function readScopeClasses() {
  if (S.currentRole === 'admin') {
    if (S.adminAllClasses || !S.currentClassTab || !classById(S.currentClassTab)) return [];
    const grp = babyKgClasses().map(c => c.id);
    return grp.includes(S.currentClassTab) ? [...grp, ''] : [S.currentClassTab];
  }
  const al = getAllowedAssignedClasses();
  if (!al.length) return [];
  const grp = babyKgClasses().map(c => c.id);
  return [...new Set(al.some(id => grp.includes(id)) ? [...al, ...grp, ''] : al)].slice(0, 30);
}

export async function waitClassesReady() { for (let i = 0; i < 40 && !S.allClasses.length; i++) await new Promise(r => setTimeout(r, 100)); }

let lastReadScopeKey = '';

function onAdminScopeChanged() {
  if (S.currentRole !== 'admin') return;
  const sk = readScopeClasses().join(',');
  if (sk === lastReadScopeKey) return;
  lastReadScopeKey = sk;
  if (S.todayAttendanceUnsub || S.todayVersesUnsub) restartTodayListeners();
  if (S.studentsLoaded) loadStudents().then(() => { updateStats(); renderTodayList(); updateStuCount(); renderStudentsList();
    if (document.getElementById('tab-filters')?.style.display === 'block') renderFilterList();
    if (document.getElementById('tab-messages')?.style.display === 'block') renderWaTab(); });
}

function renderAdminAllChip() {
  const b = document.getElementById('class-tab-all'); if (!b) return;
  b.classList.toggle('active', S.adminAllClasses && !S.adminAutoAll);
}

window.toggleAdminAllClasses = () => {
  S.adminAllClasses = !(S.adminAllClasses && !S.adminAutoAll); S.adminAutoAll = false;
  renderAdminAllChip(); onAdminScopeChanged();
  showToast(S.adminAllClasses ? '🌐 بيقرا كل الفصول' : 'بيقرا الفصل المختار بس', 'info');
};

// الداشبورد والتصدير وأدوات التنضيف محتاجة كل الفصول: بنحمّلها مؤقتًا ونرجع للفصل أول ما الأدمن يغيّر الفصل
export async function ensureAllClassesForAdmin() {
  if (S.currentRole !== 'admin' || S.adminAllClasses) return;
  S.adminAllClasses = true; S.adminAutoAll = true; lastReadScopeKey = '';
  showToast('جاري تحميل كل الفصول…', 'info');
  await loadStudents();
}

export function adminClassChanged() {
  if (S.adminAutoAll) { S.adminAllClasses = false; S.adminAutoAll = false; }
  renderAdminAllChip(); onAdminScopeChanged();
}

function isAssignedClassRestricted() {
  return S.currentRole !== 'admin' && getAllowedAssignedClasses().length > 0;
}

// لستة مقصورة على فصل/فصول الخادم بس — للميزات اللي المفروض تفضل مقفولة على فصله
// (رسائل الواتساب، تصدير الإكسل، طباعة الـQR، الحضور بالصوت) حتى لو تبويب "المخدومين" بيعرض كل الفصول
export function ownClassStudents() {
  const allowed = getAllowedAssignedClasses();
  const base = (S.currentRole !== 'admin' && allowed.length) ? S.allStudents.filter(s => allowed.includes(s.classSection)) : S.allStudents;
  return S.currentRole !== 'admin' ? classScope(base) : base;
}

// ===== الفصول (ديناميكي) =====

let classesUnsub = null;

const CLASS_PALETTE = [
  {bg:'rgba(79,142,247,0.12)',  border:'rgba(79,142,247,0.3)',  text:'#4f8ef7'},
  {bg:'rgba(124,92,191,0.12)',  border:'rgba(124,92,191,0.3)',  text:'#a07de0'},
  {bg:'rgba(46,204,113,0.12)',  border:'rgba(46,204,113,0.3)',  text:'#2ecc71'},
  {bg:'rgba(243,156,18,0.12)',  border:'rgba(243,156,18,0.3)',  text:'#f39c12'},
  {bg:'rgba(231,76,60,0.12)',   border:'rgba(231,76,60,0.3)',   text:'#e74c3c'},
  {bg:'rgba(26,188,156,0.12)',  border:'rgba(26,188,156,0.3)',  text:'#1abc9c'},
  {bg:'rgba(230,126,34,0.12)',  border:'rgba(230,126,34,0.3)',  text:'#e67e22'},
  {bg:'rgba(52,152,219,0.12)',  border:'rgba(52,152,219,0.3)',  text:'#3498db'},
];

// ===== خادم ممكن يبقى مسؤول فصل في فصل وخادم عادي في فصل تاني =====
// الخادم بقى ممكن يبقى في أكتر من دور (roleIds) — صلاحياته بتتحسب من كل أدواره: assignedClass = كل فصوله، supervisorClass = الفصول اللي هو مسؤول عنها بس
export function servantRoleIds(s) { return Array.isArray(s.roleIds) ? s.roleIds.filter(Boolean) : (s.roleId ? [s.roleId] : []); }

export function servantInRole(s, roleId) { return servantRoleIds(s).includes(roleId); }

// مسؤول قديم (من غير supervisorClass) بيتحسب مسؤول عن كل فصوله زي الأول
export function supervisedClassesOf(s) {
  if (!s || s.role !== 'supervisor') return [];
  return s.supervisorClass !== undefined ? normalizeAssignedClasses(s.supervisorClass) : normalizeAssignedClasses(s.assignedClass);
}

export function derivePermsFromRoles(roleList) {
  if (roleList.some(r => r.isAdmin)) return { role:'admin', assignedClass:'', supervisorClass:'' };
  const all = new Set(), sup = new Set();
  roleList.forEach(r => (r.classes || []).forEach(c => { all.add(c); if (r.isSupervisor) sup.add(c); }));
  return { role: sup.size ? 'supervisor' : 'servant', assignedClass: [...all].join(','), supervisorClass: [...sup].join(',') };
}

// أسماء الخدام المضافين مقدمًا: بنعتبر "أحمد" و"احمد " و"أحمد  " نفس الاسم، وبنشيل التكرار (أول شكل بيظهر هو اللي بيتعرض)
export function nameKey(n) { return normalizeArabic(n).trim(); }

export function uniqueNames(list) {
  const seen = new Set(), out = [];
  (list || []).forEach(n => { const k = nameKey(n); if (k && !seen.has(k)) { seen.add(k); out.push(n); } });
  return out;
}

// كل الأشكال المتخزنة لنفس الاسم جوه دور معين (عشان نمسحها كلها مرة واحدة)
export function nameVariantsIn(role, name) {
  const k = nameKey(name);
  return (role && Array.isArray(role.pendingNames) ? role.pendingNames : []).filter(x => nameKey(x) === k);
}

// بتحسب صلاحيات خادم واحد بعد ما أدواره اتغيرت — من غير ما تضيّع صلاحياته القديمة، وبتسحب منه بس اللي كان واخده من الدور اللي اتشال منه
// newIds = أدواره بعد التغيير | rolesNow = كل الأدوار بعد التغيير | removedRole = الدور اللي اتشال منه (لو اتشال) بشكله القديم
export function permsAfterRoleChange(sv, newIds, rolesNow, removedRole) {
  const list = newIds.map(i => rolesNow.find(r => r.id === i)).filter(Boolean);
  if (list.some(r => r.isAdmin)) return derivePermsFromRoles(list);
  const oldClasses = normalizeAssignedClasses(sv.assignedClass);
  const oldSup = supervisedClassesOf(sv);
  const unchanged = { role: sv.role || 'servant', assignedClass: oldClasses.join(','), supervisorClass: oldSup.join(',') };
  // أدمن متعيّن مباشرة (مش من دور): مبنمسهوش إلا لو اتشال من دور أدمن صراحةً
  if (sv.role === 'admin') {
    if (removedRole && removedRole.isAdmin) return list.length ? derivePermsFromRoles(list) : { role:'servant', assignedClass:'', supervisorClass:'' };
    return { role:'admin', assignedClass: '', supervisorClass: '' };
  }
  if (removedRole) {
    if (list.length) return derivePermsFromRoles(list);
    if (removedRole.isSupervisor) {
      // اتشال من دور مسؤول فصل وملوش أدوار تانية: بنسحب المسؤولية بس، وبيفضل خادم في نفس فصوله
      const gone = new Set(removedRole.classes || []);
      const sup = oldSup.filter(c => !gone.has(c));
      return { role: sup.length ? 'supervisor' : 'servant', assignedClass: unchanged.assignedClass, supervisorClass: sup.join(',') };
    }
    return unchanged;
  }
  const hadRoles = servantRoleIds(sv).some(i => rolesNow.some(r => r.id === i));
  if (hadRoles) return derivePermsFromRoles(list);
  // خادم قديم من غير أدوار: بنضيف الدور الجديد على صلاحياته الحالية بدل ما نستبدلها
  const d = derivePermsFromRoles(list);
  const all = oldClasses.length ? [...new Set([...oldClasses, ...normalizeAssignedClasses(d.assignedClass)])] : []; // فاضي = كل الفصول، يفضل زي ما هو
  const sup = [...new Set([...oldSup, ...normalizeAssignedClasses(d.supervisorClass)])];
  return { role: sup.length ? 'supervisor' : 'servant', assignedClass: all.join(','), supervisorClass: sup.join(',') };
}

// كل فصول الكي جي (id بيبدأ بـ kg أو الاسم بيبدأ بـ "كي جي") ليها نفس الإيموجي 👶 بغض النظر عن المتخزن في فايرستور
const KG_CLASS_EMOJI = '👶';

export function unifyKgEmoji(c) {
  const isKg = /^kg/i.test(c.id || '') || /^\s*كي\s*جي/.test(c.name || '');
  return isKg ? { ...c, emoji: KG_CLASS_EMOJI } : c;
}

export function classById(id) { return S.allClasses.find(c => c.id === id); }

export function classLabel(sec) { if (!sec) return 'بدون فصل'; const c = classById(sec); return c ? c.name : sec; }

export function classEmoji(sec) { if (!sec) return '؟'; const c = classById(sec); return c ? (c.emoji || '📘') : '❔'; }

export function classPalette(sec) {
  const idx = S.allClasses.findIndex(c => c.id === sec);
  return CLASS_PALETTE[(idx < 0 ? 0 : idx) % CLASS_PALETTE.length];
}

export function classBadgeHTML(sec, forceLabel) {
  if (!sec) return `<span class="class-badge class-none">؟ لسه متقسمش</span>`;
  const p = classPalette(sec);
  const label = forceLabel === false ? '' : classLabel(sec);
  return `<span class="class-badge" style="background:${p.bg};border:1px solid ${p.border};color:${p.text}">${classEmoji(sec)} ${label}</span>`;
}

// افاتار المخدوم: لو عنده صورة (s.photo) بيوريها، ولو لأ بيرجع لحرف الاسم زي ما كان بالظبط
export function studentAvatarHTML(s, cls) {
  if (s.photo) return `<div class="${cls}" style="background-image:url('${s.photo}');background-size:cover;background-position:center"></div>`;
  return `<div class="${cls}">${(s.name||'؟').trim()[0]||'؟'}</div>`;
}

// شرايط فصول (chips) عامة — بتتبني من allClasses مباشرة، فبتشتغل مع أي عدد فصول
function classChipsHTML(activeId, onClickFn, opts = {}) {
  let html = '';
  if (opts.includeAll) html += `<button class="filter-chip ${activeId==='all'?'active':''}" onclick="${onClickFn}('all',this)">كل الفصول</button>`;
  (opts.classes || S.allClasses).forEach(c => {
    html += `<button class="filter-chip ${activeId===c.id?'active':''}" onclick="${onClickFn}('${c.id}',this)">${c.emoji||'📘'} ${c.name}</button>`;
  });
  if (opts.includeNone) html += `<button class="filter-chip ${activeId==='none'?'active':''}" onclick="${onClickFn}('none',this)">؟ لسه متقسمش</button>`;
  return html;
}

export function classPickButtonsHTML(studentId, classes) {
  return (classes || S.allClasses).map(c => {
    const p = classPalette(c.id);
    return `<button class="class-pick-btn" style="border-color:${p.border};color:${p.text}" onclick="event.stopPropagation();assignClassSection('${studentId}','${c.id}')">${c.emoji||'📘'} ${c.name}</button>`;
  }).join('');
}

export function classSelectOptionsHTML(includeEmpty, emptyLabel) {
  let html = includeEmpty ? `<option value="">${emptyLabel || '— لسه متقسمش —'}</option>` : '';
  html += S.allClasses.map(c => `<option value="${c.id}">${c.emoji||'📘'} ${c.name}</option>`).join('');
  return html;
}

// بتجهّز الفصول الافتراضية بس أول مرة (لو المجموعة لسه فاضية) — بتتنادى من جوه أول snapshot
// بتاع startClassesListener() عشان منقراش مجموعة classes مرتين على بعض عند كل دخول أدمن
async function seedDefaultClassesIfEmpty() {
  try {
    const defaults = [ {id:'a',name:'فصل أ',emoji:'🅰️',order:0}, {id:'b',name:'فصل ب',emoji:'🅱️',order:1}, {id:'kg',name:'كي جي ١',emoji:'👶',order:2} ];
    for (const c of defaults) await setDoc(doc(db,'classes',c.id), { name:c.name, emoji:c.emoji, order:c.order, createdAt: serverTimestamp() });
  } catch(e) { console.error('تعذّر تجهيز الفصول الافتراضية:', e); }
}

let classesSeedChecked = false;

export function startClassesListener() {
  if (classesUnsub) return;
  classesUnsub = onSnapshot(collection(db,'classes'), snap => {
    countSnapshotReads('classes (live)', snap);
    S.allClasses = snap.docs
      .map(d => unifyKgEmoji({ id:d.id, ...d.data() }))
      .sort((a,b) => (a.order??0) - (b.order??0) || (a.name||'').localeCompare(b.name||'','ar'));
    if (!S.allClasses.length && S.currentRole === 'admin' && !classesSeedChecked) { classesSeedChecked = true; seedDefaultClassesIfEmpty(); }
    if (!S.currentClassTab && S.allClasses.length) S.currentClassTab = localStorage.getItem('attendanceClassTab') && S.allClasses.some(c=>c.id===localStorage.getItem('attendanceClassTab')) ? localStorage.getItem('attendanceClassTab') : S.allClasses[0].id;
    const sk = readScopeClasses().join(',');
    if (sk !== lastReadScopeKey) {
      lastReadScopeKey = sk;
      if (S.todayAttendanceUnsub || S.todayVersesUnsub) restartTodayListeners();
      if (S.studentsLoaded) loadStudents().then(() => { updateStats(); renderTodayList(); });
    }
    onClassesUpdated();
  }, err => console.error('classes listener error:', err));
}

export function stopClassesListener() { if (classesUnsub) { classesUnsub(); classesUnsub = null; } S.allClasses = []; lastReadScopeKey = ''; classesSeedChecked = false; }

// بيتنادى كل مرة قايمة الفصول تتغير (إضافة/تعديل/حذف فصل) — بيعيد بناء كل حتة في الواجهة معتمدة على الفصول
function onClassesUpdated() {
  renderGlobalClassTabs();
  if (document.getElementById('tab-pick-class')?.style.display === 'block') renderClassPicker();
  { const t = document.getElementById('class-home-title'); if (t && document.getElementById('tab-home')?.style.display === 'block') t.textContent = classEmoji(S.currentClassTab) + ' ' + classLabel(S.currentClassTab); }
  renderClassChips();
  renderProfClassChips();
  renderRegClassOptions();
  const editSel = document.getElementById('edit-class');
  if (editSel) { const cur = editSel.value; editSel.innerHTML = classSelectOptionsHTML(true); editSel.value = cur; }
  if (S.currentRole === 'admin') {
    renderClassesAdminList();
    if (document.getElementById('tab-admin-classes')?.style.display === 'block') renderAdminClassCards();
    // بنقرا مجموعة الخدام تاني بس لو تبويب "متابعة" مفتوح فعلاً دلوقتي — مش عند كل تحديث للفصول
    if (document.getElementById('tab-monitor')?.style.display === 'block') { renderMonitorClassChips(); loadServantsOnce(); }
  }
  if (document.getElementById('tab-students')?.style.display === 'block') renderStudentsList();
  if (document.getElementById('tab-attendance')?.style.display === 'block') { updateStats(); renderTodayList(); }
}

// شريط الفصول العلوي في شاشة الحضور — بيتبني من allClasses بالكامل
function renderGlobalClassTabs() {
  const bar = document.getElementById('global-class-tabs');
  if (!bar) return;
  bar.innerHTML = S.allClasses.map(c => {
    return `<button class="class-tab" id="class-tab-${c.id}" onclick="switchClassTab('${c.id}',this)">${c.emoji||'📘'} ${c.name}</button>`;
  }).join('') + (S.currentRole === 'admin' ? `<button class="class-tab" id="class-tab-all" onclick="toggleAdminAllClasses()">🌐 كل الفصول</button>` : '');
  applyClassRestrictionUI(); renderAdminAllChip();
}

// الفصول الوحيدة اللي ليها فلتر فصول في تبويب المخدومين: بيبي كلاس 1 / بيبي كلاس 2 / كي جي 1
// (لحد ما باقي المخدومين يتوزعوا عليهم). أي فصل تاني بيعرض مخدومينه بس من غير فلتر.
function isBabyKgClass(c) {
  const n = normalizeArabic(c && c.name || '')
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/\s+/g, ' ').trim();
  return /^بيبي( كلاس)? ?[12]$/.test(n) || /^كي ?جي ?1$/.test(n);
}

export function babyKgClasses() { return S.allClasses.filter(isBabyKgClass); }

// أي فصل غير التلات فصول دول مسؤول عن مخدومين فصله بس — ميوصلش لمخدومين بيبي كلاس 1/2 وكي جي 1 ولا للي لسه متقسمش
export function classScopeActive() {
  if (!S.currentClassTab || !classById(S.currentClassTab)) return false;
  return !babyKgClasses().some(c => c.id === S.currentClassTab);
}

export function classScope(list) { return classScopeActive() ? list.filter(s => s.classSection === S.currentClassTab) : list; }

// الفلتر الفعلي المستخدم في قائمة المخدومين
export function effectiveClassFilter() {
  if (!S.currentClassTab || !classById(S.currentClassTab)) return S.classFilter;
  const grp = babyKgClasses();
  if (grp.some(c => c.id === S.currentClassTab)) return (S.classFilter === 'none' || grp.some(c => c.id === S.classFilter)) ? S.classFilter : S.currentClassTab;
  return S.currentClassTab;
}

export function renderClassChips() {
  const cont = document.getElementById('class-chips');
  if (!cont) return;
  const grp = babyKgClasses();
  const show = !!S.currentClassTab && grp.some(c => c.id === S.currentClassTab);
  cont.style.display = show ? '' : 'none';
  cont.innerHTML = show ? classChipsHTML(effectiveClassFilter(), 'setClassFilter', { classes: grp, includeNone: true }) : '';
}

export function renderProfClassChips(activeId) {
  const cont = document.getElementById('prof-class-chips');
  if (!cont) return;
  const active = activeId !== undefined ? activeId : (S.allStudents.find(x => x.id === S.currentProfileId)?.classSection || '');
  let html = `<button class="filter-chip ${!active?'active':''}" onclick="setStudentClassFromProfile('')">بدون فصل</button>`;
  html += S.allClasses.map(c => `<button class="filter-chip ${active===c.id?'active':''}" onclick="setStudentClassFromProfile('${c.id}')">${c.emoji||'📘'} ${c.name}</button>`).join('');
  cont.innerHTML = html;
}

function renderRegClassOptions() {
  const sel = document.getElementById('reg-class');
  if (sel && S.allClasses.length) sel.innerHTML = classSelectOptionsHTML(false);
}

// ===== إدارة الفصول (أدمن فقط) — إضافة/تعديل/حذف فصول من جوه التطبيق نفسه =====
function renderClassesAdminList() {
  const cont = document.getElementById('classes-admin-list');
  if (!cont) return;
  if (!S.allClasses.length) { cont.innerHTML = `<div class="empty-state" style="padding:10px">لا يوجد فصول بعد</div>`; return; }
  cont.innerHTML = S.allClasses.map(c => `
    <div class="tpl-chip">
      <span class="tpl-chip-name">${c.emoji||'📘'} ${c.name}</span>
      <button class="tpl-chip-del" onclick="editClassPrompt('${c.id}')" title="تعديل" style="margin-left:4px">✏️</button>
      <button class="tpl-chip-del" onclick="deleteClass('${c.id}','${(c.name||'').replace(/'/g,"\\'")}')" title="حذف">✕</button>
    </div>`).join('');
}

window.addClassPrompt = async () => {
  const name = (prompt('اسم الفصل الجديد؟ (مثلاً: فصل ج)') || '').trim();
  if (!name) return;
  const emoji = (prompt('إيموجي للفصل؟ (اختياري، سيب فاضي لو مش عايز)') || '').trim();
  try {
    await addDoc(collection(db,'classes'), { name, emoji, order: S.allClasses.length, createdAt: serverTimestamp() });
    showToast(`تم إضافة "${name}" ✓`, 'success');
  } catch(e) { console.error(e); showToast('حصل خطأ أثناء الإضافة', 'error'); }
};

window.editClassPrompt = async (id) => {
  const c = classById(id); if (!c) return;
  const name = (prompt('اسم الفصل:', c.name) || '').trim();
  if (!name) return;
  const emoji = (prompt('إيموجي الفصل:', c.emoji||'') || '').trim();
  try {
    await updateDoc(doc(db,'classes',id), { name, emoji });
    showToast('تم تعديل الفصل ✓', 'success');
  } catch(e) { console.error(e); showToast('حصل خطأ أثناء التعديل', 'error'); }
};

window.deleteClass = async (id, name) => {
  if (!confirm(`هتحذف "${name}"؟ المخدومين والخدام اللي متسجلين في الفصل ده هيفضلوا متسجلين بيه بس هيبان "غير معروف" لحد ما تحددلهم فصل تاني`)) return;
  try {
    await deleteDoc(doc(db,'classes',id));
    showToast('تم حذف الفصل', 'success');
  } catch(e) { console.error(e); showToast('حصل خطأ أثناء الحذف', 'error'); }
};
