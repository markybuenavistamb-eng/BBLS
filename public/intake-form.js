/* VFIC online booking — captures every field of BOC Form BB-IS-001 so the printed
   Information Sheet (p.1) and Packing List (p.2) can be auto-filled.
   Official BOC field labels are kept in English (they are legal form labels);
   surrounding chrome still uses the EN/TL toggle. */

const SIZES = ['SMALL', 'MEDIUM', 'LARGE', 'XL', 'JUMBO'];
const SERVICE_KEYS = ['DOOR_TO_DOOR', 'PORT_TO_PORT', 'DOOR_TO_PORT', 'DOOR_TO_AIRPORT'];
// Service types that involve VFIC collecting the box from the sender → need a pick-up slot.
const PICKUP_SERVICES = ['DOOR_TO_DOOR', 'DOOR_TO_PORT', 'DOOR_TO_AIRPORT'];

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
      <input type="number" min="0" step="1" class="goodsQty" data-box="${n}" data-cat="${esc(c)}" id="g${n}_${idx}" aria-label="${esc(c)} quantity">
    </div>`;
  }).join('');

  return `
  <div class="card box-block" id="box${n}" data-box="${n}">
    <div class="row" style="justify-content:space-between;align-items:center">
      <b>Box <span class="box-index">${n}</span></b>
      <button type="button" class="secondary small" onclick="removeBox(${n})">Remove</button>
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
    </div>

    <label>Relationship to Sender * <span class="muted">(by affinity or consanguinity)</span></label>
    <select id="rRel${n}" required>
      <option value="">— select —</option>
      ${RELATIONSHIPS.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
    </select>

    <div class="form-grid" style="margin-top:10px">
      <div><label>Box Size *</label><select id="bSize${n}" required>
        ${SIZES.map(s => `<option value="${s}"${s === 'LARGE' ? ' selected' : ''}>${s}</option>`).join('')}
      </select></div>
      <div><label>Approx. Weight (kg) *</label><input id="bWeight${n}" type="number" min="0" step="0.1" required></div>
      <div><label>Total Value of Contents (Php) *</label><input id="bValue${n}" type="number" min="0" step="0.01" required></div>
    </div>
    <label>Special Instructions</label><input id="bInstr${n}">

    <div class="rc-label" style="margin-top:14px">C. ITEMIZED DESCRIPTION OF GOODS *</div>
    <div class="muted" style="font-size:12px;margin-bottom:6px">
      Enter the quantity for each kind of item inside this box. At least one item is required.
    </div>
    <div class="goods-grid">
      <div>${goodsCol(GOODS_CATEGORIES.slice(0, half), 0)}</div>
      <div>${goodsCol(GOODS_CATEGORIES.slice(half), half)}</div>
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
  });
}
async function addBox() {
  document.getElementById('boxes').insertAdjacentHTML('beforeend', boxBlockHtml());
  const n = boxSeq;
  renumberBoxes();
  if (window.PSGC) {
    await PSGC.mountCascade({
      region: 'rRegion' + n, city: 'rCity' + n, barangay: 'rBrgy' + n,
      regionName: 'rRegionName' + n, cityName: 'rCityName' + n, barangayName: 'rBrgyName' + n
    });
  }
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
    </div>

    <div class="card">
      <div class="rc-label">TYPE OF AVAILMENT *</div>
      <div class="muted" style="font-size:12px;margin-bottom:6px">Check one only. You may only avail of the Balikbayan Box Privilege if you are a Qualified Filipino While Abroad.</div>
      <div class="check-grid">
        ${AVAILMENT_TYPES.map(a => `<label class="chk"><input type="radio" name="availment" value="${a.key}" required>
          <span>${a.group ? `<span class="muted">${esc(a.group)} — </span>` : ''}${esc(a.label)}</span></label>`).join('')}
      </div>

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

      <label>Complete Current Address Abroad *</label><textarea id="sAddrAbroad" required></textarea>
      <label>Complete Address in the Philippines *</label><textarea id="sAddrPh" required></textarea>

      <div class="form-grid">
        <div><label>Sending From (branch / city) *</label><input id="oAgent" required></div>
        <div><label>Country *</label><input id="sCountry" required></div>
        <div><label>Service Type *</label><select id="oService" required onchange="onServiceChange()">
          ${SERVICE_KEYS.map(k => `<option value="${k}">${window.VI ? esc(VI.t('service.' + k)) : k}</option>`).join('')}
        </select></div>
      </div>

      <div id="pickupWrap" class="pickup-block">
        <div class="rc-label">PICK-UP SCHEDULE *</div>
        <div class="muted" style="font-size:12px;margin-bottom:6px">This service includes collection from your address.</div>
        <div class="form-grid">
          <div><label>Preferred Date *</label><input id="puDate" type="date"></div>
          <div><label>Preferred Time *</label><select id="puTime">
            <option value="AM">Morning (8:00 AM – 12:00 NN)</option>
            <option value="PM">Afternoon (1:00 PM – 5:00 PM)</option>
          </select></div>
        </div>
        <label>Pick-up Address * <span class="muted">(leave as-is to use your address abroad)</span></label>
        <textarea id="puAddress"></textarea>
        <label>Pick-up Instructions</label><input id="puNotes">
      </div>

      <label>Total Value of all Contents for this Shipment (Php) *</label>
      <input id="sTotalValue" type="number" min="0" step="0.01" required>

      <label>Passport / Government ID (photo or scan) *</label>
      <input id="passportFile" type="file" accept="image/*,application/pdf" required>
      <div class="muted">Required — VFIC keeps a soft copy of your ID on file for this shipment.</div>
    </div>

    <h2>Your Box(es)</h2>
    <div id="boxes"></div>
    <button type="button" class="secondary" onclick="addBox()">+ Add another box</button>

    <div class="card">
      <div class="muted" style="font-size:12px;margin-bottom:8px">
        <b>Declaration.</b> I declare, under the penalties of falsification, that this Information Sheet
        has been made in good faith and to the best of my knowledge and belief is true and correct,
        pursuant to the Customs Modernization and Tariff Act of the Philippines.
      </div>
      <label class="chk"><input type="checkbox" id="declare" required> <span>I agree to the declaration above *</span></label>
      <div id="submitError" class="error"></div>
      <button onclick="submitIntake()">Submit Booking</button>
      <div class="muted">${esc(T('intake.after'))}</div>
    </div>`;

  onSenderTypeChange();
  onServiceChange();
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
function onServiceChange() {
  const sel = document.getElementById('oService');
  const wrap = document.getElementById('pickupWrap');
  if (!sel || !wrap) return;
  wrap.style.display = PICKUP_SERVICES.includes(sel.value) ? '' : 'none';
}

/* ---------- collect + validate + submit ---------- */
function val(id) { const e = document.getElementById(id); return e ? e.value.trim() : ''; }

function collectGoods(n) {
  return [...document.querySelectorAll(`.goodsQty[data-box="${n}"]`)]
    .map(i => ({ category: i.dataset.cat, qty: parseInt(i.value, 10) || 0 }))
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

    const service = val('oService');
    const pickup = PICKUP_SERVICES.includes(service)
      ? { date: val('puDate'), time_window: val('puTime'), address: val('puAddress') || val('sAddrAbroad'), notes: val('puNotes') }
      : null;
    if (pickup && (!pickup.date || !pickup.time_window)) throw new Error('Pick-up date and time are required for this service type.');

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
    fd.append('service_type', service);
    fd.append('total_value_php', val('sTotalValue'));
    fd.append('pickup', JSON.stringify(pickup));
    fd.append('boxes', JSON.stringify(boxes));
    fd.append('passport_file', passportInput.files[0]);

    const res = await fetch('/api/public/intake-requests', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    submitted = true;
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

if (window.VI) VI.onChange(() => { if (submitted) renderConfirmation(); else renderForm(); });
mountToggle();
renderForm();
