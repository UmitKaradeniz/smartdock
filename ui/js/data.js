// Data layer: services and state machines. Knows nothing about the DOM.
import { invoke, listen, defineService, push, refresh, cfg, set, bus, ymd } from './core.js';
import { $t, LANG } from './i18n.js';

// the last minute of system readings (one per 1.5 s), for tile sparklines and panel charts
export const HIST_LEN = 40;
export const hist = { cpu: [], down: [], up: [] };

const j = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });

export function initData() {
  defineService('stats', async () => {
    const s = await invoke('get_stats');
    for (const [k, v] of [['cpu', s.cpu], ['down', s.down], ['up', s.up]]) { hist[k].push(v); if (hist[k].length > HIST_LEN) hist[k].shift(); }
    return s;
  }, 1500);
  defineService('topcpu', () => invoke('get_top', { ram: false }), 3000);
  defineService('topram', () => invoke('get_top', { ram: true }), 4000);
  defineService('radios', () => invoke('radios_get'), 6000);
  defineService('volume', () => invoke('volume_get'), 4000);
  defineService('screen', () => invoke('screen_time'), 30000);
  defineService('qs', () => invoke('qs_get'), 5000);
  defineService('btdev', () => invoke('bt_devices'), 10000);
  defineService('storage', () => invoke('storage_info'), 60000);
  // temperatures + a 10 minute history while anything shows them
  const tHist = [];
  defineService('temps', async () => {
    const r = await invoke('temps');
    // boards report unused sensor inputs as impossible values (e.g. 113 °C): leave those out
    const zones = (r.zones || []).filter((z) => z.c > 0 && z.c < 110);
    // LibreHardwareMonitor gives the real CPU package; ACPI zones are only a board estimate
    const hot = r.cpu ?? (zones.length ? Math.max(...zones.map((z) => z.c)) : null);
    if (hot != null) { tHist.push(hot); if (tHist.length > 120) tHist.shift(); }
    return { zones, hot, hist: tHist.slice(), source: r.source, lhm: r.lhm };
  }, 5000);
  defineService('recycle', () => invoke('recycle_bin', { empty: false }), 30000);
  defineService('claude', claude, 5 * 60000);
  defineService('codex', codex, 5 * 60000);
  defineService('antigravity', antigravity, 5 * 60000);
  defineService('weather', weather, 15 * 60000);
  defineService('fx', () => rates(cfg.fx.from), 60 * 60000);
  defineService('crypto', () => j(`https://api.coingecko.com/api/v3/simple/price?ids=${cfg.crypto.join(',')}&vs_currencies=usd&include_24hr_change=true`), 5 * 60000);
  defineService('gh', () => (cfg.ghUser ? j(`https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(cfg.ghUser)}?y=last`) : null), 60 * 60000);
  defineService('ics', loadIcs, 30 * 60000);
  defineService('media', () => invoke('media_get'), 0);
  defineService('wins', () => invoke('get_windows'), 0);
  listen('media', (m) => push('media', m));
  listen('wins', (w) => push('wins', w));
  listen('claude-usage', () => refresh('claude'));
  bus.on('cfg:city', () => refresh('weather'));
  bus.on('cfg:ics', () => refresh('ics'));
  bus.on('cfg:ghUser', () => refresh('gh'));
  bus.on('cfg:fx', () => refresh('fx'));
  bus.on('cfg:crypto', () => refresh('crypto'));
}

