// وميض نيون لحظة اللمس على الكروت والتابات
document.addEventListener('pointerdown', e => {
  const el = e.target.closest && e.target.closest('.admin-card,.tab,.class-tab,.filter-chip');
  if (!el) return;
  el.classList.add('neon-press');
  setTimeout(() => el.classList.remove('neon-press'), 450);
}, { passive: true });
