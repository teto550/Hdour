// المستخدمين والأدوار (roles)
import { S } from '../core/state.js';
import { addDoc, arrayRemove, collection, db, deleteDoc, doc, updateDoc } from '../core/firebase.js';
import { normalizeArabic } from '../core/idb-cache.js';
import { countedGetDocs } from '../core/reads-counter.js';
import { loadServantsOnce, renderServantsList } from './class-servants.js';
import { classById, classLabel, nameKey, nameVariantsIn, normalizeAssignedClasses, permsAfterRoleChange, servantInRole, servantRoleIds, supervisedClassesOf, uniqueNames } from './classes.js';
import { pEnc } from './servant-profile.js';

// ===== المستخدمين والأدوار (roles) =====

let editingRoleId = ''; // '' = دور جديد

let editingRoleType = 'classServant'; // 'classServant' | 'classSupervisor' | 'admin'

let editingRoleClasses = []; // [classId,...]

let editingRoleMemberIds = []; // [servantId,...]

let editingRolePendingNames = []; // أسماء خدام لسه ملهمش حساب، هيلاقوا اسمهم وقت التسجيل ويختاروه

const ROLE_TYPE_LABELS = { classServant:'🧑‍🏫 خادم فصل', classSupervisor:'🗝️ مسؤول فصل', admin:'👑 أدمن' };

export const ROLE_TYPE_SHORT   = { classServant:'خادم فصل', classSupervisor:'مسؤول فصل', admin:'أدمن' };

window.closeRolesModal = () => {
  document.getElementById('tab-roles').style.display = 'none';
  if (S.rolesReturnTab) switchTab(S.rolesReturnTab); else goHome();
  S.rolesReturnTab = '';
};

export async function loadRolesOnce(force) {
  if (S.rolesLoadedFlag && !force) { renderRolesList(); return; }
  if (!S.servantsLoadedFlag) await loadServantsOnce();
  try {
    const snap = await countedGetDocs(collection(db,'roles'), 'roles (المستخدمين والأدوار)');
    S.allRoles = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    S.rolesLoadedFlag = true;
    renderRolesList();
    if (document.getElementById('monitor-subtab-servants')?.style.display === 'block') renderServantsList();
  } catch(e) { console.error(e); document.getElementById('roles-unassigned-list').innerHTML = `<div class="empty-state">تعذّر تحميل الأدوار</div>`; }
}

export function showRolesListView() {
  document.getElementById('roles-list-view').style.display = 'block';
  document.getElementById('role-editor-view').style.display = 'none';
  document.getElementById('roles-modal-title').textContent = 'المستخدمين والأدوار';
}

// فلتر الفصول فوق شاشة "المستخدمين والأدوار" — تدوس "تحديد فصل" فتظهر شرايط الفصول،
// تختار فصل أو أكتر، ويظهرلك تحت بس خدام الفصول اللي اخترتها (مع دور كل واحد جنب اسمه)
let rolesClassFilter = []; // [classId,...]

window.toggleRolesClassFilter = () => {
  const box = document.getElementById('roles-class-filter-chips');
  box.style.display = box.style.display === 'none' ? 'flex' : 'none';
  if (box.style.display === 'flex') renderRolesClassFilterChips();
};

function renderRolesClassFilterChips() {
  const box = document.getElementById('roles-class-filter-chips');
  box.innerHTML = S.allClasses.map(c => {
    const active = rolesClassFilter.includes(c.id);
    return `<button type="button" class="filter-chip ${active?'active':''}" onclick="toggleRolesClassFilterChip('${c.id}')">${c.emoji||'📘'} ${c.name}</button>`;
  }).join('');
}

window.toggleRolesClassFilterChip = (classId) => {
  rolesClassFilter = rolesClassFilter.includes(classId) ? rolesClassFilter.filter(x => x !== classId) : [...rolesClassFilter, classId];
  renderRolesClassFilterChips();
  renderRolesList();
};

