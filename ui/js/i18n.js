// UI language. Turkish strings are the keys; other languages map them (missing = Turkish).
// The choice is read synchronously (localStorage) because module-level labels are built at
// import time, before the saved config arrives; changing it reloads the UI.
import EN from './lang/en.js';

const PACKS = { en: EN };
const pick = () => {
  let v = 'auto';
  try { v = localStorage.getItem('sd-lang') || 'auto'; } catch {}
  if (v === 'auto') v = (navigator.language || 'tr').toLowerCase().startsWith('tr') ? 'tr' : 'en';
  return PACKS[v] || v === 'tr' ? v : 'tr';
};
export const LANG = pick();
export const LOCALE = LANG === 'tr' ? 'tr-TR' : 'en-US';
document.documentElement.lang = LANG;
const dict = PACKS[LANG] || null;

/** Translate a UI string; unknown strings come back unchanged. */
export const $t = (s) => (dict && Object.hasOwn(dict, s) ? dict[s] : s);

export function langSetting() {
  try { return localStorage.getItem('sd-lang') || 'auto'; } catch { return 'auto'; }
}
export function setLang(v) {
  try { localStorage.setItem('sd-lang', v); } catch {}
  location.reload();
}
