// Demo seed per spec §11: 4 users, ~10 customers across regions, 2 containers,
// ~40 boxes spread across all statuses (incl. 3 RETURNED), 2 trucking trips, sample notifications.
const crypto = require('crypto');
const { hashPassword } = require('./auth');
const { countryCode } = require('./branches');

const YEAR = new Date().getFullYear();
const now = Date.now();
const daysAgo = n => new Date(now - n * 86400000).toISOString();
const daysAhead = n => new Date(now + n * 86400000).toISOString();
const token = () => crypto.randomBytes(16).toString('base64url');

// Example rate cards. Ocean levels are priced per box by size; Express Air per kilo.
// Each branch is priced in its own currency, so a sender in Thailand and a sender in
// Cambodia see genuinely different prices out of the box.
//   Thailand → THB   Cambodia → USD   Manila head office → PHP
function branchRateCards() {
  const scale = (card, factor, currency, emptyBox) => {
    const c = JSON.parse(JSON.stringify(card));
    c.currency = currency;
    c.empty_box_price = emptyBox;
    for (const lvl of Object.keys(c.ocean)) {
      for (const zone of Object.keys(c.ocean[lvl])) {
        for (const size of Object.keys(c.ocean[lvl][zone])) {
          c.ocean[lvl][zone][size] = +(c.ocean[lvl][zone][size] * factor).toFixed(2);
        }
      }
    }
    for (const zone of Object.keys(c.air.EXPRESS_AIR)) {
      c.air.EXPRESS_AIR[zone] = +(c.air.EXPRESS_AIR[zone] * factor).toFixed(2);
    }
    return c;
  };
  const php = sampleRateCard();
  const row = (s, m, l, g) => ({ SMALL: s, MEDIUM: m, LARGE: l, GIGA: g });
  return {
    HQ_MANILA: php,
    // ~0.63 THB per PHP
    TH_BANGKOK: scale(php, 0.63, 'THB', row(120, 150, 180, 240)),
    // ~0.018 USD per PHP
    KH_PHNOMPENH: scale(php, 0.018, 'USD', row(4.5, 5.5, 6.5, 8.5))
  };
}

function sampleRateCard() {
  const row = (s, m, l, g) => ({ SMALL: s, MEDIUM: m, LARGE: l, GIGA: g });
  return {
    currency: 'PHP',
    empty_box_price: row(180, 220, 260, 320),
    ocean: {
      OCEAN_ECONOMY: {
        METRO_MANILA: row(1200, 1500, 1800, 2400),
        LUZON: row(1400, 1750, 2100, 2800),
        LUZON_INTERISLAND: row(1700, 2100, 2500, 3300),
        VISAYAS: row(1600, 2000, 2400, 3200),
        MINDANAO: row(1800, 2250, 2700, 3600)
      },
      OCEAN_PRIORITY: {
        METRO_MANILA: row(1600, 2000, 2400, 3200),
        LUZON: row(1900, 2350, 2800, 3750),
        LUZON_INTERISLAND: row(2300, 2800, 3350, 4450),
        VISAYAS: row(2150, 2700, 3200, 4300),
        MINDANAO: row(2400, 3000, 3600, 4800)
      }
    },
    air: { EXPRESS_AIR: { METRO_MANILA: 380, LUZON: 420, LUZON_INTERISLAND: 520, VISAYAS: 480, MINDANAO: 540 } },
    // All-in charge head office bills an origin branch per container, by size, covering the
    // whole PH-side service for every box inside.
    interbranch_container: { C20: 30000, C40: 48000, C40HQ: 52000 },
    // Extra destination charges, billed only when they actually occur.
    interbranch_extras: {
      DEMURRAGE_PER_DAY: 2500, DETENTION_PER_DAY: 1800, STORAGE_PER_DAY: 900,
      CUSTOMS_EXAM: 6500, ALERT_ORDER: 12000, REDELIVERY: 450,
      REMOTE_AREA: 350, STORAGE_UNCLAIMED: 120, DOCUMENTATION: 3500, CRANE_LIFT: 4200
    },
    updated_at: null, updated_by: null
  };
}

