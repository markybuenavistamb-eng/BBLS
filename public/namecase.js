/* Proper Case for names — shared by every page that asks someone to type one.
 *
 * A name is read back on a label, a printed form, a call list, so it should look the same
 * whichever staff member typed it or however a phone's autocapitalize left it. This mirrors
 * server.js's properName() exactly; the server is the one that actually enforces it (a
 * direct API call bypasses this file entirely), so this only needs to agree with it, not to
 * be the source of truth.
 */
(function () {
  'use strict';

  const NOT_GIVEN = (v) => !v || /^n\.?\/?a\.?$/i.test(String(v).trim());
  const ROMAN_SUFFIX = /^(I{1,3}|IV|VI{0,3}|IX|X)\.?$/i;   // II, III, IV … X — not "Ii", "Iii"

  function properName(raw) {
    const v = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
    if (!v) return v;
    // "N/A" is a real answer on the BOC form, not a name to title-case into "N/a".
    if (NOT_GIVEN(v)) return 'N/A';
    const capToken = (t) => {
      if (!t) return t;
      if (ROMAN_SUFFIX.test(t.replace(/\.$/, ''))) return t.toUpperCase();
      return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    };
    // Capitalise after spaces, hyphens and apostrophes too, so "dela cruz-santos" and
    // "o'brien" come out "Dela Cruz-Santos" and "O'Brien" rather than one capital per word.
    return v.split(' ').map(word =>
      word.split('-').map(part => part.split("'").map(capToken).join("'")).join('-')
    ).join(' ');
  }

  // Formats on blur, not on every keystroke — reformatting mid-word while someone is still
  // typing would fight the cursor and reflow the text under their fingers.
  function wireNameCase(idOrEl) {
    const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    if (!el || el.dataset.namecaseWired) return;
    el.dataset.namecaseWired = '1';
    el.addEventListener('blur', () => {
      const next = properName(el.value);
      if (next !== el.value) el.value = next;
    });
  }

  window.properName = properName;
  window.wireNameCase = wireNameCase;
})();
