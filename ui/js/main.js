// Boot, dock layout, native window geometry, edit mode.
import { invoke, listen, cfg, set, save, h, bus, loadConfig, blip, toast } from './core.js';
import { initData } from './data.js';
import { widgets } from './widgets.js';
import { setWidgets } from './search.js';
import { getApps, defaultPins, magnifier } from './apps.js';
import { initGlass, updateGlass, refreshBackdrop } from './glass.js';
import { setLayoutHook, closePanel, isOpen, menu, showToast, repositionPanel, openPanel } from './panels.js';
import { icon } from './icons.js';
import { initUpdate, update, openUpdate } from './update.js';
import { openPicker, openSettings } from './settings.js';
import { $t } from './i18n.js';

const stage = document.getElementById('stage');
// show-desktop sliver: screen corner, as tall as the dock band
const peekEl = document.getElementById('peek');
peekEl.title = $t('Masaüstünü göster');
peekEl.onclick = () => { blip(); invoke('toggle_desktop'); };
function placePeek() {
  peekEl.style.display = cfg.peek === false ? 'none' : '';
  peekEl.style.height = dockH() + 16 + 'px';
}
let dock, items, mounted = new Map();
const lay = { hover: false, panel: null, toast: false, hidden: false };

// ---------- IntelliHide: slide off the edge while a window covers the dock ----------
// The native side only reports "covered"; pointer, panels and edit mode are decided here.
let covered = false, hideT = 0, hideDoneT = 0, sliding = false;
const autoHide = () => (cfg.autoHide === 'smart' || cfg.autoHide === 'always' ? cfg.autoHide : 'off');
function evalHide() {
  const m = autoHide();
  const want = m !== 'off' && !lay.hover && !lay.panel && !document.body.classList.contains('edit') && !document.body.classList.contains('appdrag') && (m === 'always' || covered);
  if (!want) { clearTimeout(hideT); hideT = 0; if (lay.hidden) revealDock(); return; }
  if (!lay.hidden && !hideT) hideT = setTimeout(hideDock, 450);
}
function hideDock() {
  hideT = 0;
  lay.hidden = true;
  sliding = false;
  document.body.classList.add('dock-hidden');
  // the region shrinks to the edge strip only after the slide, which it would otherwise clip
  clearTimeout(hideDoneT);
  hideDoneT = setTimeout(() => lay.hidden && setHit(), 260);
}
function revealDock() {
  clearTimeout(hideDoneT);
  lay.hidden = false;
  // the box is mid-slide until the transition ends: keep the resting rect cached till then
  sliding = true;
  setHit(); // room to paint first, then slide in
  document.body.classList.remove('dock-hidden');
  hideDoneT = setTimeout(() => { sliding = false; setHit(); }, 300);
}

// ---------- appearance ----------
function applyLook() {
  const b = document.body;
  b.className = `t-${cfg.theme} s-${cfg.size}${cfg.position === 'top' ? ' top' : ''}${cfg.bar ? ' m-bar' : ''}${cfg.settingsButton === false ? ' no-cfgbtn' : ''}${b.classList.contains('edit') ? ' edit' : ''}`;
  const r = document.documentElement.style;
  mounted.forEach((m) => (m.el.style.minWidth = ''));
  r.setProperty('--accent', cfg.accent);
  const dh = { S: 48, M: 56, L: 66 }[cfg.size];
  r.setProperty('--radius', Math.round((dh / 2) * (cfg.radius / 100)) + 'px');
  requestAnimationFrame(() => { updateGlass(dock); relayout(); });
}

