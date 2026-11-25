// Smart Search: apps, files, math, conversions, time zones, widgets, and
// "tell the dock" commands in any language (local parser first, free AI second).
import { invoke, iconUrl, thumbUrl, SD, cfg, set, h, esc, pad2, blip, toast, peek, refresh, DAYS, MONTHS, bus } from './core.js';
import { icon, wxIcon, wxKind, WX_TEXT } from './icons.js';
import { openPanel, closePanel } from './panels.js';
import { apps, launchApp } from './apps.js';
import { rates, geocode, timerStart, addEvent } from './data.js';
import { $t, LOCALE, LANG } from './i18n.js';

let W = null; // widget registry, injected to avoid a cycle
export const setWidgets = (w) => (W = w);

// ---------- language badge ----------
function langOf(q) {
  if (/[\u0400-\u04FF]/.test(q)) return 'RU';
  if (/[\u0600-\u06FF]/.test(q)) return 'AR';
  if (/[\u3040-\u30ff]/.test(q)) return 'JA';
  if (/[\u4e00-\u9fff]/.test(q)) return 'ZH';
  if (/[\uac00-\ud7af]/.test(q)) return 'KO';
  if (/[ğışİ]|\b(ve|bir|yap|aç|kapat|saat|kaç|ses)\b/i.test(q)) return 'TR';
  if (/[ãõ]|\b(cantos|arredondados|fazer|deixa)\b/i.test(q)) return 'PT';
  if (/[ñ¿¡]|\b(hacer|poner|esquinas)\b/i.test(q)) return 'ES';
  if (/[äß]|\b(mach|ecken|lauter)\b/i.test(q)) return 'DE';
  if (/\b(fais|mettre|coins)\b/i.test(q)) return 'FR';
  if (/\b(soat|qil|yoq)\b/i.test(q)) return 'UZ';
  return 'EN';
}

// ---------- math ----------
function calc(q) {
  let s = q.replace(/×/g, '*').replace(/÷/g, '/').replace(/\s+/g, '');
  if (!/\d/.test(s) || !/[+\-*/^%()]/.test(s.replace(/^-/, ''))) return null;
  if (!s.includes('.') ) s = s.replace(/,/g, '.');
  if (!/^[\d.+\-*/^%()episqrt]+$/i.test(s)) return null;
  s = s.replace(/\^/g, '**').replace(/(\d+(?:\.\d+)?)%/g, '($1/100)').replace(/sqrt/gi, 'Math.sqrt').replace(/\bpi\b/gi, 'Math.PI');
  try {
    const v = Function(`"use strict";return (${s})`)();
    if (typeof v !== 'number' || !isFinite(v)) return null;
    return +v.toPrecision(12);
  } catch { return null; }
}

