// Widget registry. Each widget mounts into a dock tile and may open a panel.
import { invoke, listen, use, refresh, onTick, cfg, set, h, esc, pad2, fmtDur, fmtBytes, timeStr, DAYS, MONTHS, iconUrl, SD, bus, blip, toast, ymd, peek } from './core.js';
import { icon, wxIcon, wxKind, WX_TEXT, MARK } from './icons.js';
import { openPanel, closePanel, menu } from './panels.js';
import { mountApps, apps } from './apps.js';
import { timers, pomoStart, pomoReset, timerStart, timerReset, swToggle, swReset, swValue, eventsBetween, weekForecast, addEvent, removeEvent, rates, hist } from './data.js';
import { openSearch } from './search.js';
import { $t, LOCALE, LANG } from './i18n.js';

export const CATS = [
  ['all', $t('Tümü'), 'grid'],
  ['core', $t('Temel'), 'layers'],
  ['time', $t('Saat & Takvim'), 'clock'],
  ['ai', $t('Yapay Zeka'), 'spark'],
  ['sys', $t('Sistem'), 'cpu'],
  ['media', $t('Müzik & Hava'), 'vol'],
  ['prod', $t('Üretkenlik'), 'todo'],
  ['fin', $t('Finans'), 'coin'],
  ['dev', $t('Geliştirici'), 'github'],
];

const W = {};
const def = (id, name, cat, ic, desc, mount, panel) => (W[id] = { id, name, cat, icon: ic, desc, mount, panel });
export const widgets = W;

const barCls = (p) => (p >= 85 ? 'bar bad' : p >= 65 ? 'bar warn' : 'bar');
const until = (d) => {
  if (!d) return '';
  const s = (d - Date.now()) / 1000;
  if (s <= 0) return $t('şimdi');
  if (s < 86400) return fmtDur(s);
  return `${DAYS[d.getDay()]} ${d.getDate()}`;
};
const sparkPts = (vals, w = 54, hgt = 20, max = 100) => {
  if (!vals.length) return '';
  const m = Math.max(max, ...vals);
  return vals.map((v, i) => `${((i / Math.max(1, vals.length - 1)) * w).toFixed(1)},${(hgt - 1 - (v / m) * (hgt - 3)).toFixed(1)}`).join(' ');
};
const sparkSvg = (vals, w = 54, hgt = 20, color = 'var(--accent)', max = 100) => {
  if (!vals.length) return `<svg width="${w}" height="${hgt}"></svg>`;
  return `<svg class="spark" width="${w}" height="${hgt}"><polyline points="${sparkPts(vals, w, hgt, max)}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
};
const ringSvg = (pct, size = 30, color = 'var(--accent)', sw = 3.2) => {
  const r = (size - sw) / 2, c = 2 * Math.PI * r;
  return `<svg class="ring" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${sw}"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.min(1, pct / 100))}"/></svg>`;
};
const hov = (el, fn) => { el.classList.add('hov', 'press'); el.onclick = () => { blip(); fn(); }; };

// =============== core ===============
def('search', $t('Akıllı Arama'), 'core', 'search', $t('Uygulamalar, dosyalar, hesap, çeviri ve ücretsiz AI.'), (el) => {
  el.classList.add('w-search');
  el.innerHTML = `${icon('search', 15)}<span class="ph">${$t('Ara ya da dock\'a söyle')}</span>${icon('spark', 14)}`;
  hov(el, () => openSearch(el));
});

def('apps', $t('Uygulamalar'), 'core', 'grid', $t('Başlat, sabitlenmiş ve açık uygulamalar; Mac tarzı büyütme.'), (el) => {
  el.classList.add('bare');
  return mountApps(el);
});

def('clock', $t('Saat & Takvim'), 'core', 'clock', $t('Saat ve tarih; tıklayınca tam takvim ve ajanda.'), (el) => {
  el.classList.add('w-clock');
  hov(el, () => openCalendar(el));
  el.innerHTML = `<div class="t"><span class="hm"></span><small class="sec"></small><small class="ampm"></small></div><div class="d"></div>`;
  const hm = el.querySelector('.hm'), sec = el.querySelector('.sec'), ampm = el.querySelector('.ampm'), dt = el.querySelector('.d');
  let pHm = '', pSec = null, pAm = null, pDt = '';
  return onTick((d) => {
    const t = timeStr(d, cfg.seconds);
    if (t.main !== pHm) { hm.textContent = pHm = t.main; }
    const sVal = t.sec ? `:${t.sec}` : '';
    if (sVal !== pSec) { sec.textContent = pSec = sVal; sec.style.display = sVal ? '' : 'none'; }
    if (t.ampm !== pAm) { ampm.textContent = pAm = t.ampm; ampm.style.display = t.ampm ? '' : 'none'; }
    const dVal = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
    if (dVal !== pDt) { dt.textContent = pDt = dVal; }
  });
});

// =============== time ===============
def('flipclock', $t('Flip Saat'), 'time', 'clock', $t('Kartları çevrilen büyük saat.'), (el) => {
  hov(el, () => openCalendar(el));
  el.innerHTML = '<div class="flip"><b></b><b></b><b class="gap"></b><b></b></div>';
  const bs = [...el.querySelectorAll('.flip b')];
  let prev = '';
  return onTick((d) => {
    const s = timeStr(d).main.replace(':', '').padStart(4, ' ');
    if (s === prev) return;
    for (let i = 0; i < 4; i++) {
      if (prev[i] !== s[i]) {
        bs[i].textContent = s[i];
        if (prev) {
          bs[i].classList.remove('tick');
          void bs[i].offsetWidth;
          bs[i].classList.add('tick');
        }
      }
    }
    prev = s;
  });
});

def('analog', $t('Analog Saat'), 'time', 'clock', $t('Sade analog kadran.'), (el) => {
  el.classList.add('bare');
  hov(el, () => openCalendar(el));
  el.innerHTML = `<svg width="38" height="38" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18.5" fill="var(--tile)" stroke="var(--line)"/><g stroke="var(--fg3)" stroke-width="1.4" stroke-linecap="round">${[...Array(12)].map((_, i) => `<line x1="20" y1="3.5" x2="20" y2="${i % 3 ? 5 : 6.5}" transform="rotate(${i * 30} 20 20)"/>`).join('')}</g><line class="hh" x1="20" y1="20" x2="20" y2="11" stroke="var(--fg)" stroke-width="2.4" stroke-linecap="round"/><line class="mm" x1="20" y1="20" x2="20" y2="6.5" stroke="var(--fg)" stroke-width="1.7" stroke-linecap="round"/><line class="ss" x1="20" y1="23" x2="20" y2="5" stroke="var(--accent)" stroke-width="1" stroke-linecap="round"/><circle cx="20" cy="20" r="1.6" fill="var(--accent)"/></svg>`;
  const [hh, mm, ss] = ['.hh', '.mm', '.ss'].map((s) => el.querySelector(s));
  return onTick((d) => {
    const s = d.getSeconds(), m = d.getMinutes() + s / 60, hr = (d.getHours() % 12) + m / 60;
    hh.setAttribute('transform', `rotate(${hr * 30} 20 20)`);
    mm.setAttribute('transform', `rotate(${m * 6} 20 20)`);
    ss.setAttribute('transform', `rotate(${s * 6} 20 20)`);
  });
});

def('worldclocks', $t('Dünya Saatleri'), 'time', 'zone', $t('Seçtiğin şehirlerin saati yan yana.'), (el) => {
  const fmt = (tz, d) => new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: !cfg.clock24, timeZone: tz }).format(d);
  const city = (tz) => tz.split('/').pop().replace(/_/g, ' ').slice(0, 9);
  hov(el, () => openCalendar(el));
  return onTick((d) => {
    el.innerHTML = cfg.zones.slice(0, 4).map((tz) => `<div class="stack"><span class="sub">${esc(city(tz))}</span><span class="lbl" style="font-size:13px">${fmt(tz, d)}</span></div>`).join('');
  });
});

def('dayprogress', $t('Gün İlerlemesi'), 'time', 'chart', $t('Gün, hafta, ay ve yılın yüzde kaçı geçti.'), (el) => {
  hov(el, () => openCalendar(el));
  return onTick((d) => {
    const day = ((d.getHours() * 60 + d.getMinutes()) / 1440) * 100;
    const wk = ((((d.getDay() + 6) % 7) * 1440 + d.getHours() * 60 + d.getMinutes()) / 10080) * 100;
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const mo = ((d.getDate() - 1 + day / 100) / dim) * 100;
    const y0 = new Date(d.getFullYear(), 0, 1), y1 = new Date(d.getFullYear() + 1, 0, 1);
    const yr = ((d - y0) / (y1 - y0)) * 100;
    if (d.getSeconds() % 10 && el.childElementCount) return;
    el.innerHTML = `<div class="ubars" style="grid-template-columns:auto 56px auto">${[[$t('Gün'), day], [$t('Hafta'), wk], [$t('Ay'), mo], [$t('Yıl'), yr]].slice(0, 2).map(([k, v]) => `<span class="k">${k}</span><div class="bar"><i style="width:${v}%"></i></div><span class="v">${Math.floor(v)}%</span>`).join('')}</div><div class="ubars" style="grid-template-columns:auto 56px auto">${[[$t('Ay'), mo], [$t('Yıl'), yr]].map(([k, v]) => `<span class="k">${k}</span><div class="bar"><i style="width:${v}%"></i></div><span class="v">${Math.floor(v)}%</span>`).join('')}</div>`;
  });
});

def('nextevent', $t('Sıradaki Etkinlik'), 'time', 'cal', $t('Bir sonraki toplantı, ödeme ya da yenileme ve kalan süre.'), (el) => {
  hov(el, () => openCalendar(el));
  const draw = () => {
    const now = new Date();
    const ev = eventsBetween(now, new Date(+now + 14 * 864e5), peek('ics'), aiResets())[0];
    el.innerHTML = `<div class="stack" style="align-items:center;min-width:26px"><span class="sub" style="color:var(--bad);font-weight:700">${DAYS[now.getDay()].toUpperCase()}</span><span class="big">${now.getDate()}</span></div>` +
      (ev ? `<div class="stack" style="max-width:150px"><span class="lbl" style="overflow:hidden;text-overflow:ellipsis">${esc(ev.title)}</span><span class="sub">${ev.allDay ? $t('tüm gün') : pad2(ev.start.getHours()) + ':' + pad2(ev.start.getMinutes())} · ${until(ev.start)} ${$t('sonra')}</span></div>` : `<span class="sub">${$t('Yaklaşan etkinlik yok')}</span>`);
  };
  const offs = [use('ics', draw), bus.on('cfg:events', draw), onTick((d) => d.getSeconds() === 0 && draw())];
  draw();
  return () => offs.forEach((f) => f());
});

// =============== AI ===============
function aiResets() {
  return [[$t('Claude'), peek('claude'), '#d97757'], ['ChatGPT', peek('codex'), '#9aa0a6'], [$t('Antigravity'), peek('antigravity'), '#5b8def']];
}
function usageTile(id, name, mark, svc, hint, labels = [$t('Oturum'), $t('Haftalık')]) {
  def(id, `${name} ${$t('Kullanımı')}`, 'ai', 'spark', `${name} ${$t('oturum ve haftalık limitin; ne zaman biteceği.')}`, (el) => {
    hov(el, () => openUsage(el, name, mark, svc, hint));
    const tpl = `<div class="mark">${MARK[mark]}</div><div class="ubars"><span class="k">${labels[0]}</span><div class="bar"><i></i></div><span class="r">-</span><span class="v">-</span><span class="k">${labels[1]}</span><div class="bar"><i></i></div><span class="r">-</span><span class="v">-</span></div>`;
    el.innerHTML = tpl;
    let bars, rs, vs;
    const q = () => { bars = el.querySelectorAll('.bar'); rs = el.querySelectorAll('.r'); vs = el.querySelectorAll('.v'); };
    q();
    const draw = (u, err) => {
      if (err && !u) { el.querySelector('.ubars').innerHTML = `<span class="k" style="grid-column:1/-1">${name}</span><span class="r" style="grid-column:1/-1;text-align:left">${$t('Bağlamak için tıkla')}</span>`; el.title = $t(String(err)); bars = null; return; }
      if (!u) return;
      if (!bars?.length) { const x = el.querySelector('.badge-x'); el.innerHTML = tpl; if (x) el.append(x); q(); el.title = ''; }
      [u.session, u.weekly].forEach((w, i) => {
        const p = w?.pct ?? 0;
        bars[i].className = barCls(p);
        bars[i].firstChild.style.width = p + '%';
        vs[i].textContent = w ? p + '%' : '-';
        rs[i].textContent = w?.reset ? until(w.reset) : '';
      });
    };
    const off = use(svc, draw);
    const t = onTick((d) => d.getSeconds() === 0 && peek(svc) && draw(peek(svc)));
    return () => { off(); t(); };
  });
}
usageTile('claude', $t('Claude'), 'claude', 'claude', $t('Claude masaüstünün kaydettiği yüzde okunur; canlı değerler ve sıfırlanma saatleri için aşağıdan Claude Code’u bağla. Giriş anahtarı kullanılmaz.'));
usageTile('antigravity', $t('Antigravity'), 'antigravity', 'antigravity', $t('Google, Antigravity oturumunun üçüncü taraf araçlarla kullanılmasını yasaklıyor ve resmî bir kota API’si yok; bu yüzden dock kotayı okumuyor. Kotayı Antigravity’nin kendi ekranından gör.'), [$t('Gemini'), $t('Claude')]);
usageTile('codex', 'ChatGPT', 'codex', 'codex', $t('Codex CLI ile bir kez giriş yap (codex login); dock aynı oturumu okur.'));