// ---------- geometry ----------
let geoKey = '', glassKey = '', geoBusy = Promise.resolve();
function dockH() { return { S: 48, M: 56, L: 66 }[cfg.size]; }
const WIN_H = 66 + 8 + 10 + 520 + 40; // largest dock + gaps + tallest panel + shadow
// memory: idle dock trims WebView2 working set, any interaction restores it
let idleT = 0, low = false;
function activity(active) {
  clearTimeout(idleT);
  if (active) { if (low) { low = false; invoke('memory_low', { low: false }); } return; }
  idleT = setTimeout(() => { if (!lay.panel && !lay.hover) { low = true; invoke('memory_low', { low: true }); } }, 20000);
}
async function relayout(patch) {
  Object.assign(lay, patch || {});
  activity(lay.hover || !!lay.panel);
  // too many tiles for the screen: shrink the whole dock instead of pushing Start off-screen
  const avail = cfg.bar ? innerWidth - 120 : screen.availWidth - 48 - (cfg.magnify ? 140 : 0);
  const z0 = +dock.style.zoom || 1;
  // taskbar style spans the screen, so its content (not its box) decides the fit
  const nat = cfg.bar ? [...dock.children].reduce((s, c) => s + (c.classList.contains('clip') ? 0 : c.getBoundingClientRect().width / z0 + 8), 0) : dock.getBoundingClientRect().width / z0;
  const z = nat > avail ? avail / nat : 1;
  // hysteresis: small width changes must not rescale (and so shift) the whole dock
  if (z < z0 || z - z0 > 0.02) dock.style.zoom = z < 1 ? z.toFixed(3) : '';
  dock.style.width = cfg.bar ? innerWidth / (+dock.style.zoom || 1) + 'px' : '';
  const dr = dock.getBoundingClientRect();
  // the wallpaper layer and lens follow the dock's size and zoom (tiles fill in after boot)
  const gk = `${dock.style.zoom}|${Math.round(dr.width)}|${Math.round(dr.height)}`;
  if (gk !== glassKey) { glassKey = gk; updateGlass(dock); repositionPanel(); }
  // The native window never resizes for panels, toasts or tile width changes: a transparent
  // WebView2 shows its previous frame at the top of a window that just grew, so the dock
  // flashed up the screen. The window is monitor-wide and tall enough for the largest panel;
  // only the clickable (and painted) region changes, see setHit().
  const hgt = WIN_H;
  // windows end exactly at the dock's edge: reserve what the dock really covers (zoom included)
  const top = cfg.position === 'top';
  // floating: #stage keeps the dock 8px off the screen edge; add 4px breathing room above it
  const reserve = cfg.reserve && autoHide() === 'off' ? Math.ceil(dr.height + (cfg.bar ? 0 : 12)) : 0;
  const key = `${cfg.position}|${reserve}|${cfg.monitor}`;
  if (key !== geoKey) {
    geoKey = key;
    geoBusy = invoke('set_geometry', { w: 0, h: hgt, top, reserve, monitor: cfg.monitor }).then(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    );
    await geoBusy;
    // the window moved: the watched screen rect must be sent again even if nothing else changed
    lastAh = '';
    updateGlass(dock);
    repositionPanel();
  }
  setHit();
  evalHide();
}
// Only the dock (plus headroom while hovered) and open panels/menus/toasts take clicks; the
// rest of the transparent window passes clicks through to the windows below.
let hitKey = '', lastAh = '', geo = null; // geo: dock + apps-strip edges from the last layout, for pointer checks
function hitRects(rest = false) {
  placePeek();
  const box = (r, l, t, rr, b) => [Math.floor(r.left - l), Math.floor(r.top - t), Math.ceil(r.right + rr), Math.ceil(r.bottom + b)];
  const up = cfg.position !== 'top';
  // while slid away the dock's box is off-screen: keep using where it rests
  if ((!lay.hidden && !sliding) || !geo) {
    const r = dock.getBoundingClientRect(), t = parseFloat(dock.style.translate) || 0;
    const d = { left: r.left - t, right: r.right - t, top: r.top, bottom: r.bottom };
    const sr = dock.querySelector('.w-apps')?.getBoundingClientRect();
    geo = { d, s: sr && sr.width ? { left: sr.left, right: sr.right, top: sr.top, bottom: sr.bottom } : null };
  }
  const d = geo.d;
  const ahKey = `${autoHide()}|${geoKey}|${[d.left, d.top, d.right, d.bottom].map(Math.round)}`;
  if (autoHide() === 'off') covered = false; // an old report must not hide the dock when re-enabled
  if (ahKey !== lastAh) { lastAh = ahKey; invoke('set_autohide', { mode: { off: 0, smart: 1, always: 2 }[autoHide()], rect: [d.left, d.top, d.right, d.bottom] }); }
  const rects = [];
  if (lay.hidden) {
    // a strip on the screen edge under the dock brings it back
    rects.push(up ? [Math.floor(d.left), innerHeight - 2, Math.ceil(d.right), innerHeight] : [Math.floor(d.left), 0, Math.ceil(d.right), 2]);
  } else if (!rest && (lay.hover || lay.panel)) {
    // headroom only where something is painted outside the dock: magnified icons and their
    // tooltips above the apps strip. Everything else stays click-through.
    rects.push(box(d, 4, 4, 4, 4));
    // auto-hide: the gap down to the screen edge stays ours, so a reveal from the edge holds
    if (autoHide() !== 'off') rects.push(up ? [Math.floor(d.left), Math.floor(d.bottom), Math.ceil(d.right), innerHeight] : [Math.floor(d.left), 0, Math.ceil(d.right), Math.ceil(d.top)]);
    if (geo.s) rects.push(box({ left: geo.s.left, right: geo.s.right, top: up ? d.top : d.bottom, bottom: up ? d.top : d.bottom }, 120, up ? 62 : 0, 120, up ? 0 : 62));
  } else rects.push(rest ? box(d, 0, 0, 0, 0) : box(d, 2, 2, 2, 2));
  // panels, menus, toasts (closing ones too, for their fade) with room for their shadow
  const m = rest ? 0 : 24;
  for (const el of document.getElementById('layer').children) rects.push(box(el.getBoundingClientRect(), m, m, m, m));
  if (cfg.peek !== false) rects.push(box(peekEl.getBoundingClientRect(), 0, 0, 0, 0));
  return rects;
}
function setHit() {
  const rects = hitRects();
  const k = rects.join('|');
  if (k === hitKey) return;
  hitKey = k;
  invoke('set_hit', { rects });
}
setLayoutHook((p) => relayout(p));

