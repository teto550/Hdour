// خدام الفصل (تبويب مسؤول الفصل)
import { S } from '../core/state.js';
import { collection, db, deleteDoc, doc, getDoc, increment, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from '../core/firebase.js';
import { normalizeArabic } from '../core/idb-cache.js';
import { countSnapshotReads, countedGetDocs } from '../core/reads-counter.js';
import { classBadgeHTML, classEmoji, classLabel, classPalette, nameKey, normalizeAssignedClasses, servantRoleIds, uniqueNames } from './classes.js';
import { SERV_ATT_EMOJI, SERV_ATT_LABELS, monitorFilterServants, servAttDocId, servantAvatarHTML, servantClassBadges, servantRoleChip } from './monitor.js';
import { pEnc, pendingPersonMap } from './servant-profile.js';
import { dEsc } from './servants-dashboard.js';
import { renderSettingsPeopleList, toLocalDateKey } from './settings.js';
import { loadRolesOnce } from './users-roles.js';

// ===== خدام الفصل (تبويب مسؤول الفصل) — نسخة من حضور الخدام، مقصورة على خدام فصل المسؤول بس =====
// عرض التاريخ بصيغة عربي مقروءة بدل خانة التاريخ الأصلية (اللي كانت بتظهر كلام مقلوب زي "موي/رهش/ةنس")
// الـinput الأصلي بيفضل موجود فوق الشكل بشفافية كاملة، فالضغط عليه بيفتح منتقي التاريخ عادي
function enhanceDateInput(inp) {
  if (!inp || inp.dataset.dp) return;
  inp.dataset.dp = '1';
  const wrap = document.createElement('div');
  wrap.className = 'date-pick';
  inp.parentNode.insertBefore(wrap, inp);
  wrap.innerHTML = '<span class="dp-ic">📅</span><span class="dp-txt"></span>';
  wrap.appendChild(inp);
  const txt = wrap.querySelector('.dp-txt');
  const upd = () => {
    const v = inp.value;
    if (!v) { txt.textContent = 'اختار التاريخ'; txt.classList.add('empty'); return; }
    const d = new Date(v + 'T00:00:00');
    txt.textContent = isNaN(d) ? v : d.toLocaleDateString('ar-EG', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    txt.classList.remove('empty');
  };
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(inp, 'value', { configurable:true, get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); upd(); } });
  inp.addEventListener('input', upd);
  inp.addEventListener('change', upd);
  inp.addEventListener('click', () => { try { inp.showPicker && inp.showPicker(); } catch(e) {} });
  upd();
}

['class-serv-att-date','serv-att-date','activity-date'].forEach(id => enhanceDateInput(document.getElementById(id)));

let classServAttActivity = 'mass';