// دوس على تعديل دور خادم فورمالي (عنده roleId) من جوه القايمة على طول
window.openRoleEditorFromList = (roleId, e) => {
  if (e) e.stopPropagation();
  openRoleEditor(roleId);
};

export function renderRolesList() {
  // مفيش قايمة أدوار منفصلة فوق ولا رسالة "لسه مفيش أدوار" — أي دور بيتوزع بيظهر على طول
  // في قايمة الفصول تحت — دوس على اسم أي خادم يفتحلك ملفه عادي زي باقي الخدام (من غير زرار قلم مخصوص)
  if (!rolesClassFilter.length) {
    document.getElementById('roles-unassigned-list').innerHTML = `<div class="empty-state" style="padding:16px">دوس "🔍 تحديد فصل" فوق واختار فصل أو أكتر عشان تشوف الخدام</div>`;
    return;
  }
  const approved = S.cachedServants.filter(s => (s.status === 'approved' || s.status === 'pending') && s.role !== 'admin');
  const roleRowHTML = (s, cid) => {
    const label = (s.status === 'pending' ? '⏳ بانتظار الموافقة · ' : '✅ مسجل · ') + (supervisedClassesOf(s).includes(cid) ? '🗝️ مسؤول فصل' : '🧑‍🏫 خادم فصل');
    return `<div class="servant-item" onclick="openServantProfile('${s.id}')" style="cursor:pointer;padding:9px 12px">
      <div class="s-info"><div class="s-name" style="font-size:13px">${s.name||'—'}</div></div>
      <span style="font-size:11px;color:var(--text-dim);flex-shrink:0;white-space:nowrap">${label}</span>
    </div>`;
  };
  // أسماء خدام مضافة مقدمًا في أدوار الفصل ده ولسه مسجلوش — بتظهر تحت الفصل برضه (وبتختفي أول ما يسجل الخادم ويتمسح الاسم من الدور)
  const escTxt = t => String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const pendingRowHTML = (n, cid) => {
    // مسؤولية الاسم في الفصل ده: مسؤول فصل لو مضاف في دور مسؤول لنفس الفصل، غير كده خادم فصل
    const isSup = S.allRoles.some(r => !r.isAdmin && r.isSupervisor && Array.isArray(r.classes) && r.classes.includes(cid) && (r.pendingNames || []).includes(n));
    return `<div class="servant-item" onclick="openPendingProfile(decodeURIComponent('${pEnc(n)}'))" style="cursor:pointer;padding:9px 12px;opacity:.75">
      <div class="s-info"><div class="s-name" style="font-size:13px">${escTxt(n)}</div></div>
      <span style="font-size:11px;color:var(--text-dim);flex-shrink:0;white-space:nowrap">⏳ لسه مسجلش حساب · ${isSup ? '🗝️ مسؤول فصل' : '🧑‍🏫 خادم فصل'}</span>
    </div>`;
  };
  const registeredNames = new Set(S.cachedServants.map(s => nameKey(s.name)));
  const html = rolesClassFilter.map(cid => {
    const c = classById(cid);
    // خادم بيظهر في الفصل ده لو الفصل ده من ضمن فصوله، أو لو مقيدش بفصول معينة أصلاً (شايف كل الفصول)
    const members = approved
      .filter(s => { const list = normalizeAssignedClasses(s.assignedClass); return !list.length || list.includes(cid); })
      .sort((a,b) => (a.name||'').localeCompare(b.name||'','ar'));
    const pending = uniqueNames(S.allRoles
      .filter(r => !r.isAdmin && Array.isArray(r.classes) && r.classes.includes(cid))
      .flatMap(r => r.pendingNames || []))
      .filter(n => !registeredNames.has(nameKey(n)))
      .sort((a,b) => a.localeCompare(b,'ar'));
    const total = members.length + pending.length;
    const title = `<div class="section-title" style="margin:14px 0 6px">${c?c.emoji||'📘':'📘'} ${c?c.name:cid} (${total})</div>`;
    if (!total) return title + `<div class="empty-state" style="padding:10px">مفيش خدام في الفصل ده</div>`;
    return title + members.map(m => roleRowHTML(m, cid)).join('') + pending.map(n => pendingRowHTML(n, cid)).join('');
  }).join('');
  document.getElementById('roles-unassigned-list').innerHTML = html;
}

