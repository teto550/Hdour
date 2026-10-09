// قايمة الإعدادات المنسدلة (⚙️) + شاشة الإعدادات + قايمة الخدام
import { S } from '../core/state.js';
import { db, doc, updateDoc } from '../core/firebase.js';
import { normalizeArabic } from '../core/idb-cache.js';
import { stopTodayListeners } from './attendance.js';
import { isPrimaryAdmin } from './auth.js';
import { refreshBioSettings } from './biometric.js';
import { formatAssignedClasses, normalizeAssignedClasses, servantRoleIds } from './classes.js';
import { hideAdminScreens } from './navigation.js';
import { loadRolesOnce, showRolesListView } from './users-roles.js';

// ===== قايمة الإعدادات المنسدلة (⚙️) =====
window.toggleSettingsMenu = (e) => {
  if (e) e.stopPropagation();
  const dd = document.getElementById('settings-dropdown');
  const opening = dd.style.display === 'none';
  document.getElementById('settings-dropdown-roles').style.display = (opening && S.currentRole === 'admin') ? 'flex' : 'none';
  dd.style.display = opening ? 'block' : 'none';
  if (opening) document.addEventListener('click', closeSettingsMenuOutside);
};

window.closeSettingsMenu = () => { document.getElementById('settings-dropdown').style.display = 'none'; document.removeEventListener('click', closeSettingsMenuOutside); };

function closeSettingsMenuOutside(e) { if (!e.target.closest('.settings-menu-wrap')) window.closeSettingsMenu(); }

// ===== شاشة الإعدادات — الهيدر مشترك (ملفي + الأدمن) =====
export function fillSettingsHeader() {
  document.getElementById('settings-avatar').textContent = (S.currentName||'؟').trim()[0] || '؟';
  document.getElementById('settings-name').textContent = S.currentName || '—';
  document.getElementById('settings-email').textContent = S.currentEmail || '';
}

// "ملفي" — بيانات الخادم نفسه بس (اسمه، تليفونه، عنوانه) وتقدر تعدّلها — بيظهر لكل الخدام والأدمن
window.openMyProfileModal = () => {
  closeSettingsMenu();
  fillSettingsHeader();
  document.getElementById('settings-class-badge').innerHTML = S.currentAssignedClass
    ? formatAssignedClasses(S.currentAssignedClass).split(' + ').map(l => `<span class="class-badge">${l}</span>`).join(' ')
    : `<span class="class-badge" style="background:rgba(46,204,113,0.12);border:1px solid rgba(46,204,113,0.3);color:#2ecc71">🔓 كل الفصول</span>`;
  document.getElementById('settings-name-input').value = S.currentName || '';
  document.getElementById('settings-phone').value = S.currentPhone || '';
  document.getElementById('settings-address').value = S.currentAddress || '';
  document.getElementById('settings-profile-section').style.display = 'block';
  document.getElementById('settings-admin-section').style.display = 'none';
  refreshBioSettings();
  document.getElementById('settings-modal').style.display = 'flex';
};

// "المستخدمين والأدوار" — شاشة الأدوار (اسم + صلاحية أدمن + فصول + أعضاء)، للأدمن بس
window.openUsersRolesModal = () => {
  closeSettingsMenu();
  if (S.currentRole !== 'admin') return;
  const homeVisible = document.getElementById('tab-home').style.display !== 'none' || document.getElementById('tab-admin-home').style.display !== 'none' || document.getElementById('tab-admin-classes').style.display !== 'none';
  const activeBtn = document.querySelector('#main-tabs .tab.active[data-tab]');
  S.rolesReturnTab = homeVisible ? '' : (activeBtn ? activeBtn.dataset.tab : '');
  stopVoice(); stopTodayListeners();
  document.getElementById('tab-home').style.display = 'none';
  document.getElementById('main-tabs').style.display = 'none';
  document.getElementById('global-class-tabs').style.display = 'none';
  { const st = document.getElementById('section-title'); if (st) st.style.display = 'none'; }
  ['attendance','students','filters','messages','monitor','classservants'].forEach(t => document.getElementById('tab-'+t).style.display = 'none');
  hideAdminScreens();
  document.getElementById('tab-roles').style.display = 'block';
  showRolesListView();
  loadRolesOnce();
};

window.closeSettingsModal = () => { document.getElementById('settings-modal').style.display = 'none'; };

window.closeSettingsOutside = (e) => { if (e.target.id === 'settings-modal') closeSettingsModal(); };

// بتفتح شاشة الأدوار وتوديك على طول لدور خادم معين — مستخدمة من زرار "🗂 دوره" في قايمة الخدام
window.openServantRoleFromSettings = async (roleId) => {
  closeSettingsModal();
  openUsersRolesModal();
  await loadRolesOnce();
  openRoleEditor(roleId);
};

