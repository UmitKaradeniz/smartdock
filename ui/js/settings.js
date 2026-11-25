// Settings panel and widget picker.
import { invoke, cfg, set, h, esc, blip, toast, bus, hotkeyNote } from './core.js';
import { icon } from './icons.js';
import { openPanel, closePanel } from './panels.js';
import { widgets, CATS } from './widgets.js';
import { geocode, locate } from './data.js';
import { update, openUpdate, checkUpdate } from './update.js';
import { $t, langSetting, setLang } from './i18n.js';
import { wallpaperUrl } from './glass.js';

const ACCENTS = ['#4f8cff', '#9b6bff', '#ff5fa2', '#ff4d4f', '#ff8a1f', '#ffc21a', '#2fd27a', '#14c6c0', '#8b93a7'];
const SLIDE = 170; // segmented thumb travel; redraws wait for it so they don't cut it short

// ---------- building blocks ----------
// `redraw` re-renders the page, so options that depend on another one appear and disappear.
const sw = (key, onChange) => {
  const b = h('button', { class: 'sw' + (cfg[key] ? ' on' : ''), role: 'switch', 'aria-checked': String(!!cfg[key]) });
  b.onclick = () => {
    blip();
    set(key, !cfg[key]);
    b.classList.toggle('on', !!cfg[key]);
    b.setAttribute('aria-checked', String(!!cfg[key]));
    onChange?.();
  };
  return b;
};
const seg = (key, opts, onChange) => {
  const th = h('i', { class: 'seg-th' });
  const el = h('div', { class: 'seg', role: 'radiogroup' }, th);
  // the thumb slides to the chosen option; placed once the row is in the page
  const place = (b, anim) => {
    if (!b) return;
    th.style.transition = anim ? '' : 'none';
    th.style.width = b.offsetWidth + 'px';
    th.style.transform = `translateX(${b.offsetLeft - 2}px)`;
  };
  requestAnimationFrame(() => place(el.querySelector('button.on'), false));
  for (const [v, l] of opts) {
    const b = h('button', {
      class: cfg[key] === v ? 'on' : '',
      role: 'radio',
      'aria-checked': String(cfg[key] === v),
      onclick: () => {
        if (cfg[key] === v) return;
        blip();
        set(key, v);
        el.querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
        place(b, true);
        if (onChange) setTimeout(onChange, SLIDE);
      },
    }, l);
    el.append(b);
  }
  return el;
};
/** One setting: name on the left, control on the right, the hint under both; `wide` gives the control its own line. */
const row = (label, ctl, hint, wide) => h('div', { class: 'srow' + (wide ? ' wide' : '') },
  h('div', { class: 'slbl' }, label),
  ctl ? h('div', { class: 'sctl' }, ctl) : null,
  hint ? h('div', { class: 'shint' }, hint) : null);
const card = (title, ...rows) => h('section', { class: 'sgroup' }, title ? h('h3', { class: 'sgh' }, title) : null, ...rows);
/** Two columns of groups: a page fits the sheet instead of scrolling (one column when narrow). */
const cols = (left, right) => h('div', { class: 'scols' }, h('div', { class: 'scol' }, left), h('div', { class: 'scol' }, right));

/** While a slider is dragged the sheet steps aside and only its row stays, so the real dock shows the change. */
const trial = (el) => {
  el.addEventListener('pointerdown', () => {
    const rw = el.closest('.srow'), p = el.closest('.panel');
    if (!rw || !p) return;
    p.classList.add('trial');
    rw.classList.add('live');
    const end = () => { p.classList.remove('trial'); rw.classList.remove('live'); };
    addEventListener('pointerup', end, { once: true });
    addEventListener('pointercancel', end, { once: true });
  });
  return el;
};
/** Slider with its value; the track is filled up to the value. */
const rng = (key, min, max, step, onInput) => {
  const v = h('b', { class: 'rval' }, `%${cfg[key]}`);
  const r = trial(h('input', { type: 'range', min, max, step, value: cfg[key], 'aria-label': key }));
  const fill = () => r.style.setProperty('--p', ((r.value - min) / (max - min)) * 100 + '%');
  r.oninput = () => { set(key, +r.value); v.textContent = `%${r.value}`; fill(); onInput?.(); };
  fill();
  return [r, v];
};

const isZone = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

