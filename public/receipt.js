/* VFIC Official Receipt — sender's copy.
   Layout follows the standard Philippine forwarder receipt (BIR-style official receipt):
   scannable barcode + tracking number, accreditation block, consignee / shipper columns,
   shipment particulars, VAT breakdown, amount due, and dual signature lines. */

/* ---- Code 39 barcode, rendered as inline SVG so it prints and scans without any library ---- */
const CODE39 = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw', 'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn',
  'F': 'nnwnwwnnn', 'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn', 'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn',
  'K': 'wnnnnnnww', 'L': 'nnwnnnnww', 'M': 'wnwnnnnwn', 'N': 'nnnnwnnww', 'O': 'wnnnwnnwn',
  'P': 'nnwnwnnwn', 'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn', 'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn',
  'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw', 'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn',
  'Z': 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn'
};
function barcodeSvg(value, { height = 54, narrow = 1.6, wide = 4 } = {}) {
  const text = '*' + String(value || '').toUpperCase().replace(/[^0-9A-Z\-. ]/g, '') + '*';
  let x = 0;
  const bars = [];
  for (const ch of text) {
    const pat = CODE39[ch];
    if (!pat) continue;
    for (let i = 0; i < pat.length; i++) {
      const w = pat[i] === 'w' ? wide : narrow;
      if (i % 2 === 0) bars.push(`<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${height}"/>`);
      x += w;
    }
    x += narrow; // inter-character gap
  }
  return `<svg class="or-barcode" viewBox="0 0 ${Math.ceil(x)} ${height}" width="${Math.min(Math.ceil(x), 300)}" height="${height}" preserveAspectRatio="xMinYMid meet" role="img" aria-label="Barcode ${esc(value)}">
    <g fill="#000">${bars.join('')}</g></svg>`;
}

const orMoney = (v) => Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const orDate = (iso) => iso ? new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '';
const orDay = (iso) => iso ? new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'numeric', day: 'numeric', year: 'numeric' }) : '';

