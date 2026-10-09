// تبويب المتابعة (أدمن) + حضور الخدام + مساعدات شاشة الخدام
import { S } from '../core/state.js';
import { collection, db, deleteDoc, doc, increment, query, serverTimestamp, setDoc, updateDoc, where } from '../core/firebase.js';
import { normalizeArabic } from '../core/idb-cache.js';
import { countedGetDocs } from '../core/reads-counter.js';
import { loadServantsFresh, loadServantsOnce, renderServantsList } from './class-servants.js';
import { classBadgeHTML, classLabel, classPalette, normalizeAssignedClasses, supervisedClassesOf } from './classes.js';
import { toLocalDateKey } from './settings.js';

// ===== MONITOR (ADMIN) =====
// بث لحظي على قائمة الخدام كلها: أي قبول/رفض/ترقية/تنزيل/حذف بيحصل من أي أدمن (حتى من جهاز تاني)
// يظهر فورًا عند كل الأدمنز الفاتحين تبويب "متابعة" من غير reload
window.loadMonitorTab = async () => {
  if (S.currentRole !== 'admin') return;
  renderMonitorClassChips();
  // الأدمن لما يفتح "الخدام" يفتحله تبويب "الخدام" (مش الحضور) تلقائي
  switchMonitorSubTab('servants');
  await loadServantsFresh();
  const di = document.getElementById('activity-date'); if (di && !di.value) di.value = toLocalDateKey(new Date());
  document.getElementById('activity-list').innerHTML = `<div class="empty-state">اختار التاريخ واضغط "عرض"</div>`;
  const sd = document.getElementById('serv-att-date'); if (sd && !sd.value) sd.value = toLocalDateKey(new Date());
};

// ===== حضور الخدام (القداس / مدارس الأحد / اجتماع الخدام / التحضير) =====
let servAttActivity = 'mass'; // 'mass' | 'sunday_school' | 'meeting' | 'preparation'

export const SERV_ATT_LABELS = { mass:'القداس', sunday_school:'مدارس الأحد', meeting:'اجتماع الخدام', preparation:'التحضير' };

export const SERV_ATT_EMOJI = { mass:'⛪', sunday_school:'📖', meeting:'🤝', preparation:'📝' };

export function monitorFilterServants(list) {
  if (S.monitorClassFilter === 'all') return list;
  const id = String(S.monitorClassFilter);
  return list.filter(s => normalizeAssignedClasses(s.assignedClass).includes(id));
}

export function renderMonitorClassChips() {
  const cont = document.getElementById('monitor-class-chips');
  if (!cont) return;
  cont.innerHTML = `<button class="tab ${S.monitorClassFilter==='all'?'active':''}" onclick="setMonitorClass('all')">كل الفصول</button>` +
    S.allClasses.map(c => `<button class="tab ${S.monitorClassFilter===c.id?'active':''}" onclick="setMonitorClass('${c.id}')">${c.name}</button>`).join('');
}

window.setMonitorClass = (id) => {
  S.monitorClassFilter = id;
  renderMonitorClassChips();
  onMonitorSearch();
};

window.onMonitorSearch = () => {
  if (document.getElementById('monitor-subtab-servants').style.display === 'block') renderServantsList();
  else renderServAttList();
};

window.switchMonitorSubTab = (which) => {
  document.getElementById('monitor-subtab-btn-attendance').classList.toggle('active', which === 'attendance');
  document.getElementById('monitor-subtab-btn-servants').classList.toggle('active', which === 'servants');
  document.getElementById('monitor-subtab-attendance').style.display = which === 'attendance' ? 'block' : 'none';
  document.getElementById('monitor-subtab-servants').style.display   = which === 'servants'   ? 'block' : 'none';
  document.getElementById('monitor-attendance-activities').style.display = which === 'attendance' ? 'block' : 'none';
  const hero = document.getElementById('mon-hero'); if (hero) hero.classList.toggle('srv-mode', which === 'servants');
  const hsub = document.getElementById('mon-hero-sub'); if (hsub && which === 'servants') hsub.textContent = 'إدارة الخدام وطلبات الانضمام';
  if (which === 'attendance') renderServAttList(); else renderServantsList();
};

window.setServAttActivity = (activity, btn) => {
  servAttActivity = activity;
  document.querySelectorAll('#serv-att-activity-chips .tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderServAttList();
};

export function servAttDocId(date, activity, servantId) { return `${date}_${activity}_${servantId}`; }

// بيجيب مين متسجل حضوره للتاريخ والنشاط المختارين بس (قراءة صغيرة ومحدودة، مش كل السجل)
// ===== مساعدات شاشة الخدام (أفاتار / شارات الفصول / الدور / ملخص الهيرو) =====
export function servantAvatarHTML(s) {
  const first = normalizeAssignedClasses(s.assignedClass)[0];
  const p = first ? classPalette(first) : { bg:'rgba(79,142,247,0.15)', text:'#4f8ef7' };
  return `<div class="mon-avatar" style="background:${p.bg};color:${p.text}">${(s.name||'؟').trim()[0]||'؟'}</div>`;
}

export function servantClassBadges(s) {
  const ids = normalizeAssignedClasses(s.assignedClass);
  if (!ids.length) return `<span class="class-badge" style="background:rgba(46,204,113,0.12);border:1px solid rgba(46,204,113,0.3);color:#2ecc71">🔓 كل الفصول</span>`;
  return ids.map(cid => classBadgeHTML(cid)).join('');
}

export function servantRoleChip(s) {
  if (s.role === 'admin') return `<span class="mon-role admin">👑 أدمن</span>`;
  if (s.role === 'supervisor') {
    const sup = supervisedClassesOf(s), all = normalizeAssignedClasses(s.assignedClass);
    const mixed = sup.length && all.some(c => !sup.includes(c));
    return `<span class="mon-role sup">🗝️ مسؤول فصل${mixed ? ' (' + sup.map(classLabel).join(' + ') + ')' : ''}</span>`;
  }
  return '';
}

function updateMonHero(date, total, present) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('mon-stat-total', total);
  set('mon-stat-present', present);
  set('mon-stat-absent', Math.max(0, total - present));
  let d = '';
  try { d = new Date(date + 'T00:00:00').toLocaleDateString('ar-EG', { weekday:'long', day:'numeric', month:'long' }); } catch (e) {}
  set('mon-hero-sub', `${SERV_ATT_EMOJI[servAttActivity]} ${SERV_ATT_LABELS[servAttActivity]}${d ? ' · ' + d : ''}`);
}

