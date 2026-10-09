// الحالة المشتركة بين الملفات (S.xxx) — أي متغير بيتقرا/بيتعدّل من أكتر من ملف بيتحط هنا
// الاستخدام: import { S } from '../core/state.js';  ثم  S.allStudents  /  S.currentUid = ...

export const S = {
  allStudents: [],
  todayAttendance: {},
  allAttendance: {},
  todayAttendanceTime: {},
  todayVerseTime: {}, // studentId -> millis وقت التسجيل، لترتيب "الأول للأخير"
  todayAttendanceUnsub: null, // بث لحظي لحضور النهارده — يخلي كل خادم يشوف تحديثات الخادم التاني فوراً
  todayVersesUnsub: null, // بث لحظي لسماع الآية النهارده — نفس الفكرة بالظبط لكن للسماع
  todayVerses: {},
  allVerses: {}, // { studentId: { id, verse } } keyed by date→studentId
  currentUid: null,
  currentName: '',
  currentRole: 'servant',
  currentEmail: '',
  currentSupervisorClass: '', // الفصول اللي الخادم مسؤول عنها (ممكن تبقى جزء من فصوله)
  currentAssignedClass: '', // 'a' | 'b' | 'kg' | 'a,b' | '' — الفصول اللي الأدمن حدده للخادم من تبويب "متابعة" (فاضي = مقيدش، بيشوف كل الفصول)
  classPicked: false, // الخادم اللي في أكتر من فصل بيختار فصله مرة أول ما يفتح البرنامج
  classServScope: 'class', // 'class' = خدام الفصل الحالي بس | 'all' = خدام كل الفصول اللي المسؤول مسؤول عنها
  currentPhone: '',
  currentAddress: '', // بيانات ملفي الشخصي (شاشة الإعدادات)
  // نطاق قراءة الخادم: فصوله بس. ولو واحد منهم بيبي كلاس 1/2 أو كي جي 1 → التلات فصول دول + المخدومين اللي لسه متقسموش ('')
  // لحد ما التقسيم يخلص. الأدمن والخادم من غير فصل = [] (من غير تقييد)
  adminAllClasses: false,
  adminAutoAll: false,
  newGenderManuallySet: false, // true لو المستخدم غيّر خانة "النوع" بنفسه في فورم الإضافة (يوقف التخمين التلقائي)
  editGenderManuallySet: false, // نفس الفكرة بس في مودال التعديل
  explicitAuthAction: false, // بيتحط true بس لما الخادم يدوس زرار "دخول" بنفسه، عشان نفرّق بين جلسة محمولة من موقع تاني على نفس الدومين ودخول مقصود فعلاً
  absenceFilter: 'all',
  attendanceFilter: 'all',
  verseFilter: 'all',
  classFilter: 'all', // 'all' | <classId> | 'none' (فلتر الفصل — تبويب المخدومين)
  currentClassTab: localStorage.getItem('attendanceClassTab') || '', // <classId> — التاب المختار فوق في شاشة الحضور، بيتحدد أول فصل موجود لما الفصول توصل
  // الفصول بقت متخزنة في مجموعة 'classes' على فايرستور بدل ما تكون ثابتة (a/b/kg) في الكود،
  // عشان تقدر تضيف/تعدّل/تمسح فصول من جوه التطبيق نفسه من غير ما تحتاج تعديل كود
  allClasses: [], // [{id,name,emoji,order}]
  pendingBioCreds: null, // {email, pass} من آخر دخول بالإيميل — بيتمسح بعد العرض
  studentsLoaded: false,
  waAbsenceFilter: 'all',
  waAttendanceFilter: 'all',
  recentAttWeeks: 0,
  attRefreshBusy: false,
  recentVerseWeeks: 0,
  recentVerseScope: null,
  verseForceFull: false,
  currentProfileId: null,
  monitorClassFilter: 'all',
  cachedServants: [],
  servantsLoadedFlag: false,
  // دور = اسم + هل هو أدمن + قايمة فصول. بتحفظ الدور يطبّق على كل أعضاءه مرة واحدة (roleId بيتسجل على مستند كل خادم عضو).
  allRoles: [],
  rolesLoadedFlag: false,
  rolesReturnTab: '', // التاب اللي كان مفتوح قبل ما ندخل شاشة الأدوار، عشان نرجعله لما نقفل
};
