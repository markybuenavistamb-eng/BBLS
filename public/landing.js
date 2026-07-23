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
})();
