// تسجيل الحضور بالصوت
import { S } from '../core/state.js';
import { addDoc, collection, db, serverTimestamp } from '../core/firebase.js';
import { normalizeArabic } from '../core/idb-cache.js';
import { clsOf, markPresent } from './attendance.js';
import { logActivity } from './auth.js';
import { classScope, ownClassStudents, studentAvatarHTML } from './classes.js';
import { VERSE_CLOSED_MSG, verseKey, verseOpen } from './settings.js';
import { renderTodayList } from './today-list.js';
import { scoreStudentsVoice, stripVoiceFillers } from '../lib/arabic-match.js';

// ===== VOICE ATTENDANCE =====
let voiceRecognition = null;
let voiceListening = false;
let voiceRestartTimer = null;

let voiceMode = 'attendance'; // 'attendance' (تسجيل حضور) أو 'verse' (تسجيل سماع آية)

// بيدوّر في الكلام المسموع على أمر تغيير الوضع ("تسجيل آية" / "تسميع" / "تسجيل حضور")،
// وبيرجع الوضع الجديد (لو لقى أمر) + باقي الكلام من غير كلمات الأمر (لو المستخدم قال اسم مع الأمر في نفس الجملة)
function extractVoiceCommand(rawText) {
  const norm = normalizeArabic(rawText);
  let words = norm.split(' ').filter(Boolean);
  let mode = null;
  if (words.includes('تسميع')) {
    mode = 'verse';
    words = words.filter(w => w !== 'تسميع');
  } else if (words.includes('تسجيل') && words.includes('ايه')) {
    mode = 'verse';
    words = words.filter(w => w !== 'تسجيل' && w !== 'ايه');
  } else if (words.includes('تسجيل') && words.includes('حضور')) {
    mode = 'attendance';
    words = words.filter(w => w !== 'تسجيل' && w !== 'حضور');
  }
  return { mode, remainder: words.join(' ').trim() };
}

function updateVoiceModeUI() {
  const badge = document.getElementById('voice-mode-badge');
  const hint = document.getElementById('voice-hint');
  if (!badge) return;
  if (voiceMode === 'verse') {
    badge.textContent = '📖 وضع: تسجيل سماع آية';
    badge.style.background = 'rgba(124,92,191,0.14)';
    badge.style.borderColor = 'rgba(124,92,191,0.35)';
    badge.style.color = '#a07de0';
    if (hint) hint.textContent = 'قول أسماء المخدومين واحد ورا التاني، هيتسجلوا "سماع" على طول — قول "تسجيل حضور" عشان ترجع لتسجيل الحضور';
  } else {
    badge.textContent = '✓ وضع: تسجيل حضور';
    badge.style.background = 'rgba(46,204,113,0.12)';
    badge.style.borderColor = 'rgba(46,204,113,0.3)';
    badge.style.color = 'var(--success)';
    if (hint) hint.textContent = 'قول اسم المخدوم (اسمين بيكفوا) — أو قول "تسجيل آية" عشان تبدأ تسجّل سماع';
  }
}

window.toggleVoiceMode = () => {
  voiceMode = voiceMode === 'verse' ? 'attendance' : 'verse';
  updateVoiceModeUI();
  showToast(voiceMode === 'verse' ? '📖 وضع تسجيل السماع شغال' : '✅ وضع تسجيل الحضور شغال', 'info');
};

function buildVoiceRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = 'ar-EG';
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 5; // نجرب أكتر من تفسير للصوت عشان لو أول تفسير غلط في اسم متشابه

  r.onresult = (e) => {
    let finalText = '', interimText = '';
    let finalAlternatives = [];
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      const t = result[0].transcript;
      if (result.isFinal) {
        finalText += t;
        for (let a = 0; a < result.length; a++) finalAlternatives.push(result[a].transcript);
      } else {
        interimText += t;
      }
    }
    const heardEl = document.getElementById('voice-heard');
    if (heardEl) heardEl.textContent = (finalText || interimText).trim() || 'بيسمعك دلوقتي…';
    if (finalText.trim()) processVoiceName(finalAlternatives.length ? finalAlternatives : [finalText.trim()]);
  };

  r.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return; // will auto-restart on end
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      showToast('🔒 اسمح للتطبيق بالميكروفون', 'error');
      stopVoice();
      return;
    }
    if (e.error === 'audio-capture') {
      showToast('🎤 مفيش ميكروفون متاح', 'error');
      stopVoice();
      return;
    }
  };

  r.onend = () => {
    if (voiceListening) {
      // Chrome auto-stops recognition after a pause; restart seamlessly while user hasn't stopped it
      clearTimeout(voiceRestartTimer);
      voiceRestartTimer = setTimeout(() => {
        if (voiceListening) { try { voiceRecognition.start(); } catch {} }
      }, 250);
    }
  };

  return r;
}