// A meter with a tick where even spending would be by now: fill past the tick means too fast.
const meter = (pct, tone, tick) => `<div class="meter ${tone}"><i style="width:${Math.min(100, pct)}%"></i>${tick == null ? '' : `<s style="left:${(tick * 100).toFixed(1)}%"></s>`}</div>`;
const resetText = (d) => {
  if (!d) return '';
  if (d - Date.now() < 86400e3) return d > Date.now() ? `${until(d)} ${$t('sonra sıfırlanır')}` : '';
  return `${$t('Sıfırlanma')}: ${d.toLocaleString(LOCALE, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
};
const ahead = (pct, tick) => Math.round(pct - tick * 100);
const paceText = (pct, tick) => { const a = ahead(pct, tick); return a > 0 ? `${a} ${$t('puan öndesin')}` : `${$t('Tempoda')} · ${LANG === 'tr' ? `%${-a}` : `${-a}%`} ${$t('payın var')}`; };
function sessionPace(w) {
  const span = 5 * 3600e3, left = w.reset ? w.reset - Date.now() : 0;
  if (left <= 0 || left > span) return { tick: null, tone: w.pct >= 85 ? 'bad' : w.pct >= 65 ? 'warn' : '', note: '', side: '' };
  const tick = (span - left) / span;
  const runOut = w.pct >= 5 && w.pct < 100 ? ((100 - w.pct) / w.pct) * (span - left) : Infinity;
  const out = runOut < left;
  return { tick, tone: w.pct >= 85 ? 'bad' : out ? 'warn' : '', note: paceText(w.pct, tick), side: out ? `${$t('bu hızla')} ${fmtDur(runOut / 1000)} ${$t('içinde biter')}` : '' };
}
function weekPace(w) {
  const f = weekForecast(w);
  if (!f) return { tick: null, tone: w.pct >= 85 ? 'bad' : w.pct >= 65 ? 'warn' : '', note: '', side: '' };
  const { state, elapsed, endPct, runOut } = f;
  const tone = state === 'full' || endPct > 130 || w.pct >= 85 ? 'bad' : state === 'out' || state === 'edge' ? 'warn' : '';
  let side = '';
  if (runOut) {
    // an exact minute would promise more than the estimate knows: day only while it is far off
    const near = runOut - Date.now() < 36 * 3600e3;
    const hour = new Date(Math.round(runOut / 3600e3) * 3600e3);
    const when = near ? hour.toLocaleString(LOCALE, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : runOut.toLocaleString(LOCALE, { weekday: 'long' });
    side = `${$t('Tahmini bitiş')}: ~${when}`;
  }
  const note = { full: $t('Haftalık limit doldu'), early: $t('Tahmin için henüz erken'), edge: $t('Sınırda: ucu ucuna') }[state] || paceText(w.pct, elapsed);
  return { tick: elapsed, tone, note, side };
}
// This week so far (recorded samples), even spending, and where the current pace leads.
function weekChart(w) {
  const f = weekForecast(w);
  if (!f) return '';
  const WEEK_MS = 7 * 86400e3, W = 264, H = 96;
  const end = +w.reset, start = end - WEEK_MS, at = Math.max(start, Math.min(Date.now(), w.at || Date.now()));
  const X = (t) => +(((t - start) / WEEK_MS) * W).toFixed(1), Y = (p) => +(H - (Math.min(100, p) / 100) * H).toFixed(1);
  const { tone } = weekPace(w), col = tone ? `var(--${tone})` : 'var(--fg)';
  // without records (ChatGPT, a fresh install) this is a straight line from the reset to today
  const past = [[start, 0], ...(w.samples || []).filter(([t]) => t < at), [at, w.pct]];
  const line = past.map(([t, p], i) => `${i ? 'L' : 'M'}${X(t)} ${Y(p)}`).join('');
  let proj = '';
  if (f.endPct > w.pct) {
    const k = Math.min(1, (100 - w.pct) / (f.endPct - w.pct));
    proj = `<path d="M${X(at)} ${Y(w.pct)}L${X(at + (end - at) * k)} ${Y(w.pct + (f.endPct - w.pct) * k)}" fill="none" stroke="${col}" stroke-width="1.6" stroke-dasharray="4 3"/>`;
  }
  let out = '';
  if (f.runOut && +f.runOut < end) {
    const x = X(+f.runOut);
    out = `<path d="M${x} 0V${H}" stroke="${col}" opacity=".45"/><circle cx="${x}" cy="0" r="3.5" fill="var(--panel)" stroke="${col}" stroke-width="1.8"/><text x="${Math.max(24, Math.min(W - 24, x))}" y="-8" text-anchor="middle" style="fill:${col};font-weight:600">${DAYS[f.runOut.getDay()]} ${$t('biter')}</text>`;
  }
  // one label per calendar day, centred on the part of it that falls inside this week
  let days = '';
  const today = new Date().toDateString(), outDay = f.runOut?.toDateString();
  for (const day = new Date(start); +day < end; day.setDate(day.getDate() + 1)) {
    day.setHours(0, 0, 0, 0);
    const a = Math.max(start, +day), b = Math.min(end, +day + 86400e3);
    if (b - a < 9 * 3600e3) continue;
    const key = day.toDateString(), fill = key === outDay ? col : key === today ? 'var(--fg)' : '';
    days += `<text x="${X((a + b) / 2)}" y="${H + 14}" text-anchor="middle"${fill ? ` style="fill:${fill}"` : ''}>${DAYS[day.getDay()]}</text>`;
  }
  return `<svg class="wchart" viewBox="0 -20 298 ${H + 38}" width="100%">
    <path d="M0 0H${W}M0 ${H / 2}H${W}M0 ${H}H${W}" stroke="var(--line)" fill="none"/>
    <text x="${W + 7}" y="3">100%</text><text x="${W + 7}" y="${H / 2 + 3}">50%</text><text x="${W + 7}" y="${H + 3}">0</text>
    <path d="M0 ${H}L${W} 0" stroke="var(--fg3)" stroke-dasharray="2 3" fill="none"/>
    <path d="${line}L${X(at)} ${H}Z" fill="${col}" opacity=".12"/>
    <path d="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>
    ${proj}<circle cx="${X(at)}" cy="${Y(w.pct)}" r="3.5" fill="${col}" stroke="var(--panel)" stroke-width="2"/>${out}${days}
  </svg><div class="sub faint">┄ ${$t('dengeli tempo')}</div>`;
}
const usageSec = (label, w, p, extra = '') => `<div class="usec"><div class="between"><span class="mut">${label}</span><span class="mut">${resetText(w.reset)}</span></div><div class="big-num">${w.pct}<small>%</small></div>${meter(w.pct, p.tone, p.tick)}${p.note || p.side ? `<div class="between sub"><span class="${p.tone || 'faint'}">${p.note}</span><span>${p.side}</span></div>` : ''}${extra}</div>`;
function openUsage(anchor, name, mark, svc, hint) {
  const u0 = peek(svc);
  const height = !u0 ? 260 : 48 + (u0.session ? 108 : 0) + (u0.weekly ? 108 + (weekForecast(u0.weekly) ? 168 : 0) : 0) + (u0.opus ? 44 : 0) + (u0.note ? 24 : 0) + (svc === 'claude' ? 44 : 8);
  openPanel('usage-' + svc, anchor, { w: 330, h: height, cls: 'flat scroll' }, (root) => {
    root.innerHTML = `<div class="ph-head"><div class="mark" style="width:22px;height:22px">${MARK[mark]}</div><div class="title">${name}</div><span class="sub faint plan"></span><div class="grow"></div><button class="ibtn rf" title="${$t('Yenile')}">${icon('refresh', 14)}</button></div><div class="ph-body body"></div><div class="pft link-slot" hidden></div>`;
    const body = root.querySelector('.body'), foot = root.querySelector('.link-slot');
    root.querySelector('.rf').onclick = () => { body.innerHTML = '<div class="spin"></div>'; refresh(svc); };
    if (svc === 'claude') claudeLink(foot);
    return use(svc, (u, err) => {
      if (err && !u) { body.innerHTML = `<p style="line-height:1.5">${esc($t(String(err)))}</p><p class="mut" style="line-height:1.5;margin-top:8px">${hint}</p>`; return; }
      if (!u) return;
      root.querySelector('.plan').textContent = u.plan ? String(u.plan) : '';
      const lb = u.labels || [$t('5 saatlik oturum'), $t('Haftalık')];
      body.innerHTML = (u.session ? usageSec(lb[0], u.session, sessionPace(u.session)) : '') +
        (u.weekly ? usageSec(lb[1], u.weekly, weekPace(u.weekly), weekChart(u.weekly)) : '') +
        (u.opus ? `<div class="usec between"><span class="mut">${$t('Opus / Sonnet haftalık')}</span><b class="${u.opus.pct >= 85 ? 'bad' : u.opus.pct >= 65 ? 'warn' : ''}">${u.opus.pct}%</b></div>` : '') +
        (u.note ? `<p class="sub faint" style="padding-top:8px">${esc(u.note)}</p>` : '');
    });
  });
}
// Claude Code hands its own usage numbers to its status line command; linking points that
// command at smartdock, so every reply updates the dock within seconds (no login token used).
async function claudeLink(box) {
  const draw = (st) => {
    box.hidden = false;
    box.innerHTML = `<span class="state${st.linked ? ' on' : ''}">${st.linked ? $t('Claude Code bağlı') : $t('Canlı güncelleme kapalı')}</span><div class="grow"></div>`;
    box.title = st.linked ? $t('Terminalde her yanıtta; masaüstünde birkaç dakikada bir güncellenir.') : $t('Claude Code durum satırından anlık yüzde al.');
    const b = h('button', { class: 'tbtn', title: '~/.claude/settings.json' }, st.linked ? $t('Kaldır') : $t('Bağla'));
    b.onclick = async () => {
      blip();
      b.disabled = true;
      try { draw(await invoke('claude_link_set', { on: !st.linked })); toast(st.linked ? $t('Bağlantı kaldırıldı') : $t('Bağlandı · Claude Code’da bir mesaj sonrası güncellenir')); }
      catch (e) { toast($t(String(e))); b.disabled = false; }
    };
    box.append(b);
  };
  try { draw(await invoke('claude_link_get')); } catch { box.hidden = true; }
}

// =============== system ===============
def('cpu', 'CPU', 'sys', 'cpu', $t('İşlemci kullanımı ve mini grafik.'), (el) => {
  hov(el, () => openTop(el, false));
  el.innerHTML = `<div class="stack"><span class="sub">CPU</span><span class="lbl n" style="font-size:14px;min-width:4ch">–</span></div><svg class="spark" width="54" height="20"><polyline points="" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  const num = el.querySelector('.n'), poly = el.querySelector('polyline');
  return use('stats', (s) => {
    if (!s) return;
    num.textContent = `${Math.round(s.cpu)}%`;
    poly.setAttribute('points', sparkPts(hist.cpu.slice(-30), 54, 20, 100));
  });
});
def('ram', 'RAM', 'sys', 'ram', $t('Bellek kullanımı.'), (el) => {
  hov(el, () => openTop(el, true));
  const c = 2 * Math.PI * 12.4;
  el.innerHTML = `${ringSvg(0, 28, 'var(--accent)')}<div class="stack"><span class="sub">RAM</span><span class="lbl n" style="min-width:10ch">–</span></div>`;
  const arc = el.querySelectorAll('circle')[1], num = el.querySelector('.n');
  return use('stats', (s) => {
    if (!s) return;
    const p = (s.ram_used / s.ram_total) * 100;
    arc.setAttribute('stroke', p > 85 ? 'var(--bad)' : 'var(--accent)');
    arc.setAttribute('stroke-dashoffset', String(c * (1 - Math.min(1, p / 100))));
    num.textContent = `${(s.ram_used / 1073741824).toFixed(1)} / ${Math.round(s.ram_total / 1073741824)} GB`;
  });
});
const netSp = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB/s' : Math.round(b / 1024) + ' KB/s');
// Chart points in a W x H box; `base` is the zero line and `dir` the way it grows.
const line = (vals, W, max, base, size) => vals.map((v, i) => `${((i / Math.max(1, vals.length - 1)) * W).toFixed(1)},${(base - (Math.min(v, max) / max) * size).toFixed(1)}`).join(' L');
const area = (vals, W, max, base, size, color, fill) => (vals.length < 2 ? '' : `<path d="M0,${base} L${line(vals, W, max, base, size)} L${W},${base}Z" fill="${color}" opacity="${fill}"/><path d="M${line(vals, W, max, base, size)}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`);
const chartBox = (H, body) => `<svg class="pchart" viewBox="0 0 298 ${H}" preserveAspectRatio="none" height="${H}">${body}</svg>`;
const spanText = (n) => `${Math.round(n * 1.5)} ${$t('sn önce')}`;
const bigSpeed = (b) => { const [v, u] = netSp(b).split(' '); return `${v}<small>${u}</small>`; };
function openNet(anchor) {
  openPanel('net', anchor, { w: 330, h: 236 }, (root) => {
    root.innerHTML = `<div class="ph-head"><div class="title">${$t('Ağ')}</div><div class="grow"></div><button class="tbtn quiet st">${$t('Ağ ayarları')}${icon('external', 12)}</button></div><div class="ph-body"><div class="split"><div><span class="mut">↓ ${$t('İndirme')}</span><div class="big-num dn">–</div></div><div><span class="up-ink">↑ ${$t('Yükleme')}</span><div class="big-num upv">–</div></div></div><div class="gr"></div><div class="between sub faint"><span class="peak"></span><span>${$t('Şimdi')}</span></div></div>`;
    root.querySelector('.st').onclick = () => { invoke('open_url', { url: 'ms-settings:network-status' }); closePanel(); };
    return use('stats', (s) => {
      if (!s) return;
      root.querySelector('.dn').innerHTML = bigSpeed(s.down);
      root.querySelector('.upv').innerHTML = bigSpeed(s.up);
      // one shared scale, so the two directions can be compared
      const peak = Math.max(10240, ...hist.down, ...hist.up);
      root.querySelector('.gr').innerHTML = chartBox(84, `<line x1="0" y1="52" x2="298" y2="52" stroke="var(--line)"/>${area(hist.down, 298, peak, 52, 50, 'var(--accent)', 0.5)}${area(hist.up, 298, peak, 52, -30, 'var(--up)', 0.55)}`);
      root.querySelector('.peak').textContent = `${spanText(hist.down.length)} · ${$t('tepe')} ${netSp(peak)}`;
    });
  });
}
def('network', $t('Ağ'), 'sys', 'net', $t('Anlık indirme / yükleme hızı.'), (el) => {
  const sp = netSp;
  hov(el, () => openNet(el));
  el.innerHTML = `${icon('net', 16)}<div class="stack" style="min-width:10ch"><span class="lbl dn">↓ 0 KB/s</span><span class="sub up">↑ 0 KB/s</span></div><svg class="spark" width="46" height="22"><polyline points="" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  const dn = el.querySelector('.dn'), up = el.querySelector('.up'), poly = el.querySelector('polyline');
  return use('stats', (s) => {
    if (!s) return;
    dn.textContent = `↓ ${sp(s.down)}`;
    up.textContent = `↑ ${sp(s.up)}`;
    poly.setAttribute('points', sparkPts(hist.down, 46, 22, 1));
  });
});
def('battery', $t('Pil Halkası'), 'sys', 'battery', $t('Pil yüzdesi ve şarj durumu.'), (el) => {
  el.classList.add('bare');
  hov(el, () => invoke('open_url', { url: 'ms-settings:batterysaver' }));
  return use('stats', (s) => {
    if (!s) return;
    const b = s.battery ?? 100;
    const col = b < 20 ? 'var(--bad)' : s.charging ? 'var(--good)' : 'var(--fg)';
    el.innerHTML = `<div style="position:relative;width:34px;height:34px">${ringSvg(b, 34, col, 3.4)}<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">${s.battery == null ? icon('bolt', 13) : b}</span></div>`;
    el.title = s.battery == null ? $t('Pil yok (masaüstü)') : `${b}% ${s.charging ? $t('· şarj oluyor') : ''}`;
  });
});
function openTop(anchor, ram) {
  openPanel('top', anchor, { w: 330, h: ram ? 332 : 374 }, (root) => {
    root.innerHTML = `<div class="ph-head"><div class="title">${ram ? $t('Bellek') : $t('İşlemci')}</div><div class="grow"></div><button class="tbtn quiet tm">${$t('Görev Yöneticisi')}${icon('external', 12)}</button></div><div class="ph-body"><div class="big-num now">–</div><div class="gr"></div><div class="plist"></div></div>`;
    root.querySelector('.tm').onclick = () => { invoke('launch', { id: 'C:\\Windows\\System32\\Taskmgr.exe' }); closePanel(); };
    const now = root.querySelector('.now'), gr = root.querySelector('.gr'), list = root.querySelector('.plist');
    let s = null, procs = null;
    const rows = () => {
      if (!procs || !s) return;
      const l = procs.slice(0, 5), val = (v) => (ram ? fmtBytes(v) : v.toFixed(1) + '%');
      const rest = Math.max(0, (ram ? s.ram_used : s.cpu) - l.reduce((a, p) => a + (ram ? p.ram : p.cpu), 0));
      list.innerHTML = l.map((p) => `<div class="prow">${p.exe ? `<img src="${iconUrl(p.exe, 32)}">` : '<i></i>'}<span>${esc(p.name.replace(/\.exe$/i, ''))}</span><b>${val(ram ? p.ram : p.cpu)}</b></div>`).join('') +
        `<div class="prow rest"><i></i><span>${$t('Diğer')}</span><b>${val(rest)}</b></div>`;
    };
    const a = use('stats', (x) => {
      if (!x) return;
      s = x;
      if (ram) {
        const p = (s.ram_used / s.ram_total) * 100;
        now.innerHTML = `${(s.ram_used / 1073741824).toFixed(1)}<small>/ ${Math.round(s.ram_total / 1073741824)} GB</small>`;
        gr.innerHTML = `${meter(p, p > 85 ? 'bad' : '')}<div class="between sub faint"><span>${Math.round(p)}% ${$t('kullanılan')}</span><span>${fmtBytes(s.ram_total - s.ram_used)} ${$t('boş')}</span></div>`;
      } else {
        now.innerHTML = `${Math.round(s.cpu)}<small>%</small>`;
        gr.innerHTML = `${chartBox(52, area(hist.cpu, 298, 100, 51, 49, 'var(--accent)', 0.18))}<div class="between sub faint"><span>${spanText(hist.cpu.length)}</span><span>${$t('Şimdi')}</span></div>`;
      }
      rows();
    });
    const b = use(ram ? 'topram' : 'topcpu', (l) => { if (l) { procs = l; rows(); } });
    return () => { a(); b(); };
  });
}
const topRows = (l, val) => `<div class="trows">${l.slice(0, 3).map((p) => `<div class="tr">${p.exe ? `<img src="${iconUrl(p.exe, 32)}">` : `<i></i>`}<span class="nm">${esc(p.name.replace(/\.exe$/i, ''))}</span><b>${val(p)}</b></div>`).join('')}</div>`;
def('topcpu', $t('Top CPU'), 'sys', 'cpu', $t('Şu an en çok işlemci kullanan uygulamalar.'), (el) => {
  hov(el, () => openTop(el, false));
  return use('topcpu', (l) => {
    if (!l) return;
    el.innerHTML = topRows(l, (p) => (p.cpu < 10 ? p.cpu.toFixed(1) : p.cpu.toFixed(0)) + '%');
  });
});
def('topram', $t('Top RAM'), 'sys', 'ram', $t('En çok bellek kullanan uygulamalar.'), (el) => {
  hov(el, () => openTop(el, true));
  return use('topram', (l) => {
    if (!l) return;
    el.innerHTML = topRows(l, (p) => fmtBytes(p.ram));
  });
});
function ringTile(id, name, ic, desc, pick, panelRam) {
  def(id, name, 'sys', ic, desc, (el) => {
    el.classList.add('bare', 'w-ring');
    hov(el, () => openTop(el, panelRam));
    el.innerHTML = `<div class="rw"><b></b></div>`;
    el.title = name;
    const rw = el.firstChild, b = rw.querySelector('b');
    let last = -1;
    return use('stats', (s) => {
      if (!s) return;
      const p = Math.round(pick(s));
      if (p === last) return;
      last = p;
      const col = p >= 85 ? 'var(--bad)' : p >= 65 ? 'var(--warn)' : 'var(--accent)';
      rw.querySelector('svg')?.remove();
      rw.insertAdjacentHTML('afterbegin', ringSvg(p, 40, col, 3.6));
      b.textContent = p;
    });
  });
}
ringTile('cpuring', $t('CPU Halkası'), 'cpu', $t('İşlemci yükü halka olarak; tıkla, en çok kullananlar.'), (s) => s.cpu, false);
ringTile('ramring', $t('RAM Halkası'), 'ram', $t('Kullanılan bellek halka olarak.'), (s) => (s.ram_used / s.ram_total) * 100, true);

