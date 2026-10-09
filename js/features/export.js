// التصدير (Excel) للمخدومين والخدام + نوافذ اختيار الفصول
import { S } from '../core/state.js';
import { collection, db, query, where } from '../core/firebase.js';
import { countedGetDocs } from '../core/reads-counter.js';
import { loadServantsOnce } from './class-servants.js';
import { classLabel, classScope, classScopeActive, ensureAllClassesForAdmin, getAllowedAssignedClasses, normalizeAssignedClasses, supervisedClassesOf } from './classes.js';
import { SERV_ATT_LABELS } from './monitor.js';
import { NOTE_LABELS, toLocalDateKey, todayKey } from './settings.js';
import { ensureStudents } from './students.js';

// ===== EXPORT =====
let exportSelectedClasses = new Set();

// الفصول اللي الخادم أصلاً يقدر يشوفها (لو أدمن أو مسموحله بكل الفصول بترجع كل الفصول)
function exportClassChoices() {
  // الأدمن كل الفصول. الخادم/المسؤول اللي متوزع على فصل أو أكتر: فصوله هو كلها (يختار منها أو كلها).
  // اللي مش متوزع على فصل معيّن: فصله الحالي بس (إلا لو هو في بيبي/كي جي).
  const allowed = getAllowedAssignedClasses();
  if (S.currentRole === 'admin') return S.allClasses;
  if (allowed.length) return S.allClasses.filter(c => allowed.includes(c.id));
  return classScopeActive() ? S.allClasses.filter(c => c.id === S.currentClassTab) : S.allClasses;
}

function exportBaseStudents() {
  const allowed = getAllowedAssignedClasses();
  if (S.currentRole === 'admin') return S.allStudents;
  if (allowed.length) return S.allStudents.filter(s => allowed.includes(s.classSection));
  return classScope(S.allStudents);
}

// ملخص الفصول المتحددة كشيبس فيها ✕ (أو شيبس واحدة "كل الفصول" لو كلهم متحددين)
function exportClassChipsHTML(target, set, choices) {
  if (!set.size) return `<span style="font-size:12px;color:var(--text-dim)">مفيش فصل متحدد — دوس "إضافة فصل"</span>`;
  const chip = (label, onclick) => `<span class="filter-chip active" style="display:inline-flex;align-items:center;gap:8px">${label}<span onclick="${onclick}" style="cursor:pointer;opacity:.85;font-size:11px">✕</span></span>`;
  if (set.size >= choices.length) return chip(`🏫 كل الفصول (${choices.length})`, `clearExportClasses('${target}')`);
  return choices.filter(c => set.has(c.id)).map(c => chip(`${c.emoji||'📘'} ${c.name}`, `removeExportClass('${target}','${c.id}')`)).join('');
}

function renderExportClassPicker() {
  const choices = exportClassChoices();
  const wrap = document.getElementById('export-classes-wrap');
  if (choices.length <= 1) { wrap.style.display = 'none'; exportSelectedClasses = new Set(choices.map(c => c.id)); return; }
  exportSelectedClasses = new Set([...exportSelectedClasses].filter(id => choices.some(c => c.id === id)));
  wrap.style.display = 'block';
  document.getElementById('export-classes-list').innerHTML = exportClassChipsHTML('students', exportSelectedClasses, choices);
}

// ===== نافذة "إضافة فصل" للتصدير (مخدومين / خدام): اختيار فصول معينة أو كله =====
let exportClassPickTarget = null; // 'students' | 'servants'

function exportPickSet(t) { return t === 'servants' ? exportServSelected : exportSelectedClasses; }

function exportPickChoices(t) { return t === 'servants' ? exportServClassChoices() : exportClassChoices(); }

function refreshExportClassUI() { renderExportClassPicker(); renderExportServScope(); }

window.openExportClassPick = (target) => {
  exportClassPickTarget = target;
  renderExportClassPick();
  document.getElementById('export-class-pick-modal').style.display = 'flex';
};

window.closeExportClassPick = () => {
  document.getElementById('export-class-pick-modal').style.display = 'none';
  exportClassPickTarget = null;
  refreshExportClassUI();
};

window.closeExportClassPickOutside = (e) => { if (e.target.id === 'export-class-pick-modal') closeExportClassPick(); };

