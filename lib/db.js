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
async function flush() {
  if (dirty && data) {
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

function nextId(key) {
  const d = get();
  d.seq[key] = (d.seq[key] || 0) + 1;
  return d.seq[key];
}

// Shipment number: VF-2026-000123
function nextShipmentNumber() {
  const d = get();
  d.seq.shipment_number = (d.seq.shipment_number || 0) + 1;
  return `VF-${new Date().getFullYear()}-${String(d.seq.shipment_number).padStart(6, '0')}`;
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

module.exports = {
  load, flush, get, persist, isDirty,
  nextId, nextShipmentNumber, newQrToken, nextIntakeRefCode,
  DATA_DIR: store.DATA_DIR
};