// GPU: load (busiest engine, as Task Manager counts it), video memory and who uses it
function openGpu(anchor) {
  openPanel('gpu', anchor, { w: 330, h: 352 }, (root) => {
    root.innerHTML = `<div class="ph-head"><div class="title">${$t('Ekran Kartı')}</div><div class="grow"></div><button class="tbtn quiet tm">${$t('Görev Yöneticisi')}${icon('external', 12)}</button></div><div class="ph-body"><span class="sub faint gname"></span><div class="big-num now">–</div><div class="gr"></div><div class="vram"></div><div class="plist"></div></div>`;
    root.querySelector('.tm').onclick = () => { invoke('launch', { id: 'C:\\Windows\\System32\\Taskmgr.exe' }); closePanel(); };
    const q = (c) => root.querySelector(c);
    return use('gpu', (g) => {
      if (!g) { q('.now').textContent = $t('GPU bulunamadı'); return; }
      q('.gname').textContent = g.name;
      q('.now').innerHTML = `${Math.round(g.load)}<small>%</small>`;
      q('.gr').innerHTML = `${chartBox(52, area(hist.gpu, 298, 100, 51, 49, 'var(--accent)', 0.18))}<div class="between sub faint"><span>${Math.round(hist.gpu.length * 2)} ${$t('sn önce')}</span><span>${$t('Şimdi')}</span></div>`;
      // integrated GPUs have almost no memory of their own: show the shared pool instead
      const own = g.ded_total >= 512 * 1048576, used = own ? g.ded_used : g.shr_used, tot = own ? g.ded_total : g.shr_total, p = tot ? (used / tot) * 100 : 0;
      q('.vram').innerHTML = `${meter(p, p > 90 ? 'bad' : '')}<div class="between sub faint"><span>${own ? $t('Ekran belleği') : $t('Paylaşılan bellek')} ${fmtBytes(used)}</span><span>${fmtBytes(tot)}</span></div>`;
      q('.plist').innerHTML = g.procs.length ? g.procs.map((p) => `<div class="prow">${p.exe ? `<img src="${iconUrl(p.exe, 32)}">` : '<i></i>'}<span>${esc(p.name.replace(/\.exe$/i, ''))}</span><b>${p.gpu.toFixed(p.gpu < 10 ? 1 : 0)}%</b></div>`).join('') : `<div class="prow rest"><i></i><span>${$t('Şu an GPU kullanan uygulama yok')}</span><b></b></div>`;
    });
  });
}
def('gpu', 'GPU', 'sys', 'gpu', $t('Ekran kartı yükü, ekran belleği ve mini grafik.'), (el) => {
  hov(el, () => openGpu(el));
  el.innerHTML = `<div class="stack"><span class="sub">GPU</span><span class="lbl n" style="font-size:14px;min-width:4ch">–</span></div><svg class="spark" width="54" height="20"><polyline points="" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  const num = el.querySelector('.n'), poly = el.querySelector('polyline');
  return use('gpu', (g) => {
    if (!g) { num.textContent = '–'; return; }
    num.textContent = `${Math.round(g.load)}%`;
    el.title = g.name;
    poly.setAttribute('points', sparkPts(hist.gpu.slice(-30), 54, 20, 100));
  });
});
def('gpuring', $t('GPU Halkası'), 'sys', 'gpu', $t('Ekran kartı yükü halka olarak; tıkla, ayrıntılar.'), (el) => {
  el.classList.add('bare', 'w-ring');
  hov(el, () => openGpu(el));
  el.innerHTML = `<div class="rw"><b></b></div>`;
  const rw = el.firstChild, b = rw.querySelector('b');
  let last = -1;
  return use('gpu', (g) => {
    if (!g) return;
    el.title = g.name;
    const p = Math.round(g.load);
    if (p === last) return;
    last = p;
    const col = p >= 85 ? 'var(--bad)' : p >= 65 ? 'var(--warn)' : 'var(--accent)';
    rw.querySelector('svg')?.remove();
    rw.insertAdjacentHTML('afterbegin', ringSvg(p, 40, col, 3.6));
    b.textContent = p;
  });
});

def('ailimits', $t('AI Limitleri'), 'ai', 'spark', $t('İki yapay zeka planın tek tile’da: oturum doluluğu ve ne zaman yenileneceği.'), (el) => {
  const SV = [['claude', $t('Claude'), 'claude'], ['codex', 'ChatGPT', 'codex'], ['antigravity', $t('Antigravity'), 'antigravity']];
  hov(el, () => { const f = SV.find(([sv]) => peek(sv)) || SV[0]; openUsage(el, f[1], f[2], f[0], ''); });
  const got = {};
  const draw = () => {
    const rows = SV.filter(([sv]) => got[sv]?.session).slice(0, 2);
    if (!rows.length) { el.innerHTML = `${icon('spark', 16)}<div class="stack"><span class="lbl">${$t('AI limitleri')}</span><span class="sub">${$t('Claude Code ya da Codex ile giriş yap')}</span></div>`; return; }
    el.innerHTML = `<div class="ubars ai">${rows.map(([sv, nm, mk]) => { const w = got[sv].session; return `<span class="mk">${MARK[mk]}</span><span class="k">${nm}</span><div class="${barCls(w.pct)}"><i style="width:${w.pct}%"></i></div><span class="r">${w.reset ? until(w.reset) : ''}</span><span class="v">${w.pct}%</span>`; }).join('')}</div>`;
  };
  const offs = SV.map(([sv]) => use(sv, (u) => { got[sv] = u; draw(); }));
  offs.push(onTick((d) => d.getSeconds() === 0 && draw()));
  draw();
  return () => offs.forEach((f) => f());
});

// Mouse wheel over any volume control: 2% per notch, shown at once, applied right behind it.
let wheelLvl = null, wheelT = 0;
function wheelVolume(el, draw) {
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const v = peek('volume');
    if (!v) return;
    const base = wheelLvl ?? (v.muted ? 0 : v.level);
    wheelLvl = Math.max(0, Math.min(1, Math.round((base - Math.sign(e.deltaY) * 0.02) * 100) / 100));
    draw({ level: wheelLvl, muted: false, wheel: true });
    clearTimeout(wheelT);
    const lvl = wheelLvl;
    wheelT = setTimeout(() => { wheelLvl = null; invoke('volume_set', { level: lvl, muted: false }).then(() => refresh('volume')); }, 40);
  }, { passive: false });
}
const TOGGLES = [['wifi', $t('Wi-Fi')], ['bt', $t('Bluetooth')], ['vol', $t('Ses')], ['hs', $t('Mobil hotspot')], ['tray', $t('Arka plan uygulamaları')], ['qs', $t('Tüm hızlı ayarlar')]];
// System tray flyout: the apps Windows shows under the taskbar's "^" (taskbar is hidden here).
let trayRefresh = null;
listen('tray', () => { clearTimeout(trayRefresh?.t); if (trayRefresh) trayRefresh.t = setTimeout(trayRefresh.fn, 150); });
async function openTray(anchor) {
  const list = await invoke('tray_list');
  const cols = Math.min(6, Math.max(3, list.length)), rows = Math.max(1, Math.ceil(list.length / cols));
  openPanel('tray', anchor, { w: cols * 40 + 20, h: rows * 40 + 20, cls: 'tray' }, (root, close) => {
    const draw = (items) => {
      root.innerHTML = items.length ? '' : `<span class="sub" style="padding:10px">${$t('Arka planda simge yok')}</span>`;
      for (const it of items) {
        const b = h('button', { class: 'tri', title: it.tip, html: `<img src="${SD}/tray?id=${it.id}&h=${it.img}" alt="">` });
        b.onclick = () => { blip(); close(); invoke('tray_click', { id: it.id, right: false }); };
        b.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); close(); invoke('tray_click', { id: it.id, right: true }); };
        root.append(b);
      }
    };
    draw(list);
    trayRefresh = { fn: () => invoke('tray_list').then(draw), t: 0 };
    return () => { clearTimeout(trayRefresh?.t); trayRefresh = null; };
  });
}
def('toggles', $t('Hızlı Ayarlar'), 'sys', 'wifi', $t('Wi-Fi, Bluetooth, ses ve hotspot tek dokunuşla. Sağ tık: göster/gizle.'), (el) => {
  el.classList.add('w-toggles');
  el.innerHTML = `<button class="tg wifi" title="${$t('Wi-Fi')}">${icon('wifi', 15)}</button><button class="tg bt" title="${$t('Bluetooth')}">${icon('bt', 15)}</button><button class="tg vol" title="${$t('Ses · tekerlekle ayarla')}">${icon('vol', 15)}</button><button class="tg hs" title="${$t('Mobil hotspot')}">${icon('hotspot', 15)}</button><button class="tg tray" title="${$t('Arka plan uygulamaları')}">${icon('chevu', 15)}</button><button class="tg qsb" title="${$t('Tüm hızlı ayarlar')}">${icon('grid', 15)}</button>`;
  const [wf, bt, vl, hs, tr, qb] = el.querySelectorAll('.tg');
  const btn = { wifi: wf, bt, vol: vl, hs, tray: tr, qs: qb };
  tr.onclick = () => openTray(tr);
  qb.onclick = () => openQuick(qb);
  // one-time: existing setups get the new tray button (in the old hotspot spot if it was removed)
  if (cfg.toggles?.length && !cfg._trayOnce) { set('toggles', [...cfg.toggles.filter((k) => k !== 'tray'), 'tray']); set('_trayOnce', true); }
  if (cfg.toggles?.length && !cfg._qsOnce) { set('toggles', [...cfg.toggles.filter((k) => k !== 'qs'), 'qs']); set('_qsOnce', true); }
  let radios = {};
  const shown = () => {
    const want = cfg.toggles?.length ? cfg.toggles : TOGGLES.map(([k]) => k);
    for (const [k, b] of Object.entries(btn)) {
      const off = !want.includes(k) || (k === 'wifi' && radios.wifi == null) || (k === 'bt' && radios.bluetooth == null);
      b.style.display = off ? 'none' : '';
    }
  };
  // right-click the tile (not a button with its own menu): pick which buttons show
  el.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.wifi, .bt')) return;
    e.preventDefault();
    const cur = cfg.toggles?.length ? cfg.toggles : TOGGLES.map(([k]) => k);
    menu(el, TOGGLES.map(([k, label]) => ({
      label, icon: cur.includes(k) ? 'check' : null,
      run: () => {
        const next = cur.includes(k) ? cur.filter((x) => x !== k) : TOGGLES.map(([x]) => x).filter((x) => x === k || cur.includes(x));
        if (!next.length) return toast($t('En az bir düğme kalmalı'), 'err');
        set('toggles', next);
      },
    })));
  });
  let r = {};
  const flip = async (kind, btn) => {
    blip();
    const on = !btn.classList.contains('on');
    btn.classList.toggle('on', on);
    const ok = await invoke('radio_set', { kind, on });
    if (!ok) { btn.classList.toggle('on', !on); toast(kind === 'wifi' ? $t('Wi-Fi değiştirilemedi') : $t('Bluetooth değiştirilemedi'), 'err'); }
  };
  wf.onclick = () => openWifi(wf);
  bt.onclick = () => openBluetooth(bt);
  wf.oncontextmenu = (e) => { e.preventDefault(); flip('wifi', wf); };
  bt.oncontextmenu = (e) => { e.preventDefault(); flip('bluetooth', bt); };
  wf.title = $t('Wi-Fi · sağ tık: aç/kapat');
  bt.title = $t('Bluetooth · sağ tık: aç/kapat');
  hs.onclick = () => { blip(); invoke('open_url', { url: 'ms-settings:network-mobilehotspot' }); };
  vl.onclick = () => openVolume(vl);
  // volume: the level is a ring around the speaker; while the wheel turns, the number shows instead
  const R = 13, C = 2 * Math.PI * R;
  const drawVol = (v) => {
    const p = v.muted ? 0 : v.level, pct = Math.round(v.level * 100);
    vl.innerHTML = `<svg class="vring" viewBox="0 0 30 30"><circle cx="15" cy="15" r="${R}" class="trk"/><circle cx="15" cy="15" r="${R}" class="arc" stroke-dasharray="${(p * C).toFixed(1)} ${C.toFixed(1)}"/></svg>` +
      (v.wheel ? `<b class="vnum">${pct}</b>` : icon(v.muted || v.level === 0 ? 'mute' : 'vol', 14));
    vl.classList.toggle('muted', !!v.muted);
    vl.title = v.muted ? $t('Ses kapalı · tıkla') : `${$t('Ses %')}${pct} · ${$t('tekerlekle ayarla')}`;
  };
  wheelVolume(vl, drawVol);
  const a = use('radios', (x) => {
    if (!x) return;
    radios = x;
    wf.classList.toggle('on', !!x.wifi);
    bt.classList.toggle('on', !!x.bluetooth);
    shown();
  });
  const b = use('volume', (v) => { if (v && wheelLvl == null) drawVol(v); });
  const c = bus.on('cfg:toggles', shown);
  shown();
  return () => { a(); b(); c(); };
});
async function openVolume(anchor) {
  let d = null;
  try { d = await Promise.race([Promise.all([invoke('audio_outputs'), invoke('audio_apps')]).then(([outs, apps]) => ({ outs, apps })), new Promise((r) => setTimeout(r, 400))]); } catch {}
  const no = d?.outs?.length || 2, na = d?.apps?.length || 0;
  openPanel('volume', anchor, { w: 330, h: Math.min(560, 196 + no * 34 + (na ? 34 + na * 36 : 0)), cls: 'flat' }, (root, close) => {
    root.innerHTML = `<div class="ph-head"><div class="title">${$t('Ses')}</div></div><div class="ph-body"><div class="row" style="gap:8px"><button class="ibtn m"></button><div class="fat grow"><input type="range" min="0" max="100"><b></b></div></div></div>
      <div class="ph-body fill"><div class="sect-h">${$t('Çıkış')}</div><div class="nlist outs"></div><div class="mixer"></div></div>
      <div class="pft"><button class="tbtn quiet cfg">${$t('Ses ayarları…')}${icon('external', 12)}</button></div>`;
    const r = root.querySelector('input'), pct = root.querySelector('.fat b'), m = root.querySelector('.m');
    const outs = root.querySelector('.outs'), mixer = root.querySelector('.mixer');
    const show = (v) => { pct.textContent = v; r.style.setProperty('--v', v + '%'); };
    let t = 0;
    r.oninput = () => { show(r.value); clearTimeout(t); t = setTimeout(() => invoke('volume_set', { level: r.value / 100 }).then(() => refresh('volume')), 30); };
    m.onclick = () => { blip(); const v = peek('volume'); invoke('volume_set', { muted: !v?.muted }).then(() => refresh('volume')); };
    root.querySelector('.cfg').onclick = () => { invoke('open_url', { url: 'ms-settings:sound' }); close(); };
    let busy = false;
    const drawOuts = (list) => {
      outs.innerHTML = '';
      for (const o of list) {
        const row = h('button', { class: `orow${o.default ? ' on' : ''}`, html: `<i>${icon(/kulakl|headph|head|buds|airpods/i.test(o.name) ? 'hp' : 'vol', 15)}</i><span>${esc(o.name)}</span>${o.default ? icon('check', 14) : ''}` });
        row.onclick = async () => {
          if (o.default || busy) return;
          blip(); busy = true;
          outs.querySelectorAll('.orow').forEach((x) => x.classList.toggle('on', x === row));
          const ok = await invoke('audio_output_set', { id: o.id });
          busy = false;
          if (!ok) toast($t('Ses çıkışı değiştirilemedi'), 'err');
          refresh('audio'); refresh('volume');
        };
        outs.append(row);
      }
    };
    // app rows are kept while sliding so the thumb never jumps out of the hand
    const rows = new Map();
    const drawApps = (apps) => {
      if (!apps.length) { mixer.innerHTML = ''; rows.clear(); return; }
      if (!mixer.firstChild) mixer.innerHTML = `<div class="sect-h">${$t('Uygulamalar')}</div>`;
      const seen = new Set();
      for (const a of apps) {
        seen.add(a.pid);
        let x = rows.get(a.pid);
        if (!x) {
          const el = h('div', { class: 'mix', html: `${a.exe ? `<img src="${iconUrl(a.exe, 32)}" alt="">` : `<i>${icon('vol', 15)}</i>`}<span>${esc(a.pid ? a.name : $t('Sistem sesleri'))}</span><input type="range" min="0" max="100"><button class="ibtn"></button>` });
          const rg = el.querySelector('input'), mb = el.querySelector('button');
          let tt = 0;
          rg.oninput = () => { rg.style.setProperty('--p', rg.value + '%'); clearTimeout(tt); tt = setTimeout(() => invoke('audio_app_set', { pid: a.pid, level: rg.value / 100, muted: false }), 30); };
          mb.onclick = () => { blip(); const mu = !el.classList.contains('muted'); el.classList.toggle('muted', mu); mb.innerHTML = icon(mu ? 'mute' : 'vol', 14); invoke('audio_app_set', { pid: a.pid, muted: mu }).then(() => refresh('audio')); };
          x = { el, rg, mb };
          rows.set(a.pid, x);
          mixer.append(el);
        }
        if (document.activeElement !== x.rg) { x.rg.value = Math.round(a.level * 100); x.rg.style.setProperty('--p', x.rg.value + '%'); }
        x.el.classList.toggle('muted', a.muted);
        x.mb.innerHTML = icon(a.muted ? 'mute' : 'vol', 14);
      }
      for (const [pid, x] of rows) if (!seen.has(pid)) { x.el.remove(); rows.delete(pid); }
    };
    if (d) { drawOuts(d.outs); drawApps(d.apps); }
    const a1 = use('audio', (x) => { if (x && !busy) { drawOuts(x.outs); drawApps(x.apps); } });
    const a2 = use('volume', (v) => { if (!v) return; if (document.activeElement !== r) r.value = Math.round(v.level * 100); show(Math.round(v.level * 100)); r.parentElement.classList.toggle('muted', !!v.muted); m.innerHTML = icon(v.muted ? 'mute' : 'vol', 16); });
    return () => { a1(); a2(); };
  });
}
def('volume', $t('Ses Seviyesi'), 'sys', 'vol', $t('Ana ses seviyesi; tıkla ve kaydır.'), (el) => {
  hov(el, () => openVolume(el));
  const draw = (v) => {
    el.innerHTML = `${icon(v.muted ? 'mute' : 'vol', 16)}<div class="bar" style="width:60px"><i style="width:${v.muted ? 0 : v.level * 100}%;background:var(--fg)"></i></div><span class="lbl" style="min-width:3ch;text-align:right">${Math.round(v.level * 100)}</span>`;
  };
  wheelVolume(el, draw);
  return use('volume', (v) => { if (v && wheelLvl == null) draw(v); });
});
def('recycle', $t('Geri Dönüşüm Kutusu'), 'sys', 'trash', $t('Çöpteki öğeler; aç ya da boşalt.'), (el) => {
  hov(el, () => openRecycle(el));
  return use('recycle', (r) => {
    if (!r) return;
    el.innerHTML = `${icon('trash', 16)}<div class="stack"><span class="lbl">${r.items} ${$t('öğe')}</span><span class="sub">${fmtBytes(r.bytes)}</span></div>`;
  });
});
// Emptying is permanent, so it lives behind an explicit button in the panel, never on the tile tap.
function openRecycle(anchor) {
  openPanel('recycle', anchor, { w: 300, h: 86 }, (root) => {
    root.innerHTML = `<div class="ph-head"><div class="title">${$t('Geri Dönüşüm Kutusu')}</div><div class="grow"></div><span class="sub mut info"></span></div><div class="pft"><button class="tbtn op">${$t('Klasörü aç')}</button><div class="grow"></div><button class="tbtn bad em">${$t('Boşalt…')}</button></div>`;
    root.querySelector('.op').onclick = () => { invoke('open_path', { path: 'shell:RecycleBinFolder' }); closePanel(); };
    const em = root.querySelector('.em');
    let armed = false;
    em.onclick = async () => {
      const r = peek('recycle');
      if (!r?.items) return toast($t('Geri dönüşüm kutusu zaten boş'));
      if (!armed) { armed = true; em.textContent = $t('Kalıcı sil - emin misin?'); return; }
      await invoke('recycle_bin', { empty: true });
      toast(`${r.items} ${$t('öğe silindi')} · ${fmtBytes(r.bytes)} ${$t('boşaldı')}`);
      refresh('recycle');
      closePanel();
    };
    return use('recycle', (r) => { if (r) root.querySelector('.info').textContent = r.items ? `${r.items} ${$t('öğe')} · ${fmtBytes(r.bytes)}` : $t('Boş'); });
  });
}
def('commands', $t('Komutlar'), 'sys', 'power', $t('Kilitle, ayarlar, görev yöneticisi.'), (el) => {
  el.classList.add('w-toggles');
  el.innerHTML = `<button class="tg" title="${$t('Kilitle')}">${icon('lock', 15)}</button><button class="tg" title="${$t('Windows Ayarları')}">${icon('gear', 15)}</button><button class="tg" title="${$t('Görev Yöneticisi')}">${icon('task', 15)}</button>`;
  const [l, s, t] = el.querySelectorAll('.tg');
  l.onclick = () => invoke('lock_pc');
  s.onclick = () => invoke('open_url', { url: 'ms-settings:' });
  t.onclick = () => invoke('launch', { id: 'C:\\Windows\\System32\\Taskmgr.exe' });
});
def('screentime', $t('Ekran Süresi'), 'sys', 'clock', $t('Bugün ekranda geçen süre, uygulama uygulama.'), (el) => {
  hov(el, () => openScreen(el));
  return use('screen', (s) => {
    if (!s?.apps) return;
    const v = Object.values(s.apps), tot = v.reduce((a, b) => a + b, 0);
    const top = Object.entries(s.apps).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const mx = top[0]?.[1] || 1;
    el.innerHTML = `<div style="color:var(--accent)">${icon('clock', 20)}</div><div class="stack"><span class="sub">${$t('Ekran süresi')}</span><span class="big" style="font-size:16px">${fmtDur(tot)}</span></div><svg width="34" height="22">${top.map((t, i) => `<rect x="${i * 6}" y="${22 - Math.max(2, (t[1] / mx) * 20)}" width="4" height="${Math.max(2, (t[1] / mx) * 20)}" rx="1.5" fill="var(--accent)" opacity="${1 - i * 0.12}"/>`).join('')}</svg>`;
  });
});
const exeName = (p) => apps().find((a) => a.target?.toLowerCase() === p.toLowerCase())?.name || p.split('\\').pop().replace(/\.exe$/i, '');
const clockOf = (sec) => `${pad2(Math.floor(sec / 3600))}:${pad2(Math.floor((sec % 3600) / 60))}`;
function openScreen(anchor) {
  openPanel('screen', anchor, { w: 620, h: 400, cls: 'big' }, (root, close) => {
    let mode = 'day';
    root.innerHTML = `<div class="ph-head"><div class="title">${$t('Ekran Süresi')}</div><div class="grow"></div><div class="seg soft"><button data-m="day" class="on">${$t('Gün')}</button><button data-m="week">${$t('Hafta')}</button></div><button class="ibtn x">${icon('close', 15)}</button></div>
      <div class="st-grid"><div class="st-left"><div class="big-num tot"></div><span class="sub mut cmp"></span><div class="chart"></div><div class="facts"></div></div>
      <div class="st-right"><div class="list scroll top"></div></div></div>`;
    root.querySelector('.x').onclick = close;
    root.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => { blip(); mode = b.dataset.m; root.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b)); draw(peek('screen')); }));
    const short = (v) => (v >= 3600 ? `${+(v / 3600).toFixed(1)} ${$t('sa')}` : `${Math.round(v / 60)} ${$t('dk')}`);
    // bars over a labelled scale, with the average of the used slots as a dashed line
    const bars = (vals, labels, mx) => {
      const used = vals.filter((v) => v > 0), avg = used.length ? used.reduce((a, v) => a + v, 0) / used.length : 0;
      const mark = (v, text, cls) => `<div class="gline ${cls}" style="bottom:${(v / mx) * 100}%"><span>${text}</span></div>`;
      return `<div class="plot">${mark(mx, short(mx), '')}${mark(mx / 2, avg && Math.abs(avg - mx / 2) < mx * 0.12 ? '' : short(mx / 2), '')}${avg ? mark(avg, `${$t('ort.')} ${short(avg)}`, 'avg') : ''}<div class="bars">${vals.map((v, i) => `<div class="bcol" title="${labels[i]} · ${fmtDur(v)}"><i style="height:${Math.max(v ? 3 : 0, Math.min(100, (v / mx) * 100))}%"></i></div>`).join('')}</div></div><div class="bax">${labels.map((l, i) => `<span>${i % (vals.length > 7 ? 6 : 1) ? '' : l}</span>`).join('')}</div>`;
    };
    const draw = (s) => {
      if (!s?.apps) return;
      const today = Object.values(s.apps).reduce((a, b) => a + b, 0);
      const hist = s.hist || [];
      let apps2 = s.apps, total = today;
      const cmp = root.querySelector('.cmp');
      if (mode === 'day') {
        const y = hist[hist.length - 1], d = y ? today - y.total : null;
        cmp.textContent = d == null ? $t('Bugün') : `${$t('Bugün')} · ${$t('düne göre')} ${fmtDur(Math.abs(d))} ${d >= 0 ? $t('fazla') : $t('az')}`;
        root.querySelector('.chart').innerHTML = bars(s.hours || [], [...Array(24)].map((_, i) => pad2(i)), 3600);
        root.querySelector('.facts').innerHTML = [
          [$t('En uzun odak'), s.best ? `${fmtDur(s.best)}${s.bestApp ? ' · ' + exeName(s.bestApp) : ''}` : '-'],
          [$t('Uygulama geçişi'), s.switches ?? 0],
          [$t('İlk kullanım'), s.first != null ? clockOf(s.first) : '-'],
        ].map(([k, v]) => `<div class="kv"><span>${k}</span><b>${esc(String(v))}</b></div>`).join('');
      } else {
        const days = [...hist.slice(-6), { total: today, apps: s.apps }];
        total = days.reduce((a, d) => a + d.total, 0);
        apps2 = {};
        for (const d of days) for (const [k, v] of Object.entries(d.apps || {})) apps2[k] = (apps2[k] || 0) + v;
        cmp.textContent = `${$t('Son')} ${days.length} ${$t('gün · günde ort.')} ${fmtDur(total / days.length)}`;
        const now = new Date();
        const lbl = days.map((_, i) => DAYS[new Date(+now - (days.length - 1 - i) * 864e5).getDay()].slice(0, 3));
        root.querySelector('.chart').innerHTML = bars(days.map((d) => d.total), lbl, Math.max(1, Math.ceil(Math.max(...days.map((d) => d.total)) / 7200)) * 7200);
        root.querySelector('.facts').innerHTML = '';
      }
      root.querySelector('.tot').textContent = fmtDur(total);
      const e = Object.entries(apps2).sort((a, b) => b[1] - a[1]), mx = e[0]?.[1] || 1;
      root.querySelector('.top').innerHTML = e.slice(0, 25).map(([p, sec]) => `<div class="app-use"><div class="prow"><img src="${iconUrl(p, 32)}"><span>${esc(exeName(p))}</span><b>${fmtDur(sec)}</b></div><div class="share"><i style="width:${(sec / mx) * 100}%"></i></div></div>`).join('') || `<p class="mut">${$t('Henüz veri yok.')}</p>`;
    };
    return use('screen', draw);
  });
}

// =============== quick settings, bluetooth, storage, temperature ===============
const QS = [
  ['wifi', $t('Wi-Fi'), 'wifi', 'more'], ['bluetooth', $t('Bluetooth'), 'bt', 'more'], ['hotspot', $t('Mobil hotspot'), 'hotspot', 'link'],
  ['airplane', $t('Uçak modu'), 'plane'], ['mic', $t('Mikrofon'), 'mic'], ['camera', $t('Kamera'), 'cam'],
  ['awake', $t('Uyanık tut'), 'cup'], ['icons', $t('Masaüstü simgeleri'), 'grid'], ['dark', $t('Koyu mod'), 'moon'],
];
function openQuick(anchor) {
  openPanel('quick', anchor, { w: 330, h: Math.ceil(QS.length / 2) * 60 + 60 }, (root, close) => {
    root.innerHTML = `<div class="ph-head"><div class="title">${$t('Hızlı Ayarlar')}</div><div class="grow"></div><button class="ibtn x">${icon('close', 15)}</button></div><div class="qtiles"></div>`;
    root.querySelector('.x').onclick = close;
    const grid = root.querySelector('.qtiles');
    const tiles = {};
    for (const [k, label, ic, kind] of QS) {
      const state = h('small', {}, kind === 'link' ? $t('Ayarlar') : '');
      const main = h('button', { class: 'qt-main' }, h('span', { class: 'qi', html: icon(ic, 15) }), h('span', { class: 'qt-text' }, h('b', {}, label), state));
      const tile = h('div', { class: 'qt' }, main);
      const paint = (on) => { tile.classList.toggle('on', on); main.setAttribute('aria-pressed', on); state.textContent = on ? $t('Açık') : $t('Kapalı'); };
      if (kind === 'more') tile.append(h('button', { class: 'ibtn', title: k === 'wifi' ? $t('Ağlar') : $t('Cihazlar'), html: icon('chevr', 14), onclick: () => (k === 'wifi' ? openWifi : openBluetooth)(anchor) }));
      if (kind === 'link') tile.append(h('span', { class: 'faint qt-ext', html: icon('external', 12) }));
      main.onclick = async () => {
        blip();
        if (kind === 'link') { invoke('open_url', { url: 'ms-settings:network-mobilehotspot' }); return close(); }
        const on = !tile.classList.contains('on');
        paint(on);
        const ok = await invoke('qs_set', { kind: k, on });
        if (!ok) { paint(!on); toast(`${label} ${$t('değiştirilemedi')}`, 'err'); }
        refresh('qs'); if (k === 'wifi' || k === 'bluetooth' || k === 'airplane') refresh('radios');
      };
      tiles[k] = [tile, paint];
      grid.append(tile);
    }
    return use('qs', (q) => {
      if (!q) return;
      for (const [k, [tile, paint]] of Object.entries(tiles)) {
        if (k === 'hotspot') continue;
        const v = q[k];
        tile.hidden = v == null;
        paint(!!v);
      }
      // an odd last tile takes the whole row instead of leaving a hole
      const shown = Object.values(tiles).map((x) => x[0]).filter((x) => !x.hidden);
      shown.forEach((x, i) => x.classList.toggle('wide', i === shown.length - 1 && shown.length % 2 === 1));
    });
  });
}
// Rows that open in place into their actions (Wi-Fi networks, Bluetooth devices).
function actionRow(list, key, { ic, name, sub, on, open }, fill) {
  const row = h('div', { class: `nrow${on ? ' on' : ''}${open ? ' open' : ''}` });
  row.innerHTML = `<button class="nh"><i class="ni">${ic}</i><span class="nn"><b>${esc(name)}</b><small>${esc(sub)}</small></span>${on ? '<b class="cdot"></b>' : ''}</button>`;
  if (open && fill) { const na = h('div', { class: 'na' }); fill(na); row.append(na); }
  list.append(row);
  return row;
}
const pbtn = (label, cls, run) => h('button', { class: `pbtn ${cls}`, onclick: (e) => { e.stopPropagation(); blip(); run(e.currentTarget); } }, label);
const wifiBars = (sig) => {
  const n = sig >= 75 ? 3 : sig >= 50 ? 2 : sig >= 25 ? 1 : 0;
  return `<svg class="ic wbars" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path class="${n >= 3 ? 'lit' : ''}" d="M2.5 9a14 14 0 0 1 19 0"/><path class="${n >= 2 ? 'lit' : ''}" d="M5.5 12.3a9.5 9.5 0 0 1 13 0"/><path class="${n >= 1 ? 'lit' : ''}" d="M8.6 15.6a5 5 0 0 1 6.8 0"/><circle class="lit" cx="12" cy="19" r="1.1" fill="currentColor"/></svg>`;
};
function openWifi(anchor) {
  openPanel('wifi', anchor, { w: 340, h: 420, cls: 'flat' }, (root, close) => {
    root.innerHTML = `<div class="ph-head"><div class="title">${$t('Wi-Fi')}</div><div class="grow"></div><button class="sw pw" title="${$t('Wi-Fi')}"></button></div><div class="ph-body fill"><div class="nlist"></div></div><div class="pft"><button class="tbtn quiet link">${$t('Ağ ayarları…')}${icon('external', 12)}</button></div>`;
    const pw = root.querySelector('.pw'), list = root.querySelector('.nlist');
    root.querySelector('.link').onclick = () => { blip(); invoke('open_url', { url: 'ms-settings:network-wifi' }); close(); };
    let openK = null, nets = null, radioOn = true, work = null, locOff = false; // work: {ssid, text}
    const draw = () => {
      // never redraw under a half-typed password
      const typing = list.querySelector('input');
      if (typing && typing === document.activeElement) return;
      list.innerHTML = '';
      if (!radioOn) { list.innerHTML = `<div class="empty"><b>${$t('Wi-Fi kapalı')}</b><span class="sub">${$t('Ağları görmek için aç.')}</span></div>`; return; }
      if (locOff) {
        // Windows 11 only lists networks to apps that may use Location; that choice stays the user's
        list.innerHTML = `<div class="empty"><b>${$t('Ağ listesi için Konum izni gerekiyor')}</b><span class="sub">${$t('Windows, Wi-Fi ağlarını yalnız Konum açıkken gösteriyor.')}</span></div>`;
        list.firstChild.append(pbtn($t('Konum ayarını aç'), '', () => { invoke('open_url', { url: 'ms-settings:privacy-location' }); close(); }));
        return;
      }
      if (!nets) { list.innerHTML = `<div class="empty"><b>${$t('Ağlar aranıyor…')}</b></div>`; return; }
      if (!nets.length) { list.innerHTML = `<div class="empty"><b>${$t('Ağ bulunamadı')}</b><span class="sub">${$t('Birkaç saniye içinde yeniden aranacak.')}</span></div>`; return; }
      for (const n of nets) {
        const sub = work?.ssid === n.ssid ? work.text : n.connected ? $t('Bağlı') : n.saved ? $t('Kayıtlı') : n.secure ? $t('Güvenli') : $t('Açık ağ');
        const row = actionRow(list, n.ssid, { ic: wifiBars(n.signal) + (n.secure ? `<span class="lk">${icon('lock', 9)}</span>` : ''), name: n.ssid, sub, on: n.connected, open: openK === n.ssid }, (na) => {
          if (n.connected) {
            na.append(pbtn($t('Bağlantıyı kes'), 'ghost', async () => { work = { ssid: n.ssid, text: $t('Bağlantı kesiliyor…') }; draw(); await invoke('wifi_disconnect'); work = null; refresh('wifinets'); }));
          } else if (n.enterprise && !n.saved) {
            na.append(pbtn($t('Ayarlarda bağlan'), '', () => { invoke('open_url', { url: 'ms-settings:network-wifi' }); close(); }));
          } else {
            let inp = null;
            if (n.secure && !n.saved) {
              inp = h('input', { type: 'password', placeholder: $t('Ağ güvenlik anahtarı'), autocomplete: 'off', spellcheck: false });
              na.append(inp);
              setTimeout(() => inp.focus(), 30);
            }
            const go = async (btn) => {
              const password = inp ? inp.value : null;
              if (inp && password.length < 8) { inp.focus(); return toast($t('Şifre en az 8 karakter olmalı'), 'err'); }
              btn.disabled = true;
              work = { ssid: n.ssid, text: $t('Bağlanıyor…') };
              if (inp) inp.blur();
              draw();
              try { await invoke('wifi_connect', { ssid: n.ssid, password }); toast(`${n.ssid} ${$t('bağlandı')}`); openK = null; }
              catch (e) { toast(e === 'password' ? $t('Şifre yanlış ya da ağ yanıt vermedi') : e === 'enterprise' ? $t('Bu ağ için Ayarlar gerekli') : $t('Bağlanılamadı'), 'err'); }
              work = null; refresh('wifinets'); refresh('radios');
            };
            const b = pbtn($t('Bağlan'), '', go);
            if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter') b.click(); if (e.key === 'Escape') { openK = null; inp.blur(); draw(); } };
            na.append(b);
          }
          if (n.saved) na.append(pbtn($t('Unut'), 'bad', async () => { if (await invoke('wifi_forget', { ssid: n.ssid })) toast(`${n.ssid} ${$t('unutuldu')}`); openK = null; refresh('wifinets'); }));
        });
        row.firstChild.onclick = () => { blip(); openK = openK === n.ssid ? null : n.ssid; if (document.activeElement?.tagName === 'INPUT') document.activeElement.blur(); draw(); };
      }
    };
    pw.onclick = async () => {
      blip();
      const on = !pw.classList.contains('on');
      pw.classList.toggle('on', on); radioOn = on; if (on) nets = null; draw();
      if (!(await invoke('radio_set', { kind: 'wifi', on }))) { pw.classList.toggle('on', !on); toast($t('Wi-Fi değiştirilemedi'), 'err'); }
      refresh('radios'); setTimeout(() => refresh('wifinets'), 1500);
    };
    const a = use('radios', (r) => { if (!r) return; pw.classList.toggle('on', !!r.wifi); if (radioOn !== !!r.wifi) { radioOn = !!r.wifi; draw(); } });
    const b = use('wifinets', (x) => { if (x) { nets = x.nets; locOff = !!x.location; draw(); } });
    draw();
    return () => { a(); b(); };
  });
}
function openBluetooth(anchor) {
  openPanel('bt', anchor, { w: 340, h: 420, cls: 'flat' }, (root, close) => {
    root.innerHTML = `<div class="ph-head"><div class="title">${$t('Bluetooth')}</div><div class="grow"></div><button class="sw pw" title="${$t('Bluetooth')}"></button></div><div class="ph-body fill"><div class="nlist devs"></div><div class="nlist near"></div></div><div class="pft"><button class="tbtn add">${icon('plus', 12)}${$t('Cihaz ekle')}</button><div class="grow"></div><button class="tbtn quiet link">${$t('Ayarlar…')}${icon('external', 12)}</button></div>`;
    const pw = root.querySelector('.pw'), devs = root.querySelector('.devs'), near = root.querySelector('.near'), add = root.querySelector('.add');
    root.querySelector('.link').onclick = () => { blip(); invoke('open_url', { url: 'ms-settings:bluetooth' }); close(); };
    let openK = null, list = null, radioOn = true, sure = null, offScan = null;
    const work = {};
    const draw = () => {
      devs.innerHTML = '';
      if (!radioOn) { devs.innerHTML = `<div class="empty"><b>${$t('Bluetooth kapalı')}</b><span class="sub">${$t('Cihazları görmek için aç.')}</span></div>`; return; }
      if (!list) { devs.innerHTML = `<div class="empty"><b>${$t('Aranıyor…')}</b></div>`; return; }
      if (!list.length && !offScan) { devs.innerHTML = `<div class="empty"><b>${$t('Eşleştirilmiş cihaz yok')}</b><span class="sub">${$t('Aşağıdan yeni cihaz ekle.')}</span></div>`; return; }
      if (list.length) devs.append(h('div', { class: 'sect-h' }, $t('Cihazlarım')));
      for (const d of list) {
        const sub = work[d.id] || (d.connected ? $t('Bağlı') : $t('Eşleştirildi'));
        const row = actionRow(devs, d.id, { ic: icon(d.audio ? 'hp' : 'bt', 15), name: d.name, sub, on: d.connected, open: openK === d.id }, (na) => {
          const act = async (on) => {
            work[d.id] = on ? $t('Bağlanıyor…') : $t('Bağlantı kesiliyor…'); draw();
            const ok = await invoke('bt_connect', { id: d.id, name: d.name, on });
            if (!ok) toast(on ? $t('Cihaz yanıt vermedi; açık ve yakında mı?') : $t('Bağlantı kesilemedi'), 'err');
            // the driver reports back a moment later
            setTimeout(() => { delete work[d.id]; refresh('btdev'); }, on ? 4000 : 1500);
          };
          if (d.audio) na.append(d.connected ? pbtn($t('Bağlantıyı kes'), 'ghost', () => act(false)) : pbtn($t('Bağlan'), '', () => act(true)));
          else if (!d.connected) na.append(h('span', { class: 'sub na-note' }, $t('Cihazı açınca kendiliğinden bağlanır.')));
          na.append(pbtn(sure === d.id ? $t('Emin misin? Kaldır') : $t('Cihazı kaldır'), 'bad', async () => {
            if (sure !== d.id) { sure = d.id; return draw(); }
            sure = null; work[d.id] = $t('Kaldırılıyor…'); draw();
            const ok = await invoke('bt_unpair', { id: d.id });
            delete work[d.id];
            toast(ok ? `${d.name} ${$t('kaldırıldı')}` : $t('Cihaz kaldırılamadı'), ok ? '' : 'err');
            openK = null; refresh('btdev');
          }));
        });
        row.firstChild.onclick = () => { blip(); sure = null; openK = openK === d.id ? null : d.id; draw(); };
      }
    };
    // "Add device": a live search for nearby devices; tap one to pair
    let found = null, pairing = null;
    const drawNear = () => {
      near.innerHTML = '';
      if (!offScan) return;
      near.append(h('div', { class: 'sect-h' }, $t('Yakındaki cihazlar'), h('span', { class: 'scan-dot' })));
      if (!found?.length) { near.append(h('div', { class: 'sub near-hint' }, $t('Cihazı eşleştirme moduna al…'))); return; }
      for (const f of found) {
        const row = actionRow(near, f.id, { ic: icon('bt', 15), name: f.name, sub: pairing === f.id ? $t('Eşleştiriliyor…') : $t('Eşleştirmek için dokun'), on: false, open: false });
        row.firstChild.onclick = async () => {
          if (pairing) return;
          blip(); pairing = f.id; drawNear();
          const ok = await invoke('bt_pair', { id: f.id });
          pairing = null;
          toast(ok ? `${f.name} ${$t('eşleştirildi')}` : $t('Eşleştirilemedi; PIN isteyen cihazlar için Ayarlar’ı kullan'), ok ? '' : 'err');
          refresh('btdev'); refresh('btscan');
        };
      }
    };
    const stopScan = () => { offScan?.(); offScan = null; found = null; add.innerHTML = `${icon('plus', 12)}${$t('Cihaz ekle')}`; };
    add.onclick = () => {
      blip();
      if (offScan) { stopScan(); drawNear(); draw(); return; }
      if (!radioOn) return toast($t('Önce Bluetooth’u aç'), 'err');
      add.textContent = $t('Aramayı durdur');
      offScan = use('btscan', (x) => { if (x) { found = x; drawNear(); } });
      drawNear(); draw();
    };
    pw.onclick = async () => {
      blip();
      const on = !pw.classList.contains('on');
      pw.classList.toggle('on', on); radioOn = on;
      if (!on) { stopScan(); drawNear(); }
      draw();
      if (!(await invoke('radio_set', { kind: 'bluetooth', on }))) { pw.classList.toggle('on', !on); toast($t('Bluetooth değiştirilemedi'), 'err'); }
      refresh('radios'); refresh('btdev');
    };
    const a = use('radios', (r) => { if (!r) return; pw.classList.toggle('on', !!r.bluetooth); if (radioOn !== !!r.bluetooth) { radioOn = !!r.bluetooth; draw(); } });
    const b = use('btdev', (l) => { if (l) { list = l; draw(); } });
    draw();
    return () => { a(); b(); offScan?.(); };
  });
}

const STOR_COL = ['#ff9f43', '#4f8cff', '#2fd27a', '#b07cff', '#ff5f6d', '#ffc21a', '#14c6c0', '#8b93a7'];
def('storage', $t('Depolama'), 'sys', 'disk', $t('C: sürücüsünde kalan yer; içini neyin doldurduğunu tara.'), (el) => {
  hov(el, () => openStorage(el));
  return use('storage', (d) => {
    if (!d?.total) return;
    const p = ((d.total - d.free) / d.total) * 100;
    el.innerHTML = `${ringSvg(p, 28, p > 90 ? 'var(--bad)' : p > 75 ? 'var(--warn)' : 'var(--accent)')}<div class="stack"><span class="sub">${$t('Depolama')}</span><span class="lbl n">${fmtBytes(d.free)} ${$t('boş alan')}</span></div>`;
  });
});
function openStorage(anchor) {
  openPanel('storage', anchor, { w: 340, h: 420, cls: 'flat' }, (root, close) => {
    root.innerHTML = `<div class="ph-head"><div class="title">${$t('Depolama')}</div><span class="sub faint cap"></span><div class="grow"></div><button class="ibtn x">${icon('close', 15)}</button></div>
      <div class="ph-body"><div class="big-num fr">–</div><div class="sbar"></div></div><div class="ph-body fill scan"></div>
      <div class="pft"><button class="tbtn go">${$t('İçini tara')} · ~20 ${$t('sn')}</button><div class="grow"></div><button class="tbtn quiet pc">${$t('Bu Bilgisayar')}${icon('external', 12)}</button></div>`;
    root.querySelector('.x').onclick = close;
    root.querySelector('.pc').onclick = () => { blip(); invoke('open_path', { path: 'shell:MyComputerFolder' }); close(); };
    const scan = root.querySelector('.scan'), go = root.querySelector('.go');
    let d = null, parts = null;
    const row = (col, name, bytes) => `<div class="prow"><b class="sdot" style="background:${col}"></b><span>${esc(name)}</span><b>${fmtBytes(bytes)}</b></div>`;
    const paint = () => {
      if (!d?.total) return;
      const used = d.total - d.free;
      root.querySelector('.cap').textContent = `${d.drive} · ${fmtBytes(d.total)}`;
      const [num, unit] = fmtBytes(d.free).split(' ');
      root.querySelector('.fr').innerHTML = `${num}<small>${unit} ${$t('boş')}</small>`;
      const top = parts ? parts.slice(0, 7) : [];
      const segs = parts ? [...top, { name: $t('Diğer'), bytes: Math.max(0, used - top.reduce((a, x) => a + x.bytes, 0)) }] : [{ name: $t('Kullanılan'), bytes: used }];
      const col = (i) => (parts ? STOR_COL[i] : 'var(--accent)');
      root.querySelector('.sbar').innerHTML = segs.map((x, i) => `<i style="flex:${x.bytes};background:${col(i)}" title="${esc(x.name)} · ${fmtBytes(x.bytes)}"></i>`).join('') + `<i class="free" style="flex:${d.free}"></i>`;
      scan.innerHTML = segs.map((x, i) => row(col(i), x.name, x.bytes)).join('') +
        (parts ? '' : `<p class="sub faint" style="line-height:1.5;margin-top:10px">${$t('Tarama sistem sürücüsündeki tüm dosyaları gezer; yaklaşık 15-20 sn disk ve işlemci kullanır. Sonuç 5 dakika saklanır.')}</p>`);
    };
    go.onclick = async () => {
      blip();
      go.disabled = true;
      go.innerHTML = `<span class="spin"></span>${$t('Taranıyor…')}`;
      const r = await invoke('storage_scan').catch((e) => { toast($t(String(e)), 'err'); return null; });
      if (!root.isConnected) return;
      go.disabled = false;
      go.textContent = $t('Yeniden tara');
      if (r) parts = r.parts || [];
      paint();
    };
    return use('storage', (x) => { d = x; paint(); });
  });
}

const tState = (c) => (c == null ? ['-', 'mut'] : c < 60 ? [$t('Normal'), 'good'] : c < 80 ? [$t('Ilık'), 'warn'] : [$t('Sıcak'), 'bad']);
def('temp', $t('Sıcaklık'), 'sys', 'therm', $t('İşlemci ısısı, CPU ve RAM yükü; Windows’un paylaştığı sensörlerden.'), (el) => {
  hov(el, () => openTemp(el));
  const c = 2 * Math.PI * 14.4;
  el.innerHTML = `<div class="tring">${ringSvg(0, 32, 'var(--fg3)')}<span>–</span></div><div class="ubars u3"><span class="k">CPU</span><div class="bar"><i style="width:0%"></i></div><span class="v">0%</span><span class="k">RAM</span><div class="bar"><i style="width:0%"></i></div><span class="v">0%</span></div>`;
  const arc = el.querySelectorAll('.tring circle')[1], deg = el.querySelector('.tring span');
  const bars = el.querySelectorAll('.bar > i'), vals = el.querySelectorAll('.v');
  let st = null, tp = null;
  const draw = () => {
    const t = tp?.hot, cls = tState(t)[1], p = t == null ? 0 : Math.min(100, Math.max(0, ((t - 30) / 70) * 100));
    arc.setAttribute('stroke', cls === 'mut' ? 'var(--fg3)' : `var(--${cls})`);
    arc.setAttribute('stroke-dashoffset', String(c * (1 - Math.min(1, p / 100))));
    deg.textContent = t == null ? '–' : Math.round(t) + '°';
    const cpu = st ? Math.round(st.cpu) : 0, ram = st ? Math.round((st.ram_used / st.ram_total) * 100) : 0;
    // unchanged numbers are not rewritten: every write repaints the whole transparent dock
    [cpu, ram].forEach((v, i) => { if (vals[i].textContent !== v + '%') { bars[i].style.width = v + '%'; vals[i].textContent = v + '%'; } });
  };
  const a = use('temps', (x) => { tp = x; draw(); }), b = use('stats', (x) => { st = x; draw(); });
  return () => { a(); b(); };
});
// The same idea in three rows (CPU, GPU, RAM) with each part's temperature as a badge on the right.
def('tempgpu', $t('Sıcaklık + GPU'), 'sys', 'therm', $t('CPU, GPU ve RAM yükü; işlemci ve ekran kartı ısısı yanında.'), (el) => {
  hov(el, () => openTemp(el));
  const row = (k) => `<span class="k">${k}</span><div class="bar"><i style="width:0%"></i></div><span class="v">0%</span><span class="tpill"></span>`;
  el.innerHTML = `<div class="ubars u4">${row('CPU')}${row('GPU')}${row('RAM')}</div>`;
  const bars = el.querySelectorAll('.bar > i'), vals = el.querySelectorAll('.v'), pills = el.querySelectorAll('.tpill');
  let st = null, tp = null, gp = null;
  const pill = (b, c) => {
    const txt = c == null ? '' : Math.round(c) + '°', cls = `tpill${c == null ? '' : ' ' + tState(c)[1]}`;
    if (b.textContent !== txt) b.textContent = txt;
    if (b.className !== cls) b.className = cls;
  };
  const draw = () => {
    const v = [st ? Math.round(st.cpu) : 0, gp ? Math.round(gp.load) : 0, st ? Math.round((st.ram_used / st.ram_total) * 100) : 0];
    // unchanged numbers are not rewritten: every write repaints the whole transparent dock
    v.forEach((x, i) => { if (vals[i].textContent !== x + '%') { bars[i].style.width = x + '%'; vals[i].textContent = x + '%'; } });
    pill(pills[0], tp?.hot);
    pill(pills[1], tp?.gpu);
  };
  const a = use('temps', (x) => { tp = x; draw(); }), b = use('stats', (x) => { st = x; draw(); }), c = use('gpu', (x) => { gp = x; draw(); });
  return () => { a(); b(); c(); };
});
function openTemp(anchor) {
  openPanel('temp', anchor, { w: 440, h: 392, cls: 'flat' }, (root, close) => {
    root.innerHTML = `<div class="ph-head"><div class="title">${$t('Sıcaklık')}</div><span class="sub faint src"></span><div class="grow"></div><button class="ibtn x">${icon('close', 15)}</button></div>
      <div class="ph-body"><div class="between"><div class="big-num c">–</div><span class="st"></span></div><div class="tchart"></div><div class="between sub faint" style="padding-right:30px"><span>${$t('10 dk önce')}</span><span>${$t('Şimdi')}</span></div></div>
      <div class="ph-body fill tcols"><div class="sens"></div><div class="load"></div></div>
      <div class="pft"><span class="note"></span><div class="grow"></div><button class="tbtn lhm" style="display:none">${$t('Gerçek sıcaklığı aç')}</button></div>`;
    const lb = root.querySelector('.lhm');
    lb.onclick = async () => {
      blip(); lb.disabled = true; lb.textContent = $t('Yönetici onayı bekleniyor…');
      try { await invoke('lhm_start'); lb.textContent = $t('Başlatılıyor…'); toast($t('LibreHardwareMonitor artık arka planda kendiliğinden çalışacak')); setTimeout(() => refresh('temps'), 8000); }
      catch (e) { lb.disabled = false; lb.textContent = $t('Gerçek sıcaklığı aç'); toast($t(String(e)), 'err'); }
    };
    root.querySelector('.x').onclick = close;
    const kv = (k, v, cls = '') => `<div class="kv"><span>${k}</span><b class="${cls}">${v}</b></div>`;
    // the 60° and 80° bands are the same limits tState names, so the line reads without a legend
    const curve = (vals) => {
      if (vals.length < 2) return `<div class="empty"><span class="sub">${$t('Veri toplanıyor…')}</span></div>`;
      const W = 378, H = 104, lo = Math.min(40, ...vals) - 2, hi = Math.max(88, ...vals) + 2;
      const y = (v) => H - ((v - lo) / (hi - lo)) * H;
      const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      return `<svg viewBox="0 0 408 ${H}" width="100%" height="${H}"><rect width="${W}" height="${y(80)}" fill="var(--bad)" opacity=".12"/><rect y="${y(80)}" width="${W}" height="${y(60) - y(80)}" fill="var(--warn)" opacity=".09"/>${[80, 60, 40].map((v) => `<text x="386" y="${y(v) + 3}">${v}°</text>`).join('')}<polyline points="${pts}" fill="none" stroke="var(--fg)" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
    };
    const a = use('temps', (t) => {
      if (!t) return;
      const [lbl, cls] = tState(t.hot);
      const real = t.source === 'lhm';
      root.querySelector('.src').textContent = real ? $t('İşlemci paketi') : $t('Anakart ısı bölgesi (tahmini)');
      root.querySelector('.note').textContent = real ? $t('LibreHardwareMonitor sensörlerinden, arka planda okunur.') : t.task ? $t('LibreHardwareMonitor başlatılıyor…') : $t('Bir kez yönetici onayı ver; sonra hep arka planda çalışır.');
      lb.style.display = real || !t.lhm || t.task ? 'none' : '';
      root.querySelector('.c').innerHTML = t.hot == null ? '–' : `${Math.round(t.hot)}<small>°C</small>`;
      const tag = root.querySelector('.st'); tag.textContent = t.hot == null ? $t('Sensör yok') : lbl; tag.className = `st ${cls === 'mut' ? 'faint' : cls}`;
      root.querySelector('.tchart').innerHTML = t.hot == null ? `<div class="empty"><b>${$t('Bu bilgisayar ısı sensörü paylaşmıyor')}</b><span class="sub">${$t('Masaüstü anakartları çoğu zaman Windows’a ısı bölgesi açmaz.')}</span></div>` : curve(t.hist);
      root.querySelector('.sens').innerHTML = t.zones.map((z, i) => kv(real ? esc($t(z.name)) : `${$t('Bölge')} ${i + 1}`, `${Math.round(z.c)}°`, z.c >= 60 ? tState(z.c)[1] : '')).join('') || kv($t('Sensör yok'), '–');
    });
    const b = use('stats', (s) => {
      if (!s) return;
      root.querySelector('.load').innerHTML = kv($t('CPU yükü'), `${Math.round(s.cpu)}%`) + kv($t('Bellek'), `${(s.ram_used / 1073741824).toFixed(1)} / ${Math.round(s.ram_total / 1073741824)} GB`);
    });
    return () => { a(); b(); };
  });
}

