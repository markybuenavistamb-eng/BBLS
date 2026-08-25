// In-memory working copy of the DB document, backed by the store adapter (KV or filesystem).
// Serverless-safe pattern: a request middleware calls `await load()` before handlers run, and
// flushes after. Handlers keep using the synchronous get()/persist() they always did.
const crypto = require('crypto');
const store = require('./store');

let data = null;
let dirty = false;

// Load the document from the store into memory (seeding on first run). Async — call per request.
async function load() {
  data = await store.loadDoc();
  if (!data) {
    data = require('./seed').build();
    await store.saveDoc(data);
  }
  dirty = false;
  return data;
}

// Write the document back to the store if it was mutated this request.
// Revisions are stamped first so replicating peers can see exactly what changed.
async function flush() {
  if (dirty && data) {
    require('./sync').stampRevisions(data);
    await store.saveDoc(data);
    dirty = false;
  }
}

function get() {
  if (!data) {
    // Synchronous fallback for local/filesystem callers outside a request (dev only).
    const d = store.loadDocSync();
    if (d) data = d;
    else { data = require('./seed').build(); store.saveDocSync(data); }
  }
  return data;
}

// Mark the in-memory doc dirty; the actual store write happens in flush().
function persist() { dirty = true; }
function isDirty() { return dirty; }

// IDs are namespaced per deployment by the node's offset band (HQ 0…, Thailand 1,000,000…,
// Cambodia 2,000,000…), so ids minted on separate deployments never collide and foreign keys
// survive replication unchanged.
function nextId(key) {
  const d = get();
  const offset = require('./node').ID_OFFSET;
  const next = Math.max((d.seq[key] || 0) + 1, offset + 1);
  d.seq[key] = next;
  return next;
}

// The next number in a "<PREFIX>-<year>-<6 digits>" series.
//
// The digits are minted inside this node's band (Manila 000001…, Thailand 100001…, Cambodia
// 200001…), the same idea as the id bands above and for the same reason: three deployments
// mint into one replicated database, so a counter that only counts what its own node has
// issued is not unique once the records meet. A shared prefix cannot separate them — it names
// the origin country, and Manila books Thailand's shipments too.
//
// The counter is also floored at the highest number already in use in this node's band, so a
// seed, a restore or a rolled-back document cannot hand out a number that is already printed
// on a box label. `records`/`field` are where that series lives.
function nextNumber(key, prefix, records, field) {
  const d = get();
  const NODE = require('./node');
  const band = NODE.NUMBER_BAND;
  const inUse = new RegExp(`^${prefix}-\\d{4}-(\\d+)$`);
  let highest = band;
  for (const r of (records || [])) {
    const m = inUse.exec(String((r || {})[field] || ''));
    if (!m) continue;
    const v = parseInt(m[1], 10);
    if (v > highest && v < band + NODE.NUMBER_BAND_SIZE) highest = v;
  }
  // A stored counter is only believed while it is inside this node's own band. seq does not
  // replicate, so one arriving from another node means the database was restored or copied from
  // the wrong deployment — trusting it would have this node mint into its neighbour's band,
  // which is the collision the bands exist to prevent. `highest` is never below the band, so
  // discarding a stray value can only ever move the counter to where this node should be.
  const seqKey = `${key}:${prefix}`;
  const stored = Number(d.seq[seqKey]) || 0;
  const ours = stored > band && stored < band + NODE.NUMBER_BAND_SIZE;
  const next = Math.max(ours ? stored : 0, highest) + 1;
  d.seq[seqKey] = next;
  return `${prefix}-${new Date().getFullYear()}-${String(next).padStart(6, '0')}`;
}

// Shipment number, prefixed with the origin country code: TH-2026-000123 / KH-2026-000124.
// Box numbers extend it with the box index (TH-2026-000123-01), so a box's origin is
// readable straight off its ID. Falls back to VF when the origin is unknown.
function nextShipmentNumber(originCountry) {
  const code = require('./branches').countryCode(originCountry);
  return nextNumber('shipment_number', code, get().shipments, 'shipment_number');
}

// 128-bit URL-safe random token for public tracking URLs
function newQrToken() {
  return crypto.randomBytes(16).toString('base64url');
}

// Online intake request reference code: IR-2026-000123. Banded like the shipment number —
// every branch takes bookings through its own portal, into the one replicated database.
function nextIntakeRefCode() {
  return nextNumber('intake_request_code', 'IR', get().intake_requests, 'reference_code');
}

// Box order reference code: BO-2026-000123
function nextBoxOrderCode() {
  return nextNumber('box_order_code', 'BO', get().box_orders, 'reference_code');
}

module.exports = {
  load, flush, get, persist, isDirty,
  nextId, nextShipmentNumber, newQrToken, nextIntakeRefCode, nextBoxOrderCode,
  DATA_DIR: store.DATA_DIR
};
