// Document store adapter for the whole DB JSON.
// Production (Vercel): Redis REST (Vercel KV / Upstash) — one key holds the JSON doc.
// Local/dev: filesystem (data/db.json). Selected automatically by env vars present.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const KV_KEY = process.env.KV_DB_KEY || 'vfic:db';
const useKV = !!(KV_URL && KV_TOKEN);

async function kvCmd(cmd) {
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  if (!res.ok) throw new Error(`KV ${cmd[0]} failed: ${res.status} ${await res.text().catch(() => '')}`);
  return res.json();
}

async function loadDoc() {
  if (useKV) {
    const j = await kvCmd(['GET', KV_KEY]);
    if (j.result == null) return null;
    return typeof j.result === 'string' ? JSON.parse(j.result) : j.result;
  }
  return loadDocSync();
}

async function saveDoc(doc) {
  if (useKV) {
    await kvCmd(['SET', KV_KEY, JSON.stringify(doc)]);
    return;
  }
  saveDocSync(doc);
}

// Synchronous filesystem helpers (local only; used as a fallback by db.get()).
function loadDocSync() {
  if (useKV) return null; // KV has no sync path — caller must use async loadDoc()
  if (!fs.existsSync(DB_FILE)) return null;
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDocSync(doc) {
  if (useKV) return; // no-op in KV mode
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(doc, null, 2));
}

module.exports = { loadDoc, saveDoc, loadDocSync, saveDocSync, useKV, DATA_DIR };
