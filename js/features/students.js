// حقول التليفون + إدارة المخدومين (إضافة / قائمة / حذف)
import { S } from '../core/state.js';
import { Timestamp, addDoc, collection, db, deleteDoc, doc, getDoc, increment, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from '../core/firebase.js';
import { canonicalizeName, idbGet, idbSet, normalizeArabic } from '../core/idb-cache.js';
import { countedGetDocs } from '../core/reads-counter.js';
import { isPrimaryAdmin, logActivity } from './auth.js';
import { classBadgeHTML, effectiveClassFilter, ensureAllClassesForAdmin, getAllowedAssignedClasses, readScopeClasses, renderClassChips, waitClassesReady } from './classes.js';
import { renderTodayList, updateStats } from './today-list.js';
import { guessGenderFromName, searchStudents } from '../lib/arabic-match.js';

let siblingsFilter = 'all'; // 'all' | 'siblings' | 'nonSiblings' (تبويب المخدومين)

// ===== PHONE FIELDS =====
window.addPhoneField = () => {
  const wrap = document.getElementById('phones-wrap');
  const row  = document.createElement('div');
  row.className = 'phone-row';
  row.innerHTML = `<input type="tel" class="field-input phone-input" placeholder="رقم التليفون" dir="ltr">
    <button class="rem-phone-btn" onclick="this.parentElement.remove()">−</button>`;
  wrap.appendChild(row);
};

window.toggleAddStudentForm = () => {
  const fields = document.getElementById('add-student-fields');
  const btn    = document.getElementById('add-student-toggle-btn');
  const isOpen = fields.style.display === 'block';
  fields.style.display = isOpen ? 'none' : 'block';
  btn.textContent = isOpen ? '➕ إضافة مخدوم' : '✕ إغلاق';
  S.newGenderManuallySet = false; // فورم جديد = نسمح للتخمين التلقائي يشتغل من الأول
};

// ===== STUDENTS =====

const STU_KEY0 = 'stu_cache_v2';

let STU_KEY = STU_KEY0; // v2: كاش بيتحدّث بالتغييرات بس (updatedAt) بدل إعادة تحميل الكل

export async function ensureStudents() { if (!S.studentsLoaded) await loadStudents(); }

// أي كتابة على students بتزوّد الرقم ده عشان كل الأجهزة تعرف إن فيه تغيير (والحذف له عدّاد لوحده لأنه مش بيظهر في تحديث التغييرات)
let bumpTimer = null;
let bumpDel = false;

export function bumpStudentsRev(deleted = false) {
  if (deleted) bumpDel = true;
  clearTimeout(bumpTimer);
  // بنجمّع أي كتابات ورا بعض (زي إضافة مجموعة للجروب) في كتابة واحدة على config/meta
  bumpTimer = setTimeout(async () => {
    const upd = { studentsRev: increment(1) };
    if (bumpDel) upd.studentsDelRev = increment(1);
    bumpDel = false;
    try { await setDoc(doc(db,'config','meta'), upd, { merge:true }); } catch(e) {}
  }, 2000);
}

function tsMs(t) {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  return (t.seconds || 0) * 1000 + Math.floor((t.nanoseconds || 0) / 1e6);
}

function saveStudentsCache(rev, delRev, scope = '', maxUpdSeen = 0) {
  const maxUpd = S.allStudents.reduce((m, s) => Math.max(m, tsMs(s.updatedAt)), maxUpdSeen);
  const payload = JSON.stringify({ rev, delRev, scope, ts: Date.now(), maxUpd, list: S.allStudents });
  idbSet(STU_KEY, payload).then(ok => {
    if (ok) { try { localStorage.removeItem(STU_KEY); } catch(e) {} }
    else { try { localStorage.setItem(STU_KEY, payload); } catch(e) {} }
  });
}

window.forceRefreshStudents = async () => { await loadStudents(true); showToast('تم تحديث المخدومين ✓','success'); };

export async function loadStudents(force = false) {
  await waitClassesReady();
  let rev = null, delRev = 0, classFieldMig = false;
  try { const m = await getDoc(doc(db,'config','meta')); const d = m.exists() ? m.data() : {}; rev = d.studentsRev || 0; delRev = d.studentsDelRev || 0; classFieldMig = !!d.classFieldMig; } catch(e) {}
  // الخادم بيقرا مخدومين نطاقه بس. المخدومين اللي لسه من غير فصل مش بيتجابوا بالاستعلام قبل ما الأدمن يعمل ترحيل واحد (classSection:'')، فلحد وقتها بنقرا الكل زي الأول
  let scope = readScopeClasses();
  if (!classFieldMig) scope = [];
  const scopeKey = scope.join(',');
  STU_KEY = scopeKey ? STU_KEY0 + '@' + scopeKey : STU_KEY0;
  let cached = null; try { cached = JSON.parse((await idbGet(STU_KEY)) || localStorage.getItem(STU_KEY) || 'null'); } catch(e) {}
  const inScope = x => !scope.length || scope.includes(x.classSection || '');
  const byName = (a, b) => (a.name || '') < (b.name || '') ? -1 : ((a.name || '') > (b.name || '') ? 1 : 0);
  const fullLoad = async () => {
    const col = collection(db,'students');
    const snap = await countedGetDocs(scope.length ? query(col, where('classSection','in', scope)) : query(col, orderBy('name')), scope.length ? 'students (نطاق الخادم)' : 'students');
    S.allStudents = snap.docs.map(d => ({ id:d.id, ...d.data() })).sort(byName);
    saveStudentsCache(rev, delRev, scopeKey);
  };
  const usable = cached && !force && Array.isArray(cached.list) && (cached.scope || '') === scopeKey && (rev !== null ? cached.delRev === delRev : (Date.now() - cached.ts < 12*3600*1000));
  if (usable && (rev === null || cached.rev === rev)) {
    S.allStudents = cached.list;
  } else if (usable) {
    try {
      const since = Timestamp.fromMillis(Math.max(0, (cached.maxUpd || 0) - 60000)); // هامش دقيقة للأمان
      const snap = await countedGetDocs(query(collection(db,'students'), where('updatedAt','>=', since)), 'students (تحديث بالتغييرات بس)');
      const map = new Map(cached.list.map(x => [x.id, x]));
      let seen = cached.maxUpd || 0;
      snap.docs.forEach(d => { const x = { id:d.id, ...d.data() }; seen = Math.max(seen, tsMs(x.updatedAt)); if (inScope(x)) map.set(d.id, x); else map.delete(d.id); });
      S.allStudents = [...map.values()].sort(byName);
      saveStudentsCache(rev, delRev, scopeKey, seen);
    } catch(e) { console.error(e); await fullLoad(); }
  } else {
    await fullLoad();
  }
  if (S.currentRole === 'admin' && !classFieldMig && rev !== null && !scope.length) migrateClassField();
  S.studentsLoaded = true;
  // تبويب "المخدومين" بيعرض مخدومين الفصل الحالي بس (وفلتر الفصول للتلات فصول بيبي/كي جي)،
  // والشاشات التانية (الحضور، الرسائل، التصدير) بتتقفل على فصل الخادم عن طريق classScope / ownClassStudents
  updateStuCount();
  renderStudentsList();
}

async function migrateClassField() {
  try {
    const missing = S.allStudents.filter(x => x.classSection === undefined || x.classSection === null);
    for (let i = 0; i < missing.length; i += 400) {
      const b = writeBatch(db);
      missing.slice(i, i + 400).forEach(x => b.update(doc(db,'students',x.id), { classSection: '' }));
      await b.commit();
    }
    missing.forEach(x => { x.classSection = ''; });
    await setDoc(doc(db,'config','meta'), { classFieldMig: true }, { merge:true });
  } catch(e) { console.error('class field migration failed:', e); }
}

window.addStudent = async () => {
  const name = canonicalizeName(document.getElementById('new-name').value);
  if (!name) { showToast('اكتب اسم المخدوم', 'error'); return; }
  const dup = S.allStudents.find(s => normalizeArabic(s.name) === normalizeArabic(name));
  if (dup && !confirm(`فيه مخدوم بنفس الاسم "${dup.name}" مسجل قبل كده. تحب تضيفه تاني كاسم مكرر؟`)) return;
  const phones = [...document.querySelectorAll('.phone-input')]
    .map(i => i.value.trim()).filter(Boolean);
  const allowed = getAllowedAssignedClasses();
  const targetClass = (S.currentRole !== 'admin' && allowed.length) ? (allowed.includes(S.currentClassTab) ? S.currentClassTab : allowed[0]) : '';
  const data = {
    name,
    dob:     document.getElementById('new-dob').value || '',
    address: document.getElementById('new-address').value.trim() || '',
    gender:  document.getElementById('new-gender').value || '',
    phones,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    classSection: ''
  };
  // لو الخادم مقيد بفصول معينة، أي مخدوم جديد بيضيفه يتحط أوتوماتيك في الفصل الحالي اللى شافه في الواجهة عشان يبقى ضمن الفصول المسموح له
  if (S.currentRole !== 'admin' && allowed.length) data.classSection = targetClass;
  await addDoc(collection(db,'students'), data); bumpStudentsRev();
  document.getElementById('new-name').value = '';
  document.getElementById('new-dob').value  = '';
  document.getElementById('new-address').value = '';
  document.getElementById('new-gender').value = '';
  S.newGenderManuallySet = false;
  document.getElementById('phones-wrap').innerHTML = `<div class="phone-row">
    <input type="tel" class="field-input phone-input" placeholder="رقم التليفون" dir="ltr">
    <button class="add-phone-btn" onclick="addPhoneField()">+</button>
  </div>`;
  showToast('تمت الإضافة ✓', 'success');
  await loadStudents();
  logActivity('إضافة مخدوم', name);
  toggleAddStudentForm();
};

const canDeleteStudent = () => S.currentRole === 'admin' || isPrimaryAdmin(S.currentEmail);

window.deleteStudent = async (id, name) => {
  if (!canDeleteStudent()) { showToast('حذف المخدومين للأدمن بس', 'error'); return; }
  if (!confirm(`هتحذف "${name}"؟`)) return;
  try { await deleteDoc(doc(db,'students',id)); } catch(e) { console.error(e); showToast('مقدرتش أحذف — مفيش صلاحية', 'error'); return; }
  bumpStudentsRev(true);
  S.allStudents = S.allStudents.filter(s => s.id !== id);
  delete S.todayAttendance[id];
  updateStats(); renderTodayList(); renderStudentsList();
  showToast('تم الحذف', 'success');
  logActivity('حذف مخدوم', name);
};

// تنظيف الأسماء المخزّنة من حروف مخفية/همزات مختلفة (بتيجي غالبًا من استيراد إكسل)
window.cleanAllNames = async () => {
  await ensureAllClassesForAdmin();
  const toFix = S.allStudents
    .map(s => ({ id: s.id, oldName: s.name, newName: canonicalizeName(s.name) }))
    .filter(x => x.oldName !== x.newName);
  if (!toFix.length) { showToast('كل الأسامي سليمة ✓', 'success'); return; }
  if (!confirm(`فيه ${toFix.length} اسم هيتم توحيد حروفه (أ/إ/آ ← ا، ومسافات/حروف مخفية). تصحّحهم دلوقتي؟`)) return;
  for (const x of toFix) {
    await updateDoc(doc(db,'students', x.id), { name: x.newName, updatedAt: serverTimestamp() }); bumpStudentsRev();
    const idx = S.allStudents.findIndex(s => s.id === x.id);
    if (idx !== -1) S.allStudents[idx].name = x.newName;
  }
  renderStudentsList(); renderTodayList();
  showToast(`تم تصحيح ${toFix.length} اسم ✓`, 'success');
};

// بيدور على كل مخدوم "النوع" بتاعه لسه فاضي، ويخمّنه من الاسم زي التخمين اللي بيحصل وقت الإضافة،
// ويحفظ التخمينات اللي عرف يحددها دفعة واحدة (batch) — واللي مش عارف يحددها بيسيبها فاضية عشان تحددها بإيدك
window.guessAllGenders = async () => {
  await ensureAllClassesForAdmin();
  const candidates = S.allStudents
    .filter(s => !s.gender)
    .map(s => ({ id: s.id, name: s.name, guess: guessGenderFromName(s.name) }))
    .filter(x => x.guess);
  const unknownCount = S.allStudents.filter(s => !s.gender).length - candidates.length;
  if (!candidates.length) {
    showToast(unknownCount ? `مفيش أسامي قدر يخمّنها (${unknownCount} لسه محتاجين تحديد يدوي)` : 'كل المخدومين محدد نوعهم بالفعل ✓', 'info');
    return;
  }
  const male   = candidates.filter(x => x.guess === 'male').length;
  const female = candidates.filter(x => x.guess === 'female').length;
  const extra  = unknownCount ? `\nوهيفضل ${unknownCount} اسم محتاج تحدده يدوي لأن التخمين مش عارف يحسمه.` : '';
  if (!confirm(`هيتحدد نوع ${candidates.length} مخدوم تلقائيًا (${male} ولد، ${female} بنت) بناءً على الاسم. تقدر تراجع/تغيّر أي حد بعد كده من "تعديل".${extra}\n\nتكمل؟`)) return;

  try {
    // Firestore بتسمح بحد أقصى 500 عملية في الـ batch الواحد
    for (let i = 0; i < candidates.length; i += 450) {
      const chunk = candidates.slice(i, i + 450);
      const batch = writeBatch(db);
      chunk.forEach(x => batch.update(doc(db,'students', x.id), { gender: x.guess, updatedAt: serverTimestamp() }));
      await batch.commit(); bumpStudentsRev();
    }
    candidates.forEach(x => {
      const idx = S.allStudents.findIndex(s => s.id === x.id);
      if (idx !== -1) S.allStudents[idx].gender = x.guess;
    });
    renderStudentsList();
    showToast(`تم تحديد نوع ${candidates.length} مخدوم ✓`, 'success');
    logActivity('تحديد نوع تلقائي لمخدومين قدام', `${candidates.length} مخدوم`);
  } catch(e) {
    console.error(e);
    showToast('حصل خطأ أثناء الحفظ', 'error');
  }
};

// مفتاح العيلة = الاسم كامل عدا أول كلمة (يعني اسم الأب + الجد + ...) — بيستخدم لتحديد مين إخوة مين
export function familyKey(name) {
  const words = normalizeArabic(name).split(' ').filter(Boolean);
  if (words.length < 2) return null; // اسم كلمة واحدة مش كفاية نحكم عليه
  return words.slice(1).join(' ');
}

// بيرجع خريطة: مفتاح العيلة -> عدد المخدومين اللي شايلينه (من بين كل المخدومين مش بس المفلترين)
export function computeSiblingCounts(list) {
  const counts = {};
  list.forEach(s => {
    const key = familyKey(s.name);
    if (!key) return;
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

window.setSiblingsFilter = (val, btn) => {
  siblingsFilter = val;
  document.querySelectorAll('#siblings-chips .filter-chip').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderStudentsList();
};

window.setClassFilter = (val) => {
  S.classFilter = val;
  renderClassChips();
  renderStudentsList();
};

let stuListCount = null; // عدد المخدومين بعد كل الفلاتر والبحث (بيتحدّث من renderStudentsList)

export function updateStuCount() {
  const el = document.getElementById('stu-count');
  if (!el) return;
  el.textContent = stuListCount !== null ? stuListCount : (S.currentClassTab ? S.allStudents.filter(s => s.classSection === S.currentClassTab).length : S.allStudents.length);
}

export function renderStudentsList() {
  const cont = document.getElementById('students-list');
  stuListCount = null;
  updateStuCount();
  if (!S.allStudents.length) {
    cont.innerHTML = `<div class="empty-state"><div class="empty-icon">👤</div>لا يوجد مخدومين بعد</div>`;
    return;
  }
  const qRaw = (document.getElementById('students-search-input')?.value || '').trim();
  const q = normalizeArabic(qRaw);
  let list = q ? searchStudents(S.allStudents, q) : S.allStudents;

  // فلتر الإخوات: بيتحسب على أساس كل المخدومين (مش بس اللي طلعوا من البحث) عشان يبقى دقيق
  const siblingCounts = computeSiblingCounts(S.allStudents);
  if (siblingsFilter === 'siblings') {
    list = list.filter(s => { const k = familyKey(s.name); return k && siblingCounts[k] > 1; });
  } else if (siblingsFilter === 'nonSiblings') {
    list = list.filter(s => { const k = familyKey(s.name); return !k || siblingCounts[k] <= 1; });
  }

  const cf = effectiveClassFilter();
  if (cf === 'none') list = list.filter(s => !s.classSection);
  else if (cf && cf !== 'all') list = list.filter(s => s.classSection === cf);

  // ترتيب اللستة عشان كل الإخوات (نفس الاسم بالظبط من اسم الأب لحد آخر اسم) يظهروا ورا بعض مجموعين — دايمًا، حتى وقت البحث
  list = [...list].sort((a, b) => {
    const ka = familyKey(a.name) || `__${a.id}`;
    const kb = familyKey(b.name) || `__${b.id}`;
    const c = ka.localeCompare(kb, 'ar');
    return c !== 0 ? c : a.name.localeCompare(b.name, 'ar');
  });

  stuListCount = list.length;
  updateStuCount();
  if (!list.length) {
    cont.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div>مفيش نتايج</div>`;
    return;
  }
  cont.innerHTML = list.map(s => {
    const dob = s.dob ? new Date(s.dob).toLocaleDateString('ar-EG',{day:'numeric',month:'long',year:'numeric'}) : '';
    const k = familyKey(s.name);
    const isSibling = k && siblingCounts[k] > 1;
    const siblingBadge = isSibling ? `<div class="s-sub">👨‍👩‍👧‍👦 ${siblingCounts[k]} إخوات مسجلين</div>` : '';
    const genderIcon = s.gender === 'male' ? '🧑' : (s.gender === 'female' ? '👧' : '');
    const classBadge = classBadgeHTML(s.classSection);
    return `<div class="student-item">
      <div class="s-info">
        <div class="s-name">${genderIcon ? genderIcon + ' ' : ''}${s.name}</div>
        ${dob ? `<div class="s-sub">🎂 ${dob}</div>` : ''}
        <div class="s-sub" style="margin-top:3px">${classBadge}</div>
        ${siblingBadge}
      </div>
      <button class="action-btn" onclick="openProfile('${s.id}')">👤</button>
      <button class="action-btn" onclick="openEditModal('${s.id}')">✏️</button>
      ${canDeleteStudent() ? `<button class="del-btn" onclick="deleteStudent('${s.id}','${s.name}')">🗑</button>` : ''}
    </div>`;
  }).join('');
}

window.renderStudentsList = renderStudentsList; // ضروري عشان oninput في الـ HTML يقدر يلاقيها (لأننا جوه type=module)
