// بروفايل المخدوم (نافذة منبثقة)
import { S } from '../core/state.js';
import { db, doc, serverTimestamp, updateDoc } from '../core/firebase.js';
import { loadStudentHist, studentHist } from './attendance.js';
import { logActivity } from './auth.js';
import { classLabel, renderProfClassChips } from './classes.js';
import { renderFilterList } from './filters.js';
import { NOTE_LABELS } from './settings.js';
import { bumpStudentsRev, renderStudentsList } from './students.js';
import { renderTodayList, updateStats } from './today-list.js';

// ===== PROFILE =====

// عرض صورة المخدوم في ملفه لو موجودة، وإلا حرف الاسم زي ما كان، مع دايرة كاميرا صغيرة للرفع
function renderProfAvatar(s) {
  const el = document.getElementById('prof-avatar');
  el.style.backgroundImage = s.photo ? `url('${s.photo}')` : '';
  el.innerHTML = (s.photo ? '' : `<span>${(s.name||'؟').trim()[0]||'؟'}</span>`) + `<div class="avatar-cam-badge">📷</div>`;
}

window.triggerProfilePhotoPick = () => document.getElementById('prof-photo-input').click();

// بتصغّر الصورة وتحوّلها base64 عشان تتخزن في مستند الفايرستور من غير ما تتعدى حد الحجم بتاعه
function resizeImageToDataURL(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height) { if (width > maxSize) { height = Math.round(height * maxSize / width); width = maxSize; } }
        else { if (height > maxSize) { width = Math.round(width * maxSize / height); height = maxSize; } }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('تعذّرت قراءة الصورة'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('تعذّرت قراءة الملف'));
    reader.readAsDataURL(file);
  });
}

window.handleProfilePhotoChange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !S.currentProfileId) return;
  const id = S.currentProfileId;
  try {
    showToast('جاري رفع الصورة…', 'info');
    const dataUrl = await resizeImageToDataURL(file, 320, 0.7);
    await updateDoc(doc(db,'students',id), { photo: dataUrl, updatedAt: serverTimestamp() }); bumpStudentsRev();
    const idx = S.allStudents.findIndex(x => x.id === id);
    if (idx !== -1) S.allStudents[idx] = { ...S.allStudents[idx], photo: dataUrl };
    if (S.currentProfileId === id) renderProfAvatar(S.allStudents[idx] || { photo: dataUrl, name: '' });
    renderTodayList();
    if (typeof renderFilterList === 'function') renderFilterList();
    if (document.getElementById('manual-input')?.value) onManualSearch();
    showToast('تم حفظ صورة المخدوم ✓', 'success');
    logActivity('تحديث صورة مخدوم', S.allStudents[idx]?.name || '');
  } catch (err) {
    console.error(err);
    showToast('حصل خطأ أثناء رفع الصورة', 'error');
  }
};

