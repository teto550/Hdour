// تبويب رسائل واتساب الجماعية + قوالب الرسائل + تصدير VCF
import { S } from '../core/state.js';
import { addDoc, collection, db, deleteDoc, doc, orderBy, query, serverTimestamp, updateDoc } from '../core/firebase.js';
import { countedGetDocs } from '../core/reads-counter.js';
import { attIsStale, attSessionDates, ensureRecentAttendance, filterWeeks } from './attendance.js';
import { classLabel, classScope, ownClassStudents } from './classes.js';
import { bumpStudentsRev, computeSiblingCounts, familyKey } from './students.js';

// ===== WHATSAPP BULK MESSAGE TAB =====
let waSiblingsFilter = 'all'; // 'all' | 'siblings' | 'nonSiblings'

let waGenderFilter   = 'all'; // 'all' | 'male' | 'female'

let waGroupFilter    = 'all'; // 'all' | 'notAdded' | 'added' — حالة الانضمام لجروب الواتساب

let waBdayMonth      = 0;

let waChecked        = new Set();

let waQueue          = [];

let waQueueIndex      = 0;

let waTemplates       = [];

let waTemplatesLoaded = false;

// تحويل رقم مصري لصيغة دولية لواتساب (01xxxxxxxxx -> 201xxxxxxxxx)
function normalizeEgyptPhone(p) {
  if (!p) return '';
  let d = p.replace(/\D/g, '');
  if (d.startsWith('0')) d = '20' + d.slice(1);
  else if (!d.startsWith('20')) d = '20' + d;
  return d;
}

// فتح رابط خارجي بدون تأخير "تبويب فارغ بيحمل" اللي بيحصل مع window.open
function openExternalLink(url) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// الرقم اللي هيتبعت عليه على واتساب: الرقم المحدد يدويًا أولًا (waPhoneIndex)، وإلا أول رقم في الملف
function getWaPhone(s) {
  if (s.phones?.length) {
    if (s.waPhoneIndex != null && s.phones[s.waPhoneIndex]) return s.phones[s.waPhoneIndex];
    return s.phones[0] || '';
  }
  return '';
}

// تحديد رقم معين كرقم الواتساب الرسمي لهذا المخدوم
window.markWaPhone = async (id, idx) => {
  try {
    await updateDoc(doc(db,'students',id), { waPhoneIndex: idx, updatedAt: serverTimestamp() }); bumpStudentsRev();
    const s = S.allStudents.find(x => x.id === id);
    if (s) s.waPhoneIndex = idx;
    showToast('تم تحديد رقم الواتساب ✓', 'success');
    openProfile(id);
  } catch(e) {
    showToast('حصل خطأ أثناء الحفظ', 'error');
  }
};

window.insertWaNamePlaceholder = () => {
  const ta = document.getElementById('wa-message');
  const start = ta.selectionStart ?? ta.value.length;
  const end   = ta.selectionEnd   ?? ta.value.length;
  const token = '{اسم_المخدوم}';
  ta.value = ta.value.slice(0, start) + token + ta.value.slice(end);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = start + token.length;
};

// ===== SAVED MESSAGE TEMPLATES (memory) =====
async function loadWaTemplates() {
  if (waTemplatesLoaded) return;
  try {
    const snap = await countedGetDocs(query(collection(db,'messageTemplates'), orderBy('name')), 'messageTemplates');
    waTemplates = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    waTemplatesLoaded = true;
  } catch(e) {
    console.error(e);
  }
  renderWaTemplatesList();
}

function renderWaTemplatesList() {
  const cont = document.getElementById('wa-templates-list');
  if (!cont) return;
  if (!waTemplates.length) {
    cont.innerHTML = `<div class="tpl-empty">مفيش رسائل محفوظة لسه</div>`;
    return;
  }
  cont.innerHTML = `<div class="tpl-row">` + waTemplates.map(t => `
    <div class="tpl-chip" onclick="useWaTemplate('${t.id}')">
      <span class="tpl-chip-name">${t.name}</span>
      <button type="button" class="tpl-chip-del" onclick="event.stopPropagation();deleteWaTemplate('${t.id}')">✕</button>
    </div>`).join('') + `</div>`;
}

window.saveCurrentWaMessage = async () => {
  const text = document.getElementById('wa-message').value.trim();
  if (!text) { showToast('اكتب نص الرسالة الأول', 'error'); return; }
  const name = prompt('اكتب اسم للرسالة دي (علشان تلاقيها بسرعة):');
  if (!name || !name.trim()) return;
  try {
    const ref = await addDoc(collection(db,'messageTemplates'), { name: name.trim(), text, timestamp: serverTimestamp() });
    waTemplates.push({ id: ref.id, name: name.trim(), text });
    waTemplates.sort((a,b) => a.name.localeCompare(b.name,'ar'));
    renderWaTemplatesList();
    showToast('اتحفظت الرسالة ✓', 'success');
  } catch(e) {
    showToast('حصل خطأ أثناء الحفظ', 'error');
    console.error(e);
  }
};

