// Settings panel and widget picker.
import { invoke, cfg, set, h, esc, blip, toast, bus } from './core.js';
import { icon } from './icons.js';
import { openPanel, closePanel } from './panels.js';
import { widgets, CATS } from './widgets.js';
import { geocode, locate } from './data.js';
import { update, openUpdate, checkUpdate } from './update.js';
import { $t, langSetting, setLang } from './i18n.js';

const ACCENTS = ['#4f8cff', '#9b6bff', '#ff5fa2', '#ff4d4f', '#ff8a1f', '#ffc21a', '#2fd27a', '#14c6c0', '#8b93a7'];

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
  const el = h('div', { class: 'seg' });
  for (const [v, l] of opts) {
    const b = h('button', {
      class: cfg[key] === v ? 'on' : '',
      onclick: () => {
        if (cfg[key] === v) return;
        blip();
        set(key, v);
        el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        onChange?.();
      },
    }, l);
    el.append(b);
  }
  return el;
};
/** One setting: name and explanation on the left, control on the right (below it when wide). */
const row = (label, ctl, hint, wide) => h('div', { class: 'srow' + (wide ? ' wide' : '') },
  h('div', { class: 'stxt' }, h('div', { class: 'slbl' }, label), hint ? h('div', { class: 'shint' }, hint) : null),
  ctl ? h('div', { class: 'sctl' }, ctl) : null);
const card = (title, ...rows) => [title ? h('div', { class: 'sect' }, title) : null, h('div', { class: 'scardbox' }, ...rows)];

const isZone = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