// ---------- conversions ----------
const CUR = { usd: 'USD', dolar: 'USD', dollar: 'USD', dollars: 'USD', $: 'USD', eur: 'EUR', euro: 'EUR', avro: 'EUR', '€': 'EUR', tl: 'TRY', try: 'TRY', lira: 'TRY', '₺': 'TRY', gbp: 'GBP', sterlin: 'GBP', pound: 'GBP', '£': 'GBP', jpy: 'JPY', yen: 'JPY', chf: 'CHF', frank: 'CHF', cad: 'CAD', aud: 'AUD', cny: 'CNY', yuan: 'CNY', rub: 'RUB', ruble: 'RUB', ruble: 'RUB', inr: 'INR', rupee: 'INR', brl: 'BRL', real: 'BRL', uzs: 'UZS', som: 'UZS', sar: 'SAR', aed: 'AED', krw: 'KRW', won: 'KRW', sek: 'SEK', nok: 'NOK', pln: 'PLN', mxn: 'MXN' };
const UNITS = {
  km: ['len', 1000], m: ['len', 1], metre: ['len', 1], meter: ['len', 1], cm: ['len', 0.01], mm: ['len', 0.001], mi: ['len', 1609.344], mile: ['len', 1609.344], miles: ['len', 1609.344], mil: ['len', 1609.344], ft: ['len', 0.3048], feet: ['len', 0.3048], foot: ['len', 0.3048], in: ['len', 0.0254], inch: ['len', 0.0254], inç: ['len', 0.0254], yd: ['len', 0.9144],
  kg: ['mass', 1], g: ['mass', 0.001], gram: ['mass', 0.001], lb: ['mass', 0.45359237], lbs: ['mass', 0.45359237], pound: ['mass', 0.45359237], oz: ['mass', 0.0283495], ton: ['mass', 1000],
  l: ['vol', 1], lt: ['vol', 1], litre: ['vol', 1], liter: ['vol', 1], ml: ['vol', 0.001], gal: ['vol', 3.78541], gallon: ['vol', 3.78541],
  kmh: ['spd', 1], 'km/h': ['spd', 1], mph: ['spd', 1.609344], ms: ['spd', 3.6], 'm/s': ['spd', 3.6],
  kb: ['data', 1e3], mb: ['data', 1e6], gb: ['data', 1e9], tb: ['data', 1e12],
  c: ['temp'], '°c': ['temp'], f: ['temp'], '°f': ['temp'], k: ['temp'],
};
const toC = (v, u) => (u.includes('f') ? ((v - 32) * 5) / 9 : u === 'k' ? v - 273.15 : v);
const fromC = (v, u) => (u.includes('f') ? (v * 9) / 5 + 32 : u === 'k' ? v + 273.15 : v);
async function convert(q) {
  const m = /^([\d.,]+)\s*([a-zа-я$€£₺°/]+)\s*(?:to|in|into|=|->|→|kaç|ne kadar|eder|to\s)?\s*([a-z$€£₺°/]+)?\s*(?:kaç|eder|ne kadar)?\??$/i.exec(q.trim().toLowerCase());
  if (!m) return null;
  const v = parseFloat(m[1].replace(',', '.'));
  let [a, b] = [m[2], m[3] || ''];
  if (CUR[a]) {
    const A = CUR[a], B = CUR[b] || (A === 'TRY' ? 'USD' : 'TRY');
    const r = await rates(A);
    const x = r.rates[B];
    if (!x) return null;
    const out = v * x;
    return { a: `${out.toLocaleString(LOCALE, { maximumFractionDigits: out < 1 ? 6 : 2 })} ${B}`, q: `${v} ${A} = · 1 ${A} = ${x.toLocaleString(LOCALE, { maximumFractionDigits: 4 })} ${B}`, copy: out.toFixed(2) };
  }
  const ua = UNITS[a], ub = UNITS[b];
  if (!ua) return null;
  if (ua[0] === 'temp') {
    const tgt = ub?.[0] === 'temp' ? b : a.includes('c') ? 'f' : 'c';
    const out = fromC(toC(v, a), tgt);
    return { a: `${+out.toFixed(2)} °${tgt.replace('°', '').toUpperCase()}`, q: `${v} °${a.replace('°', '').toUpperCase()}`, copy: String(+out.toFixed(2)) };
  }
  if (!ub || ub[0] !== ua[0]) return null;
  const out = (v * ua[1]) / ub[1];
  return { a: `${+out.toPrecision(8)} ${b}`, q: `${v} ${a}`, copy: String(+out.toPrecision(8)) };
}

// ---------- time zones ----------
const CITY_TZ = { istanbul: 'Europe/Istanbul', ankara: 'Europe/Istanbul', izmir: 'Europe/Istanbul', london: 'Europe/London', londra: 'Europe/London', paris: 'Europe/Paris', berlin: 'Europe/Berlin', moscow: 'Europe/Moscow', moskova: 'Europe/Moscow', tokyo: 'Asia/Tokyo', seoul: 'Asia/Seoul', seul: 'Asia/Seoul', beijing: 'Asia/Shanghai', pekin: 'Asia/Shanghai', shanghai: 'Asia/Shanghai', dubai: 'Asia/Dubai', delhi: 'Asia/Kolkata', mumbai: 'Asia/Kolkata', singapore: 'Asia/Singapore', sydney: 'Australia/Sydney', 'new york': 'America/New_York', nyc: 'America/New_York', 'los angeles': 'America/Los_Angeles', la: 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles', sf: 'America/Los_Angeles', chicago: 'America/Chicago', toronto: 'America/Toronto', 'sao paulo': 'America/Sao_Paulo', 'são paulo': 'America/Sao_Paulo', tashkent: 'Asia/Tashkent', taşkent: 'Asia/Tashkent', baku: 'Asia/Baku', bakü: 'Asia/Baku', amsterdam: 'Europe/Amsterdam', madrid: 'Europe/Madrid', rome: 'Europe/Rome', roma: 'Europe/Rome' };
async function zone(q) {
  const m = /^(?:time in|what time is it in|saat kaç|saat)\s+(.+?)\??$/i.exec(q) || /^(.+?)(?:'?(?:da|de|ta|te))?\s+(?:saat(?:i)?(?: kaç)?|time)\??$/i.exec(q);
  if (!m) return null;
  const c = m[1].toLowerCase().trim();
  let tz = CITY_TZ[c], name = m[1].trim();
  if (!tz) {
    const g = (await geocode(c).catch(() => []))[0];
    if (!g?.tz) return null;
    tz = g.tz; name = g.name;
  }
  const d = new Date();
  const t = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: !cfg.clock24, timeZone: tz }).format(d);
  const there = new Date(d.toLocaleString('en-US', { timeZone: tz }));
  const diff = Math.round((there - new Date(d.toLocaleString('en-US'))) / 36e5);
  return { a: t, q: `${name[0].toUpperCase() + name.slice(1)} · ${DAYS[there.getDay()]} ${there.getDate()} ${MONTHS[there.getMonth()].slice(0, 3)} · ${diff >= 0 ? '+' : ''}${diff} ${$t('sa fark')}`, copy: t, ic: 'zone' };
}