// ---------- live preview ----------
// A miniature of the dock (style, size, shape, edge, corners, accent) on the real wallpaper.
// Drag it to the other edge, pull its ring to round the corners, double-click to switch the shape.
const PV_H = { S: 24, M: 28, L: 33 };
const pvRadius = (el) => {
  el.style.setProperty('--pv-r', Math.round((PV_H[cfg.size] / 2) * (cfg.radius / 100)) + 'px');
  el.querySelector('.pvk')?.setAttribute('data-v', `%${cfg.radius}`);
};
const preview = (redraw) => {
  const now = new Date();
  const hr = cfg.clock24 ? now.getHours() : now.getHours() % 12 || 12;
  const knob = cfg.bar ? null : h('span', { class: 'pvk', title: $t('Köşe yuvarlaklığı') });
  const dock = h('div', { class: 'pvd', title: $t('Çift tık: dock şekli') },
    h('i', { class: 'act' }), h('i'), h('i', { class: 'act' }), h('i'), h('s'), h('u'),
    h('b', {}, `${String(hr).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`), knob);
  const el = h('div', { class: 'spv' + (cfg.position === 'top' ? ' top' : '') + (cfg.bar ? ' bar' : ''), 'aria-hidden': 'true' },
    h('div', { class: 'pvcap' }, $t('Sürükle: kenar · Halka: köşe · Çift tık: şekil')), dock);
  el.style.setProperty('--pv-h', PV_H[cfg.size] + 'px');
  pvRadius(el);
  dock.addEventListener('pointerdown', (e) => {
    if (e.target === knob || e.button !== 0) return;
    dock.setPointerCapture(e.pointerId);
    const y0 = e.clientY, box = el.getBoundingClientRect(), d0 = dock.getBoundingClientRect();
    const lo = box.top + 4 - d0.top, hi = box.bottom - 4 - d0.bottom;
    let dy = 0;
    const mv = (ev) => {
      dy = Math.max(lo, Math.min(hi, ev.clientY - y0));
      if (Math.abs(dy) > 3) dock.classList.add('drag');
      dock.style.translate = `0 ${dy}px`;
      const top = ev.clientY < box.top + box.height / 2;
      el.classList.toggle('to-top', top && cfg.position !== 'top');
      el.classList.toggle('to-bot', !top && cfg.position === 'top');
    };
    const up = (ev) => {
      dock.removeEventListener('pointermove', mv);
      dock.classList.remove('drag');
      dock.style.translate = '';
      el.classList.remove('to-top', 'to-bot');
      const pos = ev.clientY < box.top + box.height / 2 ? 'top' : 'bottom';
      if (Math.abs(dy) > 6 && pos !== cfg.position) { blip('ok'); el.classList.toggle('top', pos === 'top'); set('position', pos); }
    };
    dock.addEventListener('pointermove', mv);
    dock.addEventListener('pointerup', up, { once: true });
  });
  dock.addEventListener('dblclick', () => { blip('ok'); set('bar', !cfg.bar); });
  knob?.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    knob.setPointerCapture(e.pointerId);
    const x0 = e.clientX, r0 = cfg.radius;
    el.classList.add('tuning');
    const mv = (ev) => {
      const v = Math.max(0, Math.min(100, Math.round(r0 + (ev.clientX - x0) * 1.5)));
      if (v !== cfg.radius) { set('radius', v); pvRadius(el); }
    };
    knob.addEventListener('pointermove', mv);
    knob.addEventListener('pointerup', () => { knob.removeEventListener('pointermove', mv); el.classList.remove('tuning'); redraw(); }, { once: true });
  });
  return el;
};

// ---------- profiles: a saved look, applied in one click ----------
const PROFILE_KEYS = ['theme', 'accent', 'size', 'radius', 'bar', 'position', 'autoHide', 'magnify', 'magLevel', 'magSpeed', 'liveGlass'];
const isCurrent = (p) => PROFILE_KEYS.every((k) => p.v[k] === undefined || p.v[k] === cfg[k]);
const profiles = (redraw) => {
  const list = cfg.profiles || [];
  const wrap = h('div', { class: 'chips' });
  list.forEach((p, i) => {
    const on = isCurrent(p);
    wrap.append(h('button', {
      class: 'chip' + (on ? ' on' : ''),
      'aria-pressed': String(on),
      onclick: () => {
        if (on) return;
        blip('ok');
        for (const k of PROFILE_KEYS) if (p.v[k] !== undefined && p.v[k] !== cfg[k]) set(k, p.v[k]);
        toast(`${$t('Profil')}: ${p.name}`);
        redraw();
      },
    },
    h('i', { class: 'chip-dot', style: { color: p.v.accent, background: p.v.accent } }), p.name,
    h('span', { class: 'chip-x', title: $t('Sil'), html: icon('close', 11), onclick: (e) => { e.stopPropagation(); blip(); set('profiles', list.filter((_, j) => j !== i)); redraw(); } })));
  });
  const inp = h('input', { class: 'chip-in', placeholder: $t('Profil adı'), maxlength: 18 });
  const add = h('button', { class: 'chip add', onclick: () => { blip(); add.replaceWith(inp); inp.focus(); } }, icon('plus', 12), $t('Bu görünümü kaydet'));
  inp.onkeydown = (e) => {
    if (e.key === 'Enter') {
      const name = inp.value.trim();
      if (!name) return;
      blip('ok');
      set('profiles', [...list, { name, v: Object.fromEntries(PROFILE_KEYS.map((k) => [k, cfg[k]])) }].slice(-6));
      redraw();
    } else if (e.key === 'Escape') { e.stopPropagation(); inp.value = ''; inp.replaceWith(add); }
  };
  inp.onblur = () => setTimeout(() => { if (inp.isConnected && !inp.value.trim()) inp.replaceWith(add); });
  wrap.append(add);
  return wrap;
};

