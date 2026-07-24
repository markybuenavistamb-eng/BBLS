const express = require('express');
const path = require('path');
const multer = require('multer');
const QRCode = require('qrcode');
const db = require('./lib/db');
const { hashPassword, verifyPassword } = require('./lib/auth');
const SM = require('./lib/statuses');
const notif = require('./lib/notifications');
const storage = require('./lib/storage');
const sess = require('./lib/session');
const BOC = require('./lib/boc');

// Service types where VFIC collects the box from the sender → a pick-up slot is required.
const PICKUP_SERVICES = ['DOOR_TO_DOOR', 'DOOR_TO_PORT', 'DOOR_TO_AIRPORT'];

const PORT = process.env.PORT || 3000;
const app = express();
app.set('trust proxy', true); // behind Vercel's proxy: correct req.protocol/secure + client IP

app.use(express.json());

// Parse cookies (no dependency) for stateless signed-cookie auth.
app.use((req, _res, next) => { req.cookies = sess.parseCookies(req.headers.cookie); next(); });

// Load the DB doc from the store before any API/file handler, and flush after mutations.
// Scoped to /api and /files so static assets (images/css/js) never hit the KV store.
app.use(['/api', '/files'], async (req, res, next) => {
  try { await db.load(); } catch (e) { return res.status(503).json({ error: 'Storage temporarily unavailable' }); }
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    (async () => {
      // Send any freshly-queued SMS in-request — no background worker/cron needed (Hobby-friendly).
      try {
        const d = db.get();
        if (d.notifications && d.notifications.some(n => n.status === 'QUEUED' && n.attempts < 3)) {
          await notif.processOnce();
        }
      } catch (e) { /* never block the response on SMS delivery */ }
      if (db.isDirty()) await db.flush();
    })().then(() => sendJson(body)).catch(() => { if (!res.headersSent) res.status(500); sendJson({ error: 'Failed to save changes' }); });
    return res;
  };
  next();
});

// ---------- auth helpers ----------
const AGENTS = ['ADMIN', 'SHIPPER_AGENT', 'CONSIGNEE_AGENT'];
const PH_SIDE = ['ADMIN', 'CONSIGNEE_AGENT', 'WAREHOUSE'];

// Resolve the signed-cookie session to an active user, or null.
function userFromReq(req) {
  const token = req.cookies && req.cookies[sess.COOKIE_NAME];
  const payload = sess.verify(token);
  if (!payload) return null;
  return db.get().users.find(x => x.id === payload.uid && x.active) || null;
}

function requireAuth(req, res, next) {
  const u = userFromReq(req);
  if (!u) return res.status(401).json({ error: 'Not logged in' });
  req.user = u;
  next();
}
function requireRole(...roles) {
  return (req, res, next) => requireAuth(req, res, () => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Your role does not allow this action' });
    next();
  });
}

// ---------- shared serializers ----------
// Itemized packing list: array of {description, qty}. Drops blank rows.
function sanitizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map(it => ({ description: String((it && it.description) || '').trim(), qty: String((it && it.qty) || '').trim() }))
    .filter(it => it.description);
}
function customerPublic(c) { return c; }
// Build a display name from BOC name parts (Given Middle Family, Suffix).
function personName(p) {
  if (!p) return '';
  const suffix = p.suffix && !/^n\/?a$/i.test(p.suffix) ? p.suffix : '';
  return [p.given_name, p.middle_name, p.family_name].filter(Boolean).join(' ').trim()
    + (suffix ? ` ${suffix}` : '');
}
function boxDetail(box) {
  const d = db.get();
  const shipment = d.shipments.find(s => s.id === box.shipment_id) || null;
  const sender = shipment ? d.customers.find(c => c.id === shipment.sender_id) || null : null;
  const receiver = d.customers.find(c => c.id === box.receiver_id) || null;
  const container = d.containers.find(c => c.id === box.container_id) || null;
  const trip = d.trips.find(t => t.id === box.trucking_assignment_id) || null;
  const events = d.status_events.filter(e => e.box_id === box.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(e => ({ ...e, actor: (d.users.find(u => u.id === e.actor_user_id) || {}).name || 'System' }));
  const attempts = d.delivery_attempts.filter(a => a.box_id === box.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const notifications = d.notifications.filter(n => n.box_id === box.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { ...box, shipment, sender, receiver, container, trip, events, attempts, notifications };
}
function boxRow(box) {
  const d = db.get();
  const shipment = d.shipments.find(s => s.id === box.shipment_id) || {};
  const sender = d.customers.find(c => c.id === shipment.sender_id) || {};
  const receiver = d.customers.find(c => c.id === box.receiver_id) || {};
  return {
    ...box,
    sender_name: sender.full_name || '', receiver_name: receiver.full_name || '',
    receiver_city: receiver.city_municipality || '', receiver_region: receiver.region || null,
    receiver_phone: receiver.phone_primary || ''
  };
}

// Central validated transition. Writes StatusEvent, fires notifications on trigger statuses.
// Returns error string or null.
function changeBoxStatus(box, to, actor, note = '', extraVars = {}) {
  if (!SM.BOX_STATUSES.includes(to)) return 'Invalid status';
  if (!SM.canTransition(box.status, to, actor ? actor.role : null)) {
    return `Invalid transition ${box.status} → ${to}` + (to === 'CANCELLED' ? ' (admin only, pre-delivery only)' : '');
  }
  const d = db.get();
  const nowIso = new Date().toISOString();
  d.status_events.push({
    id: db.nextId('status_event'), box_id: box.id,
    from_status: box.status, to_status: to,
    actor_user_id: actor ? actor.id : null, note: note || '', created_at: nowIso
  });
  box.status = to;
  box.status_updated_at = nowIso;
  if (['RECEIVED_ORIGIN', 'ARRIVED_PORT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED'].includes(to)) {
    notif.queueForTrigger(box, to, extraVars);
  }
  return null;
}

// ---------- auth routes ----------
app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.get().users.find(x => x.email.toLowerCase() === String(email || '').toLowerCase() && x.active);
  if (!u || !verifyPassword(password || '', u.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
  res.cookie(sess.COOKIE_NAME, sess.tokenFor(u.id), sess.cookieOptions);
  res.json({ id: u.id, name: u.name, email: u.email, role: u.role });
});
app.post('/api/logout', (req, res) => { res.clearCookie(sess.COOKIE_NAME, { path: '/' }); res.json({ ok: true }); });
app.get('/api/me', requireAuth, (req, res) => {
  const { id, name, email, role } = req.user;
  res.json({ id, name, email, role });
});

// ---------- file uploads (in-memory → storage adapter: Vercel Blob or local disk) ----------
const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const podUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const intakeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } });

// Shipment documents (packing list / passport / receiving form) — agents + admin only
app.post('/api/upload', requireRole(...AGENTS), docUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  const key = await storage.save(req.file.buffer, req.file.originalname, 'docs');
  res.json({ url: '/files/' + key, name: req.file.originalname });
});

