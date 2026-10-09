// تسجيل الدخول / الخروج + متابعة حالة المستخدم + heartbeat + الأدمن الأساسي + سجل الأنشطة
import { S } from '../core/state.js';
import { ADMIN_EMAILS } from '../core/config.js';
import { addDoc, arrayRemove, auth, collection, createUserWithEmailAndPassword, db, doc, getDoc, onAuthStateChanged, onSnapshot, sendEmailVerification, serverTimestamp, setDoc, signInWithEmailAndPassword, signOut, updateDoc } from '../core/firebase.js';
import { countDocSnapshotReads, countedGetDocs } from '../core/reads-counter.js';
import { restartTodayListeners } from './attendance.js';
import { maybeOfferBio, refreshBioLoginButton } from './biometric.js';
import { canHandleRequests, renderClassServAttList, renderClassServList, renderSupPending, startPendingRequestsListener, stopPendingRequestsListener } from './class-servants.js';
import { classSelectOptionsHTML, derivePermsFromRoles, formatAssignedClasses, getAllowedAssignedClasses, nameVariantsIn, startClassesListener, stopClassesListener, supervisedClassesOf, unifyKgEmoji, uniqueNames } from './classes.js';
import { renderFilterList } from './filters.js';
import { applyClassRestrictionUI } from './navigation.js';
import { fillSettingsHeader } from './settings.js';
import { loadStudents } from './students.js';
import { renderTodayList, updateStats } from './today-list.js';

let heartbeatTimer = null;
let ownServantUnsub = null; // بث لحظي على مستند الخادم بتاعي نفسه — عشان لو الأدمن الأساسي غيّر صلاحيتي أو حذفني، أتأثر فورًا من غير ما أعمل reload
let servantsUnsub = null; // بث لحظي على قائمة الخدام في تبويب المتابعة — عشان أي تغيير (قبول/رفض/ترقية/حذف) يظهر لكل الأدمنز فورًا

// ===== AUTH =====
window.switchAuthTab = (which) => {
  document.getElementById('auth-tab-login').classList.toggle('active', which === 'login');
  document.getElementById('auth-tab-register').classList.toggle('active', which === 'register');
  document.getElementById('auth-login-form').style.display    = which === 'login'    ? 'block' : 'none';
  document.getElementById('auth-register-form').style.display = which === 'register' ? 'block' : 'none';
  document.getElementById('login-error').style.display = 'none';
  if (which === 'register') loadRegisterClassOptions();
};

// بيتحمّل قايمة الفصول والأدوار لفورم التسجيل — بيتنادى قبل ما الخادم الجديد يعمل حساب أصلاً،
// فلو ده أول مرة يفتح فيها التاب ده، بيجيبهم من فايرستور مباشرة (لازم قاعدة فايرستور تسمح بقراءة مجموعتي 'classes' و'roles' حتى من غير تسجيل دخول)
async function loadRegisterClassOptions() {
  const sel = document.getElementById('reg-class');
  if (!sel) return;
  if (!S.allRoles.length) {
    try {
      const rsnap = await countedGetDocs(collection(db,'roles'), 'roles (فورم التسجيل)');
      S.allRoles = rsnap.docs.map(d => ({ id:d.id, ...d.data() }));
    } catch(e) { console.error('تعذّر تحميل الأدوار (فورم التسجيل):', e); }
  }
  if (S.allClasses.length) { sel.innerHTML = classSelectOptionsHTML(true, 'تحديد الفصل'); return; }
  sel.innerHTML = `<option value="">جاري تحميل الفصول…</option>`;
  try {
    const snap = await countedGetDocs(collection(db,'classes'), 'classes (فورم التسجيل)');
    S.allClasses = snap.docs.map(d => unifyKgEmoji({ id:d.id, ...d.data() }))
      .sort((a,b) => (a.order??0) - (b.order??0) || (a.name||'').localeCompare(b.name||'','ar'));
    sel.innerHTML = S.allClasses.length ? classSelectOptionsHTML(true, 'تحديد الفصل') : `<option value="">لا يوجد فصول متاحة، كلم الأدمن</option>`;
  } catch(e) {
    console.error('تعذّر تحميل الفصول:', e);
    sel.innerHTML = `<option value="">تعذّر تحميل الفصول</option>`;
  }
}

