// Preflight for the data store: says which backend is configured and proves it can actually
// be read and written, before the app is trusted with real shipments.
//
//   npm run check-store
//
// Run it locally after filling in .env, and against a deployment by setting the same
// variables. It never prints a key — only whether one is present and its length, so the
// output is safe to paste into a chat or an issue.
// Loaded once, before ./store is required — it picks its backend at require time.
const ENV = require('./env').load();

const store = require('./store');

const ok = (s) => `  \x1b[32m✓\x1b[0m ${s}`;
const bad = (s) => `  \x1b[31m✗\x1b[0m ${s}`;
const info = (s) => `    ${s}`;

// Show that a secret is set without ever revealing it.
function fingerprint(value) {
  if (!value) return 'not set';
  const v = String(value);
  return `set (${v.length} chars, ends “…${v.slice(-4)}”)`;
}

function describeUrl(u) {
  if (!u) return 'not set';
  try {
    const url = new URL(u);
    return `${url.protocol}//${url.host}`;
  } catch (e) { return `INVALID URL: ${u}`; }
}

async function main() {
  console.log('\nVFIC data store check');
  console.log('─'.repeat(58));
  console.log(ENV.loaded
    ? info(`.env loaded from ${ENV.file} — ${ENV.keys.length} variable(s) applied`)
    : info(`No .env file at ${ENV.file} — reading the ambient environment only.`));

  console.log(`\nBackend selected: \x1b[1m${store.backend}\x1b[0m`);
  const node = require('./node');
  console.log(info(`Node: ${node.NODE_ID} · id band from ${node.ID_OFFSET.toLocaleString()}`));
  console.log(info(`Document key: ${process.env.KV_DB_KEY || `vfic:db:${node.NODE_ID}`}`));

  if (store.backend === 'supabase') {
    console.log(info(`SUPABASE_URL: ${describeUrl(process.env.SUPABASE_URL)}`));
    console.log(info(`Service role key: ${fingerprint(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY)}`));
    console.log(info(`Table: ${process.env.SUPABASE_TABLE || 'kv'}`));
  } else if (store.backend === 'kv') {
    console.log(info(`Redis REST URL: ${describeUrl(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)}`));
    console.log(info(`Token: ${fingerprint(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)}`));
  } else if (store.backend === 'ephemeral-tmp') {
    console.log(bad('Running on Vercel with NO cloud store — data resets on every cold start.'));
    console.log(info('Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or the KV pair) on the project.'));
  } else {
    console.log(info(`Files under ${store.DATA_DIR}`));
    console.log(info('This is the local dev default. Fill in .env to use Supabase instead.'));
  }

  // ---- read ----
  console.log('\nRead');
  let existing = null;
  try {
    existing = await store.loadDoc();
    if (existing) {
      const counts = ['users', 'customers', 'shipments', 'boxes', 'containers']
        .filter(k => Array.isArray(existing[k]))
        .map(k => `${existing[k].length} ${k}`).join(' · ');
      console.log(ok('Read the stored document.'));
      console.log(info(counts || 'Document present but has no recognisable collections.'));
    } else {
      console.log(ok('Connected. No document stored yet — the app will seed demo data on first start.'));
    }
  } catch (e) {
    console.log(bad('Read failed: ' + e.message));
    console.log(hint(e));
    process.exitCode = 1;
    return;
  }

  // ---- write ----
  // Round-trips a scratch key so a broken write surfaces here rather than the first time a
  // shipment is saved. Never touches the real document.
  console.log('\nWrite');
  const probeKey = 'vfic:store-check';
  try {
    if (store.backend === 'supabase') {
      const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
      const table = process.env.SUPABASE_TABLE || 'kv';
      const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
      const stamp = new Date().toISOString();
      const put = await fetch(`${url}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ k: probeKey, v: { checked_at: stamp } })
      });
      if (!put.ok) throw new Error(`${put.status} ${await put.text().catch(() => '')}`);
      const got = await fetch(`${url}/rest/v1/${table}?k=eq.${encodeURIComponent(probeKey)}&select=v`, { headers });
      const rows = await got.json();
      if (!rows.length || rows[0].v.checked_at !== stamp) throw new Error('wrote a row but read back something else');
      await fetch(`${url}/rest/v1/${table}?k=eq.${encodeURIComponent(probeKey)}`, { method: 'DELETE', headers });
      console.log(ok('Wrote, read back and deleted a scratch row.'));
    } else if (store.backend === 'kv') {
      const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
      const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
      const cmd = async (c) => {
        const r = await fetch(kvUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(c)
        });
        if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(() => '')}`);
        return r.json();
      };
      const stamp = new Date().toISOString();
      await cmd(['SET', probeKey, stamp]);
      const back = await cmd(['GET', probeKey]);
      if (back.result !== stamp) throw new Error('wrote a key but read back something else');
      await cmd(['DEL', probeKey]);
      console.log(ok('Wrote, read back and deleted a scratch key.'));
    } else {
      console.log(ok('Filesystem backend — writes go to ' + store.DATA_DIR));
    }
  } catch (e) {
    console.log(bad('Write failed: ' + e.message));
    console.log(hint(e));
    process.exitCode = 1;
    return;
  }

  // ---- other production settings worth knowing about ----
  console.log('\nOther production settings');
  const sessionSecret = process.env.SESSION_SECRET;
  console.log(sessionSecret ? ok('SESSION_SECRET is set.')
    : bad('SESSION_SECRET is not set — sessions will not survive a restart in production.'));
  console.log(process.env.BLOB_READ_WRITE_TOKEN ? ok('Vercel Blob token is set (uploads persist).')
    : info('BLOB_READ_WRITE_TOKEN not set — uploaded IDs/forms go to local disk.'));
  if (require('./node').syncEnabled()) console.log(ok(`Replication configured with ${node.PEERS.length} peer(s).`));
  else console.log(info('Replication not configured (VFIC_SYNC_SECRET / VFIC_PEERS unset).'));

  console.log('\n\x1b[32mStore is reachable and writable.\x1b[0m\n');
}

// Turn the common failures into the actual fix rather than a bare status code.
function hint(e) {
  const m = String(e.message || '');
  if (/relation .* does not exist|PGRST205|Could not find the table/i.test(m)) {
    return info('The kv table is missing. In Supabase → SQL Editor, run:\n' +
      '      create table if not exists kv (k text primary key, v jsonb);\n' +
      '      alter table kv enable row level security;');
  }
  if (/401|JWT|Invalid API key|invalid signature/i.test(m)) {
    return info('The key was rejected. Use the service_role key from Project Settings → API — not anon, not the database password.');
  }
  if (/permission denied|42501|row-level security/i.test(m)) {
    return info('RLS blocked this. That is expected for the anon key — the server must use service_role.');
  }
  if (/ENOTFOUND|EAI_AGAIN|fetch failed|ECONNREFUSED/i.test(m)) {
    return info('Could not reach the host. Check SUPABASE_URL is the Project URL (https://<ref>.supabase.co) and that the project is not paused.');
  }
  if (/404/.test(m)) {
    return info('404 usually means the table name is wrong, or the Data API is disabled for this project.');
  }
  return info('Full error above. Check the values in .env against Supabase → Project Settings → API.');
}

main().catch(e => { console.error('\n' + bad(e.message) + '\n'); process.exitCode = 1; });
