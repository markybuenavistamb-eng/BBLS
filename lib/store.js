// Document store adapter for the whole DB JSON.
// Backend is chosen automatically from env vars (first match wins):
//   1. Supabase (Postgres)      — SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//   2. Redis REST (Vercel KV/Upstash) — KV_REST_API_URL + KV_REST_API_TOKEN
//   3. Filesystem (local/dev)   — data/db.json
// The whole app state is stored as one JSON document under a single key/row.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const DOC_KEY = process.env.KV_DB_KEY || 'vfic:db';

// --- Supabase (Postgres via PostgREST) ---
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
const SB_TABLE = process.env.SUPABASE_TABLE || 'kv';
const useSB = !!(SB_URL && SB_KEY);

// --- Redis REST (Vercel KV / Upstash) ---
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const useKV = !!(KV_URL && KV_TOKEN);

const backend = useSB ? 'supabase' : useKV ? 'kv' : 'filesystem';

// ---- Supabase helpers ----
function sbHeaders(extra) {
  return Object.assign({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, extra || {});
}
async function sbLoad() {
  const url = `${SB_URL}/rest/v1/${SB_TABLE}?k=eq.${encodeURIComponent(DOC_KEY)}&select=v`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Supabase load failed: ${res.status} ${await res.text().catch(() => '')}`);
  const rows = await res.json();
  return rows.length ? rows[0].v : null;
}
async function sbSave(doc) {
  const res = await fetch(`${SB_URL}/rest/v1/${SB_TABLE}`, {
    method: 'POST',
    headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ k: DOC_KEY, v: doc })
  });
  if (!res.ok) throw new Error(`Supabase save failed: ${res.status} ${await res.text().catch(() => '')}`);
}

// ---- Redis REST helpers ----
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
  if (useSB) return sbLoad();
  if (useKV) {
    const j = await kvCmd(['GET', DOC_KEY]);
    if (j.result == null) return null;
    return typeof j.result === 'string' ? JSON.parse(j.result) : j.result;
  }
  return loadDocSync();
}

async function saveDoc(doc) {
  if (useSB) return sbSave(doc);
  if (useKV) return void (await kvCmd(['SET', DOC_KEY, JSON.stringify(doc)]));
  saveDocSync(doc);
}

// Synchronous filesystem helpers (local only; used as a fallback by db.get()).
function loadDocSync() {
  if (useSB || useKV) return null; // cloud backends have no sync path — use async loadDoc()
  if (!fs.existsSync(DB_FILE)) return null;
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDocSync(doc) {
  if (useSB || useKV) return; // no-op in cloud mode
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(doc, null, 2));
}

module.exports = { loadDoc, saveDoc, loadDocSync, saveDocSync, useKV, useSB, backend, DATA_DIR };
