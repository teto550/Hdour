// ملف الخادم (من تبويب المتابعة) + ملف خادم لسه مسجلش
import { S } from '../core/state.js';
import { addDoc, arrayRemove, arrayUnion, collection, db, doc, updateDoc } from '../core/firebase.js';
import { isPrimaryAdmin } from './auth.js';
import { patchServantLocal } from './class-servants.js';
import { classBadgeHTML, classLabel, nameVariantsIn, normalizeAssignedClasses, servantRoleIds, supervisedClassesOf } from './classes.js';
import { ROLE_TYPE_SHORT, loadRolesOnce, renderRolesList } from './users-roles.js';

// ===== ملف الخادم (بيفتح لما تدوس على اسمه في تبويب "متابعة") =====
let servantProfileId = '';

// شارات فصول الخادم في ملفه: كل فصل هو فيه + دوره الحالي فيه + زرار يبدّل دوره + زرار ينقله لفصل تاني (كله للخادم ده بس، من غير ما يأثر على باقي الخدام)
function renderServantProfileClassChips(s) {
  const box = document.getElementById('sprof-class-chips');
  const assigned = normalizeAssignedClasses(s.assignedClass);
  if (!assigned.length) {
    box.innerHTML = `<span class="class-badge" style="background:rgba(46,204,113,0.12);border:1px solid rgba(46,204,113,0.3);color:#2ecc71">🔓 كل الفصول</span>`;
    return;
  }
  const sup = supervisedClassesOf(s);
  const canEdit = S.currentRole === 'admin' && s.role !== 'admin';
  const free = S.allClasses.filter(c => !assigned.includes(c.id));
  box.innerHTML = assigned.map(cid => {
    const isSup = sup.includes(cid);
    const btns = canEdit ? `
      <button class="action-btn" onclick="setServantClassRole('${s.id}','${cid}',${!isSup})">${isSup ? '🧑‍🏫 خليه خادم' : '🗝️ خليه مسؤول'}</button>
      <button class="action-btn" onclick="openServantClassPicker('${s.id}','${cid}')">🔁 فصل تاني</button>` : '';
    return `<span style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap">${classBadgeHTML(cid)}<span style="font-size:11px;color:var(--text-dim)">${isSup ? '🗝️ مسؤول فصل' : '🧑‍🏫 خادم فصل'}</span>${btns}</span>`;
  }).join('') + (canEdit && free.length ? `<button class="action-btn" onclick="openServantClassPicker('${s.id}','')">➕ ضيف فصل</button>` : '');
}

// بيطبّق خريطة (فصول الخادم + مين مسؤول فيها) على الخادم ده لوحده: بيلاقي/يعمل دور لكل نوع (نوع + فصول بالظبط) وبيربطه بيه،
// ومبنلمسش أي دور قديم فباقي الخدام مش بيتأثروا
async function applyServantClassMap(sid, classes, supSet) {
  if (!S.rolesLoadedFlag) await loadRolesOnce();
  const supList = classes.filter(c => supSet.has(c));
  const srvList = classes.filter(c => !supSet.has(c));
  const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
  const newRoleIds = [];
  for (const [type, cls] of [['classSupervisor', supList], ['classServant', srvList]]) {
    if (!cls.length) continue;
    let r = S.allRoles.find(x => !x.isAdmin && (x.type || (x.isSupervisor ? 'classSupervisor' : 'classServant')) === type && Array.isArray(x.classes) && sameSet(x.classes, cls));
    if (!r) {
      const data = { name: `${ROLE_TYPE_SHORT[type]} — ${cls.map(c => classLabel(c)).join(' + ')}`, type, isAdmin: false, isSupervisor: type === 'classSupervisor', classes: cls, pendingNames: [] };
      const ref = await addDoc(collection(db,'roles'), data);
      r = { id: ref.id, ...data };
      S.allRoles.push(r);
    }
    newRoleIds.push(r.id);
  }
  const svPatch = {
    roleIds: newRoleIds, roleId: newRoleIds[0] || '',
    role: supList.length ? 'supervisor' : 'servant',
    assignedClass: classes.join(','), supervisorClass: supList.join(',')
  };
  await updateDoc(doc(db,'servants',sid), svPatch);
  await patchServantLocal(sid, svPatch);
  await loadRolesOnce(true);
  openServantProfile(sid);
}

