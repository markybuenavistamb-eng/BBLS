// Account for deliveries whose proof was never captured.
//
// Photographs became compulsory partway through: the office form now refuses a delivery without
// a signed receipt and a shot of the receiver holding the box, and so does the driver's app.
// Records written before that stand as they are, and two boxes were marked delivered by a driver
// with no attempt record raised at all.
//
// NOTHING HERE INVENTS PROOF. A proof of delivery is evidence, and evidence that was not
// collected cannot be reconstructed afterwards — a name filled in from the customer file would
// say somebody signed when nobody recorded that they did. So:
//
//   · a delivery with no attempt record gets one, carrying only what the timeline actually
//     says: that it was delivered, when, and by which driver. Who received it is left empty,
//     because nobody wrote it down.
//   · a delivered attempt with no photographs is flagged, not filled in.
//   · a FAILED attempt is left alone. There is nothing to photograph when nobody was home,
//     so its empty photo fields are correct rather than missing.
//
// The flag surfaces on the box in the portal, so anyone relying on that record can see the
// proof is absent instead of assuming it exists somewhere.
//
//   node lib/fix-missing-pod.js            (dry run, all three nodes)
//   node lib/fix-missing-pod.js --write

const path = require('path');
const ROOT = path.join(__dirname, '..');
const WRITE = process.argv.includes('--write');
// Reconstructed rows are new records, so writing on every node would mint the same delivery
// three times over. Write on the node that owns these boxes and let replication carry it; the
// default reads all three so the scale of it can be seen before anything is written.
const ONE = (() => { const i = process.argv.indexOf('--env'); return i >= 0 ? process.argv[i + 1] : null; })();
const ENVS = ONE ? [ONE] : ['.env.mnl', '.env.th', '.env.kh'];
if (WRITE && !ONE) {
  console.error('Refusing to write to every node at once — that would create the same record three times.');
  console.error('Run it against the node that owns these boxes, e.g.  --env .env.mnl --write');
  process.exit(1);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function freshStore(envFile) {
  for (const k of Object.keys(process.env)) if (/^(SUPABASE|REDIS|KV|VFIC|STORE)/.test(k)) delete process.env[k];
  Object.assign(process.env, require(path.join(ROOT, 'lib/env.js')).load(envFile));
  for (const m of ['lib/store.js', 'lib/db.js']) delete require.cache[require.resolve(path.join(ROOT, m))];
  return require(path.join(ROOT, 'lib/store.js'));
}

async function loadWithRetry(store) {
  for (let i = 0; i < 4; i++) {
    try { return await store.loadDoc(); } catch (e) { if (i === 3) throw e; await sleep(1500); }
  }
}

// Driver names are written into the note when a pass records the delivery.
const driverFromNote = (note) => {
  const m = String(note || '').match(/(?:Delivered|Scanned) by (.+?)(?: \(driver pass\))?$/i);
  return m ? m[1].trim() : '';
};

(async () => {
  let created = 0, flagged = 0;

  for (const env of ENVS) {
    const store = freshStore(env);
    let doc;
    try { doc = await loadWithRetry(store); } catch (e) { console.log(`${env.padEnd(10)} unreachable: ${e.message}`); continue; }
    if (!doc) { console.log(`${env.padEnd(10)} no database document yet`); continue; }

    doc.delivery_attempts = doc.delivery_attempts || [];
    const att = doc.delivery_attempts;
    const events = (doc.status_events || []).filter(e => !e.undone_at);

    // 1. Delivered, but no attempt record at all.
    const orphans = (doc.boxes || [])
      .filter(b => ['DELIVERED', 'RETURNED'].includes(b.status) && !att.some(a => a.box_id === b.id));

    // 2. Delivered with an attempt but no photographs. Failed attempts are not counted:
    //    there is nothing to photograph when nobody was home.
    const noProof = att.filter(a => a.outcome === 'DELIVERED'
      && !a.pod_receipt_photo && !a.pod_receiver_photo && !a.proof_missing);

    if (!orphans.length && !noProof.length) { console.log(`${env.padEnd(10)} every delivery is accounted for`); continue; }
    console.log(`${env.padEnd(10)} ${orphans.length} delivery(s) with no record, ${noProof.length} delivered without photographs`);

    // The highest id in use, so a reconstructed row does not collide with a real one.
    let nextId = Math.max(0, ...att.map(a => Number(a.id) || 0)) + 1;

    for (const b of orphans) {
      const ev = events.filter(e => e.box_id === b.id && ['DELIVERED', 'RETURNED'].includes(e.to_status))
        .sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))[0];
      const driver = ev ? driverFromNote(ev.note) : '';
      console.log(`   ${b.box_number.padEnd(20)} ${b.status.padEnd(10)} ${String((ev || {}).created_at || '').slice(0, 10)}`
        + `  driver: ${driver || 'not recorded'}  → record created, proof flagged as never captured`);
      if (WRITE) {
        att.push({
          id: nextId++,
          box_id: b.id,
          attempt_number: 1,
          outcome: b.status === 'DELIVERED' ? 'DELIVERED' : 'FAILED',
          failure_reason: null,
          // Deliberately empty. Nobody wrote down who signed, and the customer file says who the
          // box was addressed to, which is a different fact.
          received_by_name: '',
          pod_receipt_photo: null, pod_receiver_photo: null,
          recorded_by_driver: driver || null,
          attempted_at: (ev || {}).created_at || b.status_updated_at || null,
          notes: 'Reconstructed from the box history. No proof of delivery was captured at the time.',
          proof_missing: 'no_record',
          reconstructed_at: new Date().toISOString()
        });
      }
      created++;
    }

    for (const a of noProof) {
      const b = (doc.boxes || []).find(x => x.id === a.box_id) || {};
      console.log(`   ${String(b.box_number || a.box_id).padEnd(20)} delivered ${String(a.attempted_at || '').slice(0, 10)}`
        + `  signed by ${a.received_by_name || '(not recorded)'}  → flagged, photographs never taken`);
      if (WRITE) a.proof_missing = 'no_photos';
      flagged++;
    }

    if (WRITE) { await store.saveDoc(doc); console.log('   written'); }
  }

  if (!created && !flagged) return;
  console.log(WRITE
    ? `\n${created} record(s) reconstructed, ${flagged} flagged. None of them claim proof that was not taken.`
    : `\n(dry run — nothing written. ${created} would be reconstructed, ${flagged} flagged. add --write to apply)`);
})().catch(e => { console.error('failed:', e.message); process.exit(1); });