window.useWaTemplate = (id) => {
  const t = waTemplates.find(x => x.id === id);
  if (!t) return;
  document.getElementById('wa-message').value = t.text;
  showToast(`اتكتبت رسالة "${t.name}" ✓`, 'success');
};

window.deleteWaTemplate = async (id) => {
  const t = waTemplates.find(x => x.id === id);
  if (!t) return;
  if (!confirm(`تحذف الرسالة المحفوظة "${t.name}"؟`)) return;
  try {
    await deleteDoc(doc(db,'messageTemplates',id));
    waTemplates = waTemplates.filter(x => x.id !== id);
    renderWaTemplatesList();
    showToast('اتحذفت ✓', 'success');
  } catch(e) {
    showToast('حصل خطأ أثناء الحذف', 'error');
    console.error(e);
  }
};

function waFirstName(s) {
  return (s.name || '').trim().split(/\s+/)[0] || s.name;
}

function buildWaMessageFor(s) {
  const tpl = document.getElementById('wa-message').value || '';
  return tpl.split('{اسم_المخدوم}').join(waFirstName(s));
}

function waHasPhone(s) { return !!getWaPhone(s); }

function waRecipientsSource() {
  let list = [...classScope(ownClassStudents())]; // الرسائل تفضل لمخدومين فصل الخادم بس
  const dates = attSessionDates();
  if (waBdayMonth > 0) {
    list = list.filter(s => s.dob && new Date(s.dob).getMonth() + 1 === waBdayMonth);
  }
  if (S.waAbsenceFilter !== 'all' && dates.length > 0) {
    const n = parseInt(S.waAbsenceFilter);
    const lastDates = dates.slice(-n);
    list = list.filter(s => lastDates.every(d => !S.allAttendance[d]?.[s.id]));
  }
  if (S.waAttendanceFilter !== 'all' && dates.length > 0) {
    const n = parseInt(S.waAttendanceFilter);
    const lastDates = dates.slice(-n);
    list = list.filter(s => lastDates.length === n && lastDates.every(d => !!S.allAttendance[d]?.[s.id]));
  }
  const siblingCounts = computeSiblingCounts(classScope(ownClassStudents()));
  if (waSiblingsFilter === 'siblings') {
    list = list.filter(s => { const k = familyKey(s.name); return k && siblingCounts[k] > 1; });
  } else if (waSiblingsFilter === 'nonSiblings') {
    list = list.filter(s => { const k = familyKey(s.name); return !k || siblingCounts[k] <= 1; });
  }
  if (waGenderFilter === 'male') {
    list = list.filter(s => s.gender === 'male');
  } else if (waGenderFilter === 'female') {
    list = list.filter(s => s.gender === 'female');
  }
  if (waGroupFilter === 'notAdded') {
    list = list.filter(s => !s.waGroupAdded);
  } else if (waGroupFilter === 'added') {
    list = list.filter(s => !!s.waGroupAdded);
  }
  return list;
}

window.setWaBdayMonth = (m) => {
  waBdayMonth = parseInt(m);
  document.getElementById('wa-bday-value').textContent = document.getElementById('wa-month-select').selectedOptions[0].textContent;
  waChecked = new Set(waRecipientsSource().filter(waHasPhone).map(s => s.id));
  renderWaRecipientsList();
};

