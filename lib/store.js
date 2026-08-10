// Document store adapter for the whole DB JSON.
// Backend is chosen automatically from env vars (first match wins):
//   1. Supabase (Postgres)      — SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY   (persistent)
//   2. Redis REST (Vercel KV/Upstash) — KV_REST_API_URL + KV_REST_API_TOKEN  (persistent)
//   3. Ephemeral /tmp on Vercel — when no cloud store is configured yet        (resets!)
//   4. Filesystem (local/dev)   — data/db.json                                 (persistent)
// The whole app state is stored as one JSON document under a single key/row.
const fs = require('fs');
const os = require('os');
const path = require('path');

// Each deployment keeps its own database. VFIC_DATA_DIR lets several nodes run side by side
// on one machine (used when testing replication); in production each node has its own
// Supabase/KV instance and its own document key.
const DATA_DIR = process.env.VFIC_DATA_DIR || path.join(__dirname, '..', 'data');
const DOC_KEY = process.env.KV_DB_KEY || `vfic:db:${process.env.VFIC_NODE_ID || 'HQ_MANILA'}`;

// --- Supabase (Postgres via PostgREST) ---
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
const SB_TABLE = process.env.SUPABASE_TABLE || 'kv';
const useSB = !!(SB_URL && SB_KEY);

// --- Redis REST (Vercel KV / Upstash) ---
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const useKV = !!(KV_URL && KV_TOKEN);

// On Vercel with no cloud store yet, use the (writable, ephemeral) /tmp dir so the app runs
// instead of 503-ing on the read-only project filesystem. Data does not persist across
// cold starts / instances — configure Supabase or KV for real persistence.
const onVercel = !!process.env.VERCEL;
const ephemeral = onVercel && !useSB && !useKV;
const FS_DIR = ephemeral ? path.join(os.tmpdir(), 'vfic-data') : DATA_DIR;
const FS_FILE = path.join(FS_DIR, 'db.json');

const backend = useSB ? 'supabase' : useKV ? 'kv' : ephemeral ? 'ephemeral-tmp' : 'filesystem';

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

// Synchronous filesystem/ephemeral helpers.
function loadDocSync() {
  if (useSB || useKV) return null; // cloud backends have no sync path — use async loadDoc()
  if (!fs.existsSync(FS_FILE)) return null;
  return JSON.parse(fs.readFileSync(FS_FILE, 'utf8'));
}
function saveDocSync(doc) {
  if (useSB || useKV) return; // no-op in cloud mode
  fs.mkdirSync(FS_DIR, { recursive: true });
  fs.writeFileSync(FS_FILE, JSON.stringify(doc, null, 2));
}

// Turn a raw store failure into a short, safe reason plus the fix. Used by /api/health and
// by the CLI check, so both explain a broken connection the same way. Deliberately returns
// classified text rather than the driver's message: health is a public endpoint and the
// underlying error can name tables and columns.
function classifyError(err, backendName) {
  const m = String((err && err.message) || err || '');
  // The remedy differs per backend, so name the right dashboard and the right credential.
  const be = backendName || backend;
  if (/relation .* does not exist|PGRST205|Could not find the table|42P01/i.test(m)) {
    return { reason: 'table_missing', fix: 'The kv table does not exist. Run in the Supabase SQL editor: create table if not exists kv (k text primary key, v jsonb); alter table kv enable row level security;' };
  }
  if (/\b401\b|\b403\b|JWT|Invalid API key|invalid signature|invalid_token|unauthorized|WRONGPASS|NOAUTH/i.test(m)) {
    return {
      reason: 'unauthorized',
      fix: be === 'kv'
        ? 'The Redis REST token was rejected. Copy UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_TOKEN) from the database\'s REST API panel, and check the URL belongs to the same database. If you rolled the token, update the deployment and redeploy.'
        : 'The key was rejected. Use the service_role key from Project Settings → API — not anon, and not the database password. If you rotated it, update the deployment and redeploy.'
    };
  }
  if (/permission denied|42501|row-level security/i.test(m)) {
    return { reason: 'forbidden', fix: 'Row-level security blocked the request, which is what the anon key gets. The server must use the service_role key.' };
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|network|timeout|ETIMEDOUT/i.test(m)) {
    return { reason: 'unreachable', fix: 'Could not reach the database host. Check the URL is the project URL (https://<ref>.supabase.co) and that the project is not paused.' };
  }
  if (/\b404\b/.test(m)) {
    return { reason: 'not_found', fix: 'The endpoint returned 404 — usually a wrong table name, or the Data API is disabled for the project.' };
  }
  if (/\b5\d\d\b/.test(m)) {
    return { reason: 'upstream_error', fix: 'The database returned a server error. Check the provider status page and whether the project is paused or over quota.' };
  }
  return { reason: 'unknown', fix: 'Check the store variables on this deployment against the provider dashboard.' };
}

// Read-only liveness probe. Never throws — the whole point is to report the failure.
async function probe() {
  const started = Date.now();
  try {
    const doc = await loadDoc();
    return { ok: true, ms: Date.now() - started, seeded: !!doc };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, ...classifyError(e) };
  }
}

module.exports = { loadDoc, saveDoc, loadDocSync, saveDocSync, useKV, useSB, ephemeral, backend, DATA_DIR, classifyError, probe };