window.startVoice = () => {
  if (voiceListening) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showToast('التسجيل بالصوت مش متاح على المتصفح ده، جرّب Chrome', 'error'); return; }
  voiceRecognition = buildVoiceRecognition();
  if (!voiceRecognition) { showToast('التسجيل بالصوت مش متاح', 'error'); return; }
  try {
    voiceRecognition.start();
  } catch (e) {
    showToast('تعذّر تشغيل الميكروفون', 'error');
    return;
  }
  voiceListening = true;
  voiceMode = 'attendance';
  document.getElementById('voice-toggle-btn').style.display = 'none';
  document.getElementById('voice-zone').style.display = 'block';
  document.getElementById('voice-stop-btn').style.display = 'block';
  document.getElementById('voice-heard').textContent = 'بيسمعك دلوقتي…';
  document.getElementById('voice-candidates').innerHTML = '';
  updateVoiceModeUI();
};

window.stopVoice = () => {
  voiceListening = false;
  clearTimeout(voiceRestartTimer);
  try { voiceRecognition?.stop(); } catch {}
  voiceRecognition = null;
  document.getElementById('voice-zone').style.display = 'none';
  document.getElementById('voice-stop-btn').style.display = 'none';
  document.getElementById('voice-toggle-btn').style.display = 'block';
  document.getElementById('voice-candidates').innerHTML = '';
};

async function processVoiceName(altTexts) {
  let texts = (Array.isArray(altTexts) ? altTexts : [altTexts]).filter(Boolean);
  if (!texts.length) return;
  let displayText = texts[0];

  // هل الكلام ده أمر تغيير وضع ("تسجيل آية" / "تسميع" / "تسجيل حضور")؟
  const cmd = extractVoiceCommand(displayText);
  if (cmd.mode) {
    voiceMode = cmd.mode;
    updateVoiceModeUI();
    if (!cmd.remainder) {
      // الجملة كانت الأمر بس من غير اسم — نوقف هنا ونستنى الاسم اللي جاي
      showToast(voiceMode === 'verse' ? '📖 وضع تسجيل السماع شغال — قول الأسماء' : '✅ وضع تسجيل الحضور شغال — قول الأسماء', 'info');
      document.getElementById('voice-candidates').innerHTML = '';
      return;
    }
    // المستخدم قال الأمر واسم في نفس الجملة (زي "تسجيل آية مينا") — نكمل بالاسم الباقي في الوضع الجديد
    texts = [cmd.remainder];
    displayText = cmd.remainder;
  }

  // بنجمع درجات كل البدائل الصوتية اللي المتصفح رجّعها (مش بنوقف عند أول واحد بيدّي مرشحين)،
  // عشان لو أول بديل سمعه غلط والبديل التاني/التالت كان أصح، برضه ناخد بالنتيجة الأدق من الكل
  const bestById = new Map(); // studentId -> { s, score }
  for (const t of texts) {
    const q = normalizeArabic(t);
    if (!q) continue;
    const qClean = stripVoiceFillers(q);
    const variants = qClean === q ? [q] : [qClean, q];
    for (const v of variants) {
      for (const { s, score } of scoreStudentsVoice(classScope(ownClassStudents()), v)) {
        const prev = bestById.get(s.id);
        if (!prev || score > prev.score) bestById.set(s.id, { s, score });
      }
    }
  }
  let list = [];
  if (bestById.size) {
    const scored = [...bestById.values()].sort((a, b) => b.score - a.score);
    const topScore = scored[0].score;
    // نرجّع بس اللي قريبين فعلاً من أعلى نتيجة (مش كل حاجة عدّت العتبة بالكاد)، وبحد أقصى 5 مرشحين
    list = scored.filter(x => x.score >= topScore - 0.12).slice(0, 5).map(x => x.s);
  }

  const candWrap = document.getElementById('voice-candidates');
  if (!candWrap) return;

  if (!list.length) {
    showToast(`❓ مفيش مخدوم اسمه "${displayText}"`, 'error');
    candWrap.innerHTML = '';
    return;
  }

  const isVerseMode = voiceMode === 'verse';
  const alreadyDone = s => isVerseMode ? !!S.todayVerses[s.id] : !!S.todayAttendance[s.id];

  if (list.length === 1) {
    const s = list[0];
    if (alreadyDone(s)) {
      showToast(`${s.name} — ${isVerseMode ? 'مسجّل سماعه مسبقاً' : 'مسجّل مسبقاً'} ✓`, 'info');
      candWrap.innerHTML = '';
      return;
    }
    if (isVerseMode) {
      await registerVerseVoice(s.id);
    } else {
      await markPresent(s.id);
      showToast(`✅ ${s.name} — تم التسجيل بالصوت`, 'success');
      navigator.vibrate?.([60,30,60]);
      logActivity('تسجيل حضور (صوت)', s.name);
    }
    candWrap.innerHTML = '';
    return;
  }

  // Multiple students match the spoken name — let the user pick who to mark
  candWrap.innerHTML = `<div style="color:var(--text-dim);font-size:12px;margin:8px 0 6px">في ${list.length} مخدومين بنفس الاسم، اختار مين:</div>` +
    list.map(s => {
      const done = alreadyDone(s);
      return `<div class="result-item" style="cursor:default">
        ${studentAvatarHTML(s,'result-avatar')}
        <div style="flex:1;font-size:14px;font-weight:700">${s.name}</div>
        ${done
          ? `<span class="present-badge">✓ ${isVerseMode?'سمع':'حاضر'}</span>`
          : `<button onclick="voicePickStudent('${s.id}')" style="background:rgba(46,204,113,0.1);border:1px solid rgba(46,204,113,0.3);border-radius:8px;color:var(--success);font-family:Cairo,sans-serif;font-size:12px;font-weight:700;padding:8px 12px;cursor:pointer">✓ ده</button>`}
      </div>`;
    }).join('');
}

