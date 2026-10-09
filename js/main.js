// نقطة بداية التطبيق — بتستورد كل ملفات البرنامج.
// الترتيب هنا هو نفس ترتيب الكود الأصلي (مهم لأن بعض الملفات بتسجّل أحداث/دوال عامة أول ما تتحمّل).
// لو أضفت ملف جديد في js/features/ ضيف سطر import ليه هنا (وضيفه كمان في SHELL_FILES جوه sw.js).

import './core/config.js';
import './core/state.js';
import './core/firebase.js';
import './core/reads-counter.js';
import './core/idb-cache.js';
import './lib/utils.js';
import './lib/arabic-match.js';
import './features/classes.js';
import './features/settings.js';
import './features/biometric.js';
import './features/auth.js';
import './features/students.js';
import './features/whatsapp.js';
import './features/attendance.js';
import './features/today-list.js';
import './features/filters.js';
import './features/profile.js';
import './features/voice-attendance.js';
import './features/export.js';
import './features/navigation.js';
import './features/monitor.js';
import './features/class-servants.js';
import './features/servant-profile.js';
import './features/servants-dashboard.js';
import './features/users-roles.js';
import './features/edit-student.js';
import './core/toast.js';
