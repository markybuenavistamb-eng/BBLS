/* Printed BOC Form BB-IS-001 — Information Sheet (page 1) and Packing List (page 2).
   Layout follows the official form; content auto-fills from the online booking
   (shipment.boc / box.boc) and falls back to the encoded customer records. */

const BOC_AVAILMENT = [
  { key: 'BB_1ST', group: 'Balikbayan Box privilege', label: '1st Time' },
  { key: 'BB_2ND', group: 'Balikbayan Box privilege', label: '2nd Time' },
  { key: 'BB_3RD', group: 'Balikbayan Box privilege', label: '3rd Time' },
  { key: 'DE_MINIMIS', group: null, label: 'De Minimis Value' },
  { key: 'NONE', group: null, label: 'None' }
];
const BOC_SENDER_QFWA = [
  { key: 'QFWA_OFW', label: 'OFW' },
  { key: 'QFWA_RESIDENT', label: 'Resident Filipino' },
  { key: 'QFWA_NON_RESIDENT', label: 'Non-Resident Filipino' }
];
const BOC_SENDER_NQFWA = [
  { key: 'NQFWA_INDIVIDUAL', label: 'Individual' },
  { key: 'NQFWA_SOLE_PROP', label: 'Sole Prop. (DTI)' },
  { key: 'NQFWA_PARTNERSHIP', label: 'Partnership' },
  { key: 'NQFWA_CORPORATION', label: 'Corporation' }
];
const BOC_RELATIONSHIPS = ['Spouse', 'Child', 'Parent', 'Sibling', 'Sibling of Parent', '1st Cousin',
  'Niece/Nephew', 'Grandparent', 'Sibling of Grandparent', 'Grand Niece/Nephew',
  'Grandchild', 'Great Grandchild', 'Great Grandparent'];
