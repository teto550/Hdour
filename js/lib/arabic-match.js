// تخمين النوع (ولد/بنت) من الاسم + مطابقة الأسماء العربي (عادي / ضبابي / صوتي)
import { S } from '../core/state.js';
import { canonicalizeName, normalizeArabic } from '../core/idb-cache.js';

// ===== تخمين النوع (ولد/بنت) تلقائيًا من الاسم الأول =====
// قائمة مش شاملة كل الأسماء، لكنها بتغطي أكتر الأسماء شيوعًا (قبطية وعربية عامة).
// أي اسم مش موجود فيها بيترك فاضي عشان تختاره يدويًا بنفسك.
const MALE_NAMES_RAW = [
  'مينا','كيرلس','مرقس','مرقص','بطرس','بولس','بولا','بولص','يوحنا','يوسف','يعقوب','إبراهيم','ابراهيم','ابراهام',
  'إسحق','اسحق','إسحاق','اسحاق','فيلوباتير','بيشوي','بشوي','أثناسيوس','اثناسيوس','موسى','داود','صموئيل','متى',
  'لوقا','إستفانوس','استفانوس','مكاريوس','باخوميوس','باخوم','رافائيل','ميخائيل','جبرائيل','غبريال','جرجس','جورج',
  'توما','رمزي','عادل','عماد','هاني','مجدي','نادر','وائل','وليد','سامح','سامي','عاطف','جميل','فادي','مارك',
  'أندرو','اندرو','انطون','أنطون','أنطونيوس','انطونيوس','إيهاب','ايهاب','إيمن','ايمن','روماني','رومان','زكريا',
  'حبيب','نشأت','نوشي','نصحي','فارس','تادرس','أبانوب','ابانوب','مقار','موريس','أشرف','اشرف','أحمد','احمد','محمد',
  'علي','حسن','حسين','خالد','طارق','عمر','إسماعيل','اسماعيل','عبدالله','عبد الله','عبدالرحمن','عبد الرحمن','معاذ',
  'أسامة','اسامة','كريم','مصطفى','عمرو','تامر','هشام','ياسر','رامي','شريف','ماجد','ناصر','باسم','حازم','زياد',
  'آدم','ادم','يزن','جاد','سيف','مؤمن','حمزة','معتز','عزت','شنودة','ديميان','بيمن','وهبة','رزق','لبيب','عوض',
  'صفوت','فوزي','نبيل','رأفت','رافت','سعد','سيد','أمير','امير','كارلوس','أوسم','اوسم','بهاء','عبده','رفيق',
  'وجيه','نظير','فايز','ثروت','عصام','جلال','حلمي','لويس','يواقيم','يواكيم','حنا','ديفيد','دانيال','دانيل',
  'سلامة','سليمان','صليب','معاوية','طلحة','عبيدة','عقبة','قتادة','عنترة','رأفت','مينو','ملاك'
];

const FEMALE_NAMES_RAW = [
  'مريم','مارينا','ماريا','مارتا','كاترين','كارول','فيرونيا','فيبي','إيريني','ايريني','أغابي','اغابي','دميانة',
  'تريز','تريزا','نرمين','ناردين','مرفت','منى','منال','مها','مي','هبة','هدى','هالة','سارة','سلمى','سلوى',
  'سماح','سميرة','سامية','سناء','شيرين','شهد','صفاء','ضحى','عبير','عزة','علياء','غادة','فاتن','فاطمة','فايزة',
  'كريمة','لبنى','لمياء','ليلى','مادلين','مارلين','مايا','ميرنا','ميرا','ميرام','نادية','ناهد','نجلاء','نجوى',
  'نهى','نهال','نوال','نورا','نورهان','هاجر','هايدي','وفاء','ياسمين','يارا','دعاء','إيمان','ايمان','أمل','امل',
  'أمنية','امنية','آية','اية','رانيا','رنا','رنيم','ريم','ريهام','زينب','سهير','شادية','شيماء','صابرين','غدير',
  'فادية','فرح','كنزي','لجين','ملك','منة','ندى','هنا','عائشة','خديجة','رقية','أسماء','اسماء','مروة','دينا',
  'لمى','جنى','جودي','لين','تالا','جوري','لارا','انجي','إنجي','نيفين','نانسي','ماجي','مادونا','يوستينا',
  'سوزان','هيلانة','هيلين','فينيسيا','باربارا','كلوديا','ماريان','ماريانا','أليس','اليس','جانيت','جينا','لوسي',
  'نادين','نيرمين','سيلفيا','فيرينا','إستير','استير','راشيل','كارين','لورا','ايفا','إيفا','نعمة','نعمت',
  'نور الهدى','هدير','رحمة','بسملة','تسبيح','مارينيت','مارينيل','لوجينا','جيلان','نجاة','وداد','صباح','دميان'
];