// ---------- pages ----------
const PAGES = {
  look(redraw) {
    const styles = [['black', $t('Siyah')], ['white', $t('Beyaz')], ['glass', $t('Sıvı Cam')], ['ios', 'iOS'], ['midnight', $t('Gece')]];
    const cards = h('div', { class: 'style-cards', role: 'radiogroup' });
    for (const [id, lbl] of styles) {
      cards.append(h('button', {
        class: 'scard' + (cfg.theme === id ? ' on' : ''),
        role: 'radio',
        'aria-checked': String(cfg.theme === id),
        onclick: (e) => { blip(); cards.querySelectorAll('.scard').forEach((c) => c.classList.toggle('on', c === e.currentTarget)); set('theme', id); },
      },
      h('div', { class: 'scard-box' }, h('div', { class: `scard-pill p-${id}` }, h('i'), h('i'), h('i'))),
      h('span', { class: 'scard-lbl' }, lbl)));
    }
    const sws = h('div', { class: 'swatches' });
    for (const c of ACCENTS) {
      sws.append(h('i', {
        class: cfg.accent === c ? 'on' : '',
        style: { background: c, color: c },
        onclick: (e) => { blip(); sws.querySelectorAll('i').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); set('accent', c); },
      }));
    }
    const glass = cfg.theme !== 'black' && cfg.theme !== 'white';
    const pv = preview(redraw);
    return [
      pv,
      cols(
        card($t('Stil'),
          h('div', { class: 'srow wide' }, cards),
          row($t('Vurgu rengi'), sws),
          glass && row($t('Canlı arka plan camı'), sw('liveGlass'), $t('Cam, arkasındaki pencereleri de gerçek zamanlı kırar; açıkken dock ekran kaydında görünmez.'))),
        [
          card($t('Biçim'),
            row($t('Dock şekli'), seg('bar', [[false, $t('Yüzen')], [true, $t('Görev çubuğu')]]), cfg.bar ? $t('Ekran kenarına yaslanır ve tam genişlikte durur.') : $t('Ekran kenarından hafif yukarıda, ortada durur.')),
            row($t('Boyut'), seg('size', [['S', $t('Küçük')], ['M', $t('Orta')], ['L', $t('Büyük')]])),
            !cfg.bar && row($t('Köşe yuvarlaklığı'), rng('radius', 0, 100, 1, () => pvRadius(pv)))),
          card($t('Profiller'), h('div', { class: 'srow wide' }, profiles(redraw))),
        ]),
    ];
  },
  dock(redraw, { monitors }) {
    const modes = {
      off: $t('Dock hep görünür.'),
      smart: $t('Bir pencere dock\'un yerine gelince kenara kayar; fareyi ekran kenarına götürünce geri gelir.'),
      always: $t('Dock hep saklı durur; fareyi ekran kenarına götürünce gelir.'),
    };
    const mode = modes[cfg.autoHide] ? cfg.autoHide : 'off';
    let screens = null;
    if (monitors.length > 1) {
      screens = h('select', {}, h('option', { value: '' }, $t('Birincil ekran')),
        ...monitors.map((m, i) => h('option', { value: i }, `${$t('Ekran')} ${i + 1} · ${m.w}×${m.h}`)));
      screens.value = cfg.monitor != null && cfg.monitor < monitors.length ? String(cfg.monitor) : '';
      screens.onchange = () => set('monitor', screens.value === '' ? null : +screens.value);
    }
    return [cols(
      [
        card($t('Görünürlük'),
          row($t('Otomatik gizleme'), seg('autoHide', [['off', $t('Kapalı')], ['smart', $t('Akıllı')], ['always', $t('Her zaman')]], redraw), modes[mode], true),
          mode === 'off' && row($t('Pencereler dock\'a taşmasın'), sw('reserve'), $t('Ekranı kaplayan pencereler dock\'un başladığı yerde biter.'))),
        card($t('Konum'),
          row($t('Ekran kenarı'), seg('position', [['bottom', $t('Alt')], ['top', $t('Üst')]])),
          screens && row($t('Ekran'), screens)),
      ],
      card($t('Davranış'),
        row($t('Mac tarzı büyütme'), sw('magnify', redraw), $t('Uygulama simgeleri fare üzerine gelince büyür.')),
        cfg.magnify && row($t('Büyütme miktarı'), rng('magLevel', 10, 50, 5)),
        cfg.magnify && row($t('Büyütme hızı'), seg('magSpeed', [['slow', $t('Yavaş')], ['normal', $t('Normal')], ['fast', $t('Hızlı')]])),
        row($t('Dock\'ta ayar düğmesi'), sw('settingsButton'), $t('Kapalıyken ayarlar sağ tık menüsünden açılır.')),
        row($t('Masaüstünü göster köşesi'), sw('peek'), $t('Ekranın köşesindeki ince şerit tüm pencereleri küçültür.'))),
    )];
  },
  system() {
    // shown in both languages, so it can always be found
    const lang = h('select', {}, ...[['auto', 'Otomatik / Auto'], ['tr', 'Türkçe'], ['en', 'English']].map(([v, l]) => h('option', { value: v }, l)));
    lang.value = langSetting();
    lang.onchange = () => setLang(lang.value);
    const keys = h('select', {}, ...['Alt+Space', 'Ctrl+Alt+Space', 'Ctrl+Space', 'Ctrl+Shift+Space', ''].map((v) => h('option', { value: v }, v || $t('Kapalı'))));
    keys.value = cfg.hotkey;
    keys.onchange = () => set('hotkey', keys.value);
    return [cols(
      card(h('span', { lang: 'en' }, 'Windows'), // or Turkish capitals write "WİNDOWS"
        row($t('Windows ile başlat'), sw('autostart', () => invoke('autostart', { enable: cfg.autostart }))),
        row($t('Windows görev çubuğunu gizle'), sw('hideTaskbar'), $t('Kapalıyken dock görev çubuğunun yanında durur. Dock kapanınca görev çubuğu eski haline döner.'))),
      card($t('Genel'),
        row('Dil / Language', lang, $t('Değişince arayüz yeniden yüklenir.')),
        row($t('Arama kısayolu'), keys, hotkeyNote()),
        row($t('Ses efektleri'), sw('sounds'), $t('Dokunuşlarda kısa, sessiz bir tık sesi.')),
        row($t('Ücretsiz AI'), sw('ai'), $t('Aramada "kendi kelimelerinle" komutları için. Yazdığın soru text.pollinations.ai adresine gider; anahtar ya da abonelik yok.'))),
    )];
  },
  weather(redraw, { field }) {
    const inp = h('input', { placeholder: $t('Şehir ara') });
    const list = h('div', { class: 'list' });
    const pick = (c) => { set('city', { name: c.name, lat: c.lat, lon: c.lon }); toast(`${$t('Şehir')}: ${c.name}`); redraw(); };
    let wait = 0, asked = 0;
    inp.oninput = () => {
      clearTimeout(wait);
      wait = setTimeout(async () => {
        const n = ++asked;
        const r = inp.value.trim() ? await geocode(inp.value).catch(() => []) : [];
        if (n !== asked) return; // an older, slower answer
        list.replaceChildren(...r.slice(0, 5).map((c) => h('div', { class: 'li', onclick: () => pick(c) }, h('span', { class: 't1 grow' }, c.name), h('span', { class: 'hint' }, c.country || ''))));
      }, 250);
    };
    const find = h('button', { class: 'btn', onclick: async () => { try { pick(await locate()); } catch { toast($t('Konum bulunamadı'), 'err'); } } }, icon('globe', 13), $t('Bul'));
    const zones = field(cfg.zones.join(', '), (v) => {
      const all = v.split(',').map((s) => s.trim()).filter(Boolean);
      const bad = all.filter((z) => !isZone(z));
      if (bad.length) toast(`${$t('Geçersiz saat dilimi')}: ${bad.join(', ')}`, 'err');
      set('zones', all.filter(isZone));
      return cfg.zones.join(', ');
    });
    return [cols(
      card($t('Saat'),
        row($t('Saat biçimi'), seg('clock24', [[true, $t('24 saat')], [false, $t('12 saat')]])),
        row($t('Saniyeleri göster'), sw('seconds')),
        row($t('Dünya saatleri'), zones, $t('IANA saat dilimleri, virgülle: Europe/Istanbul, Asia/Tokyo'), true)),
      card($t('Hava'),
        row($t('Hava durumu şehri'), inp, cfg.city?.name ? `${$t('Seçili')}: ${cfg.city.name}` : $t('Henüz seçilmedi.'), true),
        list,
        row($t('Konumu otomatik bul'), find)),
    )];
  },
  cal(redraw) {
    const items = cfg.ics.map((f, i) => h('div', { class: 'li' },
      h('i', { class: 'dot', style: { background: f.color } }),
      h('div', { class: 'grow stack' }, h('span', { class: 't1' }, f.name), h('span', { class: 't2' }, f.url.slice(0, 48))),
      h('button', { class: 'ibtn', title: $t('Kaldır'), html: icon('close', 13), onclick: () => { blip(); set('ics', cfg.ics.filter((_, j) => j !== i)); redraw(); } })));
    const n = h('input', { placeholder: $t('Ad (ör. İş)') }), u = h('input', { placeholder: 'https://... .ics' });
    const add = h('button', { class: 'btn pri', onclick: () => {
      const url = u.value.trim();
      if (!/^(https|webcal):\/\//.test(url)) return toast($t('Geçerli bir https/webcal bağlantısı gir'), 'err');
      set('ics', [...cfg.ics, { name: n.value.trim() || $t('Takvim'), url, color: ACCENTS[cfg.ics.length % ACCENTS.length] }]);
      n.value = u.value = '';
      toast($t('Takvim eklendi'));
      redraw();
    } }, $t('Ekle'));
    u.onkeydown = (e) => { if (e.key === 'Enter') add.click(); };
    return [cols(
      [
        h('p', { class: 'sintro' }, $t('Google, Outlook ve iCloud takvimlerinin gizli iCal (.ics) bağlantısını ekle. Hesap izni gerekmez; bağlantı yalnız bu bilgisayarda saklanır.')),
        card($t('Takvim ekle'), h('div', { class: 'srow wide' }, h('div', { class: 'calform' }, n, u, add))),
      ],
      card($t('Takvimlerin'), items.length ? h('div', { class: 'list' }, ...items) : h('p', { class: 'sempty' }, $t('Henüz takvim yok.'))),
    )];
  },
  dev(redraw, { field }) {
    const gh = field(cfg.ghUser, (v) => { set('ghUser', v.trim()); return cfg.ghUser; }, $t('kullanıcı adı'));
    const pair = () => `${cfg.fx.from}/${cfg.fx.to}`;
    const fx = field(pair(), (v) => {
      const m = /^\s*([A-Za-z]{3})\s*\/\s*([A-Za-z]{3})\s*$/.exec(v);
      if (m) set('fx', { from: m[1].toUpperCase(), to: m[2].toUpperCase() });
      else toast($t('Döviz çifti USD/TRY biçiminde olmalı'), 'err');
      return pair();
    });
    const coins = field(cfg.crypto.join(', '), (v) => {
      const l = v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (l.length) set('crypto', l);
      return cfg.crypto.join(', ');
    });
    const info = (t) => h('span', { class: 'mut' }, t);
    return [cols(
      card($t('Veri'),
        row($t('GitHub kullanıcı adı'), gh, $t('Herkese açık katkı ızgarası için; token gerekmez.')),
        row($t('Döviz çifti'), fx),
        row($t('Kripto paralar'), coins, $t('CoinGecko kimlikleri: bitcoin, ethereum, solana'), true)),
      card($t('AI limitleri'),
        row($t('Claude limitleri'), info($t('Claude masaüstü / Claude Code')), $t('Claude masaüstünün kaydı okunur; eskiyse Claude Code’un /usage komutu sorulur.')),
        row('ChatGPT limitleri', info($t('Codex CLI oturumu')), $t('\'codex login\' ile giriş yaptıysan otomatik okunur.')),
        row($t('Antigravity limitleri'), info($t('Kapalı')), $t('Google kuralları gereği okunmuyor; resmî kota API’si yok.'))),
    )];
  },
  about() {
    // updates: GitHub releases, opened in the browser; nothing installs by itself
    const l = update.latest;
    const btn = l ? h('button', { class: 'btn pri', onclick: openUpdate }, $t('İndir')) : h('button', { class: 'btn', onclick: () => checkUpdate() }, $t('Denetle'));
    return [cols(
      card($t('Güncelleme'),
        row(l ? `${$t('Yeni sürüm')}: ${l.tag}` : `${$t('Sürüm')} ${update.current ? 'v' + update.current : ''}`, btn, l ? $t('İndirip kurulum dosyasını çalıştır; ayarların korunur.') : $t('Yeni sürümler GitHub’dan denetlenir.')),
        row($t('Otomatik denetle'), sw('updateCheck'))),
      card($t('Gizlilik'), h('p', { class: 'sintro' }, $t('Senin dock\'un. Hesap yok, sunucu yok, telemetri yok.'))),
    )];
  },
};

