// Settle boxes whose delivery was recorded but whose status never moved.
//
// changeBoxStatus wrote the timeline event into whichever document was current while setting the
// status on whichever box object the caller was holding. Those are the same thing right up until
// a photo upload runs long enough for another request to replace the document — and then the
// event and the delivery record were saved while the status change was left on an object nobody
// would write again. The box ended up carrying proof of a delivery it does not admit to.
//
// That is fixed at the source. This settles the boxes it already happened to, from the evidence
// on the box itself: a completed delivery attempt says the box was handed over, so the box is
// moved to match its own record, and the timeline gets the event it never got. Where duplicate
// attempts were raised because the status never advanced, the earliest is kept and the rest are
// tombstoned — one delivery happened, however many times it was written down.
//
//   node lib/fix-lost-status.js                    (dry run, all three nodes)
//   node lib/fix-lost-status.js --env .env.mnl --write

const path = require('path');
const ROOT = path.join(__dirname, '..');
const WRITE = process.argv.includes('--write');
const ONE = (() => { const i = process.argv.indexOf('--env'); return i >= 0 ? process.argv[i + 1] : null; })();
const ENVS = ONE ? [ONE] : ['.env.mnl', '.env.th', '.env.kh'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

if (WRITE && !ONE) {
  console.error('Refusing to write to every node at once — run it on the node that owns these boxes,');
  console.error('e.g.  --env .env.mnl --write, and let replication carry it.');
  process.exit(1);
}

function freshStore(envFile) {
  for (const k of Object.keys(process.env)) if (/^(SUPABASE|REDIS|KV|VFIC|STORE)/.test(k)) delete process.env[k];
  Object.assign(process.env, require(path.join(ROOT, 'lib/env.js')).load(envFile));
  delete require.cache[require.resolve(path.join(ROOT, 'lib/store.js'))];
  return require(path.join(ROOT, 'lib/store.js'));
}
async function loadWithRetry(store) {
  for (let i = 0; i < 4; i++) {
    try { return await store.loadDoc(); } catch (e) { if (i === 3) throw e; await sleep(1500); }
  }
}

const OUTCOME_STATUS = { DELIVERED: 'DELIVERED', FAILED: 'RETURNED' };

(async () => {
  let fixed = 0, dropped = 0;

  for (const env of ENVS) {
    const store = freshStore(env);
    let doc;
    try { doc = await loadWithRetry(store); } catch (e) { console.log(`${env.padEnd(10)} unreachable: ${e.message}`); continue; }
    if (!doc) { console.log(`${env.padEnd(10)} no database document yet`); continue; }

    const att = (doc.delivery_attempts || []).filter(a => !a.undone_at);
    const rows = [];

    for (const b of (doc.boxes || [])) {
      const mine = att.filter(a => a.box_id === b.id)
        .sort((x, y) => String(x.attempted_at || '').localeCompare(String(y.attempted_at || '')));
      if (!mine.length) continue;
      const last = mine[mine.length - 1];
      const should = OUTCOME_STATUS[last.outcome];
      if (!should || b.status === should) continue;
      // Only settle a box that is still out on the road. One that has moved on since is somebody
      // else's decision and not this script's to overrule.
      if (!['OUT_FOR_DELIVERY', 'LOADED_TRUCK'].includes(b.status)) continue;
      rows.push({ box: b, attempts: mine, should });
    }

    if (!rows.length) { console.log(`${env.padEnd(10)} every delivery record matches its box`); continue; }
    console.log(`${env.padEnd(10)} ${rows.length} box(es) recorded as delivered but never moved`);

    for (const r of rows) {
      const dupes = r.attempts.filter(a => a.outcome === r.attempts[r.attempts.length - 1].outcome).slice(0, -1);
      console.log(`   ${r.box.box_number.padEnd(20)} ${r.box.status} → ${r.should}`
        + `   ${r.attempts.length} attempt(s)${dupes.length ? `, ${dupes.length} duplicate(s) to fold away` : ''}`);
      if (WRITE) {
        const keep = r.attempts[r.attempts.length - 1];
        doc.status_events = doc.status_events || [];
        doc.status_events.push({
          id: Math.max(0, ...doc.status_events.map(e => Number(e.id) || 0)) + 1,
          box_id: r.box.id,
          from_status: r.box.status, to_status: r.should,
          actor_user_id: null,
          note: `${r.should === 'DELIVERED' ? 'Delivered' : 'Could not deliver'} by `
              + `${keep.recorded_by_driver || 'the driver'} — recovered from the delivery record, `
              + 'which was saved when the status change was lost.',
          created_at: keep.attempted_at || new Date().toISOString()
        });
        r.box.status = r.should;
        r.box.status_updated_at = keep.attempted_at || new Date().toISOString();
        for (const extra of dupes) {
          extra.undone_at = new Date().toISOString();
          extra.undone_reason = 'duplicate: the same delivery recorded again because the status had not moved';
        }
      }
      fixed++; dropped += dupes.length;
    }

    if (WRITE) { await store.saveDoc(doc); console.log('   written'); }
  }

  if (!fixed) return;
  console.log(WRITE
    ? `\n${fixed} box(es) settled, ${dropped} duplicate attempt(s) folded away.`
    : `\n(dry run — nothing written. ${fixed} would be settled, ${dropped} duplicates folded. add --env <file> --write to apply)`);
})().catch(e => { console.error('failed:', e.message); process.exit(1); });
