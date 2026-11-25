// Update notice: asks GitHub (public API, no account) whether a newer release exists.
// Nothing is downloaded or installed by itself; the user opens the release page.
import { invoke, cfg, bus, toast } from './core.js';
import { $t } from './i18n.js';

export const REPO = 'UmitKaradeniz/smartdock';
export const update = { current: '', latest: null }; // latest: { tag, url } when newer

const parse = (v) => String(v).replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
const newer = (a, b) => { // a > b
  const x = parse(a), y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

async function check(manual = false) {
  if (!cfg.updateCheck && !manual) return;
  try {
    update.current ||= await window.__TAURI__.app.getVersion();
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    const had = update.latest?.tag;
    update.latest = j.tag_name && newer(j.tag_name, update.current) ? { tag: j.tag_name, url: j.html_url } : null;
    bus.emit('update', update.latest);
    if (update.latest && update.latest.tag !== had) toast(`${$t('Yeni sürüm')}: ${update.latest.tag} · ${$t('Ayarlar › Hakkında')}`);
    else if (manual && !update.latest) toast(`${$t('Güncelsin (v')}${update.current})`);
  } catch (e) {
    if (manual) toast($t('Güncelleme denetlenemedi'), 'err');
  }
}
export const checkUpdate = () => check(true);
export const openUpdate = () => update.latest && invoke('open_url', { url: update.latest.url });

export function initUpdate() {
  setTimeout(check, 15000); // after start-up settles
  setInterval(check, 6 * 3600e3);
}