// ---------- pages ----------
const PAGES = {
  look(redraw) {
    const styles = [['black', $t('Siyah')], ['white', $t('Beyaz')], ['glass', $t('Sıvı Cam')], ['ios', 'iOS'], ['midnight', $t('Gece')]];
    const cards = h('div', { class: 'style-cards' });
    for (const [id, lbl] of styles) {
      cards.append(h('button', {
        class: 'scard' + (cfg.theme === id ? ' on' : ''),
        onclick: () => { blip(); set('theme', id); },
      },
      h('div', { class: 'scard-box' }, h('div', { class: `scard-pill p-${id}` }, h('i'), h('i'), h('i'))),
      h('span', { class: 'scard-lbl' }, lbl)));
    }
    const sws = h('div', { class: 'swatches' });
    for (const c of ACCENTS) sws.append(h('i', { class: cfg.accent === c ? 'on' : '', style: { background: c, color: c }, onclick: () => { blip(); set('accent', c); } }));
    const glass = cfg.theme !== 'black' && cfg.theme !== 'white';
    const rv = h('b', { class: 'rval' }, `%${cfg.radius}`);
    const r = h('input', { type: 'range', min: 0, max: 100, value: cfg.radius });
    r.oninput = () => { set('radius', +r.value); rv.textContent = `%${r.value}`; };
    return [
      card($t('Stil'),
        h('div', { class: 'srow wide' }, cards),
        row($t('Vurgu rengi'), sws),
        glass && row($t('Canlı arka plan camı'), sw('liveGlass'), $t('Cam, arkasındaki pencereleri de gerçek zamanlı kırar; açıkken dock ekran kaydında görünmez.'))),
      card($t('Biçim'),
        row($t('Dock şekli'), seg('bar', [[false, $t('Yüzen')], [true, $t('Görev çubuğu')]], redraw), cfg.bar ? $t('Ekran kenarına yaslanır ve tam genişlikte durur.') : $t('Ekran kenarından hafif yukarıda, ortada durur.')),
        row($t('Boyut'), seg('size', [['S', $t('Küçük')], ['M', $t('Orta')], ['L', $t('Büyük')]])),
        !cfg.bar && row($t('Köşe yuvarlaklığı'), [r, rv])),
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
    return [
      card($t('Görünürlük'),
        row($t('Otomatik gizleme'), seg('autoHide', [['off', $t('Kapalı')], ['smart', $t('Akıllı')], ['always', $t('Her zaman')]], redraw), modes[mode], true),
        mode === 'off' && row($t('Pencereler dock\'a taşmasın'), sw('reserve'), $t('Ekranı kaplayan pencereler dock\'un başladığı yerde biter.'))),
      card($t('Konum'),
        row($t('Ekran kenarı'), seg('position', [['bottom', $t('Alt')], ['top', $t('Üst')]])),
        screens && row($t('Ekran'), screens)),
      card($t('Davranış'),
        row($t('Mac tarzı büyütme'), sw('magnify', redraw), $t('Uygulama simgeleri fare üzerine gelince büyür.')),
        cfg.magnify && row($t('Büyütme hızı'), seg('magSpeed', [['slow', $t('Yavaş')], ['normal', $t('Normal')], ['fast', $t('Hızlı')]])),
        row($t('Dock\'ta ayar düğmesi'), sw('settingsButton'), $t('Kapalıyken ayarlar sağ tık menüsünden açılır.')),
        row($t('Masaüstünü göster köşesi'), sw('peek'), $t('Ekranın köşesindeki ince şerit tüm pencereleri küçültür.'))),
    ];
  },
  system() {
    // shown in both languages, so it can always be found
    const lang = h('select', {}, ...[['auto', 'Otomatik / Auto'], ['tr', 'Türkçe'], ['en', 'English']].map(([v, l]) => h('option', { value: v }, l)));
    lang.value = langSetting();
    lang.onchange = () => setLang(lang.value);
    return [
      card('Windows',
        row($t('Windows ile başlat'), sw('autostart', () => invoke('autostart', { enable: cfg.autostart }))),
        row($t('Windows görev çubuğunu gizle'), sw('hideTaskbar'), $t('Kapalıyken dock görev çubuğunun yanında durur. Dock kapanınca görev çubuğu eski haline döner.'))),
      card($t('Genel'),
        row('Dil / Language', lang, $t('Değişince arayüz yeniden yüklenir.')),
        row($t('Ses efektleri'), sw('sounds'), $t('Dokunuşlarda kısa, sessiz bir tık sesi.')),
        row($t('Ücretsiz AI'), sw('ai'), $t('Aramada "kendi kelimelerinle" komutları için. Anahtar ya da abonelik yok.'))),
    ];
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
        list.replaceChildren(...r.map((c) => h('div', { class: 'li', onclick: () => pick(c) }, h('span', { class: 't1 grow' }, c.name), h('span', { class: 'hint' }, c.country || ''))));
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
    return [
      card($t('Saat'),
        row($t('Saat biçimi'), seg('clock24', [[true, $t('24 saat')], [false, $t('12 saat')]])),
        row($t('Saniyeleri göster'), sw('seconds')),
        row($t('Dünya saatleri'), zones, $t('IANA saat dilimleri, virgülle: Europe/Istanbul, Asia/Tokyo'), true)),
      card($t('Hava'),
        row($t('Hava durumu şehri'), inp, cfg.city?.name ? `${$t('Seçili')}: ${cfg.city.name}` : $t('Henüz seçilmedi.'), true),
        list,
        row($t('Konumu otomatik bul'), find)),
    ];
  },
  cal(redraw) {
    const items = cfg.ics.map((f, i) => h('div', { class: 'li' },
      h('i', { class: 'dot', style: { background: f.color } }),
      h('div', { class: 'grow stack' }, h('span', { class: 't1' }, f.name), h('span', { class: 't2' }, f.url.slice(0, 60))),
      h('button', { class: 'ibtn', title: $t('Kaldır'), html: icon('close', 13), onclick: () => { blip(); set('ics', cfg.ics.filter((_, j) => j !== i)); redraw(); } })));
    const n = h('input', { placeholder: $t('Ad (ör. İş)') }), u = h('input', { placeholder: 'https://... .ics', class: 'grow' });
    const add = h('button', { class: 'btn pri', onclick: () => {
      const url = u.value.trim();
      if (!/^(https|webcal):\/\//.test(url)) return toast($t('Geçerli bir https/webcal bağlantısı gir'), 'err');
      set('ics', [...cfg.ics, { name: n.value.trim() || $t('Takvim'), url, color: ACCENTS[cfg.ics.length % ACCENTS.length] }]);
      n.value = u.value = '';
      toast($t('Takvim eklendi'));
      redraw();
    } }, $t('Ekle'));
    u.onkeydown = (e) => { if (e.key === 'Enter') add.click(); };
    return [
      h('p', { class: 'sintro' }, $t('Google, Outlook ve iCloud takvimlerinin gizli iCal (.ics) bağlantısını ekle. Hesap izni gerekmez; bağlantı yalnız bu bilgisayarda saklanır.')),
      items.length ? card($t('Takvimlerin'), ...items) : null,
      card($t('Takvim ekle'), h('div', { class: 'srow wide' }, h('div', { class: 'row' }, n, u, add))),
    ];
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
    return [
      card($t('Veri'),
        row($t('GitHub kullanıcı adı'), gh, $t('Herkese açık katkı ızgarası için; token gerekmez.')),
        row($t('Döviz çifti'), fx),
        row($t('Kripto paralar'), coins, $t('CoinGecko kimlikleri: bitcoin, ethereum, solana'), true)),
      card($t('AI limitleri'),
        row($t('Claude limitleri'), info($t('Claude masaüstü / Claude Code')), $t('Claude masaüstünün kaydı okunur; eskiyse Claude Code’un /usage komutu sorulur.')),
        row('ChatGPT limitleri', info($t('Codex CLI oturumu')), $t('\'codex login\' ile giriş yaptıysan otomatik okunur.')),
        row($t('Antigravity limitleri'), info($t('Kapalı')), $t('Google kuralları gereği okunmuyor; resmî kota API’si yok.'))),
    ];
  },
  about(redraw) {
    // updates: GitHub releases, opened in the browser; nothing installs by itself
    const l = update.latest;
    const btn = l ? h('button', { class: 'btn pri', onclick: openUpdate }, $t('İndir')) : h('button', { class: 'btn', onclick: () => checkUpdate() }, $t('Denetle'));
    if (!update.current) window.__TAURI__.app.getVersion().then((v) => { update.current = v; redraw(); });
    return [
      h('div', { class: 'sbrand' }, h('div', { class: 'slogo' }), h('div', {}, h('div', { class: 'sname' }, 'smartdock'), h('div', { class: 'mut' }, $t('Senin dock\'un. Hesap yok, sunucu yok, telemetri yok.')))),
      card($t('Güncelleme'),
        row(l ? `${$t('Yeni sürüm')}: ${l.tag}` : `${$t('Sürüm')} ${update.current ? 'v' + update.current : ''}`, btn, l ? $t('İndirip kurulum dosyasını çalıştır; ayarların korunur.') : $t('Yeni sürümler GitHub’dan denetlenir.')),
        row($t('Otomatik denetle'), sw('updateCheck'))),
      card($t('Dock'),
        row($t('Widget\'lar'), h('button', { class: 'btn', onclick: () => openPicker() }, icon('grid', 13), $t('Aç'))),
        row($t('Arayüzü yenile'), h('button', { class: 'btn', onclick: () => location.reload() }, icon('chart', 13), $t('Yenile'))),
        row($t('Dock\'u kapat'), h('button', { class: 'btn danger', onclick: () => invoke('quit') }, icon('power', 13), $t('Kapat')))),
    ];
  },
};

export function openSettings(tab = 'look') {
  openPanel('settings', null, { w: 600, h: 500 }, (root) => {
    const tabs = [['look', $t('Görünüm'), 'layers'], ['dock', $t('Dock'), 'grid'], ['system', $t('Sistem'), 'gear'], ['weather', $t('Saat & Hava'), 'sun'], ['cal', $t('Takvim'), 'cal'], ['dev', $t('Hesaplar'), 'github'], ['about', $t('Hakkında'), 'spark']];
    root.innerHTML = '<div class="picker"><div class="side"></div><div class="smain"><div class="stitle"></div><div class="scroll set"></div></div></div>';
    const side = root.querySelector('.side'), body = root.querySelector('.set'), title = root.querySelector('.stitle');
    side.append(h('div', { class: 'sect', style: { padding: '6px 10px' } }, $t('Ayarlar')));
    root.append(h('button', { class: 'ibtn pclose', title: $t('Kapat'), html: icon('close', 15), onclick: () => { blip(); closePanel(); } }));
    let cur = '', pending = [], monitors = [];
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
      const y = body.scrollTop;
      flushFields();
      body.replaceChildren(...PAGES[cur](render, { field, monitors }).flat().filter(Boolean));
      body.scrollTop = y;
    };
    const show = (t) => {
      flushFields();
      cur = t;
      side.querySelectorAll('.cat').forEach((c) => c.classList.toggle('on', c.dataset.t === t));
      title.textContent = tabs.find((x) => x[0] === t)[1];
      render();
      body.scrollTop = 0;
    };
    for (const [id, l, ic] of tabs) side.append(h('div', { class: 'cat', 'data-t': id, onclick: () => { blip(); show(id); }, html: `${icon(ic, 15)}<span>${l}</span>` }));
    show(PAGES[tab] ? tab : 'look');
    invoke('monitors').then((m) => { monitors = m; if (cur === 'dock') render(); }).catch(() => {});
    // some settings also change from outside the panel (drag to the other edge, search commands);
    // theme and accent redraw the page that shows them
    const later = () => queueMicrotask(render);
    const offs = [bus.on('update', () => cur === 'about' && render()), ...['position', 'theme', 'size', 'accent'].map((k) => bus.on('cfg:' + k, later))];
    return () => { flushFields(); offs.forEach((off) => off()); };
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