// ---------- fuzzy app match ----------
function score(name, q) {
  const n = name.toLowerCase();
  if (n === q) return 120;
  if (n.startsWith(q)) return 100 - n.length / 50;
  const words = n.split(/[\s\-_.]+/);
  if (words.some((w) => w.startsWith(q))) return 85 - n.length / 50;
  const init = words.map((w) => w[0]).join('');
  if (init.startsWith(q)) return 80;
  if (n.includes(q)) return 60;
  let i = 0, gaps = 0;
  for (const ch of n) { if (ch === q[i]) i++; else if (i) gaps++; if (i === q.length) break; }
  return i === q.length && q.length >= 2 && gaps <= q.length * 2 ? 40 - gaps : 0;
}
export function findApps(q, n = 5) {
  q = q.toLowerCase().trim();
  if (!q) return [];
  return apps()
    .filter((a) => !/^https?:/i.test(a.id) && !/uninstall|kaldır|readme|help$/i.test(a.name))
    .map((a) => { const s = score(a.name, q); return [s > 0 ? s + (cfg.pinned.some((p) => p.id === a.id) ? 6 : 0) : 0, a]; })
    .filter((x) => x[0] > 0)
    .sort((a, b) => b[0] - a[0])
    .slice(0, n)
    .map((x) => x[1]);
}