function renderExportClassPick() {
  const t = exportClassPickTarget; if (!t) return;
  const choices = exportPickChoices(t), set = exportPickSet(t);
  const all = choices.length > 0 && choices.every(c => set.has(c.id));
  document.getElementById('ecp-all-btn').textContent = all ? '✖ إلغاء تحديد الكل' : '✔ اختيار كل الفصول';
  document.getElementById('ecp-count').textContent = choices.filter(c => set.has(c.id)).length;
  document.getElementById('ecp-list').innerHTML = choices.map(c => `
    <div class="servant-item" onclick="toggleExportClassPickItem('${c.id}')" style="cursor:pointer;padding:9px 12px">
      <input type="checkbox" ${set.has(c.id) ? 'checked' : ''} onclick="event.stopPropagation();toggleExportClassPickItem('${c.id}')" style="width:18px;height:18px;accent-color:var(--accent);flex-shrink:0;margin-left:10px">
      <div class="s-info"><div class="s-name" style="font-size:13px">${c.emoji||'📘'} ${c.name}</div></div>
    </div>`).join('');
}

window.toggleExportClassPickItem = (id) => {
  const set = exportPickSet(exportClassPickTarget);
  if (set.has(id)) set.delete(id); else set.add(id);
  renderExportClassPick();
};

window.toggleExportClassPickAll = () => {
  const t = exportClassPickTarget, set = exportPickSet(t), choices = exportPickChoices(t);
  const all = choices.every(c => set.has(c.id));
  choices.forEach(c => { if (all) set.delete(c.id); else set.add(c.id); });
  renderExportClassPick();
};

window.removeExportClass = (target, id) => { exportPickSet(target).delete(id); refreshExportClassUI(); };

window.clearExportClasses = (target) => { exportPickSet(target).clear(); refreshExportClassUI(); };

// المخدومين اللي هيتصدّروا فعلاً: لو فيه أكتر من فصل متاح، بنفلتر على الفصول المتحددة بس
function exportTargetStudents() {
  const choices = exportClassChoices();
  const base = exportBaseStudents();
  if (choices.length <= 1) return base;
  return base.filter(s => exportSelectedClasses.has(s.classSection));
}

window.openExportModal = () => {
  closeSettingsMenu();
  // افتراضيًا كل الفصول متحددة عند فتح النافذة
  exportSelectedClasses = new Set(exportClassChoices().map(c => c.id));
  exportServSelected = new Set(exportServClassChoices().map(c => c.id));
  refreshExportClassUI();
  document.getElementById('export-modal').style.display = 'flex';
};

window.closeExportModal = () => { document.getElementById('export-modal').style.display = 'none'; };

window.closeExportOutside = (e) => { if (e.target.id === 'export-modal') closeExportModal(); };

