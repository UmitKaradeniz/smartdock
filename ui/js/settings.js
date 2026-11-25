// Settings panel and widget picker.
import { invoke, cfg, set, h, esc, blip, toast, bus } from './core.js';
import { icon } from './icons.js';
import { openPanel, closePanel } from './panels.js';
import { widgets, CATS } from './widgets.js';
import { geocode, locate } from './data.js';
import { update, openUpdate, checkUpdate } from './update.js';
import { $t, langSetting, setLang } from './i18n.js';

const ACCENTS = ['#4f8cff', '#9b6bff', '#ff5fa2', '#ff4d4f', '#ff8a1f', '#ffc21a', '#2fd27a', '#14c6c0', '#8b93a7'];

const sw = (key, onChange) => {
  const b = h('button', { class: 'sw' + (cfg[key] ? ' on' : '') });
  b.onclick = () => { blip(); set(key, !cfg[key]); b.classList.toggle('on', cfg[key]); onChange?.(cfg[key]); };
  return b;
};
const seg = (key, opts) => {
  const el = h('div', { class: 'seg' });
  for (const [v, l] of opts) {
    const b = h('button', { class: cfg[key] === v ? 'on' : '', onclick: () => { blip(); set(key, v); el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); } }, l);
    el.append(b);
  }
  return el;
};