// Authenticated file proxy. Keys are never public; role required depends on the folder:
//   pod/*    → any staff (POD photos)
//   docs/*   → agents + admin (packing lists, passports, receiving forms)
//   intake/* → agents + admin (sender-submitted passport/ID scans)
app.get('/files/*', async (req, res) => {
  const user = userFromReq(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  const key = req.params[0] || '';
  const restricted = key.startsWith('docs/') || key.startsWith('intake/');
  if (restricted && !AGENTS.includes(user.role)) return res.status(403).json({ error: 'Not permitted' });
  const file = await storage.read(key);
  if (!file) return res.status(404).json({ error: 'Not found' });
  res.type(file.contentType).send(file.buffer);
});

// ---------- customers ----------
app.get('/api/customers', requireAuth, (req, res) => {
  const d = db.get();
  let list = d.customers.slice();
  const q = String(req.query.q || '').toLowerCase();
  if (q) list = list.filter(c => [c.full_name, c.phone_primary, c.phone_alternate, c.city_municipality].some(v => v && String(v).toLowerCase().includes(q)));
  if (req.query.type) list = list.filter(c => c.type === req.query.type || c.type === 'BOTH');
  res.json(list.map(customerPublic));
});
app.get('/api/customers/:id', requireAuth, (req, res) => {
  const d = db.get();
  const c = d.customers.find(x => x.id === +req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const asSenderShipments = d.shipments.filter(s => s.sender_id === c.id);
  const asReceiverBoxes = d.boxes.filter(b => b.receiver_id === c.id).map(boxRow);
  const sentBoxes = d.boxes.filter(b => asSenderShipments.some(s => s.id === b.shipment_id)).map(boxRow);
  res.json({ ...c, shipments: asSenderShipments, sent_boxes: sentBoxes, received_boxes: asReceiverBoxes });
});
app.post('/api/customers', requireRole(...AGENTS), (req, res) => {
  const d = db.get();
  const b = req.body || {};
  if (!b.full_name) return res.status(400).json({ error: 'Full name is required' });
  if (b.region && !SM.REGIONS.includes(b.region)) return res.status(400).json({ error: 'Invalid region' });
  // dedupe suggestion by phone
  const dup = b.phone_primary && d.customers.find(c => c.phone_primary === b.phone_primary);
  if (dup && !b.force) return res.status(409).json({ error: 'duplicate_phone', existing: customerPublic(dup) });
  const c = {
    id: db.nextId('customer'), full_name: b.full_name,
    phone_primary: b.phone_primary || '', phone_alternate: b.phone_alternate || '', phone_history: [],
    email: b.email || '',
    address_line: b.address_line || '', barangay: b.barangay || '', city_municipality: b.city_municipality || '',
    province: b.province || '', region: b.region || null, country: b.country || 'Philippines', postal_code: b.postal_code || '',
    landmark: b.landmark || '', notes: b.notes || '',
    type: ['SENDER', 'RECEIVER', 'BOTH'].includes(b.type) ? b.type : 'RECEIVER',
    created_at: new Date().toISOString()
  };
  d.customers.push(c);
  db.persist();
  res.json(c);
});
app.put('/api/customers/:id', requireRole(...AGENTS), (req, res) => {
  const c = db.get().customers.find(x => x.id === +req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (b.region && !SM.REGIONS.includes(b.region)) return res.status(400).json({ error: 'Invalid region' });
  // phone edits are logged (addresses the "unreachable number" pain)
  for (const key of ['phone_primary', 'phone_alternate']) {
    if (key in b && b[key] !== c[key]) {
      c.phone_history = c.phone_history || [];
      c.phone_history.push({ field: key, from: c[key], to: b[key], changed_by: req.user.name, changed_at: new Date().toISOString() });
    }
  }
  for (const k of ['full_name', 'phone_primary', 'phone_alternate', 'email', 'address_line', 'barangay', 'city_municipality', 'province', 'region', 'country', 'postal_code', 'landmark', 'notes', 'type']) {
    if (k in b) c[k] = b[k];
  }
  db.persist();
  res.json(c);
});

// ---------- shipments ----------
app.get('/api/shipments', requireAuth, (req, res) => {
  const d = db.get();
  let list = d.shipments.slice();
  const q = String(req.query.q || '').toLowerCase();
  if (q) list = list.filter(s => {
    const sender = d.customers.find(c => c.id === s.sender_id) || {};
    return [s.shipment_number, sender.full_name, sender.phone_primary].some(v => v && String(v).toLowerCase().includes(q));
  });
  if (req.query.payment_status) list = list.filter(s => s.payment_status === req.query.payment_status);
  list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json(list.map(s => ({
    ...s,
    sender_name: (d.customers.find(c => c.id === s.sender_id) || {}).full_name || '',
    box_count: d.boxes.filter(b => b.shipment_id === s.id).length
  })));
});
app.get('/api/shipments/:id', requireAuth, (req, res) => {
  const d = db.get();
  const s = d.shipments.find(x => x.id === +req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json({
    ...s,
    sender: d.customers.find(c => c.id === s.sender_id) || null,
    boxes: d.boxes.filter(b => b.shipment_id === s.id).map(b => ({
      ...boxRow(b),
      receiver: d.customers.find(c => c.id === b.receiver_id) || null
    }))
  });
});
// Intake: sender + 1..n boxes (each with its own receiver)
app.post('/api/shipments', requireRole('ADMIN', 'SHIPPER_AGENT'), (req, res) => {
  const d = db.get();
  const b = req.body || {};
  const sender = d.customers.find(c => c.id === +b.sender_id);
  if (!sender) return res.status(400).json({ error: 'Valid sender is required' });
  if (!Array.isArray(b.boxes) || !b.boxes.length) return res.status(400).json({ error: 'At least one box is required' });
  if (!b.passport_file) return res.status(400).json({ error: 'A scanned/soft copy of the sender\'s passport or government ID is required' });
  if (b.service_type && !SM.SERVICE_TYPES.includes(b.service_type)) return res.status(400).json({ error: 'Invalid service type' });
  for (const bx of b.boxes) {
    if (!d.customers.find(c => c.id === +bx.receiver_id)) return res.status(400).json({ error: 'Every box needs a valid receiver' });
    if (bx.size_category && !SM.SIZE_CATEGORIES.includes(bx.size_category)) return res.status(400).json({ error: 'Invalid size category' });
  }
  const nowIso = new Date().toISOString();
  const shipment = {
    id: db.nextId('shipment'),
    shipment_number: db.nextShipmentNumber(),
    sender_id: sender.id,
    origin_country: b.origin_country || '', origin_agent: b.origin_agent || '',
    service_type: b.service_type || 'DOOR_TO_DOOR',
    receiving_form_file: b.receiving_form_file || null,
    packing_list_file: b.packing_list_file || null,
    passport_file: b.passport_file || null,
    shipping_fee_amount: b.shipping_fee_amount != null ? +b.shipping_fee_amount : null,
    currency: b.currency || 'USD',
    payment_status: b.payment_status === 'PAID' ? 'PAID' : 'UNPAID',
    // BOC Form BB-IS-001 data carried over from the online booking (availment/sender type,
    // name parts, passport, addresses, pick-up). Drives the printed Information Sheet.
    boc: b.boc || null,
    mbl_mawb_number: b.mbl_mawb_number || '',
    created_by: req.user.id, created_at: nowIso
  };
  d.shipments.push(shipment);
  const boxes = b.boxes.map((bx, i) => {
    const box = {
      id: db.nextId('box'),
      box_number: `${shipment.shipment_number}-${String(i + 1).padStart(2, '0')}`,
      qr_token: db.newQrToken(),
      shipment_id: shipment.id,
      receiver_id: +bx.receiver_id,
      size_category: bx.size_category || 'LARGE',
      length_cm: bx.length_cm ? +bx.length_cm : null, width_cm: bx.width_cm ? +bx.width_cm : null, height_cm: bx.height_cm ? +bx.height_cm : null,
      weight_kg: bx.weight_kg ? +bx.weight_kg : null,
      declared_contents: bx.declared_contents || '', special_instructions: bx.special_instructions || '',
      packing_list_items: sanitizeItems(bx.packing_list_items),
      // Per-box BOC data: recipient name parts, relationship, PH address, itemized goods.
      boc: bx.boc || null,
      total_value_php: bx.total_value_php != null ? +bx.total_value_php : null,
      region: null, status: 'CREATED', status_updated_at: nowIso,
      container_id: null, trucking_assignment_id: null,
      created_at: nowIso
    };
    d.boxes.push(box);
    d.status_events.push({ id: db.nextId('status_event'), box_id: box.id, from_status: null, to_status: 'CREATED', actor_user_id: req.user.id, note: 'Shipment intake', created_at: nowIso });
    return box;
  });
  db.persist();
  res.json({ ...shipment, boxes: boxes.map(boxRow) });
});
app.put('/api/shipments/:id', requireRole('ADMIN', 'SHIPPER_AGENT'), (req, res) => {
  const s = db.get().shipments.find(x => x.id === +req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (b.payment_status && !['PAID', 'UNPAID'].includes(b.payment_status)) return res.status(400).json({ error: 'Invalid payment status' });
  for (const k of ['origin_country', 'origin_agent', 'service_type', 'receiving_form_file', 'packing_list_file', 'passport_file', 'shipping_fee_amount', 'currency', 'payment_status']) {
    if (k in b) s[k] = b[k];
  }
  db.persist();
  res.json(s);
});
// Confirm physical receipt at origin: all CREATED boxes → RECEIVED_ORIGIN (SMS to sender)
app.post('/api/shipments/:id/receive', requireRole('ADMIN', 'SHIPPER_AGENT'), (req, res) => {
  const d = db.get();
  const s = d.shipments.find(x => x.id === +req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const boxes = d.boxes.filter(b => b.shipment_id === s.id && b.status === 'CREATED');
  for (const box of boxes) changeBoxStatus(box, 'RECEIVED_ORIGIN', req.user, 'Physical receipt confirmed at origin');
  db.persist();
  res.json({ ok: true, received: boxes.length });
});

// ---------- online intake requests (public self-service fill-up, reviewed & encoded by staff) ----------
// Public submission: no login. Sender fills their own info + box(es) + uploads a passport/ID scan.
// This does NOT create a shipment/customer directly — an agent reviews it and encodes it via
// New Shipment Intake, which pre-fills from the request and marks it CONVERTED.
app.post('/api/public/intake-requests', rateLimit, intakeUpload.single('passport_file'), async (req, res) => {
  const b = req.body || {};
  const bad = (msg) => res.status(400).json({ error: msg });
  const need = (v, label) => { if (!String(v || '').trim()) throw new Error(`${label} is required`); return String(v).trim(); };

  try {
    // --- BOC classification ---
    const availment = need(b.availment_type, 'Type of Availment');
    if (!BOC.AVAILMENT_TYPES.some(a => a.key === availment)) return bad('Invalid Type of Availment');
    const senderType = need(b.sender_type, 'Type of Sender');
    if (!BOC.SENDER_TYPES.some(s => s.key === senderType)) return bad('Invalid Type of Sender');

    // --- A. Sender information (all required; email optional per the BOC form) ---
    const sender = {
      business_name: String(b.business_name || '').trim(),
      family_name: need(b.sender_family_name, 'Sender Family Name'),
      given_name: need(b.sender_given_name, 'Sender Given Name'),
      middle_name: need(b.sender_middle_name, 'Sender Middle Name'),
      suffix: need(b.sender_suffix, 'Sender Suffix'),
      contact_numbers: need(b.sender_contact_numbers, 'Sender Contact Number/s'),
      email: String(b.sender_email || '').trim(),
      address_abroad: need(b.address_abroad, 'Complete Current Address Abroad'),
      address_ph: need(b.address_ph, 'Complete Address in the Philippines'),
      passport_number: '', passport_place_issued: '', passport_date_issued: '', passport_expiry: ''
    };
    if (BOC.isQFWA(senderType)) { // passport block is "For QFWAs Only" on the form
      sender.passport_number = need(b.passport_number, 'Philippine Passport Number');
      sender.passport_place_issued = need(b.passport_place_issued, 'Passport Place Issued');
      sender.passport_date_issued = need(b.passport_date_issued, 'Passport Date Issued');
      sender.passport_expiry = need(b.passport_expiry, 'Passport Expiry Date');
    }
    if (['NQFWA_SOLE_PROP', 'NQFWA_PARTNERSHIP', 'NQFWA_CORPORATION'].includes(senderType)) {
      sender.business_name = need(b.business_name, 'Business Name');
    }

    const service_type = SM.SERVICE_TYPES.includes(b.service_type) ? b.service_type : 'DOOR_TO_DOOR';
    const origin_agent = need(b.origin_agent, 'Sending From');
    const origin_country = need(b.origin_country, 'Country');
    const total_value_php = need(b.total_value_php, 'Total Value for this Shipment');

    // --- Pick-up scheduling (only for services where VFIC collects the box) ---
    let pickup = null;
    if (PICKUP_SERVICES.includes(service_type)) {
      let p = {};
      try { p = JSON.parse(b.pickup || '{}') || {}; } catch (e) { return bad('Invalid pick-up data'); }
      pickup = {
        date: need(p.date, 'Pick-up date'),
        time_window: ['AM', 'PM'].includes(p.time_window) ? p.time_window : 'AM',
        address: need(p.address || sender.address_abroad, 'Pick-up address'),
        notes: String(p.notes || '').trim()
      };
    }

    if (!req.file) return bad('A scanned/soft copy of your passport or government ID is required');

    // --- B + C: recipient and itemized goods, per box ---
    let boxesIn;
    try { boxesIn = JSON.parse(b.boxes || '[]'); } catch (e) { return bad('Invalid box data'); }
    if (!Array.isArray(boxesIn) || !boxesIn.length) return bad('At least one box is required');

    const boxes = boxesIn.map((bx, i) => {
      const n = i + 1;
      const r = bx.receiver || {};
      const rq = (v, label) => { if (!String(v || '').trim()) throw new Error(`Box ${n}: ${label} is required`); return String(v).trim(); };
      const phone = BOC.normalizePhMobile(r.contact_number);
      if (!BOC.isValidPhMobile(phone)) throw new Error(`Box ${n}: receiver contact number must be 11 digits starting with 09`);
      if (!BOC.RELATIONSHIPS.includes(r.relationship)) throw new Error(`Box ${n}: a valid Relationship to Sender is required`);
      const goods = Array.isArray(bx.goods)
        ? bx.goods.filter(g => g && BOC.GOODS_CATEGORIES.includes(g.category) && +g.qty > 0)
          .map(g => ({ category: g.category, qty: +g.qty }))
        : [];
      if (!goods.length) throw new Error(`Box ${n}: at least one itemized good is required`);
      return {
        receiver: {
          family_name: rq(r.family_name, 'Receiver Family Name'),
          given_name: rq(r.given_name, 'Receiver Given Name'),
          middle_name: rq(r.middle_name, 'Receiver Middle Name'),
          suffix: rq(r.suffix, 'Receiver Suffix'),
          contact_number: phone,
          email: String(r.email || '').trim(),
          region: rq(r.region, 'Region'),
          city_municipality: rq(r.city_municipality, 'City / Municipality'),
          barangay: rq(r.barangay, 'Barangay'),
          street_address: rq(r.street_address, 'House No. / Street'),
          landmark: rq(r.landmark, 'Landmark'),
          relationship: r.relationship,
          country: 'Philippines'
        },
        size_category: SM.SIZE_CATEGORIES.includes(bx.size_category) ? bx.size_category : 'LARGE',
        weight_kg: +rq(bx.weight_kg, 'Weight') || 0,
        total_value_php: +rq(bx.total_value_php, 'Total Value of Contents') || 0,
        special_instructions: String(bx.special_instructions || '').trim(),
        goods
      };
    });

    const passportKey = await storage.save(req.file.buffer, req.file.originalname, 'intake');
    const d = db.get();
    const rec = {
      id: db.nextId('intake_request'),
      reference_code: db.nextIntakeRefCode(),
      status: 'PENDING',
      submitted_at: new Date().toISOString(),
      converted_shipment_id: null,
      availment_type: availment,
      sender_type: senderType,
      sender,
      origin_country, origin_agent, service_type,
      pickup,
      total_value_php: +total_value_php || 0,
      currency: b.currency || 'USD',
      payment_status: b.payment_status === 'PAID' ? 'PAID' : 'UNPAID',
      passport_file: '/files/' + passportKey,
      boxes
    };
    d.intake_requests.push(rec);
    db.persist();
    res.json({ reference_code: rec.reference_code, submitted_at: rec.submitted_at });
  } catch (e) {
    return bad(e.message || 'Invalid submission');
  }
});
// Staff review queue
app.get('/api/intake-requests', requireRole(...AGENTS), (req, res) => {
  const d = db.get();
  let list = d.intake_requests.slice();
  if (req.query.status) list = list.filter(r => r.status === req.query.status);
  list.sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  res.json(list.map(r => ({
    id: r.id, reference_code: r.reference_code, status: r.status, submitted_at: r.submitted_at,
    sender_name: personName(r.sender), sender_phone: (r.sender || {}).contact_numbers || '',
    box_count: r.boxes.length
  })));
});
app.get('/api/intake-requests/:id', requireRole(...AGENTS), (req, res) => {
  const r = db.get().intake_requests.find(x => x.id === +req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});
app.put('/api/intake-requests/:id', requireRole(...AGENTS), (req, res) => {
  const r = db.get().intake_requests.find(x => x.id === +req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const { status, shipment_id } = req.body || {};
  if (!['CONVERTED', 'DISMISSED'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  r.status = status;
  if (status === 'CONVERTED') r.converted_shipment_id = shipment_id || null;
  db.persist();
  res.json(r);
});

// ---------- boxes ----------
app.get('/api/boxes', requireAuth, (req, res) => {
  const d = db.get();
  let list = d.boxes.slice();
  const { q, status, region, container_id, trip_id } = req.query;
  if (status) list = list.filter(b => b.status === status);
  if (region) list = list.filter(b => b.region === region || (d.customers.find(c => c.id === b.receiver_id) || {}).region === region);
  if (container_id) list = list.filter(b => b.container_id === +container_id);
  if (trip_id) list = list.filter(b => b.trucking_assignment_id === +trip_id);
  if (q) {
    const needle = String(q).toLowerCase();
    list = list.filter(b => {
      const r = boxRow(b);
      return [b.box_number, r.sender_name, r.receiver_name, r.receiver_phone].some(v => v && String(v).toLowerCase().includes(needle));
    });
  }
  list.sort((a, b) => (b.status_updated_at || b.created_at).localeCompare(a.status_updated_at || a.created_at));
  res.json(list.map(boxRow));
});
app.get('/api/boxes/:id', requireAuth, (req, res) => {
  const box = db.get().boxes.find(b => b.id === +req.params.id);
  if (!box) return res.status(404).json({ error: 'Not found' });
  res.json(boxDetail(box));
});
// Staff lookup by box number OR qr token (scan screens)
app.get('/api/boxes/lookup/:key', requireAuth, (req, res) => {
  const d = db.get();
  const key = String(req.params.key).trim();
  // QR labels encode the public tracking URL; accept a pasted URL too
  const tokenMatch = key.match(/[?&]t=([A-Za-z0-9_-]+)/);
  const needle = (tokenMatch ? tokenMatch[1] : key).toLowerCase();
  const box = d.boxes.find(b => b.qr_token.toLowerCase() === needle || b.box_number.toLowerCase() === needle);
  if (!box) return res.status(404).json({ error: 'No box matches that code' });
  res.json(boxDetail(box));
});
app.put('/api/boxes/:id', requireRole(...AGENTS), (req, res) => {
  const box = db.get().boxes.find(b => b.id === +req.params.id);
  if (!box) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (b.size_category && !SM.SIZE_CATEGORIES.includes(b.size_category)) return res.status(400).json({ error: 'Invalid size' });
  if (b.region && !SM.REGIONS.includes(b.region)) return res.status(400).json({ error: 'Invalid region' });
  for (const k of ['size_category', 'length_cm', 'width_cm', 'height_cm', 'weight_kg', 'declared_contents', 'special_instructions', 'region', 'receiver_id']) {
    if (k in b) box[k] = b[k];
  }
  if ('packing_list_items' in b) box.packing_list_items = sanitizeItems(b.packing_list_items);
  db.persist();
  res.json(boxDetail(box));
});
// Manual validated status change (also used by scan screens)
app.post('/api/boxes/:id/status', requireAuth, (req, res) => {
  const d = db.get();
  const box = d.boxes.find(b => b.id === +req.params.id);
  if (!box) return res.status(404).json({ error: 'Not found' });
  const { status, note, region } = req.body || {};
  // Warehouse staff can only do warehouse statuses
  if (req.user.role === 'WAREHOUSE' && !['RECEIVED_WAREHOUSE', 'SORTED'].includes(status)) {
    return res.status(403).json({ error: 'Warehouse role can only mark Received/Sorted' });
  }
  if (status === 'CANCELLED' && !note) return res.status(400).json({ error: 'Cancellation requires a reason' });
  if (status === 'SORTED') {
    const rgn = region || (d.customers.find(c => c.id === box.receiver_id) || {}).region;
    if (!rgn || !SM.REGIONS.includes(rgn)) return res.status(400).json({ error: 'Sorting requires a destination region' });
    box.region = rgn;
  }
  if (status === 'DELIVERED') return res.status(400).json({ error: 'Use the delivery-attempt flow (POD photos required)' });
  const err = changeBoxStatus(box, status, req.user, note || '');
  if (err) return res.status(400).json({ error: err });
  if (box.status === 'RECEIVED_ORIGIN' && box.container_id) box.container_id = null; // unloaded from container
  db.persist();
  res.json(boxDetail(box));
});

// ---------- containers ----------
app.get('/api/containers', requireAuth, (req, res) => {
  const d = db.get();
  res.json(d.containers
    .slice().sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(c => ({ ...c, box_count: d.boxes.filter(b => b.container_id === c.id).length })));
});
app.post('/api/containers', requireRole('ADMIN', 'SHIPPER_AGENT'), (req, res) => {
  const b = req.body || {};
  if (!b.container_number) return res.status(400).json({ error: 'Container number is required' });
  const c = {
    id: db.nextId('container'), container_number: b.container_number,
    size: b.size === 'C20' ? 'C20' : 'C40',
    shipping_line: b.shipping_line || '', vessel_name: b.vessel_name || '', booking_number: b.booking_number || '',
    origin_port: b.origin_port || '', destination_port: b.destination_port || '',
    etd: b.etd || null, eta: b.eta || null, actual_departure: null, actual_arrival: null,
    status: 'BOOKING', created_at: new Date().toISOString()
  };
  db.get().containers.push(c);
  db.persist();
  res.json(c);
});
app.get('/api/containers/:id', requireAuth, (req, res) => {
  const d = db.get();
  const c = d.containers.find(x => x.id === +req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const boxes = d.boxes.filter(b => b.container_id === c.id).map(boxRow);
  // manifest documents bundle (arrival notice view)
  const shipmentIds = [...new Set(boxes.map(b => b.shipment_id))];
  const documents = d.shipments.filter(s => shipmentIds.includes(s.id)).map(s => ({
    shipment_number: s.shipment_number,
    sender_name: (d.customers.find(x => x.id === s.sender_id) || {}).full_name || '',
    packing_list_file: s.packing_list_file, passport_file: s.passport_file, receiving_form_file: s.receiving_form_file
  }));
  const capacity = c.size === 'C20' ? '150–180' : '250–280';
  // discrepancies: manifest (LOADED on this container) vs scanned at warehouse
  const notScanned = boxes.filter(b => ['LOADED_CONTAINER', 'IN_TRANSIT', 'ARRIVED_PORT'].includes(b.status));
  res.json({ ...c, boxes, documents, typical_capacity: capacity, pending_strip: notScanned.map(b => b.box_number) });
});
app.put('/api/containers/:id', requireRole('ADMIN', 'SHIPPER_AGENT', 'CONSIGNEE_AGENT'), (req, res) => {
  const c = db.get().containers.find(x => x.id === +req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (b.status && !SM.CONTAINER_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid container status' });
  for (const k of ['container_number', 'size', 'shipping_line', 'vessel_name', 'booking_number', 'origin_port', 'destination_port', 'etd', 'eta', 'status']) {
    if (k in b) c[k] = b[k];
  }
  db.persist();
  res.json(c);
});
// Load a box (by scan/search) into a container: RECEIVED_ORIGIN → LOADED_CONTAINER
app.post('/api/containers/:id/load', requireRole('ADMIN', 'SHIPPER_AGENT'), (req, res) => {
  const d = db.get();
  const c = d.containers.find(x => x.id === +req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const box = d.boxes.find(b => b.id === +req.body.box_id);
  if (!box) return res.status(404).json({ error: 'Box not found' });
  if (box.container_id && box.container_id !== c.id) return res.status(400).json({ error: 'Box is already on another container' });
  const err = changeBoxStatus(box, 'LOADED_CONTAINER', req.user, `Loaded into ${c.container_number}`);
  if (err) return res.status(400).json({ error: err });
  box.container_id = c.id;
  if (c.status === 'BOOKING') c.status = 'LOADING';
  db.persist();
  res.json({ box: boxRow(box), box_count: d.boxes.filter(b => b.container_id === c.id).length });
});
// Depart: container + all boxes → IN_TRANSIT
app.post('/api/containers/:id/depart', requireRole('ADMIN', 'SHIPPER_AGENT'), (req, res) => {
  const d = db.get();
  const c = d.containers.find(x => x.id === +req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const boxes = d.boxes.filter(b => b.container_id === c.id && b.status === 'LOADED_CONTAINER');
  for (const box of boxes) changeBoxStatus(box, 'IN_TRANSIT', req.user, `Container ${c.container_number} departed`);
  c.status = 'IN_TRANSIT';
  c.actual_departure = new Date().toISOString();
  db.persist();
  res.json({ ok: true, boxes_updated: boxes.length });
});
// Arrive: container + all boxes → ARRIVED_PORT (SMS to receivers)
app.post('/api/containers/:id/arrive', requireRole('ADMIN', 'SHIPPER_AGENT', 'CONSIGNEE_AGENT'), (req, res) => {
  const d = db.get();
  const c = d.containers.find(x => x.id === +req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const boxes = d.boxes.filter(b => b.container_id === c.id && b.status === 'IN_TRANSIT');
  for (const box of boxes) changeBoxStatus(box, 'ARRIVED_PORT', req.user, `Container ${c.container_number} arrived at ${c.destination_port}`);
  c.status = 'ARRIVED';
  c.actual_arrival = new Date().toISOString();
  db.persist();
  res.json({ ok: true, boxes_updated: boxes.length });
});
// Warehouse stripping scan: each box → RECEIVED_WAREHOUSE
app.post('/api/containers/:id/strip-scan', requireRole(...PH_SIDE), (req, res) => {
  const d = db.get();
  const c = d.containers.find(x => x.id === +req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const box = d.boxes.find(b => b.id === +req.body.box_id);
  if (!box) return res.status(404).json({ error: 'Box not found' });
  const offManifest = box.container_id !== c.id;
  const err = changeBoxStatus(box, 'RECEIVED_WAREHOUSE', req.user, offManifest ? `Stripped from ${c.container_number} (NOT on manifest)` : `Stripped from ${c.container_number}`);
  if (err) return res.status(400).json({ error: err });
  if (offManifest) box.container_id = c.id;
  const remaining = d.boxes.filter(b => b.container_id === c.id && b.status === 'ARRIVED_PORT').length;
  if (!remaining && ['ARRIVED', 'AT_CUSTOMS', 'RELEASED'].includes(c.status)) c.status = 'STRIPPED';
  db.persist();
  res.json({ box: boxRow(box), off_manifest: offManifest, remaining });
});

// ---------- trucking trips ----------
app.get('/api/trips', requireAuth, (req, res) => {
  const d = db.get();
  res.json(d.trips.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(t => ({ ...t, box_count: d.boxes.filter(b => b.trucking_assignment_id === t.id).length })));
});
app.post('/api/trips', requireRole('ADMIN', 'CONSIGNEE_AGENT'), (req, res) => {
  const b = req.body || {};
  if (!b.driver_name || !b.region) return res.status(400).json({ error: 'Driver name and region are required' });
  if (!SM.REGIONS.includes(b.region)) return res.status(400).json({ error: 'Invalid region' });
  const d = db.get();
  const t = {
    id: db.nextId('trip'),
    trip_number: `TRIP-${new Date().getFullYear()}-${String(db.nextId('trip_number')).padStart(4, '0')}`,
    driver_name: b.driver_name, driver_contact: b.driver_contact || '', plate_number: b.plate_number || '',
    trucking_company: b.trucking_company || '', region: b.region, scheduled_date: b.scheduled_date || null,
    status: 'PLANNED', created_at: new Date().toISOString()
  };
  d.trips.push(t);
  db.persist();
  res.json(t);
});
app.get('/api/trips/:id', requireAuth, (req, res) => {
  const d = db.get();
  const t = d.trips.find(x => x.id === +req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const boxes = d.boxes.filter(b => b.trucking_assignment_id === t.id).map(b => {
    const row = boxRow(b);
    const receiver = d.customers.find(c => c.id === b.receiver_id) || {};
    const attempts = d.delivery_attempts.filter(a => a.box_id === b.id && a.trucking_assignment_id === t.id);
    return { ...row, receiver, attempts };
  });
  res.json({ ...t, boxes });
});
app.put('/api/trips/:id', requireRole('ADMIN', 'CONSIGNEE_AGENT'), (req, res) => {
  const t = db.get().trips.find(x => x.id === +req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (b.status && !SM.TRIP_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid trip status' });
  for (const k of ['driver_name', 'driver_contact', 'plate_number', 'trucking_company', 'region', 'scheduled_date', 'status']) {
    if (k in b) t[k] = b[k];
  }
  db.persist();
  res.json(t);
});
// Assign SORTED or RETURNED boxes → ASSIGNED (this is the one-click re-dispatch too)
app.post('/api/trips/:id/assign-boxes', requireRole('ADMIN', 'CONSIGNEE_AGENT'), (req, res) => {
  const d = db.get();
  const t = d.trips.find(x => x.id === +req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const ids = (req.body.box_ids || []).map(Number);
  const results = [];
  for (const id of ids) {
    const box = d.boxes.find(b => b.id === id);
    if (!box) { results.push({ id, error: 'not found' }); continue; }
    const err = changeBoxStatus(box, 'ASSIGNED', req.user, `Assigned to trip ${t.trip_number} (${t.driver_name})`);
    if (err) { results.push({ id, box_number: box.box_number, error: err }); continue; }
    box.trucking_assignment_id = t.id;
    results.push({ id, box_number: box.box_number, ok: true });
  }
  db.persist();
  res.json({ results, assigned: results.filter(r => r.ok).length });
});
app.post('/api/trips/:id/remove-box', requireRole('ADMIN', 'CONSIGNEE_AGENT'), (req, res) => {
  const d = db.get();
  const t = d.trips.find(x => x.id === +req.params.id);
  const box = d.boxes.find(b => b.id === +req.body.box_id);
  if (!t || !box) return res.status(404).json({ error: 'Not found' });
  const err = changeBoxStatus(box, 'SORTED', req.user, `Removed from trip ${t.trip_number}`);
  if (err) return res.status(400).json({ error: err });
  box.trucking_assignment_id = null;
  db.persist();
  res.json({ ok: true });
});
// Load-out scan: ASSIGNED → LOADED_TRUCK
app.post('/api/trips/:id/load-scan', requireRole(...PH_SIDE), (req, res) => {
  const d = db.get();
  const t = d.trips.find(x => x.id === +req.params.id);
  const box = d.boxes.find(b => b.id === +req.body.box_id);
  if (!t || !box) return res.status(404).json({ error: 'Not found' });
  if (box.trucking_assignment_id !== t.id) return res.status(400).json({ error: `Box ${box.box_number} is not assigned to this trip` });
  const err = changeBoxStatus(box, 'LOADED_TRUCK', req.user, `Loaded on ${t.plate_number || 'truck'}`);
  if (err) return res.status(400).json({ error: err });
  if (t.status === 'PLANNED') t.status = 'LOADING';
  db.persist();
  const remaining = d.boxes.filter(b => b.trucking_assignment_id === t.id && b.status === 'ASSIGNED').length;
  res.json({ box: boxRow(box), remaining });
});
// Dispatch: all LOADED_TRUCK boxes → OUT_FOR_DELIVERY (SMS to receivers)
app.post('/api/trips/:id/dispatch', requireRole('ADMIN', 'CONSIGNEE_AGENT'), (req, res) => {
  const d = db.get();
  const t = d.trips.find(x => x.id === +req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const boxes = d.boxes.filter(b => b.trucking_assignment_id === t.id && b.status === 'LOADED_TRUCK');
  if (!boxes.length) return res.status(400).json({ error: 'No loaded boxes to dispatch (load-out scan first)' });
  for (const box of boxes) changeBoxStatus(box, 'OUT_FOR_DELIVERY', req.user, `Trip ${t.trip_number} dispatched`);
  t.status = 'DISPATCHED';
  db.persist();
  res.json({ ok: true, dispatched: boxes.length });
});

// ---------- delivery attempts (POD) ----------
app.post('/api/boxes/:id/delivery-attempts', requireAuth,
  podUpload.fields([{ name: 'pod_receipt_photo', maxCount: 1 }, { name: 'pod_receiver_photo', maxCount: 1 }]),
  async (req, res) => {
    const d = db.get();
    const box = d.boxes.find(b => b.id === +req.params.id);
    if (!box) return res.status(404).json({ error: 'Not found' });
    const { outcome, failure_reason, received_by_name, notes } = req.body || {};
    if (!['DELIVERED', 'FAILED'].includes(outcome)) return res.status(400).json({ error: 'Outcome must be DELIVERED or FAILED' });
    const files = req.files || {};
    const receipt = files.pod_receipt_photo ? '/files/' + await storage.save(files.pod_receipt_photo[0].buffer, files.pod_receipt_photo[0].originalname, 'pod') : null;
    const receiverPhoto = files.pod_receiver_photo ? '/files/' + await storage.save(files.pod_receiver_photo[0].buffer, files.pod_receiver_photo[0].originalname, 'pod') : null;
    let err;
    const attemptNo = d.delivery_attempts.filter(a => a.box_id === box.id).length + 1;
    if (outcome === 'DELIVERED') {
      if (!receipt || !receiverPhoto) return res.status(400).json({ error: 'Both POD photos (signed receipt + receiver with box) are required' });
      if (!received_by_name) return res.status(400).json({ error: 'Received-by name is required' });
      err = changeBoxStatus(box, 'DELIVERED', req.user, notes || '', { received_by_name });
    } else {
      if (!SM.FAILURE_REASONS.includes(failure_reason)) return res.status(400).json({ error: 'A failure reason is required' });
      err = changeBoxStatus(box, 'RETURNED', req.user, notes || `Failed: ${failure_reason}`, { reason: notif.REASON_TEXT[failure_reason] });
    }
    if (err) return res.status(400).json({ error: err });
    const attempt = {
      id: db.nextId('attempt'), box_id: box.id, trucking_assignment_id: box.trucking_assignment_id,
      attempt_number: attemptNo, attempted_at: new Date().toISOString(),
      outcome, failure_reason: outcome === 'FAILED' ? failure_reason : null,
      pod_receipt_photo: receipt, pod_receiver_photo: receiverPhoto,
      received_by_name: received_by_name || null, notes: notes || '',
      created_at: new Date().toISOString()
    };
    d.delivery_attempts.push(attempt);
    if (outcome === 'FAILED') box.trucking_assignment_id = null; // back to warehouse pool
    // trip auto-complete when nothing left out for delivery
    const trip = d.trips.find(t => t.id === attempt.trucking_assignment_id);
    if (trip && !d.boxes.some(b => b.trucking_assignment_id === trip.id && ['OUT_FOR_DELIVERY', 'LOADED_TRUCK', 'ASSIGNED'].includes(b.status))) {
      trip.status = 'COMPLETED';
    }
    db.persist();
    res.json({ attempt, box: boxDetail(box) });
  });

// ---------- returns queue ----------
app.get('/api/returns', requireAuth, (req, res) => {
  const d = db.get();
  const list = d.boxes.filter(b => b.status === 'RETURNED').map(b => {
    const row = boxRow(b);
    const attempts = d.delivery_attempts.filter(a => a.box_id === b.id).sort((x, y) => y.created_at.localeCompare(x.created_at));
    const last = attempts[0] || {};
    const plannedTrips = d.trips.filter(t => ['PLANNED', 'LOADING'].includes(t.status) && t.region === (b.region || row.receiver_region));
    return { ...row, attempts_count: attempts.length, last_failure_reason: last.failure_reason || null, last_attempt_at: last.attempted_at || null, candidate_trips: plannedTrips };
  });
  list.sort((a, b) => String(a.status_updated_at).localeCompare(String(b.status_updated_at))); // oldest first
  res.json(list);
});

// ---------- notifications ----------
app.get('/api/notifications', requireAuth, (req, res) => {
  const d = db.get();
  const list = d.notifications.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 300)
    .map(n => ({ ...n, box_number: (d.boxes.find(b => b.id === n.box_id) || {}).box_number || '' }));
  res.json(list);
});
app.post('/api/notifications/retry/:id', requireRole('ADMIN'), (req, res) => {
  const n = db.get().notifications.find(x => x.id === +req.params.id);
  if (!n) return res.status(404).json({ error: 'Not found' });
  n.status = 'QUEUED';
  n.attempts = 0;
  n.last_error = null;
  db.persist();
  res.json(n);
});

// ---------- SMS templates (admin) ----------
app.get('/api/templates', requireRole('ADMIN'), (req, res) => {
  const d = db.get();
  const merged = {};
  for (const [k, v] of Object.entries(notif.DEFAULT_TEMPLATES)) {
    merged[k] = (d.settings.smsTemplates || {})[k] || v;
  }
  res.json({ templates: merged, placeholders: ['box_number', 'link', 'sender_first_name', 'receiver_first_name', 'driver_name', 'driver_contact', 'vfic_phone', 'received_by_name', 'reason'] });
});
app.put('/api/templates/:key', requireRole('ADMIN'), (req, res) => {
  const d = db.get();
  if (!notif.DEFAULT_TEMPLATES[req.params.key]) return res.status(404).json({ error: 'Unknown template' });
  const { body } = req.body || {};
  if (!body) return res.status(400).json({ error: 'Template body required' });
  d.settings.smsTemplates = d.settings.smsTemplates || {};
  d.settings.smsTemplates[req.params.key] = { recipients: notif.DEFAULT_TEMPLATES[req.params.key].recipients, body };
  db.persist();
  res.json(d.settings.smsTemplates[req.params.key]);
});

// ---------- users (admin) ----------
app.get('/api/users', requireRole('ADMIN'), (req, res) => {
  res.json(db.get().users.map(({ password_hash, ...u }) => u));
});
app.post('/api/users', requireRole('ADMIN'), (req, res) => {
  const { name, email, role, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (!['ADMIN', 'SHIPPER_AGENT', 'CONSIGNEE_AGENT', 'WAREHOUSE'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (db.get().users.find(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(400).json({ error: 'Email already in use' });
  const u = { id: db.nextId('user'), name, email, role, password_hash: hashPassword(password), active: true, created_at: new Date().toISOString() };
  db.get().users.push(u);
  db.persist();
  const { password_hash, ...safe } = u;
  res.json(safe);
});
app.put('/api/users/:id', requireRole('ADMIN'), (req, res) => {
  const u = db.get().users.find(x => x.id === +req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  for (const k of ['name', 'role', 'active']) if (k in req.body) u[k] = req.body[k];
  if (req.body.password) u.password_hash = hashPassword(req.body.password);
  db.persist();
  const { password_hash, ...safe } = u;
  res.json(safe);
});

// ---------- dashboard & reports ----------
app.get('/api/dashboard', requireAuth, (req, res) => {
  const d = db.get();
  const byStatus = {};
  for (const s of SM.BOX_STATUSES) byStatus[s] = 0;
  for (const b of d.boxes) byStatus[b.status] = (byStatus[b.status] || 0) + 1;
  const today = new Date().toISOString().slice(0, 10);
  res.json({
    totalBoxes: d.boxes.length,
    byStatus,
    returnsCount: byStatus.RETURNED || 0,
    unpaidShipments: d.shipments.filter(s => s.payment_status === 'UNPAID').length,
    inTransitContainers: d.containers.filter(c => c.status === 'IN_TRANSIT').map(c => ({ ...c, box_count: d.boxes.filter(b => b.container_id === c.id).length })),
    todaysTrips: d.trips.filter(t => t.scheduled_date && String(t.scheduled_date).slice(0, 10) === today)
      .map(t => ({ ...t, box_count: d.boxes.filter(b => b.trucking_assignment_id === t.id).length })),
    activeTrips: d.trips.filter(t => t.status !== 'COMPLETED').map(t => ({ ...t, box_count: d.boxes.filter(b => b.trucking_assignment_id === t.id).length })),
    recentNotifications: d.notifications.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6)
      .map(n => ({ ...n, box_number: (d.boxes.find(b => b.id === n.box_id) || {}).box_number || '' }))
  });
});

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n');
}
app.get('/api/reports/:name', requireRole('ADMIN', 'SHIPPER_AGENT', 'CONSIGNEE_AGENT'), (req, res) => {
  const d = db.get();
  let rows = [];
  switch (req.params.name) {
    case 'boxes-per-container':
      rows = d.containers.map(c => ({
        container: c.container_number, size: c.size, status: c.status,
        boxes: d.boxes.filter(b => b.container_id === c.id).length,
        eta: c.eta || '', arrived: c.actual_arrival || ''
      }));
      break;
    case 'delivery-performance': {
      rows = d.boxes.filter(b => b.status === 'DELIVERED').map(b => {
        const ev = d.status_events.filter(e => e.box_id === b.id);
        const wh = ev.find(e => e.to_status === 'RECEIVED_WAREHOUSE');
        const del = ev.find(e => e.to_status === 'DELIVERED');
        const days = wh && del ? ((new Date(del.created_at) - new Date(wh.created_at)) / 86400000).toFixed(1) : '';
        return { box: b.box_number, received_warehouse: wh ? wh.created_at : '', delivered: del ? del.created_at : '', days_warehouse_to_delivery: days };
      });
      break;
    }
    case 'failed-reasons': {
      const counts = {};
      for (const a of d.delivery_attempts.filter(a => a.outcome === 'FAILED')) counts[a.failure_reason] = (counts[a.failure_reason] || 0) + 1;
      rows = Object.entries(counts).map(([reason, count]) => ({ reason, count }));
      break;
    }
    case 'unpaid-shipments':
      rows = d.shipments.filter(s => s.payment_status === 'UNPAID').map(s => ({
        shipment: s.shipment_number,
        sender: (d.customers.find(c => c.id === s.sender_id) || {}).full_name || '',
        fee: s.shipping_fee_amount, currency: s.currency,
        boxes: d.boxes.filter(b => b.shipment_id === s.id).length, created: s.created_at
      }));
      break;
    default:
      return res.status(404).json({ error: 'Unknown report' });
  }
  if (req.query.format === 'csv') {
    res.type('text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}.csv"`);
    return res.send(toCsv(rows));
  }
  res.json(rows);
});

// ---------- public tracking (no login, rate-limited, PII-minimized) ----------
const rateBucket = new Map();
function rateLimit(req, res, next) {
  const key = req.ip;
  const nowMs = Date.now();
  const entry = rateBucket.get(key) || { count: 0, reset: nowMs + 60000 };
  if (nowMs > entry.reset) { entry.count = 0; entry.reset = nowMs + 60000; }
  entry.count += 1;
  rateBucket.set(key, entry);
  if (entry.count > 30) return res.status(429).json({ error: 'Too many requests — please wait a minute.' });
  next();
}
function publicTrackingPayload(box) {
  const d = db.get();
  const receiver = d.customers.find(c => c.id === box.receiver_id) || {};
  const container = d.containers.find(c => c.id === box.container_id) || null;
  const events = d.status_events.filter(e => e.box_id === box.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(e => ({ status: e.to_status, label: SM.FRIENDLY[e.to_status] || e.to_status, at: e.created_at }));
  let etaText = null;
  if (['IN_TRANSIT', 'LOADED_CONTAINER'].includes(box.status) && container && container.eta) {
    etaText = `Vessel ETA Manila: ${new Date(container.eta).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' })}`;
  }
  return {
    box_number: box.box_number,
    status: box.status,
    status_label: SM.FRIENDLY[box.status] || box.status,
    status_updated_at: box.status_updated_at,
    receiver_first_name: (receiver.full_name || '').split(' ')[0],
    receiver_city: receiver.city_municipality || '',
    eta_text: etaText,
    events,
    support: { phone: db.get().settings.supportPhone, email: db.get().settings.supportEmail }
  };
}
app.get('/api/track/:qrToken', rateLimit, (req, res) => {
  const box = db.get().boxes.find(b => b.qr_token === String(req.params.qrToken).trim());
  if (!box) return res.status(404).json({ error: 'Tracking link not recognized. Please check the QR code on your box label.' });
  res.json(publicTrackingPayload(box));
});
// Lookup by box number + last 4 digits of receiver phone (prevents enumeration)
app.post('/api/track-lookup', rateLimit, (req, res) => {
  const d = db.get();
  const { box_number, phone_last4 } = req.body || {};
  const box = d.boxes.find(b => b.box_number.toLowerCase() === String(box_number || '').trim().toLowerCase());
  if (!box) return res.status(404).json({ error: 'No box found with that number.' });
  const receiver = d.customers.find(c => c.id === box.receiver_id) || {};
  const digits = String(receiver.phone_primary || '').replace(/\D/g, '');
  const altDigits = String(receiver.phone_alternate || '').replace(/\D/g, '');
  const last4 = String(phone_last4 || '').replace(/\D/g, '');
  if (!last4 || last4.length !== 4 || (digits.slice(-4) !== last4 && altDigits.slice(-4) !== last4)) {
    return res.status(403).json({ error: 'Box number and phone digits do not match.' });
  }
  res.json(publicTrackingPayload(box));
});

// ---------- QR code PNG (encodes public tracking URL) ----------
app.get('/api/qr/:qrToken', async (req, res) => {
  const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const url = `${base}/track.html?t=${encodeURIComponent(req.params.qrToken)}`;
  const png = await QRCode.toBuffer(url, { width: 320, margin: 1 });
  res.type('png').send(png);
});
// QR that opens the public online intake form — printed on the blank Receiving Form
app.get('/api/intake-form-qr', async (req, res) => {
  const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const png = await QRCode.toBuffer(`${base}/intake-form.html`, { width: 320, margin: 1 });
  res.type('png').send(png);
});

// ---------- notification worker endpoint (Vercel Cron target; CRON_SECRET-protected) ----------
// Replaces the in-process setInterval worker in serverless. db.load() ran in middleware; the
// res.json wrapper flushes any sends back to the store.
app.all('/api/cron/process-notifications', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  const result = await notif.processOnce();
  res.json({ ok: true, ...result });
});

// ---------- static ----------
// Public marketing landing page is the site root; staff SPA lives at /index.html (alias /app).
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Local dev only: start the HTTP server + in-process SMS worker. On Vercel the app is imported
// as a serverless function (api/index.js) and the worker runs via Cron.
if (require.main === module) {
  (async () => {
    await db.load();
    notif.startWorker();
    app.listen(PORT, () => {
      console.log(`VFIC Balikbayan Box Operations running at http://localhost:${PORT}`);
      console.log('Logins (password demo1234): admin@vfic.demo | shipper@vfic.demo | consignee@vfic.demo | warehouse@vfic.demo');
      console.log(`SMS: ${process.env.SMS_PROVIDER || 'console'} · data: ${require('./lib/store').backend} · files: ${storage.useBlob ? 'blob' : 'fs'}`);
    });
  })();
}

module.exports = app;