const BOC_GOODS = [
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

// ✓ / ☐ box, matching the printed form's checkbox style
const tick = (on) => `<span class="boc-tick">${on ? '&#10003;' : '&nbsp;'}</span>`;
const line = (v) => `<span class="boc-fill">${v ? esc(v) : '&nbsp;'}</span>`;

function bocHeader(s, box, boxNo, boxTotal, pageLabel) {
  return `
  <div class="boc-hdr">
    <div class="boc-hdr-left">
      <img src="/vfic-logo.png" alt="Victors Freight International Corporation — Chosen to Deliver" class="boc-hdr-logo">
    </div>
    <div class="boc-hdr-right">
      <div class="boc-title">${esc(pageLabel)}</div>
      <div class="boc-sub">for Consolidated Shipments of "Balikbayan Boxes"</div>
      <div class="boc-sub">Revised BOC Form No. BB-IS-001</div>
      <div class="boc-consolidator boc-consolidator-lg">
        <div class="boc-consolidator-note">To be filled out by the consolidator</div>
        <div class="boc-line-row"><b>MBL/MAWB Number:</b>${line(s.mbl_mawb_number)}</div>
        <div class="boc-line-row"><b>Tracking Number:</b>${line(box ? box.box_number : s.shipment_number)}</div>
      </div>
    </div>
  </div>`;
}

/* ---------------- PAGE 1 — INFORMATION SHEET ---------------- */
function bocInfoSheet(s, box, boxNo, boxTotal) {
  const boc = s.boc || {};
  const snd = boc.sender || {};
  const legacy = s.sender || {};
  const availment = boc.availment_type || '';
  const senderType = boc.sender_type || '';
  const isBB = availment.startsWith('BB_');

  // fall back to the encoded customer record when there is no online booking
  const fam = snd.family_name || (legacy.full_name || '').split(' ').slice(-1)[0] || '';
  const giv = snd.given_name || (legacy.full_name || '').split(' ')[0] || '';

  return `
  <div class="boc-page">
    ${bocHeader(s, box, boxNo, boxTotal, 'INFORMATION SHEET')}

    <div class="boc-avail">
      <div class="boc-avail-col">
        <div class="boc-blk-title">TYPE OF AVAILMENT</div>
        <div class="boc-chk">${tick(isBB)} Balikbayan Box privilege</div>
        <div class="boc-indent">
          ${BOC_AVAILMENT.filter(a => a.group).map(a => `<div class="boc-chk">${tick(availment === a.key)} ${esc(a.label)}</div>`).join('')}
        </div>
        <div class="boc-chk">${tick(availment === 'DE_MINIMIS')} De Minimis Value</div>
        <div class="boc-chk">${tick(availment === 'NONE')} None</div>
      </div>
      <div class="boc-avail-col">
        <div class="boc-blk-title">TYPE OF SENDER</div>
        <div class="boc-two">
          <div>
            <div class="boc-chk">${tick(senderType.startsWith('QFWA_'))} <b>Qualified Filipinos While Abroad (QFWA)</b></div>
            <div class="boc-indent">
              ${BOC_SENDER_QFWA.map(t => `<div class="boc-chk">${tick(senderType === t.key)} ${esc(t.label)}</div>`).join('')}
            </div>
          </div>
          <div>
            <div class="boc-chk">${tick(senderType.startsWith('NQFWA_'))} <b>Non-Qualified Filipinos While Abroad (NQFWA)</b></div>
            <div class="boc-indent">
              ${BOC_SENDER_NQFWA.map(t => `<div class="boc-chk">${tick(senderType === t.key)} ${esc(t.label)}</div>`).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="boc-section">
      <div class="boc-section-hd">
        <span class="boc-section-tag">A. SENDER INFORMATION</span>
        <span class="boc-section-extra">Business Name (Only for Sole Prop., Partnership, Corporation): ${line(snd.business_name)}</span>
      </div>
      <table class="boc-tbl">
        <tr>
          <td><small>Family Name*</small>${line(fam)}</td>
          <td><small>Given Name*</small>${line(giv)}</td>
          <td><small>Middle Name*</small>${line(snd.middle_name)}</td>
          <td style="width:14%"><small>Suffix*</small>${line(snd.suffix)}</td>
        </tr>
        <tr>
          <td colspan="2"><small>Contact Number/s:*</small>${line(snd.contact_numbers || legacy.phone_primary)}</td>
          <td colspan="2"><small>Email Address, if any:</small>${line(snd.email || legacy.email)}</td>
        </tr>
        <tr class="boc-shade">
          <td colspan="2"><small>Philippine Passport Number: (For QFWAs Only)*</small>${line(snd.passport_number)}</td>
          <td colspan="2"><small>Date Issued (mm/dd/yyyy): (For QFWAs Only)*</small>${line(snd.passport_date_issued)}</td>
        </tr>
        <tr class="boc-shade">
          <td colspan="2"><small>Expiry Date (mm/dd/yyyy): (For QFWAs Only)*</small>${line(snd.passport_expiry)}</td>
          <td colspan="2"><small>Place Issued: (For QFWAs Only)*</small>${line(snd.passport_place_issued)}</td>
        </tr>
        <tr>
          <td colspan="2" class="boc-tall"><small>Complete Current Address Abroad:*</small>${line(snd.address_abroad || legacy.address_line)}</td>
          <td colspan="2" class="boc-tall"><small>Complete Address in the Philippines:*</small>${line(snd.address_ph)}</td>
        </tr>
        <tr>
          <td colspan="4"><small>Total Value of all Contents of each Balikbayan Box for this shipment (in Philippine Peso):*</small>${line(boc.total_value_php != null ? 'Php ' + Number(boc.total_value_php).toLocaleString() : '')}</td>
        </tr>
      </table>
    </div>

    <div class="boc-warn">
      <b>WARNING:</b> Offenses that may result to the forfeiture of the goods, including imposition of penalties and criminal prosecution of the offender:<br>
      1. Sending of PROHIBITED or RESTRICTED GOODS;<br>
      2. Sending of REGULATED GOODS in excess of the allowable limits without the necessary import permit;<br>
      3. Making of any false or misleading statements to a Customs Officer.
    </div>

    <div class="boc-foot">
      <span>Page 1${boxTotal ? ` &nbsp;·&nbsp; Box ${boxNo} of ${boxTotal}` : ''}</span>
      <img src="/vfic-logo.png" alt="VFIC" class="boc-logo">
    </div>
  </div>`;
}

/* ---------------- PAGE 2 — PACKING LIST ---------------- */
function bocPackingList(s, box, boxNo, boxTotal) {
  const bboc = (box && box.boc) || {};
  const r = bboc.receiver || {};
  const legacy = box && box.receiver ? box.receiver : {};
  const goods = bboc.goods || [];
  const qtyOf = (cat) => { const g = goods.find(x => x.category === cat); return g ? g.qty : ''; };
  const half = Math.ceil(BOC_GOODS.length / 2);

  const famName = r.family_name || (legacy.full_name || '').split(' ').slice(-1)[0] || '';
  const givName = r.given_name || (legacy.full_name || '').split(' ')[0] || '';
  const zip = r.postal_code || legacy.postal_code || '';
  const phAddress = [r.street_address, r.barangay, r.city_municipality, r.region].filter(Boolean).join(', ')
    || [legacy.address_line, legacy.barangay, legacy.city_municipality, legacy.province].filter(Boolean).join(', ');

  // "Others" is only meaningful with the sender's description beside it — a quantity against
  // a bare "Others" tells a customs examiner nothing about what is in the box.
  const othersSpec = (goods.find(g => g.category === 'Others') || {}).specify || '';
  const goodsRows = (list, offset) => list.map((cat, i) => {
    const label = (cat === 'Others' && othersSpec) ? `Others — ${othersSpec}` : cat;
    return `<tr><td>${esc(label)}</td><td class="boc-qty">${qtyOf(cat) || '&nbsp;'}</td></tr>`;
  }).join('');

  return `
  <div class="boc-page">
    <div class="boc-hdr" style="border-bottom:none;padding-bottom:0">
      <div style="flex:1"></div>
      <div class="boc-hdr-right" style="flex:0 0 56%">
        <div class="boc-consolidator boc-consolidator-lg">
          <div class="boc-consolidator-note">To be filled out by the consolidator</div>
          <div class="boc-line-row"><b>MBL/MAWB Number:</b>${line(s.mbl_mawb_number)}</div>
          <div class="boc-line-row"><b>Tracking Number:</b>${line(box ? box.box_number : '')}</div>
        </div>
      </div>
    </div>

    <div class="boc-section">
      <div class="boc-section-hd"><span class="boc-section-tag">B. PHILIPPINE-BASED RECIPIENT</span></div>
      <table class="boc-tbl">
        <tr>
          <td><small>Family Name:*</small>${line(famName)}</td>
          <td><small>Given Name:*</small>${line(givName)}</td>
          <td><small>Middle Name:*</small>${line(r.middle_name)}</td>
          <td style="width:14%"><small>Suffix*</small>${line(r.suffix)}</td>
        </tr>
        <tr>
          <td colspan="2"><small>Contact Number/s:*</small>${line(r.contact_number || legacy.phone_primary)}</td>
          <td colspan="2"><small>Email Address, if any:</small>${line(r.email || legacy.email)}</td>
        </tr>
        <tr>
          <td colspan="3"><small>Complete Philippine Address:*</small>${line(phAddress)}</td>
          <td><small>ZIP / Postal Code:</small>${line(zip)}</td>
        </tr>
        <tr>
          <td colspan="4">
            <small>Relationship to Sender (by affinity or consanguinity): (Check one (1) box only)</small>
            <div class="boc-rel">
              ${BOC_RELATIONSHIPS.map(x => `<span class="boc-chk">${tick(r.relationship === x)} ${esc(x)}</span>`).join('')}
            </div>
          </td>
        </tr>
      </table>
    </div>

    <div class="boc-section">
      <div class="boc-section-hd">
        <span class="boc-section-tag">C. ITEMIZED DESCRIPTION OF GOODS*</span>
        <span class="boc-section-extra">
          (Please declare separately new and old goods. Use additional sheets if necessary and each
          additional sheet should also be signed by the Sender) &nbsp; Box ${line(boxNo)} of ${line(boxTotal)}
        </span>
      </div>
      <div class="boc-goods">
        <table class="boc-tbl boc-goods-tbl">
          <tr><th>DESCRIPTION/PERSONAL EFFECTS</th><th class="boc-qty">QTY.</th></tr>
          ${goodsRows(BOC_GOODS.slice(0, half), 0)}
        </table>
        <table class="boc-tbl boc-goods-tbl">
          <tr><th>DESCRIPTION/PERSONAL EFFECTS</th><th class="boc-qty">QTY.</th></tr>
          ${goodsRows(BOC_GOODS.slice(half), half)}
        </table>
      </div>
      <table class="boc-tbl"><tr class="boc-total">
        <td style="text-align:right"><b>TOTAL VALUE</b></td>
        <td style="width:30%">Php ${box && box.total_value_php != null ? esc(Number(box.total_value_php).toLocaleString()) : '&nbsp;'}</td>
      </tr></table>
    </div>

    <div class="boc-decl">
      <b>Declaration</b>
      <p>I declare, under the penalties of falsification, that this Information Sheet has been made in good faith
      and to the best of my knowledge and belief, is true and correct pursuant to the provisions of the Customs
      Modernization and Tariff Act of the Philippines and its implementing rules and regulations.</p>
      <div class="boc-sign">
        <div class="boc-sigline"></div>
        <div>Sender Signature over Printed Name</div>
        <div style="margin-top:6px">Date Accomplished: ___/___/______<br><small>mm &nbsp; dd &nbsp; yyyy</small></div>
      </div>
    </div>

    <div class="boc-foot">
      <span>Page 2${boxTotal ? ` &nbsp;·&nbsp; Box ${boxNo} of ${boxTotal}` : ''}</span>
      <img src="/vfic-logo.png" alt="VFIC" class="boc-logo">
    </div>
  </div>`;
}

/* ---------------- routes ---------------- */
// Blank BOC Form BB-IS-001 (Information Sheet p.1 + Packing List p.2) for a sender to fill by
// hand. Same official layout as the auto-filled version, just with empty fields/checkboxes.
function pageReceivingFormBlank(boxCount) {
  const n = Math.max(1, Math.min(20, boxCount || 1));
  const emptyS = { boc: null, sender: null, mbl_mawb_number: '', shipment_number: '' };
  const emptyBox = { boc: null, receiver: null, total_value_php: null, box_number: '' };
  view(`
    <style>@page { size: 8.5in 13in; margin: 0.35in; }</style>
    <div class="row no-print" style="justify-content:space-between;align-items:flex-start">
      <div>
        <h1 style="margin-bottom:4px">Blank Receiving Form — BOC BB-IS-001</h1>
        <div class="muted" style="max-width:640px">Official Bureau of Customs Information Sheet (p.1) + Packing List (p.2) — one set per box, for a sender to fill out by hand. Senders can also scan the QR to fill it up online and skip the paperwork.</div>
      </div>
      <div style="text-align:center">
        <img src="/api/intake-form-qr" alt="Scan to fill up online" style="width:96px;height:96px;display:block">
        <div class="muted" style="font-size:11px">Scan to fill online</div>
      </div>
    </div>
    <div class="row no-print" style="margin:8px 0 12px">
      <label style="margin:0">Boxes to print</label>
      <input id="blankCount" type="number" min="1" max="20" value="${n}" style="max-width:80px">
      <button class="secondary small" onclick="pageReceivingFormBlank(+document.getElementById('blankCount').value)">Update</button>
      <button onclick="window.print()" title="In the print dialog, choose “Save as PDF” · paper size Legal (8.5 × 13 in)">🖨 Print / Save as PDF</button>
    </div>
    ${Array.from({ length: n }, (_, i) => bocInfoSheet(emptyS, emptyBox, i + 1, n) + bocPackingList(emptyS, emptyBox, i + 1, n)).join('')}`);
}

// One Information Sheet per box (BOC requires 3 copies per box).
async function pageReceivingForm(shipmentId) {
  const s = await api('/api/shipments/' + shipmentId);
  const total = s.boxes.length;
  view(`
    <style>@page { size: 8.5in 13in; margin: 0.35in; }</style>
    <div class="row no-print" style="justify-content:space-between">
      <h1>Information Sheet — ${esc(s.shipment_number)}</h1>
      <div>
        <a href="#/packing-list/${s.id}"><button class="secondary">Packing List (p.2) →</button></a>
        <button onclick="window.print()" title="In the print dialog, choose “Save as PDF” · paper size Legal (8.5 × 13 in)">🖨 Print / Save as PDF</button>
      </div>
    </div>
    <div class="muted no-print" style="margin-bottom:10px">
      BOC Form BB-IS-001 page 1 — one sheet per box (${total}). Auto-filled from the sender's online booking where available.
    </div>
    ${s.boxes.map((b, i) => bocInfoSheet(s, b, i + 1, total)).join('')}`);
}

// One Packing List per box.
async function pagePackingList(shipmentId) {
  const s = await api('/api/shipments/' + shipmentId);
  const total = s.boxes.length;
  view(`
    <style>@page { size: 8.5in 13in; margin: 0.35in; }</style>
    <div class="row no-print" style="justify-content:space-between">
      <h1>Packing List — ${esc(s.shipment_number)}</h1>
      <div>
        <a href="#/receiving-form/${s.id}"><button class="secondary">← Information Sheet (p.1)</button></a>
        <button onclick="window.print()" title="In the print dialog, choose “Save as PDF” · paper size Legal (8.5 × 13 in)">🖨 Print / Save as PDF</button>
      </div>
    </div>
    <div class="muted no-print" style="margin-bottom:10px">
      BOC Form BB-IS-001 page 2 — one sheet per box (${total}). Quantities come from the sender's declared goods.
    </div>
    ${s.boxes.map((b, i) => bocPackingList(s, b, i + 1, total)).join('')}`);
}