// =============== media & weather ===============
def('nowplaying', $t('Şimdi Çalıyor'), 'media', 'play', $t('Çalan şarkı, kapak rengi ve kontroller.'), (el) => {
  el.classList.add('w-np');
  el.innerHTML = `<div class="art"></div><div class="stack grow"><span class="lbl marquee"></span><span class="sub marquee"></span></div><button class="ctl p">${icon('prev', 13)}</button><button class="ctl pp">${icon('play', 14)}</button><button class="ctl n">${icon('next', 13)}</button><div class="prog"><i></i></div>`;
  const art = el.querySelector('.art'), [t1, t2] = el.querySelectorAll('.marquee'), pp = el.querySelector('.pp'), prog = el.querySelector('.prog i');
  const cmd = (c) => (e) => { e.stopPropagation(); blip(); invoke('media_cmd', { cmd: c }); if (c === 'toggle' && m) { m.playing = !m.playing; pp.innerHTML = icon(m.playing ? 'pause' : 'play', 14); } };
  el.querySelector('.p').onclick = cmd('prev');
  el.querySelector('.n').onclick = cmd('next');
  pp.onclick = cmd('toggle');
  el.onclick = () => m && openMedia(el);
  let m = null, at = 0, lastArt = 0;
  const off = use('media', (x) => {
    m = x; at = Date.now();
    el.classList.toggle('idle', !m);
    if (!m) { t1.textContent = $t('Sessiz'); t2.textContent = $t('Bir şey çal'); art.style.backgroundImage = ''; art.innerHTML = icon('play', 14); pp.innerHTML = icon('play', 14); el.style.removeProperty('--np1'); el.style.removeProperty('--np2'); return; }
    art.innerHTML = '';
    t1.textContent = m.title; t2.textContent = m.artist || m.app.split('!').pop();
    pp.innerHTML = icon(m.playing ? 'pause' : 'play', 14);
    if (m.art !== lastArt) {
      lastArt = m.art;
      const url = `${SD}/art?k=${m.art}`;
      art.style.backgroundImage = `url("${url}")`;
      tintFrom(url).then(([a, b]) => { el.style.setProperty('--np1', a); el.style.setProperty('--np2', b); });
    }
  });
  const t = onTick(() => {
    if (!m || !m.dur) return (prog.style.width = '0');
    const pos = m.pos + (m.playing ? (Date.now() - at) / 1000 : 0);
    prog.style.width = Math.min(100, (pos / m.dur) * 100) + '%';
  });
  return () => { off(); t(); };
});
async function tintFrom(url) {
  try {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.src = url;
    await im.decode();
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const g = c.getContext('2d');
    g.drawImage(im, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { const s = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); const w = 1 + s / 40; r += d[i] * w; gg += d[i + 1] * w; b += d[i + 2] * w; n += w; }
    r /= n; gg /= n; b /= n;
    const k = 0.62;
    return [`rgb(${r * k | 0},${gg * k | 0},${b * k | 0})`, `rgb(${r * k * 0.6 | 0},${gg * k * 0.6 | 0},${b * k * 0.6 | 0})`];
  } catch { return ['#3a3f4c', '#262a33']; }
}
function openMedia(anchor) {
  openPanel('media', anchor, { w: 300, h: 424 }, (root) => {
    root.innerHTML = `<div class="mp"><div class="cover"></div><div class="t1"></div><div class="t2"></div><div class="meter"><i></i></div><div class="between sub times"><span></span><span></span></div><div class="mctl"><button class="ibtn p">${icon('prev', 18)}</button><button class="ibtn pp">${icon('play', 22)}</button><button class="ibtn n">${icon('next', 18)}</button></div></div>`;
    const [box, cv, t1, t2, bar, pp] = ['.mp', '.cover', '.t1', '.t2', '.meter i', '.pp'].map((s) => root.querySelector(s));
    const [gone, left] = root.querySelectorAll('.times span');
    root.querySelector('.p').onclick = () => invoke('media_cmd', { cmd: 'prev' });
    root.querySelector('.n').onclick = () => invoke('media_cmd', { cmd: 'next' });
    pp.onclick = () => invoke('media_cmd', { cmd: 'toggle' });
    let m, at, lastArt;
    const mmssOf = (sec) => `${Math.floor(sec / 60)}:${pad2(Math.floor(sec % 60))}`;
    const tick = () => {
      if (!m?.dur) { gone.textContent = left.textContent = ''; return; }
      const pos = Math.min(m.dur, m.pos + (m.playing ? (Date.now() - at) / 1000 : 0));
      bar.style.width = (pos / m.dur) * 100 + '%';
      gone.textContent = mmssOf(pos);
      left.textContent = '−' + mmssOf(m.dur - pos);
    };
    const a = use('media', (x) => {
      m = x; at = Date.now();
      if (!m) return;
      const url = `${SD}/art?k=${m.art}`;
      cv.style.backgroundImage = `url("${url}")`;
      if (m.art !== lastArt) { lastArt = m.art; tintFrom(url).then(([c]) => box.style.setProperty('--np', c)); }
      t1.textContent = m.title; t2.textContent = m.artist; pp.innerHTML = icon(m.playing ? 'pause' : 'play', 22);
      tick();
    });
    const b = onTick(tick);
    return () => { a(); b(); };
  });
}