export function openSettings(tab = 'look') {
  openPanel('settings', null, { w: 560, h: 470 }, (root) => {
    const tabs = [['look', $t('Görünüm'), 'layers'], ['dock', $t('Dock'), 'grid'], ['weather', $t('Hava & Saat'), 'sun'], ['cal', $t('Takvim'), 'cal'], ['dev', $t('Hesaplar'), 'github'], ['about', $t('Hakkında'), 'spark']];
    root.innerHTML = `<div class="picker"><div class="side"></div><div class="scroll main" style="padding:4px 18px 18px;height:470px"></div></div>`;
    const side = root.querySelector('.side'), main = root.querySelector('.main');
    side.append(h('div', { class: 'sect', style: { padding: '6px 10px' } }, $t('Ayarlar')));
    const show = (t) => {
      side.querySelectorAll('.cat').forEach((c) => c.classList.toggle('on', c.dataset.t === t));
      main.innerHTML = '';
      const g = h('div', { class: 'set' });
      const row = (label, ctl, hint) => { g.append(h('label', {}, label), ctl); if (hint) g.append(h('div', { class: 'hint' }, hint)); };
      main.append(h('div', { class: 'sect' }, tabs.find((x) => x[0] === t)[1]), g);
      if (t === 'look') {
        const styles = [['black', $t('Siyah')], ['white', $t('Beyaz')], ['glass', $t('Sıvı Cam')], ['ios', 'iOS'], ['midnight', $t('Gece')]];
        const cards = h('div', { class: 'style-cards' });
        for (const [id, lbl] of styles) {
          const c = h('button', {
            class: 'scard' + (cfg.theme === id ? ' on' : ''),
            onclick: () => { blip(); set('theme', id); cards.querySelectorAll('.scard').forEach((x) => x.classList.toggle('on', x === c)); },
          },
          h('div', { class: 'scard-box' }, h('div', { class: `scard-pill p-${id}` }, h('i'), h('i'), h('i'))),
          h('span', { class: 'scard-lbl' }, lbl));
          cards.append(c);
        }
        g.append(h('label', { style: { gridColumn: '1 / -1' } }, $t('Stil')), cards, h('div', { class: 'hint' }, $t('Cam stilleri masaüstü duvar kağıdını görür ve kenarda kırar.')));
        const sws = h('div', { class: 'swatches' });
        for (const c of ACCENTS) sws.append(h('i', { class: cfg.accent === c ? 'on' : '', style: { background: c, color: c }, onclick: (e) => { set('accent', c); sws.querySelectorAll('i').forEach((x) => x.classList.toggle('on', x === e.target)); } }));
        row($t('Vurgu rengi'), sws);
        row($t('Boyut'), seg('size', [['S', 'S'], ['M', 'M'], ['L', 'L']]));
        const r = h('input', { type: 'range', min: 0, max: 100, value: cfg.radius });
        r.oninput = () => set('radius', +r.value);
        row($t('Köşe yarıçapı'), r, $t('Kare ya da tamamen yuvarlak; widget köşeleri de uyar.'));
        row($t('Canlı arka plan camı'), sw('liveGlass'), $t('Cam stilleri arkasındaki pencereleri de gerçek zamanlı kırar (ekran kaydında dock gizlenir).'));
        row($t('Ses efektleri'), sw('sounds'), $t('Dokunuşlarda kısa, sessiz bir tık sesi.'));
        // shown in both languages, so it can always be found
        const lang = h('select', {}, ...[['auto', 'Otomatik / Auto'], ['tr', 'Türkçe'], ['en', 'English']].map(([v, l]) => h('option', { value: v }, l)));
        lang.value = langSetting();
        lang.onchange = () => setLang(lang.value);
        row('Dil / Language', lang, $t('Değişince arayüz yeniden yüklenir.'));
      } else if (t === 'dock') {
        row($t('Konum'), seg('position', [['bottom', $t('Alt')], ['top', $t('Üst')]]));
        row($t('Windows görev çubuğunu gizle'), sw('hideTaskbar'), $t('Dock kapanınca görev çubuğu olduğu gibi geri gelir.'));
        row($t('Görev çubuğu tarzı'), sw('bar'), $t('Dock ekran kenarına yaslanır, tam genişlikte ve hep açık durur.'));
        row($t('Pencereler dock\'a taşmasın'), sw('reserve'), $t('Ekranı kaplayan pencereler dock\'un üstünde durur.'));
        row($t('Otomatik gizle'), seg('autoHide', [['off', $t('Kapalı')], ['smart', $t('Akıllı')], ['always', $t('Her zaman')]]), $t('Akıllı: bir pencere dock\'un yerini kaplayınca kenara kayar; fareyi ekran kenarına götürünce geri gelir. Açıkken pencerelere yer ayrılmaz.'));
        row($t('Mac tarzı büyütme'), sw('magnify'));
        row($t('Büyütme hızı'), seg('magSpeed', [['slow', $t('Yavaş')], ['normal', $t('Normal')], ['fast', $t('Hızlı')]]));
        row($t('Windows ile başlat'), sw('autostart', (v) => invoke('autostart', { enable: v })));
        row($t('Ücretsiz AI'), sw('ai'), $t('Aramada "kendi kelimelerinle" komutları için. Anahtar ya da abonelik yok.'));
        const mons = h('select', {});
        mons.append(h('option', { value: '' }, $t('Birincil ekran')));
        [0, 1, 2, 3].forEach((i) => mons.append(h('option', { value: i, selected: cfg.monitor === i ? '' : null }, `${$t('Ekran')} ${i + 1}`)));
        mons.onchange = () => set('monitor', mons.value === '' ? null : +mons.value);
        row($t('Ekran'), mons);
      } else if (t === 'weather') {
        row($t('Saat biçimi'), seg('clock24', [[true, $t('24 saat')], [false, $t('12 saat')]]));
        row($t('Saniyeleri göster'), sw('seconds'));
        const inp = h('input', { placeholder: cfg.city?.name || $t('Şehir ara'), style: { width: '200px' } });
        const list = h('div', { class: 'list', style: { gridColumn: '1/-1' } });
        let t2 = 0;
        inp.oninput = () => { clearTimeout(t2); t2 = setTimeout(async () => { const r = await geocode(inp.value).catch(() => []); list.innerHTML = ''; r.forEach((c) => list.append(h('div', { class: 'li', onclick: () => { set('city', { name: c.name, lat: c.lat, lon: c.lon }); inp.value = ''; inp.placeholder = c.name; list.innerHTML = ''; toast(`${$t('Şehir')}: ${c.name}`); } }, h('span', { class: 't1 grow' }, `${c.name}`), h('span', { class: 'hint' }, c.country || '')))); }, 250); };
        row($t('Hava durumu şehri'), inp);
        g.append(list);
        row($t('Konumu otomatik bul'), h('button', { class: 'btn', onclick: async () => { const c = await locate(); set('city', c); inp.placeholder = c.name; toast(`${$t('Şehir')}: ${c.name}`); } }, icon('globe', 13), $t('Bul')));
        const z = h('input', { value: cfg.zones.join(', '), style: { width: '260px' } });
        z.onchange = () => set('zones', z.value.split(',').map((s) => s.trim()).filter(Boolean));
        row($t('Dünya saatleri'), z, $t('IANA saat dilimleri, virgülle: Europe/Istanbul, Asia/Tokyo'));
        const fx = h('input', { value: `${cfg.fx.from}/${cfg.fx.to}`, style: { width: '110px' } });
        fx.onchange = () => { const [a, b] = fx.value.toUpperCase().split('/'); if (a && b) set('fx', { from: a.trim(), to: b.trim() }); };
        row($t('Döviz çifti'), fx);
      } else if (t === 'cal') {
        main.append(h('p', { class: 'mut', style: { lineHeight: 1.5, margin: '-4px 0 10px' } }, $t('Google, Outlook ve iCloud takvimlerinin gizli iCal (.ics) bağlantısını ekle. Hesap izni gerekmez; bağlantı yalnız bu bilgisayarda saklanır.')));
        const list = h('div', { class: 'list' });
        const draw = () => { list.innerHTML = ''; cfg.ics.forEach((f, i) => list.append(h('div', { class: 'li' }, h('i', { style: { width: '10px', height: '10px', borderRadius: '3px', background: f.color } }), h('div', { class: 'grow stack' }, h('span', { class: 't1' }, f.name), h('span', { class: 't2' }, f.url.slice(0, 60))), h('button', { class: 'ibtn', html: icon('close', 13), onclick: () => { set('ics', cfg.ics.filter((_, j) => j !== i)); draw(); } })))); };
        draw();
        const n = h('input', { placeholder: $t('Ad (ör. İş)'), style: { width: '120px' } }), u = h('input', { placeholder: 'https://... .ics', class: 'grow' });
        const add = h('button', { class: 'btn pri', onclick: () => { if (!/^(https|webcal):\/\//.test(u.value)) return toast($t('Geçerli bir https/webcal bağlantısı gir'), 'err'); set('ics', [...cfg.ics, { name: n.value || $t('Takvim'), url: u.value.trim(), color: ACCENTS[cfg.ics.length % ACCENTS.length] }]); n.value = u.value = ''; draw(); toast($t('Takvim eklendi')); } }, $t('Ekle'));
        main.append(list, h('div', { class: 'row', style: { marginTop: '10px' } }, n, u, add));
        g.remove();
      } else if (t === 'dev') {
        const gh = h('input', { value: cfg.ghUser, placeholder: $t('kullanıcı adı'), style: { width: '180px' } });
        gh.onchange = () => set('ghUser', gh.value.trim());
        row($t('GitHub kullanıcı adı'), gh, $t('Herkese açık katkı ızgarası için; token gerekmez.'));
        row($t('Claude limitleri'), h('span', { class: 'mut' }, $t('Claude masaüstü / Claude Code')), $t('Claude masaüstünün kendi kaydettiği yüzde okunur; Claude Code CLI girişi varsa sıfırlanma saatleri de gelir.'));
        row($t('Antigravity limitleri'), h('span', { class: 'mut' }, $t('Kapalı')), $t('Google kuralları gereği okunmuyor; resmî kota API’si yok.'));
        row('ChatGPT limitleri', h('span', { class: 'mut' }, $t('Codex CLI oturumu')), $t('\'codex login\' ile giriş yaptıysan otomatik okunur.'));
        const cr = h('input', { value: cfg.crypto.join(', '), style: { width: '200px' } });
        cr.onchange = () => set('crypto', cr.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
        row($t('Kripto paralar'), cr, 'CoinGecko kimlikleri: bitcoin, ethereum, solana');
      } else if (t === 'about') {
        main.append(h('div', { html: `<div class="row" style="gap:14px;margin:10px 0 14px"><div style="width:52px;height:52px;border-radius:14px;background:radial-gradient(circle at 50% 50%,transparent 38%,#7aa8ff 40%,#4f8cff 48%,transparent 52%),#0e1220"></div><div><div style="font:700 20px var(--font-d)">smartdock</div><div class="mut">${$t('Senin dock\'un. Hesap yok, sunucu yok, telemetri yok.')}</div></div></div>` }));
        const g2 = h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } });
        g2.append(
          h('button', { class: 'btn', onclick: () => openPicker() }, icon('grid', 13), $t('Widget\'lar')),
          h('button', { class: 'btn', onclick: () => location.reload() }, icon('chart', 13), $t('Arayüzü yenile')),
          h('button', { class: 'btn danger', onclick: () => invoke('quit') }, icon('power', 13), $t('Dock\'u kapat'))
        );
        main.append(g2);
        // updates: GitHub releases, opened in the browser; nothing installs by itself
        const up = h('div', { class: 'pace-box', style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '14px' } });
        const drawUp = () => {
          const l = update.latest;
          up.innerHTML = `<div class="grow"><div style="font-weight:600;font-size:12px">${l ? `${$t('Yeni sürüm')}: ${l.tag}` : `${$t('Sürüm')} ${update.current ? 'v' + update.current : ''}`}</div><div class="sub mut" style="margin-top:2px">${l ? $t('İndirip kurulum dosyasını çalıştır; ayarların korunur.') : $t('Yeni sürümler GitHub’dan denetlenir.')}</div></div>`;
          up.append(l ? h('button', { class: 'btn', onclick: openUpdate }, $t('İndir')) : h('button', { class: 'btn', onclick: () => checkUpdate() }, $t('Denetle')));
        };
        drawUp();
        if (!update.current) window.__TAURI__.app.getVersion().then((v) => { update.current = v; if (up.isConnected) drawUp(); });
        const offUp = bus.on('update', () => (up.isConnected ? drawUp() : offUp()));
        main.append(up, h('div', { class: 'grid', style: { marginTop: '10px' } }, h('label', {}, $t('Otomatik denetle')), sw('updateCheck')));
        g.remove();
      }
    };
    for (const [id, l, ic] of tabs) side.append(h('div', { class: 'cat', 'data-t': id, onclick: () => show(id), html: `${icon(ic, 15)}<span>${l}</span>` }));
    show(tab);
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
void esc;