window.openRoleEditor = (roleId) => {
  editingRoleId = roleId || '';
  const r = editingRoleId ? S.allRoles.find(x => x.id === editingRoleId) : null;
  editingRoleType = r ? (r.type || (r.isAdmin ? 'admin' : (r.isSupervisor ? 'classSupervisor' : 'classServant'))) : 'classServant';
  editingRoleClasses = (r && Array.isArray(r.classes)) ? [...r.classes] : [];
  editingRoleMemberIds = editingRoleId ? S.cachedServants.filter(s => servantInRole(s, editingRoleId)).map(s => s.id) : [];
  editingRolePendingNames = (r && Array.isArray(r.pendingNames)) ? [...r.pendingNames] : [];
  roleAutoAddedIds = [];
  roleAutoAddedPending = [];
  rolePurgeNames = [];
  roleDismissedPending = [];
  document.getElementById('roles-modal-title').textContent = r ? 'تعديل دور' : 'دور جديد';
  document.getElementById('role-delete-btn').style.display = r ? 'block' : 'none';
  document.getElementById('role-add-members-modal').style.display = 'none';
  renderRoleTypeChips();
  renderRoleClassChips();
  renderRoleMembersChips();
  renderRolePendingNames();
  updateRoleEffectHint();
  document.getElementById('roles-list-view').style.display = 'none';
  document.getElementById('role-editor-view').style.display = 'block';
};

window.closeRoleEditor = () => { showRolesListView(); renderRolesList(); };

window.setRoleType = (type) => {
  editingRoleType = type;
  // لو غيّرت النوع لمسؤول/أدمن: بنشيل أي خدام اتضافوا تلقائي بسبب اختيار الفصل — الصلاحيات دي لازم تتدي لناس بالاسم بس
  if (type !== 'classServant') {
    editingRoleMemberIds = editingRoleMemberIds.filter(id => !roleAutoAddedIds.includes(id));
    editingRolePendingNames = editingRolePendingNames.filter(n => !roleAutoAddedPending.includes(n));
    roleAutoAddedIds = []; roleAutoAddedPending = [];
    renderRoleMembersChips(); renderRolePendingNames();
  }
  renderRoleTypeChips(); renderRoleClassChips(); updateRoleEffectHint();
};

function renderRoleTypeChips() {
  document.getElementById('role-type-chips').innerHTML = Object.keys(ROLE_TYPE_LABELS).map(t =>
    `<button type="button" class="filter-chip ${editingRoleType===t?'active':''}" onclick="setRoleType('${t}')">${ROLE_TYPE_LABELS[t]}</button>`).join('');
  document.getElementById('role-classes-section').style.display = editingRoleType === 'admin' ? 'none' : 'block';
  document.getElementById('role-pending-names-section').style.display = editingRoleType === 'admin' ? 'none' : 'block';
}

function renderRoleClassChips() {
  const cont = document.getElementById('role-classes-chips');
  if (editingRoleType === 'admin') { cont.innerHTML = ''; return; }
  if (!S.allClasses.length) { cont.innerHTML = `<div class="empty-state" style="padding:10px">لسه مفيش فصول متضافة</div>`; return; }
  cont.innerHTML = S.allClasses.map(c => {
    const active = editingRoleClasses.includes(c.id);
    return `<button type="button" class="filter-chip ${active?'active':''}" onclick="toggleRoleClass('${c.id}')">${c.emoji||'📘'} ${c.name}</button>`;
  }).join('');
}

