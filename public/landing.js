/* VFIC landing page — language switcher (text-link style) + year stamp. */
(function () {
  const yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

  function mountToggle() {
    const el = document.getElementById('langMount');
    if (!el) return;
    const lang = VI.getLang();
    el.innerHTML =
      `<button type="button" class="u-link${lang === 'en' ? ' active' : ''}" data-lang="en">ENG</button>` +
      `<span class="sep">|</span>` +
      `<button type="button" class="u-link${lang === 'tl' ? ' active' : ''}" data-lang="tl">TAG</button>`;
    el.querySelectorAll('[data-lang]').forEach(b =>
      b.addEventListener('click', () => VI.setLang(b.dataset.lang)));
  }

  mountToggle();
  VI.onChange(mountToggle);
  VI.applyStatic(document);

  /* ---------- staff portal picker ---------- */
  // Which door to sign in at. The list comes from the server rather than being hard-coded,
  // because a branch deployment holds only its own staff accounts — offering another
  // country's portal here would be a door whose key nobody on this site has.
  const esc = (s) => String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const modal = document.getElementById('portalModal');
  const link = document.getElementById('staffLoginLink');
  let loaded = false;

  const card = (p) => `
    <a class="portal-card" href="${esc(p.href)}"${p.external ? ' target="_blank" rel="noopener"' : ''}>
      <span class="portal-flag" style="background:${esc(p.accent)}">${esc(p.flag)}</span>
      <span class="portal-body">
        <b>${esc(p.label)}</b>
        <span class="portal-city">${esc(p.city)}${p.country ? ' · ' + esc(p.country) : ''}</span>
      </span>
      <span class="portal-go">${p.external ? '↗' : '→'}</span>
    </a>`;

  async function loadPortals() {
    if (loaded) return;
    const list = document.getElementById('portalList');
    const other = document.getElementById('portalElsewhere');
    try {
      const r = await fetch('/api/portals');
      const d = await r.json();
      list.innerHTML = d.here.length
        ? d.here.map(card).join('')
        : '<div class="portal-empty">No staff portal is configured on this site.</div>';
      // Only head office is given the branch sites; a branch site shows itself alone.
      other.innerHTML = d.elsewhere.length ? `
        <div class="portal-sep" data-i18n="land.portal.branches">Branch sites</div>
        ${d.elsewhere.map(card).join('')}
        <div class="portal-note" data-i18n="land.portal.note">Branch portals are separate sites with their own staff accounts.</div>` : '';
      VI.applyStatic(other);
      loaded = true;
    } catch (e) {
      list.innerHTML = '<div class="portal-empty">Could not load the portal list. Try again in a moment.</div>';
    }
  }

  function openModal(e) {
    if (e) e.preventDefault();
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    loadPortals();
  }
  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  if (link && modal) {
    link.addEventListener('click', openModal);
    modal.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
  }
})();

/* Rate calculator — what a box costs, answered on the page.
 *
 * Somebody weighing up whether to ship should not have to ring an office in another time zone to
 * find out the price. The figures come from the same rate cards the office bills from, so a quote
 * here and an invoice later agree, and a card edited in the Developer Console changes this page
 * without anybody republishing anything.
 */
