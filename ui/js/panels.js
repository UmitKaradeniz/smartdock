// Panels, context menus and toasts. Panels grow the native window before they appear.
import { h, esc, bus, blip } from './core.js';
import { icon } from './icons.js';

let layoutHook = async () => {};
export const setLayoutHook = (fn) => (layoutHook = fn);
const layer = () => document.getElementById('layer');

let cur = null; // { id, el, dispose, anchor }

export function isOpen(id) {
  return cur && (!id || cur.id === id);
}

export async function closePanel() {
  if (!cur) return;
  const c = cur;
  cur = null;
  try { c.dispose?.(); } catch (e) { console.error(e); }
  c.el.classList.add('closing');
  bus.emit('panel', null);
  setTimeout(() => {
    c.el.remove();
    if (!cur) layoutHook({ panel: null });
  }, 100);
}

/**
 * Opens a panel above (or below, for a top dock) `anchor`.
 * build(root, close) fills it and returns an optional dispose function.
 */
export async function openPanel(id, anchor, { w, h: ph, cls = '' }, build) {
  if (cur?.id === id) return closePanel();
  if (cur) {
    const c = cur;
    cur = null;
    try { c.dispose?.(); } catch {}
    c.el.remove();
  }
  blip();
  const el = h('div', { class: `panel ${cls}`, style: { width: w + 'px', height: ph + 'px', visibility: 'hidden' } });
  layer().append(el);
  cur = { id, el, anchor };
  const mine = cur;
  place(el, anchor, w); // placed first: the hit region is built from the panel's rect
  await layoutHook({ panel: { w, h: ph } });
  if (cur !== mine) return;
  el.style.visibility = '';
  try { mine.dispose = build(el, closePanel); } catch (e) { console.error('panel', id, e); }
  bus.emit('panel', id);
}

export function place(el, anchor, w) {
  const dock = document.querySelector('.dock');
  const dr = dock.getBoundingClientRect();
  const ar = (anchor || dock).getBoundingClientRect();
  let x = ar.left + ar.width / 2 - w / 2;
  x = Math.max(8, Math.min(innerWidth - w - 8, x));
  el.style.left = x + 'px';
  const top = document.body.classList.contains('top');
  // clear the other edge: after the dock changes edge an old value would pin the panel to both
  if (top) { el.style.top = dr.bottom + 10 + 'px'; el.style.bottom = ''; }
  else { el.style.bottom = innerHeight - dr.top + 10 + 'px'; el.style.top = ''; }
  // short or highly scaled screens: the panel shrinks and scrolls instead of leaving the window
  const room = Math.max(160, Math.floor((top ? innerHeight - dr.bottom : dr.top) - 18));
  el.style.maxHeight = room + 'px';
  el.style.overflowY = parseFloat(el.style.height) > room ? 'auto' : '';
}

export function repositionPanel() {
  if (cur) place(cur.el, cur.anchor, cur.el.offsetWidth);
}

// ---------- context menu ----------
export function menu(anchor, items, w = 210) {
  const n = items.filter((i) => i !== '-').length, s = items.filter((i) => i === '-').length;
  const height = n * 30 + s * 9 + 12;
  openPanel('menu', anchor, { w, h: height, cls: 'menu' }, (root, close) => {
    for (const it of items) {
      if (it === '-') { root.append(h('div', { class: 'mhr' })); continue; }
      root.append(
        h('div', { class: `mi${it.danger ? ' danger' : ''}`, onclick: () => { close(); it.run(); }, html: (it.icon ? icon(it.icon, 15) : '') + `<span>${esc(it.label)}</span>` })
      );
    }
  });
}

// ---------- toast ----------
let toastT = 0;
export function showToast({ text, kind }) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const dock = document.querySelector('.dock');
  const el = h('div', { class: 'toast', html: `${icon(kind === 'err' ? 'close' : 'check', 14, kind === 'err' ? 'err' : 'ok')}<span></span>` });
  el.querySelector('span').textContent = text;
  layer().append(el);
  const go = () => {
    const dr = dock.getBoundingClientRect();
    if (document.body.classList.contains('top')) el.style.top = dr.bottom + 10 + 'px';
    else el.style.bottom = innerHeight - dr.top + 10 + 'px';
  };
  go();
  layoutHook({ toast: true });
  clearTimeout(toastT);
  toastT = setTimeout(() => {
    el.remove();
    layoutHook({ toast: false });
  }, 2600);
}
