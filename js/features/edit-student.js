// تعديل بيانات المخدوم
import { S } from '../core/state.js';
import { db, doc, serverTimestamp, updateDoc } from '../core/firebase.js';
import { canonicalizeName } from '../core/idb-cache.js';
import { logActivity } from './auth.js';
import { classSelectOptionsHTML } from './classes.js';
import { bumpStudentsRev, renderStudentsList } from './students.js';
import { renderTodayList } from './today-list.js';

// ===== EDIT STUDENT =====
window.openEditModal = (id) => {
  const s = S.allStudents.find(x => x.id === id);
  if (!s) return;
  S.editGenderManuallySet = false; // فتح مودال جديد = نسمح للتخمين يشتغل تاني لو غيّرت الاسم
  document.getElementById('edit-id').value      = s.id;
  document.getElementById('edit-name').value    = s.name;
  document.getElementById('edit-dob').value     = s.dob || '';
  document.getElementById('edit-address').value = s.address || '';
  document.getElementById('edit-gender').value  = s.gender || '';
  document.getElementById('edit-class').innerHTML = classSelectOptionsHTML(true);
  document.getElementById('edit-class').value   = s.classSection || '';
  document.getElementById('edit-avatar').textContent = s.name.trim()[0] || '؟';
  document.getElementById('edit-sub').textContent    = s.name;
  const notes = s.visitNotes || [];
  document.getElementById('edit-note-traveling').checked   = notes.includes('traveling');
  document.getElementById('edit-note-friday').checked      = notes.includes('friday');
  document.getElementById('edit-note-otherchurch').checked = notes.includes('otherChurch');
  document.getElementById('edit-note-motherpregnant').checked = notes.includes('motherPregnant');

  const wrap = document.getElementById('edit-phones-wrap');
  const phones = (s.phones && s.phones.length) ? s.phones : [''];
  wrap.innerHTML = phones.map((p, i) => `
    <div class="edit-phone-row">
      <input type="tel" class="field-input edit-phone-input" placeholder="رقم التليفون" dir="ltr" value="${p}">
      ${i === 0
        ? `<button class="add-phone-btn" onclick="addEditPhoneField()">+</button>`
        : `<button class="rem-phone-btn" onclick="this.parentElement.remove()">−</button>`}
    </div>`).join('');

  document.getElementById('edit-modal').style.display = 'block';
  document.body.style.overflow = 'hidden';
};

window.addEditPhoneField = () => {
  const wrap = document.getElementById('edit-phones-wrap');
  const row  = document.createElement('div');
  row.className = 'edit-phone-row';
  row.innerHTML = `<input type="tel" class="field-input edit-phone-input" placeholder="رقم التليفون" dir="ltr">
    <button class="rem-phone-btn" onclick="this.parentElement.remove()">−</button>`;
  wrap.appendChild(row);
};

window.closeEditModal = () => {
  document.getElementById('edit-modal').style.display = 'none';
  document.body.style.overflow = '';
};

window.closeEditOutside = (e) => { if (e.target.id === 'edit-modal') closeEditModal(); };

window.saveEditStudent = async () => {
  const id   = document.getElementById('edit-id').value;
  const name = canonicalizeName(document.getElementById('edit-name').value);
  if (!name) { showToast('اكتب اسم المخدوم', 'error'); return; }
  const phones = [...document.querySelectorAll('.edit-phone-input')]
    .map(i => i.value.trim()).filter(Boolean);
  const visitNotes = [];
  if (document.getElementById('edit-note-traveling').checked)   visitNotes.push('traveling');
  if (document.getElementById('edit-note-friday').checked)      visitNotes.push('friday');
  if (document.getElementById('edit-note-otherchurch').checked) visitNotes.push('otherChurch');
  if (document.getElementById('edit-note-motherpregnant').checked) visitNotes.push('motherPregnant');
  const data = {
    name,
    dob:     document.getElementById('edit-dob').value || '',
    address: document.getElementById('edit-address').value.trim() || '',
    gender:  document.getElementById('edit-gender').value || '',
    classSection: document.getElementById('edit-class').value || '',
    phones,
    visitNotes
  };
  try {
    await updateDoc(doc(db,'students',id), { ...data, updatedAt: serverTimestamp() }); bumpStudentsRev();
    const idx = S.allStudents.findIndex(s => s.id === id);
    if (idx !== -1) S.allStudents[idx] = { ...S.allStudents[idx], ...data };
    renderStudentsList();
    renderTodayList();
    closeEditModal();
    showToast('تم حفظ التعديلات ✓', 'success');
    logActivity('تعديل بيانات مخدوم', name);
  } catch(e) {
    showToast('حصل خطأ أثناء الحفظ', 'error');
    console.error(e);
  }
};
