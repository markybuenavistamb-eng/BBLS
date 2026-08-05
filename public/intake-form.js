/* VFIC online booking — captures every field of BOC Form BB-IS-001 so the printed
   Information Sheet (p.1) and Packing List (p.2) can be auto-filled.
   Official BOC field labels are kept in English (they are legal form labels);
   surrounding chrome still uses the EN/TL toggle. */

// Box-size catalogue (dimensions + weight allowance) is fetched from the server so the
// booking form, staff app and printed forms all use one source of truth.
let BOX_SIZES = [];
let EXCESS_RATE = null;
let EXCESS_CCY = 'PHP';
let BOC_MAX_CBM = 0.20;
let MAX_BOX_VALUE = 10000; // per-box declared-value ceiling (admin-configurable)
let SERVICE_LEVELS = ['OCEAN_ECONOMY', 'OCEAN_PRIORITY', 'EXPRESS_AIR'];
const SERVICE_LEVEL_LABELS = { OCEAN_ECONOMY: 'Ocean Economy', OCEAN_PRIORITY: 'Ocean Priority', EXPRESS_AIR: 'Express Air' };
let ORIGIN_COUNTRIES = ['Thailand', 'Cambodia', 'Vietnam'];

// Shipping tariff for the sender's country — ocean is per box by size and destination zone,
// air is per kilo by zone. Loaded with the box sizes and refreshed when the country changes.
let RATES_OCEAN = null, RATES_AIR = null, REGION_ZONE = {}, SHIP_CCY = '', BRANCH_CITY = '';

async function loadBoxSizes(country) {
  try {
    const r = await fetch('/api/box-sizes' + (country ? '?country=' + encodeURIComponent(country) : ''));
    const d = await r.json();
    BOX_SIZES = d.sizes || [];
    EXCESS_RATE = d.excess_charge_per_kg;
    EXCESS_CCY = d.excess_charge_currency || 'PHP';
    BOC_MAX_CBM = d.boc_max_cbm || 0.20;
    if (d.max_box_value_php != null) MAX_BOX_VALUE = d.max_box_value_php;
    if (Array.isArray(d.service_levels) && d.service_levels.length) SERVICE_LEVELS = d.service_levels;
    if (Array.isArray(d.origin_countries) && d.origin_countries.length) ORIGIN_COUNTRIES = d.origin_countries;
    RATES_OCEAN = (d.shipping_rates || {}).ocean || null;
    RATES_AIR = (d.shipping_rates || {}).air || null;
    REGION_ZONE = d.region_zone || {};
    SHIP_CCY = d.currency || '';
    BRANCH_CITY = d.branch_city || '';
  } catch (e) { BOX_SIZES = []; }
}

