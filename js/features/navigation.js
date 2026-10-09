// التابات + الصفحة الرئيسية للأدمن + زرار الرجوع
import { S } from '../core/state.js';
import { startTodayListeners, stopTodayListeners } from './attendance.js';
import { loadServantsOnce, renderClassServAttList, renderClassServList } from './class-servants.js';
import { adminClassChanged, classEmoji, classLabel, getAllowedAssignedClasses, normalizeAssignedClasses, renderClassChips } from './classes.js';
import { renderFilterList } from './filters.js';
import { ensureStudents, renderStudentsList, updateStuCount } from './students.js';
import { renderTodayList, updateStats } from './today-list.js';

// ===== TABS =====
window.applyMonitorVisibility = () => {
  const onAdmin = S.currentRole === 'admin';
  const onSupervisor = S.currentRole === 'supervisor';
  document.getElementById('tab-btn-monitor').style.display = 'none';
  const c = document.getElementById('home-card-monitor'); if (c) c.style.display = 'none'; // الأدمن بيدخل المتابعة من كارت "الخدام" في رئيسيته
  // المسؤول بيدخل الخدام من الرئيسية (كارت "الخدام")، مش من جوه الفصل
  document.getElementById('tab-btn-classservants').style.display = 'none';
  const c2 = document.getElementById('home-card-classservants'); if (c2) c2.style.display = 'none';
  // "خدام الفصول": بيظهر للمسؤول اللي مسؤول عن أكتر من فصل، عشان يشوف خدام كل فصوله مع بعض
  const tb2 = document.getElementById('tab-btn-allclassservants'); if (tb2) tb2.style.display = 'none';
  const c3 = document.getElementById('home-card-allclassservants'); if (c3) c3.style.display = 'none';
};

// ===== الصفحة الرئيسية للأدمن: الفصول / الخدام =====
export function hideAdminScreens() {
  ['tab-admin-home','tab-sup-home','tab-admin-classes','tab-pick-class'].forEach(id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; });
  hideRolesScreen();
}

// شاشة "المستخدمين والأدوار" لازم تتقفل مع أي تنقل تاني (هوم / تابات / فصول)، وإلا الشاشة الجديدة بتظهر فوقها أو تحتها
function hideRolesScreen() {
  const r = document.getElementById('tab-roles'); if (r) r.style.display = 'none';
  document.getElementById('servant-profile-modal') && (document.getElementById('servant-profile-modal').style.display = 'none');
}

let adminClassMode = null; // null | 'edit' | 'del'

window.setAdminClassMode = (m) => {
  adminClassMode = (adminClassMode === m) ? null : m;
  renderAdminClassCards();
};

window.adminClassCardClick = async (id, name) => {
  const mode = adminClassMode;
  if (mode === 'edit') { adminClassMode = null; renderAdminClassCards(); await editClassPrompt(id); }
  else if (mode === 'del') { adminClassMode = null; renderAdminClassCards(); await deleteClass(id, name); }
  else openClassFromAdmin(id);
};

export function renderAdminClassCards() {
  const grid = document.getElementById('admin-classes-grid');
  if (!grid) return;
  const esc = t => String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const eb = document.getElementById('admin-mode-edit'), db_ = document.getElementById('admin-mode-del'), hint = document.getElementById('admin-mode-hint');
  if (eb) eb.classList.toggle('active', adminClassMode === 'edit');
  if (db_) db_.classList.toggle('active', adminClassMode === 'del');
  if (hint) hint.textContent = adminClassMode === 'edit' ? 'اختار الفصل اللي عايز تعدّله' : adminClassMode === 'del' ? 'اختار الفصل اللي عايز تحذفه' : '';
  const cls = adminClassMode === 'edit' ? ' mode-edit' : adminClassMode === 'del' ? ' mode-del' : '';
  grid.innerHTML = S.allClasses.map(c => `
    <button class="admin-card${cls}" data-cid="${esc(c.id)}">
      <span class="ac-emoji">${esc(c.emoji||'📘')}</span>${esc(c.name)}
    </button>`).join('') + `<button class="admin-card add" onclick="addClassPrompt()">➕ إضافة فصل</button>`;
  grid.querySelectorAll('button[data-cid]').forEach(b => {
    const c = S.allClasses.find(x => x.id === b.dataset.cid);
    b.onclick = () => adminClassCardClick(c.id, c.name || '');
  });
}