// أول ما تختار الفصل، بيتملى سيلكت "اسمك" بأسماء الخدام اللي الأدمن ضافهم مقدمًا لأي دور شامل الفصل ده
window.onRegClassChange = () => {
  const classId = document.getElementById('reg-class').value;
  const nameSel = document.getElementById('reg-name-select');
  if (!classId) { nameSel.innerHTML = `<option value="">— اختار فصلك الأول —</option>`; return; }
  const rawNames = [];
  S.allRoles.forEach(r => { if (!r.isAdmin && Array.isArray(r.classes) && r.classes.includes(classId)) (r.pendingNames||[]).forEach(n => rawNames.push(n)); });
  const names = uniqueNames(rawNames); // نفس الاسم ممكن يبقى في أكتر من دور في الفصل (مسؤول + خادم) — بيظهر مرة واحدة بس
  names.sort((a,b) => a.localeCompare(b,'ar'));
  let html = names.length
    ? `<option value="">— اختار اسمك —</option>` + names.map(n => `<option value="${n.replace(/"/g,'&quot;')}">${n}</option>`).join('')
    : `<option value="">مفيش أسماء متاحة للفصل ده، كلم الأدمن</option>`;
  nameSel.innerHTML = html;
};

window.doLogin = async () => {
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');
  btn.disabled = true; btn.textContent = 'جاري الدخول…'; err.style.display = 'none';
  S.explicitAuthAction = true;
  try {
    const _em = document.getElementById('login-email').value.trim();
    const _pw = document.getElementById('login-pass').value;
    S.pendingBioCreds = { email: _em.toLowerCase(), pass: _pw };
    await signInWithEmailAndPassword(auth, _em, _pw);
  } catch {
    S.pendingBioCreds = null;
    S.explicitAuthAction = false;
    err.textContent = 'بيانات خاطئة، حاول تاني';
    err.style.display = 'block';
    btn.disabled = false; btn.textContent = 'دخول';
  }
};

window.doRegister = async () => {
  const btn  = document.getElementById('register-btn');
  const err  = document.getElementById('login-error');
  const regClass = document.getElementById('reg-class').value;
  const name = document.getElementById('reg-name-select').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass  = document.getElementById('reg-pass').value;
  const phone = document.getElementById('reg-phone').value.trim();
  const address = document.getElementById('reg-address').value.trim();
  err.style.display = 'none';
  if (!regClass)    { err.textContent = 'اختار فصلك الأول';       err.style.display = 'block'; return; }
  if (!name)        { err.textContent = 'اختار اسمك من القايمة';  err.style.display = 'block'; return; }
  if (!email||!pass){ err.textContent = 'اكتب الإيميل وكلمة المرور'; err.style.display = 'block'; return; }
  if (!phone)       { err.textContent = 'اكتب رقم تليفونك';       err.style.display = 'block'; return; }
  // الاسم دايمًا مختار من القايمة الجاهزة، فبندوّر على الدور اللي هو منه عشان ناخد منه كل فصوله ونوعه بالظبط
  // نفس الاسم ممكن يبقى مضاف في أكتر من دور (مثلاً مسؤول فصل أ + خادم فصل ب) — بنجمع كل أدواره ونحسب صلاحياته منها
  const nameRoles = S.allRoles.filter(r => !r.isAdmin && Array.isArray(r.classes) && nameVariantsIn(r, name).length);
  const matchedRoles = nameRoles.some(r => r.classes.includes(regClass)) ? nameRoles : [];
  const matchedPerms = matchedRoles.length ? derivePermsFromRoles(matchedRoles) : { role:'servant', assignedClass: regClass, supervisorClass: '' };
  btn.disabled = true; btn.textContent = 'جاري التسجيل…';
  S.explicitAuthAction = true;
  try {
    const cred    = await createUserWithEmailAndPassword(auth, email, pass);
    const isAdmin = ADMIN_EMAILS.map(e=>e.toLowerCase()).includes(email.toLowerCase());
    await setDoc(doc(db,'servants',cred.user.uid), {
      name, email, phone, address,
      assignedClass: isAdmin ? '' : matchedPerms.assignedClass,
      supervisorClass: isAdmin ? '' : matchedPerms.supervisorClass,
      roleId: matchedRoles[0] ? matchedRoles[0].id : '',
      roleIds: matchedRoles.map(r => r.id),
      status: isAdmin ? 'approved' : 'pending',
      role:   isAdmin ? 'admin'    : matchedPerms.role,
      createdAt: serverTimestamp(),
      lastActive: serverTimestamp()
    });
    // لو الاسم ده مختار من قايمة الأسماء الجاهزة، يتمسح من القايمة فورًا عشان محدش تاني يقدر يختاره
    // (محتاج قاعدة فايرستور تسمح للمستخدم يعدّل pendingNames بتاعة roles حتى وهو لسه pending — لو القاعدة بترفض، هيتمسح بعدين لما الأدمن يقبله زي الأول)
    for (const mr of matchedRoles) {
      try { await updateDoc(doc(db,'roles',mr.id), { pendingNames: arrayRemove(...nameVariantsIn(mr, name)) }); } catch(e) { console.error('تعذّر مسح الاسم من القايمة فورًا:', e); }
    }
    try { await sendEmailVerification(cred.user); } catch(_) {}
    // onAuthStateChanged هيتكفل بعرض الشاشة المناسبة (انتظار أو دخول مباشر لو أدمن)
  } catch(e) {
    console.error('خطأ التسجيل:', e.code, e.message, e);
    let msg = 'حصل خطأ، حاول تاني (' + (e.code || e.message || 'unknown') + ')';
    if (e.code === 'auth/email-already-in-use') {
      switchAuthTab('login');
      document.getElementById('login-email').value = email;
      document.getElementById('login-pass').focus();
      msg = 'الإيميل ده كان مسجل قبل كده. لو كان حسابك اتحذف من الأدمن، ادخل هنا بنفس الباسورد اللي كنت حاطه — هيترجع طلبك لحالة "انتظار الموافقة" تلقائي.';
    }
    if (e.code === 'auth/weak-password')        msg = 'كلمة المرور لازم تكون 6 حروف على الأقل';
    if (e.code === 'auth/invalid-email')        msg = 'الإيميل غير صحيح';
    S.explicitAuthAction = false;
    err.textContent = msg; err.style.display = 'block';
  }
  btn.disabled = false; btn.textContent = 'تسجيل';
};