// بيبني شيت الحضور/التسميع حسب اللي المستخدم اختاره بالظبط: حضور بس، آية بس، أو الاتنين مع بعض في نفس الشيت
function buildAttVerseSheet(expAtt, expVer, includeAtt, includeVerse) {
  const attDates = includeAtt ? Object.keys(expAtt).sort() : [];
  const verDates = includeVerse ? Object.keys(expVer).sort() : [];
  const fmt = d => { const p = d.split('-'); return `${p[2]}/${p[1]}`; };

  let cols, dual;
  if (includeAtt && includeVerse) {
    // كل تاريخ حضور بيبقى عمود، وأي تاريخ آية من غيره ينضم لأقرب تاريخ حضور سابق له
    cols = attDates.map(d => ({ dateKey: d, verseDates: [d] }));
    verDates.forEach(vd => {
      if (attDates.includes(vd)) return;
      let target = null;
      for (const c of cols) { if (c.dateKey <= vd) target = c; else break; }
      if (target) target.verseDates.push(vd);
      else cols.push({ dateKey: vd, verseDates: [vd] }); // مفيش تاريخ حضور قبله خالص
    });
    cols.sort((a,b) => a.dateKey.localeCompare(b.dateKey));
    dual = true;
  } else if (includeAtt) {
    cols = attDates.map(d => ({ dateKey: d, verseDates: [] }));
    dual = false;
  } else {
    cols = verDates.map(d => ({ dateKey: d, verseDates: [d] }));
    dual = false;
  }

  const row1 = ['الاسم'];
  const row2 = [''];
  cols.forEach(c => {
    if (dual) { row1.push(fmt(c.dateKey), ''); row2.push('حضور', 'آية'); }
    else { row1.push(fmt(c.dateKey)); row2.push(includeAtt ? 'حضور' : 'آية'); }
  });

  const rows = exportTargetStudents().map(s => {
    const r = [s.name];
    cols.forEach(c => {
      if (dual) {
        const att = !!expAtt[c.dateKey]?.[s.id];
        const vEntry = c.verseDates.map(vd => expVer[vd]?.[s.id]).find(Boolean);
        r.push(att ? '✓' : '', vEntry ? (vEntry.verse || '✓') : '');
      } else if (includeAtt) {
        r.push(expAtt[c.dateKey]?.[s.id] ? '✓' : '');
      } else {
        const vEntry = expVer[c.dateKey]?.[s.id];
        r.push(vEntry ? (vEntry.verse || '✓') : '');
      }
    });
    return r;
  });

  const ws = XLSX.utils.aoa_to_sheet([row1, row2, ...rows]);
  const perCol = dual ? 2 : 1;
  const totalCols = 1 + cols.length * perCol;

  ws['!merges'] = [{ s:{r:0,c:0}, e:{r:1,c:0} }];
  cols.forEach((c,i) => {
    if (dual) {
      const start = 1 + i*2;
      ws['!merges'].push({ s:{r:0,c:start}, e:{r:0,c:start+1} });
    } else {
      const col = 1 + i;
      ws['!merges'].push({ s:{r:0,c:col}, e:{r:1,c:col} });
    }
  });

  ws['!cols'] = [{ wch: 30 }, ...cols.flatMap(() => dual ? [{ wch: 10 }, { wch: 18 }] : [{ wch: includeAtt ? 10 : 20 }])];
  ws['!views'] = [{ rightToLeft: true }];

  const border = { top:{style:'thin',color:{rgb:'D9D9D9'}}, bottom:{style:'thin',color:{rgb:'D9D9D9'}}, left:{style:'thin',color:{rgb:'D9D9D9'}}, right:{style:'thin',color:{rgb:'D9D9D9'}} };
  const headerStyle = { alignment:{ horizontal:'center', vertical:'center', wrapText:true }, font:{ bold:true, color:{ rgb:'FFFFFF' } }, fill:{ patternType:'solid', fgColor:{ rgb:'4472C4' } }, border };
  const center = { alignment: { horizontal:'center', vertical:'center', wrapText: true }, border };
  const nameCell = { alignment:{ horizontal:'right', vertical:'center' }, border };

  for (let c = 0; c < totalCols; c++) {
    [0,1].forEach(r => {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (ws[addr]) ws[addr].s = headerStyle;
    });
  }
  // تلوين الصفوف بالتبادل (banded rows) وبوردر خفيف حوالين كل خلية عشان يبقى شكله جدول منسق فعلاً
  const lastRow = rows.length + 1;
  for (let r = 2; r <= lastRow; r++) {
    const banded = (r % 2 === 0);
    const bandFill = banded ? { patternType:'solid', fgColor:{ rgb:'F2F6FC' } } : null;
    for (let c = 0; c < totalCols; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) continue;
      const base = c === 0 ? nameCell : center;
      ws[addr].s = bandFill ? { ...base, fill: bandFill } : base;
    }
  }
  // فلتر وترتيب زي أي جدول حقيقي في إكسل + تجميد صفوف العناوين وهي بتنزل
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s:{r:1,c:0}, e:{r:lastRow,c:totalCols-1} }) };
  ws['!freeze'] = { xSplit:0, ySplit:2, topLeftCell: XLSX.utils.encode_cell({r:2,c:0}), activePane:'bottomLeft', state:'frozen' };
  return ws;
}