function servantEditable(sid) {
  const sv = S.cachedServants.find(x => x.id === sid);
  return (S.currentRole === 'admin' && sv && sv.role !== 'admin') ? sv : null;
}

// تغيير دور خادم واحد في فصل واحد (خادم ⇄ مسؤول)
window.setServantClassRole = async (sid, cid, toSupervisor) => {
  const sv = servantEditable(sid); if (!sv) return;
  if (!confirm(`تخلي "${sv.name||''}" ${toSupervisor ? 'مسؤول فصل' : 'خادم عادي'} في ${classLabel(cid)} بس؟ باقي الخدام مش هيتأثروا`)) return;
  try {
    const classes = normalizeAssignedClasses(sv.assignedClass);
    const sup = new Set(supervisedClassesOf(sv));
    if (toSupervisor) sup.add(cid); else sup.delete(cid);
    await applyServantClassMap(sid, classes, sup);
    showToast('تم تغيير دوره في الفصل ده ✓', 'success');
  } catch(e) { console.error(e); showToast('حصل خطأ أثناء تغيير الدور', 'error'); }
};

// نقل الخادم من فصل لفصل تاني (بنفس دوره في الفصل القديم)، أو إضافة فصل جديد له (fromCid فاضي)، أو شيله من فصل
async function changeServantClass(sid, fromCid, toCid) {
  const sv = servantEditable(sid); if (!sv) return;
  try {
    let classes = normalizeAssignedClasses(sv.assignedClass);
    const sup = new Set(supervisedClassesOf(sv));
    const wasSup = fromCid && sup.has(fromCid);
    if (fromCid) { classes = classes.filter(c => c !== fromCid); sup.delete(fromCid); }
    if (toCid && !classes.includes(toCid)) { classes.push(toCid); if (wasSup) sup.add(toCid); }
    if (!classes.length) { showToast('لازم يفضل في فصل واحد على الأقل', 'error'); return; }
    await applyServantClassMap(sid, classes, sup);
    showToast(!toCid ? 'اتشال من الفصل ✓' : (fromCid ? 'اتنقل للفصل التاني ✓' : 'اتضاف للفصل ✓'), 'success');
  } catch(e) { console.error(e); showToast('حصل خطأ أثناء تغيير الفصل', 'error'); }
}

// نافذة اختيار الفصل: fromCid = الفصل الحالي (نقل) أو '' (إضافة فصل)
window.openServantClassPicker = (sid, fromCid) => {
  const sv = servantEditable(sid); if (!sv) return;
  const assigned = normalizeAssignedClasses(sv.assignedClass);
  const options = S.allClasses.filter(c => !assigned.includes(c.id));
  document.getElementById('class-picker-overlay')?.remove();
  const ov = document.createElement('div');
  ov.id = 'class-picker-overlay'; ov.className = 'modal-overlay';
  ov.style.cssText = 'display:flex;align-items:center;justify-content:center;z-index:400';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  const box = document.createElement('div');
  box.className = 'modal-box'; box.style.cssText = 'width:100%;padding:18px';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:16px;font-weight:900;margin-bottom:6px';
  title.textContent = fromCid ? `نقل ${sv.name||''} من ${classLabel(fromCid)} إلى:` : `إضافة ${sv.name||''} لفصل:`;
  box.appendChild(title);
  if (fromCid) {
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:12px;color:var(--text-dim);margin-bottom:12px';
    hint.textContent = 'هيفضل بنفس دوره (خادم/مسؤول). باقي الخدام مش هيتأثروا.';
    box.appendChild(hint);
  }
  const chips = document.createElement('div');
  chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:12px 0';
  if (!options.length) chips.innerHTML = '<div class="empty-state" style="padding:10px">مفيش فصول تانية متاحة</div>';
  options.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'filter-chip'; b.textContent = `${c.emoji||'📘'} ${c.name}`;
    b.onclick = () => { ov.remove(); changeServantClass(sid, fromCid, c.id); };
    chips.appendChild(b);
  });
  box.appendChild(chips);
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  if (fromCid && assigned.length > 1) {
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'del-btn'; rm.textContent = '🗑 شيله من الفصل ده';
    rm.onclick = () => { if (confirm(`تشيل "${sv.name||''}" من ${classLabel(fromCid)}؟`)) { ov.remove(); changeServantClass(sid, fromCid, ''); } };
    row.appendChild(rm);
  }
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'action-btn'; cancel.textContent = 'إلغاء';
  cancel.onclick = () => ov.remove();
  row.appendChild(cancel);
  box.appendChild(row);
  ov.appendChild(box);
  document.body.appendChild(ov);
};

