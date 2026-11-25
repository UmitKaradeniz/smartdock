// Apps strip: Start, pinned apps and running windows, with magnification.
import { invoke, listen, iconUrl, SD, use, cfg, set, save, h, blip, toast, bus } from './core.js';
import { START_ICON, icon } from './icons.js';
import { menu, openPanel, closePanel, isOpen } from './panels.js';
import { $t } from './i18n.js';

const low = (s) => (s || '').toLowerCase();
let appList = [];
export async function getApps(refresh = false) {
  appList = await invoke('list_apps', { refresh });
  return appList;
}
export const apps = () => appList;

const isPath = (id) => /^[a-z]:\\/i.test(id);
function pinKey(p) {
  return { id: low(p.id), target: low(p.target || (isPath(p.id) ? p.id : '')) };
}
function matches(win, p) {
  const k = pinKey(p);
  const wa = low(win.aumid), we = low(win.exe);
  return (wa && wa === k.id) || (k.target && we === k.target) || (isPath(k.id) && we === k.id);
}
const groupKey = (w) => low(w.aumid) || low(w.exe);
// UWP hosts and packaged (MSIX) apps: their exe is locked in WindowsApps, the AUMID gives the real icon
const winIcon = (w) => (w.aumid && /applicationframehost|\\windowsapps\\/i.test(w.exe) ? w.aumid : w.exe || w.aumid);
const niceName = (w) => {
  const a = appList.find((x) => low(x.target) === low(w.exe) || low(x.id) === low(w.aumid));
  if (a) return a.name;
  const t = w.title.split(' - ').pop();
  return t.length < 40 ? t : w.exe.split('\\').pop().replace(/\.exe$/i, '');
};

export function pin(app) {
  if (cfg.pinned.some((p) => low(p.id) === low(app.id))) return;
  set('pinned', [...cfg.pinned, { id: app.id, name: app.name, target: app.target || '' }]);
  toast(`${app.name} ${$t('sabitlendi')}`);
}
export function unpin(id) {
  set('pinned', cfg.pinned.filter((p) => low(p.id) !== low(id)));
}
export function launchApp(a) {
  blip();
  invoke('launch', { id: a.id });
}

/** First run: pick familiar apps if they are installed. */
export function defaultPins(list) {
  const want = [/^(file explorer|dosya gezgini)$/i, /^google chrome$/i, /^microsoft edge$/i, /^visual studio code$/i, /^spotify/i, /^discord$/i, /^telegram/i];
  const out = [];
  for (const re of want) {
    const a = list.find((x) => re.test(x.name));
    if (a && !(re.source.includes('edge') && out.some((o) => /chrome/i.test(o.name)))) out.push({ id: a.id, name: a.name, target: a.target });
  }
  return out;
}

// ---------- unread counts: taskbar badges + notification center + window titles + flashing windows ----------
let notifs = { ids: {}, names: {}, badges: {} };
invoke('notif_get').then((n) => { notifs = n; bus.emit('notifs'); }).catch(() => {});
listen('notifs', (n) => { notifs = n; bus.emit('notifs'); });
// "(3) WhatsApp", "Gelen Kutusu (12) - Gmail", "Slack - 4 new items" stay out: only bracketed counts
const titleCount = (t) => +((t.match(/^\s*[([](\d{1,4})[)\]]/) || t.match(/\((\d{1,4})\)(?=\s*(?:[-–—|•·]|$))/) || [])[1] || 0);
// a browser's title is the active tab's ("(1) X'te ..."), not the browser's own unread state
const BROWSER = /\\(chrome|msedge|firefox|brave|opera|vivaldi|arc|zen|librewolf)\.exe$/i;
// Notifications stay in the notification center long after they were read; like a taskbar
// badge, only those newer than the last time the app was in front count.
if (!cfg.notifBase) { cfg.notifBase = Date.now(); save(); }
const seenKeys = (ws, p, name) => [...new Set([p?.id, ...ws.map((w) => w.aumid), p?.name || name].filter(Boolean).map(low))];
function unread(ws, p, name) {
  const keys = seenKeys(ws, p, name);
  const since = Math.max(cfg.notifBase, ...keys.map((k) => cfg.seen[k] || 0));
  const fresh = (a) => (Array.isArray(a) ? a.filter((t) => t > since).length : 0);
  let n = 0;
  for (const k of keys) n = Math.max(n, fresh(notifs.ids?.[k]));
  if (!n) n = fresh(notifs.names?.[low(p?.name || name)]);
  const titled = ws.filter((w) => !BROWSER.test(w.exe)).reduce((s, w) => s + titleCount(w.title), 0);
  // a badge is the app's own unread number: it stays until the app clears it, seen or not
  const badge = Math.max(0, ...keys.map((k) => notifs.badges?.[k] || 0));
  return Math.max(n, titled, badge);
}
/** The app in front has been seen: its badge clears and stays clear until something new arrives. */
function markSeen(keys) {
  const now = Date.now();
  let ch = false;
  for (const k of keys) if (now - (cfg.seen[k] || 0) > 3000) { cfg.seen[k] = now; ch = true; }
  if (ch) save();
}

