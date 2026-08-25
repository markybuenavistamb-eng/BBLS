// Stop the counters handing out numbers that are already on something.
//
// Each portal keeps its own counter, but numbers arrive from the other portals too, by
// replication. A counter that was set while the database was smaller now sits behind what is
// actually in use, and every booking it numbers collides with an existing one. Manila's booking
// references are doing this on every single online booking; Phnom Penh's would start on its
// second shipment, having never issued one.
//
// This moves each counter up to the highest number its database can see, which is the same rule
// nextTripNumber() already follows. It is a guard, not a cure: two portals can still race to the
// same next number, because each still counts on its own. Making the number itself unique is a
// separate job — this only stops the certain, immediate reissues.
//
// Numbers are skipped rather than reused, so expect gaps in the series. A gap is a number nobody
// was ever given; a repeat is two people holding the same one.
//
// SINCE THE BANDS LANDED this is a check rather than a repair. nextNumber() in lib/db.js now
// floors every counter at the highest number already in use in its own band, so a counter cannot
// fall behind the data any more — and the counters themselves moved, from one per node to one per
// node *and prefix* (`shipment_number:TH`, `shipment_number:KH`, `intake_request_code:IR`), since
// Thailand's series and Cambodia's no longer interleave. Those are the keys read below; the old
// single keys are left where they are, unread.
//
// So a node that has not minted anything since the bands landed has no per-prefix counter yet and
// will show one move per series — writing it changes nothing, because the mint would have floored
// itself at the same number. After that it should stay quiet; a move reported on a node that has
// been minting means something is issuing numbers outside lib/db.js.
//
//   node lib/fix-lagging-counters.js              (dry run, all three nodes)
//   node lib/fix-lagging-counters.js --write

const path = require('path');
const ROOT = path.join(__dirname, '..');
const WRITE = process.argv.includes('--write');
const ENVS = ['.env.mnl', '.env.th', '.env.kh'];

// counter name → where the numbers it mints actually live
const COUNTERS = [
  { seq: 'shipment_number', coll: 'shipments', field: 'shipment_number', label: 'Shipment number' },
  { seq: 'intake_request_code', coll: 'intake_requests', field: 'reference_code', label: 'Booking reference' },
  { seq: 'box_order_code', coll: 'box_orders', field: 'reference_code', label: 'Box order code' }
];

const NUMBER = /^([A-Za-z]{2,3})-\d{4}-(\d{6,})$/;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Highest number in use per prefix, counting only this node's own band. Another node's numbers
// arrive here by replication but are not this counter's to keep up with — chasing them is what
// would push Manila's counter into Bangkok's band.
function highestInBand(list, field, NODE) {
  const out = new Map();
  for (const r of list || []) {
    const m = NUMBER.exec(String((r || {})[field] || ''));
    if (!m) continue;
    const v = parseInt(m[2], 10);
    if (v <= NODE.NUMBER_BAND || v >= NODE.NUMBER_BAND + NODE.NUMBER_BAND_SIZE) continue;
    const prefix = m[1].toUpperCase();
    out.set(prefix, Math.max(out.get(prefix) || 0, v));
  }
  return out;
}

// node.js reads VFIC_NODE_ID once, at load, so it is reloaded alongside the store — otherwise
// every node would be measured against whichever band the first env file happened to set.
function freshStore(envFile) {
  for (const k of Object.keys(process.env)) if (/^(SUPABASE|REDIS|KV|VFIC|STORE)/.test(k)) delete process.env[k];
  Object.assign(process.env, require(path.join(ROOT, 'lib/env.js')).load(envFile));
  for (const m of ['lib/store.js', 'lib/node.js']) delete require.cache[require.resolve(path.join(ROOT, m))];
  return {
    store: require(path.join(ROOT, 'lib/store.js')),
    NODE: require(path.join(ROOT, 'lib/node.js'))
  };
}

async function loadWithRetry(store) {
  for (let i = 0; i < 4; i++) {
    try { return await store.loadDoc(); } catch (e) { if (i === 3) throw e; await sleep(1500); }
  }
}

(async () => {
  let totalMoved = 0;
  for (const env of ENVS) {
    const { store, NODE } = freshStore(env);
    let doc;
    try { doc = await loadWithRetry(store); } catch (e) { console.log(`${env.padEnd(10)} unreachable: ${e.message}`); continue; }
    // A node that has never been seeded has no document at all. That is a fact about that node,
    // not a reason to abandon the other two.
    if (!doc) { console.log(`${env.padEnd(10)} no database document yet — nothing to count`); continue; }
    doc.seq = doc.seq || {};

    const moves = [];
    const strays = [];
    for (const c of COUNTERS) {
      for (const [prefix, highest] of highestInBand(doc[c.coll], c.field, NODE)) {
        const key = `${c.seq}:${prefix}`;
        const now = doc.seq[key] || 0;
        // seq does not replicate, so a counter sitting in another node's band did not get there
        // by syncing — the database was restored or copied from the wrong deployment. The mint
        // ignores such a value rather than following it, but the deployment still wants looking at.
        if (now >= NODE.NUMBER_BAND + NODE.NUMBER_BAND_SIZE || (now && now <= NODE.NUMBER_BAND)) {
          strays.push({ ...c, key, prefix, now });
          continue;
        }
        if (now >= highest) continue;
        moves.push({ ...c, key, prefix, from: now, to: highest, next: highest + 1 });
      }
    }
    if (!moves.length && !strays.length) {
      console.log(`${env.padEnd(10)} ${NODE.NODE_ID} — counters are ahead of the data, nothing to do`);
      continue;
    }

    console.log(`${env.padEnd(10)} ${NODE.NODE_ID}`);
    for (const s of strays) {
      console.log(`   !! seq.${s.key} = ${s.now}, outside this node's band (${NODE.NUMBER_BAND + 1}–${NODE.NUMBER_BAND + NODE.NUMBER_BAND_SIZE - 1}).`);
      console.log(`      seq does not replicate, so this did not arrive by syncing. Check this`);
      console.log(`      deployment's VFIC_NODE_ID and where its database was restored from.`);
    }
    if (!moves.length) continue;
    for (const m of moves) {
      console.log(`   ${(m.label + ' ' + m.prefix).padEnd(24)} ${String(m.from).padStart(6)} → ${String(m.to).padStart(6)}   (next issued: ${String(m.next).padStart(6, '0')})`);
      if (WRITE) doc.seq[m.key] = m.to;
    }
    totalMoved += moves.length;
    if (WRITE) { await store.saveDoc(doc); console.log(`   written`); }
  }

  if (!totalMoved) return;
  if (!WRITE) console.log(`\n(dry run — nothing written. ${totalMoved} counter(s) would move. add --write to apply)`);
  else console.log(`\n${totalMoved} counter(s) moved. Re-run to confirm they now sit ahead of the data.`);
})().catch(e => { console.error('failed:', e.message); process.exit(1); });
