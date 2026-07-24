// Demo seed per spec §11: 4 users, ~10 customers across regions, 2 containers,
// ~40 boxes spread across all statuses (incl. 3 RETURNED), 2 trucking trips, sample notifications.
const crypto = require('crypto');
const { hashPassword } = require('./auth');

const YEAR = new Date().getFullYear();
const now = Date.now();
const daysAgo = n => new Date(now - n * 86400000).toISOString();
const daysAhead = n => new Date(now + n * 86400000).toISOString();
const token = () => crypto.randomBytes(16).toString('base64url');

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
    settings: {
      supportPhone: '+63 917 555 0100',
      supportEmail: 'support@vfic.ph',
      publicBaseUrl: 'http://localhost:3000',
      // Excess-weight charge applied per kg above a box size's standard weight allowance.
      // null = "additional charges apply" shown without an amount until VFIC sets a rate.
      excessWeightChargePerKg: null,
      excessWeightChargeCurrency: 'PHP',
      smsTemplates: {} // overrides of lib/notifications DEFAULT_TEMPLATES
    }
  };
  const nid = key => { d.seq[key] = (d.seq[key] || 0) + 1; return d.seq[key]; };

  // ---------- users ----------
  const pw = hashPassword('demo1234');
  const mkUser = (name, email, role) => {
    const u = { id: nid('user'), name, email, role, password_hash: pw, active: true, created_at: daysAgo(90) };
    d.users.push(u);
    return u;
  };
  const admin = mkUser('Victor Reyes', 'admin@vfic.demo', 'ADMIN');
  const shipperAgent = mkUser('Grace Lim (LA Office)', 'shipper@vfic.demo', 'SHIPPER_AGENT');
  const consigneeAgent = mkUser('Ramon Cruz (Manila)', 'consignee@vfic.demo', 'CONSIGNEE_AGENT');
  const warehouse = mkUser('Jun Santos (Warehouse)', 'warehouse@vfic.demo', 'WAREHOUSE');

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
  // Senders (abroad)
  const sMaria = mkCustomer('Maria Dela Cruz', '+1 310 555 0182', 'SENDER', { line: '2233 W Temple St', city: 'Los Angeles', prov: 'CA', country: 'USA', email: 'maria.dc@gmail.com' });
  const sJose = mkCustomer('Jose Ramirez', '+1 415 555 0147', 'SENDER', { line: '88 Mission Blvd', city: 'Daly City', prov: 'CA', country: 'USA' });
  const sAna = mkCustomer('Ana Villanueva', '+971 50 555 0134', 'SENDER', { line: 'Al Rigga Rd Bldg 7', city: 'Dubai', country: 'UAE' });
  const sPedro = mkCustomer('Pedro Bautista', '+39 333 555 0126', 'SENDER', { line: 'Via Roma 42', city: 'Milan', country: 'Italy' });
  // Receivers (PH)
  const rLorna = mkCustomer('Lorna Dela Cruz', '+63 917 555 0201', 'RECEIVER', { line: '123 Sampaguita St', brgy: 'Brgy San Isidro', city: 'Quezon City', prov: 'Metro Manila', region: 'NCR', landmark: 'Beside 7-Eleven, blue gate', alt: '+63 928 555 0301' });
  const rBong = mkCustomer('Bong Ramirez', '+63 918 555 0202', 'RECEIVER', { line: 'Purok 4, National Hwy', brgy: 'Brgy Poblacion', city: 'San Fernando', prov: 'La Union', region: 'NORTH_LUZON', landmark: 'Near San Fernando public market' });
  const rNene = mkCustomer('Nene Villanueva', '+63 919 555 0203', 'RECEIVER', { line: 'Blk 5 Lot 12, Camella Homes', brgy: 'Brgy Dela Paz', city: 'Biñan', prov: 'Laguna', region: 'CALABARZON', landmark: 'White house with mango tree' });
  const rCarding = mkCustomer('Ricardo Bautista', '+63 920 555 0204', 'RECEIVER', { line: '45 Rizal St', brgy: 'Brgy 6', city: 'Calapan', prov: 'Oriental Mindoro', region: 'MIMAROPA', landmark: 'Across the elementary school' });
  const rTess = mkCustomer('Teresita Gomez', '+63 921 555 0205', 'RECEIVER', { line: '19 Mabini St', brgy: 'Brgy Lahug', city: 'Cebu City', prov: 'Cebu', region: 'VISAYAS', landmark: 'Gate with bougainvillea' });
  const rDodong = mkCustomer('Dodong Uy', '+63 922 555 0206', 'RECEIVER', { line: 'Km 7 Diversion Rd', brgy: 'Brgy Buhangin', city: 'Davao City', prov: 'Davao del Sur', region: 'MINDANAO', landmark: 'Yellow sari-sari store in front' });

  const receivers = [rLorna, rBong, rNene, rCarding, rTess, rDodong];

  // ---------- containers ----------
  const cStripped = {
    id: nid('container'), container_number: 'MSCU1234567', size: 'C40',
    shipping_line: 'MSC', vessel_name: 'MSC Clara', booking_number: 'BKG-88214',
    origin_port: 'Long Beach, USA', destination_port: 'Manila (MICP)',
    etd: daysAgo(45), eta: daysAgo(14), actual_departure: daysAgo(44), actual_arrival: daysAgo(13),
    load_code: 'C1', load_plan_notes: '',
    status: 'STRIPPED', created_at: daysAgo(60)
  };
  const cTransit = {
    id: nid('container'), container_number: 'TGHU7654321', size: 'C20',
    shipping_line: 'Evergreen', vessel_name: 'Ever Lucid', booking_number: 'BKG-90177',
    origin_port: 'Oakland, USA', destination_port: 'Manila (MICP)',
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
    trucking_company: 'VFIC own truck', region: 'CALABARZON', scheduled_date: daysAhead(1),
    status: 'PLANNED', created_at: daysAgo(1)
  };
  d.trips.push(tripNcr, tripSouth);

  // ---------- shipments + boxes ----------
  let shipSeq = 0;
  const mkShipment = (sender, opts = {}) => {
    shipSeq += 1;
    d.seq.shipment_number = shipSeq;
    const s = {
      id: nid('shipment'),
      shipment_number: `VF-${YEAR}-${String(shipSeq).padStart(6, '0')}`,
      sender_id: sender.id,
      origin_country: opts.origin || 'USA', origin_agent: opts.agent || 'Los Angeles',
      service_type: opts.service || 'DOOR_TO_DOOR',
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
  const sh2 = mkShipment(sJose, { created: daysAgo(50), fee: 340, agent: 'San Francisco' });
  mkBox(sh2, 1, rBong, 'RECEIVED_WAREHOUSE', { age: 50, container_id: cStripped.id });
  mkBox(sh2, 2, rBong, 'RECEIVED_WAREHOUSE', { age: 50, container_id: cStripped.id, size: 'JUMBO', weight: 55 });
  mkBox(sh2, 3, rTess, 'SORTED', { age: 50, container_id: cStripped.id });

  // Shipment 3: Ana (Dubai) → Nene, 2 boxes ASSIGNED to CALABARZON trip; 1 box SORTED
  const sh3 = mkShipment(sAna, { created: daysAgo(48), origin: 'UAE', agent: 'Dubai', fee: 900, currency: 'AED' });
  mkBox(sh3, 1, rNene, 'ASSIGNED', { age: 48, container_id: cStripped.id, trip_id: tripSouth.id });
  mkBox(sh3, 2, rNene, 'ASSIGNED', { age: 48, container_id: cStripped.id, trip_id: tripSouth.id, instructions: 'Call alternate number first' });
  mkBox(sh3, 3, rNene, 'SORTED', { age: 48, container_id: cStripped.id });

  // Shipment 4: Pedro (Italy) → Lorna, 2 boxes OUT_FOR_DELIVERY on NCR trip; shipment still UNPAID
  const sh4 = mkShipment(sPedro, { created: daysAgo(47), origin: 'Italy', agent: 'Milan', fee: 300, currency: 'EUR', paid: false });
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
  const sh6 = mkShipment(sJose, { created: daysAgo(20), fee: 480, agent: 'San Francisco' });
  for (let i = 1; i <= 4; i++) mkBox(sh6, i, receivers[i % receivers.length], 'IN_TRANSIT', { age: 20, container_id: cTransit.id });
  const sh7 = mkShipment(sMaria, { created: daysAgo(19), fee: 600 });
  for (let i = 1; i <= 5; i++) mkBox(sh7, i, receivers[(i + 1) % receivers.length], 'IN_TRANSIT', { age: 19, container_id: cTransit.id, size: i % 2 ? 'MEDIUM' : 'LARGE' });
  const sh8 = mkShipment(sAna, { created: daysAgo(18), origin: 'UAE', agent: 'Dubai', fee: 450, currency: 'AED', paid: false });
  for (let i = 1; i <= 3; i++) mkBox(sh8, i, rDodong, 'IN_TRANSIT', { age: 18, container_id: cTransit.id });

  // Shipments 9-10: origin-side pipeline
  const sh9 = mkShipment(sPedro, { created: daysAgo(6), origin: 'Italy', agent: 'Milan', fee: 200, currency: 'EUR' });
  mkBox(sh9, 1, rBong, 'RECEIVED_ORIGIN', { age: 6 });
  mkBox(sh9, 2, rTess, 'RECEIVED_ORIGIN', { age: 6 });
  const sh10 = mkShipment(sMaria, { created: daysAgo(3), fee: 240 });
  mkBox(sh10, 1, rLorna, 'CREATED', { age: 3 });
  mkBox(sh10, 2, rDodong, 'CREATED', { age: 3 });

  // Extra SORTED pool for dispatch demos, across regions
  const sh11 = mkShipment(sJose, { created: daysAgo(40), fee: 960, agent: 'San Francisco' });
  receivers.forEach((r, i) => mkBox(sh11, i + 1, r, 'SORTED', { age: 40, container_id: cStripped.id }));
  const sh12 = mkShipment(sAna, { created: daysAgo(38), origin: 'UAE', agent: 'Dubai', fee: 300, currency: 'AED' });
  mkBox(sh12, 1, rTess, 'SORTED', { age: 38, container_id: cStripped.id });
  mkBox(sh12, 2, rDodong, 'SORTED', { age: 38, container_id: cStripped.id, size: 'JUMBO', weight: 60 });

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
      contact_numbers: '+1 702 555 0119', email: 'elena.marquez@example.com',
      passport_number: 'P1234567A', passport_place_issued: 'DFA Manila',
      passport_date_issued: '2021-03-15', passport_expiry: '2031-03-14',
      address_abroad: '410 Desert Bloom Ave, Las Vegas, NV 89101, USA',
      address_ph: '77 Malakas St, Brgy Pinyahan, Quezon City, Metro Manila'
    },
    origin_country: 'USA', origin_agent: 'Las Vegas', service_type: 'DOOR_TO_DOOR',
    pickup: { date: daysAhead(2).slice(0, 10), time_window: 'AM', address: '410 Desert Bloom Ave, Las Vegas, NV 89101, USA', notes: 'Ring the doorbell twice' },
    total_value_php: 18500, currency: 'USD', payment_status: 'UNPAID',
    passport_file: null,
    boxes: [
      {
        receiver: {
          family_name: 'Marquez', given_name: 'Fernando', middle_name: 'Cruz', suffix: 'N/A',
          contact_number: '09235550299', email: '',
          region: 'National Capital Region (NCR)', city_municipality: 'City of Quezon', barangay: 'Pinyahan',
          street_address: '77 Malakas St', landmark: 'Yellow gate near the chapel',
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

  return d;
}

module.exports = { build };