// بيبني شيت بيانات المخدومين (بروفايل كامل: النوع، تاريخ الميلاد، العنوان، التليفونات، ملاحظات الافتقاد)
function buildStudentsSheet() {
  const genderLabel = g => g === 'male' ? 'ولد' : (g === 'female' ? 'بنت' : '');
  const row1 = ['الاسم','النوع','تاريخ الميلاد','الفصل','العنوان','أرقام التليفونات','ملاحظات الافتقاد'];
  const rows = [...exportTargetStudents()]
    .sort((a,b) => a.name.localeCompare(b.name,'ar'))
    .map(s => [
      s.name || '',
      genderLabel(s.gender),
      s.dob ? new Date(s.dob).toLocaleDateString('ar-EG',{day:'numeric',month:'long',year:'numeric'}) : '',
      s.classSection ? classLabel(s.classSection) : '',
      s.address || '',
      (s.phones||[]).filter(Boolean).join(' / '),
      (s.visitNotes?.length) ? s.visitNotes.map(n => NOTE_LABELS[n]?.text || n).join('، ') : ''
    ]);
  const ws = XLSX.utils.aoa_to_sheet([row1, ...rows]);
  ws['!cols'] = [{wch:26},{wch:8},{wch:18},{wch:14},{wch:26},{wch:22},{wch:26}];
  ws['!views'] = [{ rightToLeft: true }];

  const border = { top:{style:'thin',color:{rgb:'D9D9D9'}}, bottom:{style:'thin',color:{rgb:'D9D9D9'}}, left:{style:'thin',color:{rgb:'D9D9D9'}}, right:{style:'thin',color:{rgb:'D9D9D9'}} };
  const headStyle = { font:{ bold:true, color:{ rgb:'FFFFFF' } }, alignment:{ horizontal:'center', vertical:'center' }, fill:{ patternType:'solid', fgColor:{ rgb:'4472C4' } }, border };
  for (let c = 0; c < row1.length; c++) {
    const addr = XLSX.utils.encode_cell({ r:0, c });
    if (ws[addr]) ws[addr].s = headStyle;
  }
  // تلوين الصفوف بالتبادل وبوردر خفيف عشان تبقى شكلها جدول منسق فعلاً
  for (let r = 1; r <= rows.length; r++) {
    const banded = (r % 2 === 0);
    const fill = banded ? { patternType:'solid', fgColor:{ rgb:'F2F6FC' } } : null;
    for (let c = 0; c < row1.length; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) continue;
      const align = { horizontal: c===0 || c===4 ? 'right' : 'center', vertical:'center' };
      ws[addr].s = fill ? { alignment: align, border, fill } : { alignment: align, border };
    }
  }
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:rows.length,c:row1.length-1} }) };
  ws['!freeze'] = { xSplit:0, ySplit:1, topLeftCell: XLSX.utils.encode_cell({r:1,c:0}), activePane:'bottomLeft', state:'frozen' };
  return ws;
}

// ===== تصدير الخدام (للأدمن ومسؤول الفصل) =====
let exportServSelected = new Set(); // الفصول المتحددة لتصدير الخدام

function canExportServants() {
  return S.currentRole === 'admin' || (S.currentRole === 'supervisor' && normalizeAssignedClasses(S.currentSupervisorClass).length > 0);
}

// الفصول اللي يقدر يصدّر خدامها: الأدمن كل الفصول، ومسؤول الفصل فصوله اللي مسؤول عنها بس
function exportServClassChoices() {
  if (S.currentRole === 'admin') return S.allClasses;
  const sup = normalizeAssignedClasses(S.currentSupervisorClass);
  return S.allClasses.filter(c => sup.includes(c.id));
}

function renderExportServScope() {
  const wrap = document.getElementById('export-servants-wrap');
  if (!wrap) return;
  const ok = canExportServants();
  wrap.style.display = ok ? 'block' : 'none';
  if (!ok) return;
  const choices = exportServClassChoices();
  const cw = document.getElementById('export-serv-classes-wrap');
  if (choices.length <= 1) { cw.style.display = 'none'; exportServSelected = new Set(choices.map(c => c.id)); return; }
  exportServSelected = new Set([...exportServSelected].filter(id => choices.some(c => c.id === id)));
  cw.style.display = 'block';
  document.getElementById('export-serv-classes').innerHTML = exportClassChipsHTML('servants', exportServSelected, choices);
}

// الخدام اللي هيتصدّروا: الأدمن + كل الفصول = كل المعتمدين، غير كده الخدام المتوزعين على الفصل/الفصول المختارة (ومسؤول الفصل من غير نفسه)
function exportTargetServants() {
  let list = S.cachedServants.filter(x => x.status === 'approved');
  if (S.currentRole !== 'admin') list = list.filter(x => x.id !== S.currentUid);
  const choices = exportServClassChoices();
  const cids = [...exportServSelected].filter(id => choices.some(c => c.id === id));
  // الأدمن + كل الفصول متحددة = كل الخدام المعتمدين، غير كده الخدام المتوزعين على الفصول المتحددة بس
  if (!(S.currentRole === 'admin' && cids.length >= choices.length)) {
    list = list.filter(x => normalizeAssignedClasses(x.assignedClass).some(c => cids.includes(c)));
  }
  return list.sort((a,b) => (a.name||'').localeCompare(b.name||'','ar'));
}

