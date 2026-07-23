/* VFIC public online intake form — sender fills this up instead of the paper form */
const REGIONS = ['NCR', 'NORTH_LUZON', 'SOUTH_LUZON', 'CALABARZON', 'MIMAROPA', 'VISAYAS', 'MINDANAO'];
const REGION_LABELS = { NCR: 'NCR / Metro Manila', NORTH_LUZON: 'North Luzon', SOUTH_LUZON: 'South Luzon', CALABARZON: 'CALABARZON', MIMAROPA: 'MIMAROPA', VISAYAS: 'Visayas', MINDANAO: 'Mindanao' };
const SIZES = ['SMALL', 'MEDIUM', 'LARGE', 'JUMBO', 'CUSTOM'];
const SERVICE_KEYS = ['DOOR_TO_DOOR', 'PORT_TO_PORT', 'DOOR_TO_PORT', 'DOOR_TO_AIRPORT'];

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const T = (k) => VI.t(k);

let boxSeq = 0;
let submitted = false;

function mountToggle() {
  const el = document.getElementById('langMount');
  if (el) el.innerHTML = VI.toggleHtml();
}

function itemRowHtml() {
  return `
    <div class="row itemRow" style="flex-wrap:nowrap;gap:6px">
      <input placeholder="${esc(T('intake.itemDesc'))}" class="itemDesc">
      <input placeholder="${esc(T('intake.qty'))}" class="itemQty" style="max-width:90px">
      <button type="button" class="secondary small" onclick="this.parentElement.remove()">✕</button>
    </div>`;
}
function boxBlockHtml() {
  boxSeq += 1;
  const n = boxSeq;
  return `
    <div class="card" id="box${n}" data-box="${n}">
      <div class="row" style="justify-content:space-between">
        <b>${esc(T('intake.box'))}</b>
        <button type="button" class="secondary small" onclick="document.getElementById('box${n}').remove()">${esc(T('common.remove'))}</button>
      </div>
      <div class="form-grid">
        <div><label>${esc(T('intake.rName'))} *</label><input id="rName${n}"></div>
        <div><label>${esc(T('intake.rPhone'))} *</label><input id="rPhone${n}" placeholder="+63 9xx xxx xxxx"></div>
        <div><label>${esc(T('intake.rAlt'))}</label><input id="rAlt${n}"></div>
        <div><label>${esc(T('intake.region'))}</label><select id="rRegion${n}"><option value="">—</option>${REGIONS.map(r => `<option value="${r}">${REGION_LABELS[r]}</option>`).join('')}</select></div>
      </div>
      <label>${esc(T('intake.rAddress'))} *</label><input id="rAddr${n}">
      <div class="form-grid">
        <div><label>${esc(T('intake.rCity'))} *</label><input id="rCity${n}"></div>
        <div><label>${esc(T('intake.province'))}</label><input id="rProv${n}"></div>
      </div>
      <label>${esc(T('intake.landmark'))}</label><input id="rLandmark${n}">
      <div class="form-grid">
        <div><label>${esc(T('intake.size'))}</label><select id="bSize${n}">${SIZES.map(s => `<option ${s === 'LARGE' ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div><label>${esc(T('intake.weight'))}</label><input id="bWeight${n}" type="number" min="0" step="0.1"></div>
      </div>
      <label>${esc(T('intake.contents'))}</label><textarea id="bContents${n}" placeholder="Clothes, canned goods, chocolates…"></textarea>
      <label>${esc(T('intake.instructions'))}</label><input id="bInstr${n}">
      <label>${esc(T('intake.packing'))}</label>
      <div id="items${n}">${itemRowHtml()}</div>
      <button type="button" class="secondary small" onclick="document.getElementById('items${n}').insertAdjacentHTML('beforeend', itemRowHtml())">+ ${esc(T('intake.addItem'))}</button>
    </div>`;
}

function renderForm() {
  boxSeq = 0;
  mountToggle();
  VI.applyStatic(document);
  document.getElementById('app').innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">${esc(T('intake.senderSec'))}</h2>
      <div class="form-grid">
        <div><label>${esc(T('intake.fullName'))} *</label><input id="sName"></div>
        <div><label>${esc(T('intake.phone'))} *</label><input id="sPhone"></div>
        <div><label>${esc(T('intake.altPhone'))}</label><input id="sAlt"></div>
        <div><label>${esc(T('intake.email'))}</label><input id="sEmail" type="email"></div>
      </div>
      <label>${esc(T('intake.address'))}</label><input id="sAddr">
      <div class="form-grid">
        <div><label>${esc(T('intake.city'))}</label><input id="sCity"></div>
        <div><label>${esc(T('intake.province'))}</label><input id="sProv"></div>
        <div><label>${esc(T('intake.country'))}</label><input id="sCountry"></div>
      </div>
      <div class="form-grid">
        <div><label>${esc(T('intake.sendingFrom'))}</label><input id="oAgent"></div>
        <div><label>${esc(T('intake.serviceType'))}</label><select id="oService">${SERVICE_KEYS.map(k => `<option value="${k}">${esc(VI.t('service.' + k))}</option>`).join('')}</select></div>
      </div>
      <label>${esc(T('intake.passport'))} *</label>
      <input id="passportFile" type="file" accept="image/*,application/pdf">
      <div class="muted">${esc(T('intake.passportNote'))}</div>
    </div>
    <h2>${esc(T('intake.boxesSec'))}</h2>
    <div id="boxes">${boxBlockHtml()}</div>
    <button type="button" class="secondary" onclick="document.getElementById('boxes').insertAdjacentHTML('beforeend', boxBlockHtml())">+ ${esc(T('intake.addBox'))}</button>
    <div class="card">
      <div id="submitError" class="error"></div>
      <button onclick="submitIntake()">${esc(T('intake.submit'))}</button>
      <div class="muted">${esc(T('intake.after'))}</div>
    </div>`;
}

function collectItems(containerId) {
  return [...document.querySelectorAll(`#${containerId} .itemRow`)]
    .map(row => ({ description: row.querySelector('.itemDesc').value.trim(), qty: row.querySelector('.itemQty').value.trim() }))
    .filter(it => it.description);
}

async function submitIntake() {
  const errEl = document.getElementById('submitError');
  errEl.textContent = '';
  try {
    const $ = id => document.getElementById(id).value.trim();
    if (!$('sName') || !$('sPhone')) throw new Error(T('intake.errSender'));
    const passportInput = document.getElementById('passportFile');
    if (!passportInput.files.length) throw new Error(T('intake.errPassport'));

    const boxEls = [...document.querySelectorAll('[data-box]')];
    if (!boxEls.length) throw new Error(T('intake.errAddBox'));
    const boxes = boxEls.map(el => {
      const n = el.dataset.box;
      const b = id => document.getElementById(id + n).value.trim();
      return {
        receiver_full_name: b('rName'), receiver_phone_primary: b('rPhone'), receiver_phone_alternate: b('rAlt'),
        receiver_address_line: b('rAddr'), receiver_city_municipality: b('rCity'), receiver_province: b('rProv'),
        receiver_region: document.getElementById('rRegion' + n).value, receiver_landmark: b('rLandmark'),
        size_category: document.getElementById('bSize' + n).value, weight_kg: b('bWeight'),
        declared_contents: b('bContents'), special_instructions: b('bInstr'),
        packing_list_items: collectItems('items' + n)
      };
    });
    for (const bx of boxes) {
      if (!bx.receiver_full_name || !bx.receiver_phone_primary || !bx.receiver_address_line || !bx.receiver_city_municipality) {
        throw new Error(T('intake.errBox'));
      }
    }

    const fd = new FormData();
    fd.append('sender_full_name', $('sName'));
    fd.append('sender_phone_primary', $('sPhone'));
    fd.append('sender_phone_alternate', $('sAlt'));
    fd.append('sender_email', $('sEmail'));
    fd.append('sender_address_line', $('sAddr'));
    fd.append('sender_city', $('sCity'));
    fd.append('sender_province', $('sProv'));
    fd.append('sender_country', $('sCountry'));
    fd.append('origin_agent', $('oAgent'));
    fd.append('origin_country', $('sCountry'));
    fd.append('service_type', document.getElementById('oService').value);
    fd.append('boxes', JSON.stringify(boxes));
    fd.append('passport_file', passportInput.files[0]);

    const res = await fetch('/api/public/intake-requests', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    submitted = true;
    renderConfirmation(data.reference_code);
  } catch (e) {
    errEl.textContent = e.message;
  }
}

let LAST_REF = null;
function renderConfirmation(refCode) {
  if (refCode) LAST_REF = refCode;
  mountToggle();
  VI.applyStatic(document);
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

VI.onChange(() => { if (submitted) renderConfirmation(); else renderForm(); });
mountToggle();
renderForm();
