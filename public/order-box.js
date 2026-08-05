/* VFIC "Order a Box" — a customer with no box yet buys empty balikbayan box(es) from VFIC.
   They pick size(s) + quantity, then choose home delivery or office pick-up. */

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const gid = (id) => document.getElementById(id);
const digits = (v) => String(v || '').replace(/\D/g, '');
const isPhMobile = (v) => /^09\d{9}$/.test(digits(v));

let SIZES = [];
let ORIGIN_COUNTRIES = ['Thailand', 'Cambodia'];
let submitted = false, LAST_REF = null;

// Empty-box pricing comes from the branch rate card of the country the customer is in, so
// Thailand and Cambodia can be priced differently and in their own currency.
let PRICES = {}, CURRENCY = '', PRICED = false;
let COUNTRY = localStorage.getItem('vfic_order_country') || '';

async function loadSizes(country) {
  try {
    const q = country ? '?country=' + encodeURIComponent(country) : '';
    const d = await (await fetch('/api/box-sizes' + q)).json();
    SIZES = d.sizes || [];
    if (Array.isArray(d.origin_countries) && d.origin_countries.length) ORIGIN_COUNTRIES = d.origin_countries;
    PRICES = d.empty_box_prices || {};
    CURRENCY = d.currency || '';
    PRICED = !!d.priced;
  } catch (e) { SIZES = []; }
}

