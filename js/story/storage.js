// Best score, saved in localStorage when available. Every access is guarded.
const KEY = 'satlauncher.best';

export function getBest() {
  try {
    const n = parseInt(localStorage.getItem(KEY), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (e) {
    return 0;
  }
}

export function setBest(n) {
  try {
    localStorage.setItem(KEY, String(n));
  } catch (e) {
    /* storage blocked: the best score just lasts for this visit */
  }
}