const MALE_NAME_SET   = new Set(MALE_NAMES_RAW.map(n => canonicalizeName(n)));

const FEMALE_NAME_SET = new Set(FEMALE_NAMES_RAW.map(n => canonicalizeName(n)));

// بيرجع 'male' أو 'female' أو '' (لو مش عارفين) — بيدور على الاسم الأول بس في القوايم فوق،
// ولو مش لاقيه بيلجأ لقاعدة بسيطة: الاسم اللي بينتهي بتاء مربوطة أو "اء" غالبًا مؤنث في العربي
export function guessGenderFromName(fullName) {
  const first = canonicalizeName(fullName).trim().split(' ')[0];
  if (!first) return '';
  if (MALE_NAME_SET.has(first))   return 'male';
  if (FEMALE_NAME_SET.has(first)) return 'female';
  if (first.endsWith('اء')) return 'female';
  if (first.endsWith('ه'))  return 'female'; // ه هنا أصلها تاء مربوطة بعد التوحيد (canonicalizeName بتحول ة إلى ه)
  return '';
}

// بيشتغل وانت بتكتب اسم مخدوم جديد: لو لسه ما اخترتش النوع يدويًا، بيخمّنه من الاسم ويحطه تلقائي
window.onNewNameInput = () => {
  if (S.newGenderManuallySet) return;
  const guess = guessGenderFromName(document.getElementById('new-name').value);
  if (guess) document.getElementById('new-gender').value = guess;
};

// نفس الفكرة في مودال تعديل مخدوم: بيخمّن بس لو النوع لسه مش متسجل أو المستخدم مغيّرهوش يدويًا
window.onEditNameInput = () => {
  if (S.editGenderManuallySet) return;
  const guess = guessGenderFromName(document.getElementById('edit-name').value);
  if (guess) document.getElementById('edit-gender').value = guess;
};

// ولو كتبت أكتر من كلمة (زي الاسم واسم الأب) بتتفحص كل كلمة من اللي كتبته لوحدها، بأي ترتيب
function matchesQuery(name, normalizedQuery) {
  if (!normalizedQuery) return true;
  const nameWords  = normalizeArabic(name).split(' ').filter(Boolean);
  const queryWords = normalizedQuery.split(' ').filter(Boolean);
  return queryWords.every(qw => nameWords.some(w => w.startsWith(qw)));
}

// ترتيب النتايج: اللي اسمه الأول (بداية الاسم بالكامل) بيبدأ بأول كلمة في البحث يطلع فوق
function matchRank(name, normalizedQuery) {
  const words      = normalizeArabic(name).split(' ').filter(Boolean);
  const queryWords = normalizedQuery.split(' ').filter(Boolean);
  if (words[0]?.startsWith(queryWords[0] || '')) return 0;
  return 1;
}

export function searchStudents(list, normalizedQuery) {
  return list
    .filter(s => matchesQuery(s.name, normalizedQuery))
    .sort((a, b) => {
      const r = matchRank(a.name, normalizedQuery) - matchRank(b.name, normalizedQuery);
      return r !== 0 ? r : a.name.localeCompare(b.name, 'ar');
    });
}

// ===== مطابقة متسامحة (fuzzy) للبحث الصوتي =====
// بتتحمل فرق حرف أو اتنين بين الكلمتين، عشان تعويض غلطة التعرف على الصوت في أسماء متشابهة
function levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (!al) return bl;
  if (!bl) return al;
  let prev = Array.from({ length: bl + 1 }, (_, i) => i);
  for (let i = 1; i <= al; i++) {
    const curr = [i];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[bl];
}

function wordsFuzzyMatch(nameWord, queryWord) {
  if (!nameWord || !queryWord) return false;
  if (nameWord.startsWith(queryWord) || queryWord.startsWith(nameWord)) return true;
  const maxLen = Math.max(nameWord.length, queryWord.length);
  const threshold = maxLen <= 3 ? 1 : (maxLen <= 6 ? 2 : 3);
  return levenshtein(nameWord, queryWord) <= threshold;
}

function matchesQueryFuzzy(name, normalizedQuery) {
  if (!normalizedQuery) return true;
  const nameWords  = normalizeArabic(name).split(' ').filter(Boolean);
  const queryWords = normalizedQuery.split(' ').filter(Boolean);
  return queryWords.every(qw => nameWords.some(w => wordsFuzzyMatch(w, qw)));
}

