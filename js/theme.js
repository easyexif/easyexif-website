/* Applies a saved light/dark choice before the page paints, so there is no flash. */
(() => {
  try { const t = localStorage.getItem('easyexif-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) { /* storage blocked: follow the system setting */ }
})();