const tabsList = () => [['look', $t('Görünüm'), 'layers'], ['dock', $t('Dock'), 'grid'], ['system', $t('Sistem'), 'gear'], ['weather', $t('Saat & Hava'), 'sun'], ['cal', $t('Takvim'), 'cal'], ['dev', $t('Hesaplar'), 'github'], ['about', $t('Hakkında'), 'spark']];

export function openSettings(tab = 'look') {
  // wide enough for two columns, so no page has to scroll
  const w = Math.min(900, (screen.availWidth || innerWidth) - 32);
  openPanel('settings', null, { w, h: 560 }, (root) => {
    const tabs = tabsList();
    root.innerHTML = `<div class="picker sp"><header class="shead"><div class="sbrand-s"><i class="slogo"></i>smartdock</div><label class="ssearch">${icon('search', 14)}<input placeholder="${esc($t('Ayarlarda ara'))}" aria-label="${esc($t('Ayarlarda ara'))}"><kbd>Ctrl F</kbd></label><button class="ibtn speek" title="${esc($t('Basılı tut: dock\'a bak'))}">${icon('eye', 15)}</button><button class="ibtn sclose" title="${esc($t('Kapat'))}">${icon('close', 15)}</button></header><nav class="side"></nav><main class="smain"><div class="stitle"></div><div class="set"></div></main></div>`;
    const sp = root.querySelector('.sp'), side = root.querySelector('.side'), body = root.querySelector('.set'), title = root.querySelector('.stitle');
    const q = root.querySelector('.ssearch input');
    const wall = wallpaperUrl();
    if (wall) sp.style.setProperty('--wall', `url("${wall}")`);
    root.querySelector('.sclose').onclick = () => { blip(); closePanel(); };
    // hold the eye: the sheet fades out and the real dock shows
    const eye = root.querySelector('.speek');
    eye.onpointerdown = (e) => { eye.setPointerCapture(e.pointerId); blip(); root.classList.add('peek'); };
    eye.onpointerup = eye.onpointercancel = () => root.classList.remove('peek');

    let cur = '', pending = [], monitors = [], searching = false, hits = [], sel = 0, index = null;
    // a typed value is saved on Enter or on leaving the field, and also when the page goes away
    const flushFields = () => { const p = pending; pending = []; for (const f of p) f(); };
    const field = (value, commit, placeholder) => {
      const i = h('input', { value, placeholder });
      let last = value;
      const done = () => { if (i.value !== last) { last = commit(i.value); i.value = i.defaultValue = last; } };
      i.onchange = done;
      pending.push(done);
      return i;
    };
    const render = () => {
      if (searching) return;
      const y = body.scrollTop;
      flushFields();
      body.replaceChildren(...PAGES[cur](render, { field, monitors }).flat().filter(Boolean));
      body.scrollTop = y;
    };
    const show = (t) => {
      flushFields();
      searching = false;
      cur = t;
      side.querySelectorAll('.cat[data-t]').forEach((c) => { const on = c.dataset.t === t; c.classList.toggle('on', on); c.setAttribute('aria-current', on ? 'page' : 'false'); });
      title.textContent = tabs.find((x) => x[0] === t)[1];
      render();
      body.scrollTop = 0;
      body.classList.remove('enter');
      void body.offsetWidth; // restart the entrance
      body.classList.add('enter');
    };

    // ---------- search: every row of every page, by name and explanation ----------
    const buildIndex = () => {
      const out = [], scratch = (v) => h('input', { value: v });
      for (const [id, page, ic] of tabs) {
        out.push({ id, page, ic, label: page, hint: '', text: page.toLowerCase() });
        let nodes = [];
        try { nodes = PAGES[id](() => {}, { field: scratch, monitors }).flat().filter(Boolean); } catch {}
        const box = h('div', {}, ...nodes);
        for (const r of box.querySelectorAll('.srow')) {
          const label = r.querySelector(':scope > .slbl')?.textContent;
          if (!label) continue;
          const hint = r.querySelector(':scope > .shint')?.textContent || '';
          out.push({ id, page, ic, label, hint, text: `${label} ${hint} ${page}`.toLowerCase() });
        }
      }
      return out;
    };
    const mark = (s, t) => {
      const i = s.toLowerCase().indexOf(t);
      return i < 0 ? [s] : [s.slice(0, i), h('mark', {}, s.slice(i, i + t.length)), s.slice(i + t.length)];
    };
    const results = (term) => {
      index ||= buildIndex();
      const t = term.toLowerCase();
      hits = index.filter((x) => x.text.includes(t)).sort((a, b) => (b.label.toLowerCase().includes(t) - a.label.toLowerCase().includes(t))).slice(0, 8);
      sel = 0;
      searching = true;
      title.textContent = $t('Arama');
      side.querySelectorAll('.cat.on').forEach((c) => c.classList.remove('on'));
      body.classList.remove('enter');
      body.replaceChildren(hits.length
        ? h('div', { class: 'sres', role: 'listbox' }, ...hits.map((x, i) => h('button', { class: 'sr' + (i === sel ? ' sel' : ''), role: 'option', onclick: () => go(x) },
          h('span', { class: 'sr-ic', html: icon(x.ic, 14) }),
          h('span', { class: 'sr-t' }, h('b', {}, ...mark(x.label, t)), x.hint ? h('small', {}, x.hint) : null),
          h('span', { class: 'sr-p' }, x.label === x.page ? '' : x.page))))
        : h('p', { class: 'sempty' }, $t('Eşleşen ayar yok')));
    };
    const pick = (i) => {
      sel = (i + hits.length) % hits.length;
      body.querySelectorAll('.sr').forEach((b, j) => b.classList.toggle('sel', j === sel));
    };
    const go = (x) => {
      blip();
      q.value = '';
      show(x.id);
      const r = [...body.querySelectorAll('.srow')].find((el) => el.querySelector(':scope > .slbl')?.textContent === x.label);
      if (!r) return;
      r.classList.add('flash');
      setTimeout(() => r.classList.remove('flash'), 1400);
      r.querySelector('.sctl button, .sctl input, .sctl select')?.focus({ preventScroll: true });
    };
    q.oninput = () => { const t = q.value.trim(); if (t) results(t); else if (searching) show(cur); };
    q.onkeydown = (e) => {
      if (e.key === 'ArrowDown' && hits.length) { e.preventDefault(); pick(sel + 1); }
      else if (e.key === 'ArrowUp' && hits.length) { e.preventDefault(); pick(sel - 1); }
      else if (e.key === 'Enter' && searching && hits[sel]) go(hits[sel]);
      else if (e.key === 'Escape' && q.value) { e.stopPropagation(); q.value = ''; show(cur); }
    };
    // type anywhere to search; Ctrl+F jumps to the box
    root.addEventListener('keydown', (e) => {
      if (e.target.closest('input, select, textarea')) return;
      if ((e.ctrlKey && e.key.toLowerCase() === 'f') || (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && e.key !== ' ')) {
        if (e.ctrlKey) e.preventDefault();
        q.focus();
      }
    });

    // ---------- rail ----------
    for (const [id, l, ic] of tabs) side.append(h('button', { class: 'cat', 'data-t': id, onclick: () => { if (cur !== id || searching) { blip(); q.value = ''; show(id); } }, html: `${icon(ic, 15)}<span>${esc(l)}</span>` }));
    side.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const all = [...side.querySelectorAll('.cat[data-t]')];
      const i = all.indexOf(document.activeElement);
      const next = all[(Math.max(0, i) + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length];
      next.focus();
      next.click();
    });
    const ver = h('div', { class: 'sver' }, update.current ? 'v' + update.current : '');
    side.append(h('div', { class: 'grow' }),
      h('button', { class: 'cat foot', onclick: () => openPicker(), html: `${icon('grid', 15)}<span>${esc($t('Widget\'lar'))}</span>` }), ver);
    if (!update.current) window.__TAURI__.app.getVersion().then((v) => { update.current = v; ver.textContent = 'v' + v; if (cur === 'about') render(); });

    show(PAGES[tab] ? tab : 'look');
    invoke('monitors').then((m) => { monitors = m; index = null; if (cur === 'dock') render(); }).catch(() => {});
    // some settings also change from outside the panel (drag to the other edge, search commands, the preview);
    // they redraw the page that shows them once the segmented thumb has slid
    let lt = 0;
    const later = () => { clearTimeout(lt); lt = setTimeout(render, SLIDE); };
    const offs = [bus.on('update', () => cur === 'about' && render()), bus.on('hotkey-state', () => cur === 'system' && render()), ...['position', 'theme', 'size', 'accent', 'bar', 'clock24'].map((k) => bus.on('cfg:' + k, later))];
    return () => { clearTimeout(lt); flushFields(); offs.forEach((off) => off()); };
  });
}