window.saveOwnSettings = async () => {
  const name = document.getElementById('settings-name-input').value.trim().replace(/\s+/g, ' ');
  const phone = document.getElementById('settings-phone').value.trim();
  const address = document.getElementById('settings-address').value.trim();
  if (!name) { showToast('اكتب اسمك الأول', 'error'); return; }
  const payload = { phone, address };
  if (name !== S.currentName) payload.name = name;
  try {
    await updateDoc(doc(db,'servants',S.currentUid), payload);
    S.currentPhone = phone; S.currentAddress = address;
    if (payload.name) {
      S.currentName = name;
      fillSettingsHeader();
      const sv = S.cachedServants.find(x => x.id === S.currentUid); if (sv) sv.name = name;
    }
    showToast('تم حفظ بياناتك ✓', 'success');
  } catch(e) { console.error(e); showToast('حصل خطأ أثناء الحفظ', 'error'); }
};

// ---- الأدوار (بريسيتس فصول جاهزة تتطبق على أكتر من خادم مرة واحدة) ----
// ---- قايمة الخدام (بحث بالاسم + ترقية/تنزيل أدمن — تغيير الفصل/النوع بقى بس من شاشة "الأدوار") ----
export function renderSettingsPeopleList() {
  const cont = document.getElementById('settings-people-list');
  if (!cont) return;
  const q = normalizeArabic(document.getElementById('settings-people-search')?.value || '');
  const list = S.cachedServants.filter(s => s.status === 'approved' && (!q || normalizeArabic(s.name||'').includes(q)))
    .sort((a,b) => (a.name||'').localeCompare(b.name||'','ar'));
  if (!list.length) { cont.innerHTML = `<div class="empty-state" style="padding:10px">مفيش خادم بالاسم ده</div>`; return; }
  const viewerIsPrimary = isPrimaryAdmin(S.currentEmail);
  cont.innerHTML = list.map(s => {
    const assigned = normalizeAssignedClasses(s.assignedClass);
    const nameEsc = (s.name||'').replace(/'/g,"\\'");
    const sIsPrimary = isPrimaryAdmin(s.email);
    let adminBtn = '';
    if (s.role === 'admin') {
      adminBtn = sIsPrimary
        ? `<span class="s-sub" style="white-space:nowrap">👑 الأدمن الأساسي</span>`
        : (viewerIsPrimary ? `<button class="action-btn" onclick="demoteServant('${s.id}','${nameEsc}')">🔻 شيله من الأدمن</button>` : `<span class="s-sub">👑 أدمن</span>`);
    } else {
      adminBtn = `<button class="action-btn" onclick="promoteServant('${s.id}','${nameEsc}')">👑 خليه أدمن</button>`;
    }
    return `<div class="servant-item" style="flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--border)">
      <div class="s-info">
        <div class="s-name">${s.name||'—'}${s.role==='admin'?' 👑':s.role==='supervisor'?' 🗝️':''}</div>
        <div class="s-sub">${assigned.length ? formatAssignedClasses(s.assignedClass) : 'كل الفصول'}</div>
      </div>
      ${adminBtn}
      ${servantRoleIds(s).map((rid, i, arr) => `<button class="action-btn" onclick="openServantRoleFromSettings('${rid}')">🗂 ${arr.length > 1 ? (S.allRoles.find(r => r.id === rid)?.name || 'دور ' + (i+1)) : 'دوره'}</button>`).join('')}
    </div>`;
  }).join('');
}

export const NOTE_LABELS = {
  traveling:   { emoji:'🧳', text:'مسافر' },
  friday:      { emoji:'📅', text:'بيحضر يوم الجمعة' },
  otherChurch: { emoji:'⛪', text:'بيحضر في كنيسة تانية' },
  motherPregnant: { emoji:'🤰', text:'الأم حامل' },
  noReason:    { emoji:'❓', text:'بدون سبب' }
};

// تحويل تاريخ لصيغة YYYY-MM-DD بالتوقيت المحلي (من غير تحويل لـ UTC عشان ميبوظش التاريخ قرب نص الليل)
export function toLocalDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// تاريخ الحضور بيتسجل دايماً تحت تاريخ يوم الخميس بتاع نفس الأسبوع (الأسبوع بيبدأ سبت الصبح ويخلص جمعة بالليل)
// الحضور: بيتصفّر كل يوم سبت الصبح (سبت → أربع بيتحسبوا على الخميس اللي جاي)
export const todayKey = () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 1) % 7) + 5); // رجوع لأقرب سبت، وبعدين 5 أيام لقدام = خميس الأسبوع ده
  return toLocalDateKey(d);
};

// الآيات: أسبوعها من السبت الصبح لحد الجمعة بالليل، والقايمة بترجع فاضية كل يوم سبت.
// وبتتسجل على حضور الأسبوع اللي قبله = تاريخ الخميس اللي قبل السبت بتاع الأسبوع ده (سبت 03/10 → جمعة 09/10 = خميس 01/10).
// التسجيل مفتوح طول الأسبوع.
export const verseKey = () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 1) % 7) - 2); // رجوع لأقرب سبت، وبعدين يومين لورا = خميس
  return toLocalDateKey(d);
};

export const verseOpen = () => true;

export const VERSE_CLOSED_MSG = 'تسجيل الآية مقفول';