// ---------- dock ----------
function setCollapsed(on) {
  if (!dock) return;
  dock.classList.toggle('collapsed', !!on);
  closePanel();
  requestAnimationFrame(() => { updateGlass(dock); relayout(); });
}
function buildDock() {
  dock = h('div', { class: 'dock' },
    h('div', { class: 'clip' }, h('div', { class: 'glass-img' }), h('div', { class: 'tint' })),
    h('div', { class: 'halo' }, h('i')),
    h('button', { class: 'unfold press', title: $t('Dock\'ı aç'), html: icon('grid', 20), onclick: () => { blip(); setCollapsed(false); } })
  );
  dock.append(h('button', { class: 'cfgbtn press', title: $t('Ayarlar'), html: icon('gear', 17), onclick: () => { blip(); openSettings(); } }));
  items = dock;
  stage.append(dock);
  magnifier(dock);
  // tiles fill in asynchronously (weather, usage, media); keep window size and fit in sync
  let roF = 0;
  // (cheap: the window itself no longer resizes, only the hit region follows)
  new ResizeObserver(() => { if (!roF) roF = requestAnimationFrame(() => { roF = 0; relayout(); }); }).observe(dock);
  let leaveT = 0;
  const unhover = () => { leaveT = 0; if (lay.hover) relayout({ hover: false }); };
  // ~ the time the magnified icons and the tooltip need to settle back inside the dock
  const LEAVE_MS = 150;
  dock.addEventListener('mouseenter', () => { clearTimeout(leaveT); leaveT = 0; if (cfg.liveGlass) refreshBackdrop(dock); if (!lay.hover) relayout({ hover: true }); });
  document.addEventListener('mouseleave', () => { clearTimeout(leaveT); leaveT = setTimeout(unhover, LEAVE_MS); });
  // Pointer left the dock (and the magnified icons poking out of it): give the headroom back.
  // Uses the rects cached by the last layout, so moving the mouse never forces a layout.
  document.addEventListener('mousemove', (e) => {
    // hidden: the only thing under the pointer is the edge strip
    if (lay.hidden) { clearTimeout(leaveT); leaveT = 0; relayout({ hover: true }); return; }
    if (!lay.hover || lay.panel || !geo) return;
    const { d, s } = geo, x = e.clientX, y = e.clientY, up = cfg.position !== 'top';
    const lift = (s && x > s.left - 24 && x < s.right + 24) ? 0.6 * (s.bottom - s.top) : 0;
    // auto-hide keeps the gap down to the screen edge, where an edge reveal leaves the pointer
    const edge = autoHide() !== 'off';
    const yTop = up ? d.top - 4 - lift : edge ? -1 : d.top - 4;
    const yBot = up ? (edge ? innerHeight + 1 : d.bottom + 4) : d.bottom + 4 + lift;
    const over = x > d.left - 4 && x < d.right + 4 && y > yTop && y < yBot;
    if (over) { clearTimeout(leaveT); leaveT = 0; }
    else if (!leaveT) leaveT = setTimeout(unhover, LEAVE_MS);
  });
  // A click on the transparent headroom was meant for the window underneath: the region is
  // shrunk first and the click replayed natively, so the first click after the dock is never lost.
  const outside = (el) => !el?.closest?.('.dock, #layer > *, #peek');
  let downOut = false, passAt = 0;
  addEventListener('mousedown', (e) => {
    downOut = outside(e.target);
    // the gallery keeps the dock usable (drag to reorder); settings also close from empty dock space
    if ((downOut && (isOpen('settings') || isOpen('picker'))) || (e.target === dock && isOpen('settings'))) closePanel();
  }, true);
  addEventListener('mouseup', (e) => {
    if (!downOut || !outside(e.target) || (e.button !== 0 && e.button !== 2) || document.body.classList.contains('appdrag')) return;
    downOut = false;
    // a replayed click that lands here again (rounded corner, panel edge) is not replayed twice
    if (performance.now() - passAt < 400) return;
    passAt = performance.now();
    clearTimeout(leaveT); leaveT = 0;
    lay.hover = false;
    activity(!!lay.panel);
    const rects = hitRects(true);
    hitKey = rects.join('|');
    invoke('pass_click', { rects, right: e.button === 2 });
    evalHide();
  }, true);
  addEventListener('contextmenu', (e) => { if (outside(e.target)) e.preventDefault(); }, true);
  dock.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    const tile = e.target.closest?.('.tile[data-w]');
    const sizes = tile ? [...Object.entries(TILE_SIZES).map(([k, n]) => ({ label: `${$t('Boyut')}: ${n}`, icon: (cfg.wsize[tile.dataset.w] || 'M') === k ? 'check' : '', run: () => set('wsize', { ...cfg.wsize, [tile.dataset.w]: k }) })), '-'] : [];
    menu(null, [
      ...(update.latest ? [{ label: `${$t('Güncelleme var')}: ${update.latest.tag}`, icon: 'external', run: openUpdate }, '-'] : []),
      ...sizes,
      ...(tile ? [{ label: $t('Boyutlandır...'), icon: 'gear', run: () => openTune(tile) }] : []),
      { label: $t('Widget\'lar...'), icon: 'grid', run: openPicker },
      { label: dock.classList.contains('collapsed') ? $t('Dock\'ı aç') : $t('Dock\'ı katla'), icon: 'chevu', run: () => setCollapsed(!dock.classList.contains('collapsed')) },
      { label: $t('Ayarlar'), icon: 'gear', run: () => openSettings() },
      { label: $t('Görev Yöneticisi'), icon: 'task', run: () => invoke('launch', { id: 'C:\\Windows\\System32\\Taskmgr.exe' }) },
      '-',
      { label: $t('Dock\'u kapat'), icon: 'power', danger: true, run: () => invoke('quit') },
    ]);
  });
  // drag on empty dock area: release in the top half moves it to the top edge
  dock.addEventListener('dblclick', (e) => { if (e.target === dock) { blip(); setCollapsed(!dock.classList.contains('collapsed')); } });
  dock.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target !== dock) return;
    const y0 = e.screenY;
    const up = (ev) => {
      removeEventListener('mouseup', up);
      const dy = ev.screenY - y0;
      if (cfg.position === 'bottom' && ev.screenY < screen.height / 2 && dy < -80) set('position', 'top');
      else if (cfg.position === 'top' && ev.screenY > screen.height / 2 && dy > 80) set('position', 'bottom');
    };
    addEventListener('mouseup', up);
  });
}

