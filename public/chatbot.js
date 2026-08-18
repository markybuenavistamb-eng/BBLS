/* VFIC landing-page assistant — "Kuya Vic".
 *
 * A rule-based helper, not a language model: every answer is either fixed copy written here
 * or a figure read from the live rate card, so it can run with no API key and can never
 * invent a price. When it does not know something it says so and hands over to a real person
 * rather than guessing — a wrong quote on a balikbayan box is somebody's hard-earned money.
 *
 * It speaks the way the office does: Taglish, warm, "po" where it belongs.
 */
(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let CARD = null;          // live rate card, fetched once and reused
  let STATE = null;         // multi-step flows (tracking) park their progress here
  let opened = false;

  const money = (v, ccy) => `${ccy || 'PHP'} ${Number(v || 0).toLocaleString('en-PH')}`;

  async function card() {
    if (CARD) return CARD;
    try { CARD = await (await fetch('/api/box-sizes')).json(); }
    catch (e) { CARD = null; }
    return CARD;
  }

  /* ---------- the replies ---------- */

  const GREET = [
    'Kumusta po! 👋 Ako si <b>Kuya Vic</b> ng Victors Freight. Tanong lang po kayo tungkol sa balikbayan box — presyo, laki, o kung nasaan na ang padala ninyo.',
    'Hello po! Ako si <b>Kuya Vic</b>. Ano pong maitutulong ko sa padala ninyo ngayon?'
  ];

  const CHIPS = [
    ['Magkano ang padala?', 'presyo'],
    ['Anong laki ng box?', 'laki ng box'],
    ['Paano magpadala?', 'paano magpadala'],
    ['Saan na ang box ko?', 'track'],
    ['Saan ang office ninyo?', 'saan office'],
    ['Ano ang bawal ipadala?', 'bawal']
  ];

  async function answerRates() {
    const c = await card();
    if (!c || !c.shipping_rates || !c.shipping_rates.ocean) {
      return 'Pasensya po, hindi ko makuha ang presyo ngayon. Mas mabuti pong tawagan ang office namin para sa eksaktong quote.';
    }
    const ocean = c.shipping_rates.ocean;
    const level = ocean.OCEAN_ECONOMY ? 'OCEAN_ECONOMY' : Object.keys(ocean)[0];
    const mm = (ocean[level] || {}).METRO_MANILA || {};
    const labels = {};
    for (const s of (c.sizes || [])) labels[s.key || s.size] = s.label;
    const rows = ['SMALL', 'MEDIUM', 'LARGE', 'GIGA']
      .filter(k => mm[k])
      .map(k => `<tr><td>${esc(labels[k] || k)}</td><td><b>${esc(money(mm[k], c.currency))}</b></td></tr>`)
      .join('');
    if (!rows) return 'Wala pa pong nakatakdang presyo sa system ngayon — pakitawagan na lang po ang office para sa quote.';
    // Only name the origin city when this deployment actually serves one lane. Head office
    // answers for both, and telling a sender in Bangkok the rate is "from Manila" is worse
    // than saying nothing at all.
    const from = c.origin_country_locked && c.branch_city ? ` mula <b>${esc(c.branch_city)}</b>` : '';
    return `Ito po ang <b>sea freight</b> papuntang <b>Metro Manila</b>${from}:
      <table class="bot-tbl">${rows}</table>
      <span class="bot-note">Iba-iba po ang presyo depende sa destinasyon (Luzon, Visayas, Mindanao). Ang eksaktong halaga ay lalabas sa
      <a href="/intake-form.html">booking form</a> habang pinupunan ninyo ito.</span>`;
  }

  async function answerSizes() {
    const c = await card();
    if (!c || !c.sizes) return 'May Small, Medium, Large at Giga po kaming box. Pakitingnan po ang <a href="/order-box.html">order page</a> para sa sukat.';
    const rows = c.sizes.map(s => {
      const dims = s.dimensions || '';
      const cbm = s.cbm != null ? `${s.cbm} cbm` : '';
      return `<tr><td><b>${esc(s.label)}</b></td><td>${esc(dims)}</td><td>${esc(cbm)}</td></tr>`;
    }).join('');
    const price = c.priced && c.empty_box_prices
      ? `<span class="bot-note">Kung bibili po kayo ng walang lamang kahon: ` +
        c.sizes.filter(s => c.empty_box_prices[s.key || s.size])
          .map(s => `${esc(s.label)} ${esc(money(c.empty_box_prices[s.key || s.size], c.currency))}`).join(' · ') +
        `. <a href="/order-box.html">Mag-order dito →</a></span>`
      : '';
    return `Ito po ang mga laki ng box namin:<table class="bot-tbl">${rows}</table>${price}`;
  }

  function answerHow() {
    return `Ganito po kadali:
      <ol class="bot-list">
        <li>Mag-book online sa <a href="/intake-form.html">receiving form</a> — ilagay ang pangalan ninyo, ang tatanggap, at ang laman ng kahon.</li>
        <li>Ihatid ang kahon sa office namin, o ipa-pick up sa inyong address.</li>
        <li>Bibigyan kayo ng <b>box number</b> — iyon po ang pang-track hanggang makarating sa pamilya ninyo.</li>
      </ol>
      <span class="bot-note">Gusto ninyo pong magkaroon ng account para makita lahat ng padala ninyo?
      <a href="/account.html">Mag-sign up dito →</a></span>`;
  }

  async function answerBranches() {
    const c = await card();
    const lanes = (c && c.origin_countries) || [];
    const where = lanes.length
      ? `Kasalukuyan po kaming tumatanggap mula sa <b>${lanes.map(esc).join('</b> at <b>')}</b>.`
      : 'Tumatanggap po kami mula sa Thailand at Cambodia.';
    const office = c && c.origin_country_locked && c.branch_city
      ? `Ang office na naghahatid sa inyo ay nasa <b>${esc(c.branch_city)}</b>.` : '';
    return `${where} ${office}
      <span class="bot-note">Lahat ng padala ay dumadaan sa aming Manila warehouse bago ihatid sa buong Pilipinas.</span>`;
  }

  function answerProhibited() {
    return `Bawal po sa balikbayan box ang mga ito:
      <ul class="bot-list">
        <li>Pera, alahas, at mga mahahalagang papeles</li>
        <li>Baril, bala, paputok, at anumang pampasabog</li>
        <li>Droga at ipinagbabawal na gamot</li>
        <li>Sirang pagkain o mabilis mapanis</li>
        <li>Baterya na nakabukod (lalo na ang lithium), at aerosol</li>
      </ul>
      <span class="bot-note">Kapag may duda po kayo sa isang bagay, itanong muna sa amin bago ilagay — mas mabuti nang sigurado.</span>`;
  }

  function answerTime() {
    return `Karaniwan pong <b>45 hanggang 60 araw</b> mula sa pag-alis ng barko hanggang sa pintuan ng pamilya ninyo.
      Nakadepende po ito sa iskedyul ng barko at sa customs clearance.
      <span class="bot-note">Makikita ninyo ang tunay na petsa ng dating sa tracking kapag nakasakay na ang kahon sa barko.</span>`;
  }

  // Contact details come from the office's own settings, never from a copy kept here — a
  // stale number on the landing page is a customer who cannot reach anyone.
  async function supportLine() {
    const c = await card();
    const s = (c && c.support) || {};
    if (!s.phone && !s.email) return '';
    return [
      s.phone ? `<b>${esc(s.phone)}</b>` : '',
      s.email ? `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : ''
    ].filter(Boolean).join(' · ');
  }

  async function answerContact() {
    const line = await supportLine();
    if (!line) return 'Pakitingnan po ang contact details sa ibaba ng page — naroon po ang numero at email ng office namin.';
    return `Matatawagan ninyo po kami sa ${line}.
      <span class="bot-note">Kung tungkol po sa isang partikular na kahon, ihanda ninyo ang box number para mabilis ko itong mahanap.</span>`;
  }

  function answerEmptyBox() {
    return `Pwede po kayong bumili ng walang lamang kahon at kami na ang maghahatid sa inyo —
      <a href="/order-box.html">mag-order dito</a>. Ipapa-deliver namin ito sa address ninyo o pwede ninyong kunin sa office.`;
  }

  /* ---------- tracking, a real lookup rather than a canned reply ---------- */

  function startTracking() {
    STATE = { flow: 'track', step: 'box' };
    return 'Sige po! Ano po ang <b>box number</b> ninyo? Ganito po ang hitsura: <code>TH-2026-000001-01</code>';
  }

  async function trackingStep(text) {
    if (STATE.step === 'box') {
      const box = text.trim().toUpperCase();
      if (!/^[A-Z]{2}-\d{4}-\d{6}-\d{2}$/.test(box)) {
        return 'Parang hindi po tama ang porma ng box number. Dapat po ganito: <code>TH-2026-000001-01</code>. Pakisubukan po ulit.';
      }
      STATE.box = box; STATE.step = 'phone';
      return 'Salamat po! Para sa seguridad, ano po ang <b>huling 4 na numero</b> ng cellphone ng tatanggap?';
    }
    if (STATE.step === 'phone') {
      const last4 = text.replace(/\D/g, '').slice(-4);
      if (last4.length !== 4) return 'Kailangan po ng apat na numero — halimbawa <code>0201</code>.';
      let r;
      try {
        const res = await fetch('/api/track-lookup', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ box_number: STATE.box, phone_last4: last4 })
        });
        r = await res.json();
        if (!res.ok) { STATE = null; return `Pasensya po — ${esc(r.error || 'hindi ko po mahanap ang kahon na iyon.')}`; }
      } catch (e) { STATE = null; return 'Hindi ko po ma-abot ang tracking ngayon. Pakisubukan po mamaya.'; }
      STATE = null;
      const done = (r.journey || []).filter(s => s.done);
      const now = done.length ? done[done.length - 1] : null;
      return `Nakita ko po ang <b>${esc(r.box_number)}</b>! 📦
        <div class="bot-status">${esc(r.status_label || r.status)}</div>
        ${now && now.detail ? `<span class="bot-note">${esc(now.detail)}</span>` : ''}
        ${r.eta_text ? `<span class="bot-note"><b>${esc(r.eta_text)}</b></span>` : ''}
        <span class="bot-note">Para sa buong timeline: <a href="/track.html?t=${encodeURIComponent(r.qr_token || '')}">buksan ang tracking page →</a></span>`;
    }
    STATE = null;
    return null;
  }

  /* ---------- intent matching ---------- */
  // Tagalog and English side by side, because a sender types whichever comes first.
  const INTENTS = [
    { k: ['salamat', 'thank', 'thanks', 'maraming salamat'], f: () => 'Walang anuman po! 🙏 Ingat po kayo, at maabot nawa ang padala ninyo nang ligtas.' },
    { k: ['track', 'nasaan', 'saan na', 'hanap', 'follow up', 'status', 'where is'], f: startTracking },
    { k: ['magkano', 'presyo', 'price', 'rate', 'bayad', 'singil', 'cost', 'how much'], f: answerRates },
    { k: ['laki', 'sukat', 'size', 'cbm', 'dimension', 'gaano kalaki'], f: answerSizes },
    { k: ['bumili', 'order box', 'empty box', 'walang laman', 'kahon lang', 'buy a box'], f: answerEmptyBox },
    { k: ['paano', 'how do i', 'how to', 'magpadala', 'send', 'book', 'mag-book'], f: answerHow },
    { k: ['gaano katagal', 'how long', 'kailan', 'arrive', 'dating', 'delivery time', 'ilang araw'], f: answerTime },
    { k: ['saan', 'office', 'branch', 'address', 'location', 'sangay'], f: answerBranches },
    { k: ['bawal', 'prohibited', 'allowed', 'pwede ba', 'restricted', 'hindi pwede'], f: answerProhibited },
    { k: ['contact', 'tawag', 'number', 'email', 'hotline', 'customer service'], f: answerContact },
    { k: ['kumusta', 'kamusta', 'hello', 'hi ', 'hey', 'magandang', 'good morning', 'good day'], f: () => GREET[1] }
  ];

  async function reply(text) {
    const t = ' ' + text.toLowerCase().trim() + ' ';
    if (STATE && STATE.flow === 'track') {
      const out = await trackingStep(text);
      if (out) return out;
    }
    for (const it of INTENTS) {
      if (it.k.some(k => t.includes(k))) return await it.f();
    }
    const line = await supportLine();
    return `Pasensya po, hindi ko masyadong nakuha iyon. 🤔 Ito po ang mga kaya kong sagutin:
      <span class="bot-note">presyo · laki ng box · paano magpadala · kung nasaan na ang kahon · address ng office · bawal ipadala</span>
      ${line ? `<span class="bot-note">Kung may ibang tanong po kayo, tawagan ninyo kami sa ${line} — may tao pong sasagot.</span>` : ''}`;
  }

  /* ---------- widget ---------- */

  function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }

  function mount() {
    const fab = el(`<button class="bot-fab" type="button" aria-label="Chat with Kuya Vic">
      <span class="bot-fab-ico">💬</span><span class="bot-fab-txt">Tanong?</span></button>`);
    const panel = el(`
      <div class="bot-panel" hidden>
        <div class="bot-head">
          <div class="bot-ava">🧑🏽‍✈️</div>
          <div>
            <b>Kuya Vic</b>
            <div class="bot-sub">VFIC helper · sumasagot agad</div>
          </div>
          <button class="bot-x" type="button" aria-label="I-minimize" title="I-minimize">–</button>
        </div>
        <div class="bot-log"></div>
        <div class="bot-chips"></div>
        <form class="bot-form">
          <input class="bot-input" autocomplete="off" placeholder="Magtanong po kayo…" maxlength="300">
          <button class="bot-send" type="submit">Send</button>
        </form>
      </div>`);
    document.body.appendChild(fab);
    document.body.appendChild(panel);

    const log = panel.querySelector('.bot-log');
    const chips = panel.querySelector('.bot-chips');
    const input = panel.querySelector('.bot-input');

    function add(who, html) {
      const row = el(`<div class="bot-msg ${who}"><div class="bot-bub">${html}</div></div>`);
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;
      return row;
    }
    function typing() {
      return add('bot', '<span class="bot-dots"><i></i><i></i><i></i></span>');
    }
    async function say(text) {
      add('me', esc(text));
      const t = typing();
      const html = await reply(text);
      // A beat before answering: an instant reply reads like a form, not a person.
      setTimeout(() => { t.querySelector('.bot-bub').innerHTML = html; log.scrollTop = log.scrollHeight; }, 320);
    }

    chips.innerHTML = CHIPS.map(([label, q]) =>
      `<button type="button" class="bot-chip" data-q="${esc(q)}">${esc(label)}</button>`).join('');
    chips.addEventListener('click', (e) => {
      const b = e.target.closest('.bot-chip');
      if (b) say(b.dataset.q);
    });

    panel.querySelector('.bot-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      input.value = '';
      say(v);
    });

    function open() {
      panel.hidden = false;
      fab.classList.add('bot-hidden');
      if (!opened) {
        opened = true;
        add('bot', GREET[0]);
        card();                       // warm the rate card while they read the greeting
      }
      input.focus();
    }
    // Minimise, not close: the conversation stays exactly as it was, so reopening carries on
    // rather than greeting them again as though they had never asked anything.
    function minimize() { panel.hidden = true; fab.classList.remove('bot-hidden'); }

    fab.addEventListener('click', open);
    panel.querySelector('.bot-x').addEventListener('click', minimize);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) minimize(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
