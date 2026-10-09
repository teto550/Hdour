// داشبورد الخدام
import { S } from '../core/state.js';
import { arrayRemove, arrayUnion, collection, db, deleteDoc, doc, limit, orderBy, query, updateDoc, where } from '../core/firebase.js';
import { countedGetDocs } from '../core/reads-counter.js';
import { canHandleRequest, loadServantsOnce, patchServantLocal } from './class-servants.js';
import { ensureAllClassesForAdmin, nameVariantsIn, normalizeAssignedClasses } from './classes.js';
import { ensureStudents } from './students.js';
import { loadRolesOnce } from './users-roles.js';

// ===== داشبورد الخدام (تحت عنوان "الخدام" عند الأدمن) =====
// بيستخدم البيانات المحمّلة أصلاً (cachedServants + allStudents + allClasses) وعدّادات الحضور المخزنة على كل خادم — من غير أي قراءة إضافية من فايرستور
export const dEsc = t => String(t ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

const DASH_SECTIONS = [
  { id:'kpi',     name:'📋 ملخص عام',                  desc:'عدد الخدام والمخدومين والفصول ومتوسط المخدومين للخادم' },
  { id:'ssc',     name:'📖 الأكثر حضورًا لمدارس الأحد',  desc:'ترتيب الخدام حسب عدد مرات حضور مدارس الأحد' },
  { id:'meeting', name:'🤝 الأكثر حضورًا لاجتماع الخدام', desc:'ترتيب الخدام حسب عدد مرات حضور الاجتماع' },
  { id:'prep',    name:'📝 الأكثر حضورًا للتحضير',       desc:'ترتيب الخدام حسب عدد مرات حضور التحضير' },
  { id:'total',   name:'🏆 إجمالي الحضور',              desc:'مجموع حضور كل خادم (مدارس أحد + اجتماع + تحضير)' },
  { id:'classes', name:'🏫 توزيع الخدام على الفصول',     desc:'عدد الخدام والمخدومين في كل فصل ونسبة المخدومين لكل خادم' },
  { id:'noAtt',   name:'⏳ خدام مسجلوش حضور',           desc:'خدام معتمدين ملهمش أي حضور متسجل لسه' },
  { id:'noClass', name:'⚠️ مخدومين بدون فصل',           desc:'مخدومين لسه متقسموش على فصل' },
  { id:'list',    name:'📄 قائمة الخدام بالتليفونات',    desc:'كل فصل وتحته خدامه وأرقام تليفوناتهم' }
];

const DASH_DEFAULT = ['kpi','ssc','meeting','prep','classes','noAtt'];

function getDashPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem('dashSections') || 'null');
    if (Array.isArray(saved) && saved.length) return saved;
  } catch (e) {}
  return DASH_DEFAULT.slice();
}

function saveDashPrefs(ids) { try { localStorage.setItem('dashSections', JSON.stringify(ids)); } catch (e) {} }

window.openDashModal = () => {
  const active = getDashPrefs();
  document.getElementById('dash-options').innerHTML = DASH_SECTIONS.map(s => `
    <label class="dash-opt">
      <input type="checkbox" value="${s.id}" ${active.includes(s.id) ? 'checked' : ''}>
      <span class="dash-opt-txt">
        <span class="dash-opt-name">${s.name}</span>
        <div class="dash-opt-desc">${s.desc}</div>
      </span>
    </label>`).join('');
  document.getElementById('dash-modal').style.display = 'flex';
};

window.closeDashModal = () => { document.getElementById('dash-modal').style.display = 'none'; };

window.closeDashModalOutside = (e) => { if (e.target.id === 'dash-modal') closeDashModal(); };

function dashApprovedServants() { return S.cachedServants.filter(x => x.status === 'approved'); }

function dashServantStats(sv) {
  const ssc = sv.sscCount || 0, meeting = sv.meetingCount || 0, prep = sv.prepCount || 0;
  return { ssc, meeting, prep, total: ssc + meeting + prep };
}