window.openProfile = (id) => {
  S.currentProfileId = id;
  const s = S.allStudents.find(x => x.id === id);
  if (!s) return;
  renderProfAvatar(s);
  document.getElementById('prof-name').textContent   = s.name;
  renderProfClassChips(s.classSection || '');
  const H = (studentHist[id] && Date.now() - studentHist[id].ts < 300000) ? studentHist[id] : null;
  const dates   = H ? Object.keys(H.att).sort() : [];
  let count = 0, lastDate = null;
  dates.forEach(d => { count++; lastDate = d; });
  if (!H) loadStudentHist(id).then(() => { if (S.currentProfileId === id) openProfile(id); }).catch(()=>{});
  document.getElementById('prof-count').textContent = count;
  if (lastDate) {
    const p = lastDate.split('-');
    document.getElementById('prof-last').textContent = `${p[2]}/${p[1]}/${p[0]}`;
    document.getElementById('prof-sub').textContent  = `آخر حضور: ${p[2]}/${p[1]}`;
  } else {
    document.getElementById('prof-last').textContent = 'لم يحضر بعد';
    document.getElementById('prof-sub').textContent  = '';
  }
  const fields = [];
  if (s.dob) fields.push({ icon:'🎂', key:'تاريخ الميلاد', val: new Date(s.dob).toLocaleDateString('ar-EG',{day:'numeric',month:'long',year:'numeric'}) });
  if (s.address) fields.push({ icon:'📍', key:'العنوان', val: s.address });
  fields.push({ icon:'📝', key:'ملحوظات الافتقاد', val: (s.visitNotes?.length)
    ? s.visitNotes.map(n => NOTE_LABELS[n] ? `${NOTE_LABELS[n].emoji} ${NOTE_LABELS[n].text}` : n).join('، ')
    : `${NOTE_LABELS.noReason.emoji} ${NOTE_LABELS.noReason.text}` });
  if (s.phones?.length) {
    s.phones.forEach((p,i) => {
      if (p) fields.push({ icon:'📞', key:`تليفون ${i===0?'':'('+(i+1)+')'}`, val: p, phone: true, idx: i });
    });
  }
  // attendance + verse history combined
  const relevantDates = [...new Set([...Object.keys(H?.att||{}), ...Object.keys(H?.ver||{})])].sort().reverse().slice(0,5);
  const histHTML = relevantDates.length ? `
    <div style="padding:0 16px 16px">
      <div class="section-title" style="margin-bottom:10px">📅 سجل الحضور والتسميع</div>
      ${relevantDates.map(d => {
        const p = d.split('-');
        const att   = !!H?.att[d];
        const heard = !!H?.ver[d];
        const verse = H?.ver[d]?.verse || '';
        return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);flex-wrap:wrap">
          <span style="font-size:13px;font-weight:600;color:var(--text-dim)">${p[2]}/${p[1]}/${p[0]}</span>
          ${att
            ? `<span style="font-size:11px;background:rgba(46,204,113,0.1);border:1px solid rgba(46,204,113,0.25);color:var(--success);border-radius:5px;padding:2px 7px">✓ حاضر</span>`
            : `<span style="font-size:11px;background:rgba(255,255,255,0.03);border:1px solid var(--border);color:var(--text-dim);opacity:.4;border-radius:5px;padding:2px 7px">حاضر</span>`}
          ${heard
            ? `<span style="font-size:11px;color:#a07de0;background:rgba(124,92,191,0.1);border:1px solid rgba(124,92,191,0.25);border-radius:5px;padding:2px 7px">📖 سماع${verse ? ' · ' + verse : ''}</span>`
            : `<span style="font-size:11px;background:rgba(255,255,255,0.03);border:1px solid var(--border);color:var(--text-dim);opacity:.4;border-radius:5px;padding:2px 7px">سماع</span>`}
        </div>`;
      }).join('')}
    </div>` : '';

  document.getElementById('prof-details').innerHTML = (fields.length
    ? `<div style="padding:16px">${fields.map(f => `<div class="prof-row">
        <div style="font-size:18px;flex-shrink:0">${f.icon}</div>
        <div style="flex:1">
          <div class="prof-key">${f.key}</div>
          ${f.phone
            ? `<a href="tel:${f.val}" style="font-size:14px;font-weight:600;color:var(--text);text-decoration:none">${f.val}</a>`
            : `<div class="prof-val">${f.val}</div>`}
        </div>
        ${f.phone ? `<a href="tel:${f.val}" style="background:rgba(46,204,113,0.12);border:1px solid rgba(46,204,113,0.3);border-radius:9px;color:var(--success);padding:7px 12px;font-size:12px;font-weight:700;text-decoration:none">📲 اتصل</a>
        ${s.waPhoneIndex === f.idx || (s.waPhoneIndex == null && f.idx === 0)
          ? `<span style="background:#25D366;border:1px solid #25D366;border-radius:9px;color:#fff;padding:7px 12px;font-size:12px;font-weight:700">✅ رقم الواتساب</span>`
          : `<button onclick="markWaPhone('${s.id}',${f.idx})" style="background:rgba(37,211,102,0.12);border:1px solid rgba(37,211,102,0.3);border-radius:9px;color:#25D366;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;font-family:'Cairo',sans-serif">📱 اجعله رقم الواتساب</button>`
        }` : ''}
      </div>`).join('')}</div>` : '') + histHTML;
  document.getElementById('profile-modal').style.display = 'block';
  document.body.style.overflow = 'hidden';
};

window.closeProfile = () => {
  document.getElementById('profile-modal').style.display = 'none';
  document.body.style.overflow = '';
};

// تغيير فصل الولد من صفحة الملف مباشرة (فصل أ / فصل ب / بدون فصل)
window.setStudentClassFromProfile = async (section) => {
  const id = S.currentProfileId;
  if (!id) return;
  try {
    await updateDoc(doc(db,'students',id), { classSection: section, updatedAt: serverTimestamp() }); bumpStudentsRev();
    const idx = S.allStudents.findIndex(x => x.id === id);
    if (idx !== -1) S.allStudents[idx].classSection = section;
    renderProfClassChips(section);
    renderStudentsList();
    onManualSearch();
    updateStats();
    renderTodayList();
    const s = S.allStudents[idx];
    showToast(`✓ ${s?.name || ''} — ${classLabel(section)}`, 'success');
    logActivity('تعديل الفصل', `${s?.name || ''} — ${classLabel(section)}`);
  } catch(e) {
    showToast('حصل خطأ أثناء الحفظ', 'error');
  }
};

window.editFromProfile = () => {
  if (!S.currentProfileId) return;
  closeProfile();
  openEditModal(S.currentProfileId);
};

window.closeProfileOutside = (e) => { if (e.target.id === 'profile-modal') closeProfile(); };