(function () {
  'use strict';

  const host = document.getElementById('rateCalc');
  if (!host) return;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let DATA = null;
  const pick = { origin: '', zone: '', level: '', size: '', kg: '', L: '', W: '', H: '' };
  const OWN = '__OWN__';   // "my own box" sits in the size list beside the standard ones

  const money = (amount, currency) => {
    const n = Number(amount) || 0;
    try {
      return new Intl.NumberFormat('en-PH', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
    } catch (e) { return currency + ' ' + n.toLocaleString(); }
  };
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

  async function load() {
    try {
      const res = await fetch('/api/public/rates');
      if (!res.ok) throw new Error('unavailable');
      DATA = await res.json();
    } catch (e) {
      host.innerHTML = '<div class="rate-loading">Rates are not available right now. '
        + 'Please <a href="#contact">contact us</a> for a quote.</div>';
      return;
    }
    if (!DATA.origins.length) {
      host.innerHTML = '<div class="rate-loading">Rates have not been published yet. '
        + 'Please <a href="#contact">contact us</a> for a quote.</div>';
      return;
    }
    pick.origin = DATA.origins[0].key;
    pick.zone = (DATA.zones[0] || {}).key || '';
    pick.level = DATA.ocean_levels[0];
    pick.size = (DATA.sizes[0] || {}).key || '';
    render();
  }

  const originOf = () => DATA.origins.find(o => o.key === pick.origin) || DATA.origins[0];
  const isAir = () => pick.level === DATA.air_level;
  const isOwnBox = () => pick.size === OWN;
  // Only the levels this destination can actually be sold. Ocean Priority reaches Metro Manila
  // only, so offering it elsewhere would quote a service the booking would then refuse.
  const levelsHere = () => (DATA.levels_by_zone || {})[pick.zone]
    || DATA.ocean_levels.concat([DATA.air_level]);

  // A sender's own carton is charged as the smallest standard box it would fit inside: what
  // costs money is the space it takes in the container, not whose cardboard it is.
  function ownBoxFit() {
    const l = num(pick.L), w = num(pick.W), h = num(pick.H);
    if (!l || !w || !h) return { incomplete: true };
    const cbm = +((l * w * h) / 1e6).toFixed(4);
    const sorted = DATA.sizes.slice().sort((a, b) => a.cbm - b.cbm);
    const fit = sorted.find(s => cbm <= s.cbm + 1e-9);
    return { cbm, fit: fit || null, overSized: !fit, largest: sorted[sorted.length - 1] };
  }

  // The size's included weight allowance. Above it the office charges excess on the scale, so a
  // sender who has already told us the weight should hear about it now, not at the counter.
  function overWeight(size) {
    const kg = num(pick.kg);
    const allow = Number(size.standard_weight_kg) || 0;
    return (kg && allow && kg > allow) ? { kg, allow } : null;
  }

  function quote() {
    const o = originOf();
    if (!o || !pick.zone) return null;

    if (isAir()) {
      const perKg = Number(((o.air || {})[DATA.air_level] || {})[pick.zone]) || 0;
      const kg = num(pick.kg);
      if (!perKg) return { unavailable: true };
      if (!kg) return { needsMore: 'Enter the weight in kilos to see the price.', basis: money(perKg, o.currency) + ' per kilo' };
      return { amount: perKg * kg, currency: o.currency, basis: money(perKg, o.currency) + ' per kilo × ' + kg + ' kg' };
    }

    let sizeKey = pick.size, own = null;
    if (isOwnBox()) {
      own = ownBoxFit();
      if (own.incomplete) return { needsMore: 'Enter the length, width and height of your box.' };
      if (own.overSized) return { oversized: own };
      sizeKey = own.fit.key;
    }

    const amount = Number((((o.ocean || {})[pick.level] || {})[pick.zone] || {})[sizeKey]) || 0;
    if (!amount) return { unavailable: true };
    const size = DATA.sizes.find(s => s.key === sizeKey) || {};
    const name = String(size.label || '').toLowerCase();
    const asBox = /\bbox$/.test(name) ? name : name + ' box';
    return {
      amount, currency: o.currency, own,
      basis: own ? own.cbm + ' cbm — charged as one ' + asBox : 'one ' + asBox + ', all in',
      overWeight: overWeight(size)
    };
  }

  function render() {
    const o = originOf();
    // A destination that cannot take the chosen service falls back quietly rather than
    // quoting nothing at all.
    if (!levelsHere().includes(pick.level)) pick.level = levelsHere()[0];
    const q = quote();
    const own = isOwnBox() ? ownBoxFit() : null;
    const emptyPrice = (!isAir() && !isOwnBox()) ? (o.empty_box_price || {})[pick.size] : null;

    const sizeField = isAir() ? `
      <label>
        <span>Weight</span>
        <input data-f="kg" type="number" min="0" step="0.5" inputmode="decimal" placeholder="kilos" value="${esc(pick.kg)}">
      </label>` : `
      <label>
        <span>Box size</span>
        <select data-f="size">
          ${DATA.sizes.map(s => `<option value="${esc(s.key)}"${s.key === pick.size ? ' selected' : ''}>${esc(s.label)}${s.dimensions ? ' · ' + esc(s.dimensions) : ''}</option>`).join('')}
          <option value="${OWN}"${isOwnBox() ? ' selected' : ''}>I have my own box — enter measurements</option>
        </select>
      </label>`;

    const ownFields = !isOwnBox() ? '' : `
      <div class="rate-own">
        <div class="rate-own-grid">
          <label><span>Length</span><input data-f="L" type="number" min="0" step="1" inputmode="decimal" placeholder="cm" value="${esc(pick.L)}"></label>
          <label><span>Width</span><input data-f="W" type="number" min="0" step="1" inputmode="decimal" placeholder="cm" value="${esc(pick.W)}"></label>
          <label><span>Height</span><input data-f="H" type="number" min="0" step="1" inputmode="decimal" placeholder="cm" value="${esc(pick.H)}"></label>
          <label><span>Weight</span><input data-f="kg" type="number" min="0" step="0.5" inputmode="decimal" placeholder="kg" value="${esc(pick.kg)}"></label>
        </div>
        ${own && own.cbm ? `<div class="rate-own-note">${own.cbm} cbm${own.fit ? ' · fits our ' + esc(own.fit.label) + ' (' + esc(own.fit.dimensions) + ')' : ''}</div>` : ''}
      </div>`;

    let answer = '';
    if (q && q.unavailable) {
      answer = '<div class="rate-none">We do not have a published rate for that combination yet — '
        + '<a href="#contact">ask us</a> and we will quote it.</div>';
    } else if (q && q.oversized) {
      answer = `<div class="rate-none"><b>${q.oversized.cbm} cbm</b> is larger than our biggest box
        (${esc(q.oversized.largest.label)}, ${q.oversized.largest.cbm} cbm).
        <a href="#contact">Talk to us</a> — we ship crates and pallets too.</div>`;
    } else if (q && q.needsMore) {
      answer = `<div class="rate-none">${esc(q.needsMore)}${q.basis ? '<br><span class="rate-basis">' + esc(q.basis) + '</span>' : ''}</div>`;
    } else if (q) {
      answer = `<div class="rate-amount">${esc(money(q.amount, q.currency))}</div>
        <div class="rate-basis">${esc(q.basis)}</div>
        ${q.overWeight ? `<div class="rate-warn">Over the ${q.overWeight.allow} kg allowance for that size by ${+(q.overWeight.kg - q.overWeight.allow).toFixed(1)} kg — excess is charged on the scale.</div>` : ''}
        ${q.own && q.own.fit && q.own.fit.exceeds_boc_cbm ? `<div class="rate-warn">Above the ${DATA.boc_max_cbm} cbm customs limit for the Balikbayan Box privilege — duties may apply.</div>` : ''}`;
    }

    host.innerHTML = `
      <div class="rate-form">
        <label>
          <span>Sending from</span>
          ${DATA.origin_locked || DATA.origins.length === 1
            ? `<div class="rate-fixed">${esc(o.label)}</div>`
            : `<select data-f="origin">${DATA.origins.map(x => `<option value="${esc(x.key)}"${x.key === pick.origin ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select>`}
        </label>
        <label>
          <span>Delivering to</span>
          <select data-f="zone">${DATA.zones.map(z => `<option value="${esc(z.key)}"${z.key === pick.zone ? ' selected' : ''}>${esc(z.label)}</option>`).join('')}</select>
        </label>
        <label>
          <span>Service</span>
          <select data-f="level">${levelsHere().map(l => `<option value="${esc(l)}"${l === pick.level ? ' selected' : ''}>${esc(DATA.service_level_labels[l] || l)}</option>`).join('')}</select>
          ${pick.zone !== 'METRO_MANILA' ? '<span class="rate-hint">Ocean Priority is Metro Manila only.</span>' : ''}
        </label>
        ${sizeField}
        ${ownFields}
      </div>

      <div class="rate-out">
        ${answer}
        ${emptyPrice ? `<div class="rate-extra">Need the box itself? ${esc(money(emptyPrice, o.currency))} — <a href="/order-box.html">order one</a> and we will bring it to you.</div>` : ''}
        <div class="rate-note">${esc(DATA.disclaimer)}</div>
        <a class="btn-lg btn-primary rate-cta" href="/intake-form.html">Book this shipment</a>
      </div>`;

    host.querySelectorAll('[data-f]').forEach(el => {
      const ev = el.tagName === 'INPUT' ? 'input' : 'change';
      el.addEventListener(ev, () => {
        pick[el.dataset.f] = el.value;
        const active = el.dataset.f;
        render();
        // Redrawing loses focus mid-type, so it is handed straight back.
        const again = host.querySelector('[data-f="' + active + '"]');
        if (again && el.tagName === 'INPUT') again.focus();
      });
    });
  }

  load();
})();