const fmtMoney = (v) => `${CURRENCY} ${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const priceOf = (key) => +(PRICES[key] || 0);

// Re-price the catalogue when the customer changes country, keeping their quantities.
async function onOrderCountryChange() {
  const sel = gid('obCountry');
  COUNTRY = sel ? sel.value : '';
  localStorage.setItem('vfic_order_country', COUNTRY);
  const keep = {};
  SIZES.forEach(s => { keep[s.key] = parseInt((gid('qty_' + s.key) || {}).value, 10) || 0; });
  await loadSizes(COUNTRY);
  const grid = gid('obGrid');
  if (grid) grid.innerHTML = SIZES.map(sizeCardHtml).join('');
  SIZES.forEach(s => { const el = gid('qty_' + s.key); if (el && keep[s.key]) el.value = keep[s.key]; });
  // keep the delivery-address country in step with the pricing country
  const addr = gid('oCountry');
  if (addr && COUNTRY) addr.value = COUNTRY;
  renderTotal();
}

function mountToggle() { const el = gid('langMount'); if (el && window.VI) el.innerHTML = VI.toggleHtml(); }

// A little isometric cardboard box, scaled to the real dimensions so sizes look different.
function boxSvg(s) {
  const k = 0.85; // cm → px
  const w = s.width_cm * k, h = s.height_cm * k, dp = s.length_cm * k;
  const dx = dp * 0.5, dy = -dp * 0.5;
  const x0 = 12, y0 = 118 - h; // baseline
  const front = `${x0},${y0} ${x0 + w},${y0} ${x0 + w},${y0 + h} ${x0},${y0 + h}`;
  const top = `${x0},${y0} ${x0 + dx},${y0 + dy} ${x0 + w + dx},${y0 + dy} ${x0 + w},${y0}`;
  const side = `${x0 + w},${y0} ${x0 + w + dx},${y0 + dy} ${x0 + w + dx},${y0 + h + dy} ${x0 + w},${y0 + h}`;
  const tapeY = y0 + h * 0.34;
  return `<svg viewBox="0 0 150 122" width="150" height="122" role="img" aria-label="${esc(s.label)} box">
    <polygon points="${side}" fill="#c39a6b" stroke="#8a6a45" stroke-width="1.2"/>
    <polygon points="${top}" fill="#e6cfa6" stroke="#8a6a45" stroke-width="1.2"/>
    <polygon points="${front}" fill="#d9b98a" stroke="#8a6a45" stroke-width="1.2"/>
    <line x1="${x0}" y1="${tapeY}" x2="${x0 + w}" y2="${tapeY}" stroke="#b7935f" stroke-width="6" opacity=".7"/>
    <line x1="${x0 + w / 2}" y1="${y0}" x2="${x0 + w / 2}" y2="${y0 + h}" stroke="#b7935f" stroke-width="4" opacity=".5"/>
  </svg>`;
}

function sizeCardHtml(s) {
  return `<div class="ob-card">
    <div class="ob-pic">${boxSvg(s)}</div>
    <div class="ob-body">
      <div class="ob-name">${esc(s.label)}${s.key === 'LARGE' ? ' <span class="ob-tag">Standard</span>' : ''}</div>
      <div class="ob-spec">${esc(s.dimensions)}</div>
      <div class="ob-spec muted"><b>${s.cbm} cbm</b> · up to <b>${s.standard_weight_kg} kg</b></div>
      ${PRICED
        ? `<div class="ob-price">${esc(fmtMoney(priceOf(s.key)))}<span class="ob-price-unit"> per box</span></div>`
        : `<div class="ob-price muted" style="font-size:12.5px;font-weight:600">Price on request</div>`}
      ${s.exceeds_boc_cbm ? `<div class="ob-spec" style="color:#b45309;font-size:11px">Over the ${'≤'} 0.20 cbm balikbayan cap</div>` : ''}
      <div class="ob-qty">
        <button type="button" class="qbtn" onclick="bump('${s.key}',-1)">−</button>
        <input id="qty_${s.key}" type="number" min="0" max="999" value="0" inputmode="numeric" oninput="renderTotal()">
        <button type="button" class="qbtn" onclick="bump('${s.key}',1)">+</button>
      </div>
    </div>
  </div>`;
}

function bump(key, delta) {
  const el = gid('qty_' + key); if (!el) return;
  el.value = Math.max(0, (parseInt(el.value, 10) || 0) + delta);
  renderTotal();
}
function currentItems() {
  return SIZES.map(s => ({ size: s.key, label: s.label, qty: parseInt((gid('qty_' + s.key) || {}).value, 10) || 0 })).filter(i => i.qty > 0);
}
function renderTotal() {
  const items = currentItems();
  const el = gid('obTotal');
  if (!el) return;
  if (!items.length) { el.innerHTML = 'No boxes selected yet.'; return; }
  const boxes = items.reduce((n, i) => n + i.qty, 0);
  const volume = items.reduce((n, i) => n + i.qty * ((SIZES.find(s => s.key === i.size) || {}).cbm || 0), 0);
  const cost = items.reduce((n, i) => n + i.qty * priceOf(i.size), 0);
  el.innerHTML = `
    <div>${boxes} box(es): ${items.map(i => `${i.qty}× ${esc(i.label)}`).join(', ')} · <b>${volume.toFixed(3)} cbm</b> total</div>
    ${PRICED ? `<div class="ob-grand">Estimated total: <b>${esc(fmtMoney(cost))}</b>
      <span class="muted" style="font-weight:400;font-size:12px">— boxes only; delivery is confirmed by our agent</span></div>` : ''}`;
}

function onDeliveryChange() {
  const m = (document.querySelector('input[name="delivery"]:checked') || {}).value;
  const addr = gid('addrWrap'), office = gid('officeWrap');
  if (addr) addr.style.display = m === 'DELIVER_ADDRESS' ? '' : 'none';
  if (office) office.style.display = m === 'PICKUP_OFFICE' ? '' : 'none';
}

function renderForm() {
  mountToggle();
  if (window.VI) VI.applyStatic(document);
  gid('app').innerHTML = `
    <div class="card">
      <div class="rc-label">1 · WHERE ARE YOU ORDERING FROM?</div>
      <div class="muted" style="font-size:12px;margin-bottom:6px">Box prices and currency depend on the branch serving your country.</div>
      <select id="obCountry" onchange="onOrderCountryChange()" style="max-width:280px">
        <option value="">— select your country —</option>
        ${ORIGIN_COUNTRIES.map(c => `<option value="${esc(c)}"${c === COUNTRY ? ' selected' : ''}>${esc(c)}</option>`).join('')}
      </select>
    </div>

    <div class="card">
      <div class="rc-label">2 · CHOOSE YOUR BOX SIZE(S)</div>
      <div class="muted" style="font-size:12px;margin-bottom:8px">Dimensions are outside measurements in centimetres; volume is shown in cubic metres (cbm) and the weight is the standard included allowance.</div>
      <div class="ob-grid" id="obGrid">${SIZES.map(sizeCardHtml).join('')}</div>
      <div class="ob-total" id="obTotal">No boxes selected yet.</div>
    </div>

    <div class="card">
      <div class="rc-label">3 · HOW WOULD YOU LIKE TO GET THEM?</div>
      <div class="note-info" style="margin-bottom:8px">The empty box(es) are delivered to the <b>sender abroad</b> — please use the sender's address and contact details below.</div>
      <datalist id="dlCountries">${ORIGIN_COUNTRIES.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <label class="chk"><input type="radio" name="delivery" value="DELIVER_ADDRESS" checked onchange="onDeliveryChange()"> <span>Deliver to the sender's address abroad</span></label>
      <label class="chk"><input type="radio" name="delivery" value="PICKUP_OFFICE" onchange="onDeliveryChange()"> <span>The sender will pick up from a branch office abroad</span></label>

      <div id="officeWrap" style="display:none;margin-top:8px">
        <label class="sub">Which branch office abroad? *</label>
        <input id="oBranch" list="dlCountries" placeholder="Country / city of the branch">
        <div class="note-info" style="margin-top:6px">Our team will confirm the exact branch office address and pick-up hours for your area.</div>
      </div>

      <div id="addrWrap" style="margin-top:8px">
        <label>Sender's Complete Address Abroad * <span class="muted">(where we deliver the empty box[es])</span></label>
        <div class="form-grid">
          <div><label class="sub">Country *</label><select id="oCountry" required>
            <option value="">— select country —</option>
            ${ORIGIN_COUNTRIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
          </select></div>
          <div><label class="sub">City / State / Province *</label><input id="oCity" required></div>
          <div><label class="sub">Postal / ZIP Code</label><input id="oZip" placeholder="e.g. 10110"></div>
        </div>
        <label class="sub">Street / Building / Unit / House No. *</label>
        <input id="oStreet" required>
        <label class="sub">Landmark / Delivery notes</label>
        <input id="oLandmark" placeholder="Anything that helps the courier find it">
      </div>
    </div>

    <div class="card">
      <div class="rc-label">4 · SENDER'S CONTACT DETAILS</div>
      <div class="form-grid">
        <div><label>Sender's Full Name *</label><input id="cName" required></div>
        <div><label>Sender's Contact Number Abroad * <span class="muted">(include country code)</span></label><input id="cPhone" placeholder="e.g. +66 62 555 0119" required></div>
        <div><label>Sender's Email <span class="muted">(if any)</span></label><input id="cEmail" type="email"></div>
      </div>
      <label>Notes <span class="muted">(optional)</span></label><input id="cNotes" placeholder="Anything we should know">
      <div style="font-size:12px;margin-top:6px"><b style="color:#d32f2f">All fields with an asterisk (*) are required.</b></div>
      <div id="obError" class="error"></div>
      <button onclick="submitOrder()">Place order</button>
      <div class="muted" style="margin-top:6px">After you order, a VFIC agent will contact you to confirm the price and schedule.</div>
    </div>`;

  onDeliveryChange();
  renderTotal();
}

const val = (id) => { const e = gid(id); return e ? e.value.trim() : ''; };

async function submitOrder() {
  const err = gid('obError'); err.textContent = '';
  try {
    const items = currentItems().map(i => ({ size: i.size, qty: i.qty }));
    if (!items.length) throw new Error('Please choose at least one box size and quantity.');
    if (!val('cName')) throw new Error("Please enter the sender's full name.");
    if (digits(val('cPhone')).length < 7) throw new Error('Please enter a valid contact number.');
    const delivery = (document.querySelector('input[name="delivery"]:checked') || {}).value || 'DELIVER_ADDRESS';
    const body = {
      items, delivery_method: delivery,
      contact_name: val('cName'), contact_phone: val('cPhone'), contact_email: val('cEmail'),
      notes: val('cNotes')
    };
    if (delivery === 'DELIVER_ADDRESS') {
      body.country = val('oCountry');
      body.city = val('oCity');
      body.street_address = val('oStreet');
      body.postal_code = val('oZip');
      body.landmark = val('oLandmark');
      if (!body.country || !body.city || !body.street_address) {
        throw new Error("Please complete the sender's address abroad (country, city and street).");
      }
    } else {
      body.pickup_branch = val('oBranch');
    }
    const res = await fetch('/api/public/box-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    submitted = true; LAST_REF = data.reference_code;
    renderConfirmation();
  } catch (e) {
    err.textContent = e.message; err.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function renderConfirmation() {
  mountToggle();
  gid('app').innerHTML = `
    <div class="card" style="text-align:center">
      <div style="font-size:40px">✅</div>
      <h2>Order received!</h2>
      <p>Your order reference is</p>
      <div style="font-size:26px;font-weight:800;letter-spacing:1px;margin:10px 0">${esc(LAST_REF)}</div>
      <p class="muted">A VFIC agent will contact you shortly to confirm the price, payment and schedule.</p>
      <a href="/"><button class="secondary">Back to home</button></a>
    </div>`;
}

if (window.VI) VI.onChange(() => { if (submitted) renderConfirmation(); else renderForm(); });
mountToggle();
// If the customer is signed in, price from the country on their account unless they've
// already picked one on this device.
(async () => {
  if (!COUNTRY) {
    try {
      const me = await (await fetch('/api/public/sender/me')).json();
      if (me && me.country) COUNTRY = me.country;
    } catch (e) { /* not signed in — they'll pick a country below */ }
  }
  await loadSizes(COUNTRY);
  renderForm();
})();