window.setClassServAttActivity = (activity, btn) => {
  classServAttActivity = activity;
  document.querySelectorAll('#class-serv-att-activity-chips .tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderClassServAttList();
};

// ===== شاشة "الخدام" عند مسؤول الفصل: تبويب "الخدام" (بيفتح الأول) + تبويب "الحضور" =====
window.switchClassServSub = (which) => {
  document.getElementById('class-serv-subtab-btn-servants')?.classList.toggle('active', which === 'servants');
  document.getElementById('class-serv-subtab-btn-att')?.classList.toggle('active', which === 'att');
  const a = document.getElementById('class-serv-sub-servants'); if (a) a.style.display = which === 'servants' ? 'block' : 'none';
  const b = document.getElementById('class-serv-sub-att');      if (b) b.style.display = which === 'att' ? 'block' : 'none';
  if (which === 'servants') renderClassServList(); else renderClassServAttList();
};

// قايمة الخدام اللي المسؤول مسؤول عنهم بس (فصوله)، متجمعة بالفصل لو عنده أكتر من فصل — عرض فقط من غير أزرار إدارة
export function renderClassServList() {
  const cont = document.getElementById('class-serv-list');
  if (!cont || S.currentRole !== 'supervisor') return;
  const esc = t => String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const titleEl = document.getElementById('class-serv-scope-title'); if (titleEl) titleEl.textContent = '🏫 خدام الفصول';
  const supervised = normalizeAssignedClasses(S.currentSupervisorClass);
  if (!supervised.length) { cont.innerHTML = `<div class="empty-state">إنت مش مسؤول عن أي فصل</div>`; return; }
  if (!S.servantsLoadedFlag) { cont.innerHTML = `<div class="loading"><div class="spinner"></div>جاري التحميل…</div>`; return; }
  const q = normalizeArabic(document.getElementById('class-serv-list-search')?.value || '');
  const base = S.cachedServants.filter(x => x.status === 'approved' && x.id !== S.currentUid);
  const groups = supervised.map(cid => ({
    cid,
    list: base.filter(x => normalizeAssignedClasses(x.assignedClass).includes(cid) && (!q || normalizeArabic(x.name||'').includes(q)))
              .sort((a,b) => (a.name||'').localeCompare(b.name||'','ar'))
  })).filter(g => g.list.length);
  if (!groups.length) { cont.innerHTML = `<div class="empty-state">${q ? 'مفيش خادم بالاسم ده' : 'مفيش خدام معتمدين في فصولك لسه'}</div>`; return; }
  const multi = supervised.length > 1;
  cont.innerHTML = groups.map(g => (multi ? `<div class="section-title" style="margin:14px 0 8px">${esc(classEmoji(g.cid))} ${esc(classLabel(g.cid))} (${g.list.length})</div>` : '') +
    g.list.map(x => `
      <div class="servant-item mon-row">
        ${servantAvatarHTML(x)}
        <div class="s-info">
          <div class="mon-name">${esc(x.name)||'—'}${servantRoleChip(x)}</div>
          <div class="mon-badges">${servantClassBadges(x)}</div>
          <div class="mon-stats">
            <span class="mon-stat-chip ${x.sscCount?'has':''}">📖 مدارس أحد <b>${x.sscCount||0}</b></span>
            <span class="mon-stat-chip ${x.meetingCount?'has':''}">🤝 اجتماع <b>${x.meetingCount||0}</b></span>
          </div>
        </div>
      </div>`).join('')).join('');
}

export async function renderClassServAttList() {
  const cont = document.getElementById('class-serv-att-list');
  if (!cont) return;
  const esc = t => String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const dateEl = document.getElementById('class-serv-att-date');
  if (dateEl && !dateEl.value) dateEl.value = toLocalDateKey(new Date());
  const date = dateEl?.value || toLocalDateKey(new Date());
  const allMode = S.classServScope === 'all';
  // المسؤول بيشوف بس الفصول اللي هو مسؤول عنها: "خدام الفصل" = الفصل اللي واقف عليه، و"خدام الفصول" = كل فصوله
  const supervised = normalizeAssignedClasses(S.currentSupervisorClass);
  const scopeClasses = allMode ? supervised : (supervised.includes(S.currentClassTab) ? [S.currentClassTab] : []);
  const titleEl = document.getElementById('class-serv-scope-title');
  if (titleEl) titleEl.textContent = allMode ? '🏫 خدام الفصول' : `${classEmoji(S.currentClassTab)} خدام ${classLabel(S.currentClassTab)}`;
  if (!S.servantsLoadedFlag) await loadServantsOnce();
  if (!scopeClasses.length) { cont.innerHTML = `<div class="empty-state">إنت مش مسؤول عن ${esc(classLabel(S.currentClassTab))} — اختار فصل إنت مسؤول عنه من فوق</div>`; return; }
  const searchQ = normalizeArabic(document.getElementById('class-serv-att-search-input')?.value || '');
  const base = S.cachedServants.filter(s => s.status === 'approved' && s.id !== S.currentUid);
  const groups = scopeClasses.map(cid => ({
    cid,
    list: base.filter(s => normalizeAssignedClasses(s.assignedClass).includes(cid) && (!searchQ || normalizeArabic(s.name||'').includes(searchQ)))
              .sort((a,b) => (a.name||'').localeCompare(b.name||'','ar'))
  })).filter(g => g.list.length);
  if (!groups.length) { cont.innerHTML = `<div class="empty-state">${searchQ ? 'مفيش خادم بالاسم ده' : (allMode ? 'مفيش خدام تانيين في فصولك' : 'مفيش خدام تانيين في الفصل ده')}</div>`; return; }
  cont.innerHTML = `<div class="loading"><div class="spinner"></div>جاري التحميل…</div>`;
  try {
    const snap = await countedGetDocs(query(collection(db,'servantAttendance'), where('date','==',date), where('activity','==',classServAttActivity)), `servantAttendance فصل (${SERV_ATT_LABELS[classServAttActivity]})`);
    const presentIds = new Set(snap.docs.map(d => d.data().servantId));
    cont.innerHTML = groups.map(g => (allMode ? `<div class="section-title" style="margin:14px 0 8px">${esc(classEmoji(g.cid))} ${esc(classLabel(g.cid))} (${g.list.length})</div>` : '') +
      g.list.map(s => `
      <div class="servant-item" onclick="toggleClassServantAttendance('${s.id}','${(s.name||'').replace(/'/g,"\\'")}','${date}')" style="cursor:pointer">
        <div class="s-info">
          <div class="s-name">${esc(s.name)||'—'}</div>
        </div>
        <div class="serv-att-check ${presentIds.has(s.id)?'checked':''}"></div>
      </div>`).join('')).join('');
  } catch(e) {
    console.error(e);
    cont.innerHTML = `<div class="empty-state">تعذّر تحميل الحضور</div>`;
  }
}

window.toggleClassServantAttendance = async (servantId, name, date) => {
  const activity = classServAttActivity;
  const id = servAttDocId(date, activity, servantId);
  const countField = activity === 'sunday_school' ? 'sscCount' : activity === 'meeting' ? 'meetingCount' : activity === 'preparation' ? 'prepCount' : null;
  try {
    const alreadyPresent = document.querySelector(`#class-serv-att-list [onclick*="toggleClassServantAttendance('${servantId}'"] .serv-att-check`)?.classList.contains('checked');
    if (alreadyPresent) {
      await deleteDoc(doc(db,'servantAttendance',id));
      if (countField) { await updateDoc(doc(db,'servants',servantId), { [countField]: increment(-1) }); const sv = S.cachedServants.find(x=>x.id===servantId); if (sv) sv[countField] = Math.max(0,(sv[countField]||0)-1); }
      showToast(`تم إلغاء حضور ${name}`, 'info');
    } else {
      await setDoc(doc(db,'servantAttendance',id), { servantId, name, date, activity, timestamp: serverTimestamp() });
      if (countField) { await updateDoc(doc(db,'servants',servantId), { [countField]: increment(1) }); const sv = S.cachedServants.find(x=>x.id===servantId); if (sv) sv[countField] = (sv[countField]||0)+1; }
      showToast(`تم تسجيل حضور ${name} في ${SERV_ATT_EMOJI[activity]} ${SERV_ATT_LABELS[activity]} ✓`, 'success');
    }
    renderClassServAttList();
  } catch(e) { console.error(e); showToast('حصل خطأ، حاول تاني', 'error'); }
};

// بيجيب قايمة الخدام من فايرستور مرة واحدة بس لكل جلسة (وبيعيد استخدام نفس النسخة في "متابعة" وشاشة الإعدادات/الأدوار
// من غير قراءة تانية) — مرّر force=true بعد أي تعديل فعلي (قبول/رفض/ترقية...) عشان يجيب النسخة الجديدة
let servantsLoadedAt = 0;

// تحميل الخدام من الكاش لو اتحمّلوا من أقل من 5 دقايق (بدل 70 قراءة في كل فتحة)
export function loadServantsFresh(maxAgeMs = 5 * 60 * 1000) {
  return loadServantsOnce(!S.servantsLoadedFlag || (Date.now() - servantsLoadedAt) > maxAgeMs);
}

// بعد أي إجراء على خادم بنعدّل النسخة اللي على الجهاز مباشرة بدل ما نحمّل الـ70 خادم تاني (patch=null يعني حذف)
export function patchServantLocal(id, patch) {
  if (patch === null) S.cachedServants = S.cachedServants.filter(x => x.id !== id);
  else S.cachedServants = S.cachedServants.map(x => x.id === id ? { ...x, ...patch } : x);
  return loadServantsOnce(); // بيعرض من الكاش
}

export async function loadServantsOnce(force) {
  if (S.servantsLoadedFlag && !force) { renderPendingList(S.cachedServants.filter(x => x.status === 'pending')); renderServantsList(S.cachedServants.filter(x => x.status === 'approved')); renderSettingsPeopleList(); return; }
  const pendingEl = document.getElementById('pending-list');
  if (pendingEl) pendingEl.innerHTML = `<div class="loading"><div class="spinner"></div>جاري التحميل…</div>`;
  try {
    const snap = await countedGetDocs(collection(db,'servants'), 'servants (متابعة)');
    S.cachedServants = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    S.servantsLoadedFlag = true; servantsLoadedAt = Date.now();
    renderPendingList(S.cachedServants.filter(x => x.status === 'pending'));
    renderServantsList(S.cachedServants.filter(x => x.status === 'approved'));
    renderSettingsPeopleList();
  } catch(e) {
    console.error(e);
    if (pendingEl) pendingEl.innerHTML = `<div class="empty-state">تعذّر تحميل الطلبات</div>`;
  }
}

// بث لحظي على طلبات الانضمام المعلقة بس (عادةً صفر أو كام مستند) — أي طلب جديد يظهر عند الأدمن فورًا من غير reload،
// والقراءات بتبقى بس على الطلب الجديد أو اللي اتحسم، مش على كل الخدام
let pendingReqUnsub = null;
let pendingReqSeenServer = false;

export function stopPendingRequestsListener() {
  if (pendingReqUnsub) { pendingReqUnsub(); pendingReqUnsub = null; }
  pendingReqSeenServer = false;
}

function refreshPendingUI() {
  renderPendingList(S.cachedServants.filter(x => x.status === 'pending'));
  if (S.servantsLoadedFlag && document.getElementById('monitor-subtab-servants')?.style.display === 'block') renderServantsList(S.cachedServants.filter(x => x.status === 'approved'));
  if (S.servantsLoadedFlag) renderSettingsPeopleList();
}

// تعديل النسخة المحلية بس (من غير ما نحمّل قايمة الخدام كلها) وبعدين تحديث الشاشة
function patchCachedOnly(id, patch) {
  if (patch === null) S.cachedServants = S.cachedServants.filter(x => x.id !== id);
  else S.cachedServants = S.cachedServants.map(x => x.id === id ? { ...x, ...patch } : x);
  refreshPendingUI();
}

async function resolvePendingRemoved(id, lastData) {
  const c = S.cachedServants.find(x => x.id === id);
  if (!c || c.status !== 'pending') return; // اتعالج محليًا (قبول/رفض من الجهاز ده)
  if (lastData && lastData.status && lastData.status !== 'pending') { patchCachedOnly(id, lastData); return; }
  try {
    const sn = await getDoc(doc(db,'servants',id));
    patchCachedOnly(id, sn.exists() ? { ...sn.data() } : null);
  } catch(e) { patchCachedOnly(id, null); }
}

export function startPendingRequestsListener() {
  if (pendingReqUnsub || !canHandleRequests()) return;
  pendingReqUnsub = onSnapshot(query(collection(db,'servants'), where('status','==','pending')), snap => {
    countSnapshotReads('servants (طلبات الانضمام - live)', snap);
    const initial = !pendingReqSeenServer;
    if (!snap.metadata.fromCache) pendingReqSeenServer = true;
    let newcomers = 0;
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id, data = { id, ...ch.doc.data() };
      if (ch.type === 'removed') { resolvePendingRemoved(id, ch.doc.data()); return; }
      const i = S.cachedServants.findIndex(x => x.id === id);
      if (i >= 0) S.cachedServants[i] = { ...S.cachedServants[i], ...data };
      else { S.cachedServants.push(data); if (ch.type === 'added' && canHandleRequest(data)) newcomers++; }
    });
    if (!initial && newcomers) showToast(newcomers > 1 ? `📥 وصل ${newcomers} طلبات انضمام جديدة` : '📥 وصل طلب انضمام جديد', 'info');
    refreshPendingUI();
  }, err => console.error('pending requests listener error:', err));
}