// بيسجل "سماع آية" بالصوت (زي showVerseModal بالظبط) لكن من غير ما يعتمد على إن العنصر النشط في شاشة البحث اليدوي
async function registerVerseVoice(studentId) {
  if (!verseOpen()) { showToast(VERSE_CLOSED_MSG, 'error'); return; }
  const today = verseKey();
  if (S.todayVerses[studentId]) return;
  try {
    const ref = await addDoc(collection(db,'verses'), { studentId, date: today, verse: '', classSection: clsOf(studentId), timestamp: serverTimestamp() });
    S.todayVerses[studentId] = { id: ref.id, verse: '' };
    S.todayVerseTime[studentId] = Date.now();
    if (!S.allVerses[today]) S.allVerses[today] = {};
    S.allVerses[today][studentId] = { id: ref.id, verse: '' };
    renderTodayList();
    const s = S.allStudents.find(x => x.id === studentId);
    showToast(`📖 ${s?.name || ''} — تم تسجيل السماع بالصوت`, 'success');
    navigator.vibrate?.([60,30,60]);
    logActivity('تسجيل سماع آية (صوت)', s?.name || '');
  } catch(e) {
    showToast('خطأ في الحفظ', 'error');
  }
}

window.voicePickStudent = async (id) => {
  const isVerseMode = voiceMode === 'verse';
  if (isVerseMode ? S.todayVerses[id] : S.todayAttendance[id]) return;
  if (isVerseMode) {
    await registerVerseVoice(id);
  } else {
    const ok = await markPresent(id);
    if (ok) {
      const s = S.allStudents.find(x => x.id === id);
      showToast(`✅ ${s.name} — تم التسجيل بالصوت`, 'success');
      navigator.vibrate?.([60,30,60]);
      logActivity('تسجيل حضور (صوت)', s.name);
    }
  }
  document.getElementById('voice-candidates').innerHTML = '';
  document.getElementById('voice-heard').textContent = 'بيسمعك دلوقتي…';
};
