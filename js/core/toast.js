// رسائل التنبيه (Toast)

// ===== TOAST =====
let toastTimer;

window.showToast = (msg, type='info') => {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.className = '', 2800);
};