// A tile never shrinks while shown: live text (seconds, speeds, prices) would otherwise
// change its width every tick and the centered dock would slide under the pointer.
const tileRO = new ResizeObserver((es) => {
  for (const e of es) {
    // in the tile's own CSS px: screen width divided by the dock's and the tile's zoom
    const el = e.target;
    if (el.style.width) continue; // a width set by hand is the tile's width
    const zt = +el.style.zoom || { S: 0.84, L: 1.16, XL: 1.34 }[el.dataset.z] || 1;
    const w = Math.ceil(el.getBoundingClientRect().width / (zt * (+dock.style.zoom || 1)) - 0.5);
    if (w > (parseFloat(el.style.minWidth) || 0)) el.style.minWidth = w + 'px';
  }
});
const TILE_SIZES = { S: $t('Küçük'), M: $t('Normal'), L: $t('Büyük'), XL: $t('Çok büyük') };

// ---------- fine sizing: scale and width per widget, applied live ----------
function openTune(tile) {
  const id = tile.dataset.w;
  openPanel('tune', tile, { w: 290, h: id === 'apps' ? 150 : 206 }, (root, close) => {
    const cur = () => cfg.wtune?.[id] || {};
    const put = (patch) => {
      const t = { ...cur(), ...patch };
      for (const k of Object.keys(t)) if (!t[k]) delete t[k];
      const all = { ...(cfg.wtune || {}) };
      if (Object.keys(t).length) all[id] = t; else delete all[id];
      set('wtune', all);
    };
    const presetZ = { S: 84, L: 116, XL: 134 }[cfg.wsize[id]] || 100;
    const zr = h('input', { type: 'range', min: 60, max: 160, step: 2, value: cur().z || presetZ });
    const zv = h('b', { class: 'tv' });
    const showZ = () => (zv.textContent = zr.value + '%');
    zr.oninput = () => { showZ(); put({ z: +zr.value === 100 ? 0 : +zr.value }); };
    showZ();
    root.append(h('div', { class: 'ph-head' }, h('div', { class: 'title' }, $t('{} boyutu').replace('{}', widgets[id]?.name || id))));
    const body = h('div', { class: 'ph-body tune' });
    body.append(h('div', { class: 'trow' }, h('span', {}, $t('Ölçek')), zr, zv));
    if (id !== 'apps') {
      const zoom = (+tile.style.zoom || 1) * (+dock.style.zoom || 1);
      const nat = Math.round(tile.getBoundingClientRect().width / zoom);
      const wr = h('input', { type: 'range', min: 60, max: 520, step: 2, value: cur().w || nat });
      const wv = h('b', { class: 'tv' });
      const showW = () => (wv.textContent = cur().w ? wr.value + ' px' : $t('Otomatik'));
      wr.oninput = () => { put({ w: +wr.value }); showW(); };
      showW();
      body.append(h('div', { class: 'trow' }, h('span', {}, $t('Genişlik')), wr, wv),
        h('div', { class: 'hint' }, $t('Daraltınca çubuklar kısalır, boşluklar kapanır.')));
    }
    body.append(h('div', { class: 'row', style: { gap: '8px', marginTop: '10px' } },
      h('button', { class: 'btn', onclick: () => { blip(); put({ z: 0, w: 0 }); close(); } }, $t('Sıfırla')),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn', onclick: () => { blip(); close(); } }, $t('Tamam'))));
    root.append(body);
  });
}
function renderItems() {
  const want = cfg.items.filter((id) => widgets[id]);
  for (const [id, m] of mounted) {
    if (!want.includes(id)) { try { m.dispose?.(); } catch {} m.el.remove(); mounted.delete(id); }
  }
  want.forEach((id) => {
    let m = mounted.get(id);
    if (!m) {
      const el = h('div', { class: `tile w-${id}`, 'data-w': id });
      let dispose;
      try { dispose = widgets[id].mount(el, {}); } catch (e) { console.error('widget', id, e); el.textContent = '!'; }
      m = { el, dispose };
      if (id !== 'apps') tileRO.observe(el);
      mounted.set(id, m);
      wireDrag(el, id);
      if (document.body.classList.contains('edit')) el.setAttribute('draggable', 'true');
    }
    const z = cfg.wsize[id] || 'M', t = cfg.wtune?.[id];
    const zk = `${z}|${t?.z || ''}|${t?.w || ''}`;
    if (m.el.dataset.zk !== zk) {
      m.el.dataset.zk = zk; m.el.dataset.z = z; m.el.style.minWidth = '';
      m.el.style.zoom = t?.z ? String(t.z / 100) : '';
      m.el.style.width = t?.w && id !== 'apps' ? t.w + 'px' : '';
      m.el.classList.toggle('fixw', !!(t?.w && id !== 'apps'));
    }
    items.append(m.el);
  });
  requestAnimationFrame(() => relayout());
}

// ---------- edit mode: drag to reorder ----------
let dragId = null;
function wireDrag(el, id) {
  el.addEventListener('dragstart', (e) => { if (!document.body.classList.contains('edit')) return e.preventDefault(); dragId = id; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
  el.addEventListener('dragend', () => { el.classList.remove('dragging'); dragId = null; });
  el.addEventListener('dragover', (e) => {
    if (!dragId || dragId === id) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    const list = cfg.items.filter((x) => x !== dragId);
    const i = list.indexOf(id) + (after ? 1 : 0);
    list.splice(i, 0, dragId);
    if (list.join() !== cfg.items.join()) set('items', list);
  });
}
// widgets redraw their own content, so the remove badges are re-attached while editing
let badgeT = 0;
function ensureBadges() {
  for (const [id, m] of mounted) {
    if (m.el.querySelector(':scope > .badge-x')) continue;
    m.el.append(h('button', { class: 'badge-x', html: icon('minus', 12), onclick: (e) => { e.stopPropagation(); blip(); set('items', cfg.items.filter((i) => i !== id)); } }));
  }
}
bus.on('edit', (on) => {
  document.body.classList.toggle('edit', on);
  mounted.forEach((m) => m.el.setAttribute('draggable', on ? 'true' : 'false'));
  clearInterval(badgeT);
  if (on) { ensureBadges(); badgeT = setInterval(ensureBadges, 250); }
  else document.querySelectorAll('.badge-x').forEach((b) => b.remove());
  evalHide();
});

// ---------- boot ----------
async function boot() {
  await loadConfig();
  // the full-width bar was switched on for everyone once; the floating dock is the look
  if (!cfg._floatV2) { cfg.bar = false; cfg._floatV2 = true; save(); }
  setWidgets(widgets);
  initData();
  // before the first layout: where the dock sits depends on whether the taskbar stays visible
  await invoke('set_taskbar', { hidden: cfg.hideTaskbar }).catch((e) => console.warn('taskbar', e));
  buildDock();
  applyLook();
  await initGlass(() => dock);
  const list = await getApps();
  if (!cfg.pinned.length && !cfg._pinnedOnce) { set('pinned', defaultPins(list)); set('_pinnedOnce', true); }
  renderItems();
  updateGlass(dock);
  applyLiveGlass();
  if (cfg.autostart) invoke('autostart', { enable: true });
  initUpdate();

  bus.on('cfg:items', renderItems);
  bus.on('cfg:wsize', renderItems);
  bus.on('cfg:wtune', renderItems);
  bus.on('collapse', setCollapsed);
  for (const k of ['liveGlass', 'theme']) bus.on('cfg:' + k, applyLiveGlass);
  // relayout() itself notices when the native window or the reservation has to change; forcing
  // it here re-registered the reservation on every step of a slider
  for (const k of ['theme', 'accent', 'size', 'radius', 'position', 'monitor', 'bar', 'liveGlass', 'settingsButton', 'magnify']) bus.on('cfg:' + k, applyLook);
  listen('wins', () => { if (cfg.liveGlass) refreshBackdrop(dock); });
  for (const k of ['reserve', 'autoHide', 'peek']) bus.on('cfg:' + k, () => relayout());
  listen('cover', (v) => { covered = v; evalHide(); });
  lastAh = ''; setHit(); // ask again now that someone listens: the first report came before boot
  bus.on('cfg:hideTaskbar', async (v) => {
    await invoke('set_taskbar', { hidden: v });
    // the dock moves next to a visible taskbar, once Explorer has brought it back
    setTimeout(() => { geoKey = ''; relayout(); }, 400);
  });
  for (const k of ['clock24', 'seconds']) bus.on('cfg:' + k, renderAgain);
  bus.on('toast', showToast);
  bus.on('alarm', (text) => { const s = cfg.sounds; cfg.sounds = true; blip('ok'); setTimeout(() => blip('ok'), 180); cfg.sounds = s; toast(text); });
  listen('hotkey', () => bus.emit('hotkey'));
  listen('fullscreen', (fs) => { if (fs) closePanel(); });
  listen('reveal', (on) => { if (!on) closePanel(); });
  // resolution / DPI change or Explorer restart: re-place the window, region and appbar
  listen('display', () => { geoKey = ''; hitKey = ''; relayout(); });
  // focus moved to another window; a half-typed field keeps its panel open (it is not saved yet)
  const typing = () => [...document.querySelectorAll('#layer input:not([type=range]), #layer textarea')].some((i) => i.closest('.set') && i.value !== i.defaultValue);
  addEventListener('blur', () => { if (isOpen() && !typing()) closePanel(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
  setInterval(() => getApps(true), 10 * 60e3);
}
// live capture only for the styles that show it: it also hides the dock from screen recordings
const applyLiveGlass = () => invoke('set_live_glass', { on: !!cfg.liveGlass && cfg.theme !== 'black' && cfg.theme !== 'white' });
function renderAgain() {
  for (const [, m] of mounted) { try { m.dispose?.(); } catch {} m.el.remove(); }
  mounted.clear();
  renderItems();
}

boot().catch((e) => { console.error(e); toast($t('Başlatma hatası: ') + e, 'err'); });