window.showAdminClasses = () => {
  if (S.currentRole !== 'admin') return;
  hideAdminScreens();
  document.getElementById('tab-admin-classes').style.display = 'block';
  adminClassMode = null;
  renderAdminClassCards();
};

window.openClassFromAdmin = (id) => {
  S.currentClassTab = id;
  localStorage.setItem('attendanceClassTab', id);
  S.classFilter = id;
  adminClassChanged();
  renderClassChips();
  applyClassRestrictionUI();
  showClassHome();
};

function hideAllScreens() {
  stopVoice();
  stopTodayListeners();
  ['attendance','students','filters','messages','monitor','classservants'].forEach(t => document.getElementById('tab-'+t).style.display = 'none');
  hideAdminScreens();
  hideRolesScreen();
  document.getElementById('main-tabs').style.display = 'none';
  document.getElementById('global-class-tabs').style.display = 'none';
  document.getElementById('tab-home').style.display = 'none';
  const st = document.getElementById('section-title'); if (st) st.style.display = 'none';
}

// الرئيسية: الأدمن بيشوف (الفصول / الخدام)، وباقي الخدام بيشوفوا كروت فصلهم على طول
window.goHome = () => {
  hideAllScreens();
  const hdr = document.getElementById('class-home-header'); if (hdr) hdr.style.display = 'none';
  if (S.currentRole === 'admin') document.getElementById('tab-admin-home').style.display = 'block';
  else if (hasSupHome()) document.getElementById('tab-sup-home').style.display = 'block'; // المسؤول: الفصول / الخدام زي الأدمن
  else if (needsClassPick()) showClassPicker(); // الرئيسية للي عنده أكتر من فصل = يختار فصل من فصوله
  else showClassHome();
  applyMonitorVisibility();
};

// الخادم المتوزع على أكتر من فصل (مش أدمن) لازم يختار الفصل اللي داخله الأول
// المسؤول عن فصل (أو أكتر) بيبقى عنده رئيسية فيها "الفصول" و"الخدام" زي الأدمن
function hasSupHome() { return S.currentRole === 'supervisor' && normalizeAssignedClasses(S.currentSupervisorClass).length > 0; }

window.supOpenClasses = () => { if (needsClassPick()) showClassPicker(); else showClassHome(); };

function needsClassPick() { return S.currentRole !== 'admin' && getAllowedAssignedClasses().length > 1; }

export function renderClassPicker() {
  const grid = document.getElementById('pick-class-grid'); if (!grid) return;
  const esc = t => String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
  grid.innerHTML = getAllowedAssignedClasses().map(id => `
    <button class="admin-card" data-cid="${esc(id)}"><span class="ac-emoji">${esc(classEmoji(id))}</span>${esc(classLabel(id))}</button>`).join('');
  grid.querySelectorAll('button[data-cid]').forEach(b => { b.onclick = () => pickClass(b.dataset.cid); });
}

window.showClassPicker = () => {
  hideAllScreens();
  const hdr = document.getElementById('class-home-header'); if (hdr) hdr.style.display = 'none';
  renderClassPicker();
  document.getElementById('tab-pick-class').style.display = 'block';
  applyMonitorVisibility();
};

window.pickClass = (id) => {
  S.classPicked = true;
  S.currentClassTab = id;
  localStorage.setItem('attendanceClassTab', id);
  S.classFilter = id;
  adminClassChanged();
  renderClassChips();
  applyClassRestrictionUI();
  showClassHome();
};

window.classHomeBack = () => {
  if (S.currentRole === 'admin') showAdminClasses();
  else if (hasSupHome() && !needsClassPick()) goHome();
  else showClassPicker();
};

