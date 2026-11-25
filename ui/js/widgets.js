// Widget registry. Each widget mounts into a dock tile and may open a panel.
import { invoke, listen, use, refresh, onTick, cfg, set, h, esc, pad2, fmtDur, fmtBytes, timeStr, DAYS, MONTHS, iconUrl, SD, bus, blip, toast, ymd, peek } from './core.js';
import { icon, wxIcon, wxKind, WX_TEXT, MARK } from './icons.js';
import { openPanel, closePanel, menu } from './panels.js';
import { mountApps, apps } from './apps.js';
import { timers, pomoStart, pomoReset, timerStart, timerReset, swToggle, swReset, swValue, eventsBetween, addEvent, removeEvent, rates } from './data.js';
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
def('search', $t('Akıllı Arama'), 'core', 'search', $t('Uygulamalar, dosyalar, hesap, çeviri ve ücretsiz AI - Alt+Space.'), (el) => {
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

function openUsage(anchor, name, mark, svc, hint) {
  openPanel('usage-' + svc, anchor, { w: 330, h: 390 }, (root) => {
    root.innerHTML = `<div class="ph-head"><div class="mark" style="width:26px;height:26px">${MARK[mark]}</div><div class="title">${name}</div><span class="sub mut plan"></span><div class="grow"></div><button class="ibtn rf" title="${$t('Yenile')}">${icon('chart', 15)}</button></div><div class="ph-body body"></div>`;
    const body = root.querySelector('.body');
    root.querySelector('.rf').onclick = () => { body.innerHTML = '<div class="spin"></div>'; refresh(svc); };
    return use(svc, (u, err) => {
      if (err && !u) { body.innerHTML = `<div class="sect">${$t('Bağlantı')}</div><p class="mut" style="line-height:1.5">${esc($t(String(err)))}</p><p class="mut" style="line-height:1.5;margin-top:8px">${hint}</p>`; return; }
      if (!u) return;
      root.querySelector('.plan').textContent = u.plan ? String(u.plan).toUpperCase() : '';
      const lb = u.labels || [$t('Oturum (5 saat)'), $t('Haftalık')];
      const row = (k, w) => w ? `<div class="sect">${k}</div><div class="row"><div class="${barCls(w.pct)} grow" style="height:7px"><i style="width:${w.pct}%"></i></div><b style="min-width:38px;text-align:right">${w.pct}%</b></div><div class="sub mut" style="margin-top:5px">${w.reset ? `${$t('Yenilenme')}: ${w.reset.toLocaleString(LOCALE, { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · ${until(w.reset)} ${$t('sonra')}` : ''}${forecast(w)}</div>` : '';
      body.innerHTML = row(lb[0], u.session) + row(lb[1], u.weekly) + paceChart(u.weekly) + row($t('Opus / Sonnet haftalık'), u.opus) + (u.note ? `<p class="sub mut" style="margin-top:10px">${esc(u.note)}</p>` : '');
      if (svc === 'claude') claudeLink(body);
    });
  });
}
// Claude Code hands its own usage numbers to its status line command; linking points that
// command at smartdock, so every reply updates the dock within seconds (no login token used).
async function claudeLink(body) {
  const box = h('div', { class: 'pace-box', style: { display: 'flex', alignItems: 'center', gap: '10px' } });
  body.append(box);
  const draw = (st) => {
    box.innerHTML = `<div class="grow"><div style="font-weight:600;font-size:11.5px">${st.linked ? $t('Claude Code bağlı') : $t('Canlı güncelleme')}</div><div class="sub mut" style="margin-top:2px">${st.linked ? $t('Terminalde her yanıtta; masaüstünde birkaç dakikada bir güncellenir.') : $t('Claude Code durum satırından anlık yüzde al.')}</div></div>`;
    const b = h('button', { class: 'btn' }, st.linked ? $t('Kaldır') : $t('Bağla'));
    b.onclick = async () => {
      blip();
      b.disabled = true;
      try { draw(await invoke('claude_link_set', { on: !st.linked })); toast(st.linked ? $t('Bağlantı kaldırıldı') : $t('Bağlandı · Claude Code’da bir mesaj sonrası güncellenir')); }
      catch (e) { toast($t(String(e))); b.disabled = false; }
    };
    box.append(b);
  };
  try { draw(await invoke('claude_link_get')); } catch { box.remove(); }
}
function paceChart(w) {
  if (!w?.reset || w.pct == null) return '';
  const span = 7 * 86400e3;
  const rem = w.reset - Date.now();
  const elapsed = Math.max(0, Math.min(1, 1 - rem / span));
  if (elapsed <= 0.01) return '';
  const W = 270, H = 72;
  const x = elapsed * W, y = H - (Math.min(100, w.pct) / 100) * H;
  const projPct = w.pct / elapsed;
  const projX = w.pct > 0 ? Math.min(W, (100 / w.pct) * x) : W;
  const projY = w.pct > 0 ? Math.max(0, H - (Math.min(100, projPct) / 100) * H) : H;
  const col = projPct > 130 ? 'var(--bad)' : projPct > 100 ? 'var(--warn)' : 'var(--good)';
  let label = $t('Haftalık tempo dengeli');
  if (projPct > 100) {
    const runOutDate = new Date(Date.now() + ((100 - w.pct) / (w.pct / (elapsed * span))));
    label = `${$t('Bu hızla')} ${runOutDate.toLocaleString(LOCALE, { weekday: 'short', hour: '2-digit', minute: '2-digit' })} ${$t('biter')}`;
  }
  return `<div class="pace-box"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">
    <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="var(--line)" stroke-dasharray="3 3"/>
    <line x1="0" y1="${H}" x2="${W}" y2="0" stroke="var(--fg3)" stroke-opacity="0.35" stroke-dasharray="4 4"/>
    <line x1="0" y1="${H}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${col}" stroke-width="2.2" stroke-linecap="round"/>
    <line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${projX.toFixed(1)}" y2="${projY.toFixed(1)}" stroke="${col}" stroke-width="1.6" stroke-dasharray="4 3" opacity="0.75"/>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${col}" opacity="0.25"/>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.8" fill="${col}"/>
  </svg><div class="pace-foot"><span>${LANG === 'tr' ? `Haftanın %${Math.round(elapsed * 100)}'i geçti` : `${Math.round(elapsed * 100)}% of the week passed`}</span><b style="color:${col}">${label}</b></div></div>`;
}
function forecast(w) {
  if (!w?.reset || w.pct < 5) return '';
  const span = 5 * 3600e3;
  const elapsed = span - (w.reset - Date.now());
  if (elapsed <= 0 || w.reset - Date.now() > span) return '';
  const rate = w.pct / elapsed;
  const runOut = (100 - w.pct) / rate;
  return runOut < w.reset - Date.now() ? ` · <b style="color:var(--warn)">${$t('bu hızla')} ${fmtDur(runOut / 1000)} ${$t('içinde biter')}</b>` : '';
}

// =============== system ===============
const hist = { cpu: [], ram: [], down: [] };
def('cpu', 'CPU', 'sys', 'cpu', $t('İşlemci kullanımı ve mini grafik.'), (el) => {
  hov(el, () => openTop(el, false));
  el.innerHTML = `<div class="stack"><span class="sub">CPU</span><span class="lbl n" style="font-size:14px;min-width:4ch">–</span></div><svg class="spark" width="54" height="20"><polyline points="" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  const num = el.querySelector('.n'), poly = el.querySelector('polyline');
  return use('stats', (s) => {
    if (!s) return;
    hist.cpu.push(s.cpu); if (hist.cpu.length > 30) hist.cpu.shift();
    num.textContent = `${Math.round(s.cpu)}%`;
    poly.setAttribute('points', sparkPts(hist.cpu, 54, 20, 100));
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
function openNet(anchor) {
  openPanel('net', anchor, { w: 300, h: 196 }, (root) => {
    root.innerHTML = `<div class="ph-head"><div style="color:var(--accent)">${icon('net', 18)}</div><div class="title">${$t('Ağ')}</div><div class="grow"></div><button class="btn st">${icon('gear', 14)}${$t('Ayarlar')}</button></div><div class="ph-body"><div class="row" style="justify-content:space-between"><div class="stack"><span class="sub mut">${$t('İndirme')}</span><b class="dn" style="font-size:18px"></b></div><div class="stack" style="align-items:flex-end"><span class="sub mut">${$t('Yükleme')}</span><b class="upv" style="font-size:18px"></b></div></div><div class="gr" style="margin-top:12px"></div></div>`;
    root.querySelector('.st').onclick = () => { invoke('open_url', { url: 'ms-settings:network-status' }); closePanel(); };
    return use('stats', (s) => {
      if (!s) return;
      root.querySelector('.dn').textContent = '↓ ' + netSp(s.down);
      root.querySelector('.upv').textContent = '↑ ' + netSp(s.up);
      root.querySelector('.gr').innerHTML = sparkSvg(hist.down, 268, 70, 'var(--accent)', 1);
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
    hist.down.push(s.down); if (hist.down.length > 40) hist.down.shift();
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
function topList(kind) {
  return (root) => use(kind ? 'topram' : 'topcpu', (list) => {
    if (!list) return;
    root.querySelector('.list').innerHTML = list.map((p) => `<div class="li"><div class="ico">${p.exe ? `<img src="${iconUrl(p.exe, 32)}">` : icon('cpu', 15)}</div><div class="grow t1">${esc(p.name.replace(/\.exe$/i, ''))}</div><span class="hint">${kind ? fmtBytes(p.ram) : p.cpu.toFixed(1) + '%'}</span></div>`).join('');
  });
}
function openTop(anchor, ram) {
  openPanel('top', anchor, { w: 290, h: 280 }, (root) => {
    root.innerHTML = `<div class="ph-head"><div class="title">${ram ? $t('En çok RAM kullananlar') : $t('En çok CPU kullananlar')}</div><div class="grow"></div><button class="btn tm">${icon('task', 14)}${$t('Görev Yöneticisi')}</button></div><div class="ph-body"><div class="list"></div></div>`;
    root.querySelector('.tm').onclick = () => { invoke('launch', { id: 'C:\\Windows\\System32\\Taskmgr.exe' }); closePanel(); };
    return topList(ram)(root);
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
  wf.onclick = () => flip('wifi', wf);
  bt.onclick = () => flip('bluetooth', bt);
  wf.oncontextmenu = (e) => { e.preventDefault(); invoke('open_url', { url: 'ms-settings:network-wifi' }); };
  bt.oncontextmenu = (e) => { e.preventDefault(); openBluetooth(bt); };
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
function openVolume(anchor) {
  openPanel('volume', anchor, { w: 260, h: 104 }, (root) => {
    root.innerHTML = `<div class="ph-head"><div class="title">${$t('Ses')}</div><div class="grow"></div><b class="pct"></b></div><div class="ph-body row"><button class="ibtn m">${icon('vol', 16)}</button><input type="range" min="0" max="100" class="grow"></div>`;
    const r = root.querySelector('input'), pct = root.querySelector('.pct'), m = root.querySelector('.m');
    let t = 0;
    r.oninput = () => { pct.textContent = r.value + '%'; clearTimeout(t); t = setTimeout(() => invoke('volume_set', { level: r.value / 100 }).then(() => refresh('volume')), 30); };
    m.onclick = () => { const v = peek('volume'); invoke('volume_set', { muted: !v?.muted }).then(() => refresh('volume')); };
    return use('volume', (v) => { if (!v) return; if (document.activeElement !== r) r.value = Math.round(v.level * 100); pct.textContent = Math.round(v.level * 100) + '%'; m.innerHTML = icon(v.muted ? 'mute' : 'vol', 16); });
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
  openPanel('recycle', anchor, { w: 280, h: 150 }, (root) => {
    root.innerHTML = `<div class="ph-head"><div>${icon('trash', 18)}</div><div class="title">${$t('Geri Dönüşüm Kutusu')}</div></div><div class="ph-body"><p class="info mut"></p><div class="row" style="margin-top:12px;gap:8px"><button class="btn op grow">${$t('Aç')}</button><button class="btn em grow" style="color:var(--bad)">${$t('Boşalt')}</button></div></div>`;
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
  openPanel('screen', anchor, { w: 660, h: 430, cls: 'big' }, (root, close) => {
    let mode = 'day';
    root.innerHTML = `<div class="ph-head"><div class="title">${$t('Ekran Süresi')}</div><div class="grow"></div><div class="seg"><button data-m="day" class="on">${$t('Gün')}</button><button data-m="week">${$t('Hafta')}</button></div><div class="grow"></div><button class="ibtn x">${icon('close', 15)}</button></div>
      <div class="st-grid"><div class="st-left"><span class="sub when"></span><div class="hero tot"></div><span class="sub cmp"></span><div class="chart"></div><div class="st-facts"></div></div>
      <div class="st-right"><div class="sub sect">${$t('EN ÇOK KULLANILAN')}</div><div class="list scroll top"></div></div></div>`;
    root.querySelector('.x').onclick = close;
    root.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => { blip(); mode = b.dataset.m; root.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b)); draw(peek('screen')); }));
    const bars = (vals, labels, unit) => {
      const mx = Math.max(unit, ...vals);
      return `<div class="bars">${vals.map((v, i) => `<div class="bcol" title="${labels[i]} · ${fmtDur(v)}"><i style="height:${Math.max(v ? 3 : 0, (v / mx) * 100)}%"></i></div>`).join('')}</div><div class="bax">${labels.map((l, i) => `<span>${i % (vals.length > 7 ? 6 : 1) ? '' : l}</span>`).join('')}</div>`;
    };
    const draw = (s) => {
      if (!s?.apps) return;
      const today = Object.values(s.apps).reduce((a, b) => a + b, 0);
      const hist = s.hist || [];
      let apps2 = s.apps, total = today;
      if (mode === 'day') {
        const y = hist[hist.length - 1];
        root.querySelector('.when').textContent = $t('Bugün');
        const d = y ? today - y.total : null;
        root.querySelector('.cmp').innerHTML = d == null ? '' : `${icon(d >= 0 ? 'chevu' : 'chev', 12)} ${$t('düne göre')} ${fmtDur(Math.abs(d))} ${d >= 0 ? $t('fazla') : $t('az')}`;
        root.querySelector('.chart').innerHTML = bars(s.hours || [], [...Array(24)].map((_, i) => pad2(i)), 1800);
        root.querySelector('.st-facts').innerHTML = [
          [$t('En uzun odak'), s.best ? fmtDur(s.best) : '-', s.bestApp ? exeName(s.bestApp) : ''],
          [$t('Uygulama geçişi'), s.switches ?? 0, s.switches && today ? `${Math.max(1, Math.round(today / 60 / s.switches))} ${$t('dk\'da bir')}` : ''],
          [$t('İlk kullanım'), s.first != null ? clockOf(s.first) : '-', ''],
        ].map(([k, v, sub]) => `<div><span class="sub">${k}</span><b>${esc(String(v))}</b><span class="sub">${esc(sub)}</span></div>`).join('');
      } else {
        const days = [...hist.slice(-6), { total: today, apps: s.apps }];
        total = days.reduce((a, d) => a + d.total, 0);
        apps2 = {};
        for (const d of days) for (const [k, v] of Object.entries(d.apps || {})) apps2[k] = (apps2[k] || 0) + v;
        root.querySelector('.when').textContent = `${$t('Son')} ${days.length} ${$t('gün · günde ort.')} ${fmtDur(total / days.length)}`;
        root.querySelector('.cmp').textContent = '';
        const now = new Date();
        const lbl = days.map((_, i) => DAYS[new Date(+now - (days.length - 1 - i) * 864e5).getDay()].slice(0, 3));
        root.querySelector('.chart').innerHTML = bars(days.map((d) => d.total), lbl, 3600);
        root.querySelector('.st-facts').innerHTML = '';
      }
      root.querySelector('.tot').textContent = fmtDur(total);
      const e = Object.entries(apps2).sort((a, b) => b[1] - a[1]), mx = e[0]?.[1] || 1;
      root.querySelector('.top').innerHTML = e.slice(0, 25).map(([p, sec]) => `<div class="li"><div class="ico"><img src="${iconUrl(p, 32)}"></div><div class="grow stack"><div class="row"><span class="t1 grow">${esc(exeName(p))}</span><span class="hint">${fmtDur(sec)}</span></div><div class="bar" style="height:3px"><i style="width:${(sec / mx) * 100}%"></i></div></div></div>`).join('') || `<p class="mut">${$t('Henüz veri yok.')}</p>`;
    };
    return use('screen', draw);
  });
}

// =============== quick settings, bluetooth, storage, temperature ===============
const QS = [
  ['wifi', $t('Wi-Fi'), 'wifi'], ['bluetooth', $t('Bluetooth'), 'bt', 'more'], ['hotspot', $t('Mobil hotspot'), 'hotspot', 'link'],
  ['airplane', $t('Uçak modu'), 'plane'], ['mic', $t('Mikrofon'), 'mic'], ['camera', $t('Kamera'), 'cam'],
  ['awake', $t('Uyanık tut'), 'cup'], ['icons', $t('Masaüstü simgeleri'), 'grid'], ['dark', $t('Koyu mod'), 'moon'],
];
function openQuick(anchor) {
  openPanel('quick', anchor, { w: 300, h: QS.length * 44 + 58 }, (root, close) => {
    root.innerHTML = `<div class="ph-head"><div class="title">${$t('Hızlı Ayarlar')}</div><div class="grow"></div><button class="ibtn x">${icon('close', 15)}</button></div><div class="qs-list"></div>`;
    root.querySelector('.x').onclick = close;
    const list = root.querySelector('.qs-list');
    const rows = {};
    for (const [k, label, ic, kind] of QS) {
      const sw = h('button', { class: 'sw' });
      const r = h('div', { class: 'qrow' }, h('span', { class: 'qi', html: icon(ic, 15) }), h('span', { class: 'grow' }, label), kind === 'link' ? h('span', { class: 'mut', html: icon('chevr', 14) }) : sw);
      if (kind === 'more') r.insertBefore(h('button', { class: 'ibtn', title: $t('Cihazlar'), html: icon('chevr', 14), onclick: (e) => { e.stopPropagation(); openBluetooth(anchor); } }), sw);
      if (kind === 'link') r.onclick = () => { blip(); invoke('open_url', { url: 'ms-settings:network-mobilehotspot' }); close(); };
      else sw.onclick = async () => {
        blip();
        const on = !sw.classList.contains('on');
        sw.classList.toggle('on', on); r.classList.toggle('on', on);
        const ok = await invoke('qs_set', { kind: k, on });
        if (!ok) { sw.classList.toggle('on', !on); r.classList.toggle('on', !on); toast(`${label} ${$t('değiştirilemedi')}`, 'err'); }
        refresh('qs'); if (k === 'wifi' || k === 'bluetooth' || k === 'airplane') refresh('radios');
      };
      rows[k] = [r, sw];
      list.append(r);
    }
    return use('qs', (q) => {
      if (!q) return;
      for (const [k, [r, sw]] of Object.entries(rows)) {
        if (k === 'hotspot') continue;
        const v = q[k];
        r.style.display = v == null ? 'none' : '';
        sw.classList.toggle('on', !!v); r.classList.toggle('on', !!v);
      }
    });
  });
}
function openBluetooth(anchor) {
  openPanel('bt', anchor, { w: 300, h: 330 }, (root, close) => {
    root.innerHTML = `<div class="ph-head"><span class="qi on">${icon('bt', 15)}</span><div class="title">${$t('Bluetooth')}</div><div class="grow"></div><button class="sw pw"></button></div><div class="ph-body scroll" style="height:220px"><div class="list devs"></div></div><div class="pfoot link">${$t('Bluetooth ayarları…')}<span class="grow"></span>${icon('chevr', 14)}</div>`;
    const pw = root.querySelector('.pw'), devs = root.querySelector('.devs');
    root.querySelector('.pfoot').onclick = () => { blip(); invoke('open_url', { url: 'ms-settings:bluetooth' }); close(); };
    pw.onclick = async () => {
      blip();
      const on = !pw.classList.contains('on');
      pw.classList.toggle('on', on);
      if (!(await invoke('radio_set', { kind: 'bluetooth', on }))) { pw.classList.toggle('on', !on); toast($t('Bluetooth değiştirilemedi'), 'err'); }
      refresh('radios'); refresh('btdev');
    };
    const empty = (t1, t2) => `<div class="empty"><b>${t1}</b><span class="sub">${t2}</span></div>`;
    const a = use('radios', (r) => r && pw.classList.toggle('on', !!r.bluetooth));
    const b = use('btdev', (list) => {
      if (!list) { devs.innerHTML = empty($t('Aranıyor…'), ''); return; }
      devs.innerHTML = list.length ? list.map((d) => `<div class="li"><div class="ico">${icon('bt', 14)}</div><div class="grow stack"><span class="t1">${esc(d.name)}</span><span class="t2">${d.connected ? $t('Bağlı') : $t('Eşleştirildi')}</span></div>${d.connected ? '<span class="cdot"></span>' : ''}</div>`).join('')
        : empty($t('Eşleştirilmiş cihaz yok'), $t('Yeni cihazı Bluetooth ayarlarından eşleştir.'));
    });
    return () => { a(); b(); };
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
  openPanel('storage', anchor, { w: 420, h: 440 }, (root, close) => {
    root.innerHTML = `<div class="ph-head"><span class="qi big on">${icon('disk', 18)}</span><div class="stack grow"><div class="title">${$t('Depolama')}</div><span class="sub cap"></span></div><button class="ibtn x">${icon('close', 15)}</button></div>
      <div class="ph-body"><div class="row" style="align-items:baseline;gap:6px"><span class="hero fr"></span><span class="sub">${$t('boş')}</span><div class="grow"></div><span class="sub used"></span></div><div class="sbar"></div><div class="legend"></div></div>
      <div class="scan"></div><div class="pfoot"><span class="sub note">${$t('Tarama başlatılana kadar hiçbir şey ölçülmez.')}</span><div class="grow"></div><button class="btn pc">${$t('Bu Bilgisayar')}</button></div>`;
    root.querySelector('.x').onclick = close;
    root.querySelector('.pc').onclick = () => { blip(); invoke('open_path', { path: 'shell:MyComputerFolder' }); close(); };
    const scan = root.querySelector('.scan');
    let d = null, parts = null;
    const paint = () => {
      if (!d?.total) return;
      const used = d.total - d.free;
      root.querySelector('.cap').textContent = `${$t('Yerel Disk')} (${d.drive}) · ${fmtBytes(d.total)}`;
      root.querySelector('.fr').textContent = fmtBytes(d.free);
      root.querySelector('.used').textContent = `${fmtBytes(used)} ${$t('kullanılan')} · ${Math.round((used / d.total) * 100)}%`;
      const top = parts ? parts.slice(0, 7) : [];
      const segs = parts ? [...top, { name: $t('Diğer'), bytes: Math.max(0, used - top.reduce((a, x) => a + x.bytes, 0)) }] : [{ name: $t('Kullanılan'), bytes: used }];
      root.querySelector('.sbar').innerHTML = segs.map((x, i) => `<i style="flex:${x.bytes};background:${parts ? STOR_COL[i] : 'var(--accent)'}" title="${esc(x.name)} · ${fmtBytes(x.bytes)}"></i>`).join('') + `<i class="free" style="flex:${d.free}"></i>`;
      root.querySelector('.legend').innerHTML = parts ? segs.map((x, i) => `<span><b style="background:${STOR_COL[i]}"></b>${esc(x.name)} <em>${fmtBytes(x.bytes)}</em></span>`).join('') : '';
    };
    scan.innerHTML = `<div class="empty"><span class="qi big on">${icon('disk', 18)}</span><b>${$t('Diski neyin doldurduğunu gör')}</b><span class="sub">${$t('Tarama sistem sürücüsündeki tüm dosyaları gezer; yaklaşık 15-20 sn disk ve işlemci kullanır. Sonuç 5 dakika saklanır.')}</span><div class="row" style="gap:8px;margin-top:6px"><button class="btn pri go">${$t('Şimdi tara')}</button><button class="btn no">${$t('Şimdi değil')}</button></div></div>`;
    scan.querySelector('.no').onclick = close;
    scan.querySelector('.go').onclick = async () => {
      blip();
      scan.innerHTML = `<div class="empty"><div class="spin"></div><b>${$t('Taranıyor…')}</b><span class="sub">${$t('Paneli kapatabilirsin; tekrar açınca sonuç hazır olur.')}</span></div>`;
      const r = await invoke('storage_scan');
      if (!root.isConnected) return;
      parts = r?.parts || [];
      root.querySelector('.note').textContent = $t('Son tarama · 5 dakika geçerli');
      scan.innerHTML = `<div class="list scroll" style="max-height:150px;padding:0 14px">${parts.slice(0, 7).map((x, i) => `<div class="li"><b class="sdot" style="background:${STOR_COL[i]}"></b><span class="t1 grow">${esc(x.name)}</span><span class="hint">${fmtBytes(x.bytes)}</span></div>`).join('')}</div>`;
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
function openTemp(anchor) {
  openPanel('temp', anchor, { w: 580, h: 360, cls: 'big' }, (root, close) => {
    root.innerHTML = `<div class="ph-head"><div class="title">${$t('Sıcaklık')}</div><div class="grow"></div><button class="ibtn x">${icon('close', 15)}</button></div>
      <div class="st-grid"><div class="st-left"><span class="sub src">${$t('İşlemci')}</span><div class="row" style="align-items:center;gap:10px"><span class="hero c"></span><span class="tag st"></span></div><div class="tchart"></div><div class="row sub" style="justify-content:space-between"><span>${$t('10 dk önce')}</span><span>${$t('Şimdi')}</span></div></div>
      <div class="st-right"><div class="sub sect">${$t('SENSÖRLER')}</div><div class="sens"></div><div class="sub sect" style="margin-top:14px">${$t('YÜK')}</div><div class="load"></div></div></div>
      <div class="pfoot"><span class="sub note"></span><div class="grow"></div><button class="btn pri lhm" style="display:none">${$t('Gerçek sıcaklığı aç')}</button></div>`;
    const lb = root.querySelector('.lhm');
    lb.onclick = async () => {
      blip(); lb.disabled = true; lb.textContent = $t('Yönetici onayı bekleniyor…');
      try { await invoke('lhm_start'); lb.textContent = $t('Başlatılıyor…'); toast($t('LibreHardwareMonitor artık arka planda kendiliğinden çalışacak')); setTimeout(() => refresh('temps'), 8000); }
      catch (e) { lb.disabled = false; lb.textContent = $t('Gerçek sıcaklığı aç'); toast($t(String(e)), 'err'); }
    };
    root.querySelector('.x').onclick = close;
    const row = (k, v, p, col) => `<div class="mrow"><div class="row"><span class="grow">${k}</span><b>${v}</b></div><div class="bar" style="height:4px"><i style="width:${p}%;background:${col}"></i></div></div>`;
    const line = (vals) => {
      if (vals.length < 2) return `<div class="empty"><span class="sub">${$t('Veri toplanıyor…')}</span></div>`;
      const W = 300, H = 150, lo = Math.min(...vals) - 3, hi = Math.max(...vals) + 3;
      const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * W).toFixed(1)},${(H - ((v - lo) / (hi - lo)) * H).toFixed(1)}`).join(' ');
      return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="${H}"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg><div class="tax"><span>${Math.round(hi)}°</span><span>${Math.round(lo)}°</span></div>`;
    };
    const a = use('temps', (t) => {
      if (!t) return;
      const [lbl, cls] = tState(t.hot);
      const real = t.source === 'lhm';
      root.querySelector('.src').textContent = real ? $t('İşlemci paketi') : $t('Anakart ısı bölgesi (tahmini)');
      root.querySelector('.note').textContent = real ? $t('LibreHardwareMonitor sensörlerinden, arka planda okunur.') : t.task ? $t('LibreHardwareMonitor başlatılıyor…') : $t('Bir kez yönetici onayı ver; sonra hep arka planda çalışır.');
      lb.style.display = real || !t.lhm || t.task ? 'none' : '';
      root.querySelector('.c').textContent = t.hot == null ? '–' : `${Math.round(t.hot)}°C`;
      const tag = root.querySelector('.st'); tag.textContent = t.hot == null ? $t('Sensör yok') : lbl; tag.className = `tag st ${cls}`;
      root.querySelector('.tchart').innerHTML = t.hot == null ? `<div class="empty"><b>${$t('Bu bilgisayar ısı sensörü paylaşmıyor')}</b><span class="sub">${$t('Masaüstü anakartları çoğu zaman Windows’a ısı bölgesi açmaz.')}</span></div>` : line(t.hist);
      root.querySelector('.sens').innerHTML = t.zones.map((z, i) => row(t.source === 'lhm' ? esc($t(z.name)) : `${$t('Bölge')} ${i + 1}`, `${Math.round(z.c)}°`, Math.min(100, z.c), `var(--${tState(z.c)[1]})`)).join('') || `<span class="sub">${$t('Yok')}</span>`;
    });
    const b = use('stats', (s) => {
      if (!s) return;
      const rp = (s.ram_used / s.ram_total) * 100;
      root.querySelector('.load').innerHTML = row('CPU', `${Math.round(s.cpu)}%`, s.cpu, 'var(--accent)') + row(`${$t('Bellek')} · ${(s.ram_used / 1073741824).toFixed(1)} / ${Math.round(s.ram_total / 1073741824)} GB`, `${Math.round(rp)}%`, rp, 'var(--accent)');
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
  openPanel('media', anchor, { w: 300, h: 360 }, (root) => {
    root.innerHTML = `<div class="ph-body" style="padding:14px"><div class="cover" style="width:100%;aspect-ratio:1;border-radius:14px;background:var(--panel-2) center/cover;margin-bottom:12px"></div><div class="t1" style="font-size:14px;font-weight:700"></div><div class="t2 mut" style="margin:2px 0 10px"></div><div class="bar" style="height:4px"><i style="background:var(--fg)"></i></div><div class="row" style="justify-content:center;gap:18px;margin-top:10px"><button class="ibtn p">${icon('prev', 18)}</button><button class="ibtn pp" style="width:40px;height:40px;border-radius:50%;background:var(--panel-2)">${icon('play', 18)}</button><button class="ibtn n">${icon('next', 18)}</button></div></div>`;
    const [cv, t1, t2, bar, pp] = ['.cover', '.t1', '.t2', '.bar i', '.pp'].map((s) => root.querySelector(s));
    root.querySelector('.p').onclick = () => invoke('media_cmd', { cmd: 'prev' });
    root.querySelector('.n').onclick = () => invoke('media_cmd', { cmd: 'next' });
    pp.onclick = () => invoke('media_cmd', { cmd: 'toggle' });
    let m, at;
    const a = use('media', (x) => { m = x; at = Date.now(); if (!m) return; cv.style.backgroundImage = `url("${SD}/art?k=${m.art}")`; t1.textContent = m.title; t2.textContent = m.artist; pp.innerHTML = icon(m.playing ? 'pause' : 'play', 18); });
    const b = onTick(() => { if (m?.dur) bar.style.width = Math.min(100, ((m.pos + (m.playing ? (Date.now() - at) / 1000 : 0)) / m.dur) * 100) + '%'; });
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
function openWeather(anchor) {
  openPanel('weather', anchor, { w: 330, h: 468 }, (root) => use('weather', (w) => {
    if (!w) return;
    const c = w.current;
    const i0 = Math.max(0, w.hourly.time.findIndex((t) => new Date(t) > new Date()) - 1);
    const lo = Math.min(...w.daily.temperature_2m_min), hi = Math.max(...w.daily.temperature_2m_max);
    root.innerHTML = `<div class="ph-head">${wxIcon(wxKind(c.weather_code, c.is_day), 42)}<div class="stack"><div class="title">${esc(w.city)}</div><span class="mut">${WX_TEXT[wxKind(c.weather_code, c.is_day)]} · ${$t('hissedilen')} ${Math.round(c.apparent_temperature)}°</span></div><div class="grow"></div><span style="font:300 34px var(--font-d);letter-spacing:-1.5px">${Math.round(c.temperature_2m)}°</span></div>
    <div class="ph-body"><div class="row" style="justify-content:space-between;padding:6px 0 10px;border-bottom:1px solid var(--line)">${[...Array(6)].map((_, k) => { const i = i0 + k * 2; return `<div class="stack" style="align-items:center;gap:3px"><span class="sub mut">${k ? pad2(new Date(w.hourly.time[i]).getHours()) : $t('Şimdi')}</span>${wxIcon(wxKind(w.hourly.weather_code[i], w.hourly.is_day[i]), 22)}<b>${Math.round(w.hourly.temperature_2m[i])}°</b><span class="sub" style="color:#6cb7ff">${w.hourly.precipitation_probability[i] >= 20 ? w.hourly.precipitation_probability[i] + '%' : ''}</span></div>`; }).join('')}</div>
    <div class="list" style="margin-top:6px">${w.daily.time.map((t, i) => { const d = new Date(t); const a = ((w.daily.temperature_2m_min[i] - lo) / (hi - lo || 1)) * 100, b = ((w.daily.temperature_2m_max[i] - lo) / (hi - lo || 1)) * 100; return `<div class="li" style="min-height:34px;padding:4px 6px"><span style="width:44px;font-weight:600">${i ? DAYS[d.getDay()] : $t('Bugün')}</span>${wxIcon(wxKind(w.daily.weather_code[i]), 22)}<span class="mut" style="width:34px;text-align:right">${Math.round(w.daily.temperature_2m_min[i])}°</span><div class="grow" style="height:4px;border-radius:3px;background:var(--line);position:relative"><i style="position:absolute;left:${a}%;right:${100 - b}%;top:0;bottom:0;border-radius:3px;background:linear-gradient(90deg,#6cb7ff,#ffc533)"></i></div><b style="width:30px;text-align:right">${Math.round(w.daily.temperature_2m_max[i])}°</b></div>`; }).join('')}</div>
    <div class="row" style="margin-top:8px"><span class="sub mut">${$t('Nem')} ${c.relative_humidity_2m}${$t('% · Rüzgar')} ${Math.round(c.wind_speed_10m)} ${$t('km/s')}</span><div class="grow"></div><button class="btn chg">${$t('Şehri değiştir')}</button></div></div>`;
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
  openPanel('todos', anchor, { w: 320, h: 380 }, (root) => {
    root.innerHTML = `<div class="ph-head"><div class="title">${$t('Yapılacaklar')}</div><div class="grow"></div><button class="ibtn clr" title="${$t('Bitenleri temizle')}">${icon('trash', 15)}</button></div><div class="ph-body"><div class="row"><input class="grow" placeholder="${$t('Yeni görev, Enter ile ekle')}"></div><div class="list scroll" style="margin-top:8px;height:270px"></div></div>`;
    const inp = root.querySelector('input'), list = root.querySelector('.list');
    const draw = () => {
      list.innerHTML = '';
      for (const t of cfg.todos) {
        const row = h('div', { class: 'li' }, h('button', { class: 'ibtn', html: icon(t.done ? 'check' : 'focus', 16), style: { color: t.done ? 'var(--good)' : 'var(--fg3)' }, onclick: () => { blip('ok'); set('todos', cfg.todos.map((x) => (x === t ? { ...x, done: !x.done } : x))); } }), h('span', { class: 'grow t1', style: { textDecoration: t.done ? 'line-through' : '', opacity: t.done ? 0.5 : 1 } }, t.text), h('button', { class: 'ibtn', html: icon('close', 14), onclick: () => set('todos', cfg.todos.filter((x) => x !== t)) }));
        list.append(row);
      }
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter' && inp.value.trim()) { set('todos', [{ text: inp.value.trim(), done: false, at: Date.now() }, ...cfg.todos]); inp.value = ''; blip('ok'); } };
    root.querySelector('.clr').onclick = () => set('todos', cfg.todos.filter((t) => !t.done));
    draw();
    setTimeout(() => inp.focus(), 30);
    return bus.on('cfg:todos', draw);
  });
}
def('notes', $t('Notlar'), 'prod', 'note', $t('Hızlı not; yazdığın an kaydedilir.'), (el) => {
  hov(el, () => openPanel('notes', el, { w: 340, h: 300 }, (root) => {
    root.innerHTML = `<div class="ph-head"><div class="title">${$t('Notlar')}</div></div><div class="ph-body"><textarea style="width:100%;height:236px;resize:none;line-height:1.5" placeholder="${$t('Aklındakini yaz...')}"></textarea></div>`;
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
    openPanel('timer', el, { w: 250, h: 120 }, (root, close) => {
      root.innerHTML = `<div class="ph-head"><div class="title">${$t('Zamanlayıcı')}</div></div><div class="ph-body chips"></div>`;
      for (const m of [1, 3, 5, 10, 15, 25, 45, 60]) root.querySelector('.chips').append(h('button', { class: 'chip', onclick: () => { timerStart(m); close(); } }, `${m} ${$t('dk')}`));
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
  openPanel('calendar', anchor, { w: 700, h: 410 }, (root) => {
    const draw = () => {
      const y = calMonth.getFullYear(), m = calMonth.getMonth();
      const first = new Date(y, m, 1), off = (first.getDay() + 6) % 7;
      const start = new Date(y, m, 1 - off), end = new Date(+start + 42 * 864e5);
      const evs = eventsBetween(start, end, peek('ics'), aiResets());
      const byDay = new Map();
      evs.forEach((e) => { const k = ymd(e.start); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); });
      const tk = ymd(new Date()), sk = ymd(calSel);
      let grid = [1, 2, 3, 4, 5, 6, 0].map((d) => `<div class="dow">${DAYS[d].toLocaleUpperCase(LOCALE)}</div>`).join('');
      for (let i = 0; i < 42; i++) {
        const d = new Date(y, m, 1 - off + i), k = ymd(d), list = byDay.get(k) || [];
        grid += `<div class="day${d.getMonth() !== m ? ' other' : ''}${k === tk ? ' today' : ''}${k === sk ? ' sel' : ''}" data-k="${k}"><span class="num">${d.getDate()}</span><div class="dots">${list.slice(0, 6).map((e) => `<i style="background:${e.color}"></i>`).join('')}</div></div>`;
      }
      const dayEv = byDay.get(sk) || [];
      root.innerHTML = `<div class="cal"><div><div class="ph-head"><div style="color:var(--bad)">${icon('cal', 18)}</div><div class="title">${MONTHS[m]} ${y}</div><div class="grow"></div><button class="btn sync" title="${$t('Takvim aboneliklerini yenile')}">${icon('chart', 13)}${$t('Senkronize')}</button><button class="ibtn pv">${icon('chevl', 16)}</button><button class="btn td">${$t('Bugün')}</button><button class="ibtn nx">${icon('chev', 16)}</button></div><div class="grid">${grid}</div></div>
        <div class="agenda"><div class="row"><b>${calSel.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' })}</b><div class="grow"></div><span class="sub mut">${dayEv.length} ${$t('etkinlik')}</span></div><div class="scroll" style="flex:1;display:flex;flex-direction:column;gap:6px">${dayEv.map((e) => `<div class="ev"><i class="bar-v" style="background:${e.color}"></i><div class="grow"><div class="t1" style="font-size:11.5px;font-weight:600;white-space:normal">${esc(e.title)}</div><div class="sub mut">${e.allDay ? $t('Tüm gün') : e.start.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })} · ${esc(e.src || '')}</div></div>${e.id ? `<button class="ibtn del" data-id="${e.id}">${icon('close', 12)}</button>` : ''}</div>`).join('') || `<p class="mut" style="padding:8px 2px">${$t('Boş bir gün.')}</p>`}</div>
        <div class="stack" style="gap:6px"><input class="nt" placeholder="${$t('Yeni etkinlik')}"><div class="row"><input class="tt" type="time" style="width:84px;padding:6px"><select class="rp" style="flex:1;min-width:0;padding:6px"><option value="none">${$t('Tekrar yok')}</option><option value="weekly">${$t('Her hafta')}</option><option value="monthly">${$t('Her ay')}</option><option value="yearly">${$t('Her yıl')}</option></select><button class="btn pri add">${$t('Ekle')}</button></div></div></div></div>`;
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