window.doLogout = async () => {
  S.pendingBioCreds = null;
  stopHeartbeat();
  stopPendingSelfWatch(); stopPendingRequestsListener();
  if (ownServantUnsub) { ownServantUnsub(); ownServantUnsub = null; }
  if (servantsUnsub) { servantsUnsub(); servantsUnsub = null; }
  await signOut(auth);
};

function showAuthScreen() {
  refreshBioLoginButton();
  document.getElementById('splash-screen').style.display  = 'none';
  document.getElementById('auth-screen').style.display    = 'flex';
  document.getElementById('pending-screen').style.display  = 'none';
  document.getElementById('app-screen').style.display      = 'none';
}

function showPendingScreen(title, msg) {
  document.getElementById('splash-screen').style.display  = 'none';
  document.getElementById('auth-screen').style.display    = 'none';
  document.getElementById('app-screen').style.display      = 'none';
  document.getElementById('pending-screen').style.display  = 'flex';
  document.getElementById('pending-title').textContent = title;
  document.getElementById('pending-msg').textContent   = msg;
}

onAuthStateChanged(auth, async user => {
  stopHeartbeat();
  if (!user) {
    stopPendingSelfWatch(); stopPendingRequestsListener();
    if (S.todayAttendanceUnsub) { S.todayAttendanceUnsub(); S.todayAttendanceUnsub = null; }
    if (S.todayVersesUnsub) { S.todayVersesUnsub(); S.todayVersesUnsub = null; }
    if (ownServantUnsub) { ownServantUnsub(); ownServantUnsub = null; }
    if (servantsUnsub) { servantsUnsub(); servantsUnsub = null; }
    stopClassesListener();
    S.classPicked = false;
    localStorage.removeItem('stu_cache_v1'); localStorage.removeItem('stu_cache_v2'); S.studentsLoaded = false;
    showAuthScreen();
    const btn = document.getElementById('login-btn');
    btn.disabled = false; btn.textContent = 'دخول';
    return;
  }
  await handleSignedInUser(user);
});