// كروت الفصل (الحضور / المخدومين / الافتقاد / الرسائل) — الأدمن بيوصلها بعد ما يختار فصل، والخادم المتوزع بعد ما يختار فصله
window.showClassHome = () => {
  hideAllScreens();
  const canGoBack = S.currentRole === 'admin' || needsClassPick() || hasSupHome();
  const hdr = document.getElementById('class-home-header');
  if (hdr) hdr.style.display = canGoBack ? 'block' : 'none';
  const back = document.getElementById('class-home-back'); if (back) back.textContent = (S.currentRole === 'admin' || (hasSupHome() && !needsClassPick())) ? '→ رجوع' : '→ تغيير الفصل';
  const t = document.getElementById('class-home-title'); if (t) t.textContent = classEmoji(S.currentClassTab) + ' ' + classLabel(S.currentClassTab);
  document.getElementById('tab-home').style.display = 'block';
  applyMonitorVisibility();
};

// ===== زرار الرجوع فوق: تاب (حضور/مخدومين/…) ← كروت الفصل ← اختيار الفصل (أو الفصول للأدمن) =====
function navLevel() {
  const shown = id => document.getElementById(id)?.style.display === 'block';
  if (shown('tab-admin-home')) return 'adminHome';
  if (shown('tab-sup-home')) return 'supHome';
  if (shown('tab-admin-classes')) return 'adminClasses';
  if (shown('tab-pick-class')) return 'picker';
  if (shown('tab-home')) return 'classHome';
  if (['attendance','students','filters','messages','monitor','classservants'].some(t => shown('tab-' + t))) return 'tab';
  return '';
}

function updateBackBtn() {
  const b = document.getElementById('top-back-btn'); if (!b) return;
  const lvl = navLevel();
  const canGoBack = S.currentRole === 'admin' || needsClassPick() || hasSupHome();
  const show = lvl === 'tab' || lvl === 'adminClasses' || lvl === 'picker' && hasSupHome() || (lvl === 'classHome' && canGoBack);
  b.style.display = show ? 'flex' : 'none';
}

window.goBack = () => {
  closeSettingsMenu();
  const lvl = navLevel();
  if (lvl === 'tab') {
    if (S.currentRole === 'admin' && document.getElementById('tab-monitor').style.display === 'block') goHome();
    else if (hasSupHome() && document.getElementById('tab-classservants').style.display === 'block') goHome(); // خدام المسؤول ← رئيسيته
    else showClassHome(); // يرجع لكروت الفصل (حضور/مخدومين/…) من غير ما يعدّي على كل الفصول
  }
  else if (lvl === 'classHome') classHomeBack();
  else if (lvl === 'picker' && hasSupHome()) goHome();
  else if (lvl === 'adminClasses') goHome();
};

{
  let backRaf = 0;
  const schedule = () => { cancelAnimationFrame(backRaf); backRaf = requestAnimationFrame(updateBackBtn); };
  const host = document.querySelector('.app-content');
  if (host) new MutationObserver(schedule).observe(host, { subtree: true, attributes: true, attributeFilter: ['style'] });
  schedule();
}

// زرار 🏠 في شريط التابات: الأدمن يرجع لكروت الفصل اللي فيه، والباقي للرئيسية
window.tabsHome = () => {
  if (S.currentRole === 'admin' && S.currentClassTab && document.getElementById('tab-monitor').style.display !== 'block') showClassHome();
  else if (hasSupHome() && document.getElementById('tab-classservants').style.display !== 'block' && S.currentClassTab) showClassHome();
  else goHome();
};