function build() {
  const d = {
    seq: {},
    users: [],
    customers: [],
    shipments: [],
    boxes: [],
    containers: [],
    trips: [],
    delivery_attempts: [],
    status_events: [],
    notifications: [],
    intake_requests: [],
    box_orders: [],
    sender_accounts: [],
    invoices: [],
    expenses: [],
    interbranch_invoices: [],
    settings: {
      supportPhone: '+63 917 555 0100',
      supportEmail: 'support@vfic.ph',
      publicBaseUrl: 'http://localhost:3000',
      // Excess-weight charge applied per kg above a box size's standard weight allowance.
      // null = "additional charges apply" shown without an amount until VFIC sets a rate.
      excessWeightChargePerKg: null,
      excessWeightChargeCurrency: 'PHP',
      // BIR registration particulars printed on every official receipt.
      // Fill the blanks in Admin → Official Receipt details as BIR issues them.
      // MIN and Serial No. are generated automatically (see machineIdentificationNo and
      // /api/receipt-meta) — leave them blank unless BIR issues specific values to use.
      bir: { tin: '006-614-583-00000', accreditation_no: '', min: '', serial_no: '', permit_no: '' },
      // Starting commercial rates — the Developer edits these in Accounting → Rate Cards.
      // One card per branch, each in its own currency.
      rateCard: sampleRateCard(),          // legacy fallback for anything unbranched
      rateCards: branchRateCards(),
      smsTemplates: {} // overrides of lib/notifications DEFAULT_TEMPLATES
    }
  };
  // Seeded ids sit in this deployment's own id band, so records created on different nodes
  // can never collide and each node is correctly recorded as the owner of its own data.
  const ID_OFFSET = require('./node').ID_OFFSET;
  const nid = key => {
    d.seq[key] = Math.max((d.seq[key] || 0) + 1, ID_OFFSET + 1);
    return d.seq[key];
  };

  // ---------- users ----------
  const pw = hashPassword('demo1234');
  const mkUser = (name, email, role) => {
    const u = { id: nid('user'), name, email, role, password_hash: pw, active: true, created_at: daysAgo(90) };
    d.users.push(u);
    return u;
  };
  const developer = mkUser('VFIC Developer', 'developer@vfic.demo', 'DEVELOPER_ADMIN');
  const admin = mkUser('Victor Reyes', 'admin@vfic.demo', 'MASTER_ADMIN');
  // Each origin branch runs its own portal with its own admin + staff.
  const branchAdminTh = mkUser('Somchai Wong (Thailand Branch Admin)', 'admin.th@vfic.demo', 'BRANCH_ADMIN_TH');
  const branchAdminKh = mkUser('Dara Sok (Cambodia Branch Admin)', 'admin.kh@vfic.demo', 'BRANCH_ADMIN_KH');
  const shipperAgent = mkUser('Grace Lim (Bangkok Office)', 'shipper@vfic.demo', 'SHIPPER_AGENT_TH');
  const shipperKh = mkUser('Sophea Chan (Phnom Penh Office)', 'cambodia@vfic.demo', 'SHIPPER_AGENT_KH');
  const consigneeAgent = mkUser('Ramon Cruz (Manila)', 'consignee@vfic.demo', 'CONSIGNEE_AGENT');
  const warehouse = mkUser('Jun Santos (Warehouse)', 'warehouse@vfic.demo', 'WAREHOUSE');
  const accountant = mkUser('Cecil Tan (Accounting)', 'accounting@vfic.demo', 'ACCOUNTING');

  // ---------- customers ----------
  const mkCustomer = (full_name, phone, type, addr) => {
    const c = {
      id: nid('customer'), full_name,
      phone_primary: phone, phone_alternate: addr.alt || '',
      phone_history: [],
      email: addr.email || '',
      address_line: addr.line || '', barangay: addr.brgy || '', city_municipality: addr.city || '',
      province: addr.prov || '', region: addr.region || null, country: addr.country || 'Philippines',
      postal_code: addr.zip || '', landmark: addr.landmark || '',
      notes: '', type,
      created_at: daysAgo(80)
    };
    d.customers.push(c);
    return c;
  };
  // Senders (abroad — VFIC's two origin lanes: Thailand and Cambodia)
  const sMaria = mkCustomer('Maria Dela Cruz', '+66 62 555 0182', 'SENDER', { line: '55/12 Sukhumvit Soi 20, Khlong Toei', city: 'Bangkok', country: 'Thailand', email: 'maria.dc@gmail.com' });
  const sJose = mkCustomer('Jose Ramirez', '+855 10 555 0147', 'SENDER', { line: '45 Street 178, Daun Penh', city: 'Phnom Penh', country: 'Cambodia' });
  const sAna = mkCustomer('Ana Villanueva', '+855 12 555 0134', 'SENDER', { line: '23 Street 214, Boeung Raing', city: 'Phnom Penh', country: 'Cambodia' });
  const sPedro = mkCustomer('Pedro Bautista', '+66 81 555 0126', 'SENDER', { line: '210 Silom Rd, Bang Rak', city: 'Bangkok', country: 'Thailand' });
  // Receivers (PH)
  const rLorna = mkCustomer('Lorna Dela Cruz', '+63 917 555 0201', 'RECEIVER', { line: '123 Sampaguita St', brgy: 'Brgy San Isidro', city: 'Quezon City', prov: 'Metro Manila', region: 'NCR', zip: '1100', landmark: 'Beside 7-Eleven, blue gate', alt: '+63 928 555 0301' });
  const rBong = mkCustomer('Bong Ramirez', '+63 918 555 0202', 'RECEIVER', { line: 'Purok 4, National Hwy', brgy: 'Brgy Poblacion', city: 'San Fernando', prov: 'La Union', region: 'R1', zip: '2500', landmark: 'Near San Fernando public market' });
  const rNene = mkCustomer('Nene Villanueva', '+63 919 555 0203', 'RECEIVER', { line: 'Blk 5 Lot 12, Camella Homes', brgy: 'Brgy Dela Paz', city: 'Biñan', prov: 'Laguna', region: 'R4A', zip: '4024', landmark: 'White house with mango tree' });
  const rCarding = mkCustomer('Ricardo Bautista', '+63 920 555 0204', 'RECEIVER', { line: '45 Rizal St', brgy: 'Brgy 6', city: 'Calapan', prov: 'Oriental Mindoro', region: 'MIMAROPA', zip: '5200', landmark: 'Across the elementary school' });
  const rTess = mkCustomer('Teresita Gomez', '+63 921 555 0205', 'RECEIVER', { line: '19 Mabini St', brgy: 'Brgy Lahug', city: 'Cebu City', prov: 'Cebu', region: 'R7', zip: '6000', landmark: 'Gate with bougainvillea' });
  const rDodong = mkCustomer('Dodong Uy', '+63 922 555 0206', 'RECEIVER', { line: 'Km 7 Diversion Rd', brgy: 'Brgy Buhangin', city: 'Davao City', prov: 'Davao del Sur', region: 'R11', zip: '8000', landmark: 'Yellow sari-sari store in front' });

  const receivers = [rLorna, rBong, rNene, rCarding, rTess, rDodong];

  // ---------- containers ----------
  const cStripped = {
    id: nid('container'), container_number: 'MSCU1234567', size: 'C40',
    shipping_line: 'MSC Mediterranean Shipping Company S.A., Geneva', vessel_name: 'MSC Clara', booking_number: 'BKG-88214',
    origin_port: 'Laem Chabang, Thailand', destination_port: 'Manila International Container Terminal (North)',
    etd: daysAgo(45), eta: daysAgo(14), actual_departure: daysAgo(44), actual_arrival: daysAgo(13),
    load_code: 'C1', load_plan_notes: '',
    status: 'STRIPPED', created_at: daysAgo(60)
  };
  const cTransit = {
    id: nid('container'), container_number: 'TGHU7654321', size: 'C20',
    shipping_line: 'Evergreen Line', vessel_name: 'Ever Lucid', booking_number: 'BKG-90177',
    origin_port: 'Sihanoukville, Cambodia', destination_port: 'Manila International Container Terminal (North)',
    etd: daysAgo(12), eta: daysAhead(16), actual_departure: daysAgo(11), actual_arrival: null,
    load_code: 'C2', load_plan_notes: '',
    status: 'IN_TRANSIT', created_at: daysAgo(25)
  };
  d.containers.push(cStripped, cTransit);

  // ---------- trips ----------
  const tripNcr = {
    id: nid('trip'), trip_number: `TRIP-${YEAR}-0001`,
    driver_name: 'Edgar Manalo', driver_contact: '+63 917 555 0400', plate_number: 'NBC 1234',
    trucking_company: 'JRS Co-loader', region: 'NCR', scheduled_date: daysAgo(2),
    status: 'DISPATCHED', created_at: daysAgo(4)
  };
  const tripSouth = {
    id: nid('trip'), trip_number: `TRIP-${YEAR}-0002`,
    driver_name: 'Rey Aquino', driver_contact: '+63 917 555 0401', plate_number: 'CAL 5678',
    trucking_company: 'VFIC own truck', region: 'R4A', scheduled_date: daysAhead(1),
    status: 'PLANNED', created_at: daysAgo(1)
  };
  d.trips.push(tripNcr, tripSouth);

  // ---------- shipments + boxes ----------
  let shipSeq = 0;
  const mkShipment = (sender, opts = {}) => {
    shipSeq += 1;
    d.seq.shipment_number = shipSeq;
    // Shipment/box IDs carry the origin country code: TH-… from Thailand, KH-… from Cambodia.
    const code = countryCode(opts.origin || 'Thailand');
    const s = {
      id: nid('shipment'),
      shipment_number: `${code}-${YEAR}-${String(shipSeq).padStart(6, '0')}`,
      sender_id: sender.id,
      origin_country: opts.origin || 'Thailand', origin_agent: opts.agent || 'Bangkok',
      service_type: opts.service || 'DOOR_TO_DOOR',
      service_level: opts.level || 'OCEAN_ECONOMY', collection: opts.collection || 'PICKUP',
      receiving_form_file: null, packing_list_file: null, passport_file: null,
      shipping_fee_amount: opts.fee != null ? opts.fee : 120, currency: opts.currency || 'USD',
      payment_status: opts.paid === false ? 'UNPAID' : 'PAID',
      created_by: shipperAgent.id, created_at: opts.created || daysAgo(50)
    };
    d.shipments.push(s);
    return s;
  };

  const STATUS_CHAIN = ['CREATED', 'RECEIVED_ORIGIN', 'LOADED_CONTAINER', 'IN_TRANSIT', 'ARRIVED_PORT',
    'RECEIVED_WAREHOUSE', 'SORTED', 'ASSIGNED', 'LOADED_TRUCK', 'OUT_FOR_DELIVERY', 'DELIVERED'];

  // Create a box and write StatusEvents walking the chain up to `status`.
  const mkBox = (shipment, idx, receiver, status, opts = {}) => {
    const sortedIdx = STATUS_CHAIN.indexOf('SORTED');
    const stIdx = STATUS_CHAIN.indexOf(status);
    const b = {
      id: nid('box'),
      box_number: `${shipment.shipment_number}-${String(idx).padStart(2, '0')}`,
      qr_token: token(),
      shipment_id: shipment.id,
      receiver_id: receiver.id,
      size_category: opts.size || 'LARGE',
      length_cm: opts.dims ? opts.dims[0] : 60, width_cm: opts.dims ? opts.dims[1] : 60, height_cm: opts.dims ? opts.dims[2] : 60,
      weight_kg: opts.weight || null,
      declared_contents: opts.contents || 'Clothes, canned goods, chocolates, toys',
      packing_list_items: opts.items || [],
      special_instructions: opts.instructions || '',
      region: (status === 'RETURNED' || (stIdx >= 0 && stIdx >= sortedIdx)) ? receiver.region : null,
      status,
      status_updated_at: null,
      container_id: opts.container_id || null,
      // container load code stamped onto the box number (e.g. VF-2026-000001-01/C1)
      container_load_code: opts.container_id === cStripped.id ? 'C1' : opts.container_id === cTransit.id ? 'C2' : null,
      container_box_number: opts.container_id
        ? `${shipment.shipment_number}-${String(idx).padStart(2, '0')}/${opts.container_id === cStripped.id ? 'C1' : 'C2'}`
        : null,
      trucking_assignment_id: opts.trip_id || null,
      created_at: daysAgo(opts.age || 50)
    };
    d.boxes.push(b);
    const chainUpTo = status === 'RETURNED'
      ? [...STATUS_CHAIN.slice(0, STATUS_CHAIN.indexOf('OUT_FOR_DELIVERY') + 1), 'RETURNED']
      : STATUS_CHAIN.slice(0, stIdx + 1);
    const age = opts.age || 50;
    const step = age / Math.max(chainUpTo.length, 1);
    let prev = null;
    chainUpTo.forEach((st, i) => {
      const at = daysAgo(age - step * (i + 0.5));
      d.status_events.push({
        id: nid('status_event'), box_id: b.id, from_status: prev, to_status: st,
        actor_user_id: i < 3 ? shipperAgent.id : consigneeAgent.id,
        note: st === 'RETURNED' ? (opts.returnNote || 'Delivery failed') : '',
        created_at: at
      });
      b.status_updated_at = at;
      prev = st;
    });
    return b;
  };

  // Shipment 1: Maria → Lorna, 3 boxes DELIVERED (came on stripped container, NCR trip)
  const sh1 = mkShipment(sMaria, { created: daysAgo(55), fee: 360 });
  const sh1Items = [
    [{ description: 'Assorted clothes (used, good condition)', qty: '15 pcs' }, { description: 'Canned goods (corned beef, sardines)', qty: '24 cans' }, { description: 'Chocolates / candies', qty: '10 packs' }, { description: 'Drinking glasses', qty: '6 pcs' }],
    [{ description: 'Bed sheets and towels', qty: '8 pcs' }, { description: "Children's toys", qty: '5 pcs' }, { description: 'Shoes', qty: '4 pairs' }],
    [{ description: 'Canned goods', qty: '18 cans' }, { description: 'Toiletries (soap, shampoo)', qty: '12 pcs' }, { description: 'Instant coffee / snacks', qty: '9 packs' }]
  ];
  for (let i = 1; i <= 3; i++) {
    const b = mkBox(sh1, i, rLorna, 'DELIVERED', { age: 55, container_id: cStripped.id, trip_id: tripNcr.id, weight: 40, instructions: i === 1 ? 'Fragile — glassware inside' : '', items: sh1Items[i - 1] });
    d.delivery_attempts.push({
      id: nid('attempt'), box_id: b.id, trucking_assignment_id: tripNcr.id,
      attempt_number: 1, attempted_at: daysAgo(1),
      outcome: 'DELIVERED', failure_reason: null,
      pod_receipt_photo: null, pod_receiver_photo: null,
      received_by_name: 'Lorna Dela Cruz', notes: 'Received in good condition',
      created_at: daysAgo(1)
    });
  }

  // Shipment 2: Jose → Bong (2 boxes RECEIVED_WAREHOUSE), → Tess (1 box SORTED)
  const sh2 = mkShipment(sJose, { created: daysAgo(50), fee: 340, origin: 'Cambodia', agent: 'Phnom Penh' });
  mkBox(sh2, 1, rBong, 'RECEIVED_WAREHOUSE', { age: 50, container_id: cStripped.id });
  mkBox(sh2, 2, rBong, 'RECEIVED_WAREHOUSE', { age: 50, container_id: cStripped.id, size: 'GIGA', weight: 75 });
  mkBox(sh2, 3, rTess, 'SORTED', { age: 50, container_id: cStripped.id });

  // Shipment 3: Ana (Phnom Penh) → Nene, 2 boxes ASSIGNED to CALABARZON trip; 1 box SORTED
  const sh3 = mkShipment(sAna, { created: daysAgo(48), origin: 'Cambodia', agent: 'Phnom Penh', fee: 250, currency: 'USD' });
  mkBox(sh3, 1, rNene, 'ASSIGNED', { age: 48, container_id: cStripped.id, trip_id: tripSouth.id });
  mkBox(sh3, 2, rNene, 'ASSIGNED', { age: 48, container_id: cStripped.id, trip_id: tripSouth.id, instructions: 'Call alternate number first' });
  mkBox(sh3, 3, rNene, 'SORTED', { age: 48, container_id: cStripped.id });

  // Shipment 4: Pedro (Hanoi) → Lorna, 2 boxes OUT_FOR_DELIVERY on NCR trip; shipment still UNPAID
  const sh4 = mkShipment(sPedro, { created: daysAgo(47), origin: 'Thailand', agent: 'Bangkok', fee: 300, currency: 'USD', paid: false });
  mkBox(sh4, 1, rLorna, 'OUT_FOR_DELIVERY', { age: 47, container_id: cStripped.id, trip_id: tripNcr.id });
  mkBox(sh4, 2, rLorna, 'OUT_FOR_DELIVERY', { age: 47, container_id: cStripped.id, trip_id: tripNcr.id, instructions: 'Deliver after 5pm' });

  // Shipment 5: Maria → various, 3 RETURNED boxes (the returns-queue pain point)
  const sh5 = mkShipment(sMaria, { created: daysAgo(45), fee: 360 });
  const ret1 = mkBox(sh5, 1, rLorna, 'RETURNED', { age: 45, container_id: cStripped.id, returnNote: 'Receiver unreachable by phone' });
  const ret2 = mkBox(sh5, 2, rNene, 'RETURNED', { age: 45, container_id: cStripped.id, returnNote: 'Address not found — no landmark match' });
  const ret3 = mkBox(sh5, 3, rTess, 'RETURNED', { age: 45, container_id: cStripped.id, returnNote: 'Receiver absent at address' });
  const retReasons = [[ret1, 'UNREACHABLE'], [ret2, 'ADDRESS_NOT_FOUND'], [ret3, 'RECEIVER_ABSENT']];
  for (const [box, reason] of retReasons) {
    d.delivery_attempts.push({
      id: nid('attempt'), box_id: box.id, trucking_assignment_id: tripNcr.id,
      attempt_number: 1, attempted_at: daysAgo(3),
      outcome: 'FAILED', failure_reason: reason,
      pod_receipt_photo: null, pod_receiver_photo: null,
      received_by_name: null, notes: '', created_at: daysAgo(3)
    });
  }

  // Shipments 6-8: boxes on the in-transit container
  const sh6 = mkShipment(sJose, { created: daysAgo(20), fee: 480, origin: 'Cambodia', agent: 'Phnom Penh' });
  for (let i = 1; i <= 4; i++) mkBox(sh6, i, receivers[i % receivers.length], 'IN_TRANSIT', { age: 20, container_id: cTransit.id });
  const sh7 = mkShipment(sMaria, { created: daysAgo(19), fee: 600 });
  for (let i = 1; i <= 5; i++) mkBox(sh7, i, receivers[(i + 1) % receivers.length], 'IN_TRANSIT', { age: 19, container_id: cTransit.id, size: i % 2 ? 'MEDIUM' : 'LARGE' });
  const sh8 = mkShipment(sAna, { created: daysAgo(18), origin: 'Cambodia', agent: 'Phnom Penh', fee: 220, currency: 'USD', paid: false });
  for (let i = 1; i <= 3; i++) mkBox(sh8, i, rDodong, 'IN_TRANSIT', { age: 18, container_id: cTransit.id });

  // Shipments 9-10: origin-side pipeline
  const sh9 = mkShipment(sPedro, { created: daysAgo(6), origin: 'Thailand', agent: 'Bangkok', fee: 200, currency: 'USD' });
  mkBox(sh9, 1, rBong, 'RECEIVED_ORIGIN', { age: 6 });
  mkBox(sh9, 2, rTess, 'RECEIVED_ORIGIN', { age: 6 });
  const sh10 = mkShipment(sMaria, { created: daysAgo(3), fee: 240 });
  mkBox(sh10, 1, rLorna, 'CREATED', { age: 3 });
  mkBox(sh10, 2, rDodong, 'CREATED', { age: 3 });

  // Extra SORTED pool for dispatch demos, across regions
  const sh11 = mkShipment(sJose, { created: daysAgo(40), fee: 960, origin: 'Cambodia', agent: 'Phnom Penh' });
  receivers.forEach((r, i) => mkBox(sh11, i + 1, r, 'SORTED', { age: 40, container_id: cStripped.id }));
  const sh12 = mkShipment(sAna, { created: daysAgo(38), origin: 'Cambodia', agent: 'Phnom Penh', fee: 180, currency: 'USD' });
  mkBox(sh12, 1, rTess, 'SORTED', { age: 38, container_id: cStripped.id });
  mkBox(sh12, 2, rDodong, 'SORTED', { age: 38, container_id: cStripped.id, size: 'GIGA', weight: 78 });

  // ---------- sample notifications ----------
  const sampleBox = d.boxes[0];
  d.notifications.push(
    {
      id: nid('notification'), box_id: sampleBox.id, recipient_phone: sMaria.phone_primary, recipient_role: 'SENDER',
      template_key: 'DELIVERED', message_body: `VFIC: Box ${sampleBox.box_number} was delivered and received by Lorna Dela Cruz. Salamat po for trusting VFIC!`,
      status: 'SENT', attempts: 1, last_error: null, sent_at: daysAgo(1), created_at: daysAgo(1)
    },
    {
      id: nid('notification'), box_id: ret1.id, recipient_phone: rLorna.phone_primary, recipient_role: 'RECEIVER',
      template_key: 'RETURNED', message_body: `VFIC: We attempted to deliver box ${ret1.box_number} today but we could not reach you by phone. Please contact us at ${d.settings.supportPhone} to reschedule.`,
      status: 'FAILED', attempts: 3, last_error: 'Simulated gateway timeout', sent_at: null, created_at: daysAgo(3)
    }
  );

  // ---------- sample online intake request (submitted by a sender, awaiting agent review) ----------
  d.seq.intake_request_code = 1;
  d.intake_requests.push({
    id: nid('intake_request'),
    reference_code: `IR-${YEAR}-000001`,
    status: 'PENDING',
    submitted_at: daysAgo(0.3),
    converted_shipment_id: null,
    availment_type: 'BB_1ST',
    sender_type: 'QFWA_OFW',
    sender: {
      business_name: '',
      family_name: 'Marquez', given_name: 'Elena', middle_name: 'Reyes', suffix: 'N/A',
      contact_numbers: '+66 62 555 0119', email: 'elena.marquez@example.com',
      passport_number: 'P1234567A', passport_place_issued: 'DFA Manila',
      passport_date_issued: '2021-03-15', passport_expiry: '2031-03-14',
      address_abroad: '55/12 Sukhumvit Soi 20, Khlong Toei, Bangkok 10110, Thailand',
      address_ph: '77 Malakas St, Brgy Pinyahan, Quezon City, Metro Manila'
    },
    origin_country: 'Thailand', origin_agent: 'Bangkok', service_level: 'OCEAN_ECONOMY', collection: 'PICKUP',
    pickup: { date: daysAhead(2).slice(0, 10), time_window: 'AM', address: '55/12 Sukhumvit Soi 20, Khlong Toei, Bangkok 10110, Thailand', notes: 'Call on arrival' },
    total_value_php: 18500, currency: 'USD', payment_status: 'UNPAID',
    passport_file: null,
    boxes: [
      {
        receiver: {
          family_name: 'Marquez', given_name: 'Fernando', middle_name: 'Cruz', suffix: 'N/A',
          contact_number: '09235550299', email: '',
          region: 'National Capital Region (NCR)', city_municipality: 'City of Quezon', barangay: 'Pinyahan',
          street_address: '77 Malakas St', landmark: 'Yellow gate near the chapel', postal_code: '1100',
          relationship: 'Parent', country: 'Philippines'
        },
        size_category: 'LARGE', weight_kg: 42, total_value_php: 18500,
        special_instructions: 'Please call before delivering',
        goods: [
          { category: 'Clothes', qty: 20 },
          { category: 'Canned and Packed Foods', qty: 15 },
          { category: 'Chocolates', qty: 10 },
          { category: 'Personal care', qty: 6 }
        ]
      }
    ]
  });

  // ---------- sample box orders (public "Order a box") ----------
  d.box_orders.push({
    id: nid('box_order'), reference_code: `BO-${YEAR}-000001`, status: 'NEW', submitted_at: daysAgo(1),
    items: [{ size: 'LARGE', qty: 2 }, { size: 'MEDIUM', qty: 1 }], total_qty: 3,
    delivery_method: 'DELIVER_ADDRESS', pickup_branch: null,
    address: { country: 'Thailand', city: 'Bangkok', street_address: '55/12 Sukhumvit Soi 20, Khlong Toei', postal_code: '10110', landmark: 'near BTS Asok' },
    contact: { name: 'Marites Solon', phone: '+66 62 555 1188', email: 'marites.solon@example.com' }, notes: 'Please deliver on a weekend if possible.'
  });
  d.box_orders.push({
    id: nid('box_order'), reference_code: `BO-${YEAR}-000002`, status: 'PREPARING', submitted_at: daysAgo(3),
    items: [{ size: 'GIGA', qty: 1 }], total_qty: 1,
    delivery_method: 'PICKUP_OFFICE', address: null, pickup_branch: 'Phnom Penh, Cambodia',
    contact: { name: 'Jerome Aquino', phone: '+855 12 550 042', email: '' }, notes: ''
  });
  d.seq.box_order_code = 2; // next public order continues from BO-…-000003

  return d;
}

module.exports = { build };
