# تفعيل إشعارات الموبايل (Push) في Hdour

الكود جاهز في `index.html` و`sw.js` و`workers/push-worker.js`. لحد ما تعمل الخطوات دي، الإشعارات بتفضل جوه التطبيق بس.
المشروع: Firebase `hdour-d66d8` (مشروع منفصل عن STMina، فالمفتاح والـ Worker ليهم هنا لوحدهم).

1. **مفتاح VAPID:** Firebase Console → Project settings → Cloud Messaging → Web Push certificates → Generate key pair → انسخ المفتاح العام.
2. **Service account:** Project settings → Service accounts → Generate new private key → هينزل ملف JSON (متحطوش في الـ repo).
3. **Cloudflare Worker:** اعمل Worker جديد (مثلاً `hdour-push`) والصق فيه محتوى `workers/push-worker.js`، وبعدين في Settings → Variables and Secrets:
   - `SERVICE_ACCOUNT` (Secret): محتوى ملف الـ JSON كله.
   - `ALLOWED_ORIGIN` (Text): `https://teto550.github.io`
   - `APP_URL` (Text): رابط تطبيق Hdour.
4. **في `index.html`:** املا `FCM_VAPID_KEY` (من خطوة 1) و`PUSH_WORKER_URL` (رابط الـ Worker) في قسم "إشعارات الموبايل الحقيقية".
5. **على الموبايل:** افتح التطبيق → ⚙️ → 🔔 الإشعارات → دوس "دوس للتفعيل" واسمح بالإذن. على الآيفون لازم تضيف التطبيق للشاشة الرئيسية الأول.

بتوصل إشعارات لـ: طلب انضمام جديد (للأدمن والمشرفين على فصل الطالب)، وخادم فتح التطبيق (للأدمن بس، مرة كل 30 دقيقة للخادم).

## حذف الخادم من Firebase Authentication (`/delete-servant`)
زرار "🗑 حذف" بيبعت للـ Worker، والـ Worker (بالـ service account) بيمسح إيميل الخادم من Authentication ومستنده من فايرستور. مجاني بالكامل (من غير Cloud Functions ولا Blaze).
- لازم تحدّث كود الـ Worker في Cloudflare بآخر نسخة من `workers/push-worker.js` وتعمل Deploy.
- الـ service account لازم يكون ليه صلاحية إدارة Authentication (الحساب اللي Firebase بينزّله بيكون `firebase-adminsdk-…` وعنده الصلاحية دي افتراضيًا).
- اختياري: ضيف متغير `PROTECTED_EMAILS` (Text) فيه إيميل الأدمن الأساسي (أو أكتر، بينهم فاصلة) عشان الـ Worker يرفض يمسحه.
- الأدمن بس هو اللي يقدر يستخدمه. لو الـ Worker مش متحدّث أو فشل، الخادم بيتمسح من الداتا بيز عادي وبتظهرلك رسالة إن الإيميل لسه في Authentication.