// Widget gallery: every widget rendered live, as it looks in the dock, grouped by category.
// Click a preview to add/remove it; previews are inert (no panels) and disposed with the gallery.
const NO_PREVIEW = new Set(['apps']); // the app strip is the dock itself
export function openPicker() {
  bus.emit('edit', true);
  openPanel('picker', null, { w: 860, h: 520 }, (root) => {
    root.innerHTML = `<div class="picker"><div class="side"><label class="qbox">${icon('search', 14)}<input class="q" placeholder="${$t('Widget ara')}"></label></div><div class="pmain"><div class="ph-head"><div class="title ttl"></div><span class="pill cnt"></span><span class="sub mut ond"></span><div class="grow"></div><button class="ibtn x" title="${$t('Kapat')}">${icon('close', 15)}</button></div><div class="gal scroll"></div></div></div>`;
    const side = root.querySelector('.side'), gal = root.querySelector('.gal'), q = root.querySelector('.q');
    let cat = 'all', live = [];
    const kill = () => { for (const f of live) { try { f?.(); } catch {} } live = []; };
    root.querySelector('.x').onclick = () => closePanel();
    const preview = (w) => {
      const t = h('div', { class: `tile w-${w.id}` });
      if (NO_PREVIEW.has(w.id)) t.innerHTML = `${icon(w.icon, 18)}<span class="lbl">${esc(w.name)}</span>`;
      else { try { live.push(w.mount(t, { preview: true })); } catch { t.innerHTML = icon(w.icon, 18); } }
      return t;
    };
    const card = (w) => {
      const on = cfg.items.includes(w.id);
      const c = h('div', { class: `wprev${on ? ' on' : ''}`, title: w.desc, onclick: () => toggle(w, c) },
        h('div', { class: 'stagebox' }, preview(w), h('span', { class: 'mark', html: icon(on ? 'check' : 'plus', 12) })),
        h('div', { class: 'wn' }, w.name));
      return c;
    };
    const draw = () => {
      kill();
      const term = q.value.trim().toLowerCase();
      const list = Object.values(widgets).filter((w) => (cat === 'all' || w.cat === cat) && (!term || (w.name + ' ' + w.desc).toLowerCase().includes(term)));
      root.querySelector('.ttl').textContent = term ? $t('Arama') : CATS.find((c) => c[0] === cat)[1];
      root.querySelector('.cnt').textContent = list.length;
      root.querySelector('.ond').textContent = `${cfg.items.length} ${$t("dock'ta")}`;
      gal.innerHTML = '';
      for (const [id, label, ic] of CATS) {
        if (id === 'all') continue;
        const ws = list.filter((w) => w.cat === id);
        if (!ws.length) continue;
        gal.append(h('div', { class: 'gsec', html: `${icon(ic, 14)}<span>${label}</span>` }), h('div', { class: 'gflow' }, ...ws.map(card)));
      }
      if (!list.length) gal.append(h('div', { class: 'sub mut', style: { padding: '30px', textAlign: 'center' } }, $t('Eşleşen widget yok')));
      return list;
    };
    const toggle = (w, c) => {
      blip('ok');
      const on = !cfg.items.includes(w.id);
      set('items', on ? [...cfg.items, w.id] : cfg.items.filter((x) => x !== w.id));
      c.classList.toggle('on', on);
      c.querySelector('.mark').innerHTML = icon(on ? 'check' : 'plus', 12);
      root.querySelector('.ond').textContent = `${cfg.items.length} ${$t("dock'ta")}`;
    };
    for (const [id, l, ic] of CATS) side.append(h('div', { class: 'cat' + (id === cat ? ' on' : ''), onclick: (e) => { cat = id; side.querySelectorAll('.cat').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); draw(); gal.scrollTop = 0; }, html: `${icon(ic, 15)}<span>${l}</span>` }));
    side.append(h('div', { class: 'grow' }), h('div', { class: 'cat', onclick: () => openSettings(), html: `${icon('gear', 15)}<span>${$t('Ayarlar')}</span>` }));
    let qt = 0;
    q.oninput = () => { clearTimeout(qt); qt = setTimeout(draw, 120); };
    q.onkeydown = (e) => { if (e.key === 'Escape') closePanel(); };
    draw();
    setTimeout(() => q.focus(), 30);
    return () => { kill(); bus.emit('edit', false); };
  });
}
