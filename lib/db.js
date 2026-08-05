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

// Shipment number, prefixed with the origin country code: TH-2026-000123 / KH-2026-000124.
// Box numbers extend it with the box index (TH-2026-000123-01), so a box's origin is
// readable straight off its ID. Falls back to VF when the origin is unknown.
function nextShipmentNumber(originCountry) {
  const d = get();
  const code = require('./branches').countryCode(originCountry);
  d.seq.shipment_number = (d.seq.shipment_number || 0) + 1;
  return `${code}-${new Date().getFullYear()}-${String(d.seq.shipment_number).padStart(6, '0')}`;
}

// 128-bit URL-safe random token for public tracking URLs
function newQrToken() {
  return crypto.randomBytes(16).toString('base64url');
}

// Online intake request reference code: IR-2026-000123
function nextIntakeRefCode() {
  const d = get();
  d.seq.intake_request_code = (d.seq.intake_request_code || 0) + 1;
  return `IR-${new Date().getFullYear()}-${String(d.seq.intake_request_code).padStart(6, '0')}`;
}

// Box order reference code: BO-2026-000123
function nextBoxOrderCode() {
  const d = get();
  d.seq.box_order_code = (d.seq.box_order_code || 0) + 1;
  return `BO-${new Date().getFullYear()}-${String(d.seq.box_order_code).padStart(6, '0')}`;
}

module.exports = {
  load, flush, get, persist, isDirty,
  nextId, nextShipmentNumber, newQrToken, nextIntakeRefCode, nextBoxOrderCode,
  DATA_DIR: store.DATA_DIR
};
