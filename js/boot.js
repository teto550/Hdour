// نقطة الدخول: بيحمّل ملفات الواجهة (views/*.html) ويحطها مكان كل عنصر فيه data-include،
// وبعدها يشغّل التطبيق (js/main.js). الصفحة نفسها (index.html) مجرد هيكل.

function showBootError(msg) {
  const splash = document.getElementById('splash-screen');
  if (!splash) return;
  const p = document.createElement('div');
  p.style.cssText = 'margin-top:18px;padding:0 24px;text-align:center;color:#e8eaf0;font:600 14px Cairo,sans-serif;line-height:1.7';
  p.textContent = msg;
  splash.appendChild(p);
}

async function loadViews() {
  const slots = [...document.querySelectorAll('[data-include]')];
  const htmls = await Promise.all(slots.map(async slot => {
    const url = slot.getAttribute('data-include');
    const res = await fetch(url);
    if (!res.ok) throw new Error('تعذر تحميل ' + url + ' (' + res.status + ')');
    return res.text();
  }));
  // نحط كل ملف مكان العنصر بالظبط (من غير أي div زيادة) وبنفس الترتيب
  slots.forEach((slot, i) => {
    slot.insertAdjacentHTML('afterend', htmls[i]);
    slot.remove();
  });
}

try {
  await loadViews();
  await import('./main.js');
} catch (err) {
  console.error('[boot]', err);
  showBootError('تعذر تحميل التطبيق. تأكد من الاتصال بالإنترنت وجرّب تحدّث الصفحة.');
}