// ---------- actions (shared by local parser and AI) ----------
const COLORS = { pink: '#ff5fa2', pembe: '#ff5fa2', rosa: '#ff5fa2', rose: '#ff5fa2', red: '#ff4d4f', kırmızı: '#ff4d4f', rojo: '#ff4d4f', vermelho: '#ff4d4f', orange: '#ff8a1f', turuncu: '#ff8a1f', yellow: '#ffc21a', sarı: '#ffc21a', green: '#2fd27a', yeşil: '#2fd27a', verde: '#2fd27a', teal: '#14c6c0', turkuaz: '#14c6c0', cyan: '#22c3ee', blue: '#4f8cff', mavi: '#4f8cff', azul: '#4f8cff', purple: '#9b6bff', mor: '#9b6bff', violet: '#9b6bff', mint: '#3ee6b0', lime: '#9be22d', gold: '#e8b339', altın: '#e8b339', gray: '#8b93a7', gri: '#8b93a7' };
const SIZES = ['S', 'M', 'L'];
export async function exec(a) {
  const v = a.value;
  switch (a.do) {
    case 'volume': await invoke('volume_set', { level: Math.max(0, Math.min(100, +v)) / 100 }); refresh('volume'); return `${$t('Ses')}: ${Math.round(+v)}%`;
    case 'mute': await invoke('volume_set', { muted: v !== false }); refresh('volume'); return v === false ? $t('Ses açıldı') : $t('Ses kapatıldı');
    case 'accent': { const c = COLORS[String(v).toLowerCase()] || (/^#[0-9a-f]{6}$/i.test(v) ? v : null); if (!c) return null; set('accent', c); return `${$t('Vurgu rengi')}: ${v}`; }
    case 'theme': if (!['midnight', 'black', 'white', 'glass', 'ios'].includes(v)) return null; set('theme', v); return `${$t('Tema')}: ${{ midnight: $t('Gece'), black: $t('Siyah'), white: $t('Beyaz'), glass: $t('Sıvı Cam'), ios: 'iOS Cam' }[v]}`;
    case 'radius': set('radius', Math.max(0, Math.min(100, +v))); return `${$t('Köşe yarıçapı')}: ${Math.round(+v)}%`;
    case 'position': if (!['top', 'bottom'].includes(v)) return null; set('position', v); return v === 'top' ? $t('Dock üstte') : $t('Dock altta');
    case 'size': { let s = String(v).toUpperCase(); if (s === '+') s = SIZES[Math.min(2, SIZES.indexOf(cfg.size) + 1)]; if (s === '-') s = SIZES[Math.max(0, SIZES.indexOf(cfg.size) - 1)]; if (!SIZES.includes(s)) return null; set('size', s); return `${$t('Boyut')}: ${s}`; }
    case 'clock24': set('clock24', !!v); return v ? $t('24 saat biçimi açık') : $t('12 saat biçimi');
    case 'seconds': set('seconds', !!v); return v ? $t('Saniyeler görünür') : $t('Saniyeler gizli');
    case 'magnify': set('magnify', !!v); return v ? $t('Büyütme açık') : $t('Büyütme kapalı');
    case 'wifi': case 'bluetooth': { const ok = await invoke('radio_set', { kind: a.do, on: !!v }); refresh('radios'); return ok ? `${a.do === 'wifi' ? $t('Wi-Fi') : $t('Bluetooth')} ${v ? $t('açık') : $t('kapalı')}` : null; }
    case 'timer': timerStart(+v); if (!cfg.items.includes('timer')) set('items', [...cfg.items, 'timer']); return `${+v} ${$t('dk zamanlayıcı başladı')}`;
    case 'todo': set('todos', [{ text: String(v), done: false, at: Date.now() }, ...cfg.todos]); return `${$t('Görev eklendi')}: ${v}`;
    case 'note': set('notes', (cfg.notes ? cfg.notes + '\n' : '') + v); return $t('Nota eklendi');
    case 'open_app': { const x = findApps(String(v), 1)[0]; if (!x) return null; launchApp(x); return `${x.name} ${$t('açılıyor')}`; }
    case 'add_widget': case 'remove_widget': {
      const id = W[v] ? v : Object.values(W).find((w) => w.name.toLowerCase().includes(String(v).toLowerCase()))?.id;
      if (!id) return null;
      if (a.do === 'add_widget') { if (!cfg.items.includes(id)) set('items', [...cfg.items, id]); return `${W[id].name} dock'a eklendi`; }
      set('items', cfg.items.filter((x) => x !== id)); return `${W[id].name} ${$t('kaldırıldı')}`;
    }
    case 'web': invoke('open_url', { url: 'https://www.google.com/search?q=' + encodeURIComponent(v) }); return `${$t('Web\'de aranıyor')}: ${v}`;
    case 'event': if (!v?.title || !v?.date) return null; addEvent({ title: v.title, date: v.date, time: v.time || '', repeat: v.repeat || 'none', color: cfg.accent }); return `${$t('Takvime eklendi')}: ${v.title}`;
    case 'lock': invoke('lock_pc'); return $t('Kilitleniyor');
    case 'collapse': bus.emit('collapse', v !== false); return v === false ? $t('Dock açıldı') : $t('Dock katlandı');
    case 'taskbar': set('hideTaskbar', !v); return v ? $t('Windows görev çubuğu geri geldi') : $t('Görev çubuğu gizlendi');
    case 'answer': return String(v);
  }
  return null;
}

/** Fast, offline understanding of common commands in Turkish and English. */
export function parseLocal(q) {
  const s = q.toLowerCase().trim();
  let m;
  if ((m = /^(?:volume|vol|ses(?:i| seviyesi)?)\s*(?:to|=|:)?\s*(\d{1,3})\s*%?\s*(?:yap|olsun)?$/.exec(s)) || (m = /^(\d{1,3})\s*%?\s*(?:ses|volume)$/.exec(s))) return [{ do: 'volume', value: +m[1] }];
  if (/^(mute|sessiz|sesi kapat|sesi sustur)$/.test(s)) return [{ do: 'mute', value: true }];
  if (/^(unmute|sesi aç)$/.test(s)) return [{ do: 'mute', value: false }];
  for (const c in COLORS) {
    const re = new RegExp(`(^|\\s)${c}(\\s|$)`);
    if (re.test(s) && /(make|yap|renk|accent|vurgu|olsun|color|colour|set|change)/.test(s)) return [{ do: 'accent', value: c }];
  }
  if ((m = /(?:corner radius|köşe(?: yarıçapı)?|radius|yarıçap)\s*(?:to|=|:)?\s*(\d{1,3})\s*%?/.exec(s))) return [{ do: 'radius', value: +m[1] }];
  if (/(kare|square)\s*(dock|köşe|yap|corners)?/.test(s) && /(dock|yap|make|köşe|corner)/.test(s)) return [{ do: 'radius', value: 0 }];
  if (/(yuvarlak|round)\s*(dock|köşe|yap|corners)?/.test(s) && /(dock|yap|make|köşe|corner)/.test(s)) return [{ do: 'radius', value: 100 }];
  if (/dock/.test(s) && /(top|üst|yukarı)/.test(s)) return [{ do: 'position', value: 'top' }];
  if (/dock/.test(s) && /(bottom|alt|aşağı)/.test(s)) return [{ do: 'position', value: 'bottom' }];
  if (/(bigger|larger|büyüt|daha büyük)/.test(s) && !/büyütme/.test(s)) return [{ do: 'size', value: '+' }];
  if (/(smaller|küçült|daha küçük)/.test(s)) return [{ do: 'size', value: '-' }];
  if (/(dark|koyu|karanlık|gece)\s*(mode|tema|mod|theme)?/.test(s) && /(mode|tema|mod|theme|yap)/.test(s)) return [{ do: 'theme', value: 'midnight' }];
  if (/(light|açık|beyaz|white)\s*(mode|tema|mod|theme)/.test(s)) return [{ do: 'theme', value: 'white' }];
  if (/(glass|cam|liquid)\s*(mode|tema|mod|theme|yap)?/.test(s) && /(tema|theme|yap|mode|glass)/.test(s)) return [{ do: 'theme', value: 'glass' }];
  if (/\bios\b/.test(s) && /(tema|theme|yap|mode|stil|glass|cam)/.test(s)) return [{ do: 'theme', value: 'ios' }];
  if (/(black|siyah)\s*(mode|tema|mod|theme|yap)/.test(s)) return [{ do: 'theme', value: 'black' }];
  if (/24[\s-]*(hour|saat)/.test(s)) return [{ do: 'clock24', value: true }];
  if (/12[\s-]*(hour|saat)/.test(s)) return [{ do: 'clock24', value: false }];
  if ((m = /(wi-?fi|kablosuz)\s*(?:'?[ıi]?)?\s*(on|off|aç|kapat)/.exec(s)) || (m = /(turn|aç|kapat)\s+(?:on|off)?\s*(wi-?fi)/.exec(s))) return [{ do: 'wifi', value: /on|aç/.test(m[2] || m[1]) && !/off|kapat/.test(s) }];
  if ((m = /(bluetooth|bt)\s*(?:'?[ıu]?)?\s*(on|off|aç|kapat)/.exec(s))) return [{ do: 'bluetooth', value: /on|aç/.test(m[2]) }];
  if ((m = /(\d{1,3})\s*(?:dk|dakika|min|mins|minute|minutes)\b(?:lık|lik)?\s*(?:timer|zamanlayıcı|sayaç|alarm|kur)?/.exec(s)) && /(timer|zamanlayıcı|sayaç|kur|alarm|başlat)/.test(s)) return [{ do: 'timer', value: +m[1] }];
  if ((m = /^(?:timer|zamanlayıcı)\s*(\d{1,3})$/.exec(s))) return [{ do: 'timer', value: +m[1] }];
  if ((m = /^(?:todo|yapılacak|görev)\s*[:\-]?\s+(.+)$/.exec(q.trim()))) return [{ do: 'todo', value: m[1] }];
  if ((m = /^(?:not|note)\s*[:\-]\s*(.+)$/i.exec(q.trim()))) return [{ do: 'note', value: m[1] }];
  if (/^(lock|kilitle|bilgisayarı kilitle)$/.test(s)) return [{ do: 'lock' }];
  if (/^(katla|collapse|dock.?ı? katla|küçük mod)$/.test(s)) return [{ do: 'collapse', value: true }];
  if (/^(dock.?ı? aç|expand)$/.test(s)) return [{ do: 'collapse', value: false }];
  if (/(büyütme|magnif)/.test(s) && /(kapat|off|disable)/.test(s)) return [{ do: 'magnify', value: false }];
  if (/(büyütme|magnif)/.test(s) && /(aç|on|enable)/.test(s)) return [{ do: 'magnify', value: true }];
  if (/(taskbar|görev çubuğu)/.test(s) && /(geri|back|göster|show|restore)/.test(s)) return [{ do: 'taskbar', value: true }];
  if ((m = /^(?:open|aç|başlat|launch|run)\s+(.+)$/.exec(s)) || (m = /^(.+?)'?(?:yı|yi|yu|yü|ı|i|u|ü)?\s+(?:aç|başlat)$/.exec(s))) { if (findApps(m[1], 1).length) return [{ do: 'open_app', value: m[1] }]; }
  return null;
}

// ---------- free AI ----------
const AI_SYS = `You control a Windows dock app called smartdock. The user writes in ANY language. Reply with ONLY minified JSON:
{"lang":"<ISO 639-1 code of the user's language, uppercase, e.g. TR, EN, PT-BR, UZ>","actions":[...],"say":"<very short confirmation in the user's language>"}
Allowed actions (use only these "do" values):
volume(value 0-100), mute(value bool), accent(value: one of pink,red,orange,yellow,green,teal,cyan,blue,purple,mint,lime,gold,gray or #rrggbb), theme(value midnight|black|white|glass|ios), radius(value 0-100 percent corner rounding), position(value top|bottom), size(value S|M|L|+|-), clock24(value bool), seconds(value bool), magnify(value bool), wifi(value bool), bluetooth(value bool), timer(value minutes), todo(value text), note(value text), open_app(value app name), add_widget(value widget id), remove_widget(value widget id), event(value {"title","date":"YYYY-MM-DD","time":"HH:MM"}), web(value search query), lock, taskbar(value bool: true = bring Windows taskbar back), answer(value short plain-text answer when the user just asks a question).
Widget ids: WIDGETS. Today is TODAY. If nothing fits, use answer or web.`;
async function askAI(q) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const sys = AI_SYS.replace('WIDGETS', Object.keys(W).join(',')).replace('TODAY', new Date().toISOString().slice(0, 16));
    const r = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai', messages: [{ role: 'system', content: sys }, { role: 'user', content: q }] }),
    });
    const j = await r.json();
    const txt = j.choices?.[0]?.message?.content || '';
    const m = txt.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } finally { clearTimeout(t); }
}

// ---------- panel ----------
const IMG = /\.(png|jpe?g|gif|webp|bmp|heic|avif)$/i, VID = /\.(mp4|mkv|mov|avi|webm|wmv)$/i;
function remember(q, label) {
  set('asks', [{ q, label, at: Date.now() }, ...cfg.asks.filter((a) => a.q !== q)].slice(0, 6));
}

export function openSearch(anchor, preset = '') {
  anchor ||= document.querySelector('.w-search') || document.querySelector('.dock');
  openPanel('search', anchor, { w: 420, h: 520, cls: 'sp' }, (root, close) => {
    root.innerHTML = `<div class="results scroll grow"></div><div class="inbar">${icon('search', 16)}<input placeholder="${$t('Her dilde yaz - ya da dock\'a ne yapacağını söyle')}" spellcheck="false"><span class="lang">TR</span></div>`;
    const res = root.querySelector('.results'), inp = root.querySelector('input'), lang = root.querySelector('.lang');
    let items = [], sel = 0, seq = 0, done = null;

    const renderList = (q, extra) => {
      res.innerHTML = '';
      if (done) res.append(h('div', { class: 'done-line', html: `${icon('check', 16)}<span>${esc(done)}</span>` }));
      if (extra) res.append(extra);
      const selIt = items[sel];
      if (selIt?.preview) {
        if (selIt.previewKind === 'vid') {
          const pv = h('div', { class: 'preview' });
          const vid = h('video', {
            src: `${SD}/file?path=${encodeURIComponent(selIt.preview)}`,
            poster: thumbUrl(selIt.preview, 512),
            controls: '',
            muted: '',
            playsinline: '',
            preload: 'metadata',
          });
          vid.onerror = () => { pv.innerHTML = `<img src="${thumbUrl(selIt.preview, 512)}">`; };
          pv.append(vid);
          res.append(pv);
        } else {
          res.append(h('div', { class: 'preview', html: `<img src="${thumbUrl(selIt.preview, 512)}">` }));
        }
      }
      let lastSect = '';
      items.forEach((it, i) => {
        if (it.sect && it.sect !== lastSect) { res.append(h('div', { class: 'sect' }, it.sect)); lastSect = it.sect; }
        const row = h('div', { class: 'li' + (i === sel ? ' sel' : ''), onmouseenter: () => { if (sel !== i) { sel = i; renderList(q, extra); } }, onclick: () => run(it) });
        row.innerHTML = `<div class="ico">${it.img ? `<img src="${it.img}">` : icon(it.ic || 'spark', 15)}</div><div class="grow stack"><span class="t1">${esc(it.t1)}</span>${it.t2 ? `<span class="t2">${esc(it.t2)}</span>` : ''}</div>${i === sel && it.hint ? `<span class="hint">${it.hint}</span>` : ''}`;
        if (it.path) row.oncontextmenu = (e) => { e.preventDefault(); invoke('reveal', { path: it.path }); close(); };
        res.append(row);
      });
      res.querySelector('.li.sel')?.scrollIntoView({ block: 'nearest' });
    };

    const empty = () => {
      items = cfg.asks.map((a) => ({ sect: $t('Son sorulanlar'), t1: a.q, t2: a.label, ic: 'clock', run: () => { inp.value = a.q; update(); } }));
      const tries = h('div', {}, h('div', { class: 'sect' }, $t('Dene')), h('div', { class: 'chips' }, ...(LANG === 'tr' ? ['12*8.5', '100 usd to eur', 'tokyo saat', 'hava', 'not defteri', 'köşe yarıçapı 30', 'ses 30', 'pembe yap', '5 dk zamanlayıcı', 'make the dock bigger'] : ['12*8.5', '100 usd to eur', 'weather', 'notepad', '5 min timer', 'make the dock bigger', 'move the dock to the top']).map((t) => h('button', { class: 'chip', onclick: () => { inp.value = t; update(); inp.focus(); } }, t))), h('p', { class: 'mut', style: { padding: '12px 2px 4px', lineHeight: 1.5, fontSize: '11px' } }, $t('Uygulamalar, dosyalar, widget\'lar, hesap - ya da dock\'a ne yapacağını kendi dilinde söyle. Enter çalıştırır, Ctrl+Enter web\'de arar.')));
      sel = 0;
      renderList('', tries);
    };

    const run = async (it) => {
      blip();
      if (it.run) return it.run();
    };

    const doActions = async (q, actions, viaAI) => {
      const labels = [];
      for (const a of actions || []) { const l = await exec(a).catch(() => null); if (l) labels.push(l); }
      if (!labels.length) { toast($t('Bunu yapamadım'), 'err'); blip('err'); return; }
      blip('ok');
      done = labels.join(' · ');
      remember(q, done + (viaAI ? '' : ''));
      renderList(q);
    };

    const update = async () => {
      const q = inp.value.trim();
      const my = ++seq;
      done = null;
      lang.textContent = langOf(q);
      if (!q) return empty();
      const out = [];
      let answer = null;
      const c = calc(q);
      if (c != null) answer = { a: c.toLocaleString(LOCALE, { maximumFractionDigits: 10 }), q: q + ' =', copy: String(c), ic: 'math' };
      if (/^(hava|hava durumu|weather|tiempo|clima|погода)$/i.test(q)) {
        const w = peek('weather');
        if (w) answer = { a: `${Math.round(w.current.temperature_2m)}° · ${WX_TEXT[wxKind(w.current.weather_code, w.current.is_day)]}`, q: w.city, wx: wxKind(w.current.weather_code, w.current.is_day) };
        out.push({ sect: $t('Widget\'lar'), t1: $t('Hava Durumu'), t2: cfg.items.includes('weather') ? $t('Dock\'ta') : $t('Dock\'a ekle'), ic: 'sun', hint: 'Enter', run: () => { if (!cfg.items.includes('weather')) set('items', [...cfg.items, 'weather']); toast($t('Hava durumu dock\'ta')); } });
      }
      const local = parseLocal(q);
      if (local) out.push({ sect: $t('Komut'), t1: describe(local[0]), t2: $t('Hemen uygula'), ic: 'check', hint: 'Enter', run: () => doActions(q, local) });
      for (const a of findApps(q)) out.push({ sect: $t('Uygulamalar'), t1: a.name, t2: $t('Uygulama'), img: iconUrl(a.id, 48), hint: $t('Aç'), run: () => { launchApp(a); close(); } });
      for (const w of Object.values(W).filter((w) => q.length > 2 && (w.name.toLowerCase().includes(q.toLowerCase()) || w.id.includes(q.toLowerCase()))).slice(0, 3)) {
        if (w.id === 'weather' && out.some((o) => o.t1 === $t('Hava Durumu'))) continue;
        const on = cfg.items.includes(w.id);
        out.push({ sect: $t('Widget\'lar'), t1: w.name, t2: on ? $t('Dock\'ta · kaldırmak için Enter') : w.desc, ic: w.icon, hint: on ? $t('Kaldır') : $t('Ekle'), run: () => { set('items', on ? cfg.items.filter((x) => x !== w.id) : [...cfg.items, w.id]); done = on ? `${w.name} ${$t('kaldırıldı')}` : `${w.name} dock'a eklendi`; blip('ok'); update(); } });
      }
      const askRow = cfg.ai ? { sect: $t('Yapay zeka'), t1: `${$t('Anla')}: “${q}”`, t2: $t('Kendi kelimelerinle, her dilde · ücretsiz'), ic: 'spark', hint: $t('Sor'), run: () => ai(q) } : null;
      const webRow = { sect: $t('Web'), t1: `${$t('Web\'de ara')}: “${q}”`, t2: $t('Ctrl+Enter her yerden'), ic: 'web', hint: $t('Ara'), run: () => { exec({ do: 'web', value: q }); remember(q, $t('Web araması')); close(); } };
      const answerEl = () => {
        if (!answer) return null;
        const el = h('div', { class: 'answer', html: `<div class="ico" style="width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;background:var(--panel-2)">${answer.wx ? wxIcon(answer.wx, 30) : icon(answer.ic || 'math', 18)}</div><div class="grow stack"><span class="a">${esc(answer.a)}</span><span class="q">${esc(answer.q)}</span></div>${answer.copy ? '<span class="hint mut">Enter kopyalar</span>' : ''}` });
        return el;
      };
      const finish = () => {
        if (my !== seq) return;
        items = [...out];
        if (askRow) items.push(askRow);
        items.push(webRow);
        if (answer?.copy) items.unshift({ t1: $t('Sonucu kopyala'), t2: answer.a, ic: 'check', hint: 'Enter', run: () => { navigator.clipboard.writeText(answer.copy); toast($t('Kopyalandı')); close(); } });
        sel = Math.min(sel, items.length - 1);
        if (!answer && !local && !out.length && askRow) sel = items.indexOf(askRow);
        renderList(q, answerEl());
      };
      sel = 0;
      finish();
      // async sources
      const [conv, tz, files] = await Promise.all([convert(q).catch(() => null), zone(q).catch(() => null), q.length >= 2 ? invoke('find_files', { q }).catch(() => []) : []]);
      if (my !== seq) return;
      if (conv) answer = { ...conv, ic: 'fx' };
      else if (tz) answer = tz;
      for (const f of files.slice(0, 8)) {
        const name = f.path.split('\\').pop();
        const isImg = IMG.test(name), isVid = VID.test(name);
        out.push({ sect: $t('Dosyalar'), t1: name, t2: f.path.replace(/\\[^\\]+$/, '').replace(/^C:\\Users\\[^\\]+/i, '~'), img: isImg || isVid ? thumbUrl(f.path, 64) : iconUrl(f.path, 48), ic: f.dir ? 'folder' : 'file', path: f.path, preview: isImg || isVid ? f.path : null, previewKind: isVid ? 'vid' : isImg ? 'img' : null, hint: $t('Aç · sağ tık: konum'), run: () => { invoke('open_path', { path: f.path }); remember(q, name); close(); } });
      }
      finish();
    };

    const ai = async (q) => {
      const my = ++seq;
      res.innerHTML = '';
      res.append(h('div', { class: 'li sel', html: `<div class="spin"></div><span class="t1">“${esc(q)}” ${$t('anlaşılıyor...')}</span>` }));
      try {
        const r = await askAI(q);
        if (my !== seq) return;
        if (!r) throw new Error($t('boş'));
        if (r.lang) lang.textContent = String(r.lang).toUpperCase().slice(0, 5);
        const acts = r.actions || [];
        const ans = acts.find((a) => a.do === 'answer');
        if (ans && acts.length === 1) {
          done = null;
          items = [{ t1: $t('Cevabı kopyala'), ic: 'check', hint: 'Enter', run: () => { navigator.clipboard.writeText(ans.value); toast($t('Kopyalandı')); } }];
          renderList(q, h('div', { class: 'answer', html: `<div class="grow" style="font-size:13px;line-height:1.5;white-space:pre-wrap">${esc(ans.value)}</div>` }));
          remember(q, String(ans.value).slice(0, 60));
          return;
        }
        await doActions(q, acts, true);
      } catch (e) {
        if (my !== seq) return;
        res.innerHTML = '';
        res.append(h('div', { class: 'li', html: `${icon('close', 15)}<span class="t1">${$t('Yapay zekaya ulaşılamadı - internet bağlantını kontrol et.')}</span>` }));
      }
    };

    inp.oninput = () => update();
    inp.onkeydown = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); renderList(inp.value.trim()); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); renderList(inp.value.trim()); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const q = inp.value.trim();
        if (e.ctrlKey && q) { exec({ do: 'web', value: q }); close(); return; }
        const it = items[sel];
        if (it) run(it);
        else if (q && cfg.ai) ai(q);
      } else if (e.key === 'Escape') close();
    };
    inp.value = preset;
    update();
    setTimeout(() => inp.focus(), 20);
  });
}

function describe(a) {
  const v = a.value;
  return ({
    volume: `${$t('Sesi %')}${v} ${$t('yap')}`, mute: v ? $t('Sesi kapat') : $t('Sesi aç'), accent: `${$t('Vurgu rengini')} ${v} ${$t('yap')}`, radius: `${$t('Köşe yarıçapı %')}${v}`, position: v === 'top' ? $t('Dock\'u üste taşı') : $t('Dock\'u alta taşı'),
    size: v === '+' ? $t('Dock\'u büyüt') : v === '-' ? $t('Dock\'u küçült') : `${$t('Boyut')} ${v}`, theme: `${$t('Tema')}: ${v}`, clock24: v ? $t('24 saat biçimi') : $t('12 saat biçimi'), wifi: `${$t('Wi-Fi')} ${v ? $t('aç') : $t('kapat')}`, bluetooth: `${$t('Bluetooth')} ${v ? $t('aç') : $t('kapat')}`,
    timer: `${v} ${$t('dakikalık zamanlayıcı')}`, todo: `${$t('Görev ekle')}: ${v}`, note: `${$t('Nota ekle')}: ${v}`, lock: $t('Bilgisayarı kilitle'), magnify: `${$t('Büyütme')} ${v ? $t('açık') : $t('kapalı')}`, taskbar: $t('Windows görev çubuğunu geri getir'), open_app: `${$t('Aç')}: ${findApps(v, 1)[0]?.name || v}`,
  })[a.do] || a.do;
}

bus.on('hotkey', () => openSearch());
void pad2;