// تنسيق شيت بسيط: صف عناوين ملوّن + صفوف بالتبادل + فلتر وتجميد (نفس شكل باقي الشيتات)
function styleSimpleSheet(ws, ncols, nrows, wch) {
  ws['!cols'] = wch.map(w => ({ wch: w }));
  ws['!views'] = [{ rightToLeft: true }];
  const border = { top:{style:'thin',color:{rgb:'D9D9D9'}}, bottom:{style:'thin',color:{rgb:'D9D9D9'}}, left:{style:'thin',color:{rgb:'D9D9D9'}}, right:{style:'thin',color:{rgb:'D9D9D9'}} };
  const head = { font:{ bold:true, color:{ rgb:'FFFFFF' } }, alignment:{ horizontal:'center', vertical:'center', wrapText:true }, fill:{ patternType:'solid', fgColor:{ rgb:'4472C4' } }, border };
  for (let c = 0; c < ncols; c++) { const a = XLSX.utils.encode_cell({ r:0, c }); if (ws[a]) ws[a].s = head; }
  for (let r = 1; r <= nrows; r++) {
    const fill = (r % 2 === 0) ? { patternType:'solid', fgColor:{ rgb:'F2F6FC' } } : null;
    for (let c = 0; c < ncols; c++) {
      const a = XLSX.utils.encode_cell({ r, c });
      if (!ws[a]) continue;
      const align = { horizontal: c === 0 ? 'right' : 'center', vertical:'center', wrapText:true };
      ws[a].s = fill ? { alignment: align, border, fill } : { alignment: align, border };
    }
  }
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:nrows,c:ncols-1} }) };
  ws['!freeze'] = { xSplit:0, ySplit:1, topLeftCell: XLSX.utils.encode_cell({r:1,c:0}), activePane:'bottomLeft', state:'frozen' };
  return ws;
}

function buildServantsDataSheet(massCounts = {}) {
  const roleLabel = x => x.role === 'admin' ? 'أدمن' : (x.role === 'supervisor' ? 'مسؤول فصل' : 'خادم');
  const head = ['الاسم','التليفون','الإيميل','العنوان','الدور','الفصول','مسؤول عن','قداس (عدد)','مدارس أحد (عدد)','اجتماع خدام (عدد)','تحضير (عدد)'];
  const rows = exportTargetServants().map(x => [
    x.name || '', x.phone || '', x.email || '', x.address || '', roleLabel(x),
    normalizeAssignedClasses(x.assignedClass).map(classLabel).join('، '),
    supervisedClassesOf(x).map(classLabel).join('، '),
    massCounts[x.id] || 0, x.sscCount || 0, x.meetingCount || 0, x.prepCount || 0
  ]);
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
  return styleSimpleSheet(ws, head.length, rows.length, [26,16,28,26,12,24,20,12,14,14,12]);
}

// شيت حضور خدام لنشاط واحد: صف لكل خادم وعمود لكل تاريخ + إجمالي. بيرجع null لو مفيش أي حضور للنشاط ده
function buildServantsAttSheet(activity, byDate) {
  const servants = exportTargetServants();
  const ids = new Set(servants.map(x => x.id));
  const dates = Object.keys(byDate).filter(d => Object.keys(byDate[d]).some(id => ids.has(id))).sort();
  if (!dates.length) return null;
  const fmt = d => { const q = d.split('-'); return `${q[2]}/${q[1]}/${q[0]}`; };
  const head = ['الاسم','الفصول', ...dates.map(fmt), 'الإجمالي'];
  const rows = servants.map(x => {
    const marks = dates.map(d => byDate[d][x.id] ? '✓' : '');
    return [x.name || '', normalizeAssignedClasses(x.assignedClass).map(classLabel).join('، '), ...marks, marks.filter(Boolean).length];
  });
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
  return styleSimpleSheet(ws, head.length, rows.length, [26, 22, ...dates.map(() => 11), 10]);
}

// فلتر الفترة بيتحط على الاستعلام نفسه (date >= من) عشان القراءات تتحسب على الفترة بس، مش السجل كله
function exportRangeQuery(col) {
  const v = document.getElementById('export-range')?.value || '90';
  if (v === 'all') return collection(db, col);
  const d = new Date(); d.setDate(d.getDate() - parseInt(v, 10));
  return query(collection(db, col), where('date', '>=', toLocalDateKey(d)));
}