function wxClass(c) {
  const k = wxKind(c.weather_code, c.is_day);
  return !c.is_day ? 'night' : k === 'rain' || k === 'storm' ? 'rainy' : k === 'cloud' || k === 'fog' ? 'gray' : '';
}
def('weather', $t('Hava Durumu'), 'media', 'sun', $t('Şehrin hava durumu; tıklayınca saatlik ve haftalık.'), (el) => {
  el.classList.add('w-weather');
  hov(el, () => openWeather(el));
  return use('weather', (w, err) => {
    if (!w) { el.innerHTML = `<span class="sub">${err ? $t('Hava alınamadı') : '...'}</span>`; return; }
    const c = w.current, wc = wxClass(c);
    el.classList.remove('night', 'gray', 'rainy');
    if (wc) el.classList.add(wc);
    el.innerHTML = `<div class="stack"><span class="lbl">${WX_TEXT[wxKind(c.weather_code, c.is_day)]}</span><span class="sub">${esc(w.city)}</span></div><span class="deg">${Math.round(c.temperature_2m)}°</span>${wxIcon(wxKind(c.weather_code, c.is_day), 30)}`;
  });
});
def('hourly', $t('Saatlik Tahmin'), 'media', 'sun', $t('Önümüzdeki saatlerin sıcaklığı.'), (el) => {
  hov(el, () => openWeather(el));
  return use('weather', (w) => {
    if (!w) return;
    const i0 = w.hourly.time.findIndex((t) => new Date(t) > new Date()) - 1;
    el.innerHTML = [0, 1, 2, 3, 4].map((k) => { const i = Math.max(0, i0) + k * 2; return `<div class="stack" style="align-items:center;gap:0"><span class="sub">${k ? pad2(new Date(w.hourly.time[i]).getHours()) : $t('Şimdi')}</span>${wxIcon(wxKind(w.hourly.weather_code[i], w.hourly.is_day[i]), 18)}<span class="lbl">${Math.round(w.hourly.temperature_2m[i])}°</span></div>`; }).join('');
  });
});
def('sun', $t('Gün Doğumu & Batımı'), 'media', 'sunrise', $t('Bugün güneş ne zaman doğup batıyor.'), (el) => {
  hov(el, () => openWeather(el));
  return use('weather', (w) => {
    if (!w) return;
    const f = (s) => s.slice(11, 16);
    el.innerHTML = `<div style="color:#ffb020">${icon('sunrise', 18)}</div><div class="stack"><span class="lbl">↑ ${f(w.daily.sunrise[0])}</span><span class="sub">↓ ${f(w.daily.sunset[0])}</span></div>`;
  });
});
// temperature to colour, cold blue through green and amber to red, for the weekly range bars
const tempColor = (c) => `hsl(${Math.round(Math.max(0, Math.min(215, 215 - ((c + 2) / 34) * 205)))} 78% 62%)`;
function openWeather(anchor) {
  openPanel('weather', anchor, { w: 330, h: 446, cls: 'flat' }, (root) => use('weather', (w) => {
    if (!w) return;
    const c = w.current;
    const i0 = Math.max(0, w.hourly.time.findIndex((t) => new Date(t) > new Date()) - 1);
    const lo = Math.min(...w.daily.temperature_2m_min), hi = Math.max(...w.daily.temperature_2m_max);
    const at = (v) => ((v - lo) / (hi - lo || 1)) * 100;
    const hours = [0, 1, 2, 3, 4, 5].map((k) => { const i = i0 + k * 2; return { x: 22 + k * 51, i, t: w.hourly.temperature_2m[i] }; });
    const tMin = Math.min(...hours.map((p) => p.t)), tMax = Math.max(...hours.map((p) => p.t));
    hours.forEach((p) => (p.y = 18 + (1 - (p.t - tMin) / (tMax - tMin || 1)) * 24));
    // a smooth curve: every segment leaves and arrives horizontally
    const path = hours.map((p, k) => (k ? `C${hours[k - 1].x + 25},${hours[k - 1].y} ${p.x - 25},${p.y} ${p.x},${p.y}` : `M${p.x},${p.y}`)).join(' ');
    root.innerHTML = `<div class="ph-head"><div class="title">${esc(w.city)}</div><div class="grow"></div><button class="tbtn quiet chg">${$t('Şehri değiştir')}</button></div>
    <div class="ph-body"><div class="between" style="align-items:center"><div class="row" style="gap:10px"><span class="wx-now">${Math.round(c.temperature_2m)}°</span>${wxIcon(wxKind(c.weather_code, c.is_day), 40)}</div><div class="wx-cond"><span>${WX_TEXT[wxKind(c.weather_code, c.is_day)]}</span><span class="sub faint">${$t('hissedilen')} ${Math.round(c.apparent_temperature)}°</span><span class="sub faint">${$t('Nem')} ${c.relative_humidity_2m}${$t('% · Rüzgar')} ${Math.round(c.wind_speed_10m)} ${$t('km/s')}</span></div></div>
    <svg class="wx-curve" viewBox="0 0 298 52" width="100%" height="52"><path d="${path}" fill="none" stroke="#ffc533" stroke-width="1.8"/>${hours.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="2.4" fill="#ffc533"/><text x="${p.x}" y="${p.y - 7}">${Math.round(p.t)}°</text>`).join('')}</svg>
    <div class="wx-hours">${hours.map((p, k) => `<div><span class="sub faint">${k ? pad2(new Date(w.hourly.time[p.i]).getHours()) : $t('Şimdi')}</span>${wxIcon(wxKind(w.hourly.weather_code[p.i], w.hourly.is_day[p.i]), 20)}<span class="sub rain">${w.hourly.precipitation_probability[p.i] >= 20 ? w.hourly.precipitation_probability[p.i] + '%' : ''}</span></div>`).join('')}</div>
    <div class="wx-days">${w.daily.time.map((t, i) => { const d = new Date(t + 'T00:00'); const mn = w.daily.temperature_2m_min[i], mx = w.daily.temperature_2m_max[i]; const now = i ? '' : `<s style="left:${Math.max(0, Math.min(100, at(c.temperature_2m)))}%"></s>`; return `<div class="wx-day"><b>${i ? DAYS[d.getDay()] : $t('Bugün')}</b>${wxIcon(wxKind(w.daily.weather_code[i]), 20)}<span class="faint">${Math.round(mn)}°</span><div class="range"><i style="left:${at(mn)}%;right:${100 - at(mx)}%;background:linear-gradient(90deg,${tempColor(mn)},${tempColor(mx)})"></i>${now}</div><b>${Math.round(mx)}°</b></div>`; }).join('')}</div></div>`;
    root.querySelector('.chg').onclick = () => { closePanel(); import('./settings.js').then((s) => s.openSettings('weather')); };
  }));
}

// =============== productivity ===============
def('todos', $t('Yapılacaklar'), 'prod', 'todo', $t('Kısa yapılacaklar listesi; Alt+T değil, tek tık.'), (el) => {
  hov(el, () => openTodos(el));
  const draw = () => {
    const open = cfg.todos.filter((t) => !t.done);
    el.innerHTML = `<div style="color:var(--accent)">${icon('todo', 18)}</div><div class="stack" style="max-width:150px"><span class="lbl" style="overflow:hidden;text-overflow:ellipsis">${open[0] ? esc(open[0].text) : $t('Hepsi bitti')}</span><span class="sub">${open.length} ${$t('açık görev')}</span></div>`;
  };
  draw();
  return bus.on('cfg:todos', draw);
});
export function openTodos(anchor) {
  openPanel('todos', anchor, { w: 330, h: 380, cls: 'flat' }, (root) => {
    root.innerHTML = `<div class="ph-head"><div class="title">${$t('Yapılacaklar')}</div><div class="grow"></div><span class="sub mut count"></span></div><div class="ph-body"><input class="line-in" placeholder="${$t('Yeni görev, Enter ile ekle')}"></div><div class="ph-body fill tlist"></div><div class="pft"><span class="done"></span><div class="grow"></div><button class="tbtn quiet clr" title="${$t('Bitenleri temizle')}">${$t('Temizle')}</button></div>`;
    const inp = root.querySelector('input'), list = root.querySelector('.tlist'), clr = root.querySelector('.clr');
    const draw = () => {
      list.innerHTML = '';
      for (const t of cfg.todos) {
        const check = h('button', { class: 'check', 'aria-pressed': t.done, title: t.text, html: icon('check', 11), onclick: () => { blip('ok'); set('todos', cfg.todos.map((x) => (x === t ? { ...x, done: !x.done } : x))); } });
        list.append(h('div', { class: `todo${t.done ? ' done' : ''}` }, check, h('span', {}, t.text), h('button', { class: 'ibtn del', html: icon('close', 13), onclick: () => set('todos', cfg.todos.filter((x) => x !== t)) })));
      }
      const done = cfg.todos.filter((t) => t.done).length;
      root.querySelector('.count').textContent = `${cfg.todos.length - done} ${$t('açık görev')}`;
      root.querySelector('.done').textContent = `${done} ${$t('tamamlandı')}`;
      clr.parentElement.hidden = !done;
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter' && inp.value.trim()) { set('todos', [{ text: inp.value.trim(), done: false, at: Date.now() }, ...cfg.todos]); inp.value = ''; blip('ok'); } };
    clr.onclick = () => set('todos', cfg.todos.filter((t) => !t.done));
    draw();
    setTimeout(() => inp.focus(), 30);
    return bus.on('cfg:todos', draw);
  });
}
def('notes', $t('Notlar'), 'prod', 'note', $t('Hızlı not; yazdığın an kaydedilir.'), (el) => {
  hov(el, () => openPanel('notes', el, { w: 330, h: 300, cls: 'flat' }, (root) => {
    root.innerHTML = `<div class="ph-head"><div class="title">${$t('Notlar')}</div><div class="grow"></div><span class="sub faint">${$t('Yazdıkça kaydedilir')}</span></div><textarea class="paper" placeholder="${$t('Aklındakini yaz...')}"></textarea>`;
    const ta = root.querySelector('textarea');
    ta.value = cfg.notes;
    ta.oninput = () => set('notes', ta.value);
    setTimeout(() => ta.focus(), 30);
  }));
  const draw = () => (el.innerHTML = `<div style="color:#ffc533">${icon('note', 18)}</div><span class="lbl" style="max-width:130px;overflow:hidden;text-overflow:ellipsis">${esc(cfg.notes.split('\n')[0] || $t('Not al'))}</span>`);
  draw();
  return bus.on('cfg:notes', draw);
});
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`; };
def('pomodoro', $t('Pomodoro'), 'prod', 'focus', $t('Odak ve mola döngüsü; halka ile kalan süre.'), (el) => {
  el.innerHTML = `<div class="rg"></div><div class="stack"><span class="sub md"></span><span class="big tm" style="font-size:17px"></span></div><button class="ctl go" style="background:var(--bad);color:#fff;width:28px;height:28px"></button>`;
  const rg = el.querySelector('.rg'), md = el.querySelector('.md'), tm = el.querySelector('.tm'), go = el.querySelector('.go');
  go.onclick = (e) => { e.stopPropagation(); blip(); pomoStart(); };
  el.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); pomoReset(); };
  const draw = () => {
    const p = timers.pomo;
    const total = (p.mode === 'rest' ? cfg.pomodoro.rest : cfg.pomodoro.focus) * 60e3;
    const left = p.mode === 'idle' ? total : p.left || p.end - Date.now();
    md.textContent = p.mode === 'idle' ? $t('Odak') : `${p.mode === 'focus' ? $t('Odak') : $t('Mola')} ${p.round}`;
    tm.textContent = mmss(left);
    rg.innerHTML = ringSvg(((total - left) / total) * 100, 26, p.mode === 'rest' ? 'var(--good)' : 'var(--bad)', 3);
    go.innerHTML = icon(p.mode !== 'idle' && !p.left ? 'pause' : 'play', 13);
  };
  const a = onTick(draw), b = bus.on('timers', draw);
  return () => { a(); b(); };
});
def('timer', $t('Zamanlayıcı'), 'prod', 'timer', $t('Geri sayım; tıkla, süre seç.'), (el) => {
  hov(el, () => {
    const t = timers.timer;
    if (t.end || t.left) return timerStart();
    openPanel('timer', el, { w: 300, h: 158 }, (root, close) => {
      root.innerHTML = `<div class="ph-head"><div class="title">${$t('Zamanlayıcı')}</div></div><div class="tgrid"></div>`;
      for (const m of [1, 3, 5, 10, 15, 25, 45, 60]) root.querySelector('.tgrid').append(h('button', { onclick: () => { timerStart(m); close(); } }, h('b', {}, String(m)), h('small', {}, $t('dk'))));
    });
  });
  el.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); timerReset(); };
  const draw = () => {
    const t = timers.timer;
    const left = t.left || (t.end ? t.end - Date.now() : 0);
    el.innerHTML = `${t.total ? ringSvg(100 - (left / t.total) * 100, 24, 'var(--warn)', 3) : icon('timer', 18)}<div class="stack"><span class="sub">${t.left ? $t('Duraklatıldı') : t.end ? $t('Kalan') : $t('Zamanlayıcı')}</span><span class="lbl" style="font-size:14px">${t.end || t.left ? mmss(left) : $t('Başlat')}</span></div>`;
  };
  const a = onTick(draw), b = bus.on('timers', draw);
  return () => { a(); b(); };
});
def('stopwatch', $t('Kronometre'), 'prod', 'stopwatch', $t('Başlat / durdur; sağ tık sıfırlar.'), (el) => {
  hov(el, swToggle);
  el.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); swReset(); };
  el.innerHTML = `${icon('stopwatch', 18)}<span class="big" style="font-size:15px">00:00.0</span>`;
  const tm = el.querySelector('.big');
  let raf = 0;
  const draw = () => {
    const v = swValue(), s = Math.floor(v / 1000);
    tm.textContent = `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}.${Math.floor((v % 1000) / 100)}`;
    raf = timers.sw.run ? setTimeout(draw, 100) : 0;
  };
  draw();
  const off = bus.on('timers', () => { clearTimeout(raf); draw(); });
  return () => { off(); clearTimeout(raf); };
});

