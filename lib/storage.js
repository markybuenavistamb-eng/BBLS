// File storage adapter for uploads (passports, packing lists, POD photos).
// Production (Vercel): Vercel Blob. Local/dev: filesystem (data/uploads/<folder>/).
// Files are addressed by an opaque `key` ("<folder>/<timestamp>-<name>") and served
// only through the authenticated /files proxy — the raw blob URL is never exposed.
const fs = require('fs');
const os = require('os');
const path = require('path');

const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

// A Vercel Blob store is created as either public or private, and put() must be told which
// — asking for 'public' on a private store is rejected outright. Private is the right
// setting here: these are passport and ID scans, and the app already serves every file
// through the authenticated /files proxy rather than handing out a blob URL, so a public
// store would be a way around that check for anyone who learned a URL. Public stores stay
// supported for anyone who already made one; set BLOB_ACCESS=public in that case.
const BLOB_ACCESS = process.env.BLOB_ACCESS === 'public' ? 'public' : 'private';
const OTHER_ACCESS = BLOB_ACCESS === 'private' ? 'public' : 'private';
const isAccessMismatch = (e) => /access/i.test(String((e && e.message) || ''));
// On Vercel without a Blob store, fall back to the writable (but ephemeral) /tmp dir so
// uploads work instead of failing on the read-only project filesystem.
const ephemeral = !!process.env.VERCEL && !useBlob;
const UPLOAD_DIR = ephemeral
  ? path.join(os.tmpdir(), 'vfic-uploads')
  : path.join(__dirname, '..', 'data', 'uploads');

function safeName(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
}
function guessType(key) {
  const ext = path.extname(key).toLowerCase();
  return { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.pdf': 'application/pdf' }[ext] || 'application/octet-stream';
}

// Save a buffer; returns the storage key (also the /files/<key> path).
//
// The key is prefixed with the node that uploaded the file. All three deployments share one
// Blob store — they must, because a key uploaded at a branch replicates to head office
// inside the shipment record, and head office resolves it against whatever store its own
// token points at. Sharing one bucket makes that work; the prefix keeps each branch's
// uploads in their own folder and makes a same-millisecond, same-filename collision between
// two branches impossible.
async function save(buffer, name, folder) {
  const nodeId = require('./node').NODE_ID;
  const key = `${nodeId}/${folder}/${Date.now()}-${safeName(name)}`;
  if (useBlob) {
    const { put } = require('@vercel/blob');
    const opts = { addRandomSuffix: false, contentType: guessType(key) };
    try {
      await put(key, buffer, { ...opts, access: BLOB_ACCESS });
    } catch (e) {
      // The store is configured the other way round. Losing a sender's booking over a
      // setting we can detect from the error is not worth it — retry once, and say so.
      if (!isAccessMismatch(e)) throw e;
      console.warn(`Blob store is ${OTHER_ACCESS}, not ${BLOB_ACCESS}. Saving as ${OTHER_ACCESS}; set BLOB_ACCESS=${OTHER_ACCESS} to skip this retry.`);
      await put(key, buffer, { ...opts, access: OTHER_ACCESS });
    }
    return key;
  }
  const full = path.join(UPLOAD_DIR, key);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer);
  return key;
}

// Read a file by key; returns { buffer, contentType } or null.
async function read(key) {
  key = String(key).replace(/^\/+/, '').replace(/\.\.+/g, '');
  if (useBlob) {
    // get() authenticates with the store token, which a private blob requires — its URL is
    // not fetchable on its own. Works for a public store too, so there is one path.
    const { get } = require('@vercel/blob');
    let res = null;
    try { res = await get(key, { access: BLOB_ACCESS }); }
    catch (e) { if (!isAccessMismatch(e)) return null; }
    // Files saved before the access setting was settled still have to open.
    if (!res) { try { res = await get(key, { access: OTHER_ACCESS }); } catch (e) { return null; } }
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    const chunks = [];
    for await (const chunk of res.stream) chunks.push(Buffer.from(chunk));
    return {
      buffer: Buffer.concat(chunks),
      contentType: (res.blob && res.blob.contentType) || guessType(key)
    };
  }
  const full = path.join(UPLOAD_DIR, key);
  if (!full.startsWith(UPLOAD_DIR) || !fs.existsSync(full)) return null;
  return { buffer: fs.readFileSync(full), contentType: guessType(key) };
}

// Where uploads actually land, for /api/health. 'ephemeral-tmp' is the dangerous one: files
// appear to save, then vanish with the instance — an ID scan lost hours after intake.
const fileBackend = useBlob ? 'blob' : ephemeral ? 'ephemeral-tmp' : 'filesystem';

module.exports = { save, read, useBlob, ephemeral, fileBackend };
