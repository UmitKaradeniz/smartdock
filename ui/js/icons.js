// One icon family: 24px grid, 1.75 stroke, round joins. No emoji, no stock packs.
import { $t } from './i18n.js';
const P = {
  sun: '<path d="M12 4.5v3M5.2 9.2 7 11M18.8 9.2 17 11M7 17a5 5 0 0 1 10 0M3 17h18M7.5 20.5h9"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 3.5V9H14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  spark: '<path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5Z"/><path d="M19 15.5c.2 1.4.9 2.1 2.3 2.3-1.4.2-2.1.9-2.3 2.3-.2-1.4-.9-2.1-2.3-2.3 1.4-.2 2.1-.9 2.3-2.3Z"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.5 12.3a9.5 9.5 0 0 1 13 0"/><path d="M8.6 15.6a5 5 0 0 1 6.8 0"/><circle cx="12" cy="19" r=".9" fill="currentColor"/>',
  bt: '<path d="m7 7 10 10-5 4V3l5 4L7 17"/>',
  hotspot: '<circle cx="12" cy="12" r="1.6"/><path d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>',
  vol: '<path d="M4 9.5h3l4.5-4v13L7 14.5H4z"/><path d="M15 9a4 4 0 0 1 0 6M17.8 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3l4.5-4v13L7 14.5H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  pause: '<rect x="6.5" y="5.5" width="3.6" height="13" rx="1" fill="currentColor"/><rect x="13.9" y="5.5" width="3.6" height="13" rx="1" fill="currentColor"/>',
  next: '<path d="M6 6v12l8.5-6z" fill="currentColor"/><path d="M17.5 6v12"/>',
  prev: '<path d="M18 6v12l-8.5-6z" fill="currentColor"/><path d="M6.5 6v12"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  ram: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 10.5v3M11 10.5v3M15 10.5v3M6 17v2M18 17v2"/>',
  net: '<path d="M8 4v15M4.5 15.5 8 19l3.5-3.5M16 20V5M12.5 8.5 16 5l3.5 3.5"/>',
  disk: '<ellipse cx="12" cy="6.5" rx="7.5" ry="3"/><path d="M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
  battery: '<rect x="2.5" y="7" width="17" height="10" rx="2.5"/><path d="M22 10.5v3"/>',
  bolt: '<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z"/>',
  trash: '<path d="M4 7h16M10 3.5h4M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5M9.5 2.5h5M18.5 6.5l1.5-1.5"/>',
  stopwatch: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5l3-3M12 2.5v3M9.5 2.5h5"/>',
  focus: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  todo: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m8 12 2.8 2.8L16.5 9"/>',
  note: '<path d="M5 3.5h10l4 4v13H5z"/><path d="M14.5 3.5v4.5H19M8.5 12.5h7M8.5 16h5"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.5-.9-1.6-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2.1 0 3 5.8 1.5 5.8 4.3 0 1.3-1.3 2.2-3 2.2-1.3 0-2.4-.6-2.9-1.5M12 6v1.8M12 16.2V18"/>',
  fx: '<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5S9.7 5.9 12 3.5Z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  chevu: '<path d="m6 14.5 6-6 6 6"/>',
  plane: '<path d="M10.5 4.5c0-1 .7-1.8 1.5-1.8s1.5.8 1.5 1.8v5l7 4v2l-7-2v4.2l2.2 1.8v1.6L12 20.2l-3.2.9v-1.6l2.2-1.8v-4.2l-7 2v-2l7-4z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  cam: '<rect x="3" y="7" width="13" height="10.5" rx="2.5"/><path d="m16 11 5-3v8.5l-5-3"/>',
  cup: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8.5 3.5c-.6 1 .6 1.6 0 2.8M12 3.5c-.6 1 .6 1.6 0 2.8"/>',
  therm: '<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 9v7"/>',
  chevr: '<path d="m9.5 6 6 6-6 6"/>',
  chev: '<path d="m9.5 6 6 6-6 6"/>',
  chevl: '<path d="m14.5 6-6 6 6 6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  file: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M13.5 3.5V8H18"/>',
  math: '<rect x="4" y="3.5" width="16" height="17" rx="3"/><path d="M8 8h8M8 12.5h2M14 12.5h2M8 16.5h2M14 16.5h2"/>',
  web: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M4.5 11h13M11 4.5c1.6 1.8 2.4 4 2.4 6.5s-.8 4.7-2.4 6.5"/>',
  github: '<path d="M9 19c-4 1.3-4-2-5.5-2.5M14.5 21v-3.4c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.7 11.7 0 0 0-6.2 0C6.1 3 5.1 3.2 5.1 3.2a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 3.7 9.6c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  power: '<path d="M12 3.5v8M7 6.5a7.5 7.5 0 1 0 10 0"/>',
  pin: '<path d="M9 3.5h6l-1 6 3.5 3.5h-11L10 9.5zM12 13v7.5"/>',
  window: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9h17"/>',
  external: '<path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  sunrise: '<path d="M4 18h16M7 14.5a5 5 0 0 1 10 0M12 4v4M9.5 6.5 12 4l2.5 2.5M4.5 10.5l1.5 1M19.5 10.5l-1.5 1"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  layers: '<path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z"/><path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5"/>',
  drag: '<circle cx="9" cy="7" r="1.2" fill="currentColor"/><circle cx="15" cy="7" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="17" r="1.2" fill="currentColor"/><circle cx="15" cy="17" r="1.2" fill="currentColor"/>',
  chart: '<path d="M4 20V4M4 20h16M8 16l3.5-4.5 3 2.5L20 7"/>',
  zone: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2M3.5 12H6M18 12h2.5"/>',
  task: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M7 15l3-3.5 2.5 2 4.5-5"/>',
};

