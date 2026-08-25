// Remove records the other portals kept after their owner dropped them.
//
// Undoing an action used to delete its row outright. Replication only ever pushes what a node
// still holds, so the deletion was invisible to it: every other portal kept the undone action
// for ever, and the same box read differently depending on which office was looking at it.
// Undo now marks the row instead, which replicates like any other edit — but rows deleted
// before that change are still sitting on the peers, and nothing will ever clear them.
//
// A record is an orphan when the node that minted it no longer has it but a peer still does.
// The minting node is the only place such a record can be created, so its absence there means
// it was deliberately removed, and the copies are what remain of a deletion that never
// travelled. (A node restored from a backup older than the record would look the same; check
// the dates below read like undone work rather than like a restore before applying.)
//
//   node lib/fix-orphan-records.js                 (dry run, reads all three nodes)
//   node lib/fix-orphan-records.js --write

const path = require('path');
const ROOT = path.join(__dirname, '..');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const ENVS = ['.env.mnl', '.env.th', '.env.kh'];

// Only these two are ever deleted, and only these two have a tombstone the readers honour.
const TOMBSTONED = ['status_events', 'delivery_attempts'];

function freshStore(envFile) {
  for (const k of Object.keys(process.env)) if (/^(SUPABASE|REDIS|KV|VFIC|STORE)/.test(k)) delete process.env[k];
  Object.assign(process.env, require(path.join(ROOT, 'lib/env.js')).load(envFile));
  for (const m of ['lib/store.js', 'lib/node.js', 'lib/sync.js']) {
    delete require.cache[require.resolve(path.join(ROOT, m))];
  }
  return {
    store: require(path.join(ROOT, 'lib/store.js')),
    collections: require(path.join(ROOT, 'lib/sync.js')).SYNC_COLLECTIONS
  };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function loadWithRetry(store, label) {
  for (let i = 0; i < 4; i++) {
    try { return await store.loadDoc(); } catch (e) { if (i === 3) throw e; await sleep(1500); }
  }
}

(async () => {
  // Read every node first: deciding what is an orphan needs all of them in hand at once.
  const docs = {};
  let collections = [];
  for (const env of ENVS) {
    const { store, collections: c } = freshStore(env);
    collections = c;
    docs[env] = await loadWithRetry(store, env);
    console.log(`${env.padEnd(10)} loaded`);
  }

  // What each node still holds among the records it minted itself.
  const ownedBy = {};   // nodeId → Set of _uid
  for (const env of ENVS) {
    for (const coll of collections) {
      for (const rec of (docs[env][coll] || [])) {
        if (!rec || !rec._uid || !rec._node) continue;
        // A node is authoritative only for what it minted.
        if (!ownedBy[rec._node]) ownedBy[rec._node] = new Set();
        if (nodeOf(env) === rec._node) ownedBy[rec._node].add(rec._uid);
      }
    }
  }

  const found = [];
  for (const env of ENVS) {
    for (const coll of collections) {
      for (const rec of (docs[env][coll] || [])) {
        if (!rec || !rec._uid || !rec._node) continue;
        if (nodeOf(env) === rec._node) continue;               // its own record, nothing to say
        if (!ownedBy[rec._node]) continue;                     // owner unreadable — leave alone
        if (ownedBy[rec._node].has(rec._uid)) continue;        // owner still has it: fine
        if (rec.undone_at) continue;                           // already dealt with, and hidden
        found.push({ env, coll, rec });
      }
    }
  }

  if (!found.length) { console.log('\nno orphaned records — every portal agrees'); return; }

  console.log(`\n${found.length} record(s) kept after their owner dropped them:\n`);
  let actionable = 0;
  for (const f of found) {
    const r = f.rec;
    const what = r.to_status ? `${r.to_status}` : (r.outcome || '');
    console.log(`  ${f.env.padEnd(10)} ${f.coll} ${r._uid}`);
    console.log(`     box_id=${r.box_id}  ${what}  ${(r.created_at || '').slice(0, 19)}  ${JSON.stringify(r.note || '')}`);
    if (TOMBSTONED.includes(f.coll)) actionable++;
    else console.log(`     !! ${f.coll} has no tombstone the readers honour — leaving it, needs a look`);
  }

  if (!WRITE) {
    console.log(`\n(dry run — nothing written. ${actionable} of ${found.length} would be marked undone. add --write to apply)`);
    return;
  }

  // Mark them on the node that is still holding them. The owner does not have the record at
  // all, so there is nothing to converge with — this only stops the copy being displayed.
  const stamp = new Date().toISOString();
  for (const env of ENVS) {
    const mine = found.filter(f => f.env === env && TOMBSTONED.includes(f.coll));
    if (!mine.length) continue;
    const { store } = freshStore(env);
    const doc = await loadWithRetry(store, env);
    let n = 0;
    for (const f of mine) {
      const rec = (doc[f.coll] || []).find(x => x && x._uid === f.rec._uid);
      if (!rec || rec.undone_at) continue;
      rec.undone_at = stamp;
      rec.undone_by = null;              // undone at the owning portal, not by anyone here
      rec.undone_reason = 'owner dropped it before undo replicated';
      n++;
    }
    if (n) { await store.saveDoc(doc); console.log(`${env.padEnd(10)} marked ${n}`); }
  }
  console.log('\ndone — re-run without --write to confirm the portals agree');
})().catch(e => { console.error('failed:', e.message); process.exit(1); });

// Which node a given env file is.
function nodeOf(envFile) {
  return { '.env.mnl': 'HQ_MANILA', '.env.th': 'TH_BANGKOK', '.env.kh': 'KH_PHNOMPENH' }[envFile];
}