// =============== finance ===============
def('currency', $t('Döviz'), 'fin', 'fx', $t('Canlı kur; ayarlardan para birimini seç.'), (el) => {
  hov(el, () => openSearch(null, `100 ${cfg.fx.from} to ${cfg.fx.to}`));
  return use('fx', (r) => {
    if (!r) return;
    el.innerHTML = `${icon('fx', 16)}<div class="stack"><span class="sub">1 ${cfg.fx.from}</span><span class="lbl" style="font-size:14px">${(r.rates[cfg.fx.to] || 0).toLocaleString(LOCALE, { maximumFractionDigits: 3 })} ${cfg.fx.to}</span></div>`;
  });
});
def('crypto', $t('Kripto'), 'fin', 'coin', $t('Bitcoin ve Ethereum fiyatı, 24 saatlik değişim.'), (el) => {
  hov(el, () => invoke('open_url', { url: `https://www.coingecko.com/en/coins/${cfg.crypto[0] || 'bitcoin'}` }));
  return use('crypto', (r) => {
    if (!r) return;
    el.innerHTML = cfg.crypto.map((id) => { const c = r[id]; if (!c) return ''; const up = c.usd_24h_change >= 0; return `<div class="stack"><span class="sub">${id === 'bitcoin' ? 'BTC' : id === 'ethereum' ? 'ETH' : id.slice(0, 4).toUpperCase()}</span><span class="lbl">$${c.usd.toLocaleString('en-US', { maximumFractionDigits: c.usd > 100 ? 0 : 2 })} <span style="color:${up ? 'var(--good)' : 'var(--bad)'}">${up ? '▲' : '▼'}${Math.abs(c.usd_24h_change).toFixed(1)}%</span></span></div>`; }).join('');
  });
});

