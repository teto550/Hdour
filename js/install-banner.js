// بانر تثبيت التطبيق (PWA install)
let deferredPrompt;
function checkShowBanner() {
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
    document.getElementById('install-banner').style.display = 'none';
    return;
  }
  setTimeout(() => {
    if (!window.matchMedia('(display-mode: standalone)').matches)
      document.getElementById('install-banner').style.display = 'block';
  }, 1000);
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; checkShowBanner(); });
document.getElementById('install-btn').addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    document.getElementById('install-banner').style.display = 'none';
  } else {
    alert('لتثبيت التطبيق:\n1. اضغط ⋮ (النقط التلاتة)\n2. اختر "Add to Home screen"');
  }
});
window.addEventListener('appinstalled', () => { document.getElementById('install-banner').style.display = 'none'; });
checkShowBanner();