function dashBarChart(rows, color, suffix) {
  if (!rows.length) return `<div class="dash-empty">مفيش بيانات</div>`;
  const max = Math.max(...rows.map(r => r.value), 1);
  return rows.map((r, i) => {
    const rank = i < 3 ? `top${i + 1}` : '';
    const pct = Math.round(r.value / max * 100);
    return `<div class="dash-bar-row">
      <div class="dash-bar-head">
        <span class="dash-rank ${rank}">${i + 1}</span>
        <span class="dash-bar-name">${dEsc(r.name)}</span>
        <span class="dash-bar-val" style="color:${color}">${r.value}${suffix || ''}</span>
      </div>
      <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${Math.max(pct, 3)}%;background:${color}"></div></div>
    </div>`;
  }).join('');
}

function dashCard(title, inner) { return `<div class="dash-card"><div class="dash-card-title">${title}</div>${inner}</div>`; }

function dashServantPhone(sv) { return sv.phone ? dEsc(sv.phone) : 'لا يوجد رقم هاتف'; }

function buildDashboardHTML() {
  const active = getDashPrefs();
  const servants = dashApprovedServants();
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'ar');
  const noClassStudents = S.allStudents.filter(s => !s.classSection).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
  const rowsBy = key => servants.map(sv => ({ name: sv.name || '—', value: dashServantStats(sv)[key] })).sort((a, b) => b.value - a.value);
  let out = '';

  if (active.includes('kpi')) {
    const avg = servants.length ? (S.allStudents.length / servants.length).toFixed(1) : '0';
    const noAttCount = servants.filter(sv => dashServantStats(sv).total === 0).length;
    out += dashCard('📋 ملخص عام', `<div class="dash-kpis">
      <div class="dash-kpi"><div class="dash-kpi-num" style="color:var(--accent)">${servants.length}</div><div class="dash-kpi-lbl">عدد الخدام</div></div>
      <div class="dash-kpi"><div class="dash-kpi-num" style="color:var(--accent2)">${S.allStudents.length}</div><div class="dash-kpi-lbl">عدد المخدومين</div></div>
      <div class="dash-kpi"><div class="dash-kpi-num" style="color:var(--success)">${S.allClasses.length}</div><div class="dash-kpi-lbl">عدد الفصول</div></div>
      <div class="dash-kpi"><div class="dash-kpi-num" style="color:var(--text)">${avg}</div><div class="dash-kpi-lbl">متوسط المخدومين للخادم</div></div>
      <div class="dash-kpi"><div class="dash-kpi-num" style="color:var(--warning)">${noAttCount}</div><div class="dash-kpi-lbl">خدام مسجلوش حضور</div></div>
      <div class="dash-kpi"><div class="dash-kpi-num" style="color:var(--danger)">${noClassStudents.length}</div><div class="dash-kpi-lbl">مخدومين بدون فصل</div></div>
    </div>`);
  }
  if (active.includes('ssc'))     out += dashCard('📖 الأكثر حضورًا لمدارس الأحد', dashBarChart(rowsBy('ssc'), 'var(--success)'));
  if (active.includes('meeting')) out += dashCard('🤝 الأكثر حضورًا لاجتماع الخدام', dashBarChart(rowsBy('meeting'), 'var(--accent)'));
  if (active.includes('prep'))    out += dashCard('📝 الأكثر حضورًا للتحضير', dashBarChart(rowsBy('prep'), '#f1c40f'));
  if (active.includes('total'))   out += dashCard('🏆 إجمالي الحضور', dashBarChart(rowsBy('total'), 'var(--accent2)'));

  if (active.includes('classes')) {
    const inner = S.allClasses.length ? S.allClasses.map(c => {
      const sv = servants.filter(x => normalizeAssignedClasses(x.assignedClass).includes(c.id));
      const st = S.allStudents.filter(x => x.classSection === c.id);
      const ratio = sv.length ? (st.length / sv.length).toFixed(1) : null;
      return `<div class="dash-li">
        <span class="dash-li-name">${dEsc(c.emoji || '📘')} ${dEsc(c.name)}</span>
        <span class="dash-li-val">${sv.length} خادم · ${st.length} مخدوم</span>
        <span class="dash-pill ${ratio === null ? 'bad' : 'ok'}">${ratio === null ? 'مفيش خدام' : ratio + ' لكل خادم'}</span>
      </div>`;
    }).join('') : `<div class="dash-empty">مفيش فصول</div>`;
    const allCls = servants.filter(x => !normalizeAssignedClasses(x.assignedClass).length).length;
    out += dashCard('🏫 توزيع الخدام على الفصول', inner + (allCls ? `<div class="dash-empty" style="margin-top:6px">🔓 ${allCls} خادم على كل الفصول (مش محسوبين فوق)</div>` : ''));
  }

  if (active.includes('noAtt')) {
    const rows = servants.filter(sv => dashServantStats(sv).total === 0).sort(byName);
    const inner = rows.length
      ? rows.map(sv => `<div class="dash-li"><span class="dash-li-name">${dEsc(sv.name || '—')}</span><span class="dash-pill bad">مفيش حضور</span></div>`).join('')
      : `<div class="dash-empty">تمام ✅ كل الخدام ليهم حضور متسجل</div>`;
    out += dashCard('⏳ خدام مسجلوش حضور', inner);
  }

  if (active.includes('noClass')) {
    const inner = noClassStudents.length
      ? noClassStudents.map(s => `<div class="dash-li"><span class="dash-li-name">${dEsc(s.name)}</span><span class="dash-phone">${(s.phones || []).filter(Boolean).map(dEsc).join(' — ') || 'لا يوجد رقم هاتف'}</span></div>`).join('')
      : `<div class="dash-empty">تمام ✅ كل المخدومين ليهم فصل</div>`;
    out += dashCard('⚠️ مخدومين بدون فصل', inner);
  }

  if (active.includes('list')) {
    const groups = S.allClasses.map(c => ({ title: `${dEsc(c.emoji || '📘')} ${dEsc(c.name)}`, list: servants.filter(x => normalizeAssignedClasses(x.assignedClass).includes(c.id)).sort(byName) }));
    const allClsList = servants.filter(x => !normalizeAssignedClasses(x.assignedClass).length).sort(byName);
    if (allClsList.length) groups.push({ title: '🔓 كل الفصول', list: allClsList });
    const inner = groups.map(g => {
      const rows = g.list.length
        ? g.list.map(sv => `<div class="dash-li"><span class="dash-li-name">${dEsc(sv.name || '—')}</span><span class="dash-phone">${dashServantPhone(sv)}</span></div>`).join('')
        : `<div class="dash-empty">مفيش خدام في الفصل ده</div>`;
      return `<div class="dash-sub-name">${g.title} <span style="font-size:11px;color:var(--text-dim);font-weight:700">(${g.list.length})</span></div>${rows}`;
    }).join('');
    out += dashCard('📄 قائمة الخدام بالتليفونات', inner || `<div class="dash-empty">مفيش خدام</div>`);
  }

  return out || `<div class="dash-empty">مختارتش أي قسم — دوس ⚙️ واختار الأقسام</div>`;
}