window.openServantProfile = (id) => {
  const s = S.cachedServants.find(x => x.id === id);
  if (!s) return;
  servantProfileId = id; pendingProfileName = '';
  document.getElementById('sprof-stats').style.display = '';
  document.getElementById('sprof-avatar').textContent = (s.name||'؟').trim()[0] || '؟';
  document.getElementById('sprof-name').textContent = (s.name||'—') + (s.role==='admin' ? ' 👑' : (s.role==='supervisor' ? ' 🗝️' : ''));
  document.getElementById('sprof-sub').textContent = s.role==='admin' ? 'أدمن' : (s.role==='supervisor' ? (supervisedClassesOf(s).length && normalizeAssignedClasses(s.assignedClass).some(c => !supervisedClassesOf(s).includes(c)) ? 'مسؤول ' + supervisedClassesOf(s).map(classLabel).join(' + ') + ' وخادم في باقي فصوله' : 'مسؤول فصل') : 'خادم فصل');
  document.getElementById('sprof-ssc').textContent = s.sscCount||0;
  document.getElementById('sprof-meeting').textContent = s.meetingCount||0;
  document.getElementById('sprof-prep').textContent = s.prepCount||0;
  const assigned = normalizeAssignedClasses(s.assignedClass);
  renderServantProfileClassChips(s);
  const contactLines = [];
  contactLines.push(s.status === 'pending' ? '⏳ سجّل حساب وبانتظار موافقة الأدمن' : '✅ مسجل حساب');
  if (s.email) contactLines.push(`📧 <span dir="ltr">${s.email}</span>`);
  if (s.phone) contactLines.push(`📞 <span dir="ltr">${s.phone}</span>`);
  if (s.address) contactLines.push(`📍 ${s.address}`);
  document.getElementById('sprof-contact').innerHTML = contactLines.join('<br>') || '';
  renderServantProfileActions(s);
  document.getElementById('servant-profile-modal').style.display = 'flex';
};