// بيتنادى من onAuthStateChanged، وكمان أول ما طلب الانضمام يتقبل (من غير reload)
async function handleSignedInUser(user) {
  stopPendingSelfWatch();
  try {
    const ref = doc(db,'servants',user.uid);
    let snap = await getDoc(ref);
    if (!snap.exists()) {
      // حساب موجود في Firebase Auth بس مش مسجل كخادم في الموقع ده
      if (ADMIN_EMAILS.map(e=>e.toLowerCase()).includes((user.email||'').toLowerCase())) {
        await setDoc(ref, {
          name: user.email.split('@')[0], email: user.email,
          status: 'approved', role: 'admin',
          createdAt: serverTimestamp(), lastActive: serverTimestamp()
        });
        snap = await getDoc(ref);
      } else if (S.explicitAuthAction) {
        // غالبًا حساب اتحذف قبل كده وحاول يدخل تاني بنفسه — نرجّعه لطلب انضمام جديد بانتظار الموافقة
        await setDoc(ref, {
          name: user.email.split('@')[0], email: user.email,
          status: 'pending', role: 'servant',
          createdAt: serverTimestamp(), lastActive: serverTimestamp()
        });
        snap = await getDoc(ref);
      } else {
        // مجرد جلسة محمولة تلقائيًا من موقع تاني على نفس الدومين — مش طلب دخول مقصود، نتجاهله من غير ما نبعت طلب انضمام لحد
        S.explicitAuthAction = false;
        showAuthScreen();
        await signOut(auth);
        return;
      }
    }
    // لو الإيميل ده هو إيميل الأدمن الأساسي (ADMIN_EMAILS)، نتأكد دايمًا إنه أدمن ومعتمد،
    // حتى لو كان عنده مستند خادم قديم من قبل التغيير (مثلاً كان لسه معتمد كخادم عادي أو حتى pending)
    if (ADMIN_EMAILS.map(e=>e.toLowerCase()).includes((user.email||'').toLowerCase())) {
      const d = snap.data();
      if (d.role !== 'admin' || d.status !== 'approved') {
        await updateDoc(ref, { role: 'admin', status: 'approved' });
        snap = await getDoc(ref);
      }
    }
    S.explicitAuthAction = false;
    const data = snap.data();
    if (data.status === 'pending') {
      showPendingScreen('في انتظار الموافقة', 'طلبك اتبعت للأدمن ومسؤول فصلك وقيد المراجعة، هيتفعل حسابك بمجرد الموافقة ✋');
      watchOwnPendingStatus(user);
      return;
    }
    if (data.status !== 'approved') {
      showPendingScreen('تم إيقاف الحساب', 'حسابك اتحذف أو اتوقف. لو ده حصل غلط كلم الأدمن.');
      return;
    }
    S.currentUid = user.uid; S.currentName = data.name || (user.email||'').split('@')[0]; S.currentRole = data.role || 'servant'; S.currentEmail = (user.email||'').toLowerCase();
    S.currentAssignedClass = data.assignedClass || '';
    S.currentSupervisorClass = supervisedClassesOf(data).join(',');
    S.currentPhone = data.phone || ''; S.currentAddress = data.address || '';
    document.getElementById('splash-screen').style.display  = 'none';
    document.getElementById('auth-screen').style.display    = 'none';
    document.getElementById('pending-screen').style.display = 'none';
    document.getElementById('app-screen').style.display     = 'flex';
    applyMonitorVisibility();
    startHeartbeat();
    listenOwnServantDoc(user.uid);
    if (canHandleRequests()) startPendingRequestsListener();
    startClassesListener();
    initApp();
    setTimeout(maybeOfferBio, 1200);
  } catch(e) {
    console.error(e);
    showAuthScreen();
  }
}

// الخادم اللي لسه بانتظار الموافقة: قراءة واحدة + تحديث لحظي على مستنده هو بس، فأول ما الأدمن يقبله يدخل لوحده
let pendingSelfUnsub = null;

function stopPendingSelfWatch() { if (pendingSelfUnsub) { pendingSelfUnsub(); pendingSelfUnsub = null; } }

function watchOwnPendingStatus(user) {
  stopPendingSelfWatch();
  pendingSelfUnsub = onSnapshot(doc(db,'servants',user.uid), snap => {
    if (!snap.exists()) {
      if (snap.metadata.fromCache) return;
      stopPendingSelfWatch();
      showPendingScreen('تم إيقاف الحساب', 'حسابك اتحذف أو اتوقف. لو ده حصل غلط كلم الأدمن.');
      return;
    }
    if (snap.data().status === 'approved') { stopPendingSelfWatch(); handleSignedInUser(user); }
  }, err => console.error('pending self listener error:', err));
}

// ===== HEARTBEAT (أونلاين/أوفلاين) =====
function startHeartbeat() { /* اتلغى: مفيش متابعة أونلاين لحظية عشان نوفر الـ reads */ }

function stopHeartbeat() { clearInterval(heartbeatTimer); heartbeatTimer = null; }

// ===== الأدمن الأساسي (ثابت من ADMIN_EMAILS) =====
export function isPrimaryAdmin(email) {
  return ADMIN_EMAILS.map(e=>e.toLowerCase()).includes((email||'').toLowerCase());
}

