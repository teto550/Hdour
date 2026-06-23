# حضور — Hdour

تطبيق PWA لتسجيل حضور Baby Class باستخدام Firebase.

## الملفات

```
Hdour/
├── index.html        # التطبيق الرئيسي
├── manifest.json     # إعدادات PWA
├── sw.js             # Service Worker
├── firebase.json     # إعدادات Firebase Hosting
├── .firebaserc       # ربط المشروع بـ Firebase
├── icon-193.png      # أيقونة 192×192
└── icon-513.png      # أيقونة 512×512
```

## رفع على Firebase Hosting

```bash
npm install -g firebase-tools
firebase login
firebase deploy
```

التطبيق سيكون على:
- https://hdour-d66d8.web.app
- https://hdour-d66d8.firebaseapp.com

## رفع على GitHub

```bash
git init
git add .
git commit -m "Initial commit: Hdour attendance app"
git remote add origin https://github.com/YOUR_USERNAME/Hdour.git
git push -u origin main
```

## إعدادات Firebase المطلوبة

1. **Authentication** → فعّل Email/Password
2. **Firestore** → أنشئ قاعدة البيانات وضع القواعد:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```