// في الدور الجديد بس: أول ما تختار فصل، خدام الفصل ده بيتضافوا لخانة الأعضاء تلقائي (وتقدر تشيل أي حد بالـ ✕)،
// ولو شلت الفصل بيتشال معاه الخدام اللي اتضافوا بسببه (إلا لو تبع فصل تاني لسه مختاره)
let roleAutoAddedIds = [];

let roleAutoAddedPending = []; // أسماء لسه مسجلتش اتضافت تلقائي بسبب اختيار فصل

let rolePurgeNames = []; // أسماء مسحها الأدمن ووافق يتمسحوا من كل الأدوار التانية كمان (بيتنفذ عند الحفظ)

let roleDismissedPending = []; // أسماء اتمسحت في الجلسة دي — منرجعش نضيفها تلقائي لو الفصل اتختار تاني

// أسماء مضافة مقدمًا (لسه مسجلوش) في أي دور تاني للفصل ده
function rolePendingNamesForClass(classId) {
  const registered = new Set(S.cachedServants.map(x => nameKey(x.name)));
  return uniqueNames(S.allRoles
    .filter(r => !r.isAdmin && r.id !== editingRoleId && Array.isArray(r.classes) && r.classes.includes(classId))
    .flatMap(r => r.pendingNames || []))
    .filter(n => !registered.has(nameKey(n)));
}

function roleClassServantIds(classId) {
  return S.cachedServants
    .filter(s => s.status === 'approved' && s.role !== 'admin' && normalizeAssignedClasses(s.assignedClass).includes(classId))
    .map(s => s.id);
}

window.toggleRoleClass = (classId) => {
  const wasActive = editingRoleClasses.includes(classId);
  editingRoleClasses = wasActive ? editingRoleClasses.filter(x => x !== classId) : [...editingRoleClasses, classId];
  // الإضافة التلقائية لكل خدام الفصل بتحصل لدور "خادم فصل" بس — مسؤول الفصل والأدمن بيتضاف ليهم ناس بالاسم بس
  if (!editingRoleId && editingRoleType === 'classServant') {
    if (!wasActive) {
      roleClassServantIds(classId).forEach(id => {
        if (!editingRoleMemberIds.includes(id)) { editingRoleMemberIds.push(id); roleAutoAddedIds.push(id); }
      });
      // مبننسخش الأسماء اللي لسه مسجلتش من أدوار تانية — الاسم بيفضل في دوره الأصلي بس، عشان ميتكررش في القايمة
    } else {
      const stillCovered = new Set(editingRoleClasses.flatMap(roleClassServantIds));
      const toRemove = roleAutoAddedIds.filter(id => !stillCovered.has(id));
      editingRoleMemberIds = editingRoleMemberIds.filter(id => !toRemove.includes(id));
      roleAutoAddedIds = roleAutoAddedIds.filter(id => !toRemove.includes(id));
      const stillPending = new Set(editingRoleClasses.flatMap(rolePendingNamesForClass));
      const pendRemove = roleAutoAddedPending.filter(n => !stillPending.has(n));
      editingRolePendingNames = editingRolePendingNames.filter(n => !pendRemove.includes(n));
      roleAutoAddedPending = roleAutoAddedPending.filter(n => !pendRemove.includes(n));
    }
    renderRoleMembersChips();
    renderRolePendingNames();
  }
  renderRoleClassChips();
  updateRoleEffectHint();
};