function searchStudentsFuzzy(list, normalizedQuery) {
  return list
    .filter(s => matchesQueryFuzzy(s.name, normalizedQuery))
    .sort((a, b) => {
      // الأقرب حرفيًا (أقل فروق) يطلع فوق
      const nameWordsA = normalizeArabic(a.name).split(' ').filter(Boolean);
      const nameWordsB = normalizeArabic(b.name).split(' ').filter(Boolean);
      const queryWords = normalizedQuery.split(' ').filter(Boolean);
      const scoreOf = (nameWords) => queryWords.reduce((sum, qw) => {
        const best = Math.min(...nameWords.map(w => levenshtein(w, qw)));
        return sum + best;
      }, 0);
      const r = scoreOf(nameWordsA) - scoreOf(nameWordsB);
      return r !== 0 ? r : a.name.localeCompare(b.name, 'ar');
    });
}

// كلمات بيقولها الناس عادةً قبل الاسم وهما بيسجلوا بالصوت، مش جزء من الاسم فبنشيلها قبل المطابقة
const VOICE_FILLER_WORDS = new Set([
  'سجل', 'سجلي', 'سجّل', 'حضور', 'خد', 'خدي', 'يلا', 'دلوقتي', 'كده', 'بقي', 'بقى',
  'احضر', 'حاضر', 'قول', 'اسم', 'المخدوم', 'مخدوم', 'من', 'فضلك', 'لو', 'سمحت',
  'عايز', 'عايزه', 'اكتب', 'يا', 'استاذ', 'الاستاذ', 'خادم'
]);

export function stripVoiceFillers(normalizedQuery) {
  const words = normalizedQuery.split(' ').filter(Boolean).filter(w => !VOICE_FILLER_WORDS.has(w));
  return words.length ? words.join(' ') : normalizedQuery; // لو مسحنا كل الكلام نرجع للأصل بدل ما نفضيه
}

// ===== مطابقة صوتية بالتقييم (scoring) بدل الفلترة الجامدة =====
// بدل ما نشترط إن كل كلمة تتطابق (ولو بفرق حرف) عشان الاسم يدخل القائمة، بنّدي كل اسم "درجة تشابه"
// من 0 لـ 1، وبعدين بنرجّع بس اللي فعلاً قريبين من أعلى درجة. ده بيمنع ظهور أسماء بعيدة شبهت بالصدفة.
function voiceWordScore(nameWord, queryWord) {
  if (!nameWord || !queryWord) return 0;
  if (nameWord === queryWord) return 1;
  if (nameWord.startsWith(queryWord) || queryWord.startsWith(nameWord)) {
    const shorter = Math.min(nameWord.length, queryWord.length);
    const longer  = Math.max(nameWord.length, queryWord.length);
    return 0.75 + 0.2 * (shorter / longer); // بادئة مشتركة قصيرة (زي حرف واحد) تاخد بونص أقل من بادئة طويلة
  }
  const dist = levenshtein(nameWord, queryWord);
  const maxLen = Math.max(nameWord.length, queryWord.length);
  const sim = 1 - dist / maxLen;
  // الكلمات القصيرة (3 حروف وأقل) بتدّي مطابقات غلط كتير بفرق حرف واحد بس، فبنشدد عليها أكتر
  const minSim = maxLen <= 3 ? 0.75 : (maxLen <= 5 ? 0.65 : 0.55);
  return sim >= minSim ? sim : 0;
}

function voiceNameScore(nameWords, queryWords) {
  let total = 0;
  for (const qw of queryWords) {
    let best = 0;
    for (const nw of nameWords) best = Math.max(best, voiceWordScore(nw, qw));
    if (best === 0) return 0; // أي كلمة اتقالت ومالقتش شبه كفاية في الاسم = الاسم ده مش مرشح خالص
    total += best;
  }
  return total / queryWords.length;
}

function searchStudentsVoice(list, normalizedQuery) {
  return scoreStudentsVoice(list, normalizedQuery).map(x => x.s);
}

// نسخة خام بترجع كل مرشح مع درجته، من غير قص للأقرب من القمة — عشان نقدر ندمج نتايج
// كذا بديل صوتي (alternatives) مع بعض ونختار الأفضل من بينهم كلهم مش بس أول بديل جه له نتيجة
export function scoreStudentsVoice(list, normalizedQuery) {
  const queryWords = normalizedQuery.split(' ').filter(Boolean);
  if (!queryWords.length) return [];
  return list
    .map(s => ({ s, score: voiceNameScore(normalizeArabic(s.name).split(' ').filter(Boolean), queryWords) }))
    .filter(x => x.score >= 0.62); // عتبة جودة: تحتها بنعتبر الاسم مش مرشح مناسب أصلاً
}