export function mountApps(el) {
  el.classList.add('w-apps');
  let wins = { list: [], fg: 0, flash: [] };
  let drag = null; // { key, el, x0, moved, list }
  let swallow = false;
  let prevT = 0, closePrevT = 0, prevKey = '';

  const clearPrevT = () => { clearTimeout(prevT); clearTimeout(closePrevT); prevT = closePrevT = 0; };
  const schedClosePrev = () => {
    clearTimeout(prevT); prevT = 0;
    clearTimeout(closePrevT);
    closePrevT = setTimeout(() => { if (isOpen('winprev')) { prevKey = ''; closePanel(); } }, 220);
  };
  const showWinPrev = async (anchor, key, name, icSrc, ws) => {
    if (!anchor.isConnected || document.body.classList.contains('appdrag')) return;
    if (isOpen() && !isOpen('winprev')) return;
    if (isOpen('winprev') && prevKey === key) return;
    if (isOpen('winprev')) closePanel();
    prevKey = key;
    const list = ws.slice(0, 4);
    const w = list.length * 210 + (list.length - 1) * 10 + 20;
    const ts = Date.now();
    await openPanel('winprev', anchor, { w, h: 176, cls: 'winprev' }, (root, close) => {
      root.addEventListener('mouseenter', () => { clearTimeout(closePrevT); closePrevT = 0; });
      root.addEventListener('mouseleave', schedClosePrev);
      for (const win of list) {
        const card = h('div', {
          class: 'wcard',
          onclick: () => { blip(); close(); invoke('activate_window', { hwnd: win.hwnd, toggle: false }); },
        });
        const hd = h('div', { class: 'wcard-hd' },
          h('img', { src: icSrc, alt: '' }),
          h('span', { class: 't1' }, win.title || name),
          h('button', {
            class: 'wcls',
            title: $t('Pencereyi kapat'),
            html: icon('close', 12),
            onclick: (e) => {
              e.stopPropagation();
              blip();
              invoke('close_window', { hwnd: win.hwnd });
              card.remove();
              if (!root.querySelector('.wcard')) close();
            },
          }));
        const thumb = h('div', { class: 'wthumb' });
        // minimized: the frame saved as it was minimized (none if it was minimized before the dock started)
        const shot = h('img', { class: 'shot', src: `${SD}/winprev?hwnd=${win.hwnd}&w=260&t=${ts}`, alt: '' });
        shot.onerror = () => { thumb.innerHTML = `<img class="fb" src="${icSrc}"><span>${win.minimized ? $t('Simge durumunda') : $t('Önizleme yok')}</span>`; };
        thumb.append(shot);
        if (win.minimized) thumb.append(h('i', { class: 'wmin' }, $t('Simge durumunda')));
        card.append(hd, thumb);
        root.append(card);
      }
    });
  };

  const order = (k) => { const i = cfg.runOrder.indexOf(k); return i < 0 ? 1e9 : i; };
  const render = () => {
    if (drag?.moved) return; // the strip is being rearranged; redraw on drop
    el.textContent = '';
    const start = h('div', { class: 'app press', 'data-app': 'start', onclick: () => { blip(); invoke('press_start'); } });
    start.innerHTML = `<div class="start">${START_ICON}</div><div class="tip">${$t('Başlat')}</div>`;
    el.append(start);
    const used = new Set();
    const flash = new Set(wins.flash || []);
    const item = (key, name, img, ws, p) => {
      const a = h('div', { class: 'app' + (ws.length ? ' run' : '') + (ws.length > 1 ? ' multi' : '') + (ws.some((w) => w.hwnd === wins.fg) ? ' fg' : ''), 'data-app': key });
      // exe icons are the most faithful; fall back to the shell's AppsFolder icon, then the running exe
      const chain = [p && /\.exe$/i.test(p.target) && !/\\windowsapps\\/i.test(p.target) ? p.target : null, img, ws[0]?.aumid, ws[0]?.exe].filter(Boolean);
      const im = h('img', { src: iconUrl(chain.shift(), 64), alt: '', draggable: 'false' });
      im.onerror = () => { const n = chain.shift(); if (n) im.src = iconUrl(n, 64); else im.onerror = null; };
      const tipTxt = ws.length === 1 ? ws[0].title.slice(0, 60) : ws.length > 1 ? `${name} · ${ws.length} ${$t('pencere')}` : name;
      a.append(im, h('div', { class: 'tip' }, tipTxt));
      if (ws.length) a.append(h('div', { class: 'dot' }));
      if (ws.some((w) => w.hwnd === wins.fg)) markSeen(seenKeys(ws, p, name));
      const n = unread(ws, p, name);
      if (n) a.append(h('div', { class: 'badge' }, n > 99 ? '99+' : String(n)));
      else if (ws.some((w) => flash.has(w.hwnd))) a.append(h('div', { class: 'badge ping' }));
      a.onclick = () => {
        if (swallow) return;
        clearPrevT();
        if (isOpen('winprev')) { prevKey = ''; closePanel(); }
        blip();
        if (!ws.length) {
          if (p) { a.classList.add('launching'); setTimeout(() => a.classList.remove('launching'), 1100); launchApp(p); }
          return;
        }
        if (ws.length === 1) return invoke('activate_window', { hwnd: ws[0].hwnd, toggle: true });
        const i = ws.findIndex((w) => w.hwnd === wins.fg);
        const next = i < 0 ? ws[0] : ws[(i + 1) % ws.length];
        invoke('activate_window', { hwnd: next.hwnd, toggle: false });
      };
      if (ws.length) {
        a.onmouseenter = () => {
          clearTimeout(closePrevT); closePrevT = 0;
          clearTimeout(prevT);
          prevT = setTimeout(() => showWinPrev(a, key, name, im.currentSrc || im.src, ws), 380);
        };
        a.onmouseleave = schedClosePrev;
      }
      a.onauxclick = (e) => { if (e.button === 1 && p) launchApp(p); };
      a.onmousedown = (e) => { clearPrevT(); if (e.button === 0) drag = { key, el: a, x0: e.clientX, moved: false, pin: p, ws, name, img }; };
      a.oncontextmenu = (e) => {
        clearPrevT();
        e.preventDefault();
        e.stopPropagation();
        const items = [];
        for (const w of ws.slice(0, 6)) items.push({ label: w.title.slice(0, 34) || name, icon: 'window', run: () => invoke('activate_window', { hwnd: w.hwnd, toggle: false }) });
        if (ws.length) items.push('-');
        if (p) items.push({ label: $t('Yeni pencere'), icon: 'plus', run: () => launchApp(p) });
        items.push(p ? { label: $t('Sabitlemeyi kaldır'), icon: 'pin', run: () => unpin(p.id) } : { label: $t('Dock\'a sabitle'), icon: 'pin', run: () => pin({ id: winIcon(ws[0]), name, target: ws[0].exe }) });
        const exe = ws[0]?.exe || p?.target;
        if (exe) items.push({ label: $t('Dosya konumunu aç'), icon: 'folder', run: () => invoke('reveal', { path: exe }) });
        if (ws.length) {
          items.push('-');
          items.push({ label: $t('Görevi sonlandır'), icon: 'power', danger: true, run: () => invoke('kill_pid', { pid: ws[0].pid }) });
          items.push({ label: ws.length > 1 ? $t('Tüm pencereleri kapat') : $t('Pencereyi kapat'), icon: 'close', run: () => ws.forEach((w) => invoke('close_window', { hwnd: w.hwnd })) });
        }
        menu(a, items);
      };
      el.append(a);
      return a;
    };
    for (const p of cfg.pinned) {
      const ws = wins.list.filter((w) => matches(w, p));
      ws.forEach((w) => used.add(w.hwnd));
      item('p:' + p.id, p.name, p.id, ws, p);
    }
    const groups = new Map();
    for (const w of wins.list) {
      if (used.has(w.hwnd)) continue;
      const k = groupKey(w);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(w);
    }
    // running apps keep the slot they first got (EnumWindows order follows focus, so they jumped)
    const fresh = [...groups.keys()].filter((k) => !cfg.runOrder.includes(k));
    if (fresh.length) { cfg.runOrder = [...cfg.runOrder, ...fresh].slice(-80); save(); }
    const keys = [...groups.keys()].sort((a, b) => order(a) - order(b));
    if (groups.size && cfg.pinned.length) el.append(h('div', { class: 'sep' }));
    for (const k of keys) { const ws = groups.get(k); ws.sort((a, b) => a.hwnd - b.hwnd); item('r:' + k, niceName(ws[0]), winIcon(ws[0]), ws, null); }
    bus.emit('apps-rendered');
  };

  // ---------- drag to rearrange (pinned and running), drop a running app among pins to pin it ----------
  const slots = () => [...el.querySelectorAll('.app:not([data-app="start"])')];
  const onMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved) {
      if (Math.abs(dx) < 6) return;
      drag.moved = true;
      document.body.classList.add('appdrag');
      drag.el.classList.add('lift');
      blip();
    }
    drag.el.style.left = dx / (parseFloat(getComputedStyle(el).zoom) || 1) + 'px';
    const list = slots().filter((s) => s !== drag.el);
    let at = list.length;
    for (let i = 0; i < list.length; i++) { const r = list[i].getBoundingClientRect(); if (e.clientX < r.left + r.width / 2) { at = i; break; } }
    list.forEach((s, i) => s.classList.toggle('ins', i === at));
    el.classList.toggle('ins-end', at === list.length);
    const sep = el.querySelector('.sep')?.getBoundingClientRect();
    drag.intoPins = !!sep && e.clientX < sep.left + sep.width / 2;
    drag.at = at; drag.list = list;
  };
  const onUp = () => {
    const d = drag;
    drag = null;
    if (!d?.moved) return;
    swallow = true; setTimeout(() => (swallow = false), 0);
    document.body.classList.remove('appdrag');
    el.classList.remove('ins-end');
    const keys = d.list.map((s) => s.dataset.app);
    keys.splice(d.at, 0, d.key);
    if (d.key.startsWith('r:') && d.intoPins) {
      // running app dropped left of the separator: pin it right there
      const w = d.ws[0];
      const np = { id: winIcon(w), name: d.name, target: w.exe };
      if (!cfg.pinned.some((p) => low(p.id) === low(np.id))) {
        const pins = [...cfg.pinned];
        pins.splice(keys.slice(0, keys.indexOf(d.key)).filter((k) => k.startsWith('p:')).length, 0, np);
        set('pinned', pins);
        toast(`${d.name} ${$t('sabitlendi')}`);
        return;
      }
    }
    const byKey = new Map(cfg.pinned.map((p) => ['p:' + p.id, p]));
    const pins = keys.filter((k) => byKey.has(k)).map((k) => byKey.get(k));
    const run = keys.filter((k) => k.startsWith('r:')).map((k) => k.slice(2));
    cfg.runOrder = [...run, ...cfg.runOrder.filter((k) => !run.includes(k))].slice(0, 80);
    if (pins.map((p) => p.id).join('\n') !== cfg.pinned.map((p) => p.id).join('\n')) set('pinned', pins);
    else { save(); render(); }
  };
  addEventListener('mousemove', onMove);
  addEventListener('mouseup', onUp);

  let sig = '';
  const offWins = use('wins', (w) => {
    if (!w) return;
    wins = w;
    const s = JSON.stringify([w.list.map((x) => [x.hwnd, x.title.length > 0 && x.title.slice(0, 60), x.exe]), w.fg, w.flash]);
    if (s !== sig) { sig = s; render(); }
  });
  const offPins = bus.on('cfg:pinned', render);
  const offN = bus.on('notifs', render);
  render();
  return () => { clearPrevT(); offWins(); offPins(); offN(); removeEventListener('mousemove', onMove); removeEventListener('mouseup', onUp); };
}