window.switchTab = async (tab) => {
  let tabKey = tab;
  if (tab === 'allclassservants') { tab = 'classservants'; S.classServScope = 'all'; }
  else if (tab === 'classservants') S.classServScope = 'class';
  if (tab !== 'attendance') { stopVoice(); stopTodayListeners(); }
  if (tab === 'monitor' && S.currentRole !== 'admin') return;
  if (tab === 'classservants' && S.currentRole !== 'supervisor') return;
  hideAdminScreens();
  document.getElementById('tab-home').style.display = 'none';
  document.getElementById('main-tabs').style.display = 'flex';
  document.getElementById('main-tabs').classList.add('home-only');
  {
    const allowedCls = getAllowedAssignedClasses();
    const single = S.currentRole !== 'admin' && allowedCls.length === 1;
    const showClassBar = tab !== 'monitor' && !(tab === 'classservants' && S.classServScope === 'all') && S.currentRole !== 'admin' && !single;
    document.getElementById('global-class-tabs').style.display = showClassBar ? '' : 'none';
    const titles = { attendance:'✅ الحضور', students:'🧒 المخدومين', filters:'📞 الافتقاد', messages:'📨 الرسائل' };
    const tb = document.getElementById('section-title');
    if (tb) {
      if (titles[tab]) {
        tb.textContent = (showClassBar ? '' : classEmoji(S.currentClassTab) + ' ' + classLabel(S.currentClassTab) + ' — ') + titles[tab];
        tb.style.display = 'block';
      } else tb.style.display = 'none';
    }
  }
  document.querySelectorAll('.tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabKey));
  ['attendance','students','filters','messages','monitor','classservants'].forEach(t => document.getElementById('tab-'+t).style.display = t === tab ? 'block' : 'none');
  if (tab === 'monitor') { loadMonitorTab(); return; }
  if (tab === 'classservants') { switchClassServSub('servants'); if (!S.servantsLoadedFlag) await loadServantsOnce(); renderClassServList(); return; }
  await ensureStudents();
  if (tab === 'attendance') { startTodayListeners(); updateStats(); renderTodayList(); }
  if (tab === 'students')  { renderClassChips(); renderStudentsList(); }
  if (tab === 'filters')   renderFilterList();
  if (tab === 'messages')  renderWaTab();
};

// تبديل تاب الفصل فوق خالص في شاشة الحضور (فصل أ / فصل ب / كي جي ١) — كل حاجة في الشاشة (الإحصائيات، البحث، قائمة اليوم) بترجع بس للفصل المختار
window.switchClassTab = (cls, btn) => {
  const allowed = getAllowedAssignedClasses();
  if (S.currentRole !== 'admin' && allowed.length && !allowed.includes(cls)) return;
  S.currentClassTab = cls;
  localStorage.setItem('attendanceClassTab', cls);
  S.classFilter = cls;
  adminClassChanged();
  renderClassChips();
  if (document.getElementById('tab-students')?.style.display === 'block') renderStudentsList();
  if (document.getElementById('tab-filters')?.style.display === 'block') renderFilterList();
  if (document.getElementById('tab-messages')?.style.display === 'block') renderWaTab();
  document.querySelectorAll('.class-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  updateStats();
  renderTodayList();
  updateStuCount();
  const input = document.getElementById('manual-input');
  if (input && input.value.trim()) onManualSearch();
  if (document.getElementById('tab-classservants')?.style.display === 'block' && S.classServScope === 'class') renderClassServAttList();
};

// لو الخادم متقيد بفصول معينة من الأدمن، نقفل شريط الفصول فوق على الفصول المسموح لها فقط،
// ولو مش متقيد (أو أدمن) يفضل شايف كل الفصول التلاتة زي ما هو معتاد
export function applyClassRestrictionUI() {
  const allowed = getAllowedAssignedClasses();
  const restricted = S.currentRole !== 'admin' && allowed.length > 0;
  if (restricted) {
    if (!allowed.includes(S.currentClassTab)) S.currentClassTab = allowed[0];
  } else if (!S.currentClassTab && S.allClasses.length) {
    const saved = localStorage.getItem('attendanceClassTab');
    S.currentClassTab = (saved && S.allClasses.some(c => c.id === saved)) ? saved : S.allClasses[0].id;
  }
  const bar = document.getElementById('global-class-tabs');
  if (bar) {
    bar.querySelectorAll('.class-tab').forEach(b => {
      if (b.id === 'class-tab-all') { b.style.display = S.currentRole === 'admin' ? '' : 'none'; b.classList.toggle('active', S.adminAllClasses && !S.adminAutoAll); return; }
      const cls = b.id.replace('class-tab-', '');
      const visible = !restricted || allowed.includes(cls);
      b.style.display = visible ? '' : 'none';
      b.classList.toggle('active', cls === S.currentClassTab);
      b.disabled = restricted && !allowed.includes(cls);
    });
  }
  // تبويب "المخدومين" بيعرض كل الفصول دايمًا، فشيبس فلتر الفصل تفضل ظاهرة حتى للخادم المقيّد
  // عشان يقدر يفلتر لفصله بس لو حب
}

window.applyClassRestrictionUI = applyClassRestrictionUI;
