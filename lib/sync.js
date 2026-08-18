// Replication between VFIC deployments.
//
// HOW IT WORKS
// ------------
// Every syncable record carries three hidden fields:
//   _node — the node that owns it (only that node may change it)
//   _uid  — globally unique key, "<node>:<collection>:<id>"
//   _rev  — a local revision counter, bumped whenever the record's content changes
//
// Each node PULLS from its peers: "give me everything you own with _rev greater than the
// cursor I last saw". Incoming records are upserted by _uid. A node never overwrites a
// record it owns, so there is no conflict resolution to get wrong — ownership is the rule.
//
// Revisions are stamped in one pass on save (stampRevisions), by comparing each record
// against an in-memory snapshot. That keeps handlers free of bookkeeping; after a cold
// start the snapshot is empty, so the first save re-stamps everything and peers simply
// re-pull it — self-healing rather than lossy.

const crypto = require('crypto');
const NODE = require('./node');

// Collections that replicate between deployments. Users and settings deliberately do NOT —
// each deployment keeps its own staff accounts and its own configuration.
const SYNC_COLLECTIONS = [
  'customers', 'shipments', 'boxes', 'containers', 'status_events',
  'intake_requests', 'box_orders', 'invoices', 'expenses', 'interbranch_invoices',
  'trips', 'delivery_attempts', 'notifications', 'messages'
];

const META = ['_node', '_uid', '_rev'];
const fingerprint = (rec) => {
  const copy = {};
  for (const k of Object.keys(rec).sort()) if (!META.includes(k)) copy[k] = rec[k];
  return crypto.createHash('sha1').update(JSON.stringify(copy)).digest('hex');
};

// In-memory fingerprint cache: _uid → hash. Not persisted (see note above).
const snapshot = new Map();

/** Assign ownership + bump _rev for anything that changed. Returns how many were stamped. */
function stampRevisions(doc) {
  if (!doc) return 0;
  let changed = 0;
  doc.seq = doc.seq || {};
  for (const coll of SYNC_COLLECTIONS) {
    const list = doc[coll];
    if (!Array.isArray(list)) continue;
    for (const rec of list) {
      if (!rec || typeof rec !== 'object') continue;
      if (!rec._node) {
        // Ownership is inferred once: by the id band it was minted in, else this node.
        const owner = NODE.nodeForId(rec.id);
        rec._node = owner ? owner.id : NODE.NODE_ID;
      }
      if (!rec._uid) rec._uid = `${rec._node}:${coll}:${rec.id}`;
      // Only the owning node may re-stamp a record.
      if (rec._node !== NODE.NODE_ID) continue;
      const fp = fingerprint(rec);
      if (snapshot.get(rec._uid) !== fp) {
        doc.seq.rev = (doc.seq.rev || 0) + 1;
        rec._rev = doc.seq.rev;
        snapshot.set(rec._uid, fp);
        changed += 1;
      }
    }
  }
  return changed;
}

/** Records this node owns with _rev greater than `since` — the payload a peer pulls. */
function changesSince(doc, since = 0) {
  const cursor = Number(since) || 0;
  const out = {};
  let max = cursor;
  for (const coll of SYNC_COLLECTIONS) {
    const list = Array.isArray(doc[coll]) ? doc[coll] : [];
    const mine = list.filter(r => r && r._node === NODE.NODE_ID && (r._rev || 0) > cursor);
    if (mine.length) out[coll] = mine;
    for (const r of mine) max = Math.max(max, r._rev || 0);
  }
  return { node: NODE.NODE_ID, cursor: max, collections: out };
}

/** Upsert a peer's records. Records this node owns are ignored — ownership wins. */
function applyChanges(doc, payload) {
  const from = payload && payload.node;
  if (!from || from === NODE.NODE_ID) return { applied: 0, skipped: 0 };
  let applied = 0, skipped = 0;
  for (const [coll, records] of Object.entries((payload && payload.collections) || {})) {
    if (!SYNC_COLLECTIONS.includes(coll)) { skipped += records.length; continue; }
    doc[coll] = Array.isArray(doc[coll]) ? doc[coll] : [];
    const index = new Map(doc[coll].map((r, i) => [r && r._uid, i]));
    for (const rec of records) {
      if (!rec || !rec._uid) { skipped += 1; continue; }
      if (rec._node !== from) { skipped += 1; continue; }        // a peer may only send its own
      const at = index.get(rec._uid);
      if (at === undefined) { doc[coll].push(rec); index.set(rec._uid, doc[coll].length - 1); }
      else if ((doc[coll][at]._rev || 0) <= (rec._rev || 0)) doc[coll][at] = rec;
      else { skipped += 1; continue; }
      applied += 1;
    }
  }
  return { applied, skipped };
}

/** Pull once from every configured peer. Returns a per-peer result for the console. */
async function runSync(doc, { fetchImpl = fetch } = {}) {
  if (!NODE.syncEnabled()) return { ok: false, reason: 'Sync is not configured on this deployment', peers: [] };
  doc.sync_state = doc.sync_state || {};
  const results = [];
  for (const peer of NODE.PEERS) {
    const state = doc.sync_state[peer.id] || { cursor: 0 };
    const started = Date.now();
    try {
      const url = `${peer.url}/api/sync/pull?since=${state.cursor || 0}`;
      const res = await fetchImpl(url, { headers: { 'x-vfic-sync': NODE.SYNC_SECRET, 'x-vfic-node': NODE.NODE_ID } });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}`);
      const payload = await res.json();
      const { applied, skipped } = applyChanges(doc, payload);
      doc.sync_state[peer.id] = {
        cursor: payload.cursor || state.cursor || 0,
        last_ok: new Date().toISOString(), last_error: null,
        last_applied: applied, ms: Date.now() - started
      };
      results.push({ peer: peer.id, ok: true, applied, skipped, cursor: doc.sync_state[peer.id].cursor });
    } catch (e) {
      doc.sync_state[peer.id] = {
        ...(doc.sync_state[peer.id] || { cursor: 0 }),
        last_error: e.message, last_error_at: new Date().toISOString(), ms: Date.now() - started
      };
      results.push({ peer: peer.id, ok: false, error: e.message });
    }
  }
  return { ok: results.every(r => r.ok), peers: results };
}

/** What this node knows about itself and its peers — powers the developer console. */
function status(doc) {
  const counts = {};
  for (const coll of SYNC_COLLECTIONS) {
    const list = Array.isArray(doc[coll]) ? doc[coll] : [];
    const byNode = {};
    for (const r of list) { const n = (r && r._node) || 'unknown'; byNode[n] = (byNode[n] || 0) + 1; }
    counts[coll] = { total: list.length, by_node: byNode };
  }
  return {
    node: NODE.SELF,
    enabled: NODE.syncEnabled(),
    secret_set: !!NODE.SYNC_SECRET,
    rev: (doc.seq && doc.seq.rev) || 0,
    peers: NODE.PEERS.map(p => ({ ...p, ...(doc.sync_state || {})[p.id], label: (NODE.NODES[p.id] || {}).label })),
    counts
  };
}

module.exports = { SYNC_COLLECTIONS, stampRevisions, changesSince, applyChanges, runSync, status, fingerprint };