// ---------- magnification ----------
const SPEED = { slow: 0.12, normal: 0.22, fast: 0.38 };
export function magnifier(dockEl) {
  // Icons scale with transforms only: layout (and so the dock's width and position) never changes.
  // Nothing on the pointer path reads layout: rects are cached and refreshed only when the dock
  // or the strip really changes, and each frame writes only the styles that changed.
  let raf = 0, mx = null, list = [], cur = [], out = [], base = 0, baseC = 0, centers = [];
  let geo = null; // { dl, zoom, sl, sr } cached dock/strip edges
  const RANGE = 2.4;
  const halo = dockEl.querySelector('.halo > i');
  const readGeo = () => {
    const d = dockEl.getBoundingClientRect(), st = dockEl.querySelector('.w-apps')?.getBoundingClientRect();
    geo = { dl: d.left, zoom: +dockEl.style.zoom || 1, sl: st ? st.left : 0, sr: st ? st.right : -1 };
  };
  const measure = () => {
    readGeo();
    if (cur.some((v) => v !== 1)) return; // transformed: keep the rest-state centers
    list = [...dockEl.querySelectorAll('.w-apps .app')];
    cur = list.map(() => 1);
    out = list.map(() => ['', '']);
    base = list[0]?.offsetWidth || 36; baseC = list[0]?.getBoundingClientRect().width || base;
    centers = list.map((a) => { const r = a.getBoundingClientRect(); return r.left + r.width / 2; });
  };
  new ResizeObserver(() => (geo = null)).observe(dockEl);
  const sc = [], g = [];
  const step = () => {
    raf = 0;
    const n = list.length;
    if (!n || !cfg.magnify) return;
    if (document.body.classList.contains('appdrag')) mx = null;
    const k = Math.min(1, (SPEED[cfg.magSpeed] || 0.22) * 2.2);
    const grow = Math.min(50, Math.max(10, +cfg.magLevel || 50)) / 100;
    let moving = false, tot = 0;
    for (let i = 0; i < n; i++) {
      let target = 1;
      if (mx != null && centers[i] != null) {
        const d = Math.abs(mx - centers[i]) / baseC;
        if (d < RANGE) target = 1 + grow * Math.cos((d / RANGE) * (Math.PI / 2)) ** 2;
      }
      const c = cur[i];
      const v0 = c + (target - c) * k;
      const v = Math.abs(v0 - target) < 0.004 ? target : v0;
      if (v !== target) moving = true;
      cur[i] = sc[i] = v;
      g[i] = base * (v - 1);
      tot += g[i];
    }
    // push neighbours apart by half of each grown icon, then pin both strip ends in place
    let left = 0, t0 = 0, tl = 0;
    for (let i = 0; i < n; i++) { const t = (left - (tot - left - g[i])) / 2; left += g[i]; if (!i) t0 = t; if (i === n - 1) tl = t; g[i] = t; }
    const last = n - 1;
    for (let i = 0; i < n; i++) {
      const ti = g[i] - (last > 0 ? t0 + ((tl - t0) * i) / last : t0);
      const a = list[i], o = out[i];
      const s1 = sc[i] === 1 ? '' : sc[i].toFixed(3);
      const s2 = Math.abs(ti) < 0.3 ? '' : ti.toFixed(1) + 'px 0';
      if (o[0] !== s1) a.style.scale = o[0] = s1;
      if (o[1] !== s2) a.style.translate = o[1] = s2;
      // no per-frame z-index: reordering repaints the whole dock; the hovered icon is raised in CSS
    }
    if (moving) raf = requestAnimationFrame(step);
  };
  dockEl.addEventListener('mouseenter', measure);
  dockEl.addEventListener('mousemove', (e) => {
    if (!geo) readGeo();
    // the rim light moves on the compositor (transform), nothing is repainted
    if (halo) halo.style.transform = `translate3d(${((e.clientX - geo.dl) / geo.zoom - 260).toFixed(1)}px,0,0)`;
    if (geo.sr < geo.sl) return;
    const inside = e.clientX > geo.sl - base && e.clientX < geo.sr + base;
    const nx = inside ? e.clientX : null;
    if (nx === mx) return;
    mx = nx;
    if (!raf) raf = requestAnimationFrame(step);
  });
  dockEl.addEventListener('mouseleave', () => {
    mx = null;
    if (!raf) raf = requestAnimationFrame(step);
  });
  bus.on('apps-rendered', () => { cur = []; measure(); if (mx != null && !raf) raf = requestAnimationFrame(step); });
}