window.setWaAbsenceFilter = (v, btn) => {
  S.waAbsenceFilter = v;
  document.querySelectorAll('#wa-absence-chips .filter-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('wa-absence-value').textContent = btn.textContent.trim();
  btn.closest('details')?.removeAttribute('open');
  waChecked = new Set(waRecipientsSource().filter(waHasPhone).map(s => s.id));
  renderWaRecipientsList();
};

window.setWaAttendanceFilter = (v, btn) => {
  S.waAttendanceFilter = v;
  document.querySelectorAll('#wa-attendance-chips .filter-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('wa-attendance-value').textContent = btn.textContent.trim();
  btn.closest('details')?.removeAttribute('open');
  waChecked = new Set(waRecipientsSource().filter(waHasPhone).map(s => s.id));
  renderWaRecipientsList();
};

window.setWaSiblingsFilter = (val, btn) => {
  waSiblingsFilter = val;
  document.querySelectorAll('#wa-siblings-chips .filter-chip').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  waChecked = new Set(waRecipientsSource().filter(waHasPhone).map(s => s.id));
  renderWaRecipientsList();
};

window.setWaGenderFilter = (val, btn) => {
  waGenderFilter = val;
  document.querySelectorAll('#wa-gender-chips .filter-chip').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  waChecked = new Set(waRecipientsSource().filter(waHasPhone).map(s => s.id));
  renderWaRecipientsList();
};

window.setWaGroupFilter = (val, btn) => {
  waGroupFilter = val;
  document.querySelectorAll('#wa-group-chips .filter-chip').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  waChecked = new Set(waRecipientsSource().filter(waHasPhone).map(s => s.id));
  renderWaRecipientsList();
};

window.renderWaRecipientsList = renderWaRecipientsList;

function renderWaRecipientsList() {
  const cont = document.getElementById('wa-recipients-list');
  const waNeedAtt = S.waAbsenceFilter !== 'all' || S.waAttendanceFilter !== 'all';
  if (waNeedAtt && S.recentAttWeeks < filterWeeks()) {
    cont.innerHTML = `<div class="loading"><div class="spinner"></div>جاري التحميل…</div>`;
    ensureRecentAttendance(filterWeeks()).then(() => { waChecked = new Set(waRecipientsSource().filter(waHasPhone).map(s => s.id)); renderWaRecipientsList(); })
      .catch(e => { console.error(e); cont.innerHTML = '<div class="empty-state">تعذّر تحميل بيانات الحضور<br><button class="action-btn" style="margin-top:10px" onclick="renderWaRecipientsList()">🔄 حاول تاني</button></div>'; });
    return;
  }
  if (waNeedAtt && attIsStale() && !S.attRefreshBusy) {
    S.attRefreshBusy = true;
    const prevIds = new Set(waRecipientsSource().filter(waHasPhone).map(s => s.id));
    ensureRecentAttendance(filterWeeks()).then(() => {
      S.attRefreshBusy = false;
      const nextIds = new Set(waRecipientsSource().filter(waHasPhone).map(s => s.id));
      nextIds.forEach(id => { if (!prevIds.has(id)) waChecked.add(id); });
      waChecked = new Set([...waChecked].filter(id => nextIds.has(id)));
      renderWaRecipientsList();
    }).catch(() => { S.attRefreshBusy = false; });
  }
  const list = waRecipientsSource();
  if (!list.length) {
    cont.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div>لا يوجد مخدومين</div>`;
  } else {
    cont.innerHTML = list.map(s => {
      const phone   = getWaPhone(s);
      const checked = waChecked.has(s.id);
      const added   = !!s.waGroupAdded;
      return `<div class="wa-recipient-row ${!phone?'no-phone':''}">
        <input type="checkbox" ${checked?'checked':''} ${!phone?'disabled':''} onchange="toggleWaRecipient('${s.id}', this.checked)">
        <div class="s-info">
          <div class="s-name">${s.name}</div>
          <div class="s-sub">${phone ? phone : 'لا يوجد رقم تليفون'}</div>
        </div>
        <button type="button" title="${added ? 'اتضاف للجروب — دوس تشيل العلامة' : 'اعلّمه كمتضاف للجروب'}"
          onclick="toggleWaGroupAdded('${s.id}', ${!added})"
          style="flex-shrink:0;font-size:11px;font-weight:700;font-family:'Cairo',sans-serif;border-radius:20px;padding:5px 10px;cursor:pointer;white-space:nowrap;${added
            ? 'background:rgba(46,204,113,0.12);border:1px solid rgba(46,204,113,0.3);color:var(--success)'
            : 'background:var(--surface2);border:1px solid var(--border);color:var(--text-dim)'}">${added ? '✅ في الجروب' : '➕ للجروب'}</button>
      </div>`;
    }).join('');
  }
  updateWaRecipientsCount();
}

function updateWaRecipientsCount() {
  const withPhone = waRecipientsSource().filter(waHasPhone);
  document.getElementById('wa-recipients-count').textContent =
    `${waChecked.size} محدد من ${withPhone.length} برقم تليفون`;
}

window.toggleWaRecipient = (id, checked) => {
  if (checked) waChecked.add(id); else waChecked.delete(id);
  updateWaRecipientsCount();
};

window.toggleWaGroupAdded = async (id, value) => {
  try {
    await updateDoc(doc(db,'students',id), { waGroupAdded: value, updatedAt: serverTimestamp() }); bumpStudentsRev();
    const idx = S.allStudents.findIndex(s => s.id === id);
    if (idx !== -1) S.allStudents[idx].waGroupAdded = value;
    renderWaRecipientsList();
  } catch(e) {
    showToast('حصل خطأ أثناء الحفظ', 'error');
  }
};

// نعلّم كل المخدومين اللي بيتصدّروا دلوقتي كـ"متضافين للجروب" عشان المرة الجاية تصدّر بس اللي لسه جداد
async function markWaGroupAdded(list) {
  for (const s of list) {
    if (s.waGroupAdded) continue;
    await updateDoc(doc(db,'students',s.id), { waGroupAdded: true, updatedAt: serverTimestamp() }); bumpStudentsRev();
    const idx = S.allStudents.findIndex(x => x.id === s.id);
    if (idx !== -1) S.allStudents[idx].waGroupAdded = true;
  }
}

window.waSelectAll = (val) => {
  const list = waRecipientsSource().filter(waHasPhone);
  if (val) list.forEach(s => waChecked.add(s.id));
  else list.forEach(s => waChecked.delete(s.id));
  renderWaRecipientsList();
};

window.startWaQueue = () => {
  const msgTpl = document.getElementById('wa-message').value.trim();
  if (!msgTpl) { showToast('اكتب نص الرسالة الأول', 'error'); return; }
  const list = waRecipientsSource().filter(s => waChecked.has(s.id) && waHasPhone(s));
  if (!list.length) { showToast('اختر مخدوم واحد على الأقل عنده رقم تليفون', 'error'); return; }
  waQueue = list;
  waQueueIndex = 0;
  const box = document.getElementById('wa-queue-box');
  box.style.display = 'block';
  box.innerHTML = `
    <div style="font-size:12px;color:var(--text-dim);margin-bottom:8px" id="wa-queue-progress"></div>
    <div style="font-size:18px;font-weight:900;margin-bottom:4px" id="wa-queue-name"></div>
    <div style="font-size:13px;color:var(--text-dim);margin-bottom:16px" id="wa-queue-phone"></div>
    <div style="display:flex;gap:10px">
      <button onclick="sendCurrentWaQueueItem()" style="flex:2;background:linear-gradient(135deg,#25D366,#128C7E);border:none;border-radius:10px;color:#fff;font-family:'Cairo',sans-serif;font-size:15px;font-weight:700;padding:13px;cursor:pointer">📱 فتح واتساب</button>
      <button onclick="skipCurrentWaQueueItem()" style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:10px;color:var(--text-dim);font-family:'Cairo',sans-serif;font-size:14px;font-weight:700;padding:13px;cursor:pointer">تخطي</button>
    </div>`;
  renderWaQueueItem();
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

function renderWaQueueItem() {
  if (waQueueIndex >= waQueue.length) {
    document.getElementById('wa-queue-box').innerHTML =
      `<div style="font-size:16px;font-weight:800;color:var(--success)">✅ تم الانتهاء من كل الرسائل (${waQueue.length})</div>`;
    return;
  }
  const s = waQueue[waQueueIndex];
  const phone = getWaPhone(s);
  document.getElementById('wa-queue-progress').textContent = `${waQueueIndex+1} من ${waQueue.length}`;
  document.getElementById('wa-queue-name').textContent = s.name;
  document.getElementById('wa-queue-phone').textContent = phone;
}

window.sendCurrentWaQueueItem = () => {
  const s = waQueue[waQueueIndex];
  if (!s) return;
  const phone = getWaPhone(s);
  const num   = normalizeEgyptPhone(phone);
  const msg   = encodeURIComponent(buildWaMessageFor(s));
  openExternalLink(`https://api.whatsapp.com/send?phone=${num}&text=${msg}&type=phone_number&app_absent=0`);
  waQueueIndex++;
  renderWaQueueItem();
};

window.skipCurrentWaQueueItem = () => {
  waQueueIndex++;
  renderWaQueueItem();
};

// ===== VCF EXPORT (لعمل جروب واتساب بالأسامي) =====
function vcfEscape(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function buildVcfContent(list) {
  return list.map(s => {
    const phone = getWaPhone(s);
    const num = normalizeEgyptPhone(phone);
    const cls = s.classSection ? ` - ${classLabel(s.classSection)}` : '';
    const name = vcfEscape(s.name + cls);
    return `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${name}\r\nTEL;TYPE=CELL:+${num}\r\nEND:VCARD`;
  }).join('\r\n');
}

window.exportWaContactsVcf = async () => {
  const list = waRecipientsSource().filter(s => waChecked.has(s.id) && waHasPhone(s));
  if (!list.length) { showToast('اختر مخدوم واحد على الأقل عنده رقم تليفون', 'error'); return; }
  const vcf = buildVcfContent(list);
  const blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `مخدومين_${list.length}.vcf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  await markWaGroupAdded(list);
  renderWaRecipientsList();
  showToast(`اتصدّر ملف فيه ${list.length} جهة اتصال، واتعلّموا كـ"متضافين للجروب" ✓`, 'success');
};

window.renderWaTab = () => {
  waChecked = new Set(waRecipientsSource().filter(waHasPhone).map(s => s.id));
  renderWaRecipientsList();
  loadWaTemplates();
  const box = document.getElementById('wa-queue-box');
  if (box) box.style.display = 'none';
};