// =============== developer ===============
def('github', $t('GitHub Serisi'), 'dev', 'github', $t('Katkı ızgarası ve günlük seri (ayarlardan kullanıcı adı).'), (el) => {
  hov(el, () => (cfg.ghUser ? invoke('open_url', { url: `https://github.com/${cfg.ghUser}` }) : import('./settings.js').then((s) => s.openSettings('dev'))));
  return use('gh', (r) => {
    if (!r) { el.innerHTML = `${icon('github', 16)}<span class="sub">${$t('Kullanıcı adı ekle')}</span>`; return; }
    const c = r.contributions.slice(-14 * 7);
    let streak = 0;
    for (let i = r.contributions.length - 1; i >= 0; i--) { if (r.contributions[i].count) streak++; else if (i < r.contributions.length - 1) break; }
    const today = r.contributions.at(-1)?.count || 0;
    const col = ['var(--line)', '#0e4429', '#006d32', '#26a641', '#39d353'];
    el.innerHTML = `<div class="stack"><span class="sub">${today} ${$t('bugün')}</span><span class="lbl">${streak} ${$t('gün seri')}</span></div><div class="gh">${c.map((d) => `<i style="background:${col[d.level]}"></i>`).join('')}</div>`;
  });
});

// =============== calendar panel ===============
let calMonth = null, calSel = null;
export function openCalendar(anchor) {
  calMonth = new Date(); calMonth.setDate(1); calSel = new Date();
  openPanel('calendar', anchor, { w: 330, h: 476, cls: 'flat' }, (root) => {
    const draw = () => {
      const y = calMonth.getFullYear(), m = calMonth.getMonth();
      const first = new Date(y, m, 1), off = (first.getDay() + 6) % 7;
      const start = new Date(y, m, 1 - off), end = new Date(+start + 42 * 864e5);
      const evs = eventsBetween(start, end, peek('ics'), aiResets());
      const byDay = new Map();
      evs.forEach((e) => { const k = ymd(e.start); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); });
      const tk = ymd(new Date()), sk = ymd(calSel);
      let grid = [1, 2, 3, 4, 5, 6, 0].map((d) => `<div class="dow">${DAYS[d]}</div>`).join('');
      for (let i = 0; i < 42; i++) {
        const d = new Date(y, m, 1 - off + i), k = ymd(d), list = byDay.get(k) || [];
        grid += `<button class="day${d.getMonth() !== m ? ' other' : ''}${k === tk ? ' today' : ''}${k === sk ? ' sel' : ''}" data-k="${k}"><span>${d.getDate()}</span><em>${list.slice(0, 3).map((e) => `<i style="background:${e.color}"></i>`).join('')}</em></button>`;
      }
      const dayEv = byDay.get(sk) || [];
      root.innerHTML = `<div class="ph-head"><div class="title">${MONTHS[m]} ${y}</div><div class="grow"></div><button class="ibtn sync" title="${$t('Takvim aboneliklerini yenile')}">${icon('refresh', 13)}</button><button class="ibtn pv">${icon('chevl', 15)}</button><button class="tbtn quiet td">${$t('Bugün')}</button><button class="ibtn nx">${icon('chevr', 15)}</button></div><div class="cal">${grid}</div>
        <div class="ph-body fill agenda"><div class="between"><span class="sub mut">${calSel.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' })}</span><span class="sub faint">${dayEv.length} ${$t('etkinlik')}</span></div>${dayEv.map((e) => `<div class="ev"><span class="tm">${e.allDay ? $t('Tüm gün') : e.start.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })}</span><i class="bar-v" style="background:${e.color}"></i><span class="what" title="${esc(e.src || '')}">${esc(e.title)}</span>${e.id ? `<button class="ibtn del" data-id="${e.id}">${icon('close', 12)}</button>` : ''}</div>`).join('') || `<p class="faint" style="padding:8px 0">${$t('Boş bir gün.')}</p>`}</div>
        <div class="cal-add"><div class="row"><input class="nt line-in grow" placeholder="${$t('Yeni etkinlik')}"><button class="ibtn add" title="${$t('Ekle')}">${icon('plus', 14)}</button></div><div class="row more"><input class="tt" type="time"><select class="rp"><option value="none">${$t('Tekrar yok')}</option><option value="weekly">${$t('Her hafta')}</option><option value="monthly">${$t('Her ay')}</option><option value="yearly">${$t('Her yıl')}</option></select></div></div>`;
      root.querySelector('.pv').onclick = () => { calMonth.setMonth(m - 1); draw(); };
      root.querySelector('.nx').onclick = () => { calMonth.setMonth(m + 1); draw(); };
      root.querySelector('.td').onclick = () => { calMonth = new Date(); calMonth.setDate(1); calSel = new Date(); draw(); };
      root.querySelector('.sync').onclick = () => { refresh('ics'); toast(cfg.ics.length ? $t('Takvimler yenileniyor') : $t('Ayarlar > Takvim bölümünden iCal bağlantısı ekle')); };
      root.querySelectorAll('.day').forEach((d) => (d.onclick = () => { const [yy, mm, dd] = d.dataset.k.split('-').map(Number); calSel = new Date(yy, mm - 1, dd); draw(); }));
      root.querySelectorAll('.del').forEach((b) => (b.onclick = () => { removeEvent(b.dataset.id); draw(); }));
      const add = () => { const t = root.querySelector('.nt').value.trim(); if (!t) return; addEvent({ title: t, date: ymd(calSel), time: root.querySelector('.tt').value, repeat: root.querySelector('.rp').value, color: cfg.accent }); blip('ok'); draw(); };
      root.querySelector('.add').onclick = add;
      root.querySelector('.nt').onkeydown = (e) => e.key === 'Enter' && add();
    };
    draw();
    const off = use('ics', () => draw());
    return off;
  });
}

void rates;