const shipMoney = (v) => `${SHIP_CCY} ${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// PSGC region name → the 17-region code → billing zone.
function regionCodeFromName(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return null;
  if (n.includes('national capital') || /\bncr\b/.test(n)) return 'NCR';
  if (n.includes('cordillera')) return 'CAR';
  if (n.includes('ilocos')) return 'R1';
  if (n.includes('cagayan valley')) return 'R2';
  if (n.includes('central luzon')) return 'R3';
  if (n.includes('calabarzon') || n.includes('iv-a')) return 'R4A';
  if (n.includes('mimaropa') || n.includes('iv-b')) return 'MIMAROPA';
  if (n.includes('bicol')) return 'R5';
  if (n.includes('western visayas')) return 'R6';
  if (n.includes('central visayas')) return 'R7';
  if (n.includes('eastern visayas')) return 'R8';
  if (n.includes('zamboanga')) return 'R9';
  if (n.includes('northern mindanao')) return 'R10';
  if (n.includes('davao')) return 'R11';
  if (n.includes('soccsksargen') || n.includes('cotabato')) return 'R12';
  if (n.includes('caraga')) return 'R13';
  if (n.includes('bangsamoro') || n.includes('barmm')) return 'BARMM';
  return null;
}
const zoneForBox = (n) => REGION_ZONE[regionCodeFromName(val('rRegionName' + n) || '')] || null;

// Quote one box from the tariff: size + destination zone for ocean, weight for air.
function quoteBox(n) {
  const level = val('oLevel') || 'OCEAN_ECONOMY';
  const zone = zoneForBox(n);
  const size = val('bSize' + n) || 'LARGE';
  if (!zone || !RATES_OCEAN) return { amount: null, zone, level };
  if (level === 'EXPRESS_AIR') {
    const perKg = +((RATES_AIR || {}).EXPRESS_AIR || {})[zone] || 0;
    const kg = parseFloat(val('bWeight' + n)) || 0;
    return { amount: +(perKg * kg).toFixed(2), zone, level, basis: `${shipMoney(perKg)}/kg × ${kg} kg` };
  }
  const amount = +(((RATES_OCEAN[level] || {})[zone] || {})[size] || 0);
  return { amount: +amount.toFixed(2), zone, level, basis: `${SERVICE_LEVEL_LABELS[level]} · ${size}` };
}

// Show each box's fee and the shipment total.
function renderQuotes() {
  let total = 0, priced = 0, boxes = 0;
  document.querySelectorAll('.box-block').forEach(el => {
    const n = el.dataset.box;
    boxes += 1;
    const out = gid('fee' + n);
    const q = quoteBox(n);
    if (!out) return;
    if (q.amount == null || !q.amount) {
      out.innerHTML = q.zone
        ? '<span class="muted">No rate set for this destination yet — our agent will confirm the fee.</span>'
        : '<span class="muted">Select the receiver\'s region to see the shipping fee.</span>';
    } else {
      total += q.amount; priced += 1;
      out.innerHTML = `Shipping fee: <b>${esc(shipMoney(q.amount))}</b> <span class="muted">(${esc(q.basis)})</span>`;
    }
  });
  const box = gid('feeTotal');
  if (box) {
    box.innerHTML = priced
      ? `Estimated shipping for ${priced} of ${boxes} box(es): <b>${esc(shipMoney(total))}</b>
         <span class="muted">— excludes any excess-weight charge; confirmed by our agent.</span>`
      : '<span class="muted">Shipping fees appear once you choose your country, service level and each receiver\'s region.</span>';
    box.style.display = '';
  }
}

// Country drives the price book, the branch that serves the sender, and the ID prefix.
async function onOriginCountryChange() {
  const country = val('sCountry');
  await loadBoxSizes(country);
  const agent = gid('oAgent');
  if (agent && BRANCH_CITY && !agent.dataset.touched) agent.value = BRANCH_CITY;
  renderQuotes();
}
const peso = (v) => 'Php ' + Number(v || 0).toLocaleString('en-PH');
const sizeInfo = (key) => BOX_SIZES.find(s => s.key === key) || null;

function sizeOptionsHtml() {
  if (!BOX_SIZES.length) return '<option value="LARGE">LARGE</option>';
  return BOX_SIZES.map(s =>
    `<option value="${s.key}"${s.key === 'LARGE' ? ' selected' : ''}>${esc(s.label)} — ${esc(s.dimensions)} (${s.cbm} cbm), up to ${s.standard_weight_kg} kg</option>`
  ).join('');
}

// Show the selected size's spec, and warn when the declared weight exceeds its allowance
// or when the box is too large to avail of the Balikbayan Box privilege (BOC 0.20 cbm cap).
function onSizeChange(n) {
  const sel = document.getElementById('bSize' + n);
  const hint = document.getElementById('sizeHint' + n);
  const warn = document.getElementById('excess' + n);
  if (!sel || !hint || !warn) return;
  const s = sizeInfo(sel.value);
  if (!s) { hint.textContent = ''; warn.style.display = 'none'; return; }

  hint.textContent = `${s.dimensions} · ${s.cbm} cbm · includes up to ${s.standard_weight_kg} kg`;

  const w = parseFloat((document.getElementById('bWeight' + n) || {}).value) || 0;
  const over = Math.max(0, +(w - s.standard_weight_kg).toFixed(2));
  const msgs = [];
  if (over > 0) {
    msgs.push(`<b>Overweight by ${over} kg.</b> This ${s.label} box includes up to ${s.standard_weight_kg} kg — ` +
      (EXCESS_RATE != null
        ? `an excess charge of ${EXCESS_CCY} ${EXCESS_RATE}/kg applies (≈ ${EXCESS_CCY} ${(over * EXCESS_RATE).toFixed(2)}).`
        : `an additional charge will apply.`));
  }
  if (s.exceeds_boc_cbm) {
    msgs.push(`<b>Customs note:</b> a ${s.label} box is ${s.cbm} cbm, which is over the ${BOC_MAX_CBM} cbm limit ` +
      `for the Balikbayan Box privilege. It can still ship, but it may not qualify for tax/duty-free treatment.`);
  }
  warn.innerHTML = msgs.join('<br>');
  warn.style.display = msgs.length ? '' : 'none';
}

const gid = (id) => document.getElementById(id);

// Warn when a box's declared value exceeds the per-box ceiling.
function onValueChange(n) {
  const inp = gid('bValue' + n), warn = gid('valWarn' + n);
  if (!inp || !warn) return;
  const v = parseFloat(inp.value) || 0;
  if (MAX_BOX_VALUE && v > MAX_BOX_VALUE) {
    warn.innerHTML = `<b>Over the limit.</b> The declared value per box may not exceed ${peso(MAX_BOX_VALUE)}. Please split the contents across boxes.`;
    warn.style.display = '';
  } else { warn.style.display = 'none'; }
}

// Reveal the "please specify" field when the "Others" goods category has a quantity.
function onOthersChange(n) {
  const others = document.querySelector(`.goodsQty[data-box="${n}"][data-cat="Others"]`);
  const wrap = gid('othersWrap' + n);
  if (!others || !wrap) return;
  wrap.style.display = (parseInt(others.value, 10) || 0) > 0 ? '' : 'none';
}

function waitFor(cond, ms = 4000) {
  return new Promise(resolve => {
    const t0 = Date.now();
    (function poll() { (cond() || Date.now() - t0 > ms) ? resolve() : setTimeout(poll, 80); })();
  });
}
// Copy every detail of the first box into box n (same recipient / same contents).
async function copyFromBox1(n) {
  const firstEl = document.querySelector('.box-block');
  if (!firstEl) return;
  const src = firstEl.dataset.box;
  if (String(src) === String(n)) { alert('This is Box 1. Add another box, then use “Same as Box 1” on it.'); return; }
  ['rFam', 'rGiv', 'rMid', 'rSuf', 'rPhone', 'rEmail', 'rStreet', 'rLandmark', 'rZip', 'rRel', 'bSize', 'bWeight', 'bValue', 'bInstr']
    .forEach(k => { const s = gid(k + src), d = gid(k + n); if (s && d) d.value = s.value; });
  document.querySelectorAll(`.goodsQty[data-box="${src}"]`).forEach(s => {
    const idx = s.id.split('_')[1];
    const d = gid(`g${n}_${idx}`);
    if (d) d.value = s.value;
  });
  const os = gid('othersSpec' + src), od = gid('othersSpec' + n); if (os && od) od.value = os.value;
  onSizeChange(n); onValueChange(n); onOthersChange(n);
  await copyAddress(src, n);
}
async function copyAddress(src, n) {
  const rgS = gid('rRegion' + src), rgD = gid('rRegion' + n);
  if (!rgS || !rgD) return;
  if (rgD.tagName === 'INPUT') { // offline free-text fallback
    ['rRegion', 'rCity', 'rBrgy', 'rRegionName', 'rCityName', 'rBrgyName'].forEach(k => { const s = gid(k + src), d = gid(k + n); if (s && d) d.value = s.value; });
    return;
  }
  rgD.value = rgS.value; rgD.dispatchEvent(new Event('change'));
  const cD = gid('rCity' + n);
  await waitFor(() => !cD.disabled && cD.options.length > 1);
  cD.value = gid('rCity' + src).value; cD.dispatchEvent(new Event('change'));
  const bD = gid('rBrgy' + n);
  await waitFor(() => !bD.disabled && bD.options.length > 1);
  bD.value = gid('rBrgy' + src).value; bD.dispatchEvent(new Event('change'));
}

// ---- returning-sender autofill (kept on this device only; never leaves the browser) ----
const PROFILE_KEY = 'vfic_sender_profile';
const PROFILE_FIELDS = ['sBiz', 'sFam', 'sGiv', 'sMid', 'sSuf', 'sPhone', 'sEmail', 'sPassNo', 'sPassPlace', 'sPassIssued', 'sPassExp', 'sAddrAbroad', 'sAddrPh', 'oAgent', 'sCountry'];
function saveSenderProfile() {
  try { const p = {}; PROFILE_FIELDS.forEach(f => p[f] = val(f)); localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) {}
}
function loadSenderProfile() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch (e) { return null; } }
function applySenderProfile(p) {
  PROFILE_FIELDS.forEach(f => { const el = gid(f); if (el && p[f] != null && p[f] !== '') el.value = p[f]; });
  onSenderTypeChange();
}
function onAvailmentChange() {
  const v = (document.querySelector('input[name="availment"]:checked') || {}).value || '';
  const note = gid('availNote');
  if (!note) return;
  if (v !== 'BB_2ND' && v !== 'BB_3RD') { note.style.display = 'none'; note.innerHTML = ''; return; }
  const p = loadSenderProfile();
  if (p) {
    applySenderProfile(p);
    note.innerHTML = '↺ We filled in your sender details from your last booking on this device. Please review and update anything that changed.';
  } else {
    note.innerHTML = 'Returning sender? We couldn’t find saved details on this device — please fill in your information below.';
  }
  note.style.display = '';
}

// Pick-up "same as address abroad" toggle.
function onPickupSameChange() {
  const cb = gid('puSameAbroad'), ta = gid('puAddress');
  if (!cb || !ta) return;
  if (cb.checked) { ta.value = val('sAddrAbroad'); ta.readOnly = true; ta.classList.add('input-locked'); }
  else { ta.readOnly = false; ta.classList.remove('input-locked'); }
}
function syncPickupIfSame() { const cb = gid('puSameAbroad'); if (cb && cb.checked) onPickupSameChange(); }

// Collection: sender either has VFIC pick up the box, or drops it off at the office.
function isPickup() { const cb = gid('oDropoff'); return !(cb && cb.checked); }

const AVAILMENT_TYPES = [
  { key: 'BB_1ST', group: 'Balikbayan Box privilege', label: '1st Time' },
  { key: 'BB_2ND', group: 'Balikbayan Box privilege', label: '2nd Time' },
  { key: 'BB_3RD', group: 'Balikbayan Box privilege', label: '3rd Time' },
  { key: 'DE_MINIMIS', group: null, label: 'De Minimis Value' },
  { key: 'NONE', group: null, label: 'None' }
];
const SENDER_TYPES = [
  { key: 'QFWA_OFW', group: 'QFWA', label: 'OFW' },
  { key: 'QFWA_RESIDENT', group: 'QFWA', label: 'Resident Filipino' },
  { key: 'QFWA_NON_RESIDENT', group: 'QFWA', label: 'Non-Resident Filipino' },
  { key: 'NQFWA_INDIVIDUAL', group: 'NQFWA', label: 'Individual' },
  { key: 'NQFWA_SOLE_PROP', group: 'NQFWA', label: 'Sole Prop. (DTI)' },
  { key: 'NQFWA_PARTNERSHIP', group: 'NQFWA', label: 'Partnership' },
  { key: 'NQFWA_CORPORATION', group: 'NQFWA', label: 'Corporation' }
];
const BUSINESS_TYPES = ['NQFWA_SOLE_PROP', 'NQFWA_PARTNERSHIP', 'NQFWA_CORPORATION'];
const RELATIONSHIPS = ['Spouse', 'Child', 'Parent', 'Sibling', 'Sibling of Parent', '1st Cousin',
  'Niece/Nephew', 'Grandparent', 'Sibling of Grandparent', 'Grand Niece/Nephew',
  'Grandchild', 'Great Grandchild', 'Great Grandparent'];
const GOODS_CATEGORIES = [
  'Bag/Wallet', 'Bakery, Breakfast, Cereal', 'Beverages', 'Books', 'Blanket/comforter',
  'Camera, used gadgets', 'Canned and Packed Foods', 'Candies', 'Children Accessories',
  'Chocolates', 'Cleaners', 'Clothes', 'Coffee/Milk Powder/Liquid', 'Component',
  'Cooking oil', 'Curtain', 'Detergent powder', 'Drink Can/Bottle', 'Fashion Accessories',
  'Furniture', 'Housewares, Decors, Home Furnishing', 'Luggage/Bags',
  'Laundry Materials', 'Miscellaneous Kitchen items', 'Noodles', 'Office/School Supplies',
  'Paper Goods', 'Pasta, noodles', 'Personal care', 'Personal Hygene', 'Plastic wares',
  'Produce(Fruits/Vegetables)', 'Refrigerated foods', 'Shoes', 'Sporting Goods / Hobbies',
  'Telephones / Fax', 'Tools(Mechanic,Automotive, etc.)', 'Towel/Face/Slippers/Sandal',
  'Toys', 'Umbrella', 'Wall Clock / Alarm Clock', 'Others'
];

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const T = (k) => (window.VI ? VI.t(k) : k);
const digits = (v) => String(v || '').replace(/\D/g, '');
const isPhMobile = (v) => /^09\d{9}$/.test(digits(v));

let boxSeq = 0;
let submitted = false;
let LAST_REF = null;

function mountToggle() {
  const el = document.getElementById('langMount');
  if (el && window.VI) el.innerHTML = VI.toggleHtml();
}

/* ---------- one box block ---------- */
function boxBlockHtml() {
  boxSeq += 1;
  const n = boxSeq;
  const half = Math.ceil(GOODS_CATEGORIES.length / 2);
  const goodsCol = (list, offset) => list.map((c, i) => {
    const idx = offset + i;
    return `<div class="goods-row">
      <span>${esc(c)}</span>
      <input type="number" min="0" step="1" class="goodsQty" data-box="${n}" data-cat="${esc(c)}" id="g${n}_${idx}" aria-label="${esc(c)} quantity"${c === 'Others' ? ` oninput="onOthersChange(${n})"` : ''}>
    </div>`;
  }).join('');

  return `
  <div class="card box-block" id="box${n}" data-box="${n}">
    <div class="row" style="justify-content:space-between;align-items:center">
      <b>Box <span class="box-index">${n}</span></b>
      <div class="row" style="gap:6px">
        <button type="button" class="secondary small copy-box1-btn" onclick="copyFromBox1(${n})" style="display:none">⧉ Same as Box 1</button>
        <button type="button" class="secondary small" onclick="removeBox(${n})">Remove</button>
      </div>
    </div>

    <div class="rc-label" style="margin-top:10px">B. PHILIPPINE-BASED RECIPIENT</div>
    <div class="form-grid">
      <div><label>Family Name *</label><input id="rFam${n}" required></div>
      <div><label>Given Name *</label><input id="rGiv${n}" required></div>
      <div><label>Middle Name *</label><input id="rMid${n}" required></div>
      <div><label>Suffix *</label><input id="rSuf${n}" placeholder="Jr., III, or N/A" required></div>
    </div>
    <div class="form-grid">
      <div><label>Contact Number * <span class="muted">(11 digits, e.g. 09171234567)</span></label>
        <input id="rPhone${n}" inputmode="numeric" maxlength="11" placeholder="09XXXXXXXXX" required></div>
      <div><label>Email Address <span class="muted">(if any)</span></label><input id="rEmail${n}" type="email"></div>
    </div>

    <label>Complete Philippine Address *</label>
    <div class="form-grid">
      <div><label class="sub">Region *</label><select id="rRegion${n}" required></select></div>
      <div><label class="sub">City / Municipality *</label><select id="rCity${n}" required disabled></select></div>
      <div><label class="sub">Barangay *</label><select id="rBrgy${n}" required disabled></select></div>
    </div>
    <input type="hidden" id="rRegionName${n}"><input type="hidden" id="rCityName${n}"><input type="hidden" id="rBrgyName${n}">
    <div class="form-grid">
      <div><label class="sub">House No. / Street / Subdivision *</label><input id="rStreet${n}" required></div>
      <div><label class="sub">Landmark *</label><input id="rLandmark${n}" placeholder="Helps the driver find it" required></div>
      <div><label class="sub">ZIP / Postal Code</label><input id="rZip${n}" inputmode="numeric" maxlength="4" placeholder="e.g. 1002"></div>
    </div>

    <label>Relationship to Sender * <span class="muted">(by affinity or consanguinity)</span></label>
    <select id="rRel${n}" required>
      <option value="">— select —</option>
      ${RELATIONSHIPS.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
    </select>

    <div class="form-grid" style="margin-top:10px">
      <div><label>Box Size *</label><select id="bSize${n}" required onchange="onSizeChange(${n});renderQuotes()">
        ${sizeOptionsHtml()}
      </select>
      <div class="muted size-hint" id="sizeHint${n}"></div></div>
      <div><label>Approx. Weight (kg) *</label><input id="bWeight${n}" type="number" min="0" step="0.1" required oninput="onSizeChange(${n});renderQuotes()"></div>
      <div><label>Total Value of Contents (Php) *</label><input id="bValue${n}" type="number" min="0" step="0.01" max="${MAX_BOX_VALUE}" required oninput="onValueChange(${n})">
      <div class="muted size-hint">Maximum ${peso(MAX_BOX_VALUE)} per box.</div>
      <div class="excess-warn" id="valWarn${n}" style="display:none"></div></div>
    </div>
    <div class="excess-warn" id="excess${n}" style="display:none"></div>
    <div class="fee-line" id="fee${n}"></div>
    <label>Special Instructions</label><input id="bInstr${n}">

    <div class="rc-label" style="margin-top:14px">C. ITEMIZED DESCRIPTION OF GOODS *</div>
    <div class="muted" style="font-size:12px;margin-bottom:6px">
      Enter the quantity for each kind of item inside this box. At least one item is required.
    </div>
    <div class="goods-grid">
      <div>${goodsCol(GOODS_CATEGORIES.slice(0, half), 0)}</div>
      <div>${goodsCol(GOODS_CATEGORIES.slice(half), half)}</div>
    </div>
    <div id="othersWrap${n}" style="display:none;margin-top:8px">
      <label class="sub">If “Others”, please specify the item(s) *</label>
      <input id="othersSpec${n}" placeholder="Describe the item(s) under “Others”">
    </div>
  </div>`;
}

function removeBox(n) {
  const el = document.getElementById('box' + n);
  if (!el) return;
  if (document.querySelectorAll('[data-box]').length <= 1) { alert('At least one box is required.'); return; }
  el.remove();
  renumberBoxes();
}
function renumberBoxes() {
  [...document.querySelectorAll('.box-block')].forEach((el, i) => {
    const lbl = el.querySelector('.box-index');
    if (lbl) lbl.textContent = i + 1;
    const btn = el.querySelector('.copy-box1-btn'); // only boxes after the first can copy from Box 1
    if (btn) btn.style.display = i === 0 ? 'none' : '';
  });
}
async function addBox() {
  document.getElementById('boxes').insertAdjacentHTML('beforeend', boxBlockHtml());
  const n = boxSeq;
  renumberBoxes();
  onSizeChange(n);
  if (window.PSGC) {
    await PSGC.mountCascade({
      region: 'rRegion' + n, city: 'rCity' + n, barangay: 'rBrgy' + n,
      regionName: 'rRegionName' + n, cityName: 'rCityName' + n, barangayName: 'rBrgyName' + n
    });
    // The destination region sets the billing zone, so re-quote whenever it changes.
    const rg = gid('rRegion' + n);
    if (rg) rg.addEventListener('change', () => setTimeout(renderQuotes, 0));
  }
  renderQuotes();
}

/* ---------- whole form ---------- */
function renderForm() {
  boxSeq = 0;
  mountToggle();
  if (window.VI) VI.applyStatic(document);

  document.getElementById('app').innerHTML = `
    <div class="card note-warn">
      <b>Important — please use accurate, correct contact details.</b>
      <div class="muted" style="margin-top:4px">
        Incomplete or wrong receiver details are the main cause of failed deliveries.
        Additional charges apply for re-delivery caused by incorrect or unreachable contact details.
      </div>
      <div style="margin-top:6px"><b style="color:#d32f2f">All fields with an asterisk (*) are required.</b></div>
    </div>
    <div id="draftNote" class="note-info" style="display:none;margin-bottom:10px"></div>
    ${SENDER ? `<div class="note-info" style="margin-bottom:10px">Signed in as <b>${esc(SENDER.email)}</b> — you can save this booking as a draft and finish it later. <a href="/account.html">My Account →</a></div>` : ''}

    <div class="card">
      <div class="rc-label">TYPE OF AVAILMENT *</div>
      <div class="muted" style="font-size:12px;margin-bottom:6px">Check one only. You may only avail of the Balikbayan Box Privilege if you are a Qualified Filipino While Abroad.</div>
      <div class="check-grid">
        ${AVAILMENT_TYPES.map(a => `<label class="chk"><input type="radio" name="availment" value="${a.key}" required onchange="onAvailmentChange()">
          <span>${a.group ? `<span class="muted">${esc(a.group)} — </span>` : ''}${esc(a.label)}</span></label>`).join('')}
      </div>
      <div id="availNote" class="note-info" style="display:none;margin-top:8px"></div>

      <div class="rc-label" style="margin-top:14px">TYPE OF SENDER *</div>
      <div class="check-grid">
        ${SENDER_TYPES.map(s => `<label class="chk"><input type="radio" name="senderType" value="${s.key}" required onchange="onSenderTypeChange()">
          <span><span class="muted">${s.group} — </span>${esc(s.label)}</span></label>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="rc-label">A. SENDER INFORMATION</div>
      <div id="bizWrap" style="display:none">
        <label>Business Name * <span class="muted">(Sole Prop., Partnership, Corporation)</span></label>
        <input id="sBiz">
      </div>
      <div class="form-grid">
        <div><label>Family Name *</label><input id="sFam" required></div>
        <div><label>Given Name *</label><input id="sGiv" required></div>
        <div><label>Middle Name *</label><input id="sMid" required></div>
        <div><label>Suffix *</label><input id="sSuf" placeholder="Jr., III, or N/A" required></div>
      </div>
      <div class="form-grid">
        <div><label>Contact Number/s *</label><input id="sPhone" required></div>
        <div><label>Email Address <span class="muted">(if any)</span></label><input id="sEmail" type="email"></div>
      </div>

      <div id="passportWrap" class="pp-block">
        <div class="muted" style="font-size:12px;margin-bottom:6px">Passport details are required for Qualified Filipinos While Abroad (QFWA).</div>
        <div class="form-grid">
          <div><label>Philippine Passport Number *</label><input id="sPassNo"></div>
          <div><label>Place Issued *</label><input id="sPassPlace"></div>
          <div><label>Date Issued *</label><input id="sPassIssued" type="date"></div>
          <div><label>Expiry Date *</label><input id="sPassExp" type="date"></div>
        </div>
      </div>

      <label>Complete Current Address Abroad *</label><textarea id="sAddrAbroad" required oninput="syncPickupIfSame()"></textarea>
      <label>Complete Address in the Philippines *</label><textarea id="sAddrPh" required></textarea>

      <div class="form-grid">
        <div><label>Sending From (branch / city) *</label><input id="oAgent" required oninput="this.dataset.touched=1"></div>
        <div><label>Country *</label><select id="sCountry" required onchange="onOriginCountryChange()">
          <option value="">— select country —</option>
          ${ORIGIN_COUNTRIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
        </select></div>
        <div><label>Service Level *</label><select id="oLevel" required onchange="renderQuotes()">
          ${SERVICE_LEVELS.map(k => `<option value="${k}">${esc(SERVICE_LEVEL_LABELS[k] || k)}</option>`).join('')}
        </select></div>
      </div>

      <div class="rc-label" style="margin-top:12px">COLLECTION *</div>
      <label class="chk" style="margin:2px 0 8px"><input type="checkbox" id="oDropoff" onchange="onCollectionChange()"> <span>I will drop off at the VFIC office (no pick-up needed)</span></label>

      <div id="pickupWrap" class="pickup-block">
        <div class="rc-label">PICK-UP SCHEDULE *</div>
        <div class="muted" style="font-size:12px;margin-bottom:6px">VFIC will collect the box(es) from your address.</div>
        <div class="form-grid">
          <div><label>Preferred Date *</label><input id="puDate" type="date"></div>
          <div><label>Preferred Time *</label><select id="puTime">
            <option value="AM">Morning (8:00 AM – 12:00 NN)</option>
            <option value="PM">Afternoon (1:00 PM – 5:00 PM)</option>
          </select></div>
        </div>
        <label class="chk" style="margin:2px 0 6px"><input type="checkbox" id="puSameAbroad" onchange="onPickupSameChange()"> <span>Same as my address abroad</span></label>
        <label>Pick-up Address *</label>
        <textarea id="puAddress"></textarea>
        <label>Pick-up Instructions</label><input id="puNotes">
      </div>

      <label>Total Value of all Contents for this Shipment (Php) *</label>
      <input id="sTotalValue" type="number" min="0" step="0.01" required>

      <label>Passport / Government ID (photo or scan) *</label>
      <input id="passportFile" type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.pdf,image/jpeg,image/png,image/webp,image/heic,application/pdf" required>
      <div class="note-info" style="margin-top:6px">
        🔒 <b>How your ID is protected.</b> Accepted formats: JPG, PNG, WEBP, HEIC or PDF, up to 6 MB.
        The file is checked on upload and stored in private storage — it is never published to a public link.
        Only authorised VFIC staff can open it, and it is used solely for Bureau of Customs clearance of this shipment.
      </div>
    </div>

    <h2>Your Box(es)</h2>
    <div id="boxes"></div>
    <button type="button" class="secondary" onclick="addBox()">+ Add another box</button>
    <div class="card fee-total" id="feeTotal" style="display:none"></div>

    <div class="card">
      <div class="muted" style="font-size:12px;margin-bottom:8px">
        <b>Declaration.</b> I declare, under the penalties of falsification, that this Information Sheet
        has been made in good faith and to the best of my knowledge and belief is true and correct,
        pursuant to the Customs Modernization and Tariff Act of the Philippines.
      </div>
      <label class="chk"><input type="checkbox" id="declare" required> <span>I agree to the declaration above *</span></label>
      <div id="submitError" class="error"></div>
      <div class="row" style="gap:8px">
        <button onclick="submitIntake()">Submit Booking</button>
        ${SENDER
          ? `<button type="button" class="secondary" onclick="saveDraft()">💾 Save as draft</button>`
          : `<a href="/account.html"><button type="button" class="secondary">Sign in to save a draft</button></a>`}
      </div>
      <div class="muted">${esc(T('intake.after'))}</div>
    </div>`;

  onSenderTypeChange();
  onCollectionChange();
  addBox();
}

function onSenderTypeChange() {
  const v = (document.querySelector('input[name="senderType"]:checked') || {}).value || '';
  const isQFWA = v.startsWith('QFWA_');
  const pp = document.getElementById('passportWrap');
  const biz = document.getElementById('bizWrap');
  if (pp) pp.style.display = isQFWA ? '' : 'none';
  if (biz) biz.style.display = BUSINESS_TYPES.includes(v) ? '' : 'none';
}
function onCollectionChange() {
  const wrap = document.getElementById('pickupWrap');
  if (!wrap) return;
  wrap.style.display = isPickup() ? '' : 'none';
}

/* ---------- collect + validate + submit ---------- */
function val(id) { const e = document.getElementById(id); return e ? e.value.trim() : ''; }

function collectGoods(n) {
  const spec = val('othersSpec' + n);
  return [...document.querySelectorAll(`.goodsQty[data-box="${n}"]`)]
    .map(i => {
      const qty = parseInt(i.value, 10) || 0;
      const g = { category: i.dataset.cat, qty };
      if (i.dataset.cat === 'Others' && qty > 0 && spec) g.specify = spec;
      return g;
    })
    .filter(g => g.qty > 0);
}

async function submitIntake() {
  const err = document.getElementById('submitError');
  err.textContent = '';
  try {
    const senderType = (document.querySelector('input[name="senderType"]:checked') || {}).value || '';
    const availment = (document.querySelector('input[name="availment"]:checked') || {}).value || '';
    if (!availment) throw new Error('Please select a Type of Availment.');
    if (!senderType) throw new Error('Please select a Type of Sender.');
    if (!document.getElementById('declare').checked) throw new Error('Please agree to the declaration.');

    const isQFWA = senderType.startsWith('QFWA_');
    const required = [
      ['sFam', 'Sender Family Name'], ['sGiv', 'Sender Given Name'], ['sMid', 'Sender Middle Name'],
      ['sSuf', 'Sender Suffix'], ['sPhone', 'Sender Contact Number/s'],
      ['sAddrAbroad', 'Complete Current Address Abroad'], ['sAddrPh', 'Complete Address in the Philippines'],
      ['oAgent', 'Sending From'], ['sCountry', 'Country'], ['sTotalValue', 'Total Value for this Shipment']
    ];
    if (isQFWA) required.push(['sPassNo', 'Passport Number'], ['sPassPlace', 'Place Issued'],
      ['sPassIssued', 'Passport Date Issued'], ['sPassExp', 'Passport Expiry Date']);
    if (BUSINESS_TYPES.includes(senderType)) required.push(['sBiz', 'Business Name']);
    for (const [id, label] of required) if (!val(id)) throw new Error(`${label} is required.`);

    const serviceLevel = val('oLevel');
    const collection = isPickup() ? 'PICKUP' : 'DROPOFF';
    const pickup = collection === 'PICKUP'
      ? { date: val('puDate'), time_window: val('puTime'), address: val('puAddress') || val('sAddrAbroad'), notes: val('puNotes') }
      : null;
    if (pickup && (!pickup.date || !pickup.time_window)) throw new Error('Pick-up date and time are required, or tick “I will drop off at the VFIC office”.');

    const passportInput = document.getElementById('passportFile');
    if (!passportInput.files.length) throw new Error('Please attach a photo or scan of your passport/government ID.');

    const boxEls = [...document.querySelectorAll('[data-box]')].filter(e => e.classList.contains('box-block'));
    if (!boxEls.length) throw new Error('Please add at least one box.');

    const boxes = boxEls.map((el, idx) => {
      const n = el.dataset.box;
      const num = idx + 1;
      const need = (id, label) => { const v = val(id + n); if (!v) throw new Error(`Box ${num}: ${label} is required.`); return v; };
      const phone = digits(val('rPhone' + n));
      if (!isPhMobile(phone)) throw new Error(`Box ${num}: receiver contact number must be 11 digits starting with 09 (e.g. 09171234567).`);
      const goods = collectGoods(n);
      if (!goods.length) throw new Error(`Box ${num}: please enter a quantity for at least one item.`);
      if (goods.some(g => g.category === 'Others') && !val('othersSpec' + n)) {
        throw new Error(`Box ${num}: please specify the item(s) under “Others”.`);
      }
      const boxValue = parseFloat(need('bValue', 'Total Value of Contents')) || 0;
      if (MAX_BOX_VALUE && boxValue > MAX_BOX_VALUE) {
        throw new Error(`Box ${num}: the declared value (${peso(boxValue)}) exceeds the ${peso(MAX_BOX_VALUE)} limit per box.`);
      }
      return {
        receiver: {
          family_name: need('rFam', 'Receiver Family Name'),
          given_name: need('rGiv', 'Receiver Given Name'),
          middle_name: need('rMid', 'Receiver Middle Name'),
          suffix: need('rSuf', 'Receiver Suffix'),
          contact_number: phone,
          email: val('rEmail' + n),
          region: val('rRegionName' + n) || val('rRegion' + n),
          city_municipality: val('rCityName' + n) || val('rCity' + n),
          barangay: val('rBrgyName' + n) || val('rBrgy' + n),
          street_address: need('rStreet', 'House No. / Street'),
          landmark: need('rLandmark', 'Landmark'),
          postal_code: val('rZip' + n),
          relationship: need('rRel', 'Relationship to Sender')
        },
        size_category: val('bSize' + n),
        weight_kg: need('bWeight', 'Weight'),
        total_value_php: need('bValue', 'Total Value of Contents'),
        special_instructions: val('bInstr' + n),
        goods
      };
    });
    for (let i = 0; i < boxes.length; i++) {
      const r = boxes[i].receiver;
      if (!r.region || !r.city_municipality || !r.barangay) {
        throw new Error(`Box ${i + 1}: please complete Region, City/Municipality and Barangay.`);
      }
    }

    const fd = new FormData();
    fd.append('availment_type', availment);
    fd.append('sender_type', senderType);
    fd.append('business_name', val('sBiz'));
    fd.append('sender_family_name', val('sFam'));
    fd.append('sender_given_name', val('sGiv'));
    fd.append('sender_middle_name', val('sMid'));
    fd.append('sender_suffix', val('sSuf'));
    fd.append('sender_contact_numbers', val('sPhone'));
    fd.append('sender_email', val('sEmail'));
    fd.append('passport_number', val('sPassNo'));
    fd.append('passport_place_issued', val('sPassPlace'));
    fd.append('passport_date_issued', val('sPassIssued'));
    fd.append('passport_expiry', val('sPassExp'));
    fd.append('address_abroad', val('sAddrAbroad'));
    fd.append('address_ph', val('sAddrPh'));
    fd.append('origin_agent', val('oAgent'));
    fd.append('origin_country', val('sCountry'));
    fd.append('service_level', serviceLevel);
    fd.append('collection', collection);
    fd.append('total_value_php', val('sTotalValue'));
    fd.append('pickup', JSON.stringify(pickup));
    fd.append('boxes', JSON.stringify(boxes));
    fd.append('passport_file', passportInput.files[0]);

    const res = await fetch('/api/public/intake-requests', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    submitted = true;
    saveSenderProfile(); // so a returning sender can autofill next time (this device only)
    renderConfirmation(data.reference_code);
  } catch (e) {
    err.textContent = e.message;
    err.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function renderConfirmation(refCode) {
  if (refCode) LAST_REF = refCode;
  mountToggle();
  if (window.VI) VI.applyStatic(document);
  document.getElementById('app').innerHTML = `
    <div class="card" style="text-align:center">
      <div style="font-size:40px">✅</div>
      <h2>${esc(T('intake.doneTitle'))}</h2>
      <p>${esc(T('intake.doneRef'))}</p>
      <div style="font-size:26px;font-weight:800;letter-spacing:1px;margin:10px 0">${esc(LAST_REF)}</div>
      <p class="muted">${esc(T('intake.doneNote'))}</p>
      <button onclick="window.print()">🖨 ${esc(T('intake.donePrint'))}</button>
    </div>`;
}

/* ---------- saved drafts (signed-in senders) ---------- */
// A draft is a snapshot of every filled-in field plus the number of box blocks, so a sender
// can stop half-way and pick the booking up later. The ID upload is never part of a draft.
let SENDER = null;
let CURRENT_DRAFT_ID = null;

async function loadSender() {
  try { SENDER = await (await fetch('/api/public/sender/me')).json(); if (SENDER && SENDER.error) SENDER = null; }
  catch (e) { SENDER = null; }
}
function draftSnapshot() {
  const fields = {};
  document.querySelectorAll('#app input, #app select, #app textarea').forEach(el => {
    if (!el.id || el.type === 'file') return;
    fields[el.id] = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
  });
  const radios = {};
  document.querySelectorAll('#app input[type=radio]:checked').forEach(el => { radios[el.name] = el.value; });
  return { fields, radios, box_count: document.querySelectorAll('.box-block').length };
}
async function saveDraft() {
  if (!SENDER) { location.href = '/account.html'; return; }
  const label = prompt('Name this draft:', val('sFam') ? `Booking for ${val('sFam')}` : 'Untitled draft');
  if (label === null) return;
  try {
    const d = await (await fetch('/api/public/sender/drafts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: CURRENT_DRAFT_ID, label: label || 'Untitled draft', payload: draftSnapshot() })
    })).json();
    if (d.error) throw new Error(d.error);
    CURRENT_DRAFT_ID = d.id;
    alert('Draft saved. You can finish it later from My Account.');
  } catch (e) { alert(e.message); }
}
async function restoreDraft(id) {
  try {
    const drafts = await (await fetch('/api/public/sender/drafts')).json();
    const d = Array.isArray(drafts) ? drafts.find(x => x.id === +id) : null;
    if (!d || !d.payload) return;
    CURRENT_DRAFT_ID = d.id;
    const { fields = {}, radios = {}, box_count = 1 } = d.payload;
    for (const name in radios) {
      const el = document.querySelector(`#app input[name="${name}"][value="${radios[name]}"]`);
      if (el) { el.checked = true; el.dispatchEvent(new Event('change')); }
    }
    while (document.querySelectorAll('.box-block').length < Math.min(box_count, 20)) await addBox();
    for (const id2 in fields) {
      const el = gid(id2);
      if (!el || el.type === 'file') continue;
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!fields[id2];
      else el.value = fields[id2];
    }
    onSenderTypeChange(); onCollectionChange();
    document.querySelectorAll('.box-block').forEach(el => {
      const n = el.dataset.box;
      onSizeChange(n); onValueChange(n); onOthersChange(n);
    });
    const note = gid('draftNote');
    if (note) { note.textContent = `Resumed your saved draft “${d.label}”. Re-attach your ID before submitting.`; note.style.display = ''; }
  } catch (e) { /* ignore — start a blank form */ }
}

if (window.VI) VI.onChange(() => { if (submitted) renderConfirmation(); else renderForm(); });
mountToggle();
(async () => {
  await Promise.all([loadBoxSizes(), loadSender()]);
  // A signed-in sender is priced from their own country's branch straight away.
  const signedInCountry = SENDER && SENDER.country;
  if (signedInCountry) await loadBoxSizes(signedInCountry);
  renderForm();
  if (signedInCountry) {
    const c = gid('sCountry');
    if (c) { c.value = signedInCountry; await onOriginCountryChange(); }
  }
  const draftId = new URLSearchParams(location.search).get('draft');
  if (draftId && SENDER) await restoreDraft(draftId);
  renderQuotes();
})();
