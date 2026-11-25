// Wallpaper-aware glass: the dock "sees" the desktop wallpaper behind it and bends it
// at the bezel with an SVG displacement map (real refraction, not a CSS blur).
import { SD, invoke, listen, cfg } from './core.js';

const BLEED = 24;
let wall = { url: '', w: 0, h: 0 };
let lastKey = '';

async function loadWall() {
  const info = await invoke('wallpaper_info');
  if (!info.path) return (wall = { url: '', w: 0, h: 0 });
  const url = `${SD}/wall?t=${encodeURIComponent(info.stamp)}`;
  await new Promise((res) => {
    const im = new Image();
    im.onload = () => { wall = { url, w: im.naturalWidth, h: im.naturalHeight }; res(); };
    im.onerror = () => res();
    im.src = url;
  });
}

function sdf(x, y, cx, cy, hx, hy, r) {
  const qx = Math.abs(x - cx) - (hx - r), qy = Math.abs(y - cy) - (hy - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function dispMap(W, H, r, bezel) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const cx = W / 2, cy = H / 2, hx = W / 2 - BLEED, hy = H / 2 - BLEED;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const d = sdf(x, y, cx, cy, hx, hy, r);
      let R = 128, G = 128;
      if (d < 0 && d > -bezel) {
        const nx = sdf(x + 1, y, cx, cy, hx, hy, r) - sdf(x - 1, y, cx, cy, hx, hy, r);
        const ny = sdf(x, y + 1, cx, cy, hx, hy, r) - sdf(x, y - 1, cx, cy, hx, hy, r);
        const l = Math.hypot(nx, ny) || 1;
        const t = 1 + d / bezel;
        const m = t * t * t;
        R = 128 - (nx / l) * m * 127;
        G = 128 - (ny / l) * m * 127;
      }
      img.data[i] = R; img.data[i + 1] = G; img.data[i + 2] = 128; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

let lastLiveAt = 0, liveTimer = 0;

function dockRect(dock) {
  const b = dock.getBoundingClientRect();
  const [tx = 0, ty = 0] = getComputedStyle(dock).translate.split(' ').map((v) => parseFloat(v) || 0);
  const z = +dock.style.zoom || 1;
  return { left: b.left - tx * z, top: b.top - ty * z, width: b.width, height: b.height };
}

/** Captures the live screen region behind `dock` (throttled) when `cfg.liveGlass` is active. */
export function refreshBackdrop(dock) {
  if (!dock || !cfg.liveGlass || cfg.theme === 'black' || cfg.theme === 'white') return;
  const now = performance.now();
  const wait = 350 - (now - lastLiveAt);
  if (wait > 0) {
    if (!liveTimer) liveTimer = setTimeout(() => { liveTimer = 0; refreshBackdrop(dock); }, wait);
    return;
  }
  lastLiveAt = now;
  const layer = dock.querySelector('.glass-img');
  if (!layer) return;
  const r = dockRect(dock);
  if (r.width <= 0 || r.height <= 0) return;
  const SW = screen.width, SH = screen.height;
  const winX = Number.isFinite(window.screenX) ? window.screenX : (SW - innerWidth) / 2;
  const winY = Number.isFinite(window.screenY) ? window.screenY : (cfg.position === 'top' ? 0 : SH - innerHeight);
  const dpr = window.devicePixelRatio || 1;
  const px = Math.round((winX + r.left - BLEED) * dpr);
  const py = Math.round((winY + r.top - BLEED) * dpr);
  const pw = Math.round((r.width + BLEED * 2) * dpr);
  const ph = Math.round((r.height + BLEED * 2) * dpr);
  layer.style.backgroundImage = `url("${SD}/backdrop?x=${px}&y=${py}&w=${pw}&h=${ph}&t=${Date.now()}")`;
  layer.style.backgroundSize = '100% 100%';
  layer.style.backgroundPosition = '0 0';
}

/** Aligns the wallpaper layer of `dock` with the real desktop and rebuilds the lens when its size changes. */
export function updateGlass(dock) {
  const layer = dock.querySelector('.glass-img');
  if (!layer) return;
  const useWall = cfg.theme !== 'black' && cfg.theme !== 'white' && (cfg.liveGlass || wall.url);
  layer.style.display = useWall ? '' : 'none';
  if (!useWall) return;
  const r = dockRect(dock);
  if (cfg.liveGlass) {
    refreshBackdrop(dock);
  } else {
    const SW = screen.width, SH = screen.height;
    const winX = (SW - innerWidth) / 2;
    const winY = cfg.position === 'top' ? 0 : SH - innerHeight;
    const s = Math.max(SW / wall.w, SH / wall.h);
    const dw = wall.w * s, dh = wall.h * s;
    const ox = (SW - dw) / 2 - (winX + r.left - BLEED);
    const oy = (SH - dh) / 2 - (winY + r.top - BLEED);
    layer.style.backgroundImage = `url("${wall.url}")`;
    layer.style.backgroundSize = `${dw}px ${dh}px`;
    layer.style.backgroundPosition = `${ox}px ${oy}px`;
  }

  const W = Math.round(r.width) + BLEED * 2, H = Math.round(r.height) + BLEED * 2;
  const rad = parseFloat(getComputedStyle(dock).borderTopLeftRadius) || 0;
  const key = `${W}x${H}r${rad}${cfg.theme}`;
  if (key === lastKey) return;
  clearTimeout(lensT);
  lensT = setTimeout(() => buildLens(key, W, H, rad), 140);
}

let lensT = 0;
function buildLens(key, W, H, rad) {
  lastKey = key;
  const bezel = Math.min(18, H / 2 - BLEED);
  const map = dispMap(W, H, Math.min(rad, H / 2 - BLEED), bezel);
  const f = document.getElementById('lens');
  f.setAttribute('width', W); f.setAttribute('height', H);
  const fi = f.querySelector('feImage');
  fi.setAttribute('href', map); fi.setAttribute('width', W); fi.setAttribute('height', H);
  f.querySelector('feDisplacementMap').setAttribute('scale', cfg.theme === 'glass' ? 46 : cfg.theme === 'ios' ? 22 : 34);
  f.querySelector('feGaussianBlur').setAttribute('stdDeviation', cfg.theme === 'glass' ? 1.2 : cfg.theme === 'ios' ? 14 : 7);
}

export async function initGlass(getDock) {
  await loadWall();
  listen('wallpaper', async () => { await loadWall(); lastKey = ''; updateGlass(getDock()); });
}