window.openDashboard = async () => {
  await ensureAllClassesForAdmin();
  const boxes = document.querySelectorAll('#dash-options input[type=checkbox]');
  if (boxes.length) saveDashPrefs(Array.from(boxes).filter(b => b.checked).map(b => b.value));
  closeDashModal();
  try { await ensureStudents(); if (!S.servantsLoadedFlag) await loadServantsOnce(); } catch (e) { console.error(e); }
  const servants = dashApprovedServants();
  if (!servants.length) { showToast('مفيش خدام معتمدين لسه', 'info'); return; }
  document.getElementById('dash-subtitle').textContent = `${servants.length} خادم · ${S.allStudents.length} مخدوم · ${S.allClasses.length} فصل`;
  document.getElementById('dash-body').innerHTML = buildDashboardHTML();
  document.getElementById('dash-view').style.display = 'block';
  document.body.style.overflow = 'hidden';
};

window.closeDashboard = () => {
  document.getElementById('dash-view').style.display = 'none';
  document.body.style.overflow = '';
};

// نسخة فاتحة من الداشبورد للطباعة / الحفظ كـ PDF
function buildDashboardPrintDocument(bodyHtml) {
  const servants = dashApprovedServants();
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<title>داشبورد الخدام</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
  :root { --surface2:#f4f6fa; --border:#e3e7ef; --text-dim:#6b7385; --accent:#4f8ef7; --accent2:#7c5cbf; --success:#27ae60; --danger:#e74c3c; --warning:#c49b06; --radius:12px; --radius-sm:8px; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Cairo',sans-serif; color:#1a1f2e; padding:20px; max-width:720px; margin:0 auto; }
  h1 { font-size:22px; font-weight:900; }
  .sub { font-size:12px; color:var(--text-dim); margin:4px 0 16px; }
  .dash-card { border:1px solid var(--border); border-radius:var(--radius); padding:16px; margin-bottom:14px; page-break-inside:avoid; }
  .dash-card-title { font-size:15px; font-weight:800; margin-bottom:14px; }
  .dash-kpis { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
  .dash-kpi { background:var(--surface2); border:1px solid var(--border); border-radius:var(--radius-sm); padding:12px 8px; text-align:center; }
  .dash-kpi-num { font-size:22px; font-weight:900; }
  .dash-kpi-lbl { font-size:10px; color:var(--text-dim); margin-top:4px; }
  .dash-bar-row { margin-bottom:11px; }
  .dash-bar-head { display:flex; align-items:center; gap:8px; font-size:12px; margin-bottom:4px; }
  .dash-rank { width:20px; height:20px; border-radius:6px; background:var(--surface2); display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:800; color:var(--text-dim); }
  .dash-rank.top1 { background:#fdf3cf; color:#c49b06; } .dash-rank.top2 { background:#eef1f2; color:#8d9698; } .dash-rank.top3 { background:#fbe7d6; color:#c4600f; }
  .dash-bar-name { flex:1; font-weight:700; } .dash-bar-val { font-weight:800; }
  .dash-bar-track { height:7px; background:var(--surface2); border-radius:6px; overflow:hidden; } .dash-bar-fill { height:100%; border-radius:6px; }
  .dash-li { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:7px 0; border-bottom:1px solid #f0f0f0; font-size:12px; }
  .dash-li:last-child { border-bottom:none; } .dash-li-name { font-weight:700; flex:1; } .dash-li-val { font-size:11px; color:var(--text-dim); }
  .dash-phone { font-size:11px; color:#555; direction:ltr; }
  .dash-pill { font-size:10px; font-weight:700; padding:3px 8px; border-radius:20px; }
  .dash-pill.bad { background:#fdeceb; color:var(--danger); } .dash-pill.ok { background:#eafaf1; color:#27ae60; } .dash-pill.warn { background:#fef9e7; color:#c49b06; }
  .dash-sub-name { font-size:13px; font-weight:800; margin:12px 0 5px; padding-bottom:4px; border-bottom:1px solid var(--border); }
  .dash-empty { color:#999; font-size:11px; text-align:center; padding:8px 0; }
  @media print { body { padding:0; } }
</style></head>
<body>
  <h1>📊 داشبورد الخدام</h1>
  <div class="sub">${servants.length} خادم · ${S.allStudents.length} مخدوم · ${S.allClasses.length} فصل · ${new Date().toLocaleDateString('ar-EG', { day:'numeric', month:'long', year:'numeric' })}</div>
  ${bodyHtml}
</body></html>`;
}

window.printDashboard = () => {
  const win = window.open('', '_blank');
  if (!win) { showToast('امنع حظر النوافذ المنبثقة للموقع ده من إعدادات المتصفح', 'error'); return; }
  win.document.open();
  win.document.write(buildDashboardPrintDocument(buildDashboardHTML()));
  win.document.close();
  setTimeout(() => { try { win.focus(); win.print(); } catch (e) {} }, 500);
};

window.renderActivityList = async function() {
  const cont = document.getElementById('activity-list');
  const v = document.getElementById('activity-date').value;
  if (!v) { cont.innerHTML = `<div class="empty-state">اختار تاريخ الأول</div>`; return; }
  cont.innerHTML = `<div class="loading"><div class="spinner"></div>جاري التحميل…</div>`;
  try {
    const start = new Date(v + 'T00:00:00'), end = new Date(start.getTime() + 86400000);
    const snap = await countedGetDocs(query(collection(db,'activityLog'), where('timestamp','>=',start), where('timestamp','<',end), orderBy('timestamp','desc'), limit(100)), 'activityLog');
    if (snap.empty) { cont.innerHTML = `<div class="empty-state">لا يوجد أنشطة في اليوم ده</div>`; return; }
    cont.innerHTML = snap.docs.map(d => {
      const a = d.data();
      const t = a.timestamp?.toDate ? a.timestamp.toDate().toLocaleString('ar-EG',{hour:'2-digit',minute:'2-digit'}) : '';
      return `<div class="activity-item"><b>${a.name||'؟'}</b> — ${a.action}${a.detail?': '+a.detail:''}<br>${t}</div>`;
    }).join('');
  } catch(e) {
    cont.innerHTML = `<div class="empty-state">تعذّر تحميل الأنشطة</div>`;
  }
};

// ملحوظة: قايمة الخدام هنا مش بث لحظي (onSnapshot)، دي قراءة مرة واحدة متخزنة في cachedServants —
// عشان كده كل عملية تغيير هنا لازم تعمل loadServantsOnce(true) عشان تجيب النسخة الجديدة من السيرفر
window.approveServant = async (id, name, roleIds) => {
  if (!canHandleRequest(S.cachedServants.find(x => x.id === id))) { showToast('الطلب ده مش من فصولك', 'error'); return; }
  if (!S.rolesLoadedFlag) { try { await loadRolesOnce(); } catch(e) {} }
  try { await updateDoc(doc(db,'servants',id), { status:'approved' }); }
  catch(e) { console.error(e); showToast('مش مسموحلك تقبل الطلب ده — راجع صلاحيات Firestore', 'error'); return; }
  patchServantLocal(id, { status:'approved' });
  // لو اسمه كان مختار من قايمة أسماء الدور الجاهزة، بيتمسح من القايمة دلوقتي (بعد القبول) عشان محدش تاني يختاره
  if (name && roleIds) {
    try { for (const rid of String(roleIds).split(',').filter(Boolean)) { const v = nameVariantsIn(S.allRoles.find(x => x.id === rid), name); await updateDoc(doc(db,'roles',rid), { pendingNames: arrayRemove(...(v.length ? v : [name])) }); } loadRolesOnce(true); } catch(e) { console.error(e); }
  }
  showToast('تم قبول الخادم ✓', 'success');
};

window.rejectServant = async (id, name, roleIds) => {
  if (!canHandleRequest(S.cachedServants.find(x => x.id === id))) { showToast('الطلب ده مش من فصولك', 'error'); return; }
  if (!confirm(`هترفض طلب "${name}"؟`)) return;
  if (!S.rolesLoadedFlag) { try { await loadRolesOnce(); } catch(e) {} }
  try { await deleteDoc(doc(db,'servants',id)); }
  catch(e) { console.error(e); showToast('مش مسموحلك ترفض الطلب ده — راجع صلاحيات Firestore', 'error'); return; }
  patchServantLocal(id, null);
  // لو الاسم ده كان مختار من قايمة أسماء الدور الجاهزة، يرجع يظهر في القايمة تاني عشان يقدر أي حد يختاره
  if (name && roleIds) {
    try { for (const rid of String(roleIds).split(',').filter(Boolean)) await updateDoc(doc(db,'roles',rid), { pendingNames: arrayUnion(name) }); loadRolesOnce(true); } catch(e) { console.error(e); }
  }
  showToast('تم رفض الطلب', 'info');
};

window.deleteServant = async (id, name, roleIds) => {
  if (!confirm(`هتحذف الخادم "${name}"؟ هيفقد صلاحية الدخول للتطبيق فورًا حتى لو داخل بيسجل حضور دلوقتي`)) return;
  await deleteDoc(doc(db,'servants',id)); patchServantLocal(id, null);
  // لو الاسم ده كان مختار من قايمة أسماء الدور الجاهزة، يرجع يظهر في القايمة تاني عشان يقدر أي حد يختاره
  if (name && roleIds) {
    try { for (const rid of String(roleIds).split(',').filter(Boolean)) await updateDoc(doc(db,'roles',rid), { pendingNames: arrayUnion(name) }); loadRolesOnce(true); } catch(e) { console.error(e); }
  }
  showToast('تم حذف الخادم', 'success');
};

window.promoteServant = async (id, name) => {
  if (!confirm(`هتخلي "${name}" أدمن؟ هيقدر يشوف تبويب "متابعة" ويوافق على الخدام ويحذفهم زيك بالظبط`)) return;
  await updateDoc(doc(db,'servants',id), { role:'admin' }); patchServantLocal(id, { role:'admin' });
  showToast(`${name} بقى أدمن ✓`, 'success');
};

window.demoteServant = async (id, name) => {
  if (!confirm(`هتشيل "${name}" من الأدمن؟ هيرجع خادم عادي فورًا ومش هيقدر يدخل تبويب "متابعة" تاني`)) return;
  await updateDoc(doc(db,'servants',id), { role:'servant' }); patchServantLocal(id, { role:'servant' });
  showToast(`تم تنزيل ${name} من الأدمن`, 'info');
};