// ---------- AI plan usage ----------
/** Reads the text of Claude Code's `/usage` into the same shape as the local records. */
export function parseCliUsage(text, now = new Date()) {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // "resets Nov 30, 4pm (Europe/Istanbul)" in this PC's time zone; the date is optional
  const when = (s) => {
    const m = /(?:([A-Z][a-z]{2}) (\d{1,2})(?:,| at)? )?(\d{1,2})(?::(\d{2}))?\s*([ap]m)/i.exec(s || '');
    if (!m) return null;
    const [, mon, day, hh, mi, ap] = m;
    const d = new Date(now);
    d.setHours((+hh % 12) + (ap.toLowerCase() === 'pm' ? 12 : 0), +(mi || 0), 0, 0);
    if (mon) {
      d.setMonth(MON.indexOf(mon), +day);
      if (now - d > 2 * 864e5) d.setFullYear(d.getFullYear() + 1); // late December -> January
    } else if (d < now) d.setDate(d.getDate() + 1);
    return d.toISOString();
  };
  const win = (re) => {
    const m = re.exec(text || '');
    return m ? { utilization: +m[1], resets_at: when(m[2]) } : null;
  };
  const five = win(/Current session:\s*([\d.]+)% used(?:[^\n]*?resets ([^\n]*))?/);
  const week = win(/Current week \(all models\):\s*([\d.]+)% used(?:[^\n]*?resets ([^\n]*))?/);
  if (!five && !week) return null;
  return { five_hour: five, seven_day: week, seven_day_opus: win(/Current week \((?!all)[^)]*\):\s*([\d.]+)% used(?:[^\n]*?resets ([^\n]*))?/) };
}
// ---------- weekly run-out forecast ----------
const HOUR = 36e5, WEEK = 168 * HOUR;
// hours of "usual pace" mixed into this week's own average; picked by backtesting a month of records
const PRIOR_HOURS = 48;
/** Usual pace (% per hour) of up to four earlier weeks; null when none was recorded well enough. */
export function usualPace(samples, reset) {
  const rates = [];
  for (let n = 1; n <= 4; n++) {
    const end = reset - n * WEEK, start = end - WEEK;
    const a = (samples || []).filter(([t]) => t > start && t <= end);
    if (!a.length) continue;
    const full = a.find(([, v]) => v >= 99);
    if (full) rates.push(100 / Math.max(24, (full[0] - start) / HOUR)); // a used-up week: pace until it ran out
    else if (end - a.at(-1)[0] < 24 * HOUR) rates.push(a.at(-1)[1] / 168); // otherwise only if its end was seen
  }
  return rates.length ? rates.reduce((x, y) => x + y) / rates.length : null;
}
/** Where a weekly window is heading: { state: full|early|ok|edge|out, elapsed, endPct, runOut }. */
export function weekForecast(w, now = Date.now()) {
  if (!w?.reset || w.pct == null || w.reset <= now) return null;
  // measured when the number was read, not now: an old reading must not look like a slow week
  const at = Math.min(now, w.at || now), start = w.reset - WEEK;
  const hours = (at - start) / HOUR, elapsed = Math.max(0, Math.min(1, (now - start) / WEEK));
  if (w.pct >= 100) return { state: 'full', elapsed, endPct: 100, runOut: null };
  const prior = w.prior ?? null;
  // without earlier weeks the first day says nothing (one busy hour would look like a short week)
  if (hours <= 1 || (prior == null && hours < 24)) return { state: 'early', elapsed, endPct: null, runOut: null };
  const rate = prior == null ? w.pct / hours : (w.pct + prior * PRIOR_HOURS) / (hours + PRIOR_HOURS);
  const endPct = w.pct + rate * ((w.reset - at) / HOUR);
  // the estimate is off by about a day mid-week, so close calls are not called either way
  const state = endPct < 90 ? 'ok' : endPct < 110 ? 'edge' : 'out';
  return { state, elapsed, endPct, runOut: state === 'out' ? new Date(Math.max(now, at + ((100 - w.pct) / rate) * HOUR)) : null };
}

// local records older than this are checked against the CLI
const CLAUDE_FRESH = 6 * 60e3;
let cliSeen = null;
async function claude() {
  let r = await invoke('claude_usage').catch((e) => ({ error: e }));
  const history = r.week;
  if (!(Date.now() - r.at < CLAUDE_FRESH)) {
    const usage = await invoke('claude_cli_usage').then(parseCliUsage).catch(() => null);
    if (usage) cliSeen = { src: 'cli', at: Date.now(), usage };
    if (cliSeen && !(r.at > cliSeen.at)) r = cliSeen;
  }
  if (r.error) throw r.error;
  const u = r.usage || {};
  const win = (o) => (o ? { pct: Math.round(o.utilization ?? 0), reset: o.resets_at ? new Date(o.resets_at) : null } : null);
  const weekly = win(u.seven_day);
  // the desktop record has no reset times; the CLI's still hold until they pass
  const session = win(u.five_hour);
  for (const [w, k] of [[session, 'five_hour'], [weekly, 'seven_day']]) {
    const seen = cliSeen?.usage[k]?.resets_at;
    if (w && !w.reset && seen && new Date(seen) > Date.now()) w.reset = new Date(seen);
  }
  if (weekly) Object.assign(weekly, { at: r.at, prior: weekly.reset ? usualPace(history, +weekly.reset) : null, samples: weekly.reset ? (history || []).filter(([t]) => t > +weekly.reset - WEEK && t <= r.at) : [] });
  const age = Math.max(0, Math.round((Date.now() - r.at) / 60000));
  const src = r.src === 'desktop' ? $t('Claude masaüstü kaydı') : $t('Claude Code');
  const note = `${src} · ${age < 1 ? $t('şimdi') : age + $t(' dk önce')}${r.src === 'desktop' && age > 20 ? $t(' · eski olabilir') : ''}`;
  return { plan: r.plan || '', note, at: r.at, src: r.src, session, weekly, opus: win(u.seven_day_opus) || win(u.seven_day_sonnet) };
}
// Antigravity: per-model remaining fraction; show the tightest Gemini and Claude model.
async function antigravity() {
  const r = await invoke('antigravity_usage');
  const pick = (re) => {
    let best = null;
    for (const [k, m] of Object.entries(r.models || {})) {
      const q = m.quotaInfo;
      if (!q || !re.test(k + ' ' + (m.displayName || ''))) continue;
      const pct = Math.round((1 - (q.remainingFraction ?? 1)) * 100);
      if (!best || pct > best.pct) best = { pct, reset: q.resetTime ? new Date(q.resetTime) : null };
    }
    return best;
  };
  return { plan: r.plan || '', labels: [$t('Gemini'), $t('Claude')], session: pick(/gemini/i), weekly: pick(/claude/i) };
}
async function codex() {
  const r = await invoke('codex_usage');
  const rl = r.rate_limit || r.rate_limits || r;
  const w = (o) => {
    if (!o) return null;
    const pct = Math.round(o.used_percent ?? o.usedPercent ?? 0);
    let reset = null;
    if (o.reset_at) reset = new Date(o.reset_at * (o.reset_at < 1e12 ? 1000 : 1));
    else if (o.reset_after_seconds) reset = new Date(Date.now() + o.reset_after_seconds * 1000);
    return { pct, reset };
  };
  return { plan: r.plan_type || '', session: w(rl.primary_window || rl.primary), weekly: w(rl.secondary_window || rl.secondary) };
}