// h() inserts a child string as HTML only if icon() made it: window titles, file or calendar
// names that merely look like "<svg…" stay text.
const made = new Set();
export const isIcon = (s) => made.has(s);
export function icon(name, size = 18, extra = '') {
  const svg = `<svg class="ic ${extra}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.spark}</svg>`;
  made.add(svg);
  return svg;
}

export const START_ICON = `<svg viewBox="0 0 24 24" width="100%" height="100%"><defs><linearGradient id="stg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8f0ff"/><stop offset="1" stop-color="#b9c8e6"/></linearGradient></defs><rect x="2.5" y="2.5" width="9" height="9" rx="1.6" fill="url(#stg)"/><rect x="12.5" y="2.5" width="9" height="9" rx="1.6" fill="url(#stg)"/><rect x="2.5" y="12.5" width="9" height="9" rx="1.6" fill="url(#stg)"/><rect x="12.5" y="12.5" width="9" height="9" rx="1.6" fill="url(#stg)"/></svg>`;

// ---------- weather: WMO code -> kind ----------
export function wxKind(code, day = true) {
  if (code === 0) return day ? 'sun' : 'moon';
  if (code <= 2) return day ? 'partly' : 'partlyn';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloud';
}
export const WX_TEXT = { sun: $t('Açık'), moon: $t('Açık'), partly: $t('Parçalı bulutlu'), partlyn: $t('Parçalı bulutlu'), cloud: $t('Bulutlu'), fog: $t('Sisli'), rain: $t('Yağmurlu'), snow: $t('Karlı'), storm: $t('Fırtınalı') };

const SUN = '<circle cx="15" cy="13" r="6.2" fill="url(#wsun)"/><g stroke="#ffcf4a" stroke-width="1.8" stroke-linecap="round"><path d="M15 2.6v2.2M15 21.2v2.2M4.6 13h2.2M23.2 13h2.2M7.6 5.6l1.6 1.6M20.8 18.8l1.6 1.6M7.6 20.4l1.6-1.6M20.8 7.2l1.6-1.6"/></g>';
const MOON = '<path d="M19.5 17.8A8 8 0 0 1 12.2 5a8 8 0 1 0 7.3 12.8Z" fill="url(#wmoon)"/>';
const CLOUD = (x = 0, y = 0, o = 1) => `<path transform="translate(${x} ${y})" d="M9 25h14.5a5.5 5.5 0 0 0 .6-11 7.5 7.5 0 0 0-14.3 1.8A4.6 4.6 0 0 0 9 25Z" fill="url(#wcloud)" opacity="${o}"/>`;
const DEFS = '<defs><radialGradient id="wsun" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#fff3a8"/><stop offset=".55" stop-color="#ffc533"/><stop offset="1" stop-color="#ff9d1a"/></radialGradient><linearGradient id="wcloud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfdcf0"/></linearGradient><linearGradient id="wmoon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff7d6"/><stop offset="1" stop-color="#e8c66a"/></linearGradient></defs>';
const WX = {
  sun: SUN,
  moon: MOON,
  partly: SUN + CLOUD(-2, 2),
  partlyn: '<g transform="translate(4 -1)">' + MOON + '</g>' + CLOUD(-2, 2),
  cloud: CLOUD(-3, -4, 0.75) + CLOUD(0, 1),
  fog: CLOUD(0, -3) + '<g stroke="#cfdcf0" stroke-width="1.8" stroke-linecap="round"><path d="M6 25.5h18M9 28h13"/></g>',
  rain: CLOUD(0, -3) + '<g stroke="#6cb7ff" stroke-width="2" stroke-linecap="round"><path d="m11 24.5-1.2 3M16 24.5l-1.2 3M21 24.5l-1.2 3"/></g>',
  snow: CLOUD(0, -3) + '<g fill="#e9f3ff"><circle cx="11" cy="26" r="1.3"/><circle cx="16" cy="27.5" r="1.3"/><circle cx="21" cy="26" r="1.3"/></g>',
  storm: CLOUD(0, -3) + '<path d="m16.5 22-3 4.5h3l-1.5 4 4.5-5.5h-3l1.5-3z" fill="#ffd23f"/>',
};
export function wxIcon(kind, size = 28) {
  return `<svg class="wx" width="${size}" height="${size}" viewBox="0 0 30 30" aria-hidden="true">${DEFS}${WX[kind] || WX.cloud}</svg>`;
}

// Brand-neutral marks for AI usage tiles (simple geometric, not logos).
export const MARK = {
  claude: '<svg viewBox="0 0 24 24" width="100%" height="100%"><rect width="24" height="24" rx="6" fill="#d97757"/><g stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14M7 7l10 10M17 7 7 17"/></g></svg>',
  codex: '<svg viewBox="0 0 24 24" width="100%" height="100%"><rect width="24" height="24" rx="6" fill="#f4f4f5"/><g fill="none" stroke="#111" stroke-width="1.8"><circle cx="12" cy="12" r="5.5"/><path d="M12 6.5v11M7.2 9.2l9.6 5.6M16.8 9.2l-9.6 5.6"/></g></svg>',
  antigravity: '<svg viewBox="0 0 24 24" width="100%" height="100%"><rect width="24" height="24" rx="6" fill="#1f2a44"/><path d="M6 17.5 12 6l6 11.5" fill="none" stroke="#7aa7ff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="14.5" r="1.8" fill="#fff"/></svg>',
};
