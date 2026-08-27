// Relabel collections that were filed before "Picked up from sender" was a stage of its own.
//
// Collecting a box used to be recorded as an event that left the box exactly where it was —
// CREATED to CREATED — so a collected box grew a second "Booking Confirmed" line in its history
// saying that nothing had happened. It is a stage now, and these rows should read as one.
//
// Only the history is rewritten, never the box: where a box has got to since is a fact, and a
// box still sitting at CREATED with a collection on its record is moved on to PICKED_UP, which
// is where it actually is — in the back of a van.
//
//   node lib/fix-pickup-events.js            (dry run, all three nodes)
//   node lib/fix-pickup-events.js --write

const path = require('path');
const ROOT = path.join(__dirname, '..');
const WRITE = process.argv.includes('--write');
const ENVS = ['.env.mnl', '.env.th', '.env.kh'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

(async () => {
  let total = 0, moved = 0;
  for (const env of ENVS) {
    const store = freshStore(env);
    let doc;
    try { doc = await loadWithRetry(store); } catch (e) { console.log(`${env.padEnd(10)} unreachable: ${e.message}`); continue; }
    if (!doc) { console.log(`${env.padEnd(10)} no database document yet`); continue; }

    const boxById = new Map((doc.boxes || []).map(b => [b.id, b]));
    const stale = (doc.status_events || []).filter(e =>
      e.from_status === 'CREATED' && e.to_status === 'CREATED'
      && !e.undone_at && /Collected from the sender/i.test(e.note || ''));

    if (!stale.length) { console.log(`${env.padEnd(10)} nothing to relabel`); continue; }

    // The old code had no guard against scanning the same label twice, so a box could collect a
    // whole run of identical rows. One collection happened, however many times it was recorded,
    // so the earliest is kept and the rest are tombstoned — which is how a removal replicates.
    const byBox = new Map();
    for (const e of stale) {
      if (!byBox.has(e.box_id)) byBox.set(e.box_id, []);
      byBox.get(e.box_id).push(e);
    }

    console.log(`${env.padEnd(10)} ${byBox.size} box(es), ${stale.length} row(s) recorded as a repeat of Booking Confirmed`);
    const boxesToMove = [];
    let dropped = 0;
    for (const [boxId, events] of byBox) {
      events.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      const box = boxById.get(boxId);
      const willMove = box && box.status === 'CREATED';
      console.log(`   ${(box ? box.box_number : 'box ' + boxId).padEnd(20)} ${String(events[0].created_at).slice(0, 10)}`
        + `   keep 1${events.length > 1 ? `, drop ${events.length - 1} duplicate(s)` : ''}`
        + (willMove ? ', box moves to Picked up from sender' : ''));
      if (WRITE) {
        events[0].to_status = 'PICKED_UP';
        for (const extra of events.slice(1)) {
          extra.undone_at = new Date().toISOString();
          extra.undone_reason = 'duplicate collection scan, recorded before repeats were caught';
        }
      }
      dropped += events.length - 1;
      if (willMove) boxesToMove.push(box);
    }
    total += byBox.size;
    moved += boxesToMove.length;
    if (WRITE) {
      for (const b of boxesToMove) b.status = 'PICKED_UP';
      await store.saveDoc(doc);
      console.log(`   written — ${dropped} duplicate row(s) hidden`);
    }
  }

  if (!total) return;
  console.log(WRITE
    ? `\n${total} collection(s) relabelled, ${moved} box(es) moved on to Picked up from sender.`
    : `\n(dry run — nothing written. ${total} collection(s) would be relabelled, ${moved} box(es) moved. add --write to apply)`);
})().catch(e => { console.error('failed:', e.message); process.exit(1); });