// بث لحظي على مستند الخادم بتاعي: لو الأدمن الأساسي عمل لي ترقية/تنزيل من الأدمن أو حذفني بالكامل،
// أتأثر فورًا وأنا شغال من غير ما أحتاج أعمل reload أو أعمل logout/login تاني
function listenOwnServantDoc(uid) {
  if (ownServantUnsub) { ownServantUnsub(); ownServantUnsub = null; }
  ownServantUnsub = onSnapshot(doc(db,'servants',uid), snap => {
    countDocSnapshotReads('servants (ملفي)', snap);
    if (!snap.exists()) {
      showToast('تم حذفك من التطبيق بواسطة الأدمن', 'error');
      forceLogout();
      return;
    }
    const d = snap.data();
    if (d.status !== 'approved') {
      showToast('تم إيقاف حسابك بواسطة الأدمن', 'error');
      forceLogout();
      return;
    }
    let roleOrClassChanged = false;
    if (d.role !== S.currentRole) {
      S.currentRole = d.role;
      roleOrClassChanged = true;
      applyMonitorVisibility();
      if (canHandleRequests()) startPendingRequestsListener(); else stopPendingRequestsListener();
      if (S.currentRole === 'admin') {
        showToast('مبروك! الأدمن الأساسي خلاك أدمن 👑', 'success');
      } else if (S.currentRole === 'supervisor') {
        showToast('اتحددتلك مسؤولية فصل — بقى عندك "الخدام" في الرئيسية 🗝️', 'success');
      } else {
        showToast('اتغيّر دورك بواسطة الأدمن الأساسي', 'info');
      }
      // لو كنت واقف في تبويب مش متاح ليك بدورك الجديد، نرجّعه لتبويب الحضور
      if ((document.getElementById('tab-monitor').style.display === 'block' && S.currentRole !== 'admin') ||
          (document.getElementById('tab-classservants').style.display === 'block' && S.currentRole !== 'supervisor')) {
        goHome();
      }
    }
    S.currentPhone = d.phone || ''; S.currentAddress = d.address || '';
    if (d.name && d.name !== S.currentName) { S.currentName = d.name; fillSettingsHeader(); }
    // لو الأدمن حدد/غيّر/شال الفصل المخصص للخادم من تبويب "متابعة"، يتفعل فورًا من غير reload
    if ((d.assignedClass || '') !== S.currentAssignedClass) {
      S.currentAssignedClass = d.assignedClass || '';
      roleOrClassChanged = true;
      const allowed = getAllowedAssignedClasses(S.currentAssignedClass);
      showToast(S.currentAssignedClass
        ? `اتحددلك ${formatAssignedClasses(S.currentAssignedClass)} بواسطة الأدمن — هتشوف مخدومين هذه الفصول بس`
        : 'الأدمن شال تحديد الفصول بتاعتك — بقيت تشوف كل الفصول', 'info');
    }
    const supStr = supervisedClassesOf(d).join(',');
    if (supStr !== S.currentSupervisorClass) {
      S.currentSupervisorClass = supStr;
      roleOrClassChanged = true;
      if (canHandleRequests()) startPendingRequestsListener(); else stopPendingRequestsListener();
      renderSupPending();
      if (document.getElementById('tab-classservants')?.style.display === 'block') { renderClassServAttList(); renderClassServList(); }
    }
    if (roleOrClassChanged) {
      applyClassRestrictionUI();
      if (S.todayAttendanceUnsub || S.todayVersesUnsub) restartTodayListeners();
      loadStudents().then(() => {
        updateStats(); renderTodayList();
        if (document.getElementById('tab-filters')?.style.display === 'block') renderFilterList();
        if (document.getElementById('tab-messages')?.style.display === 'block') renderWaTab();
      });
    }
  }, err => console.error('own servant listener error:', err));
}

async function forceLogout() {
  stopPendingRequestsListener();
  if (ownServantUnsub) { ownServantUnsub(); ownServantUnsub = null; }
  if (servantsUnsub) { servantsUnsub(); servantsUnsub = null; }
  if (S.todayAttendanceUnsub) { S.todayAttendanceUnsub(); S.todayAttendanceUnsub = null; }
  if (S.todayVersesUnsub) { S.todayVersesUnsub(); S.todayVersesUnsub = null; }
  stopHeartbeat();
  await signOut(auth);
}

// ===== سجل الأنشطة =====
export async function logActivity(action, detail = '') {
  if (!S.currentUid) return;
  try {
    await addDoc(collection(db,'activityLog'), {
      uid: S.currentUid, name: S.currentName, action, detail, timestamp: serverTimestamp()
    });
  } catch(e) {}
}

// ===== INIT =====
async function initApp() {
  const now  = new Date();
  const days = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  document.getElementById('today-date-top').textContent =
    days[now.getDay()] + ' — ' + now.toLocaleDateString('ar-EG',{day:'numeric',month:'long',year:'numeric'});
  applyClassRestrictionUI();
  goHome();
}