// مين يقدر يقبل/يرفض طلبات الانضمام: الأدمن (كل الطلبات) + مسؤول الفصل (طلبات الفصول اللي هو مسؤول عنها بس)
export function canHandleRequests() { return S.currentRole === 'admin' || (S.currentRole === 'supervisor' && normalizeAssignedClasses(S.currentSupervisorClass).length > 0); }

export function canHandleRequest(s) {
  if (S.currentRole === 'admin') return true;
  if (S.currentRole !== 'supervisor') return false;
  const sup = normalizeAssignedClasses(S.currentSupervisorClass);
  return normalizeAssignedClasses(s && s.assignedClass).some(c => sup.includes(c));
}

export function renderSupPending() {
  const sec = document.getElementById('sup-pending-section'); if (!sec) return;
  const mine = S.currentRole === 'supervisor' ? S.cachedServants.filter(x => x.status === 'pending' && canHandleRequest(x)) : [];
  const badge = document.getElementById('sup-pending-badge');
  if (badge) { badge.textContent = mine.length ? `📥 ${mine.length}` : ''; badge.style.display = mine.length ? 'inline-block' : 'none'; }
  sec.style.display = mine.length ? '' : 'none';
  const cnt = document.getElementById('sup-pending-count'); if (cnt) cnt.textContent = mine.length;
  const cont = document.getElementById('sup-pending-list'); if (!cont) return;
  const q = n => String(n||'').replace(/'/g, "\\'");
  cont.innerHTML = mine.map(s => `
    <div class="servant-item" style="flex-wrap:wrap">
      <div class="s-avatar">${(s.name||'؟').trim()[0]||'؟'}</div>
      <div class="s-info">
        <div class="s-name">${s.name||'—'} ${s.assignedClass ? classBadgeHTML(s.assignedClass) : ''}</div>
        <div class="s-sub" dir="ltr" style="text-align:right">${s.email||''}${s.phone ? ' · '+s.phone : ''}</div>
        ${s.address ? `<div class="s-sub">📍 ${s.address}</div>` : ''}
      </div>
      <button class="export-btn" onclick="approveServant('${s.id}','${q(s.name)}','${servantRoleIds(s).join(',')}')">✓ قبول</button>
      <button class="del-btn" onclick="rejectServant('${s.id}','${q(s.name)}','${servantRoleIds(s).join(',')}')">✕ رفض</button>
    </div>`).join('');
}

function renderPendingList(list) {
  renderSupPending();
  renderClassServList();
  const ps = document.getElementById('pending-section'); if (ps) ps.style.display = list.length ? '' : 'none';
  document.getElementById('pending-count').textContent = list.length;
  { const mp = document.getElementById('mon-stat-pending'); if (mp) mp.textContent = list.length; }
  const cont = document.getElementById('pending-list');
  if (!list.length) { cont.innerHTML = `<div class="empty-state">لا يوجد طلبات انضمام جديدة</div>`; return; }
  cont.innerHTML = list.map(s => `
    <div class="servant-item" style="flex-wrap:wrap">
      <div class="s-avatar">${(s.name||'؟').trim()[0]||'؟'}</div>
      <div class="s-info">
        <div class="s-name">${s.name||'—'} ${s.assignedClass ? classBadgeHTML(s.assignedClass) : ''}</div>
        <div class="s-sub" dir="ltr" style="text-align:right">${s.email||''}${s.phone ? ' · '+s.phone : ''}</div>
        ${s.address ? `<div class="s-sub">📍 ${s.address}</div>` : ''}
      </div>
      <button class="export-btn" onclick="approveServant('${s.id}','${(s.name||'').replace(/'/g,"\\'")}','${servantRoleIds(s).join(',')}')">✓ قبول</button>
      <button class="del-btn" onclick="rejectServant('${s.id}','${(s.name||'').replace(/'/g,"\\'")}','${servantRoleIds(s).join(',')}')">✕ رفض</button>
    </div>`).join('');
}

// مبسّطة: اسم الخادم بس + رقمين على الشمال (مدارس أحد + اجتماع خدام) — دوس على الاسم يفتحلك ملفه بكل تفاصيله وأزرار الإدارة
export function renderServantsList(list) {
  const base = monitorFilterServants(list || S.cachedServants.filter(x => x.status === 'approved'));
  document.getElementById('servants-count').textContent = base.length;
  { const t = document.getElementById('mon-stat-total'); if (t) t.textContent = base.length; }
  const q = normalizeArabic(document.getElementById('monitor-search-input')?.value || '');
  const filtered = q ? base.filter(s => normalizeArabic(s.name||'').includes(q)) : base;
  const cont = document.getElementById('servants-list');
  // الأسماء المضافة مقدمًا ولسه مسجلتش — بتظهر تحت المعتمدين وتقدر تفتح ملفها (الأدوار بتتحمل مرة واحدة أول ما تفتح الخانة دي)
  if (!S.rolesLoadedFlag && !rolesTriedForServantsList) { rolesTriedForServantsList = true; loadRolesOnce(); }
  const pendingPeople = pendingPeopleList().filter(x => (S.monitorClassFilter === 'all' || x.classes.includes(String(S.monitorClassFilter))) && (!q || normalizeArabic(x.name).includes(q)));
  const pendingHTML = pendingPeople.length ? `<div class="section-title" style="margin:16px 0 8px">⏳ لسه مسجلوش حساب (${pendingPeople.length})</div>` + pendingPeople.map(x => {
    const first = x.classes[0], pal = first ? classPalette(first) : { bg:'rgba(79,142,247,0.15)', text:'#4f8ef7' };
    const isSup = x.sup.size > 0;
    return `
      <div class="servant-item mon-row" style="opacity:.85" onclick="openPendingProfile(decodeURIComponent('${pEnc(x.name)}'))">
        <div class="mon-avatar" style="background:${pal.bg};color:${pal.text}">${(x.name||'؟').trim()[0]||'؟'}</div>
        <div class="s-info">
          <div class="mon-name">${dEsc(x.name)}${isSup ? '<span class="mon-role sup">🗝️ مسؤول فصل</span>' : ''}<span class="mon-role" style="background:rgba(255,255,255,0.06);color:var(--text-dim);border:1px solid var(--border)">⏳ لسه مسجلش</span></div>
          <div class="mon-badges">${x.classes.map(cid => classBadgeHTML(cid)).join('')}</div>
        </div>
      </div>`;
  }).join('') : '';
  if (!filtered.length) { cont.innerHTML = (q && !pendingHTML ? `<div class="empty-state">مفيش خادم بالاسم ده</div>` : (!q && !pendingHTML ? `<div class="empty-state">لا يوجد خدام معتمدين بعد</div>` : '')) + pendingHTML; return; }
  cont.innerHTML = filtered
    .sort((a,b) => (a.name||'').localeCompare(b.name||'','ar'))
    .map(s => `
      <div class="servant-item mon-row" onclick="openServantProfile('${s.id}')">
        ${servantAvatarHTML(s)}
        <div class="s-info">
          <div class="mon-name">${s.name||'—'}${servantRoleChip(s)}</div>
          <div class="mon-badges">${servantClassBadges(s)}</div>
          <div class="mon-stats">
            <span class="mon-stat-chip ${s.sscCount?'has':''}">📖 مدارس أحد <b>${s.sscCount||0}</b></span>
            <span class="mon-stat-chip ${s.meetingCount?'has':''}">🤝 اجتماع <b>${s.meetingCount||0}</b></span>
          </div>
        </div>
      </div>`).join('') + pendingHTML;
}

let rolesTriedForServantsList = false;

// كل الأسماء المضافة مقدمًا في أدوار الفصول ولسه ملهاش حساب: [{ name, classes, sup:Set }] — الاسم بيظهر مرة واحدة حتى لو في أكتر من دور
function pendingPeopleList() {
  const registered = new Set(S.cachedServants.map(x => nameKey(x.name)));
  const names = uniqueNames(S.allRoles.filter(r => !r.isAdmin && Array.isArray(r.classes)).flatMap(r => r.pendingNames || []))
    .filter(n => !registered.has(nameKey(n)));
  return names.map(n => ({ name: n, ...pendingPersonMap(n) }))
    .filter(x => x.classes.length)
    .sort((a,b) => a.name.localeCompare(b.name,'ar'));
}
