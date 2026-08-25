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
  { seq: 'box_order_code', coll: 'box_orders', field: 'code', label: 'Box order code' }
];

const tail = (v) => parseInt(String(v == null ? '' : v).slice(-6), 10) || 0;
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
  let totalMoved = 0;
  for (const env of ENVS) {
    const store = freshStore(env);
    let doc;
    try { doc = await loadWithRetry(store); } catch (e) { console.log(`${env.padEnd(10)} unreachable: ${e.message}`); continue; }
    doc.seq = doc.seq || {};

    const moves = [];
    for (const c of COUNTERS) {
      const list = doc[c.coll] || [];
      if (!list.length) continue;
      const highest = Math.max(0, ...list.map(r => tail(r && r[c.field])));
      const now = doc.seq[c.seq] || 0;
      if (now >= highest) continue;
      moves.push({ ...c, from: now, to: highest, next: highest + 1 });
    }

    if (!moves.length) { console.log(`${env.padEnd(10)} counters are ahead of the data — nothing to do`); continue; }

    console.log(`${env.padEnd(10)}`);
    for (const m of moves) {
      console.log(`   ${m.label.padEnd(19)} ${String(m.from).padStart(3)} → ${String(m.to).padStart(3)}   (next issued: ${String(m.next).padStart(6, '0')})`);
      if (WRITE) doc.seq[m.seq] = m.to;
    }
    totalMoved += moves.length;
    if (WRITE) { await store.saveDoc(doc); console.log(`   written`); }
  }

  if (!totalMoved) return;
  if (!WRITE) console.log(`\n(dry run — nothing written. ${totalMoved} counter(s) would move. add --write to apply)`);
  else console.log(`\n${totalMoved} counter(s) moved. Re-run to confirm they now sit ahead of the data.`);
})().catch(e => { console.error('failed:', e.message); process.exit(1); });
