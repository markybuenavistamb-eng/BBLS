/* VFIC "Order a Box" — a customer with no box yet buys empty balikbayan box(es) from VFIC.
   They pick size(s) + quantity, then choose home delivery or office pick-up. */

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const gid = (id) => document.getElementById(id);
const digits = (v) => String(v || '').replace(/\D/g, '');
const isPhMobile = (v) => /^09\d{9}$/.test(digits(v));

const OFFICE_ADDRESS = 'Rm. 205 Sitio Grande Bldg., 409 A. Soriano Ave., Intramuros, Manila 1002, Philippines';
let SIZES = [];
let submitted = false, LAST_REF = null;

async function loadSizes() {
  try { const d = await (await fetch('/api/box-sizes')).json(); SIZES = d.sizes || []; }
  catch (e) { SIZES = []; }
}

function mountToggle() { const el = gid('langMount'); if (el && window.VI) el.innerHTML = VI.toggleHtml(); }

// A little isometric cardboard box, scaled to the real dimensions so sizes look different.
function boxSvg(s) {
  const k = 2.2; // in → px
  const w = s.width_in * k, h = s.height_in * k, dp = s.length_in * k;
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
      <div class="ob-spec muted">${s.cubic_feet} cu ft · up to <b>${s.standard_weight_kg} kg</b></div>
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
  const total = items.reduce((n, i) => n + i.qty, 0);
  const el = gid('obTotal');
  if (el) el.textContent = total ? `${total} box(es) selected: ${items.map(i => `${i.qty}× ${i.label}`).join(', ')}` : 'No boxes selected yet.';
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
      <div class="rc-label">1 · CHOOSE YOUR BOX SIZE(S)</div>
      <div class="muted" style="font-size:12px;margin-bottom:8px">Dimensions are outside measurements; the weight shown is the standard included allowance.</div>
      <div class="ob-grid">${SIZES.map(sizeCardHtml).join('')}</div>
      <div class="ob-total" id="obTotal">No boxes selected yet.</div>
    </div>

    <div class="card">
      <div class="rc-label">2 · HOW WOULD YOU LIKE TO GET THEM?</div>
      <label class="chk"><input type="radio" name="delivery" value="DELIVER_ADDRESS" checked onchange="onDeliveryChange()"> <span>Deliver to my address</span></label>
      <label class="chk"><input type="radio" name="delivery" value="PICKUP_OFFICE" onchange="onDeliveryChange()"> <span>I will pick up from the VFIC office</span></label>

      <div id="officeWrap" style="display:none;margin-top:8px" class="note-info">
        Pick up at: <b>${esc(OFFICE_ADDRESS)}</b><br>Office hours: Mon–Fri, 8:30 AM – 5:30 PM.
      </div>

      <div id="addrWrap" style="margin-top:8px">
        <label>Complete Delivery Address *</label>
        <div class="form-grid">
          <div><label class="sub">Region *</label><select id="oRegion" required></select></div>
          <div><label class="sub">City / Municipality *</label><select id="oCity" required disabled></select></div>
          <div><label class="sub">Barangay *</label><select id="oBrgy" required disabled></select></div>
        </div>
        <input type="hidden" id="oRegionName"><input type="hidden" id="oCityName"><input type="hidden" id="oBrgyName">
        <div class="form-grid">
          <div><label class="sub">House No. / Street / Subdivision *</label><input id="oStreet"></div>
          <div><label class="sub">Landmark</label><input id="oLandmark" placeholder="Helps the driver find it"></div>
          <div><label class="sub">ZIP / Postal Code</label><input id="oZip" inputmode="numeric" maxlength="4" placeholder="e.g. 1002"></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="rc-label">3 · YOUR CONTACT DETAILS</div>
      <div class="form-grid">
        <div><label>Full Name *</label><input id="cName" required></div>
        <div><label>Contact Number * <span class="muted">(11 digits, 09XXXXXXXXX)</span></label><input id="cPhone" inputmode="numeric" maxlength="11" placeholder="09XXXXXXXXX" required></div>
        <div><label>Email <span class="muted">(if any)</span></label><input id="cEmail" type="email"></div>
      </div>
      <label>Notes <span class="muted">(optional)</span></label><input id="cNotes" placeholder="Anything we should know">
      <div class="muted" style="font-size:12px;margin-top:6px"><b>All fields with an asterisk (*) are required.</b></div>
      <div id="obError" class="error"></div>
      <button onclick="submitOrder()">Place order</button>
      <div class="muted" style="margin-top:6px">After you order, a VFIC agent will contact you to confirm the price and schedule.</div>
    </div>`;

  onDeliveryChange();
  renderTotal();
  if (window.PSGC) {
    PSGC.mountCascade({ region: 'oRegion', city: 'oCity', barangay: 'oBrgy', regionName: 'oRegionName', cityName: 'oCityName', barangayName: 'oBrgyName' });
  }
}

const val = (id) => { const e = gid(id); return e ? e.value.trim() : ''; };

async function submitOrder() {
  const err = gid('obError'); err.textContent = '';
  try {
    const items = currentItems().map(i => ({ size: i.size, qty: i.qty }));
    if (!items.length) throw new Error('Please choose at least one box size and quantity.');
    if (!val('cName')) throw new Error('Please enter your full name.');
    if (!isPhMobile(val('cPhone'))) throw new Error('Contact number must be 11 digits starting with 09 (e.g. 09171234567).');
    const delivery = (document.querySelector('input[name="delivery"]:checked') || {}).value || 'DELIVER_ADDRESS';
    const body = {
      items, delivery_method: delivery,
      contact_name: val('cName'), contact_phone: digits(val('cPhone')), contact_email: val('cEmail'),
      notes: val('cNotes')
    };
    if (delivery === 'DELIVER_ADDRESS') {
      body.region = val('oRegionName') || val('oRegion');
      body.city_municipality = val('oCityName') || val('oCity');
      body.barangay = val('oBrgyName') || val('oBrgy');
      body.street_address = val('oStreet');
      body.postal_code = val('oZip');
      body.landmark = val('oLandmark');
      if (!body.region || !body.city_municipality || !body.barangay || !body.street_address) {
        throw new Error('Please complete your delivery address (region, city, barangay and street).');
      }
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
loadSizes().then(renderForm);