function renderServantProfileActions(s) {
  const viewerIsPrimary = isPrimaryAdmin(S.currentEmail);
  const sIsPrimary = isPrimaryAdmin(s.email);
  const nameEsc = (s.name||'').replace(/'/g,"\\'");
  let html = '';
  if (s.role === 'admin') {
    if (sIsPrimary) html = `<span class="s-sub" style="white-space:nowrap">👑 الأدمن الأساسي</span>`;
    else if (viewerIsPrimary) html = `<button class="action-btn" onclick="demoteServant('${s.id}','${nameEsc}');closeServantProfile()">🔻 شيله من الأدمن</button>
      <button class="del-btn" onclick="deleteServant('${s.id}','${nameEsc}','${servantRoleIds(s).join(',')}');closeServantProfile()">🗑 حذف</button>`;
  } else {
    html = `<button class="action-btn" onclick="promoteServant('${s.id}','${nameEsc}');closeServantProfile()">👑 خليه أدمن</button>
      <button class="del-btn" onclick="deleteServant('${s.id}','${nameEsc}','${servantRoleIds(s).join(',')}');closeServantProfile()">🗑 حذف</button>`;
  }
  document.getElementById('sprof-actions').innerHTML = html;
}

window.closeServantProfile = () => {
  document.getElementById('servant-profile-modal').style.display = 'none'; servantProfileId = ''; pendingProfileName = '';
  // لو الملف اتفتح من شاشة "المستخدمين والأدوار" بنفضل فيها ونحدّث القايمة (لو حاجة اتغيّرت)
  if (document.getElementById('tab-roles')?.style.display === 'block' && document.getElementById('roles-list-view')?.style.display !== 'none') renderRolesList();
};

window.closeServantProfileOutside = (e) => { if (e.target.id === 'servant-profile-modal') closeServantProfile(); };

// ===== ملف خادم لسه مسجلش حساب (اسمه مضاف مقدمًا في دور/أدوار) =====
// نفس شكل ملف الخادم المسجل، بس من غير إحصائيات، والإيميل بيظهر لما يسجل. أي تعديل بيتطبق على الاسم ده لوحده (نفس فكرة applyServantClassMap)
let pendingProfileName = '';

export const pEnc = n => encodeURIComponent(n).replace(/'/g, '%27');

export function pendingPersonMap(name) {
  const classes = [], sup = new Set();
  S.allRoles.forEach(r => {
    if (r.isAdmin || !Array.isArray(r.classes) || !nameVariantsIn(r, name).length) return;
    r.classes.forEach(c => { if (!classes.includes(c)) classes.push(c); if (r.isSupervisor) sup.add(c); });
  });
  return { classes, sup };
}

window.openPendingProfile = (name) => {
  const { classes, sup } = pendingPersonMap(name);
  if (!classes.length) { showToast('الاسم ده مبقاش مضاف في أي فصل', 'info'); renderRolesList(); return; }
  pendingProfileName = name; servantProfileId = '';
  document.getElementById('sprof-avatar').textContent = (name||'؟').trim()[0] || '؟';
  document.getElementById('sprof-name').textContent = name + (sup.size ? ' 🗝️' : '');
  document.getElementById('sprof-sub').textContent = '⏳ لسه مسجلش حساب';
  document.getElementById('sprof-stats').style.display = 'none';
  const e = pEnc(name);
  document.getElementById('sprof-class-chips').innerHTML = classes.map(cid => {
    const isSup = sup.has(cid);
    return `<span style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap">${classBadgeHTML(cid)}<span style="font-size:11px;color:var(--text-dim)">${isSup ? '🗝️ مسؤول فصل' : '🧑‍🏫 خادم فصل'}</span>
      <button class="action-btn" onclick="setPendingClassRole(decodeURIComponent('${e}'),'${cid}',${!isSup})">${isSup ? '🧑‍🏫 خليه خادم' : '🗝️ خليه مسؤول'}</button>
      <button class="action-btn" onclick="openPendingClassPicker(decodeURIComponent('${e}'),'${cid}')">🔁 فصل تاني</button></span>`;
  }).join('') + (S.allClasses.some(c => !classes.includes(c.id)) ? `<button class="action-btn" onclick="openPendingClassPicker(decodeURIComponent('${e}'),'')">➕ ضيف فصل</button>` : '');
  document.getElementById('sprof-contact').innerHTML = `📧 لسه مسجلش حساب — الإيميل هيظهر هنا أول ما يسجل ويتقبل`;
  document.getElementById('sprof-actions').innerHTML = `<button class="del-btn" onclick="deletePendingName(decodeURIComponent('${e}'))">🗑 حذف الاسم</button>`;
  document.getElementById('servant-profile-modal').style.display = 'flex';
};

async function applyPendingClassMap(name, classes, supSet) {
  const supList = classes.filter(c => supSet.has(c));
  const srvList = classes.filter(c => !supSet.has(c));
  const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
  const targets = [];
  for (const [type, cls] of [['classSupervisor', supList], ['classServant', srvList]]) {
    if (!cls.length) continue;
    let r = S.allRoles.find(x => !x.isAdmin && (x.type || (x.isSupervisor ? 'classSupervisor' : 'classServant')) === type && Array.isArray(x.classes) && sameSet(x.classes, cls));
    if (!r) {
      const data = { name: `${ROLE_TYPE_SHORT[type]} — ${cls.map(c => classLabel(c)).join(' + ')}`, type, isAdmin: false, isSupervisor: type === 'classSupervisor', classes: cls, pendingNames: [] };
      const ref = await addDoc(collection(db,'roles'), data);
      r = { id: ref.id, ...data }; S.allRoles.push(r);
    }
    targets.push(r.id);
  }
  // بنشيل الاسم من أي دور قديم مش من الأدوار الجديدة، وبنضيفه للأدوار الجديدة — باقي أسماء الأدوار دي مبتتلمسش
  for (const r of S.allRoles.filter(x => !x.isAdmin && nameVariantsIn(x, name).length && !targets.includes(x.id))) {
    await updateDoc(doc(db,'roles',r.id), { pendingNames: arrayRemove(...nameVariantsIn(r, name)) });
  }
  for (const id of targets) {
    const r = S.allRoles.find(x => x.id === id);
    if (!nameVariantsIn(r, name).length) await updateDoc(doc(db,'roles',id), { pendingNames: arrayUnion(name) });
  }
  await loadRolesOnce(true);
}

window.setPendingClassRole = async (name, cid, toSup) => {
  if (!confirm(`تخلي "${name}" ${toSup ? 'مسؤول فصل' : 'خادم عادي'} في ${classLabel(cid)} بس؟ (هيتفعل أول ما يسجل)`)) return;
  try {
    const { classes, sup } = pendingPersonMap(name);
    if (toSup) sup.add(cid); else sup.delete(cid);
    await applyPendingClassMap(name, classes, sup);
    showToast('تم تغيير دوره في الفصل ده ✓', 'success');
    openPendingProfile(name);
  } catch(e) { console.error(e); showToast('حصل خطأ أثناء تغيير الدور', 'error'); }
};

async function changePendingClass(name, fromCid, toCid) {
  try {
    let { classes, sup } = pendingPersonMap(name);
    const wasSup = fromCid && sup.has(fromCid);
    if (fromCid) { classes = classes.filter(c => c !== fromCid); sup.delete(fromCid); }
    if (toCid && !classes.includes(toCid)) { classes.push(toCid); if (wasSup) sup.add(toCid); }
    if (!classes.length) { showToast('لازم يفضل في فصل واحد على الأقل، أو احذف الاسم', 'error'); return; }
    await applyPendingClassMap(name, classes, sup);
    showToast(!toCid ? 'اتشال من الفصل ✓' : (fromCid ? 'اتنقل للفصل التاني ✓' : 'اتضاف للفصل ✓'), 'success');
    openPendingProfile(name);
  } catch(e) { console.error(e); showToast('حصل خطأ أثناء تغيير الفصل', 'error'); }
}

window.openPendingClassPicker = (name, fromCid) => {
  const { classes } = pendingPersonMap(name);
  const options = S.allClasses.filter(c => !classes.includes(c.id));
  document.getElementById('class-picker-overlay')?.remove();
  const ov = document.createElement('div');
  ov.id = 'class-picker-overlay'; ov.className = 'modal-overlay';
  ov.style.cssText = 'display:flex;align-items:center;justify-content:center;z-index:400';
  ov.onclick = ev => { if (ev.target === ov) ov.remove(); };
  const box = document.createElement('div');
  box.className = 'modal-box'; box.style.cssText = 'width:100%;padding:18px';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:16px;font-weight:900;margin-bottom:6px';
  title.textContent = fromCid ? `نقل ${name} من ${classLabel(fromCid)} إلى:` : `إضافة ${name} لفصل:`;
  box.appendChild(title);
  const chips = document.createElement('div');
  chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:12px 0';
  if (!options.length) chips.innerHTML = '<div class="empty-state" style="padding:10px">مفيش فصول تانية متاحة</div>';
  options.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'filter-chip'; b.textContent = `${c.emoji||'📘'} ${c.name}`;
    b.onclick = () => { ov.remove(); changePendingClass(name, fromCid, c.id); };
    chips.appendChild(b);
  });
  box.appendChild(chips);
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  if (fromCid && classes.length > 1) {
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'del-btn'; rm.textContent = '🗑 شيله من الفصل ده';
    rm.onclick = () => { if (confirm(`تشيل "${name}" من ${classLabel(fromCid)}؟`)) { ov.remove(); changePendingClass(name, fromCid, ''); } };
    row.appendChild(rm);
  }
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'action-btn'; cancel.textContent = 'إلغاء';
  cancel.onclick = () => ov.remove();
  row.appendChild(cancel);
  box.appendChild(row); ov.appendChild(box); document.body.appendChild(ov);
};

window.deletePendingName = async (name) => {
  if (!confirm(`تحذف الاسم "${name}" من كل الأدوار؟ مش هيظهر في قايمة التسجيل تاني.`)) return;
  try {
    for (const r of S.allRoles.filter(x => !x.isAdmin && nameVariantsIn(x, name).length)) {
      await updateDoc(doc(db,'roles',r.id), { pendingNames: arrayRemove(...nameVariantsIn(r, name)) });
    }
    await loadRolesOnce(true);
    closeServantProfile();
    showToast('تم حذف الاسم', 'info');
  } catch(e) { console.error(e); showToast('حصل خطأ أثناء الحذف', 'error'); }
};