window.runExportExcel = async () => {
  await ensureAllClassesForAdmin();
  const includeAtt = document.getElementById('export-opt-att').checked;
  const includeVerse = document.getElementById('export-opt-verse').checked;
  const includeStudents = document.getElementById('export-opt-students').checked;
  const servOk = canExportServants();
  const includeServData = servOk && !!document.getElementById('export-opt-serv-data')?.checked;
  const includeServAtt  = servOk && !!document.getElementById('export-opt-serv-att')?.checked;
  const anyStudentPart = includeAtt || includeVerse || includeStudents;
  if (!anyStudentPart && !includeServData && !includeServAtt) { showToast('اختار حاجة واحدة على الأقل', 'error'); return; }
  if (anyStudentPart && exportClassChoices().length > 1 && !exportSelectedClasses.size) { showToast('اختار فصل واحد على الأقل للمخدومين', 'error'); return; }
  if ((includeServData || includeServAtt) && exportServClassChoices().length > 1 && !exportServSelected.size) { showToast('اختار فصل واحد على الأقل للخدام', 'error'); return; }

  closeExportModal();
  showToast('جاري تجهيز الملف…','info');

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  const nameParts = [];

  try {
    // المخدومين بيتحمّلوا أول ما تفتح أي فصل — لو التصدير اتفتح من الرئيسية قبل كده القايمة بتبقى فاضية، فبنحمّلها الأول
    if (anyStudentPart) await ensureStudents();
    if (includeAtt || includeVerse) {
      const expAtt = {}, expVer = {};
      const proms = [];
      if (includeAtt) proms.push(countedGetDocs(exportRangeQuery('attendance'), 'attendance (تصدير إكسل)').then(a => a.docs.forEach(x => { const d = x.data(); (expAtt[d.date] ||= {})[d.studentId] = x.id; })));
      if (includeVerse) proms.push(countedGetDocs(exportRangeQuery('verses'), 'verses (تصدير إكسل)').then(v => v.docs.forEach(x => { const d = x.data(); (expVer[d.date] ||= {})[d.studentId] = { id:x.id, verse:d.verse||'' }; })));
      await Promise.all(proms);
      const sheetName = includeAtt && includeVerse ? 'حضور وتسميع' : (includeAtt ? 'حضور' : 'تسميع');
      XLSX.utils.book_append_sheet(wb, buildAttVerseSheet(expAtt, expVer, includeAtt, includeVerse), sheetName);
      if (includeAtt) nameParts.push('حضور');
      if (includeVerse) nameParts.push('تسميع');
    }
    if (includeStudents) {
      XLSX.utils.book_append_sheet(wb, buildStudentsSheet(), 'مخدومين');
      nameParts.push('مخدومين');
    }
    if (includeServData || includeServAtt) {
      if (!S.servantsLoadedFlag) await loadServantsOnce();
      if (includeServData) {
        // القداس مفيش له عدّاد جوه مستند الخادم زي باقي الأنشطة، فبنعدّه من سجلات الحضور
        const massCounts = {};
        const ms = await countedGetDocs(query(collection(db,'servantAttendance'), where('activity','==','mass')), 'servantAttendance قداس (تصدير بيانات الخدام)');
        ms.docs.forEach(x => { const id = x.data().servantId; if (id) massCounts[id] = (massCounts[id] || 0) + 1; });
        XLSX.utils.book_append_sheet(wb, buildServantsDataSheet(massCounts), 'الخدام');
        nameParts.push('خدام');
      }
      if (includeServAtt) {
        const snap = await countedGetDocs(exportRangeQuery('servantAttendance'), 'servantAttendance (تصدير إكسل)');
        const byAct = {};
        snap.docs.forEach(x => { const d = x.data(); if (!d.activity || !d.date || !d.servantId) return; ((byAct[d.activity] ||= {})[d.date] ||= {})[d.servantId] = true; });
        let added = 0;
        Object.keys(SERV_ATT_LABELS).forEach(act => {
          const ws = byAct[act] ? buildServantsAttSheet(act, byAct[act]) : null;
          if (ws) { XLSX.utils.book_append_sheet(wb, ws, `حضور ${SERV_ATT_LABELS[act]}`); added++; }
        });
        if (added) nameParts.push('حضور-خدام');
        else showToast('مفيش سجل حضور خدام للفصول دي', 'info');
      }
    }
  } catch(e) {
    console.error(e);
    showToast('تعذّر تحميل السجل','error');
    return;
  }

  if (!wb.SheetNames.length) return;
  XLSX.writeFile(wb, `${nameParts.join('-')}-${todayKey()}.xlsx`, { cellStyles: true });
};