async function renderServAttList() {
  const cont = document.getElementById('serv-att-list');
  if (!cont) return;
  const date = document.getElementById('serv-att-date')?.value || toLocalDateKey(new Date());
  if (!S.servantsLoadedFlag) await loadServantsOnce();
  let servants = monitorFilterServants(S.cachedServants.filter(s => s.status === 'approved')).sort((a,b) => (a.name||'').localeCompare(b.name||'','ar'));
  const classBase = servants;
  if (!servants.length) { updateMonHero(date, 0, 0); cont.innerHTML = `<div class="empty-state">مفيش خدام متسجلين لسه</div>`; return; }
  const searchQ = normalizeArabic(document.getElementById('monitor-search-input')?.value || '');
  if (searchQ) servants = servants.filter(s => normalizeArabic(s.name||'').includes(searchQ));
  if (!servants.length) { cont.innerHTML = `<div class="empty-state">مفيش خادم بالاسم ده</div>`; return; }
  cont.innerHTML = `<div class="loading"><div class="spinner"></div>جاري التحميل…</div>`;
  try {
    const snap = await countedGetDocs(query(collection(db,'servantAttendance'), where('date','==',date), where('activity','==',servAttActivity)), `servantAttendance (${SERV_ATT_LABELS[servAttActivity]})`);
    const presentIds = new Set(snap.docs.map(d => d.data().servantId));
    const presentTotal = classBase.filter(s => presentIds.has(s.id)).length;
    updateMonHero(date, classBase.length, presentTotal);
    const pct = classBase.length ? Math.round(presentTotal / classBase.length * 100) : 0;
    const summary = `<div class="mon-summary">
      <div class="mon-sum-row"><span><b>${presentTotal}</b> من ${classBase.length} حضروا ${SERV_ATT_EMOJI[servAttActivity]}</span><span class="mon-sum-pct">${pct}%</span></div>
      <div class="mon-sum-track"><div class="mon-sum-fill" style="width:${pct}%"></div></div>
    </div>`;
    cont.innerHTML = summary + servants.map(s => {
      const present = presentIds.has(s.id);
      return `
      <div class="servant-item mon-row ${present ? 'present' : ''}" onclick="toggleServantAttendance('${s.id}','${(s.name||'').replace(/'/g,"\\'")}','${date}')">
        ${servantAvatarHTML(s)}
        <div class="s-info">
          <div class="mon-name">${s.name||'—'}${servantRoleChip(s)}</div>
          <div class="mon-badges">${servantClassBadges(s)}</div>
        </div>
        <div class="serv-att-check ${present ? 'checked' : ''}"></div>
      </div>`;
    }).join('');
  } catch(e) {
    console.error(e);
    cont.innerHTML = `<div class="empty-state">تعذّر تحميل الحضور</div>`;
  }
}

// بتسجل/تشيل حضور خادم في نشاط معين — ولو النشاط "مدارس الأحد" أو "اجتماع الخدام"، بيتحدّث عداد الخادم فورًا (من غير أي قراءة إضافية، الرقم موجود جوه مستند الخادم نفسه)
window.toggleServantAttendance = async (servantId, name, date) => {
  const id = servAttDocId(date, servAttActivity, servantId);
  const countField = servAttActivity === 'sunday_school' ? 'sscCount' : servAttActivity === 'meeting' ? 'meetingCount' : servAttActivity === 'preparation' ? 'prepCount' : null;
  try {
    const alreadyPresent = document.querySelector(`[onclick*="toggleServantAttendance('${servantId}'"] .serv-att-check`)?.classList.contains('checked');
    if (alreadyPresent) {
      await deleteDoc(doc(db,'servantAttendance',id));
      if (countField) { await updateDoc(doc(db,'servants',servantId), { [countField]: increment(-1) }); const sv = S.cachedServants.find(x=>x.id===servantId); if (sv) sv[countField] = Math.max(0,(sv[countField]||0)-1); }
      showToast(`تم إلغاء حضور ${name}`, 'info');
    } else {
      await setDoc(doc(db,'servantAttendance',id), { servantId, name, date, activity: servAttActivity, timestamp: serverTimestamp() });
      if (countField) { await updateDoc(doc(db,'servants',servantId), { [countField]: increment(1) }); const sv = S.cachedServants.find(x=>x.id===servantId); if (sv) sv[countField] = (sv[countField]||0)+1; }
      showToast(`تم تسجيل حضور ${name} في ${SERV_ATT_EMOJI[servAttActivity]} ${SERV_ATT_LABELS[servAttActivity]} ✓`, 'success');
    }
    renderServAttList();
    if (document.getElementById('monitor-subtab-servants')?.style.display === 'block') renderServantsList(S.cachedServants.filter(x => x.status === 'approved'));
  } catch(e) { console.error(e); showToast('حصل خطأ، حاول تاني', 'error'); }
};
