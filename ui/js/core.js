// Core: native bridge, event bus, persistent config, ref-counted data services.
import { $t } from './i18n.js';
const T = window.__TAURI__;
export const invoke = (cmd, args) => T.core.invoke(cmd, args);
export const listen = (evt, fn) => T.event.listen(evt, (e) => fn(e.payload));
export const SD = 'http://sd.localhost';
export const iconUrl = (id, s = 64) => `${SD}/icon?id=${encodeURIComponent(id)}&s=${s}`;
export const thumbUrl = (p, s = 256) => `${SD}/thumb?id=${encodeURIComponent(p)}&s=${s}`;

// ---------- bus: logic announces, UI subscribes and unsubscribes ----------
const subs = new Map();
export const bus = {
  on(evt, fn) {
    if (!subs.has(evt)) subs.set(evt, new Set());
    subs.get(evt).add(fn);
    return () => subs.get(evt)?.delete(fn);
  },
  emit(evt, data) {
    subs.get(evt)?.forEach((fn) => {
      try { fn(data); } catch (e) { console.error(evt, e); }
    });
  },
};

// ---------- config ----------
export const DEFAULTS = {
  v: 1,
  theme: 'midnight',
  accent: '#4f8cff',
  size: 'M',
  radius: 50,
  position: 'bottom',
  clock24: true,
  seconds: true,
  hideTaskbar: true,
  reserve: true,
  autoHide: 'off', // IntelliHide: off | smart (hide while a window covers the dock) | always
  magnify: true,
  magSpeed: 'normal',
  toggles: ['wifi', 'bt', 'vol', 'hs'], // Hızlı Ayarlar buttons, in order
  peek: true, // show-desktop sliver in the screen corner
  autostart: false,
  sounds: false,
  liveGlass: false,
  updateCheck: true, // ask GitHub for a newer release now and then
  ai: true,
  monitor: null,
  city: null,
  items: ['search', 'apps', 'clock', 'claude', 'weather', 'toggles', 'screentime', 'nowplaying'],
  pinned: [],
  runOrder: [], // running (unpinned) apps keep their slot, by group key
  bar: false, // taskbar style: full width, flush with the screen edge
  wsize: {}, // per-widget size: S | M | L | XL
  wtune: {}, // per-widget fine size: { z: scale %, w: width px }
  seen: {}, // app key -> last time it was in front (unread badges count what came after)
  notifBase: 0,
  todos: [],
  notes: '',
  events: [],
  ics: [],
  asks: [],
  ghUser: '',
  fx: { from: 'USD', to: 'TRY' },
  crypto: ['bitcoin', 'ethereum'],
  zones: ['Europe/Istanbul', 'America/New_York', 'Asia/Tokyo'],
  pomodoro: { focus: 25, rest: 5 },
};
export const cfg = structuredClone(DEFAULTS);
let saveT = 0, loaded = false, dirty = false;
export async function loadConfig() {
  for (let i = 0; i < 5 && !loaded; i++) {
    try {
      const t = await invoke('load_config');
      if (t) Object.assign(cfg, JSON.parse(t));
      loaded = true;
    } catch (e) { console.warn('config', e); await new Promise((r) => setTimeout(r, 300)); }
  }
  for (const k in DEFAULTS) if (cfg[k] === undefined) cfg[k] = structuredClone(DEFAULTS[k]);
}
function writeNow() {
  clearTimeout(saveT);
  // never overwrite the user's file with defaults when it could not be read
  if (!loaded || !dirty) return;
  dirty = false;
  invoke('save_config', { text: JSON.stringify(cfg) }).catch((e) => { dirty = true; console.warn('save', e); });
}
export function save() {
  dirty = true;
  clearTimeout(saveT);
  saveT = setTimeout(writeNow, 150);
}
/** Write pending changes immediately (shutdown, reload). */
export const flush = writeNow;
addEventListener('pagehide', writeNow);
T.event.listen('flush', writeNow);
/** Change a setting: persists and announces `cfg:<key>` plus `cfg`. */
export function set(key, val) {
  cfg[key] = val;
  save();
  bus.emit('cfg:' + key, val);
  bus.emit('cfg', key);
}

