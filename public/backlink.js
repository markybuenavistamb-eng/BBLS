/* Shared "← Back" behaviour for the public pages a customer reaches from their portal.
 *
 * A customer who opens "Book a new box" or "Track a box" from their account has left the
 * portal entirely — these are separate pages, not tabs — and without this there is no way
 * back except the browser's own button, which people on phones often do not use.
 *
 * Going back through history returns them to wherever they actually came from (the account,
 * the landing page, a search result), which is what "back" means to them. The href stays a
 * real link so it still works with JavaScript off and opens in a new tab if they ask for it.
 */
(function () {
  function wire() {
    document.querySelectorAll('.pub-back').forEach(function (el) {
      if (el.dataset.wired) return;
      el.dataset.wired = '1';
      el.addEventListener('click', function (e) {
        // Only intercept a plain left click — let modifier-clicks open a tab as usual.
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (history.length > 1) { e.preventDefault(); history.back(); }
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