window.openRoleAddMembersModal = () => {
  document.getElementById('role-add-members-search').value = '';
  renderRoleAddMemberResults();
  document.getElementById('role-add-members-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('role-add-members-search').focus(), 50);
};

window.closeRoleAddMembersModal = () => {
  document.getElementById('role-add-members-modal').style.display = 'none';
  document.body.style.overflow = '';
  renderRoleMembersChips();
  renderRolePendingNames();
  updateRoleEffectHint();
};

window.closeRoleAddMembersOutside = (e) => { if (e.target.id === 'role-add-members-modal') closeRoleAddMembersModal(); };

window.renderRoleAddMemberResults = () => {
  const q = normalizeArabic(document.getElementById('role-add-members-search')?.value || '');
  const cont = document.getElementById('role-add-members-results');
  const escTxt = t => String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const registered = S.cachedServants
    .filter(s => s.status === 'approved' && (editingRoleType === 'admin' || s.role !== 'admin') && (!q || normalizeArabic(s.name||'').includes(q)))
    .map(s => ({ kind:'reg', id:s.id, name:s.name||'—' }));
  // الأسماء اللي لسه مسجلتش حساب: كل الأسماء المضافة مقدمًا في أي دور (ماعدا دور الأدمن) + اللي اتضافت في الدور ده دلوقتي
  let pending = [];
  if (editingRoleType !== 'admin') {
    const regKeys = new Set(S.cachedServants.map(x => nameKey(x.name)));
    pending = uniqueNames([
      ...editingRolePendingNames,
      ...S.allRoles.filter(r => !r.isAdmin).flatMap(r => r.pendingNames || [])
    ])
      .filter(n => !regKeys.has(nameKey(n)) && (!q || normalizeArabic(n).includes(q)))
      .map(n => ({ kind:'pend', name:n }));
  }
  const results = [...registered, ...pending].sort((a,b) => (a.name||'').localeCompare(b.name||'','ar'));
  document.getElementById('role-add-members-selected-count').textContent = editingRoleMemberIds.length + editingRolePendingNames.length;
  cont.innerHTML = results.length ? results.map(it => {
    if (it.kind === 'reg') {
      const selected = editingRoleMemberIds.includes(it.id);
      return `<div class="servant-item" onclick="toggleRoleMemberSelection('${it.id}')" style="cursor:pointer;padding:9px 12px">
        <input type="checkbox" ${selected ? 'checked' : ''} onclick="event.stopPropagation();toggleRoleMemberSelection('${it.id}')" style="width:18px;height:18px;accent-color:var(--accent);flex-shrink:0;margin-left:10px">
        <div class="s-info"><div class="s-name" style="font-size:13px">${escTxt(it.name)}</div></div>
      </div>`;
    }
    const selected = editingRolePendingNames.some(x => nameKey(x) === nameKey(it.name));
    const inRoles = S.allRoles.filter(r => !r.isAdmin && r.id !== editingRoleId && nameVariantsIn(r, it.name).length).map(r => r.name);
    const arg = `decodeURIComponent('${pEnc(it.name)}')`;
    return `<div class="servant-item" onclick="toggleRolePendingSelection(${arg})" style="cursor:pointer;padding:9px 12px;opacity:.85">
      <input type="checkbox" ${selected ? 'checked' : ''} onclick="event.stopPropagation();toggleRolePendingSelection(${arg})" style="width:18px;height:18px;accent-color:var(--accent);flex-shrink:0;margin-left:10px">
      <div class="s-info"><div class="s-name" style="font-size:13px">${escTxt(it.name)}</div>${inRoles.length ? `<div style="font-size:10px;color:var(--text-dim)">مضاف في: ${escTxt(inRoles.join(' ، '))}</div>` : ''}</div>
      <span style="font-size:11px;color:var(--text-dim);flex-shrink:0;white-space:nowrap">⏳ لسه مسجلش</span>
    </div>`;
  }).join('') : `<div class="empty-state" style="padding:14px">مفيش نتايج</div>`;
};

window.toggleRoleMemberSelection = (id) => {
  editingRoleMemberIds = editingRoleMemberIds.includes(id)
    ? editingRoleMemberIds.filter(x => x !== id)
    : [...editingRoleMemberIds, id];
  renderRoleAddMemberResults();
};

window.toggleRolePendingSelection = (name) => {
  const k = nameKey(name);
  if (editingRolePendingNames.some(x => nameKey(x) === k)) {
    editingRolePendingNames = editingRolePendingNames.filter(x => nameKey(x) !== k);
    roleAutoAddedPending = roleAutoAddedPending.filter(x => nameKey(x) !== k);
  } else {
    editingRolePendingNames.push(name);
    rolePurgeNames = rolePurgeNames.filter(x => nameKey(x) !== k);
    roleDismissedPending = roleDismissedPending.filter(x => nameKey(x) !== k);
  }
  renderRoleAddMemberResults();
};

window.removeRoleMember = (id) => {
  editingRoleMemberIds = editingRoleMemberIds.filter(x => x !== id);
  roleAutoAddedIds = roleAutoAddedIds.filter(x => x !== id);
  renderRoleMembersChips();
  updateRoleEffectHint();
};

function renderRoleMembersChips() {
  document.getElementById('role-members-count').textContent = editingRoleMemberIds.length + editingRolePendingNames.length;
  const cont = document.getElementById('role-members-chips');
  if (!editingRoleMemberIds.length && !editingRolePendingNames.length) { cont.innerHTML = `<div class="empty-state" style="padding:10px">لسه مفيش أعضاء في الدور ده</div>`; return; }
  const escTxt = t => String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const registeredChips = editingRoleMemberIds.map(id => {
    const s = S.cachedServants.find(x => x.id === id);
    return `<span class="filter-chip active" style="display:flex;align-items:center;gap:6px">${s ? (s.name||'؟') : '؟'}
      <span onclick="removeRoleMember('${id}')" style="cursor:pointer;font-weight:900">✕</span></span>`;
  });
  // أسماء لسه مسجلتش (من قايمة الأسماء المضافة مقدمًا) — بتظهر مع الأعضاء بعلامة ⏳
  const pendingChips = editingRolePendingNames.slice().sort((a,b) => a.localeCompare(b,'ar')).map(n =>
    `<span class="filter-chip active" style="display:flex;align-items:center;gap:6px;opacity:.8">⏳ ${escTxt(n)}
      <span onclick="removeRolePendingName('${n.replace(/'/g,"\\'")}')" style="cursor:pointer;font-weight:900">✕</span></span>`);
  cont.innerHTML = [...registeredChips, ...pendingChips].join('');
}

function updateRoleEffectHint() {
  document.getElementById('role-effect-hint').innerHTML = `التغيير ده هيأثر على <b>${editingRoleMemberIds.length}</b> شخص دلوقتي${editingRolePendingNames.length ? ` (+ ${editingRolePendingNames.length} لسه مسجلوش، هيتطبق عليهم أول ما يسجلوا)` : ''}`;
}

// أسماء خدام مضافين مقدمًا في الدور ده لسه ملهمش حساب — لما أي حد يسجل ويختار نفس الفصل، هيلاقي اسمه في القايمة ويختاره بدل ما يكتب اسم جديد
function renderRolePendingNames() {
  const cont = document.getElementById('role-pending-names-list');
  if (!cont) return;
  if (!editingRolePendingNames.length) { cont.innerHTML = `<div class="empty-state" style="padding:10px">لسه مفيش أسماء مضافة</div>`; return; }
  cont.innerHTML = editingRolePendingNames.slice().sort((a,b) => a.localeCompare(b,'ar')).map(n => `
    <div class="tpl-chip">
      <span class="tpl-chip-name">${n}</span>
      <button class="tpl-chip-del" onclick="removeRolePendingName('${n.replace(/'/g,"\\'")}')" title="حذف">✕</button>
    </div>`).join('');
}

window.addRolePendingName = () => {
  const name = (prompt('اسم الخادم اللي لسه هيسجل؟') || '').replace(/\s+/g,' ').trim();
  if (!name) return;
  if (editingRolePendingNames.some(x => nameKey(x) === nameKey(name))) { showToast('الاسم ده مضاف فعلاً في الدور ده', 'error'); return; }
  const dupRoles = S.allRoles.filter(r => r.id !== editingRoleId && !r.isAdmin && nameVariantsIn(r, name).length && (r.classes || []).some(c => editingRoleClasses.includes(c)));
  if (dupRoles.length && !confirm(`الاسم \"${name}\" مضاف قبل كده في: ${dupRoles.map(r => r.name).join(' ، ')}\n\nتضيفه هنا كمان؟ (لو ده نفس الشخص الأفضل تشيله من الدور التاني)`)) return;
  editingRolePendingNames.push(name);
  rolePurgeNames = rolePurgeNames.filter(x => x !== name);
  roleDismissedPending = roleDismissedPending.filter(x => x !== name);
  renderRolePendingNames();
  renderRoleMembersChips();
  updateRoleEffectHint();
};

window.removeRolePendingName = (name) => {
  // لو الاسم ده مضاف كمان في أدوار تانية، هيرجع يظهر تلقائي كل مرة تختار الفصل ده — فبنسأل لو عايز يتمسح من الكل
  const others = S.allRoles.filter(r => r.id !== editingRoleId && (r.pendingNames || []).includes(name));
  if (others.length && confirm(`الاسم "${name}" مضاف كمان في: ${others.map(r => r.name).join(' ، ')}\n\nتمسحه من كل الأدوار دي كمان (بعد الحفظ)؟\nموافق = يتمسح نهائي | إلغاء = يتشال من الدور ده بس`)) {
    if (!rolePurgeNames.includes(name)) rolePurgeNames.push(name);
  }
  if (!roleDismissedPending.includes(name)) roleDismissedPending.push(name);
  editingRolePendingNames = editingRolePendingNames.filter(x => x !== name);
  roleAutoAddedPending = roleAutoAddedPending.filter(x => x !== name);
  renderRolePendingNames();
  renderRoleMembersChips();
  updateRoleEffectHint();
};

window.saveRole = async () => {
  if (editingRoleType !== 'admin' && !editingRoleClasses.length) { showToast('اختار الفصل / الفصول الأول', 'error'); return; }
  const isAdmin = editingRoleType === 'admin';
  const isSupervisor = editingRoleType === 'classSupervisor';
  const classesLabel = isAdmin ? '' : editingRoleClasses.map(c => classLabel(c)).join(' + ');
  const name = isAdmin ? 'أدمن' : `${ROLE_TYPE_SHORT[editingRoleType]} — ${classesLabel}`;
  // حماية: أي دور مسؤول/أدمن لازم تشوف بالظبط مين هياخد الصلاحية قبل الحفظ
  const oldRole = editingRoleId ? S.allRoles.find(r => r.id === editingRoleId) : null;
  if (isAdmin || isSupervisor) {
    const prevIds = editingRoleId ? S.cachedServants.filter(s => servantInRole(s, editingRoleId)).map(s => s.id) : [];
    const wasPrivileged = !!(oldRole && (oldRole.isAdmin || oldRole.isSupervisor));
    const affected = editingRoleMemberIds.filter(id => wasPrivileged ? !prevIds.includes(id) : true);
    if (affected.length) {
      const names = affected.map(id => (S.cachedServants.find(x => x.id === id)?.name) || '؟');
      const shown = names.slice(0, 15).join(' ، ') + (names.length > 15 ? ` … (+${names.length - 15})` : '');
      if (!confirm(`الصلاحية دي (${ROLE_TYPE_SHORT[editingRoleType]}) هتتدي لـ ${names.length} شخص:\n\n${shown}\n\nمتأكد؟`)) return;
    }
  }
  try {
    const data = { name, type: editingRoleType, isAdmin, isSupervisor, classes: isAdmin ? [] : editingRoleClasses, pendingNames: isAdmin ? [] : uniqueNames(editingRolePendingNames) };
    let roleId = editingRoleId;
    if (roleId) await updateDoc(doc(db,'roles',roleId), data);
    else { const ref = await addDoc(collection(db,'roles'), data); roleId = ref.id; }

    // خدام كانوا في الدور ده وشيلتهم من قايمة الأعضاء دلوقتي: بنشيل عنهم الدور ده، ولو لسه ليهم أدوار تانية بنعيد حساب صلاحياتهم منها،
    // ولو ملهمش أي دور تاني بنسيب صلاحياتهم الحالية زي ما هي
    const previousMemberIds = S.cachedServants.filter(s => servantInRole(s, roleId)).map(s => s.id);
    const removed = previousMemberIds.filter(id => !editingRoleMemberIds.includes(id));
    const rolesNow = [...S.allRoles.filter(r => r.id !== roleId), { id: roleId, ...data }];
    const liveIds = ids => ids.filter(i => rolesNow.some(r => r.id === i));
    const ops = [];
    removed.forEach(id => {
      const sv = S.cachedServants.find(x => x.id === id); if (!sv) return;
      const ids = liveIds(servantRoleIds(sv).filter(x => x !== roleId));
      // بنسحب منه بس اللي كان واخده من الدور ده (مسؤولية/أدمن)، وبنسيب باقي صلاحياته
      const upd = { roleIds: ids, roleId: ids[0] || '', ...permsAfterRoleChange(sv, ids, rolesNow, oldRole || { id: roleId, ...data }) };
      ops.push(updateDoc(doc(db,'servants',id), upd));
    });
    // الأعضاء: الدور بيتضاف لأدوارهم (مش بيستبدلها)، فالخادم يقدر يبقى مسؤول في فصل وخادم في فصل تاني
    editingRoleMemberIds.forEach(id => {
      const sv = S.cachedServants.find(x => x.id === id); if (!sv) return;
      const ids = liveIds(servantRoleIds(sv));
      if (!ids.includes(roleId)) ids.push(roleId);
      ops.push(updateDoc(doc(db,'servants',id), { roleIds: ids, roleId: ids[0], ...permsAfterRoleChange(sv, ids, rolesNow) }));
    });
    await Promise.all(ops);

    // أسماء الأدمن قرر يمسحها نهائي: بتتشال من أي دور تاني لسه شايلها (إلا لو اتضافت تاني في الدور ده)
    for (const n of rolePurgeNames.filter(n => !editingRolePendingNames.includes(n))) {
      for (const r of S.allRoles.filter(r => r.id !== roleId && (r.pendingNames || []).includes(n))) {
        await updateDoc(doc(db,'roles',r.id), { pendingNames: arrayRemove(n) });
      }
    }
    rolePurgeNames = [];

    showToast('تم حفظ الدور ✓', 'success');
    await loadServantsOnce(true);
    await loadRolesOnce(true);
    showRolesListView();
  } catch(e) { console.error(e); showToast('حصل خطأ أثناء الحفظ', 'error'); }
};

window.deleteRoleConfirm = async () => {
  if (!editingRoleId) return;
  const r = S.allRoles.find(x => x.id === editingRoleId);
  if (!confirm(`هتحذف دور "${r?.name||''}"؟ الأعضاء بتوعه مش هيتحذفوا، بس هتتسحب منهم صلاحية الدور ده (مسؤول فصل / أدمن) وهيفضلوا خدام في فصولهم`)) return;
  try {
    const delId = editingRoleId;
    const rolesLeft = S.allRoles.filter(x => x.id !== delId);
    await Promise.all(S.cachedServants.filter(s => servantInRole(s, delId)).map(sv => {
      const ids = servantRoleIds(sv).filter(x => x !== delId && rolesLeft.some(rr => rr.id === x));
      return updateDoc(doc(db,'servants',sv.id), { roleIds: ids, roleId: ids[0] || '', ...permsAfterRoleChange(sv, ids, rolesLeft, r || { id: delId }) });
    }));
    await deleteDoc(doc(db,'roles',editingRoleId));
    showToast('تم حذف الدور', 'info');
    await loadServantsOnce(true);
    await loadRolesOnce(true);
    showRolesListView();
  } catch(e) { console.error(e); showToast('حصل خطأ أثناء الحذف', 'error'); }
};