// ---------- weather ----------
export async function locate() {
  const tries = [
    async () => { const r = await j('https://get.geojs.io/v1/ip/geo.json'); return { name: r.city, lat: +r.latitude, lon: +r.longitude }; },
    async () => { const r = await j('https://freeipapi.com/api/json'); return { name: r.cityName, lat: r.latitude, lon: r.longitude }; },
    async () => { const r = await j('https://ipwho.is/'); return { name: r.city, lat: r.latitude, lon: r.longitude }; },
  ];
  for (const t of tries) {
    try { const c = await t(); if (c.name && isFinite(c.lat)) return c; } catch {}
  }
  return { name: $t('İstanbul'), lat: 41.01, lon: 28.95 };
}
export async function geocode(q) {
  const r = await j(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=${LANG}`);
  return (r.results || []).map((x) => ({ name: x.name, lat: x.latitude, lon: x.longitude, tz: x.timezone, country: x.country }));
}
async function weather() {
  let c = cfg.city;
  if (!c) { c = await locate(); set('city', c); }
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,weather_code,is_day,apparent_temperature,wind_speed_10m,relative_humidity_2m&hourly=temperature_2m,weather_code,is_day,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max&timezone=auto&forecast_days=7`;
  const r = await j(u);
  return { city: c.name, ...r };
}

// ---------- currency ----------
const rateCache = new Map();
export async function rates(base) {
  base = base.toUpperCase();
  const c = rateCache.get(base);
  if (c && Date.now() - c.at < 3600e3) return c.v;
  const r = await j(`https://open.er-api.com/v6/latest/${base}`);
  if (r.result !== 'success') throw new Error('kur');
  const v = { base, rates: r.rates, at: r.time_last_update_unix };
  rateCache.set(base, { at: Date.now(), v });
  return v;
}

// ---------- calendar ----------
function icsDate(v) {
  const m = /(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/.exec(v);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  if (!hh) return { d: new Date(+y, mo - 1, +d), allDay: true };
  return { d: z ? new Date(Date.UTC(+y, mo - 1, +d, +hh, +mi, +(ss || 0))) : new Date(+y, mo - 1, +d, +hh, +mi), allDay: false };
}
function parseIcs(text, color, src) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out = [];
  let ev = null;
  for (const l of lines) {
    if (l === 'BEGIN:VEVENT') ev = {};
    else if (l === 'END:VEVENT') {
      if (ev?.start) out.push({ title: ev.title || $t('(adsız)'), start: ev.start.d, allDay: ev.start.allDay, rrule: ev.rrule, color, src });
      ev = null;
    } else if (ev) {
      const i = l.indexOf(':');
      if (i < 0) continue;
      const k = l.slice(0, i), v = l.slice(i + 1);
      if (k.startsWith('SUMMARY')) ev.title = v.replace(/\\,/g, ',').replace(/\\n/g, ' ');
      else if (k.startsWith('DTSTART')) ev.start = icsDate(v);
      else if (k === 'RRULE') ev.rrule = Object.fromEntries(v.split(';').map((p) => p.split('=')));
    }
  }
  return out;
}
async function loadIcs() {
  const all = [];
  for (const f of cfg.ics) {
    try { all.push(...parseIcs(await invoke('http_text', { url: f.url }), f.color || '#4f8cff', f.name)); } catch (e) { console.warn('ics', f.url, e); }
  }
  return all;
}

function expand(e, from, to, out) {
  const r = e.rrule;
  const step = (d, n) => {
    const x = new Date(d);
    const f = r ? r.FREQ : e.repeat;
    const iv = (r && +r.INTERVAL) || 1;
    if (f === 'DAILY' || f === 'daily') x.setDate(x.getDate() + n * iv);
    else if (f === 'WEEKLY' || f === 'weekly') x.setDate(x.getDate() + 7 * n * iv);
    else if (f === 'MONTHLY' || f === 'monthly') x.setMonth(x.getMonth() + n * iv);
    else if (f === 'YEARLY' || f === 'yearly') x.setFullYear(x.getFullYear() + n * iv);
    return x;
  };
  const rec = (r && r.FREQ) || (e.repeat && e.repeat !== 'none');
  if (!rec) {
    if (e.start >= from && e.start < to) out.push(e);
    return;
  }
  const until = r?.UNTIL ? icsDate(r.UNTIL)?.d : null;
  const count = r?.COUNT ? +r.COUNT : Infinity;
  for (let n = 0; n < 2000 && n < count; n++) {
    const d = step(e.start, n);
    if (d >= to || (until && d > until)) break;
    if (d >= from) out.push({ ...e, start: d });
  }
}

/** Every dated thing between two dates: own events, subscribed calendars, AI limit resets. */
export function eventsBetween(from, to, icsList, ai) {
  const out = [];
  for (const e of cfg.events) {
    const [y, m, d] = e.date.split('-').map(Number);
    const [hh, mi] = (e.time || '00:00').split(':').map(Number);
    expand({ title: e.title, start: new Date(y, m - 1, d, hh, mi), allDay: !e.time, color: e.color || cfg.accent, repeat: e.repeat, id: e.id, src: $t('Yerel') }, from, to, out);
  }
  for (const e of icsList || []) expand(e, from, to, out);
  for (const [name, u, color] of ai || []) {
    for (const k of ['session', 'weekly']) {
      const w = u?.[k];
      if (w?.reset && w.reset >= from && w.reset < to) out.push({ title: `${name} ${k === 'session' ? $t('oturum limiti yenilenir') : $t('haftalık limiti yenilenir')}`, start: w.reset, color, src: name });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function addEvent(ev) {
  set('events', [...cfg.events, { id: Date.now().toString(36), ...ev }]);
}
export function removeEvent(id) {
  set('events', cfg.events.filter((e) => e.id !== id));
}

// ---------- timers (pomodoro / countdown / stopwatch) ----------
export const timers = {
  pomo: { mode: 'idle', end: 0, left: 0, round: 0 },
  timer: { end: 0, left: 0, total: 0 },
  sw: { start: 0, acc: 0, run: false, laps: [] },
};
const announce = () => bus.emit('timers', timers);
export function pomoStart() {
  const p = timers.pomo;
  if (p.mode === 'idle') { p.mode = 'focus'; p.round++; p.end = Date.now() + cfg.pomodoro.focus * 60e3; }
  else if (p.left) { p.end = Date.now() + p.left; p.left = 0; }
  else { p.left = p.end - Date.now(); }
  announce();
}
export function pomoReset() { Object.assign(timers.pomo, { mode: 'idle', end: 0, left: 0 }); announce(); }
export function timerStart(min) {
  const t = timers.timer;
  if (min) { t.total = min * 60e3; t.end = Date.now() + t.total; t.left = 0; }
  else if (t.left) { t.end = Date.now() + t.left; t.left = 0; }
  else if (t.end) { t.left = t.end - Date.now(); }
  announce();
}
export function timerReset() { Object.assign(timers.timer, { end: 0, left: 0, total: 0 }); announce(); }
export function swToggle() {
  const s = timers.sw;
  if (s.run) { s.acc += Date.now() - s.start; s.run = false; } else { s.start = Date.now(); s.run = true; }
  announce();
}
export function swReset() { Object.assign(timers.sw, { start: 0, acc: 0, run: false, laps: [] }); announce(); }
export const swValue = () => timers.sw.acc + (timers.sw.run ? Date.now() - timers.sw.start : 0);

setInterval(() => {
  const now = Date.now(), p = timers.pomo, t = timers.timer;
  if (p.mode !== 'idle' && !p.left && now >= p.end) {
    const wasFocus = p.mode === 'focus';
    p.mode = wasFocus ? 'rest' : 'focus';
    if (!wasFocus) p.round++;
    p.end = now + (wasFocus ? cfg.pomodoro.rest : cfg.pomodoro.focus) * 60e3;
    bus.emit('alarm', wasFocus ? $t('Odak bitti - mola zamanı') : $t('Mola bitti - odaklanma zamanı'));
    announce();
  }
  if (t.end && !t.left && now >= t.end) {
    t.end = 0; t.total = 0;
    bus.emit('alarm', $t('Zamanlayıcı bitti'));
    announce();
  }
}, 500);

export const today = () => ymd(new Date());