/* Build one official receipt for a shipment (optionally for a single box). */
function officialReceiptHtml(s, box, opts = {}) {
  const VAT_RATE = 0.12;
  const boxes = box ? [box] : (s.boxes || []);
  const receiver = (box && box.receiver) || (boxes[0] && boxes[0].receiver) || {};
  const sender = s.sender || {};
  const tracking = box ? (box.container_box_number || box.box_number) : s.shipment_number;

  const gross = +(s.shipping_fee_amount || 0);
  const net = +(gross / (1 + VAT_RATE)).toFixed(2);
  const vat = +(gross - net).toFixed(2);
  const declaredValue = boxes.reduce((n, b) => n + (+(b.total_value_php || 0)), 0);
  const actualWt = boxes.reduce((n, b) => n + (+(b.weight_kg || 0)), 0);
  const volumeWt = boxes.reduce((n, b) => {
    const sz = BOX_SIZE_CATALOG.find(x => x.key === (b.size_category || '').toUpperCase());
    return n + (sz ? sz.cbm * 1000 / 6 : 0); // volumetric: cbm → kg at 1:6000 cm³/kg
  }, 0);

  const region = boxes[0] ? (boxes[0].region || receiver.region) : receiver.region;
  const areaDest = REGION_LABELS[region] || region || '';
  const consigneeAddr = [receiver.address_line, receiver.barangay].filter(Boolean).join(', ');

  const line = (label, value) => `<div class="or-kv"><span>${esc(label)}</span><b>: ${esc(value == null ? '' : String(value))}</b></div>`;

  return `
  <div class="or-receipt">
    <div class="or-top">
      <div class="or-top-left">
        ${barcodeSvg(tracking)}
        <div class="or-trk">${esc(tracking)}</div>
      </div>
      <div class="or-top-right">
        <div class="or-official">THIS SERVES AS AN OFFICIAL RECEIPT</div>
        ${line('Accreditation No', opts.accreditation || '—')}
        ${line('MIN', opts.min || '—')}
        ${line('Serial No', opts.serial || '—')}
        ${line('Official Receipt No', opts.orNumber || s.shipment_number)}
        ${line('Customer’s Copy', '')}
      </div>
    </div>

    <div class="or-company">
      <b>VICTORS FREIGHT INTERNATIONAL CORPORATION</b><br>
      Rm. 205 Sitio Grande Bldg., 409 A. Soriano Ave., Intramuros, Manila 1002 Philippines<br>
      Tel. No.(s) : +63 2 84255264 &nbsp; VAT Reg. TIN ${esc(opts.tin || '—')}
    </div>

    <div class="or-body">
      <div class="or-col">
        <div class="or-label">CONSIGNEE:</div>
        <div class="or-name">${esc(receiver.full_name || '')}</div>
        <div class="or-sub">And or/Care Of : ${esc(opts.careOf || '')}</div>
        <div class="or-addr">${esc(consigneeAddr)}</div>
        <div class="or-addr">${esc(receiver.city_municipality || '')}</div>
        <div class="or-addr">${esc(receiver.province || '')}</div>
        <div class="or-addr">${esc(areaDest)}</div>
        <div class="or-addr">${esc(receiver.postal_code || '')}</div>

        <div class="or-name" style="margin-top:12px">${esc(sender.full_name || '')}</div>
        <div class="or-addr">${esc(sender.address_line || '')}</div>
        <div class="or-addr">${esc([sender.city_municipality, sender.country].filter(Boolean).join(', '))}</div>
        <div class="or-addr">${esc(sender.phone_primary || '')}</div>
        <div class="or-sub" style="margin-top:10px">Card Number: ${esc(opts.cardNumber || '')}</div>
      </div>

      <div class="or-col or-col-right">
        <div class="or-route">${esc(opts.routeCode || (s.origin_agent ? s.origin_agent.toUpperCase() : ''))}</div>
        ${line('Origin', [s.origin_agent, s.origin_country].filter(Boolean).join(', '))}
        ${line('Tran. Date', orDate(s.created_at))}
        ${line('Delivery Date', orDay(opts.deliveryDate || null))}
        ${line('Area Dest', areaDest)}
        ${line('Tran. Type', SERVICE_LEVEL_LABELS[s.service_level] || 'DELIVERY')}
        ${line('Cut-Off', opts.cutOff || '11:59:00 PM')}
        ${line('No. of Item(s)', boxes.length)}
        ${line('Volume Wt', volumeWt.toFixed(2))}
        ${line('Actual Wt', actualWt.toFixed(2))}
        ${line('Declared Value', orMoney(declaredValue))}

        <div class="or-vat">
          ${line('VATable(Freight)', orMoney(net))}
          ${line('VATable(Valuation)', orMoney(0))}
          ${line('VAT-Exempt', orMoney(0))}
          ${line('VAT Zero-Rated', orMoney(0))}
          ${line('Discount', orMoney(0))}
          ${line('Total Sales', orMoney(net))}
          ${line('12% VAT', orMoney(vat))}
        </div>
        <div class="or-due">
          <div class="or-kv or-amount"><span>Amount Due</span><b>: ${esc(orMoney(gross))}</b></div>
          ${line('Mode', s.payment_status === 'PAID' ? (opts.mode || 'CASH') : 'UNPAID')}
        </div>
      </div>
    </div>

    <div class="or-contents">Contents: ${esc(boxes.map(b => b.declared_contents).filter(Boolean).join('; ') || 'PERSONAL EFFECTS')}</div>
    <div class="or-warrant">SHIPPER WARRANTS THAT THE SHIPMENT HAS NO CASH INSIDE. CLAIMS OF CARGO ARE LIMITED UP TO ACTUAL DECLARED VALUE ONLY</div>

    <div class="or-signs">
      <div><div class="or-sigline"></div>Signature of Associate</div>
      <div><div class="or-sigline"></div>Signature of Shipper</div>
    </div>
    <div class="or-care">Customer Care: +63 2 84255264</div>
  </div>`;
}

/* Page: one receipt per box (the sender keeps one per box), or a single shipment receipt. */
async function pageSenderReceipt(shipmentId) {
  const s = await api('/api/shipments/' + shipmentId);
  const perBox = (hashQuery().get('per') || 'shipment') === 'box';
  const docs = perBox && s.boxes.length ? s.boxes.map(b => officialReceiptHtml(s, b)) : [officialReceiptHtml(s, null)];
  view(`
    <style>@page { size: 8.5in 13in; margin: 0.35in; }</style>
    <div class="row no-print" style="justify-content:space-between">
      <h1>Official Receipt — ${esc(s.shipment_number)}</h1>
      <div>
        <a href="#/sender-receipt/${s.id}?per=${perBox ? 'shipment' : 'box'}"><button class="secondary">${perBox ? 'One receipt per shipment' : 'One receipt per box'}</button></a>
        <button onclick="window.print()" title="In the print dialog, choose “Save as PDF” · paper size Legal (8.5 × 13 in)">🖨 Print / Save as PDF</button>
      </div>
    </div>
    <div class="muted no-print" style="margin-bottom:10px">Sender's copy. Accreditation, MIN, Serial and TIN print as “—” until VFIC's BIR details are set in Admin.</div>
    ${docs.join('')}`);
}
