// تهيئة Firebase (App / App Check / Auth / Firestore) + إعادة تصدير دوال المكتبة عشان باقي الملفات تستوردها من هنا
import { firebaseConfig } from './config.js';

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, sendEmailVerification, EmailAuthProvider, reauthenticateWithCredential }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { initializeFirestore, persistentLocalCache, persistentSingleTabManager, collection, addDoc, getDocs, deleteDoc, doc, getDoc, setDoc, updateDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp, Timestamp, writeBatch, increment, arrayUnion, arrayRemove }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { initializeAppCheck, ReCaptchaEnterpriseProvider }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";

const app  = initializeApp(firebaseConfig, 'babyclass-app');

// ===== APP CHECK (reCAPTCHA Enterprise) =====
// localhost يستخدم التعرض المحلي دون طلب Google reCAPTCHA، بينما النشرة تبقى محمية.
const isLocalDevelopment = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);

if (!isLocalDevelopment) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider('6LfZEcYtAAAAAPAX04C1QJAGkoB1MV8MbJuNRF2a'),
    isTokenAutoRefreshEnabled: true
  });
}

export const auth = getAuth(app);

export const db   = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() })
});

// إعادة تصدير دوال Firebase عشان باقي الملفات تستوردها من هنا
export { initializeApp, getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, sendEmailVerification, EmailAuthProvider, reauthenticateWithCredential, initializeFirestore, persistentLocalCache, persistentSingleTabManager, collection, addDoc, getDocs, deleteDoc, doc, getDoc, setDoc, updateDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp, Timestamp, writeBatch, increment, arrayUnion, arrayRemove, initializeAppCheck, ReCaptchaEnterpriseProvider };
