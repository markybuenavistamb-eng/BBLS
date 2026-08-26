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
  const pick = { origin: '', zone: '', level: '', size: '', kg: '' };

  const money = (amount, currency) => {
    const n = Number(amount) || 0;
    try {
      return new Intl.NumberFormat('en-PH', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
    } catch (e) {
      return currency + ' ' + n.toLocaleString();
    }
  };

  async function load() {
    try {
      const res = await fetch('/api/public/rates');
      if (!res.ok) throw new Error('rates unavailable');
      DATA = await res.json();
    } catch (e) {
      host.innerHTML = `<div class="rate-loading">Rates are not available right now.
        Please <a href="#contact">contact us</a> for a quote.</div>`;
      return;
    }
    if (!DATA.origins.length) {
      host.innerHTML = `<div class="rate-loading">Rates have not been published yet.
        Please <a href="#contact">contact us</a> for a quote.</div>`;
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

  // The same arithmetic the office bills with: ocean is a flat price for the box, air is by the
  // kilo. Kept deliberately simple — anything conditional belongs in the booking, not the quote.
  function quote() {
    const o = originOf();
    if (!o || !pick.zone) return null;
    if (isAir()) {
      const perKg = Number(((o.air || {})[DATA.air_level] || {})[pick.zone]) || 0;
      const kg = Number(pick.kg) || 0;
      if (!perKg) return { unavailable: true };
      return { amount: perKg * kg, currency: o.currency, basis: `${money(perKg, o.currency)} per kilo × ${kg || 0} kg`, needsWeight: !kg };
    }
    const amount = Number((((o.ocean || {})[pick.level] || {})[pick.zone] || {})[pick.size]) || 0;
    if (!amount) return { unavailable: true };
    const size = DATA.sizes.find(s => s.key === pick.size) || {};
    // "Giga Box" already says box; "Large" does not. Appending blindly gave "one giga box box".
    const name = String(size.label || '').toLowerCase();
    return { amount, currency: o.currency, basis: `one ${/\bbox$/.test(name) ? name : name + ' box'}, all in` };
  }

  function render() {
    const o = originOf();
    const q = quote();
    const levels = DATA.ocean_levels.concat([DATA.air_level]);
    const emptyPrice = (o.empty_box_price || {})[pick.size];

    host.innerHTML = `
      <div class="rate-form">
        <label>
          <span>Sending from</span>
          <select data-f="origin">${DATA.origins.map(x =>
            `<option value="${esc(x.key)}"${x.key === pick.origin ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
        </label>
        <label>
          <span>Delivering to</span>
          <select data-f="zone">${DATA.zones.map(z =>
            `<option value="${esc(z.key)}"${z.key === pick.zone ? ' selected' : ''}>${esc(z.label)}</option>`).join('')}</select>
        </label>
        <label>
          <span>Service</span>
          <select data-f="level">${levels.map(l =>
            `<option value="${esc(l)}"${l === pick.level ? ' selected' : ''}>${esc(DATA.service_level_labels[l] || l)}</option>`).join('')}</select>
        </label>
        ${isAir() ? `
          <label>
            <span>Weight</span>
            <input data-f="kg" type="number" min="0" step="0.5" inputmode="decimal"
                   placeholder="kilos" value="${esc(pick.kg)}">
          </label>`
        : `
          <label>
            <span>Box size</span>
            <select data-f="size">${DATA.sizes.map(s =>
              `<option value="${esc(s.key)}"${s.key === pick.size ? ' selected' : ''}>${esc(s.label)}${s.dimensions ? ' · ' + esc(s.dimensions) : ''}</option>`).join('')}</select>
          </label>`}
      </div>

      <div class="rate-out">
        ${!q ? '' : q.unavailable
          ? `<div class="rate-none">We do not have a published rate for that combination yet —
               <a href="#contact">ask us</a> and we will quote it.</div>`
          : q.needsWeight
            ? `<div class="rate-none">Enter the weight in kilos to see the price.<br>
                 <span class="rate-basis">${esc(q.basis)}</span></div>`
            : `<div class="rate-amount">${esc(money(q.amount, q.currency))}</div>
               <div class="rate-basis">${esc(q.basis)}</div>`}
        ${!isAir() && emptyPrice ? `<div class="rate-extra">Need the box itself? ${esc(money(emptyPrice, o.currency))} —
          <a href="/order-box.html">order one</a> and we will bring it to you.</div>` : ''}
        <div class="rate-note">${esc(DATA.disclaimer)}</div>
        <a class="btn-lg btn-primary rate-cta" href="/intake-form.html">Book this shipment</a>
      </div>`;

    host.querySelectorAll('[data-f]').forEach(el => {
      const ev = el.tagName === 'INPUT' ? 'input' : 'change';
      el.addEventListener(ev, () => {
        pick[el.dataset.f] = el.value;
        // Switching between ocean and air swaps the size picker for a weight box, so the whole
        // panel is redrawn; the field keeps focus so typing a weight is not interrupted.
        const active = el.dataset.f;
        render();
        const again = host.querySelector(`[data-f="${active}"]`);
        // A number input has no selection to move the caret within, and asking throws. Focus is
        // all that is needed anyway — the caret stays where the browser left it.
        if (again && el.tagName === 'INPUT') again.focus();
      });
    });
  }

  load();
})();
