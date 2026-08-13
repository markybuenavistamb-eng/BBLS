// Read .env before anything else, so modules that pick their backend at require time
// (lib/store, lib/node) see the local configuration. No-op on Vercel.
require('./lib/env').load();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const QRCode = require('qrcode');
const db = require('./lib/db');
const { hashPassword, verifyPassword } = require('./lib/auth');
const SM = require('./lib/statuses');
const notif = require('./lib/notifications');
const storage = require('./lib/storage');
const sess = require('./lib/session');
const BOC = require('./lib/boc');
const BOXSIZE = require('./lib/boxsizes');
const IDCHECK = require('./lib/idcheck');
const REF = require('./lib/refdata');
const REGION = require('./lib/regions');

const PORT = process.env.PORT || 3000;
const app = express();
app.set('trust proxy', true); // behind Vercel's proxy: correct req.protocol/secure + client IP

app.use(express.json());

// Parse cookies (no dependency) for stateless signed-cookie auth.
app.use((req, _res, next) => { req.cookies = sess.parseCookies(req.headers.cookie); next(); });

// Load the DB doc from the store before any API/file handler, and flush after mutations.
// Scoped to /api and /files so static assets (images/css/js) never hit the KV store.
app.use(['/api', '/files'], async (req, res, next) => {
  // /api/health diagnoses storage, so it must not be gated behind storage working — that is
  // exactly when it is needed. It runs its own probe and reports why the store is failing.
  if (req.path === '/health') return next();
  try { await db.load(); } catch (e) {
    // Surface the cause in the deployment log; the response stays generic on purpose.
    console.error('Storage load failed:', require('./lib/store').classifyError(e).reason, '·', e.message);
    return res.status(503).json({ error: 'Storage temporarily unavailable', health: '/api/health' });
  }
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
const ROLE = require('./lib/roles');
const BRANCH = require('./lib/branches');
const MODULES = require('./lib/modules');
const { ADMINS, SHIPPERS, AGENTS, PH_SIDE, ALL_STAFF, ACCOUNTING_ROLES } = {
  ADMINS: ROLE.ADMINS, SHIPPERS: ROLE.SHIPPERS, AGENTS: ROLE.AGENTS,
  PH_SIDE: ROLE.PH_SIDE, ALL_STAFF: ROLE.ALL_STAFF, ACCOUNTING_ROLES: ROLE.ACCOUNTING
};

// Resolve the signed-cookie session to an active user, or null.
// Legacy role names (ADMIN / SHIPPER_AGENT) are normalised so old accounts keep working.
function userFromReq(req) {
  const token = req.cookies && req.cookies[sess.COOKIE_NAME];
  const payload = sess.verify(token);
  if (!sess.isStaffToken(payload)) return null; // a sender token must never authenticate staff
  const u = db.get().users.find(x => x.id === payload.uid && x.active) || null;
  if (u) u.role = ROLE.normalizeRole(u.role);
  return u;
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

// ---------- branch scoping ----------
// A partner branch's staff only ever see their own origin country's operation.
// Admins (Developer / Master) get the consolidated cross-branch view.
function branchScope(user) { return user ? ROLE.originScope(user.role) : null; }
// An HQ admin can narrow any list to one branch with ?branch=TH_BANGKOK. Branch staff are
// already hard-scoped, so the parameter can only ever narrow, never widen.
function effectiveScope(req) {
  const own = branchScope(req.user);
  if (own) return own;
  const asked = BRANCH.byKey(String(req.query.branch || ''));
  return asked && asked.type !== 'HQ' ? asked.country : null;
}
// Seeing every shipment across both origin portals is a head-office admin capability.
// Manila's warehouse, delivery and accounting staff work the Philippine end, so their views
// begin when a box sails; one still sitting in a Bangkok warehouse is the branch's business.
function shippedOnly(user) { return user ? ROLE.shippedCargoOnly(user.role) : false; }

function scopeShipmentList(user, shipments, scopeOverride) {
  const scope = scopeOverride !== undefined ? scopeOverride : branchScope(user);
  let list = scope ? shipments.filter(s => s.origin_country === scope) : shipments;
  if (shippedOnly(user)) {
    // A shipment appears once any of its boxes has left origin.
    const d = db.get();
    const sailed = new Set(d.boxes.filter(b => SM.hasShipped(b.status)).map(b => b.shipment_id));
    list = list.filter(s => sailed.has(s.id));
  }
  return list;
}
// Boxes inherit their branch from the parent shipment.
function scopeBoxList(user, boxes, scopeOverride) {
  const scope = scopeOverride !== undefined ? scopeOverride : branchScope(user);
  let list = boxes;
  if (scope) {
    const d = db.get();
    const ok = new Set(d.shipments.filter(s => s.origin_country === scope).map(s => s.id));
    list = list.filter(b => ok.has(b.shipment_id));
  }
  if (shippedOnly(user)) list = list.filter(b => SM.hasShipped(b.status));
  return list;
}
// A container belongs to the branch whose country it sails from.
function scopeContainerList(user, containers, scopeOverride) {
  const scope = scopeOverride !== undefined ? scopeOverride : branchScope(user);
  let list = containers;
  if (scope) list = list.filter(c => String(c.origin_port || '').toLowerCase().includes(scope.toLowerCase()));
  // A container being stuffed at origin is not yet Manila's concern.
  if (shippedOnly(user)) list = list.filter(c => SM.containerHasShipped(c.status));
  return list;
}

// ---------- per-record branch guards ----------
// Scoping the list endpoints kept another branch's shipments off the screen, but any record
// could still be fetched or changed by id — a Thailand agent opening a Cambodia shipment,
// advancing its boxes, or reading its sender's details. These guards close that: a branch
// user may only touch records from their own origin country.
//
// They answer 404, not 403, on purpose. A branch has no business learning whether an id it
// cannot see exists at all, and "forbidden" would confirm exactly that.
function outOfScope(req, res, country) {
  const scope = branchScope(req.user);
  if (!scope || scope === country) return false;
  res.status(404).json({ error: 'Not found' });
  return true;
}
// Look up a record and enforce scope in one step. Returns null when the caller may not have
// it (a response has already been sent), so handlers read: `const s = getShipment(...); if (!s) return;`
// Not-yet-sailed cargo is invisible to Manila's operational staff by the same rule as the
// lists — otherwise the record could still be opened by id.
function notYetShipped(req, res, shipped) {
  if (!shippedOnly(req.user) || shipped) return false;
  res.status(404).json({ error: 'Not found' });
  return true;
}
function getShipment(req, res, id) {
  const d = db.get();
  const s = d.shipments.find(x => x.id === +id);
  if (!s) { res.status(404).json({ error: 'Shipment not found' }); return null; }
  if (outOfScope(req, res, s.origin_country)) return null;
  const sailed = d.boxes.some(b => b.shipment_id === s.id && SM.hasShipped(b.status));
  return notYetShipped(req, res, sailed) ? null : s;
}
function getBox(req, res, id) {
  const d = db.get();
  const b = d.boxes.find(x => x.id === +id);
  if (!b) { res.status(404).json({ error: 'Box not found' }); return null; }
  const parent = d.shipments.find(s => s.id === b.shipment_id) || {};
  if (outOfScope(req, res, parent.origin_country)) return null;
  return notYetShipped(req, res, SM.hasShipped(b.status)) ? null : b;
}
// A container belongs to the branch whose country it sails from.
function getContainer(req, res, id) {
  const c = db.get().containers.find(x => x.id === +id);
  if (!c) { res.status(404).json({ error: 'Container not found' }); return null; }
  const scope = branchScope(req.user);
  if (scope && !String(c.origin_port || '').toLowerCase().includes(scope.toLowerCase())) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  return notYetShipped(req, res, SM.containerHasShipped(c.status)) ? null : c;
}
function getIntakeRequest(req, res, id) {
  const r = db.get().intake_requests.find(x => x.id === +id);
  if (!r) { res.status(404).json({ error: 'Request not found' }); return null; }
  if (outOfScope(req, res, r.origin_country)) return null;
  return notYetShipped(req, res, false) ? null : r;
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

// Correction / reversal — bypasses the forward-only state machine. Used only by the
// explicit "undo / revert" endpoints so staff can fix a mis-clicked Action. Writes a
// status_event so the correction is auditable.
function forceBoxStatus(box, to, actor, note = '') {
  const d = db.get();
  const nowIso = new Date().toISOString();
  d.status_events.push({
    id: db.nextId('status_event'), box_id: box.id,
    from_status: box.status, to_status: to,
    actor_user_id: actor ? actor.id : null, note: note || '', created_at: nowIso, correction: true
  });
  box.status = to;
  box.status_updated_at = nowIso;
}

// One step back for a container's lifecycle status (used by the revert endpoint).
const CONTAINER_PREV = {
  LOADING: 'BOOKING', IN_TRANSIT: 'LOADING', ARRIVED: 'IN_TRANSIT',
  AT_CUSTOMS: 'ARRIVED', RELEASED: 'AT_CUSTOMS', STRIPPED: 'RELEASED'
};

// Next automatic load code, counted per origin: TH-C1, TH-C2 … alongside KH-C1, KH-C2.
// Each branch loads its own containers, so a single shared sequence made Bangkok's and
// Phnom Penh's codes interleave and a bare "C4" meant nothing without asking whose it was.
// Monotonic above the highest existing code for that origin, so it never collides even
// after a container is removed. Legacy bare codes (C1) still count toward head office.
function nextLoadCode(d, originCountry) {
  const prefix = BRANCH.countryCode(originCountry) || 'VF';
  const re = new RegExp(`^${prefix}-C(\\d+)$`);
  let max = 0;
  for (const c of d.containers) {
    const m = re.exec(String(c.load_code || ''));
    if (m) max = Math.max(max, +m[1]);
  }
  return `${prefix}-C${max + 1}`;
}

// ---------- auth routes ----------
// `portal` is the branch slug the sign-in came from (th / kh / mnl). Branch staff can only
// sign in at their own branch's portal; HQ admins may sign in anywhere.
app.post('/api/login', (req, res) => {
  const { email, password, portal } = req.body || {};
  const u = db.get().users.find(x => x.email.toLowerCase() === String(email || '').toLowerCase() && x.active);
  if (!u || !verifyPassword(password || '', u.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
  const role = ROLE.normalizeRole(u.role);
  if (portal && !BRANCH.roleAllowedAtPortal(role, portal)) {
    const own = BRANCH.portalForBranch(BRANCH.branchForRole(role));
    return res.status(403).json({
      error: own
        ? `This account belongs to ${own.name}. Please sign in at the ${own.name} portal (/${own.slug}).`
        : 'This account cannot sign in at this branch portal.'
    });
  }
  res.cookie(sess.COOKIE_NAME, sess.tokenFor(u.id), sess.cookieOptions);
  res.json({ id: u.id, name: u.name, email: u.email, role });
});

// Public branding for a branch portal's sign-in page.
// Which staff portals this deployment can actually sign someone into.
//
// Each branch runs its own deployment with its own user table — users deliberately do not
// replicate — so a Thailand account exists only on the Thailand deployment. Offering /th on
// Manila's site would present a door whose key nobody there holds. Head office additionally
// gets links out to the branch sites, taken from the peers it is already configured with,
// because overseeing them is its job; a branch site lists only itself.
app.get('/api/portals', (req, res) => {
  const d = db.get();
  const branches = BRANCH.resolve(d.settings.branches);
  const decorate = (p) => {
    const b = branches.find(x => x.key === p.branch) || {};
    return {
      slug: p.slug, name: p.name, city: p.city, flag: p.flag, accent: p.accent,
      label: b.label || p.name, country: b.country || '', type: p.branch ? b.type : 'DEVELOPER',
      // The app reads the portal from the path (/mnl, /th), not from a hash.
      href: '/' + p.slug
    };
  };
  const isHQ = NODE.SELF.type === 'HQ';
  const here = Object.values(BRANCH.PORTALS)
    .filter(p => (p.branch ? p.branch === NODE.NODE_ID : isHQ))   // the dev console lives at HQ
    .map(decorate);
  // Peer sites, so head office can hop to a branch portal rather than hunt for the URL.
  const elsewhere = isHQ
    ? NODE.PEERS.map(peer => {
        const p = BRANCH.portalForBranch(peer.id);
        if (!p) return null;
        const b = branches.find(x => x.key === peer.id) || {};
        return {
          slug: p.slug, name: p.name, city: p.city, flag: p.flag, accent: p.accent,
          label: b.label || p.name, country: b.country || '', type: b.type || 'BRANCH',
          href: String(peer.url).replace(/\/+$/, '') + '/' + p.slug, external: true
        };
      }).filter(Boolean)
    : [];
  res.json({ node: NODE.SELF.id, node_label: NODE.SELF.label, here, elsewhere });
});

app.get('/api/portal/:slug', (req, res) => {
  const p = BRANCH.portalBySlug(req.params.slug);
  if (!p) return res.status(404).json({ error: 'Unknown portal' });
  if (!p.branch) return res.json({ ...p, label: p.name, country: '', type: 'DEVELOPER', address: '', contact: '' });
  const b = BRANCH.resolve(db.get().settings.branches).find(x => x.key === p.branch) || {};
  res.json({ ...p, label: b.label, country: b.country, type: b.type, address: b.address || '', contact: b.contact || '' });
});
app.post('/api/logout', (req, res) => { res.clearCookie(sess.COOKIE_NAME, { path: '/' }); res.json({ ok: true }); });
app.get('/api/me', requireAuth, (req, res) => {
  const { id, name, email, role } = req.user;
  res.json({ id, name, email, role });
});

// ---------- file uploads (in-memory → storage adapter: Vercel Blob or local disk) ----------
const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const podUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// --- ID-document upload security (passport / government ID) ---
// A passport scan is sensitive personal data, so the upload is constrained on every axis:
//   • allowlist of content types + extensions (no scripts, archives or office macros)
//   • magic-byte sniffing so a renamed file cannot slip past the declared type
//   • one file, hard size cap
//   • stored under intake/* which the /files proxy only serves to authenticated agents
const ID_MAX_BYTES = 6 * 1024 * 1024;
const ID_ALLOWED = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/heic': ['.heic'],
  'application/pdf': ['.pdf']
};
// Leading bytes that identify each accepted format.
function sniffFileType(buf) {
  if (!buf || buf.length < 12) return null;
  const b = buf;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.slice(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (b.slice(4, 8).toString('latin1') === 'ftyp') return 'image/heic'; // heic/heif family
  return null;
}
function validateIdDocument(file) {
  if (!file) return 'A scanned/soft copy of your passport or government ID is required';
  if (file.size > ID_MAX_BYTES) return 'The ID file is too large — please upload a file under 6 MB';
  const ext = path.extname(file.originalname || '').toLowerCase();
  const declared = String(file.mimetype || '').toLowerCase();
  if (!ID_ALLOWED[declared]) return 'Only JPG, PNG, WEBP, HEIC or PDF files are accepted for the ID';
  if (!ID_ALLOWED[declared].includes(ext)) return 'The file extension does not match its content type';
  const actual = sniffFileType(file.buffer);
  if (!actual) return 'That file is not a readable image or PDF';
  // jpeg/heic siblings are interchangeable enough; everything else must match exactly.
  const family = (t) => (t === 'image/heic' ? 'image/heic' : t);
  if (family(actual) !== family(declared)) return 'The file content does not match its file type — please re-save and try again';
  return null;
}
const intakeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ID_MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const declared = String(file.mimetype || '').toLowerCase();
    if (!ID_ALLOWED[declared]) return cb(new Error('Only JPG, PNG, WEBP, HEIC or PDF files are accepted for the ID'));
    cb(null, true);
  }
});

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
  let list = scopeShipmentList(req.user, d.shipments.slice(), effectiveScope(req));
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
  const s = getShipment(req, res, req.params.id);
  if (!s) return;
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
app.post('/api/shipments', requireRole(...ADMINS, ...ROLE.BRANCH_ADMINS, ...SHIPPERS), (req, res) => {
  const d = db.get();
  const b = req.body || {};
  const sender = d.customers.find(c => c.id === +b.sender_id);
  if (!sender) return res.status(400).json({ error: 'Valid sender is required' });
  if (!Array.isArray(b.boxes) || !b.boxes.length) return res.status(400).json({ error: 'At least one box is required' });
  if (!b.passport_file) return res.status(400).json({ error: 'A scanned/soft copy of the sender\'s passport or government ID is required' });
  if (b.service_type && !SM.SERVICE_TYPES.includes(b.service_type)) return res.status(400).json({ error: 'Invalid service type' });
  if (b.service_level && !SM.SERVICE_LEVELS.includes(b.service_level)) return res.status(400).json({ error: 'Invalid service level' });
  // Enforced here as well as in the form: saving is what mints box numbers and QR tokens,
  // and an unpriced shipment can never be receipted or collected on.
  if (!(+b.shipping_fee_amount > 0)) {
    return res.status(400).json({ error: 'A shipping fee is required before box numbers can be generated' });
  }
  for (const bx of b.boxes) {
    if (!d.customers.find(c => c.id === +bx.receiver_id)) return res.status(400).json({ error: 'Every box needs a valid receiver' });
    if (bx.size_category && !SM.SIZE_CATEGORIES.includes(bx.size_category)) return res.status(400).json({ error: 'Invalid size category' });
  }
  // A branch agent files against their own branch, whatever the form said — otherwise a
  // shipment could be booked into another country's books and numbering series.
  const ownScope = branchScope(req.user);
  if (ownScope && b.origin_country && b.origin_country !== ownScope) {
    return res.status(403).json({ error: `This portal books ${ownScope} shipments only` });
  }
  if (ownScope) b.origin_country = ownScope;

  const nowIso = new Date().toISOString();
  const shipment = {
    id: db.nextId('shipment'),
    shipment_number: db.nextShipmentNumber(b.origin_country),
    sender_id: sender.id,
    origin_country: b.origin_country || '', origin_agent: b.origin_agent || '',
    service_type: b.service_type || 'DOOR_TO_DOOR',
    service_level: SM.SERVICE_LEVELS.includes(b.service_level) ? b.service_level : 'OCEAN_ECONOMY',
    collection: b.collection === 'DROPOFF' ? 'DROPOFF' : (b.collection === 'PICKUP' ? 'PICKUP' : null),
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
app.put('/api/shipments/:id', requireRole(...ADMINS, ...ROLE.BRANCH_ADMINS, ...SHIPPERS), (req, res) => {
  const s = getShipment(req, res, req.params.id);
  if (!s) return;
  const b = req.body || {};
  if (b.payment_status && !['PAID', 'UNPAID'].includes(b.payment_status)) return res.status(400).json({ error: 'Invalid payment status' });
  for (const k of ['origin_country', 'origin_agent', 'service_type', 'service_level', 'collection', 'receiving_form_file', 'packing_list_file', 'passport_file', 'shipping_fee_amount', 'currency', 'payment_status']) {
    if (k in b) s[k] = b[k];
  }
  db.persist();
  res.json(s);
});
// Confirm physical receipt at origin: all CREATED boxes → RECEIVED_ORIGIN (SMS to sender)
app.post('/api/shipments/:id/receive', requireRole(...ADMINS, ...ROLE.BRANCH_ADMINS, ...SHIPPERS), (req, res) => {
  const d = db.get();
  const s = getShipment(req, res, req.params.id);
  if (!s) return;
  const boxes = d.boxes.filter(b => b.shipment_id === s.id && b.status === 'CREATED');
  for (const box of boxes) changeBoxStatus(box, 'RECEIVED_ORIGIN', req.user, 'Physical receipt confirmed at origin');
  db.persist();
  res.json({ ok: true, received: boxes.length });
});

// ---------- health (public: report the storage backend so persistence can be verified; no secrets) ----------
app.get('/api/health', async (req, res) => {
  const store = require('./lib/store');
  res.set('Cache-Control', 'no-store');
  // Actually read from the store. The old check only asked whether a cloud backend was
  // configured, so a deployment whose every query failed still reported itself connected.
  const probe = await store.probe();
  const secretIssue = NODE.secretIssue();
  const checks = {
    database_connected: probe.ok && !store.ephemeral,
    node_id_set: !!process.env.VFIC_NODE_ID,
    sync_secret_set: !!NODE.SYNC_SECRET && !secretIssue,
    peers_configured: NODE.PEERS.length > 0,
    // Uploads on ephemeral /tmp look like they saved, then disappear with the instance —
    // an ID scan lost hours after intake, which is worse than an upload that fails outright.
    file_storage_persistent: !storage.ephemeral
  };
  res.json({
    ok: true,
    // Present only when the store is unreachable: a classified reason and the fix, so a
    // broken deployment explains itself instead of returning a bare 503.
    storage_error: probe.ok ? null : { reason: probe.reason, fix: probe.fix, notes: probe.notes || [] },
    // Which deployment this is, so each node can be identified at a glance after release.
    node: { id: NODE.SELF.id, label: NODE.SELF.label, type: NODE.SELF.type, id_band: `${NODE.SELF.idOffset}–${NODE.SELF.idOffset + 999999}` },
    backend: store.backend,                 // 'supabase' | 'kv' | 'ephemeral-tmp' | 'filesystem'
    persistent: !store.ephemeral,            // false = data resets on cold start (no cloud DB yet)
    // Uploads (passport/ID scans, POD photos) are stored separately from the database.
    // blob_vars lists the *names* of any BLOB-related variables this deployment can see —
    // never their values. It separates "the store was never connected" from "it was
    // connected but the token arrived under a name the app does not read".
    files: {
      backend: storage.fileBackend,
      persistent: !storage.ephemeral,
      blob_vars: Object.keys(process.env).filter(k => /BLOB/i.test(k)).sort()
    },
    replication: {
      enabled: NODE.syncEnabled(), peers: NODE.PEERS.map(p => p.id),
      // Names a secret that exists but cannot be used, which otherwise only shows up as an
      // opaque fetch error the moment someone presses Sync.
      secret_error: secretIssue
    },
    checks,
    ready: Object.values(checks).every(Boolean),
    // Which commit this deployment is actually running. Vercel sets these on every build.
    // Without it there is no way to tell a fix that was never deployed from one that did
    // not work — a question that came up repeatedly and cost a lot of guessing.
    build: {
      commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
      message: (process.env.VERCEL_GIT_COMMIT_MESSAGE || '').split('\n')[0] || null
    },
    time: new Date().toISOString()
  });
});

// ---------- box sizes (public: booking form + staff app share this single source of truth) ----------
app.get('/api/box-sizes', (req, res) => {
  const d = db.get();
  // A branch deployment only ever serves senders in its own country, so it answers for that
  // country whether or not the form asked — the booking form then has nothing to choose and
  // nothing to get wrong, and the prices and currency are its branch's from the first paint.
  // Head office still offers the full list, since it is not tied to one origin lane.
  const ownCountry = NODE.SELF.type === 'BRANCH' ? NODE.SELF.country : null;
  const askedCountry = String(req.query.country || '').trim();
  const country = ownCountry || askedCountry;
  const branchKey = (BRANCH.byCountry(country) || {}).key || 'HQ_MANILA';
  const card = rateCardFor(d, branchKey);
  const prices = Object.fromEntries(BOXSIZE.SIZE_KEYS.map(k => [k, +(card.empty_box_price[k] || 0)]));
  res.json({
    sizes: BOXSIZE.BOX_SIZES,
    boc_max_cbm: BOXSIZE.BOC_MAX_CBM,
    excess_charge_per_kg: d.settings.excessWeightChargePerKg != null ? d.settings.excessWeightChargePerKg : null,
    excess_charge_currency: d.settings.excessWeightChargeCurrency || 'PHP',
    max_box_value_php: d.settings.maxBoxValuePhp != null ? d.settings.maxBoxValuePhp : 10000,
    service_levels: SM.SERVICE_LEVELS,
    // One entry on a branch deployment: the form shows it as fixed text rather than a choice.
    origin_countries: ownCountry ? [ownCountry] : REF.ORIGIN_COUNTRIES,
    origin_country: country || null,
    origin_country_locked: !!ownCountry,
    // What a valid phone number looks like where this sender is, mobile vs landline.
    phone_format: REF.phoneFormatFor(country),
    // empty-box pricing for the selected country
    empty_box_prices: prices,
    currency: card.currency,
    price_branch: branchKey,
    priced: Object.values(prices).some(v => v > 0),
    // Full shipping tariff so the booking form can quote a box as the sender fills it in:
    // ocean is per box by size and destination zone, air is per kilo by zone.
    shipping_rates: { ocean: card.ocean, air: card.air },
    zones: RATES.ZONES,
    region_zone: RATES.REGION_ZONE,
    // The branch office city that serves this country — autofills "Sending From".
    branch_city: (BRANCH.portalForBranch(branchKey) || {}).city || ''
  });
});

// Reference lists for the Container booking form (shipping lines, origin/destination ports).
app.get('/api/refdata', requireAuth, (req, res) => {
  // A branch user only gets their own country's origin ports, so the booking form can
  // never offer another branch's port.
  const scope = branchScope(req.user);
  const originPorts = scope ? REF.ORIGIN_PORTS.filter(g => g.group === scope) : REF.ORIGIN_PORTS;
  res.json({
    shipping_lines: REF.SHIPPING_LINES,
    origin_ports: originPorts,
    origin_countries: scope ? [scope] : REF.ORIGIN_COUNTRIES,
    destination_ports: REF.DESTINATION_PORTS,
    branch_scope: scope
  });
});

// ---------- online intake requests (public self-service fill-up, reviewed & encoded by staff) ----------
// Public submission: no login. Sender fills their own info + box(es) + uploads a passport/ID scan.
// This does NOT create a shipment/customer directly — an agent reviews it and encodes it via
// New Shipment Intake, which pre-fills from the request and marks it CONVERTED.
// Multer rejections (bad type / oversize) surface as a clean 400 instead of a stack trace.
const intakeIdUpload = (req, res, next) => intakeUpload.single('passport_file')(req, res, (err) => {
  if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The ID file is too large — please upload a file under 6 MB' : (err.message || 'Invalid upload') });
  next();
});
app.post('/api/public/intake-requests', rateLimit, intakeIdUpload, async (req, res) => {
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

    const service_level = SM.SERVICE_LEVELS.includes(b.service_level) ? b.service_level : 'OCEAN_ECONOMY';
    const collection = SM.COLLECTION_METHODS.includes(b.collection) ? b.collection : 'PICKUP';
    const origin_agent = need(b.origin_agent, 'Sending From');
    const origin_country = need(b.origin_country, 'Country');
    const total_value_php = need(b.total_value_php, 'Total Value for this Shipment');

    // --- Pick-up scheduling (only when VFIC collects the box from the sender) ---
    let pickup = null;
    if (collection === 'PICKUP') {
      let p = {};
      try { p = JSON.parse(b.pickup || '{}') || {}; } catch (e) { return bad('Invalid pick-up data'); }
      pickup = {
        date: need(p.date, 'Pick-up date'),
        time_window: ['AM', 'PM'].includes(p.time_window) ? p.time_window : 'AM',
        address: need(p.address || sender.address_abroad, 'Pick-up address'),
        notes: String(p.notes || '').trim()
      };
    }

    const idErr = validateIdDocument(req.file);
    if (idErr) return bad(idErr);
    // Advisory check that the ID actually belongs to the declared sender.
    const idCheck = IDCHECK.verifyIdDocument(req.file, sender);

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
          .map(g => {
            const item = { category: g.category, qty: +g.qty };
            if (g.category === 'Others') item.specify = String(g.specify || '').trim();
            return item;
          })
        : [];
      if (!goods.length) throw new Error(`Box ${n}: at least one itemized good is required`);
      if (goods.some(g => g.category === 'Others' && !g.specify)) throw new Error(`Box ${n}: please specify the item(s) under “Others”`);
      const sizeKey = SM.SIZE_CATEGORIES.includes(bx.size_category) ? bx.size_category : 'LARGE';
      const sizeInfo = BOXSIZE.bySize(sizeKey);
      const weight = +rq(bx.weight_kg, 'Weight') || 0;
      const boxValue = +rq(bx.total_value_php, 'Total Value of Contents') || 0;
      const maxBoxValue = db.get().settings.maxBoxValuePhp != null ? db.get().settings.maxBoxValuePhp : 10000;
      if (maxBoxValue && boxValue > maxBoxValue) throw new Error(`Box ${n}: declared value ₱${boxValue.toLocaleString('en-PH')} exceeds the ₱${maxBoxValue.toLocaleString('en-PH')} limit per box`);
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
          postal_code: String(r.postal_code || '').trim(),
          relationship: r.relationship,
          country: 'Philippines'
        },
        size_category: sizeKey,
        weight_kg: weight,
        standard_weight_kg: sizeInfo ? sizeInfo.standard_weight_kg : null,
        excess_weight_kg: BOXSIZE.excessWeightKg(sizeKey, weight),
        total_value_php: boxValue,
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
      origin_country, origin_agent, service_level, collection,
      pickup,
      total_value_php: +total_value_php || 0,
      // The shipping estimate the sender was actually shown, kept so the agent records that
      // same figure instead of re-deriving one that might not match what was promised.
      shipping_fee_amount: b.quoted_fee_amount != null && b.quoted_fee_amount !== ''
        ? +b.quoted_fee_amount : null,
      quoted_online: b.quoted_fee_amount != null && b.quoted_fee_amount !== '',
      currency: b.currency || rateCardFor(d, (BRANCH.byCountry(origin_country) || {}).key || 'HQ_MANILA').currency,
      payment_status: b.payment_status === 'PAID' ? 'PAID' : 'UNPAID',
      passport_file: '/files/' + passportKey,
      // Automated ID check + the staff decision that follows it.
      id_check: idCheck,
      id_verification: { status: 'PENDING', by: null, at: null, note: '' },
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
  const scope = effectiveScope(req);
  // Online bookings waiting to be encoded are origin-side work by definition, so Manila's
  // delivery and accounting staff see none of them.
  let list = shippedOnly(req.user) ? [] : d.intake_requests.filter(r => !scope || r.origin_country === scope);
  if (req.query.status) list = list.filter(r => r.status === req.query.status);
  list.sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  res.json(list.map(r => ({
    id: r.id, reference_code: r.reference_code, status: r.status, submitted_at: r.submitted_at,
    sender_name: personName(r.sender), sender_phone: (r.sender || {}).contact_numbers || '',
    box_count: r.boxes.length,
    // Size breakdown so the queue shows what was booked without opening each request.
    box_sizes: r.boxes.map(b => b.size_category),
    size_summary: Object.entries(r.boxes.reduce((m, b) => {
      const k = BOXSIZE.canonicalSize(b.size_category) || b.size_category || '—';
      m[k] = (m[k] || 0) + 1; return m;
    }, {})).map(([k, n]) => `${n}× ${(BOXSIZE.bySize(k) || {}).label || k}`).join(', '),
    id_verdict: (r.id_check || {}).verdict || null,
    id_flag_count: ((r.id_check || {}).flags || []).length,
    id_verification_status: (r.id_verification || {}).status || 'PENDING'
  })));
});
app.get('/api/intake-requests/:id', requireRole(...AGENTS), (req, res) => {
  const r = getIntakeRequest(req, res, req.params.id);
  if (!r) return;
  res.json(r);
});
// Staff decision on the uploaded ID (confirm it matches the sender, or reject it).
app.post('/api/intake-requests/:id/verify-id', requireRole(...AGENTS), (req, res) => {
  const r = getIntakeRequest(req, res, req.params.id);
  if (!r) return;
  const { status, note } = req.body || {};
  if (!['VERIFIED', 'REJECTED', 'PENDING'].includes(status)) return res.status(400).json({ error: 'Invalid verification status' });
  if (status === 'REJECTED' && !String(note || '').trim()) return res.status(400).json({ error: 'Please say why the ID was rejected' });
  r.id_verification = { status, by: req.user.name, at: new Date().toISOString(), note: String(note || '').trim() };
  db.persist();
  res.json(r.id_verification);
});
app.put('/api/intake-requests/:id', requireRole(...AGENTS), (req, res) => {
  const r = getIntakeRequest(req, res, req.params.id);
  if (!r) return;
  const { status, shipment_id } = req.body || {};
  if (!['CONVERTED', 'DISMISSED'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  r.status = status;
  if (status === 'CONVERTED') r.converted_shipment_id = shipment_id || null;
  db.persist();
  res.json(r);
});

// ---------- box orders (public "buy a box from us" — customer has no box yet) ----------
// A customer with no box orders empty balikbayan box(es) from VFIC; we deliver to their
// address or they collect at the office. Staff fulfil it from the Box Orders queue.
app.post('/api/public/box-orders', rateLimit, (req, res) => {
  const b = req.body || {};
  const need = (v, label) => { if (!String(v || '').trim()) throw new Error(`${label} is required`); return String(v).trim(); };
  try {
    const validSizes = BOXSIZE.BOX_SIZES.map(s => s.key);
    const items = (Array.isArray(b.items) ? b.items : [])
      .filter(it => it && validSizes.includes(it.size) && +it.qty > 0)
      .map(it => ({ size: it.size, qty: Math.min(999, Math.floor(+it.qty)) }));
    if (!items.length) throw new Error('Please choose at least one box size and quantity');
    const delivery = b.delivery_method === 'PICKUP_OFFICE' ? 'PICKUP_OFFICE' : 'DELIVER_ADDRESS';
    // The sender ordering boxes is abroad, so accept an international contact number.
    const phone = String(b.contact_phone || '').trim();
    if (phone.replace(/\D/g, '').length < 7) throw new Error('A valid contact number is required');
    const contact = { name: need(b.contact_name, 'Name'), phone, email: String(b.contact_email || '').trim() };
    let address = null, pickup_branch = null;
    if (delivery === 'DELIVER_ADDRESS') {
      address = {
        country: need(b.country, 'Country'),
        city: need(b.city, 'City / State / Province'),
        street_address: need(b.street_address, 'Street / Address'),
        postal_code: String(b.postal_code || '').trim(),
        landmark: String(b.landmark || '').trim()
      };
    } else {
      pickup_branch = String(b.pickup_branch || '').trim();
    }
    const d = db.get();
    d.box_orders = d.box_orders || [];
    const total_qty = items.reduce((n, it) => n + it.qty, 0);
    const rec = {
      id: db.nextId('box_order'),
      reference_code: db.nextBoxOrderCode(),
      status: 'NEW',
      submitted_at: new Date().toISOString(),
      items, total_qty, delivery_method: delivery, address, pickup_branch, contact,
      // Which branch this order belongs to. A branch deployment serves its own order form,
      // so the node answering the request is the branch that owns the order.
      origin_country: NODE.SELF.type === 'BRANCH' ? NODE.SELF.country : String(b.origin_country || '').trim(),
      notes: String(b.notes || '').trim()
    };
    d.box_orders.push(rec);
    db.persist();
    res.json({ reference_code: rec.reference_code, submitted_at: rec.submitted_at });
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Invalid order' });
  }
});
app.get('/api/box-orders', requireRole(...AGENTS), (req, res) => {
  const d = db.get();
  let list = (d.box_orders || []).slice();
  // A branch sees only the empty-box orders placed with it.
  const scope = effectiveScope(req);
  if (scope) list = list.filter(o => !o.origin_country || o.origin_country === scope);
  if (req.query.status) list = list.filter(o => o.status === req.query.status);
  list.sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  res.json(list);
});
app.put('/api/box-orders/:id', requireRole(...AGENTS), (req, res) => {
  const d = db.get();
  const o = (d.box_orders || []).find(x => x.id === +req.params.id);
  if (!o) return res.status(404).json({ error: 'Not found' });
  if (o.origin_country && outOfScope(req, res, o.origin_country)) return;
  const { status } = req.body || {};
  if (!['NEW', 'PREPARING', 'DISPATCHED', 'FULFILLED', 'CANCELLED'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  o.status = status;
  db.persist();
  res.json(o);
});

// ---------- global search ----------
// One search box over everything an operator might type: a box or shipment number, a
// container, a person's name or phone. Results are branch-scoped like every other list.
app.get('/api/search', requireAuth, (req, res) => {
  const d = db.get();
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json({ q, groups: [] });
  const hit = (v) => v && String(v).toLowerCase().includes(q);
  const cap = 8;

  const boxes = scopeBoxList(req.user, d.boxes).filter(b => {
    const r = boxRow(b);
    return hit(b.box_number) || hit(b.container_box_number) || hit(r.receiver_name) || hit(r.receiver_phone) || hit(r.sender_name);
  }).slice(0, cap).map(b => {
    const r = boxRow(b);
    return { label: b.container_box_number || b.box_number, sub: `${r.receiver_name || ''} · ${SM.FRIENDLY[b.status] || b.status}`, href: '#/boxes/' + b.id };
  });

  const shipments = scopeShipmentList(req.user, d.shipments).filter(sh => {
    const sender = d.customers.find(c => c.id === sh.sender_id) || {};
    return hit(sh.shipment_number) || hit(sender.full_name) || hit(sender.phone_primary);
  }).slice(0, cap).map(sh => {
    const sender = d.customers.find(c => c.id === sh.sender_id) || {};
    return { label: sh.shipment_number, sub: `${sender.full_name || ''} · ${sh.origin_agent || ''}`, href: '#/shipments/' + sh.id };
  });

  const containers = scopeContainerList(req.user, d.containers)
    .filter(c => hit(c.container_number) || hit(c.vessel_name) || hit(c.booking_number) || hit(c.load_code))
    .slice(0, cap)
    .map(c => ({ label: c.container_number, sub: `${c.load_code || ''} · ${c.status}`, href: '#/containers/' + c.id }));

  const customers = d.customers
    .filter(c => hit(c.full_name) || hit(c.phone_primary) || hit(c.phone_alternate) || hit(c.email) || hit(c.city_municipality))
    .slice(0, cap)
    .map(c => ({ label: c.full_name, sub: `${c.type} · ${c.phone_primary || ''}${c.city_municipality ? ' · ' + c.city_municipality : ''}`, href: '#/customers/' + c.id }));

  const scope = branchScope(req.user);
  const inScope = (country) => !scope || country === scope;

  const trips = d.trips
    .filter(t => hit(t.trip_number) || hit(t.driver_name) || hit(t.plate_number) || hit(t.trucking_company))
    .slice(0, cap)
    .map(t => ({ label: t.trip_number, sub: `${t.driver_name || ''} · ${REGION.LABELS[t.region] || t.region || ''} · ${t.status}`, href: '#/trips/' + t.id }));

  const intake = (d.intake_requests || [])
    .filter(r => inScope(r.origin_country))
    .filter(r => hit(r.reference_code) || hit(personName(r.sender)) || hit((r.sender || {}).contact_numbers) || hit((r.sender || {}).email))
    .slice(0, cap)
    .map(r => ({ label: r.reference_code, sub: `${personName(r.sender)} · ${r.status}`, href: '#/intake-requests' }));

  const orders = (d.box_orders || [])
    .filter(o => hit(o.reference_code) || hit((o.contact || {}).name) || hit((o.contact || {}).phone) || hit((o.contact || {}).email))
    .slice(0, cap)
    .map(o => ({ label: o.reference_code, sub: `${(o.contact || {}).name || ''} · ${o.total_qty} box(es) · ${o.status}`, href: '#/box-orders' }));

  const settlements = (d.interbranch_invoices || [])
    .filter(i => ibVisible(req.user, i))
    .filter(i => hit(i.invoice_number) || hit(i.settled_reference) || hit(i.notes))
    .slice(0, cap)
    .map(i => ({ label: i.invoice_number, sub: `${BRANCH.BRANCH_LABELS[i.from_branch] || i.from_branch} → ${BRANCH.BRANCH_LABELS[i.to_branch] || i.to_branch} · ${i.status}`, href: '#/accounting/interbranch' }));

  const expenses = (d.expenses || [])
    .filter(e => !e.deleted_at)
    .filter(e => hit(e.description) || hit(e.category) || hit(e.recorded_by))
    .slice(0, cap)
    .map(e => ({ label: e.description, sub: `${e.category.replace(/_/g, ' ')} · ${e.currency} ${e.amount}`, href: '#/accounting/expenses' }));

  const senders = (d.sender_accounts || [])
    .filter(a => hit(a.name) || hit(a.email) || hit(a.phone))
    .slice(0, cap)
    .map(a => ({ label: a.name || a.email, sub: `Sender account · ${a.email}`, href: '#/customers' }));

  const staff = ROLE.isAnyAdmin(req.user.role)
    ? d.users.filter(u => hit(u.name) || hit(u.email) || hit(u.role))
        .slice(0, cap)
        .map(u => ({ label: u.name, sub: `${ROLE.ROLE_LABELS[ROLE.normalizeRole(u.role)] || u.role} · ${u.email}`, href: '#/admin' }))
    : [];

  const groups = [
    { key: 'boxes', label: 'Boxes', items: boxes },
    { key: 'shipments', label: 'Shipments', items: shipments },
    { key: 'containers', label: 'Containers', items: containers },
    { key: 'customers', label: 'Customers', items: customers },
    { key: 'intake', label: 'Online intake requests', items: intake },
    { key: 'orders', label: 'Box orders', items: orders },
    { key: 'trips', label: 'Trips', items: trips },
    { key: 'settlements', label: 'Inter-branch settlements', items: settlements },
    { key: 'expenses', label: 'Expenses', items: expenses },
    { key: 'senders', label: 'Sender accounts', items: senders },
    { key: 'staff', label: 'Staff', items: staff }
  ].filter(g => g.items.length);
  res.json({ q, groups, total: groups.reduce((n, g) => n + g.items.length, 0) });
});

// ---------- boxes ----------
app.get('/api/boxes', requireAuth, (req, res) => {
  const d = db.get();
  let list = scopeBoxList(req.user, d.boxes.slice(), effectiveScope(req));
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
  const box = getBox(req, res, req.params.id);
  if (!box) return;
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
  // Scanning a code is still a read of that record, so the same rules apply.
  const parent = d.shipments.find(x => x.id === box.shipment_id) || {};
  if (outOfScope(req, res, parent.origin_country)) return;
  if (notYetShipped(req, res, SM.hasShipped(box.status))) return;
  res.json(boxDetail(box));
});
app.put('/api/boxes/:id', requireRole(...AGENTS), (req, res) => {
  const box = getBox(req, res, req.params.id);
  if (!box) return;
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
  const box = getBox(req, res, req.params.id);
  if (!box) return;
  const { status, note, region } = req.body || {};
  // Warehouse staff can only do warehouse statuses
  if (req.user.role === 'WAREHOUSE' && !['RECEIVED_WAREHOUSE', 'SORTED'].includes(status)) {
    return res.status(403).json({ error: 'Warehouse role can only mark Received/Sorted' });
  }
  // A box moves to In-Transit only via its container being marked Departed — never manually.
  if (status === 'IN_TRANSIT') {
    return res.status(400).json({ error: 'A box moves to In-Transit only when its container is marked Departed. Open the container in the Containers module and use “Mark Departed”.' });
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
// Undo the last status change — for a mis-clicked Action. Removes the most recent status
// event and rolls the box back to the prior status, reconciling any side effects.
app.post('/api/boxes/:id/revert', requireRole(...ADMINS), (req, res) => {
  const d = db.get();
  const box = getBox(req, res, req.params.id);
  if (!box) return;
  const events = d.status_events.filter(e => e.box_id === box.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (events.length <= 1) return res.status(400).json({ error: 'Nothing to undo — box is at its initial status.' });
  const last = events[events.length - 1];
  // Warehouse can only undo warehouse-stage actions; only admin can undo a completed delivery/return/cancel.
  if (req.user.role === 'WAREHOUSE' && !['RECEIVED_WAREHOUSE', 'SORTED'].includes(last.to_status)) {
    return res.status(403).json({ error: 'Warehouse role can only undo Received/Sorted.' });
  }
  if (['DELIVERED', 'RETURNED', 'CANCELLED'].includes(last.to_status) && !ROLE.isAdmin(req.user.role)) {
    return res.status(403).json({ error: 'Only an admin can undo a Delivered / Returned / Cancelled box.' });
  }
  d.status_events = d.status_events.filter(e => e.id !== last.id);
  box.status = last.from_status;
  box.status_updated_at = new Date().toISOString();
  // Reconcile side effects of the undone action.
  if (last.to_status === 'LOADED_CONTAINER') {
    box.container_id = null; box.container_load_code = null; box.container_box_number = null; box.load_sequence = null;
  }
  if (last.to_status === 'ASSIGNED') box.trucking_assignment_id = null; // removed from trip
  if (last.to_status === 'DELIVERED' || last.to_status === 'RETURNED') {
    // drop the matching delivery attempt so the count stays accurate
    const att = d.delivery_attempts.filter(a => a.box_id === box.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (att.length) d.delivery_attempts = d.delivery_attempts.filter(a => a.id !== att[att.length - 1].id);
  }
  db.persist();
  res.json(boxDetail(box));
});

// ---------- containers ----------
app.get('/api/containers', requireAuth, (req, res) => {
  const d = db.get();
  res.json(scopeContainerList(req.user, d.containers.slice(), effectiveScope(req))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(c => ({ ...c, box_count: d.boxes.filter(b => b.container_id === c.id).length })));
});
app.post('/api/containers', requireRole(...ADMINS, ...ROLE.BRANCH_ADMINS, ...SHIPPERS), (req, res) => {
  const b = req.body || {};
  if (!b.container_number) return res.status(400).json({ error: 'Container number is required' });
  // Containers are booked at origin by a branch. Head office consolidates nothing itself,
  // so an HQ-side user has no origin to book from.
  const bookingBranch = BRANCH.branchForRole(req.user.role);
  if (bookingBranch === 'HQ_MANILA') {
    return res.status(400).json({ error: 'Containers are booked by the origin branch (Thailand or Cambodia), not by head office.' });
  }
  // A branch books its own containers: the origin port must be one of its own country's
  // ports, so a Thailand booking can never be filed against Cambodia.
  const scope = branchScope(req.user);
  let originPort = b.origin_port || '';
  if (scope) {
    const allowed = REF.originPortsFor(scope);
    if (!originPort) originPort = allowed[0];
    if (!allowed.includes(originPort)) {
      return res.status(400).json({ error: `Your branch can only book containers from ${scope} (${allowed.join(' or ')}).` });
    }
  }
  const c = {
    id: db.nextId('container'), container_number: String(b.container_number).trim().toUpperCase(),
    size: SM.CONTAINER_SIZES.includes(b.size) ? b.size : 'C40',
    shipping_line: b.shipping_line || '', vessel_name: b.vessel_name || '', booking_number: b.booking_number || '',
    origin_port: originPort, destination_port: b.destination_port || '',
    // The branch that booked it — used for the per-branch container view.
    booked_by_branch: BRANCH.branchForRole(req.user.role) || (scope ? (BRANCH.byCountry(scope) || {}).key : null),
    booked_by: req.user.name,
    etd: b.etd || null, eta: b.eta || null, actual_departure: null, actual_arrival: null,
    // Short code appended to each loaded box's number so you can see, at a glance,
    // which container a box travelled in (e.g. VF-2026-000013-01/C1). Always assigned
    // automatically in sequence — the client cannot set it.
    // Sequenced per origin, so Bangkok's and Phnom Penh's codes never interleave.
    load_code: nextLoadCode(db.get(), scope || REF.countryForOriginPort(originPort)),
    load_plan_notes: '',
    status: 'BOOKING', created_at: new Date().toISOString()
  };
  db.get().containers.push(c);
  db.persist();
  res.json(c);
});
app.get('/api/containers/:id', requireAuth, (req, res) => {
  const d = db.get();
  const c = getContainer(req, res, req.params.id);
  if (!c) return;
  const boxes = d.boxes.filter(b => b.container_id === c.id).map(boxRow);
  // manifest documents bundle (arrival notice view)
  const shipmentIds = [...new Set(boxes.map(b => b.shipment_id))];
  const documents = d.shipments.filter(s => shipmentIds.includes(s.id)).map(s => ({
    shipment_number: s.shipment_number,
    sender_name: (d.customers.find(x => x.id === s.sender_id) || {}).full_name || '',
    packing_list_file: s.packing_list_file, passport_file: s.passport_file, receiving_form_file: s.receiving_form_file
  }));
  // discrepancies: manifest (LOADED on this container) vs scanned at warehouse
  const notScanned = boxes.filter(b => ['LOADED_CONTAINER', 'IN_TRANSIT', 'ARRIVED_PORT'].includes(b.status));
  res.json({
    ...c, boxes, documents,
    size_label: SM.CONTAINER_SIZE_LABELS[c.size] || c.size,
    pending_strip: notScanned.map(b => b.container_box_number || b.box_number)
  });
});
app.put('/api/containers/:id', requireRole(...AGENTS), (req, res) => {
  const c = getContainer(req, res, req.params.id);
  if (!c) return;
  const b = req.body || {};
  if (b.status && !SM.CONTAINER_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid container status' });
  for (const k of ['container_number', 'size', 'shipping_line', 'vessel_name', 'booking_number', 'origin_port', 'destination_port', 'etd', 'eta', 'status']) {
    if (k in b) c[k] = b[k];
  }
  db.persist();
  res.json(c);
});
// Load a box (by scan/search) into a container: RECEIVED_ORIGIN → LOADED_CONTAINER
app.post('/api/containers/:id/load', requireRole(...ADMINS, ...ROLE.BRANCH_ADMINS, ...SHIPPERS), (req, res) => {
  const d = db.get();
  const c = getContainer(req, res, req.params.id);
  if (!c) return;
  const box = d.boxes.find(b => b.id === +req.body.box_id);
  if (!box) return res.status(404).json({ error: 'Box not found' });
  if (box.container_id && box.container_id !== c.id) return res.status(400).json({ error: 'Box is already on another container' });
  // A branch loads only its own boxes into its own containers.
  const scope = branchScope(req.user);
  if (scope) {
    const shipment = d.shipments.find(s => s.id === box.shipment_id) || {};
    if (shipment.origin_country !== scope) {
      return res.status(403).json({ error: `That box is not from your branch (${scope}) — it cannot be loaded here.` });
    }
    if (c.origin_port && !REF.originPortsFor(scope).includes(c.origin_port)) {
      return res.status(403).json({ error: 'That container was booked by another branch.' });
    }
  }
  const err = changeBoxStatus(box, 'LOADED_CONTAINER', req.user, `Loaded into ${c.container_number}`);
  if (err) return res.status(400).json({ error: err });
  box.container_id = c.id;
  // Stamp the container's load code onto the box number so the box is traceable to the
  // container it shipped in, and record its load sequence for the load plan.
  box.container_load_code = c.load_code;
  box.container_box_number = `${box.box_number}/${c.load_code}`;
  box.load_sequence = d.boxes.filter(b => b.container_id === c.id).length;
  if (c.status === 'BOOKING') c.status = 'LOADING';
  db.persist();
  res.json({ box: boxRow(box), box_count: d.boxes.filter(b => b.container_id === c.id).length });
});
// Depart: container + all boxes → IN_TRANSIT
app.post('/api/containers/:id/depart', requireRole(...ADMINS, ...ROLE.BRANCH_ADMINS, ...SHIPPERS), (req, res) => {
  const d = db.get();
  const c = getContainer(req, res, req.params.id);
  if (!c) return;
  const boxes = d.boxes.filter(b => b.container_id === c.id && b.status === 'LOADED_CONTAINER');
  for (const box of boxes) changeBoxStatus(box, 'IN_TRANSIT', req.user, `Container ${c.container_number} departed`);
  c.status = 'IN_TRANSIT';
  c.actual_departure = new Date().toISOString();
  db.persist();
  res.json({ ok: true, boxes_updated: boxes.length });
});
// Arrive: container + all boxes → ARRIVED_PORT (SMS to receivers)
app.post('/api/containers/:id/arrive', requireRole(...AGENTS), (req, res) => {
  const d = db.get();
  const c = getContainer(req, res, req.params.id);
  if (!c) return;
  const boxes = d.boxes.filter(b => b.container_id === c.id && b.status === 'IN_TRANSIT');
  for (const box of boxes) changeBoxStatus(box, 'ARRIVED_PORT', req.user, `Container ${c.container_number} arrived at ${c.destination_port}`);
  c.status = 'ARRIVED';
  c.actual_arrival = new Date().toISOString();
  db.persist();
  res.json({ ok: true, boxes_updated: boxes.length });
});
// Revert / correct a container's status by one step (undo a mis-clicked action). Reverses the
// box cascade for Depart (IN_TRANSIT→LOADING) and Arrive (ARRIVED→IN_TRANSIT).
app.post('/api/containers/:id/revert', requireRole(...ADMINS), (req, res) => {
  const d = db.get();
  const c = getContainer(req, res, req.params.id);
  if (!c) return;
  const prev = CONTAINER_PREV[c.status];
  if (!prev) return res.status(400).json({ error: `Container is at ${c.status} — there is no earlier status to revert to.` });
  let reversed = 0;
  if (c.status === 'IN_TRANSIT') {
    for (const box of d.boxes.filter(b => b.container_id === c.id && b.status === 'IN_TRANSIT')) {
      forceBoxStatus(box, 'LOADED_CONTAINER', req.user, `Correction: departure of ${c.container_number} reversed`); reversed++;
    }
    c.actual_departure = null;
  } else if (c.status === 'ARRIVED') {
    for (const box of d.boxes.filter(b => b.container_id === c.id && b.status === 'ARRIVED_PORT')) {
      forceBoxStatus(box, 'IN_TRANSIT', req.user, `Correction: arrival of ${c.container_number} reversed`); reversed++;
    }
    c.actual_arrival = null;
  } else if (c.status === 'LOADING') {
    if (d.boxes.some(b => b.container_id === c.id)) {
      return res.status(400).json({ error: 'Unload all boxes before reverting this container to Booking.' });
    }
  }
  c.status = prev;
  db.persist();
  res.json({ ...c, reverted_to: prev, boxes_reverted: reversed });
});
// Warehouse stripping scan: each box → RECEIVED_WAREHOUSE
app.post('/api/containers/:id/strip-scan', requireRole(...PH_SIDE), (req, res) => {
  const d = db.get();
  const c = getContainer(req, res, req.params.id);
  if (!c) return;
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

// ---------- load plan (consignee agent decides discharge order / grouping) ----------
// Groups the container's boxes by destination region so the PH-side agent can plan the
// strip + regional dispatch before the vessel arrives.
app.get('/api/containers/:id/load-plan', requireAuth, (req, res) => {
  const d = db.get();
  const c = getContainer(req, res, req.params.id);
  if (!c) return;
  const boxes = d.boxes.filter(b => b.container_id === c.id).map(boxRow);
  const groups = {};
  for (const b of boxes) {
    const key = b.region || b.receiver_region || 'UNASSIGNED';
    (groups[key] = groups[key] || []).push(b);
  }
  const byRegion = Object.entries(groups)
    .map(([region, list]) => ({
      region,
      box_count: list.length,
      total_weight_kg: +list.reduce((sum, b) => sum + (b.weight_kg || 0), 0).toFixed(1),
      boxes: list.sort((a, b) => (a.load_sequence || 0) - (b.load_sequence || 0))
    }))
    .sort((a, b) => b.box_count - a.box_count);
  res.json({
    container_number: c.container_number,
    load_code: c.load_code,
    size_label: SM.CONTAINER_SIZE_LABELS[c.size] || c.size,
    status: c.status,
    vessel_name: c.vessel_name, eta: c.eta,
    load_plan_notes: c.load_plan_notes || '',
    total_boxes: boxes.length,
    total_weight_kg: +boxes.reduce((s, b) => s + (b.weight_kg || 0), 0).toFixed(1),
    by_region: byRegion
  });
});
// Consignee agent records the discharge/dispatch plan for this container.
app.put('/api/containers/:id/load-plan', requireRole(...ADMINS, 'CONSIGNEE_AGENT'), (req, res) => {
  const c = getContainer(req, res, req.params.id);
  if (!c) return;
  c.load_plan_notes = String((req.body || {}).load_plan_notes || '').trim();
  db.persist();
  res.json({ ok: true, load_plan_notes: c.load_plan_notes });
});

// ---------- trucking trips ----------
app.get('/api/trips', requireRole(...ROLE.PH_SIDE, 'ACCOUNTING'), (req, res) => {
  const d = db.get();
  res.json(d.trips.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(t => ({ ...t, box_count: d.boxes.filter(b => b.trucking_assignment_id === t.id).length })));
});
app.post('/api/trips', requireRole(...ADMINS, 'CONSIGNEE_AGENT'), (req, res) => {
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
app.get('/api/trips/:id', requireRole(...ROLE.PH_SIDE, 'ACCOUNTING'), (req, res) => {
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
app.put('/api/trips/:id', requireRole(...ADMINS, 'CONSIGNEE_AGENT'), (req, res) => {
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
app.post('/api/trips/:id/assign-boxes', requireRole(...ADMINS, 'CONSIGNEE_AGENT'), (req, res) => {
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
app.post('/api/trips/:id/remove-box', requireRole(...ADMINS, 'CONSIGNEE_AGENT'), (req, res) => {
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
app.post('/api/trips/:id/dispatch', requireRole(...ADMINS, 'CONSIGNEE_AGENT'), (req, res) => {
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
    const box = getBox(req, res, req.params.id);
    if (!box) return;
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
  const list = scopeBoxList(req.user, d.boxes, effectiveScope(req)).filter(b => b.status === 'RETURNED').map(b => {
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
  // An SMS names a box and a customer's phone number, so the log follows the box scope.
  const visible = new Set(scopeBoxList(req.user, d.boxes, effectiveScope(req)).map(b => b.id));
  const list = d.notifications
    .filter(n => n.box_id == null || visible.has(n.box_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 300)
    .map(n => ({ ...n, box_number: (d.boxes.find(b => b.id === n.box_id) || {}).box_number || '' }));
  res.json(list);
});
app.post('/api/notifications/retry/:id', requireRole(...ADMINS), (req, res) => {
  const n = db.get().notifications.find(x => x.id === +req.params.id);
  if (!n) return res.status(404).json({ error: 'Not found' });
  n.status = 'QUEUED';
  n.attempts = 0;
  n.last_error = null;
  db.persist();
  res.json(n);
});

// ---------- SMS templates (admin) ----------
app.get('/api/templates', requireRole(...ADMINS), (req, res) => {
  const d = db.get();
  const merged = {};
  for (const [k, v] of Object.entries(notif.DEFAULT_TEMPLATES)) {
    merged[k] = (d.settings.smsTemplates || {})[k] || v;
  }
  res.json({ templates: merged, placeholders: ['box_number', 'link', 'sender_first_name', 'receiver_first_name', 'driver_name', 'driver_contact', 'vfic_phone', 'received_by_name', 'reason'] });
});
app.put('/api/templates/:key', requireRole(...ADMINS), (req, res) => {
  const d = db.get();
  if (!notif.DEFAULT_TEMPLATES[req.params.key]) return res.status(404).json({ error: 'Unknown template' });
  const { body } = req.body || {};
  if (!body) return res.status(400).json({ error: 'Template body required' });
  d.settings.smsTemplates = d.settings.smsTemplates || {};
  d.settings.smsTemplates[req.params.key] = { recipients: notif.DEFAULT_TEMPLATES[req.params.key].recipients, body };
  db.persist();
  res.json(d.settings.smsTemplates[req.params.key]);
});

// ---------- BIR registration details printed on every official receipt ----------
// These are VFIC's own registration particulars, not secrets — they are required to appear
// on the face of a Philippine official receipt.
const BIR_FIELDS = ['tin', 'accreditation_no', 'min', 'serial_no', 'permit_no'];
// Held per branch, because each one issues its own receipts under its own registration.
// Falls back to the original single set so receipts printed before the split keep their
// details, and so a branch that has not filled its own in still prints head office's.
function birFor(d, branchKey) {
  d.settings.birByBranch = d.settings.birByBranch || {};
  const own = d.settings.birByBranch[branchKey];
  const base = d.settings.bir || {};
  return Object.fromEntries(BIR_FIELDS.map(k => [k, (own && own[k]) || base[k] || '']));
}
app.get('/api/settings/bir', requireAuth, (req, res) => {
  const branch = accountingBranch(req);
  res.json({
    ...birFor(db.get(), branch),
    branch,
    editable: ROLE.isAnyAdmin(req.user.role)
  });
});
app.put('/api/settings/bir', requireRole(...ROLE.ANY_ADMIN), (req, res) => {
  const d = db.get();
  // accountingBranch pins a branch admin to their own branch, so they can only ever write
  // their own receipt details — head office edits any branch by passing ?branch=.
  const branch = accountingBranch(req);
  d.settings.birByBranch = d.settings.birByBranch || {};
  const rec = d.settings.birByBranch[branch] || (d.settings.birByBranch[branch] = {});
  for (const k of BIR_FIELDS) {
    if (k in (req.body || {})) rec[k] = String(req.body[k] || '').trim();
  }
  db.persist();
  res.json({ ...birFor(d, branch), branch, editable: true });
});

// Receipt numbering. The Machine Identification No. identifies this deployment and is
// derived from its node id, so it is stable without anyone typing it. The Serial No. is
// assigned to a shipment the first time its official receipt is produced, then never changes.
function machineIdentificationNo(d, branchKey) {
  const bir = birFor(d, branchKey || 'HQ_MANILA');
  if (bir.min) return bir.min;                              // an explicit BIR-issued MIN wins
  const seed = `${NODE.NODE_ID}:${d.settings.publicBaseUrl || ''}`;
  const digits = crypto.createHash('sha1').update(seed).digest('hex').replace(/\D/g, '');
  return (digits + '00000000').slice(0, 8);
}
app.get('/api/receipt-meta/:shipmentId', requireAuth, (req, res) => {
  const d = db.get();
  const sh = getShipment(req, res, req.params.shipmentId);
  if (!sh) return;
  // A receipt carries the registration of the branch that issued it, not head office's.
  const issuingBranch = (BRANCH.byCountry(sh.origin_country) || {}).key || 'HQ_MANILA';
  const bir = birFor(d, issuingBranch);
  if (!sh.or_serial_no) {
    d.seq.or_serial = (d.seq.or_serial || 0) + 1;
    const prefix = (bir.serial_no || '').trim();
    sh.or_serial_no = prefix
      ? `${prefix}-${String(d.seq.or_serial).padStart(6, '0')}`
      : `${BRANCH.countryCode(sh.origin_country)}${new Date().getFullYear()}-${String(d.seq.or_serial).padStart(6, '0')}`;
    sh.or_issued_at = new Date().toISOString();
    db.persist();
  }
  res.json({
    tin: bir.tin || '',
    accreditation_no: bir.accreditation_no || '',
    permit_no: bir.permit_no || '',
    min: machineIdentificationNo(d, issuingBranch),
    serial_no: sh.or_serial_no,
    issued_at: sh.or_issued_at
  });
});

// ---------- rate settings (admin) ----------
app.put('/api/settings/rates', requireRole(...ADMINS), (req, res) => {
  const d = db.get();
  const { excessWeightChargePerKg, excessWeightChargeCurrency } = req.body || {};
  if (excessWeightChargePerKg !== undefined) {
    const v = excessWeightChargePerKg === null || excessWeightChargePerKg === '' ? null : +excessWeightChargePerKg;
    if (v !== null && (isNaN(v) || v < 0)) return res.status(400).json({ error: 'Excess charge must be a positive number' });
    d.settings.excessWeightChargePerKg = v;
  }
  if (excessWeightChargeCurrency) d.settings.excessWeightChargeCurrency = String(excessWeightChargeCurrency).toUpperCase();
  db.persist();
  res.json({
    excessWeightChargePerKg: d.settings.excessWeightChargePerKg,
    excessWeightChargeCurrency: d.settings.excessWeightChargeCurrency || 'PHP'
  });
});

// ---------- users (admin) ----------
// Catalogue of assignable roles (for the Admin → Users role picker).
// A branch admin may only assign roles inside their own branch.
app.get('/api/roles', requireRole(...ROLE.ANY_ADMIN), (req, res) => {
  const allowed = ROLE.manageableRoles(req.user.role);
  res.json({
    roles: ROLE.ROLES.filter(r => allowed.includes(r.key)),
    developer_only: ['DEVELOPER_ADMIN'],
    branch_scoped: ROLE.isBranchAdmin(req.user.role)
  });
});

// ---------- replication between deployments ----------
const NODE = require('./lib/node');
const SYNC = require('./lib/sync');

// Peer-to-peer endpoint: authenticated by the shared sync secret, not by a user session.
function requireSyncSecret(req, res, next) {
  if (!NODE.SYNC_SECRET) return res.status(503).json({ error: 'Sync is not configured on this deployment' });
  const presented = req.get('x-vfic-sync') || '';
  const a = Buffer.from(presented);
  const b = Buffer.from(NODE.SYNC_SECRET);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: 'Invalid sync credentials' });
  next();
}

// A peer asks for everything this node owns since their cursor.
app.get('/api/sync/pull', requireSyncSecret, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(SYNC.changesSince(db.get(), req.query.since));
});

// A peer pushes its own records to this node (the reverse direction, for firewalled peers).
app.post('/api/sync/push', requireSyncSecret, (req, res) => {
  const result = SYNC.applyChanges(db.get(), req.body || {});
  if (result.applied) db.persist();
  res.json(result);
});

// A settlement belongs to the branch that issued it, and replication rightly refuses to let
// any other node rewrite it — otherwise ownership means nothing. But the billed branch has
// to be able to acknowledge, remit or dispute, and that action has to reach the issuer.
//
// So the action travels as a request rather than as a record: the billed node asks the
// issuing node to apply it, and the issuing node applies it to its own copy. Ownership is
// preserved, and only the three statuses that belong to the billed side are accepted.
app.post('/api/sync/interbranch-ack', requireSyncSecret, (req, res) => {
  const d = db.get();
  const { uid, status, notes, settled_reference, by } = req.body || {};
  const inv = (d.interbranch_invoices || []).find(i => i._uid === uid);
  if (!inv) return res.status(404).json({ error: 'Unknown settlement' });
  if (inv._node && inv._node !== NODE.NODE_ID) return res.status(409).json({ error: 'This node does not own that settlement' });
  if (!IB_BILLED_ACTIONS.includes(status)) return res.status(400).json({ error: 'Not an action the billed branch may take' });
  inv.history = inv.history || [];
  inv.history.push({ status: inv.status, at: new Date().toISOString(), by: by || 'branch' });
  if (status === 'RECEIVED') inv.received_at = new Date().toISOString();
  if (status === 'REMITTED') inv.remitted_at = new Date().toISOString();
  if (notes != null) inv.notes = String(notes).trim();
  if (settled_reference != null) inv.settled_reference = String(settled_reference).trim();
  inv.status = status;
  db.persist();
  res.json({ ok: true, status: inv.status });
});

// Identity — lets the developer console confirm a node is reachable and which one it is.
app.get('/api/sync/whoami', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ node: NODE.SELF, sync_enabled: NODE.syncEnabled(), time: new Date().toISOString() });
});

// Status + manual trigger — Developer Admin only.
app.get('/api/sync/status', requireRole('DEVELOPER_ADMIN'), (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(SYNC.status(db.get()));
});
// Any admin can pull, not just the Developer. A branch admin waiting on a settlement head
// office has issued was previously unable to fetch it at all: the only way to pull was the
// Developer Console, which a branch does not have. They were left watching an empty page.
app.post('/api/sync/run', requireRole(...ROLE.ANY_ADMIN), async (req, res) => {
  const result = await SYNC.runSync(db.get());
  markAutoSynced(db.get());
  db.persist();
  res.json(result);
});

// ---- automatic pull ----
// Each deployment has its own database, so anything raised on another node — an inter-branch
// settlement above all — only exists here once this node pulls it. Leaving that to a manual
// button meant a settlement issued in Manila silently never reached Thailand.
//
// So the views that read cross-node data pull first, at most once every AUTO_SYNC_MS. Cheap
// because a pull with nothing new returns an empty change set, and serverless-safe because
// it runs inside the request rather than a background worker.
const AUTO_SYNC_MS = Math.max(0, +(process.env.VFIC_AUTO_SYNC_SECONDS || 60) * 1000);
function markAutoSynced(d) {
  d.sync_state = d.sync_state || {};
  d.sync_state._auto_last = new Date().toISOString();
}
function autoSyncDue(d) {
  if (!AUTO_SYNC_MS || !NODE.syncEnabled()) return false;
  const last = Date.parse(((d.sync_state || {})._auto_last) || '');
  return !isFinite(last) || (Date.now() - last) >= AUTO_SYNC_MS;
}
// Hand a record straight to the branch it concerns, instead of waiting for that branch to
// poll. A settlement is an event — the moment head office issues one, the branch being
// billed should have it. Pulling alone left them staring at an empty page until someone
// happened to sync.
//
// Best effort by design: the record is already saved here and replication will carry it
// anyway, so a peer that is down delays delivery rather than failing the issue.
async function pushToBranch(d, branchKey, collection, record) {
  if (!NODE.syncEnabled() || !record) return null;
  const peer = NODE.PEERS.find(p => p.id === branchKey);
  if (!peer) return null;
  // Write our own change before going near the network. The document lives in one in-memory
  // copy that every request reloads and rewrites, so awaiting a fetch while holding an
  // unflushed mutation lets a concurrent request save over it — which silently reverted an
  // issued settlement back to DRAFT. Flushing first closes that window.
  try { await db.flush(); } catch (e) { console.warn('Flush before push failed:', e.message); }
  try {
    const res = await fetch(`${peer.url}/api/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-vfic-sync': NODE.SYNC_SECRET, 'x-vfic-node': NODE.NODE_ID },
      body: JSON.stringify({ node: NODE.NODE_ID, collections: { [collection]: [record] } })
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 100)}`);
    return await res.json();
  } catch (e) {
    console.warn(`Push to ${branchKey} failed (${e.message}) — replication will carry it instead.`);
    return null;
  }
}
// The billed branch's side of the conversation: ask the issuing node to record that we have
// acknowledged, remitted or disputed. Best effort — our own copy is already saved, so a peer
// that is briefly down means the issuer sees it late, not that the action is lost.
async function tellIssuer(inv, status, actorName) {
  if (!NODE.syncEnabled() || !IB_BILLED_ACTIONS.includes(status)) return null;
  const peer = NODE.PEERS.find(p => p.id === inv._node);
  if (!peer) return null;
  try { await db.flush(); } catch (e) { /* saved on the next flush */ }
  try {
    const res = await fetch(`${peer.url}/api/sync/interbranch-ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-vfic-sync': NODE.SYNC_SECRET, 'x-vfic-node': NODE.NODE_ID },
      body: JSON.stringify({ uid: inv._uid, status, notes: inv.notes, settled_reference: inv.settled_reference, by: actorName })
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 100)}`);
    return await res.json();
  } catch (e) {
    console.warn(`Could not tell ${inv._node} about the ${status} (${e.message}).`);
    return null;
  }
}

// Awaited: the caller is about to render data that may live on a peer.
async function autoSync(d) {
  if (!autoSyncDue(d)) return null;
  markAutoSynced(d);            // set first, so a slow peer cannot cause a pull stampede
  db.persist();
  // Same reason as pushToBranch: don't hold an unflushed change across network I/O.
  try { await db.flush(); } catch (e) { /* fall through — the pull is still worth trying */ }
  try {
    const result = await SYNC.runSync(d);
    db.persist();
    return result;
  } catch (e) {
    console.warn('Auto-sync failed:', e.message);
    return null;
  }
}

// Reach out to every peer and report what it says about itself — the network overview.
app.get('/api/sync/network', requireRole('DEVELOPER_ADMIN'), async (req, res) => {
  const d = db.get();
  const state = d.sync_state || {};
  const peers = await Promise.all(NODE.PEERS.map(async (p) => {
    const started = Date.now();
    try {
      const r = await fetch(`${p.url}/api/sync/whoami`, { headers: { 'x-vfic-sync': NODE.SYNC_SECRET } });
      const body = await r.json();
      return { ...p, reachable: r.ok, ms: Date.now() - started, remote: body.node, sync_enabled: body.sync_enabled, ...state[p.id] };
    } catch (e) {
      return { ...p, reachable: false, error: e.message, ms: Date.now() - started, ...state[p.id] };
    }
  }));
  res.json({ self: SYNC.status(d), peers });
});

// ---------- role → module permissions ----------

// What the signed-in user may open — drives the sidebar and client-side routing.
app.get('/api/my-modules', requireAuth, (req, res) => {
  const d = db.get();
  const modules = MODULES.modulesForRole(req.user.role, d.settings.roleModules);
  const branchKey = BRANCH.branchForRole(req.user.role);
  res.json({
    role: req.user.role,
    role_label: ROLE.ROLE_LABELS[req.user.role] || req.user.role,
    modules,
    catalogue: MODULES.MODULES.filter(m => modules.includes(m.key)),
    branch: branchKey ? BRANCH.byKey(branchKey) : null,
    sees_all_branches: BRANCH.seesAllBranches(req.user.role),
    // HQ admins get the branch list so the sidebar can show one operations block per branch.
    branches: BRANCH.seesAllBranches(req.user.role)
      ? BRANCH.resolve(d.settings.branches).map(b => ({
          key: b.key, short: b.short, label: b.label, country: b.country, type: b.type,
          flag: (BRANCH.portalForBranch(b.key) || {}).flag || ''
        }))
      : []
  });
});

// The full role × module matrix (Admin → Roles & Modules).
app.get('/api/role-modules', requireRole(...ROLE.ANY_ADMIN), (req, res) => {
  const d = db.get();
  // A branch admin manages only their own branch's roles, so they are shown only those —
  // the matrix is network-wide and the rest is not theirs to change.
  const editable = ROLE.manageableRoles(req.user.role);
  const visible = ROLE.isBranchAdmin(req.user.role)
    ? ROLE.ROLES.filter(r => editable.includes(r.key))
    : ROLE.ROLES;
  res.json({
    modules: MODULES.MODULES,
    roles: visible,
    matrix: MODULES.matrix(visible.map(r => r.key), d.settings.roleModules),
    locked: MODULES.LOCKED,
    defaults: MODULES.DEFAULTS,
    editable_roles: editable
  });
});
app.put('/api/role-modules', requireRole(...ROLE.ANY_ADMIN), (req, res) => {
  const d = db.get();
  const incoming = (req.body || {}).matrix;
  if (!incoming || typeof incoming !== 'object') return res.status(400).json({ error: 'A matrix of role → modules is required' });
  // Merge rather than replace. A branch admin submits only the roles they can see, and a
  // wholesale replace would silently reset every other role to its defaults.
  const next = { ...(d.settings.roleModules || {}) };
  const allowed = ROLE.manageableRoles(req.user.role);
  for (const role of ROLE.ROLE_KEYS) {
    if (!Array.isArray(incoming[role])) continue;
    if (!allowed.includes(role)) continue;   // not this admin's role to change
    const picked = incoming[role].filter(k => MODULES.MODULE_KEYS.includes(k));
    next[role] = [...new Set([...picked, ...(MODULES.LOCKED[role] || [])])];
  }
  // A non-developer admin must not be able to lock the Developer Admin out of anything.
  if (req.user.role !== 'DEVELOPER_ADMIN') next.DEVELOPER_ADMIN = MODULES.MODULE_KEYS.slice();
  d.settings.roleModules = next;
  db.persist();
  res.json({ matrix: MODULES.matrix(ROLE.ROLE_KEYS, next) });
});

// Reject a request whose role has the module switched off.
function requireModule(moduleKey) {
  return (req, res, next) => requireAuth(req, res, () => {
    if (!MODULES.canUseModule(req.user.role, moduleKey, db.get().settings.roleModules)) {
      return res.status(403).json({ error: `The ${MODULES.MODULE_LABELS[moduleKey] || moduleKey} module is not enabled for your role` });
    }
    next();
  });
}

// ---------- branches / business partners ----------
// Consolidated view across all origin partners — Master/Developer Admin only.
app.get('/api/branches', requireRole(...ADMINS), (req, res) => {
  const d = db.get();
  const list = BRANCH.resolve(d.settings.branches);
  const withStats = list.map(b => {
    const shipments = d.shipments.filter(s => b.type === 'HQ' ? false : s.origin_country === b.country);
    const shipmentIds = shipments.map(s => s.id);
    const boxes = d.boxes.filter(x => shipmentIds.includes(x.shipment_id));
    const delivered = boxes.filter(x => x.status === 'DELIVERED').length;
    const invoices = (d.invoices || []).filter(i => i.status !== 'VOID' && shipmentIds.includes(i.shipment_id));
    const revenue = +invoices.reduce((n, i) => n + i.total, 0).toFixed(2);
    return {
      ...b,
      staff: d.users.filter(u => BRANCH.branchForRole(ROLE.normalizeRole(u.role)) === b.key && u.active).length,
      shipments: shipments.length,
      boxes: boxes.length,
      delivered,
      in_transit: boxes.filter(x => ['LOADED_CONTAINER', 'IN_TRANSIT', 'ARRIVED_PORT'].includes(x.status)).length,
      revenue,
      commission_due: +(revenue * (+b.commission_pct || 0) / 100).toFixed(2)
    };
  });
  res.json({ branches: withStats, currency: rateCardFor(d, 'HQ_MANILA').currency });
});

// Edit a partner's commercial details. Master/Developer Admin only.
app.put('/api/branches/:key', requireRole(...ADMINS), (req, res) => {
  const d = db.get();
  if (!BRANCH.BRANCH_KEYS.includes(req.params.key)) return res.status(404).json({ error: 'Unknown branch' });
  const b = req.body || {};
  d.settings.branches = d.settings.branches || {};
  const cur = d.settings.branches[req.params.key] || {};
  for (const k of ['partner_name', 'address', 'contact', 'email', 'tax_id', 'settlement_terms']) {
    if (k in b) cur[k] = String(b[k] || '').trim();
  }
  if ('commission_pct' in b) {
    const pct = Number(b.commission_pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return res.status(400).json({ error: 'Commission must be between 0 and 100' });
    cur.commission_pct = pct;
  }
  d.settings.branches[req.params.key] = cur;
  db.persist();
  res.json(BRANCH.resolve(d.settings.branches).find(x => x.key === req.params.key));
});
app.get('/api/users', requireRole(...ROLE.ANY_ADMIN), (req, res) => {
  // A branch admin only sees the staff of their own branch.
  const myBranch = BRANCH.branchForRole(req.user.role);
  const scoped = ROLE.isBranchAdmin(req.user.role);
  res.json(db.get().users
    .map(({ password_hash, ...u }) => {
      const role = ROLE.normalizeRole(u.role);
      return { ...u, role, role_label: ROLE.ROLE_LABELS[role] || role, branch: BRANCH.branchForRole(role) };
    })
    .filter(u => !scoped || u.branch === myBranch));
});
app.post('/api/users', requireRole(...ROLE.ANY_ADMIN), (req, res) => {
  const { name, email, role, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (!ROLE.ROLE_KEYS.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  // Only a Developer Admin can mint another Developer Admin.
  if (role === 'DEVELOPER_ADMIN' && req.user.role !== 'DEVELOPER_ADMIN') {
    return res.status(403).json({ error: 'Only a Developer Admin can create a Developer Admin account' });
  }
  // A branch admin may only create staff for their own branch.
  if (!ROLE.manageableRoles(req.user.role).includes(role)) {
    return res.status(403).json({ error: 'You can only create staff accounts for your own branch' });
  }
  if (db.get().users.find(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(400).json({ error: 'Email already in use' });
  const u = { id: db.nextId('user'), name, email, role, password_hash: hashPassword(password), active: true, created_at: new Date().toISOString() };
  db.get().users.push(u);
  db.persist();
  const { password_hash, ...safe } = u;
  res.json(safe);
});
app.put('/api/users/:id', requireRole(...ROLE.ANY_ADMIN), (req, res) => {
  const d = db.get();
  const u = d.users.find(x => x.id === +req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  // A branch admin can only touch their own branch's staff, and only assign their own roles.
  if (ROLE.isBranchAdmin(req.user.role)) {
    const myBranch = BRANCH.branchForRole(req.user.role);
    if (BRANCH.branchForRole(ROLE.normalizeRole(u.role)) !== myBranch) {
      return res.status(403).json({ error: 'You can only manage staff in your own branch' });
    }
    if ('role' in b && !ROLE.manageableRoles(req.user.role).includes(b.role)) {
      return res.status(403).json({ error: 'You can only assign roles within your own branch' });
    }
  }
  if ('role' in b) {
    if (!ROLE.ROLE_KEYS.includes(b.role)) return res.status(400).json({ error: 'Invalid role' });
    if ((b.role === 'DEVELOPER_ADMIN' || ROLE.normalizeRole(u.role) === 'DEVELOPER_ADMIN') && req.user.role !== 'DEVELOPER_ADMIN') {
      return res.status(403).json({ error: 'Only a Developer Admin can grant or change a Developer Admin role' });
    }
  }
  // Don't let an admin lock everyone out by demoting/deactivating the last admin.
  const willLoseAdmin = (('role' in b && !ROLE.ADMINS.includes(b.role)) || b.active === false) && ROLE.ADMINS.includes(ROLE.normalizeRole(u.role));
  if (willLoseAdmin) {
    const otherAdmins = d.users.filter(x => x.id !== u.id && x.active && ROLE.ADMINS.includes(ROLE.normalizeRole(x.role)));
    if (!otherAdmins.length) return res.status(400).json({ error: 'This is the last active admin — assign another admin first' });
  }
  for (const k of ['name', 'role', 'active']) if (k in b) u[k] = b[k];
  if (b.password) u.password_hash = hashPassword(b.password);
  db.persist();
  const { password_hash, ...safe } = u;
  res.json({ ...safe, role_label: ROLE.ROLE_LABELS[ROLE.normalizeRole(safe.role)] || safe.role });
});

// ---------- sender self-service accounts (public) ----------
// A sender can create an account to track their boxes, park a half-finished booking as a
// draft, and see everything they have sent before. Sessions live on their own cookie and
// audience, entirely separate from staff sessions.
function senderFromReq(req) {
  const payload = sess.verify(req.cookies && req.cookies[sess.SENDER_COOKIE_NAME]);
  if (!sess.isSenderToken(payload)) return null;
  const d = db.get();
  return (d.sender_accounts || []).find(a => a.id === payload.sid && a.active !== false) || null;
}
function requireSender(req, res, next) {
  const a = senderFromReq(req);
  if (!a) return res.status(401).json({ error: 'Please sign in to your sender account' });
  req.sender = a;
  next();
}
const senderPublic = (a) => ({
  id: a.id, name: a.name, given_name: a.given_name || '', surname: a.surname || '',
  email: a.email, phone: a.phone, country: a.country || '',
  heard_about_us: a.heard_about_us || '', created_at: a.created_at
});

app.post('/api/public/sender/signup', rateLimit, (req, res) => {
  const d = db.get();
  d.sender_accounts = d.sender_accounts || [];
  const b = req.body || {};
  const given_name = String(b.given_name || '').trim();
  const surname = String(b.surname || '').trim();
  const name = [given_name, surname].filter(Boolean).join(' ') || String(b.name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  if (!given_name && !name) return res.status(400).json({ error: 'Your given name is required' });
  if (given_name && !surname) return res.status(400).json({ error: 'Your surname is required' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'A valid email address is required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (d.sender_accounts.some(a => a.email === email)) return res.status(400).json({ error: 'An account with that email already exists — please sign in instead' });
  const acct = {
    id: db.nextId('sender_account'), name, given_name, surname, email,
    phone: String(b.phone || '').trim(),
    country: String(b.country || '').trim(),
    // Marketing attribution — where this sender first heard about VFIC.
    heard_about_us: String(b.heard_about_us || '').trim(),
    password_hash: hashPassword(password),
    drafts: [], active: true, created_at: new Date().toISOString()
  };
  d.sender_accounts.push(acct);
  db.persist();
  res.cookie(sess.SENDER_COOKIE_NAME, sess.senderTokenFor(acct.id), sess.cookieOptions);
  res.json(senderPublic(acct));
});

app.post('/api/public/sender/signin', rateLimit, (req, res) => {
  const d = db.get();
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  const acct = (d.sender_accounts || []).find(a => a.email === email && a.active !== false);
  if (!acct || !verifyPassword(password, acct.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
  res.cookie(sess.SENDER_COOKIE_NAME, sess.senderTokenFor(acct.id), sess.cookieOptions);
  res.json(senderPublic(acct));
});

app.post('/api/public/sender/signout', (req, res) => {
  res.clearCookie(sess.SENDER_COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/public/sender/me', (req, res) => {
  const a = senderFromReq(req);
  if (!a) return res.status(401).json({ error: 'Not signed in' });
  res.json(senderPublic(a));
});

// ---- saved drafts (a booking the sender is not ready to submit) ----
app.get('/api/public/sender/drafts', requireSender, (req, res) => {
  res.json(req.sender.drafts || []);
});
app.post('/api/public/sender/drafts', requireSender, (req, res) => {
  const b = req.body || {};
  const a = req.sender;
  a.drafts = a.drafts || [];
  const now = new Date().toISOString();
  const payload = (b.payload && typeof b.payload === 'object') ? b.payload : {};
  // Keep drafts small — this is a convenience cache, not a document store.
  if (JSON.stringify(payload).length > 200000) return res.status(400).json({ error: 'This draft is too large to save' });
  let draft = b.id ? a.drafts.find(x => x.id === +b.id) : null;
  if (draft) {
    draft.label = String(b.label || draft.label || 'Untitled draft').trim();
    draft.payload = payload;
    draft.updated_at = now;
  } else {
    if (a.drafts.length >= 20) return res.status(400).json({ error: 'You have reached the maximum of 20 saved drafts' });
    draft = {
      id: db.nextId('sender_draft'),
      label: String(b.label || 'Untitled draft').trim(),
      payload, created_at: now, updated_at: now
    };
    a.drafts.push(draft);
  }
  db.persist();
  res.json(draft);
});
app.delete('/api/public/sender/drafts/:id', requireSender, (req, res) => {
  const a = req.sender;
  const before = (a.drafts || []).length;
  a.drafts = (a.drafts || []).filter(x => x.id !== +req.params.id);
  if (a.drafts.length === before) return res.status(404).json({ error: 'Draft not found' });
  db.persist();
  res.json({ ok: true });
});

// ---- the sender's own bookings and boxes ----
// Matched on the email captured at booking time (intake) or on the customer record.
app.get('/api/public/sender/shipments', requireSender, (req, res) => {
  const d = db.get();
  const email = req.sender.email;
  const phoneDigits = BOC.normalizePhMobile(req.sender.phone) || String(req.sender.phone || '').replace(/\D/g, '');
  const matchesSender = (obj) => {
    const e = String((obj && obj.email) || '').trim().toLowerCase();
    if (e && e === email) return true;
    const p = String((obj && (obj.contact_numbers || obj.phone_primary)) || '').replace(/\D/g, '');
    return !!(phoneDigits && p && p.endsWith(phoneDigits.slice(-9)));
  };

  // Online intake requests submitted by this sender.
  const requests = (d.intake_requests || [])
    .filter(r => matchesSender(r.sender))
    .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))
    .map(r => ({
      reference_code: r.reference_code, status: r.status, submitted_at: r.submitted_at,
      box_count: (r.boxes || []).length,
      size_summary: (r.boxes || []).map(b => (BOXSIZE.bySize(b.size_category) || {}).label || b.size_category).join(', '),
      service_level: r.service_level || null,
      converted_shipment_id: r.converted_shipment_id || null
    }));

  // Encoded shipments where the sender customer record matches, with live box tracking.
  const customerIds = d.customers.filter(c => matchesSender(c)).map(c => c.id);
  const shipments = d.shipments
    .filter(s => customerIds.includes(s.sender_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(s => ({
      shipment_number: s.shipment_number, created_at: s.created_at,
      service_level: s.service_level || null, payment_status: s.payment_status,
      boxes: d.boxes.filter(b => b.shipment_id === s.id).map(b => {
        const receiver = d.customers.find(c => c.id === b.receiver_id) || {};
        return {
          box_number: b.box_number, status: b.status,
          status_label: SM.FRIENDLY[b.status] || b.status,
          status_updated_at: b.status_updated_at,
          size_label: (BOXSIZE.bySize(b.size_category) || {}).label || b.size_category,
          receiver_name: receiver.full_name || '', receiver_city: receiver.city_municipality || '',
          track_url: b.qr_token ? `/track.html?t=${b.qr_token}` : null
        };
      })
    }));

  res.json({ requests, shipments });
});

// ---------- origin warehouse: master list + container load planning ----------
// Boxes physically sitting at the origin warehouse: received from the sender but not yet
// stuffed into a container. A shipper agent only sees their own origin country.
function originWarehouseBoxes(user, scopeOverride) {
  const d = db.get();
  const scope = scopeOverride !== undefined ? scopeOverride : ROLE.originScope(user.role);
  return d.boxes
    .filter(b => b.status === 'RECEIVED_ORIGIN' && !b.container_id)
    .map(b => {
      const row = boxRow(b);
      const shipment = d.shipments.find(s => s.id === b.shipment_id) || {};
      const size = BOXSIZE.bySize(b.size_category);
      return {
        ...row,
        origin_country: shipment.origin_country || '', origin_agent: shipment.origin_agent || '',
        service_level: shipment.service_level || null,
        size_label: size ? size.label : b.size_category,
        dimensions: size ? size.dimensions : '',
        cbm: size ? size.cbm : 0,
        weight_kg: b.weight_kg || (size ? size.standard_weight_kg : 0)
      };
    })
    .filter(b => !scope || b.origin_country === scope);
}

app.get('/api/origin-warehouse', requireRole(...ADMINS, ...ROLE.BRANCH_ADMINS, ...SHIPPERS), (req, res) => {
  let list = originWarehouseBoxes(req.user, effectiveScope(req));
  if (req.query.origin_country) list = list.filter(b => b.origin_country === req.query.origin_country);
  if (req.query.size) list = list.filter(b => BOXSIZE.canonicalSize(b.size_category) === req.query.size);
  const bySize = {};
  for (const b of list) {
    const k = BOXSIZE.canonicalSize(b.size_category) || 'OTHER';
    bySize[k] = bySize[k] || { size: k, label: (BOXSIZE.bySize(k) || {}).label || k, count: 0, cbm: 0, weight_kg: 0 };
    bySize[k].count += 1;
    bySize[k].cbm = +(bySize[k].cbm + b.cbm).toFixed(3);
    bySize[k].weight_kg = +(bySize[k].weight_kg + (+b.weight_kg || 0)).toFixed(1);
  }
  res.json({
    scope: effectiveScope(req),
    boxes: list.sort((a, b) => String(a.box_number).localeCompare(String(b.box_number))),
    totals: {
      count: list.length,
      cbm: +list.reduce((n, b) => n + b.cbm, 0).toFixed(3),
      weight_kg: +list.reduce((n, b) => n + (+b.weight_kg || 0), 0).toFixed(1)
    },
    by_size: Object.values(bySize),
    origins: [...new Set(list.map(b => b.origin_country).filter(Boolean))]
  });
});

// How many boxes fit in one container, by volume and by payload weight.
app.get('/api/origin-warehouse/load-plan', requireRole(...ADMINS, ...ROLE.BRANCH_ADMINS, ...SHIPPERS), (req, res) => {
  const size = SM.CONTAINER_SIZES.includes(req.query.size) ? req.query.size : 'C40';
  const cap = SM.CONTAINER_CAPACITY[size];
  let util = parseFloat(req.query.utilisation);
  if (!Number.isFinite(util) || util <= 0 || util > 1) util = SM.DEFAULT_STUFFING_UTILISATION;
  const usableCbm = +(cap.cbm * util).toFixed(3);

  // Theoretical capacity if the container were filled with a single box size.
  const per_size = BOXSIZE.BOX_SIZES.map(s => {
    const byVolume = Math.floor(usableCbm / s.cbm);
    const byWeight = Math.floor(cap.payload_kg / s.standard_weight_kg);
    return {
      size: s.key, label: s.label, dimensions: s.dimensions, cbm: s.cbm,
      standard_weight_kg: s.standard_weight_kg,
      max_by_volume: byVolume, max_by_weight: byWeight,
      max_boxes: Math.min(byVolume, byWeight),
      limited_by: byVolume <= byWeight ? 'volume' : 'weight'
    };
  });

  // A mixed load: an even spread of every box size, which is how a consolidation usually
  // fills — rather than the single-size ideal above. Sizes are added round-robin until either
  // the usable volume or the payload weight runs out.
  const sizes = BOXSIZE.BOX_SIZES;
  const mixCount = Object.fromEntries(sizes.map(s => [s.key, 0]));
  let mixCbm = 0, mixKg = 0, added = true;
  while (added) {
    added = false;
    for (const s of sizes) {
      if (mixCbm + s.cbm <= usableCbm && mixKg + s.standard_weight_kg <= cap.payload_kg) {
        mixCount[s.key] += 1;
        mixCbm = +(mixCbm + s.cbm).toFixed(3);
        mixKg = +(mixKg + s.standard_weight_kg).toFixed(1);
        added = true;
      }
    }
  }
  const mixed = {
    boxes: Object.values(mixCount).reduce((n, v) => n + v, 0),
    by_size: sizes.map(s => ({ size: s.key, label: s.label, count: mixCount[s.key], cbm_each: s.cbm })),
    used_cbm: mixCbm, used_weight_kg: mixKg,
    remaining_cbm: +(usableCbm - mixCbm).toFixed(3),
    remaining_weight_kg: +(cap.payload_kg - mixKg).toFixed(1),
    limited_by: (usableCbm - mixCbm) < (sizes[0].cbm) ? 'volume' : 'weight'
  };

  // How much of what is actually waiting at the warehouse would fit — largest boxes first,
  // which is how a container is really stuffed.
  const waiting = originWarehouseBoxes(req.user, effectiveScope(req)).sort((a, b) => b.cbm - a.cbm);
  let cbmLeft = usableCbm, kgLeft = cap.payload_kg;
  const fits = [], leftOver = [];
  for (const b of waiting) {
    const w = +b.weight_kg || 0;
    if (b.cbm <= cbmLeft && w <= kgLeft) { fits.push(b); cbmLeft = +(cbmLeft - b.cbm).toFixed(3); kgLeft = +(kgLeft - w).toFixed(1); }
    else leftOver.push(b);
  }
  res.json({
    container_size: size, container_label: SM.CONTAINER_SIZE_LABELS[size],
    capacity: { ...cap, utilisation: util, usable_cbm: usableCbm },
    per_size,
    mixed,
    actual: {
      waiting_count: waiting.length,
      fits_count: fits.length,
      left_over_count: leftOver.length,
      used_cbm: +(usableCbm - cbmLeft).toFixed(3),
      used_weight_kg: +(cap.payload_kg - kgLeft).toFixed(1),
      remaining_cbm: cbmLeft, remaining_weight_kg: kgLeft,
      volume_fill_pct: usableCbm ? +(((usableCbm - cbmLeft) / usableCbm) * 100).toFixed(1) : 0,
      weight_fill_pct: cap.payload_kg ? +(((cap.payload_kg - kgLeft) / cap.payload_kg) * 100).toFixed(1) : 0,
      containers_needed: waiting.length && fits.length ? Math.ceil(waiting.length / fits.length) : (waiting.length ? null : 0),
      fits: fits.map(b => ({ id: b.id, box_number: b.box_number, size_label: b.size_label, cbm: b.cbm, weight_kg: b.weight_kg }))
    }
  });
});

// ---------- accounting: rate cards, invoices/receipts, expenses, profit & loss ----------
// Every branch keeps its own books: its own rate card, its own invoices and expenses, and
// its own profit & loss. Head office sees all of them; a branch sees only its own.
const RATES = require('./lib/rates');
const FX = require('./lib/fx');

// Reference exchange rates, held per branch. Each branch keeps its own books and settles
// head office's peso charges in its own currency, so it keeps its own rate table and its own
// bulletin date rather than inheriting whatever Manila last saved. Falls back to the shared
// table for a branch that has not set its own.
function fxFor(d, branchKey) {
  d.settings.fxByBranch = d.settings.fxByBranch || {};
  const own = branchKey && d.settings.fxByBranch[branchKey];
  const fx = FX.normalizeFx(own || d.settings.fx);
  // Each branch converts at the rate its own central or clearing bank publishes, so the
  // table is labelled with that source rather than inheriting head office's BSP.
  const fin = BRANCH.financeFor(branchKey || 'HQ_MANILA');
  if (!own || !own.source) { fx.source = fin.fx_source; fx.source_url = fin.fx_source_url; }
  return fx;
}

// Which branch's books the caller is working in. HQ admins/accounting may pass ?branch=.
function accountingBranch(req) {
  const own = BRANCH.branchForRole(req.user.role);
  if (own && own !== 'HQ_MANILA') return own;
  const asked = BRANCH.byKey(String(req.query.branch || req.body?.branch || ''));
  return asked ? asked.key : 'HQ_MANILA';
}
// Rate cards are stored per branch, falling back to the legacy single card.
function rateCardFor(d, branchKey) {
  d.settings.rateCards = d.settings.rateCards || {};
  const stored = d.settings.rateCards[branchKey];
  if (stored) return RATES.normalizeRateCard(stored);
  // No card saved for this branch. The old fallback handed over head office's card, which
  // is priced in pesos — so a branch with no card of its own reported its whole profit and
  // loss in PHP. Fall back to the legacy card's *shape*, restamped in the branch's own
  // currency, so the figures are at least labelled with the money the branch actually deals in.
  const card = RATES.normalizeRateCard(d.settings.rateCard);
  card.currency = BRANCH.currencyFor(branchKey);
  return card;
}

// Reference data for the rate-card editor.
app.get('/api/accounting/meta', requireRole(...ACCOUNTING_ROLES), (req, res) => {
  res.json({
    zones: RATES.ZONES,
    sizes: BOXSIZE.BOX_SIZES.map(s => ({ key: s.key, label: s.label, dimensions: s.dimensions })),
    ocean_levels: RATES.OCEAN_LEVELS,
    container_sizes: RATES.CONTAINER_SIZES,
    container_size_labels: RATES.CONTAINER_SIZE_LABELS,
    extra_charges: RATES.EXTRA_CHARGES,
    air_level: RATES.AIR_LEVEL,
    service_level_labels: SM.SERVICE_LEVEL_LABELS
  });
});

// Which parts of a rate card apply to a branch. Head office bills branches (inter-branch
// only); a branch bills customers (customer tariff only).
function cardSectionsFor(branchKey) {
  const isHQ = (BRANCH.byKey(branchKey) || {}).type === 'HQ';
  return { customer: !isHQ, interbranch: isHQ };
}
app.get('/api/accounting/rate-card', requireRole(...ACCOUNTING_ROLES), (req, res) => {
  const branch = accountingBranch(req);
  res.json({
    ...rateCardFor(db.get(), branch), branch,
    sections: cardSectionsFor(branch),
    editable: ROLE.isAnyAdmin(req.user.role)
  });
});
// Rate cards are commercial policy: only the Developer portal may change them.
app.put('/api/accounting/rate-card', requireRole(...ADMINS, ...ROLE.BRANCH_ADMINS), (req, res) => {
  const d = db.get();
  const card = RATES.normalizeRateCard(req.body || {});
  card.updated_at = new Date().toISOString();
  card.updated_by = req.user.name;
  const branch = accountingBranch(req);
  d.settings.rateCards = d.settings.rateCards || {};
  d.settings.rateCardPrev = d.settings.rateCardPrev || {};
  if (d.settings.rateCards[branch]) d.settings.rateCardPrev[branch] = d.settings.rateCards[branch];
  d.settings.rateCards[branch] = card;
  card.branch = branch;
  db.persist();
  res.json(card);
});

// Quote a shipment that does not exist yet — used by New Shipment Intake so the fee an agent
// records is the same figure the sender was quoted on the online form.
app.post('/api/accounting/quote', requireRole(...ACCOUNTING_ROLES, ...SHIPPERS), (req, res) => {
  const d = db.get();
  const b = req.body || {};
  const branchKey = (BRANCH.byCountry(String(b.origin_country || '').trim()) || {}).key
    || BRANCH.branchForRole(req.user.role) || 'HQ_MANILA';
  const card = rateCardFor(d, branchKey);
  const level = SM.SERVICE_LEVELS.includes(b.service_level) ? b.service_level : 'OCEAN_ECONOMY';
  const lines = (Array.isArray(b.boxes) ? b.boxes : []).map((bx, i) => {
    // The destination zone comes from the receiver on file, or a region passed directly.
    const receiver = d.customers.find(c => c.id === +bx.receiver_id) || {};
    const region = bx.region || receiver.region || null;
    const zone = RATES.zoneForRegion(region);
    const p = RATES.priceBox({ card, service_level: level, zone, size_category: bx.size_category, weight_kg: bx.weight_kg });
    return {
      index: i + 1, size_category: bx.size_category, weight_kg: +bx.weight_kg || 0,
      receiver_name: receiver.full_name || '', region, zone,
      zone_label: zone ? RATES.ZONE_LABELS[zone] : null,
      amount: p.amount, basis: p.basis, priced: !!zone
    };
  });
  res.json({
    branch: branchKey, currency: card.currency, service_level: level,
    lines, total: +lines.reduce((n, l) => n + l.amount, 0).toFixed(2),
    unpriced: lines.filter(l => !l.priced).length
  });
});

// Quote a shipment from the current rate card (per box + total).
app.get('/api/accounting/quote/:shipmentId', requireRole(...ACCOUNTING_ROLES), (req, res) => {
  const d = db.get();
  const s = d.shipments.find(x => x.id === +req.params.shipmentId);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const card = rateCardFor(d, (BRANCH.byCountry(s.origin_country) || {}).key || 'HQ_MANILA');
  const boxes = d.boxes.filter(b => b.shipment_id === s.id).map(b => {
    const receiver = d.customers.find(c => c.id === b.receiver_id) || {};
    const region = b.region || receiver.region || null;
    const zone = RATES.zoneForRegion(region);
    const p = RATES.priceBox({ card, service_level: s.service_level, zone, size_category: b.size_category, weight_kg: b.weight_kg });
    return { box_id: b.id, box_number: b.box_number, size_category: b.size_category, weight_kg: b.weight_kg, region, zone, ...p };
  });
  res.json({
    shipment_id: s.id, shipment_number: s.shipment_number, service_level: s.service_level,
    currency: card.currency, boxes, total: +boxes.reduce((n, b) => n + b.amount, 0).toFixed(2)
  });
});

// ---- invoices / receipts ----
app.get('/api/accounting/invoices', requireRole(...ACCOUNTING_ROLES), (req, res) => {
  const d = db.get();
  const branch = accountingBranch(req);
  const all = BRANCH.branchForRole(req.user.role) === null && !req.query.branch; // HQ, unfiltered
  let list = (d.invoices || []).filter(i => all || (i.branch || 'HQ_MANILA') === branch);
  if (req.query.status) list = list.filter(i => i.status === req.query.status);
  list.sort((a, b) => b.issued_at.localeCompare(a.issued_at));
  res.json(list);
});
app.post('/api/accounting/invoices', requireRole(...ACCOUNTING_ROLES), (req, res) => {
  const d = db.get();
  d.invoices = d.invoices || [];
  const b = req.body || {};
  const branch = accountingBranch(req);
  const card = rateCardFor(d, branch);
  const lines = (Array.isArray(b.lines) ? b.lines : [])
    .map(l => ({ description: String(l.description || '').trim(), qty: +l.qty || 1, unit_amount: +l.unit_amount || 0 }))
    .filter(l => l.description)
    .map(l => ({ ...l, amount: +(l.qty * l.unit_amount).toFixed(2) }));
  if (!lines.length) return res.status(400).json({ error: 'At least one invoice line is required' });
  if (!String(b.bill_to || '').trim()) return res.status(400).json({ error: 'Bill-to name is required' });
  d.seq.invoice_no = (d.seq.invoice_no || 0) + 1;
  const inv = {
    id: db.nextId('invoice'),
    invoice_number: `INV-${new Date().getFullYear()}-${String(d.seq.invoice_no).padStart(5, '0')}`,
    shipment_id: b.shipment_id ? +b.shipment_id : null,
    box_order_id: b.box_order_id ? +b.box_order_id : null,
    bill_to: String(b.bill_to).trim(),
    branch,
    currency: b.currency || card.currency,
    lines,
    total: +lines.reduce((n, l) => n + l.amount, 0).toFixed(2),
    status: 'UNPAID', paid_at: null, payment_method: '', notes: String(b.notes || '').trim(),
    issued_at: new Date().toISOString(), issued_by: req.user.name
  };
  d.invoices.push(inv);
  db.persist();
  res.json(inv);
});
// Mark paid → becomes a receipt.
app.put('/api/accounting/invoices/:id', requireRole(...ACCOUNTING_ROLES), (req, res) => {
  const d = db.get();
  const inv = (d.invoices || []).find(x => x.id === +req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (b.status && !['UNPAID', 'PAID', 'VOID'].includes(b.status)) return res.status(400).json({ error: 'Invalid status' });
  if (b.status === 'PAID' && inv.status !== 'PAID') {
    inv.paid_at = new Date().toISOString();
    d.seq.receipt_no = (d.seq.receipt_no || 0) + 1;
    inv.receipt_number = `OR-${new Date().getFullYear()}-${String(d.seq.receipt_no).padStart(5, '0')}`;
  }
  if (b.status === 'UNPAID') { inv.paid_at = null; inv.receipt_number = null; }
  for (const k of ['status', 'payment_method', 'notes']) if (k in b) inv[k] = b[k];
  db.persist();
  res.json(inv);
});

// ---- expenses (the cost side of profit & loss) ----
const EXPENSE_CATEGORIES = ['FREIGHT', 'TRUCKING', 'CUSTOMS', 'WAREHOUSE', 'BOX_PURCHASE', 'SALARIES', 'OTHER'];
app.get('/api/accounting/expenses', requireRole(...ACCOUNTING_ROLES), (req, res) => {
  const d = db.get();
  const branch = accountingBranch(req);
  const all = BRANCH.branchForRole(req.user.role) === null && !req.query.branch;
  const scoped = (d.expenses || []).filter(e => all || (e.branch || 'HQ_MANILA') === branch);
  const list = scoped.filter(e => !e.deleted_at).sort((a, b) => b.spent_at.localeCompare(a.spent_at));
  const deleted = scoped.filter(e => e.deleted_at).sort((a, b) => b.deleted_at.localeCompare(a.deleted_at)).slice(0, 10);
  res.json({ expenses: list, recently_deleted: deleted, categories: EXPENSE_CATEGORIES, branch });
});
app.post('/api/accounting/expenses', requireRole(...ACCOUNTING_ROLES), (req, res) => {
  const d = db.get();
  d.expenses = d.expenses || [];
  const b = req.body || {};
  const amount = +b.amount;
  if (!(amount > 0)) return res.status(400).json({ error: 'A positive amount is required' });
  if (!String(b.description || '').trim()) return res.status(400).json({ error: 'Description is required' });
  const e = {
    id: db.nextId('expense'),
    category: EXPENSE_CATEGORIES.includes(b.category) ? b.category : 'OTHER',
    description: String(b.description).trim(),
    amount: +amount.toFixed(2),
    branch: accountingBranch(req),
    currency: b.currency || rateCardFor(d, accountingBranch(req)).currency,
    container_id: b.container_id ? +b.container_id : null,
    spent_at: b.spent_at || new Date().toISOString(),
    recorded_by: req.user.name, created_at: new Date().toISOString()
  };
  d.expenses.push(e);
  db.persist();
  res.json(e);
});
app.delete('/api/accounting/expenses/:id', requireRole(...ACCOUNTING_ROLES), (req, res) => {
  const d = db.get();
  const e = (d.expenses || []).find(x => x.id === +req.params.id);
  if (!e) return res.status(404).json({ error: 'Not found' });
  // Soft delete: it drops out of the books but can be restored.
  e.deleted_at = new Date().toISOString();
  e.deleted_by = req.user.name;
  db.persist();
  res.json({ ok: true, id: e.id, restorable: true });
});

// ---- branch-to-branch invoicing ----
// Head office does the destination-side work (customs, warehouse, sorting, last-mile) on
// boxes an origin branch sent, so it bills that branch per delivered box, plus any agreed
// commission on the branch's own revenue. The same invoice shows as a receivable to the
// issuer and a payable to the billed branch, and lands in both P&Ls.
// Full settlement lifecycle. The billed branch acknowledges receipt and remits; the issuing
// branch confirms the funds actually landed.
const IB_STATUSES = ['DRAFT', 'ISSUED', 'RECEIVED', 'REMITTED', 'PAID', 'DISPUTED', 'VOID'];
// What the billed branch may do, versus the issuer.
const IB_BILLED_ACTIONS = ['RECEIVED', 'REMITTED', 'DISPUTED'];

function ibVisible(user, inv) {
  const own = BRANCH.branchForRole(user.role);
  if (!own || ROLE.isAdmin(user.role)) return true;      // head office sees every settlement
  return inv.from_branch === own || inv.to_branch === own;
}

app.get('/api/accounting/interbranch', requireRole(...ACCOUNTING_ROLES), async (req, res) => {
  const d = db.get();
  // Settlements are raised on one node and read on another, so pull before listing —
  // otherwise a branch sees an empty page and concludes head office never sent anything.
  await autoSync(d);
  const own = BRANCH.branchForRole(req.user.role);
  // Head office raises every settlement in pesos, but a branch settles in its own money and
  // should read the bill that way. Convert into the reader's currency at their own stored
  // rate, keeping the peso original beside it — that is the amount on the document.
  const homeCcy = own ? BRANCH.currencyFor(own) : null;
  const fx = fxFor(d, own || 'HQ_MANILA');
  const inHome = (amount, from) => {
    if (!homeCcy || (from || 'PHP') === homeCcy) return null;
    const c = FX.convert(amount, from || 'PHP', homeCcy, fx);
    return c.converted ? { amount: c.amount, currency: homeCcy, rate: c.rate } : null;
  };
  const list = (d.interbranch_invoices || [])
    .filter(i => ibVisible(req.user, i))
    .filter(i => !req.query.status || i.status === req.query.status)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(i => ({
      ...i,
      // How this invoice reads from where the caller is sitting.
      direction: own ? (i.from_branch === own ? 'RECEIVABLE' : 'PAYABLE') : 'BOTH',
      from_label: BRANCH.BRANCH_LABELS[i.from_branch] || i.from_branch,
      to_label: BRANCH.BRANCH_LABELS[i.to_branch] || i.to_branch,
      home: inHome(i.total, i.currency)
    }));
  // Totals follow the reader too: a branch's outstanding balance in its own money.
  const totalIn = (dir) => {
    const rows = list.filter(i => i.direction === dir && ['ISSUED', 'DISPUTED'].includes(i.status));
    const raw = +rows.reduce((n, i) => n + i.total, 0).toFixed(2);
    if (!homeCcy) return { amount: raw, currency: 'PHP' };
    const converted = rows.reduce((n, i) => n + (i.home ? i.home.amount : i.total), 0);
    return { amount: +converted.toFixed(2), currency: homeCcy };
  };
  res.json({
    invoices: list,
    branches: BRANCH.resolve(d.settings.branches).map(b => ({ key: b.key, label: b.label, short: b.short, type: b.type })),
    my_branch: own,
    home_currency: homeCcy,
    fx: homeCcy ? { source: BRANCH.financeFor(own).fx_source_short || fx.source, source_url: fx.source_url, as_of: fx.as_of } : null,
    totals: { receivable: totalIn('RECEIVABLE').amount, payable: totalIn('PAYABLE').amount },
    totals_currency: homeCcy || 'PHP',
    statuses: IB_STATUSES
  });
});

// Build a draft settlement for a period from what actually happened.
app.post('/api/accounting/interbranch/generate', requireRole(...ADMINS, 'ACCOUNTING'), (req, res) => {
  const d = db.get();
  const b = req.body || {};
  const from_branch = BRANCH.BRANCH_KEYS.includes(b.from_branch) ? b.from_branch : 'HQ_MANILA';
  const to_branch = b.to_branch;
  if (!BRANCH.BRANCH_KEYS.includes(to_branch)) return res.status(400).json({ error: 'Choose the branch to bill' });
  if (from_branch === to_branch) return res.status(400).json({ error: 'A branch cannot invoice itself' });

  const from = new Date(b.period_from || 0).toISOString();
  const to = new Date(b.period_to ? new Date(b.period_to).getTime() + 86400000 : Date.now()).toISOString();
  const billedBranch = BRANCH.byKey(to_branch);
  const card = rateCardFor(d, from_branch);

  // The charge is ALL-IN per container: one flat fee by container size covering the whole
  // destination-side service for every box inside it. A container is billable once it has
  // arrived at destination, so it is counted by its actual arrival date.
  const ARRIVED_ONWARD = ['ARRIVED', 'AT_CUSTOMS', 'RELEASED', 'STRIPPED'];
  const ownsContainer = (c) => (c.booked_by_branch
    ? c.booked_by_branch === to_branch
    : String(c.origin_port || '').toLowerCase().includes(billedBranch.country.toLowerCase()));

  const billable = d.containers.filter(c => {
    if (!ownsContainer(c) || !ARRIVED_ONWARD.includes(c.status)) return false;
    const at = c.actual_arrival;
    return at && at >= from && at < to;
  });

  const bySize = {};
  for (const c of billable) {
    const size = SM.CONTAINER_SIZES.includes(c.size) ? c.size : 'C40';
    (bySize[size] = bySize[size] || []).push(c);
  }
  const counted = billable.length;
  const boxesCovered = d.boxes.filter(b => billable.some(c => c.id === b.container_id)).length;

  const lines = Object.entries(bySize).map(([size, list]) => {
    const fee = RATES.containerFee(card, size);
    const numbers = list.map(c => c.container_number).join(', ');
    return {
      description: `All-in destination handling — ${fee.label} container × ${list.length} (${numbers})`,
      container_size: size, qty: list.length, unit_amount: fee.amount,
      amount: +(list.length * fee.amount).toFixed(2)
    };
  }).filter(l => l.qty > 0);

  // Optional commission on the billed branch's own customer revenue for the period.
  const pct = +(BRANCH.resolve(d.settings.branches).find(x => x.key === to_branch) || {}).commission_pct || 0;
  if (pct > 0) {
    const theirRevenue = d.shipments
      .filter(sh => sh.origin_country === billedBranch.country && sh.created_at >= from && sh.created_at < to)
      .reduce((n, sh) => n + (+(sh.shipping_fee_amount || 0)), 0);
    if (theirRevenue > 0) {
      lines.push({
        description: `Network commission @ ${pct}% of ${billedBranch.short} billed revenue`,
        container_size: null, qty: 1, unit_amount: +(theirRevenue * pct / 100).toFixed(2), amount: +(theirRevenue * pct / 100).toFixed(2)
      });
    }
  }

  if (!lines.length) {
    return res.status(400).json({ error: `Nothing to bill ${billedBranch.short} for that period — no containers arrived and no commission is due.` });
  }
  res.json({
    draft: true, from_branch, to_branch,
    period_from: b.period_from || null, period_to: b.period_to || null,
    currency: card.currency, lines,
    total: +lines.reduce((n, l) => n + l.amount, 0).toFixed(2),
    containers_counted: counted,
    boxes_covered: boxesCovered,
    containers: billable.map(c => ({ container_number: c.container_number, size: c.size, arrived: c.actual_arrival }))
  });
});

app.post('/api/accounting/interbranch', requireRole(...ADMINS, 'ACCOUNTING'), (req, res) => {
  const d = db.get();
  d.interbranch_invoices = d.interbranch_invoices || [];
  const b = req.body || {};
  const from_branch = BRANCH.BRANCH_KEYS.includes(b.from_branch) ? b.from_branch : 'HQ_MANILA';
  const to_branch = b.to_branch;
  if (!BRANCH.BRANCH_KEYS.includes(to_branch)) return res.status(400).json({ error: 'Choose the branch to bill' });
  if (from_branch === to_branch) return res.status(400).json({ error: 'A branch cannot invoice itself' });
  const lines = (Array.isArray(b.lines) ? b.lines : [])
    .map(l => ({
      description: String(l.description || '').trim(),
      container_size: l.container_size || null, qty: +l.qty || 1, unit_amount: +l.unit_amount || 0,
      amount: +(((+l.qty || 1) * (+l.unit_amount || 0))).toFixed(2)
    }))
    .filter(l => l.description);
  if (!lines.length) return res.status(400).json({ error: 'At least one line is required' });

  d.seq.ib_no = (d.seq.ib_no || 0) + 1;
  const inv = {
    id: db.nextId('interbranch_invoice'),
    // The issuing branch is part of the number, so two nodes cannot mint the same one.
    invoice_number: `IB-${BRANCH.countryCode((BRANCH.byKey(from_branch) || {}).country)}-${new Date().getFullYear()}-${String(d.seq.ib_no).padStart(5, '0')}`,
    from_branch, to_branch,
    period_from: b.period_from || null, period_to: b.period_to || null,
    currency: b.currency || rateCardFor(d, from_branch).currency,
    lines, total: +lines.reduce((n, l) => n + l.amount, 0).toFixed(2),
    status: 'DRAFT', notes: String(b.notes || '').trim(),
    issued_at: null, paid_at: null, settled_reference: '',
    created_at: new Date().toISOString(), created_by: req.user.name
  };
  d.interbranch_invoices.push(inv);
  db.persist();
  res.json(inv);
});

app.put('/api/accounting/interbranch/:id', requireRole(...ACCOUNTING_ROLES), async (req, res) => {
  const d = db.get();
  const inv = (d.interbranch_invoices || []).find(x => x.id === +req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  if (!ibVisible(req.user, inv)) return res.status(403).json({ error: 'That settlement does not involve your branch' });
  const b = req.body || {};
  const own = BRANCH.branchForRole(req.user.role);
  const isIssuer = !own || ROLE.isAdmin(req.user.role) || inv.from_branch === own;

  if (b.status) {
    if (!IB_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });
    // The billed branch acknowledges, remits or disputes; everything else is the issuer's.
    if (!isIssuer && !IB_BILLED_ACTIONS.includes(b.status)) {
      return res.status(403).json({ error: 'Only the issuing branch can do that — you can acknowledge, remit payment or raise a dispute' });
    }
    if (isIssuer && IB_BILLED_ACTIONS.includes(b.status) && b.status !== 'DISPUTED' && inv.from_branch === own) {
      return res.status(403).json({ error: 'Only the branch being billed can acknowledge or remit this settlement' });
    }
    if (b.status === 'DISPUTED' && !String(b.notes || inv.notes || '').trim()) {
      return res.status(400).json({ error: 'Please say what is disputed' });
    }
    if (b.status === 'REMITTED' && !String(b.settled_reference || inv.settled_reference || '').trim()) {
      return res.status(400).json({ error: 'Please give the payment reference (bank transfer or receipt number)' });
    }
    // Keep the previous state so the action can be undone.
    inv.history = inv.history || [];
    inv.history.push({ status: inv.status, at: new Date().toISOString(), by: req.user.name });
    if (b.status === 'ISSUED' && !inv.issued_at) inv.issued_at = new Date().toISOString();
    if (b.status === 'RECEIVED') inv.received_at = new Date().toISOString();
    if (b.status === 'REMITTED') inv.remitted_at = new Date().toISOString();
    if (b.status === 'PAID') inv.paid_at = new Date().toISOString();
    if (['DRAFT', 'DISPUTED'].includes(b.status)) { inv.paid_at = null; inv.remitted_at = null; }
    inv.status = b.status;
  }
  for (const k of ['notes', 'settled_reference']) if (k in b) inv[k] = String(b[k] || '').trim();
  db.persist();
  // Get the change to the other side straight away, rather than leaving it to be polled.
  if (inv._node && inv._node !== NODE.NODE_ID) {
    // Not ours to replicate — ask the node that owns it to record what we did.
    await tellIssuer(inv, b.status, req.user.name);
  } else {
    await pushToBranch(d, inv.to_branch, 'interbranch_invoices', inv);
  }
  res.json(inv);
});

// Undo the last status change on a settlement — the accounting equivalent of the box undo.
app.post('/api/accounting/interbranch/:id/undo', requireRole(...ACCOUNTING_ROLES), (req, res) => {
  const d = db.get();
  const inv = (d.interbranch_invoices || []).find(x => x.id === +req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  if (!ibVisible(req.user, inv)) return res.status(403).json({ error: 'That settlement does not involve your branch' });
  if (!(inv.history || []).length) return res.status(400).json({ error: 'Nothing to undo — this settlement has not changed since it was created.' });
  const own = BRANCH.branchForRole(req.user.role);
  const wasMine = !own || ROLE.isAdmin(req.user.role) || inv.from_branch === own || inv.to_branch === own;
  if (!wasMine) return res.status(403).json({ error: 'You cannot undo this settlement' });
  const prev = inv.history.pop();
  inv.status = prev.status;
  if (prev.status !== 'PAID') inv.paid_at = null;
  if (!['REMITTED', 'PAID'].includes(prev.status)) inv.remitted_at = null;
  if (!['RECEIVED', 'REMITTED', 'PAID'].includes(prev.status)) inv.received_at = null;
  db.persist();
  res.json({ ...inv, undone_to: prev.status });
});

// Restore an expense that was deleted by mistake.
app.post('/api/accounting/expenses/:id/restore', requireRole(...ACCOUNTING_ROLES), (req, res) => {
  const d = db.get();
  const e = (d.expenses || []).find(x => x.id === +req.params.id);
  if (!e) return res.status(404).json({ error: 'Not found' });
  if (!e.deleted_at) return res.status(400).json({ error: 'That expense is not deleted' });
  delete e.deleted_at; delete e.deleted_by;
  db.persist();
  res.json(e);
});

// Roll the rate card back to the version before the last save.
app.post('/api/accounting/rate-card/undo', requireRole(...ADMINS, ...ROLE.BRANCH_ADMINS), (req, res) => {
  const d = db.get();
  const branch = accountingBranch(req);
  d.settings.rateCardPrev = d.settings.rateCardPrev || {};
  const prev = d.settings.rateCardPrev[branch];
  if (!prev) return res.status(400).json({ error: 'No earlier version of this rate card to go back to' });
  d.settings.rateCards = d.settings.rateCards || {};
  const current = d.settings.rateCards[branch];
  d.settings.rateCards[branch] = prev;
  d.settings.rateCardPrev[branch] = current;   // so undo can be undone
  db.persist();
  res.json({ ...RATES.normalizeRateCard(prev), branch, editable: true });
});

// ---- BSP reference exchange rates ----
// Head office converts branch revenue to pesos with these. Any accounting user can read
// them (they appear on the consolidated P&L); only the Developer edits them, the same rule
// the rate cards follow.
app.get('/api/accounting/fx', requireRole(...ACCOUNTING_ROLES), (req, res) => {
  const branch = accountingBranch(req);
  const fx = fxFor(db.get(), branch);
  res.json({
    ...fx, branch, source_short: BRANCH.financeFor(branch).fx_source_short,
    age_days: FX.ageInDays(fx), currencies: FX.CURRENCIES,
    editable: ROLE.isAnyAdmin(req.user.role)
  });
});

app.put('/api/accounting/fx', requireRole(...ROLE.ANY_ADMIN), (req, res) => {
  const d = db.get();
  const b = req.body || {};
  // accountingBranch pins a branch admin to their own branch, so a branch can only ever
  // write its own rate table — never another branch's, and never head office's.
  const branch = accountingBranch(req);
  const rates = {};
  for (const c of FX.CURRENCIES) {
    const n = Number((b.rates || {})[c]);
    if (isFinite(n) && n > 0) rates[c] = n;
  }
  if (!Object.keys(rates).length) return res.status(400).json({ error: 'No usable rates were sent' });
  const current = fxFor(d, branch);
  d.settings.fxByBranch = d.settings.fxByBranch || {};
  d.settings.fxByBranch[branch] = FX.normalizeFx({
    ...current, rates: { ...current.rates, ...rates },
    as_of: String(b.as_of || '').slice(0, 10) || current.as_of,
    source: b.source || undefined,
    updated_at: new Date().toISOString(), updated_by: req.user.name
  });
  db.persist();
  const fx = fxFor(d, branch);
  res.json({ ...fx, branch, age_days: FX.ageInDays(fx), currencies: FX.CURRENCIES, editable: true });
});

// Pull today's published rates. Best-effort: on any failure the stored rates are left
// exactly as they were and the reason is reported, so VFIC can key them in instead.
app.post('/api/accounting/fx/refresh', requireRole(...ROLE.ANY_ADMIN), async (req, res) => {
  // Each branch pulls from the source it actually banks against: BSP for Manila, Bank of
  // Thailand for Bangkok, ACLEDA for Phnom Penh.
  const branchForRefresh = accountingBranch(req);
  const result = await FX.refreshForBranch(branchForRefresh, fxFor(db.get(), branchForRefresh));
  if (!result.ok) return res.status(502).json({ error: result.error, source_url: result.url || BRANCH.financeFor(branchForRefresh).fx_source_url });
  const d = db.get();
  const branch = accountingBranch(req);
  const current = fxFor(d, branch);
  d.settings.fxByBranch = d.settings.fxByBranch || {};
  d.settings.fxByBranch[branch] = FX.normalizeFx({
    ...current, rates: { ...current.rates, ...result.rates },
    as_of: result.as_of, source: BRANCH.financeFor(branch).fx_source,
    source_url: BRANCH.financeFor(branch).fx_source_url,
    updated_at: new Date().toISOString(), updated_by: req.user.name + ' (from ' + BRANCH.financeFor(branch).fx_source + ')'
  });
  db.persist();
  const fx = fxFor(d, branch);
  res.json({
    ...fx, branch, age_days: FX.ageInDays(fx), currencies: FX.CURRENCIES, editable: true,
    fetched: Object.keys(result.rates), bulletin_url: result.url
  });
});

// ---- profit & loss ----
app.get('/api/accounting/pnl', requireRole(...ACCOUNTING_ROLES), (req, res) => {
  const d = db.get();
  const from = req.query.from ? new Date(req.query.from).toISOString() : '0000';
  const to = req.query.to ? new Date(new Date(req.query.to).getTime() + 86400000).toISOString() : '9999';
  const inRange = (iso) => iso && iso >= from && iso < to;

  const branch = accountingBranch(req);
  // The group roll-up is an oversight view, so only the roles that oversee the whole network
  // get it. VFIC's own accountant in Manila works on head office's books, not the group's.
  const allBooks = BRANCH.seesAllBranches(req.user.role) && !req.query.branch;
  const inBranch = (r) => allBooks || (r.branch || 'HQ_MANILA') === branch;
  // Manila head office does not book what the branches bill their senders — that revenue,
  // and the receivable behind it, belongs to the branch that raised it. HQ's own income is
  // the inter-branch settlements it issues, set against its local Philippine costs.
  const hqBooks = !allBooks && branch === 'HQ_MANILA';
  // Customer revenue is the shipping fee charged on each shipment; a shipment marked PAID
  // counts as collected. (Counter receipts are the customer-facing document — see Official
  // Receipt on a shipment — so there is no separate invoice ledger.)
  const branchCountry = (BRANCH.byKey(branch) || {}).country;
  const shipmentsIn = hqBooks ? [] : d.shipments.filter(sh => {
    if (!inRange(sh.created_at)) return false;
    return allBooks || sh.origin_country === branchCountry;
  });
  const feeOf = (sh) => +(sh.shipping_fee_amount || 0);
  const invoices = shipmentsIn;
  const card0 = rateCardFor(d, accountingBranch(req));

  // Each branch bills in its own currency, so split the revenue by currency first.
  const byCurrency = {};
  for (const sh of shipmentsIn) {
    const ccy = sh.currency || rateCardFor(d, (BRANCH.byCountry(sh.origin_country) || {}).key || 'HQ_MANILA').currency;
    const row = byCurrency[ccy] || (byCurrency[ccy] = { billed: 0, collected: 0, receivable: 0, shipments: 0 });
    row.billed = +(row.billed + feeOf(sh)).toFixed(2);
    if (sh.payment_status === 'PAID') row.collected = +(row.collected + feeOf(sh)).toFixed(2);
    row.receivable = +(row.billed - row.collected).toFixed(2);
    row.shipments += 1;
  }
  // Only the group roll-up consolidates into pesos. A branch always reports in its own
  // money, whatever odd record has found its way into its books — one shipment booked in the
  // wrong currency used to make a branch look "mixed" and tip its whole statement into head
  // office's peso view, so Bangkok read PHP over a column of baht.
  const fxNow = fxFor(d, branch);
  const mixedCurrency = allBooks && Object.keys(byCurrency).length > 1;
  const consolidated = mixedCurrency ? FX.consolidate(byCurrency, fxNow) : null;
  // A branch states everything in its own currency, converting any stray record into it.
  const branchCcy = hqBooks ? BRANCH.currencyFor('HQ_MANILA')
    : (BRANCH.currencyFor(branch) || card0.currency);
  const feeIn = (sh) => {
    const from = sh.currency || branchCcy;
    if (from === branchCcy) return feeOf(sh);
    const c = FX.convert(feeOf(sh), from, branchCcy, fxNow);
    return c.converted ? c.amount : 0;
  };
  // Only a currency carrying actual money is worth reporting. A shipment encoded in the
  // wrong currency but with no fee on it yet is a missing-fee problem, not an FX one.
  const strayCurrency = allBooks ? [] : Object.keys(byCurrency)
    .filter(c => c !== branchCcy && byCurrency[c].billed > 0);
  const revenueBilled = consolidated
    ? consolidated.totals.billed
    : +shipmentsIn.reduce((n, sh) => n + feeIn(sh), 0).toFixed(2);
  const revenueCollected = consolidated
    ? consolidated.totals.collected
    : +shipmentsIn.filter(sh => sh.payment_status === 'PAID').reduce((n, sh) => n + feeIn(sh), 0).toFixed(2);
  const receivable = +(revenueBilled - revenueCollected).toFixed(2);

  // Everything on this statement is stated in one currency: pesos for a consolidated view,
  // the branch's own currency otherwise. Anything recorded in another is converted at the
  // BSP reference rate rather than added as if it were the same money.
  const fx = fxNow;
  const reportCcy = mixedCurrency ? 'PHP' : branchCcy;
  const inReportCcy = (amount, ccy) => FX.convert(amount, ccy || reportCcy, reportCcy, fx);

  const expenses = (d.expenses || []).filter(e => !e.deleted_at && inRange(e.spent_at) && inBranch(e));
  const expenseAmount = (e) => {
    const c = inReportCcy(e.amount, e.currency);
    return c.converted ? c.amount : 0;
  };
  const byCategory = {};
  for (const e of expenses) byCategory[e.category] = +((byCategory[e.category] || 0) + expenseAmount(e)).toFixed(2);
  const totalExpenses = +expenses.reduce((n, e) => n + expenseAmount(e), 0).toFixed(2);
  const unconvertedExpenses = expenses.filter(e => !inReportCcy(e.amount, e.currency).converted).length;

  // Branch-to-branch settlements: money this branch has billed another (income) and money
  // another branch has billed it (cost). Drafts are excluded — only issued/paid count.
  const ibLive = (d.interbranch_invoices || [])
    .filter(i => ['ISSUED', 'PAID', 'DISPUTED'].includes(i.status))
    .filter(i => inRange(i.issued_at || i.created_at));
  // Head office bills its branches in pesos, so restate each settlement in the currency this
  // statement is written in — otherwise Thailand's books would read PHP figures as baht.
  const ibAmount = (i) => {
    const c = inReportCcy(i.total, i.currency || 'PHP');
    return c.converted ? c.amount : 0;
  };
  const ibSum = (list) => +list.reduce((n, i) => n + ibAmount(i), 0).toFixed(2);
  const ibOut = ibLive.filter(i => i.from_branch === branch);
  const ibIn = ibLive.filter(i => i.to_branch === branch);
  const ibIncome = allBooks ? 0 : ibSum(ibOut);
  const ibCost = allBooks ? 0 : ibSum(ibIn);
  const unconvertedSettlements = allBooks ? 0
    : [...ibOut, ...ibIn].filter(i => !inReportCcy(i.total, i.currency || 'PHP').converted).length;

  // Head office's revenue line *is* the settlements it issued, so its receivable is the
  // settlements the branches have not paid yet — not anything owed by a branch's senders.
  const ibCollected = ibSum(ibOut.filter(i => i.status === 'PAID'));
  const revenue = hqBooks
    ? { billed: ibIncome, collected: ibCollected, receivable: +(ibIncome - ibCollected).toFixed(2), invoice_count: ibOut.length }
    : { billed: revenueBilled, collected: revenueCollected, receivable, invoice_count: invoices.length };

  // Guard against counting the settlements twice: for HQ they are already the revenue line.
  const totalCosts = +(totalExpenses + ibCost).toFixed(2);
  const totalIncome = +(revenue.billed + (hqBooks ? 0 : ibIncome)).toFixed(2);
  res.json({
    branch: allBooks ? 'ALL' : branch,
    // Whose books these are, so the statement can name its own revenue line correctly.
    books: allBooks ? 'GROUP' : (hqBooks ? 'HQ' : 'BRANCH'),
    // A consolidated view is stated in pesos; a single branch in its own currency.
    currency: reportCcy,
    period: { from: req.query.from || null, to: req.query.to || null },
    revenue,
    // Present when the rows span more than one currency: what each currency contributed and
    // the BSP rate it was converted at, so the peso total above can be checked line by line.
    by_currency: byCurrency, mixed_currency: mixedCurrency, consolidated,
    // Records booked in something other than this branch's currency, converted for display.
    // Worth surfacing: it usually means a shipment was encoded with the wrong currency.
    stray_currencies: strayCurrency,
    unconverted_expenses: unconvertedExpenses, unconverted_settlements: unconvertedSettlements,
    // Named whenever a figure on this statement was converted, so the page can say so.
    fx_note: (mixedCurrency || (!allBooks && ibLive.some(i => (i.currency || 'PHP') !== reportCcy && (i.from_branch === branch || i.to_branch === branch))))
      ? { source: fx.source, source_url: fx.source_url, as_of: fx.as_of, age_days: FX.ageInDays(fx) } : null,
    expenses: { total: totalExpenses, by_category: byCategory, count: expenses.length },
    interbranch: {
      // For head office the settlements are the revenue line itself, so don't repeat them.
      income: hqBooks ? 0 : ibIncome, cost: ibCost,
      note: allBooks
        ? 'Excluded from the consolidated view — inter-branch charges net to zero across the group.'
        : (hqBooks ? 'Head office bills the origin branches per container; that is the revenue line above. What a branch bills its own senders stays in that branch’s books.' : null)
    },
    totals: { income: totalIncome, costs: totalCosts },
    net_profit: +(totalIncome - totalCosts).toFixed(2),
    // Cash actually moved: settlements paid in, less expenses and settlements paid out.
    net_cash: +(revenue.collected
      + (allBooks || hqBooks ? 0 : ibCollected)
      - totalExpenses
      - (allBooks ? 0 : ibSum(ibIn.filter(i => i.status === 'PAID')))
    ).toFixed(2)
  });
});

// ---------- dashboard & reports ----------
app.get('/api/dashboard', requireAuth, (req, res) => {
  const d = db.get();
  const scope = effectiveScope(req);
  const scopedBoxes = scopeBoxList(req.user, d.boxes, scope);
  const visibleBoxIds = new Set(scopedBoxes.map(b => b.id));
  const byStatus = {};
  for (const s of SM.BOX_STATUSES) byStatus[s] = 0;
  for (const x of scopedBoxes) byStatus[x.status] = (byStatus[x.status] || 0) + 1;
  // Box volume by month, for the dashboard chart.
  const boxesByMonth = {};
  for (const x of scopedBoxes) {
    const k = String(x.created_at || '').slice(0, 7);
    if (k) boxesByMonth[k] = (boxesByMonth[k] || 0) + 1;
  }
  const today = new Date().toISOString().slice(0, 10);
  res.json({
    totalBoxes: scopedBoxes.length,
    byStatus,
    boxesByMonth,
    returnsCount: byStatus.RETURNED || 0,
    unpaidShipments: scopeShipmentList(req.user, d.shipments, scope).filter(s => s.payment_status === 'UNPAID').length,
    inTransitContainers: scopeContainerList(req.user, d.containers, scope)
      .filter(c => c.status === 'IN_TRANSIT').map(c => ({ ...c, box_count: scopedBoxes.filter(b => b.container_id === c.id).length })),
    // Trucking runs are Philippine-side delivery. A branch neither plans nor sees them, so
    // its dashboard shows none rather than another country's schedule.
    todaysTrips: scope ? [] : d.trips.filter(t => t.scheduled_date && String(t.scheduled_date).slice(0, 10) === today)
      .map(t => ({ ...t, box_count: d.boxes.filter(b => b.trucking_assignment_id === t.id).length })),
    activeTrips: scope ? [] : d.trips.filter(t => t.status !== 'COMPLETED').map(t => ({ ...t, box_count: d.boxes.filter(b => b.trucking_assignment_id === t.id).length })),
    // An SMS names a customer and their box, so the log follows the same box scope.
    recentNotifications: d.notifications
      .filter(n => n.box_id == null || visibleBoxIds.has(n.box_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6)
      .map(n => ({ ...n, box_number: (d.boxes.find(b => b.id === n.box_id) || {}).box_number || '' }))
  });
});

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n');
}
app.get('/api/reports/:name', requireRole(...AGENTS), (req, res) => {
  const base = db.get();
  // Every report reads straight off these collections, so scope them once here rather than
  // in each case — a branch's report must never count another branch's boxes, and a new
  // report added later is scoped by construction.
  // Built unconditionally: a null branch scope does not mean "sees everything" any more —
  // Manila's operational staff have no branch but are still limited to cargo that has sailed,
  // and that limit lives inside these same helpers.
  const scope = effectiveScope(req);
  const d = {
    ...base,
    shipments: scopeShipmentList(req.user, base.shipments, scope),
    boxes: scopeBoxList(req.user, base.boxes, scope),
    containers: scopeContainerList(req.user, base.containers, scope)
  };
  let rows = [];
  switch (req.params.name) {
    case 'boxes-per-container':
      rows = d.containers.map(c => ({
        container: c.container_number, size: SM.CONTAINER_SIZE_LABELS[c.size] || c.size,
        load_code: c.load_code || '', status: c.status,
        boxes: d.boxes.filter(b => b.container_id === c.id).length,
        eta: c.eta || '', arrived: c.actual_arrival || ''
      }));
      break;
    // Box movement: where each box was loaded, its container, and the timestamp of every
    // milestone it has passed through.
    case 'box-movement': {
      const MILESTONES = ['RECEIVED_ORIGIN', 'LOADED_CONTAINER', 'IN_TRANSIT', 'ARRIVED_PORT',
        'RECEIVED_WAREHOUSE', 'SORTED', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
      const q = String(req.query.container || '').toLowerCase();
      let boxes = d.boxes.slice();
      if (q) {
        boxes = boxes.filter(b => {
          const c = d.containers.find(x => x.id === b.container_id);
          return c && (String(c.container_number).toLowerCase().includes(q) || String(c.load_code || '').toLowerCase() === q);
        });
      }
      rows = boxes.map(b => {
        const c = d.containers.find(x => x.id === b.container_id) || {};
        const ev = d.status_events.filter(e => e.box_id === b.id);
        const at = (st) => { const e = ev.find(x => x.to_status === st); return e ? e.created_at : ''; };
        const receiver = d.customers.find(x => x.id === b.receiver_id) || {};
        const row = {
          box_id: b.id,
          box_number: b.container_box_number || b.box_number,
          container: c.container_number || '(not loaded)',
          load_code: c.load_code || '',
          loaded_from: c.origin_port || '',
          discharged_at: c.destination_port || '',
          vessel: c.vessel_name || '',
          current_status: b.status,
          region: b.region || receiver.region || '',
          receiver: receiver.full_name || ''
        };
        for (const m of MILESTONES) row[m.toLowerCase()] = at(m);
        // Full status timeline for this box (every recorded transition, in order).
        row.timeline = ev
          .slice()
          .sort((x, y) => x.created_at.localeCompare(y.created_at))
          .map(e => ({
            status: e.to_status,
            label: SM.FRIENDLY[e.to_status] || e.to_status,
            at: e.created_at,
            actor: (d.users.find(u => u.id === e.actor_user_id) || {}).name || 'System',
            note: e.note || ''
          }));
        return row;
      }).sort((a, b) => String(a.container).localeCompare(String(b.container)) || String(a.box_number).localeCompare(String(b.box_number)));
      break;
    }
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
    // Flatten the box-movement timeline (array) into one readable column for CSV.
    let csvRows = rows;
    if (req.params.name === 'box-movement') {
      csvRows = rows.map(r => {
        const { timeline, box_id, ...rest } = r;
        rest.status_timeline = (timeline || [])
          .map(e => `${e.label} @ ${new Date(e.at).toISOString().slice(0, 16).replace('T', ' ')}${e.note ? ` (${e.note})` : ''}`)
          .join(' | ');
        return rest;
      });
    }
    res.type('text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}.csv"`);
    return res.send(toCsv(csvRows));
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
const PUB_REGION_LABELS = REGION.SHORT;
function regionLabelPub(r) { return PUB_REGION_LABELS[r] || r || 'your region'; }
function fmtPHDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' }) : '';
}

// Build the full expected journey for the public tracker: every milestone the box will pass,
// each marked done (with timestamp) or upcoming. Includes the overseas last-mile legs:
// central Manila hub → destination-region hub → out for delivery in that region.
function buildJourney(box) {
  const d = db.get();
  const receiver = d.customers.find(c => c.id === box.receiver_id) || {};
  const container = d.containers.find(c => c.id === box.container_id) || null;
  const trip = box.trucking_assignment_id ? d.trips.find(t => t.id === box.trucking_assignment_id) : null;
  const region = box.region || receiver.region || null;
  const regionLbl = regionLabelPub(region);
  const ev = d.status_events.filter(e => e.box_id === box.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const at = (status) => { const e = ev.find(x => x.to_status === status); return e ? e.created_at : null; };
  const reached = (status) => ev.some(e => e.to_status === status);
  const returned = box.status === 'RETURNED';
  const cancelled = box.status === 'CANCELLED';

  // Each step: reached by any of `on` statuses → done, timestamp from the first matching event.
  const steps = [
    { key: 'CREATED', on: ['CREATED'], label: 'Booking registered',
      detail: 'Your box is registered in our system.' },
    { key: 'RECEIVED_ORIGIN', on: ['RECEIVED_ORIGIN'], label: 'Received at origin',
      detail: 'We received your box at our origin branch.' },
    { key: 'LOADED_CONTAINER', on: ['LOADED_CONTAINER'], label: 'Loaded into container',
      detail: container ? `Container ${container.container_number}.` : 'Loaded for shipping.' },
    { key: 'IN_TRANSIT', on: ['IN_TRANSIT'], label: 'On the way to Destination',
      detail: container && container.vessel_name ? `Vessel ${container.vessel_name}.` : 'Shipped by sea to the Philippines.' },
    { key: 'ARRIVED_PORT', on: ['ARRIVED_PORT'], label: 'Arrived at Destination',
      detail: container && container.destination_port ? `Port of ${container.destination_port}.` : 'Arrived at the Philippine port.' },
    { key: 'RECEIVED_WAREHOUSE', on: ['RECEIVED_WAREHOUSE'], label: 'Received at VFIC warehouse',
      detail: 'Unloaded and received at our central (Manila) warehouse.' },
    { key: 'SORTED', on: ['SORTED'], label: `Sorted for ${regionLbl}`,
      detail: 'Segregated by destination region for delivery.' },
    // --- overseas last-mile: hub → region ---
    { key: 'FORWARDED_REGION', on: ['ASSIGNED', 'LOADED_TRUCK'], label: `Forwarded to ${regionLbl}`,
      detail: `Dispatched from the central hub to the ${regionLbl} delivery hub.` },
    { key: 'OUT_FOR_DELIVERY', on: ['OUT_FOR_DELIVERY'], label: `Out for delivery in ${regionLbl}`,
      detail: trip && trip.driver_name ? `Driver: ${trip.driver_name}${trip.driver_contact ? ' · ' + trip.driver_contact : ''}.` : 'On the delivery vehicle today.' },
    { key: 'DELIVERED', on: ['DELIVERED'], label: 'Delivered',
      detail: 'Delivered to the receiver. Salamat po for choosing VFIC!' }
  ];

  const journey = steps.map(s => {
    const ts = s.on.map(at).find(Boolean) || null;
    return { key: s.key, label: s.label, detail: s.detail, at: ts, done: s.on.some(reached) };
  });
  // Mark the current (latest completed) step and, if returned, add a branch note.
  let currentIdx = -1;
  journey.forEach((j, i) => { if (j.done) currentIdx = i; });
  journey.forEach((j, i) => { j.current = i === currentIdx && !cancelled; });

  return {
    region, regionLbl, journey,
    returned, cancelled,
    returnNote: returned
      ? 'A delivery attempt was made but was unsuccessful. Your box is safely back at the hub and will be rescheduled — please contact us to confirm your details.'
      : null
  };
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
    etaText = `Vessel ETA Manila: ${fmtPHDate(container.eta)}`;
  }
  const j = buildJourney(box);
  return {
    box_number: box.box_number,
    status: box.status,
    status_label: SM.FRIENDLY[box.status] || box.status,
    status_updated_at: box.status_updated_at,
    receiver_first_name: (receiver.full_name || '').split(' ')[0],
    receiver_city: receiver.city_municipality || '',
    region_label: j.regionLbl,
    eta_text: etaText,
    journey: j.journey,
    returned: j.returned,
    cancelled: j.cancelled,
    return_note: j.returnNote,
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
const noCache = res => res.set('Cache-Control', 'no-cache');
app.get('/', (req, res) => { noCache(res); res.sendFile(path.join(__dirname, 'public', 'landing.html')); });
app.get('/app', (req, res) => { noCache(res); res.sendFile(path.join(__dirname, 'public', 'index.html')); });
// Branch portals: /th (Thailand), /kh (Cambodia), /mnl (Manila HQ). Each serves the same
// application — the slug only brands the sign-in and restricts who may sign in there.
// All branches share one database, so Manila always sees the consolidated picture.
app.get(['/th', '/kh', '/mnl', '/dev'], (req, res) => { noCache(res); res.sendFile(path.join(__dirname, 'public', 'index.html')); });
// Serve assets with must-revalidate so a new deploy is picked up immediately (no stale app.js/CSS).
// ETags still yield cheap 304s when a file is unchanged.
app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  setHeaders: (res, filePath) => {
    if (/\.(html|js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
}));

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
