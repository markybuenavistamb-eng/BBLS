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
