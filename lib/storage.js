// File storage adapter for uploads (passports, packing lists, POD photos).
// Production (Vercel): Vercel Blob. Local/dev: filesystem (data/uploads/<folder>/).
// Files are addressed by an opaque `key` ("<folder>/<timestamp>-<name>") and served
// only through the authenticated /files proxy — the raw blob URL is never exposed.
const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

function safeName(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
}
function guessType(key) {
  const ext = path.extname(key).toLowerCase();
  return { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.pdf': 'application/pdf' }[ext] || 'application/octet-stream';
}

// Save a buffer; returns the storage key (also the /files/<key> path).
async function save(buffer, name, folder) {
  const key = `${folder}/${Date.now()}-${safeName(name)}`;
  if (useBlob) {
    const { put } = require('@vercel/blob');
    await put(key, buffer, { access: 'public', addRandomSuffix: false, contentType: guessType(key) });
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
    const { head } = require('@vercel/blob');
    let meta;
    try { meta = await head(key); } catch (e) { return null; }
    if (!meta || !meta.url) return null;
    const r = await fetch(meta.url);
    if (!r.ok) return null;
    return { buffer: Buffer.from(await r.arrayBuffer()), contentType: meta.contentType || guessType(key) };
  }
  const full = path.join(UPLOAD_DIR, key);
  if (!full.startsWith(UPLOAD_DIR) || !fs.existsSync(full)) return null;
  return { buffer: fs.readFileSync(full), contentType: guessType(key) };
}

module.exports = { save, read, useBlob };