// ---------- services: polled only while someone is subscribed ----------
const services = new Map();
export function defineService(name, fetcher, every) {
  services.set(name, { fetcher, every, subs: new Set(), timer: 0, last: undefined, busy: false });
}
async function runService(s) {
  if (s.busy) return;
  s.busy = true;
  try {
    s.last = await s.fetcher(s.last);
    s.subs.forEach((fn) => fn(s.last));
  } catch (e) {
    s.subs.forEach((fn) => fn(s.last, e));
  }
  s.busy = false;
}
export function use(name, fn) {
  const s = services.get(name);
  s.subs.add(fn);
  if (s.last !== undefined) fn(s.last);
  if (s.subs.size === 1) {
    runService(s);
    if (s.every) s.timer = setInterval(() => runService(s), s.every);
  }
  return () => {
    s.subs.delete(fn);
    if (!s.subs.size) clearInterval(s.timer);
  };
}
export function refresh(name) {
  const s = services.get(name);
  if (s) runService(s);
}
/** Feed a pushed value (native event) into a service. */
export function push(name, val) {
  const s = services.get(name);
  s.last = val;
  s.subs.forEach((fn) => fn(val));
}
export function peek(name) {
  return services.get(name)?.last;
}

// one shared, second-aligned clock
const tickers = new Set();
let tickT = 0;
function tick() {
  const d = new Date();
  tickers.forEach((fn) => fn(d));
  tickT = setTimeout(tick, 1000 - d.getMilliseconds() + 2);
}
export function onTick(fn) {
  tickers.add(fn);
  fn(new Date());
  if (tickers.size === 1) tick();
  return () => {
    tickers.delete(fn);
    if (!tickers.size) clearTimeout(tickT);
  };
}

// ---------- helpers ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    if (c.nodeType) el.append(c);
    else if (typeof c === 'string' && c.startsWith('<svg')) el.insertAdjacentHTML('beforeend', c); // icon() markup
    else el.append(document.createTextNode(c));
  }
  return el;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const pad2 = (n) => String(n).padStart(2, '0');
export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60);
  return hh ? `${hh} ${$t('sa')} ${mm} ${$t('dk')}` : `${mm} ${$t('dk')}`;
}
export function fmtBytes(b) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b < 10 && i ? b.toFixed(1) : Math.round(b)} ${u[i]}`;
}
export function timeStr(d, secs = false) {
  let hh = d.getHours();
  const m = pad2(d.getMinutes());
  if (cfg.clock24) return { main: `${pad2(hh)}:${m}`, sec: secs ? pad2(d.getSeconds()) : '', ampm: '' };
  const ampm = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12 || 12;
  return { main: `${hh}:${m}`, sec: secs ? pad2(d.getSeconds()) : '', ampm };
}
export const DAYS = [$t('Paz'), $t('Pzt'), $t('Sal'), $t('Çar'), $t('Per'), $t('Cum'), $t('Cmt')];
export const MONTHS = [$t('Ocak'), $t('Şubat'), $t('Mart'), $t('Nisan'), $t('Mayıs'), $t('Haziran'), $t('Temmuz'), $t('Ağustos'), $t('Eylül'), $t('Ekim'), $t('Kasım'), $t('Aralık')];
export const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// ---------- feedback: tiny synthesized tick (optional) ----------
let ac;
export function blip(kind = 'tap') {
  if (!cfg.sounds) return;
  try {
    ac ||= new AudioContext();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine';
    o.frequency.value = kind === 'ok' ? 880 : kind === 'err' ? 220 : 520;
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.05, ac.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.09);
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + 0.1);
  } catch {}
}

export function toast(text, kind = 'ok') {
  bus.emit('toast', { text, kind });
}
