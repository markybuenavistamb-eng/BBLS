// Repair trip numbers that were minted twice.
//
// Seeded trips took TRIP-2026-0001 and 0002 without advancing the counter, so the first trips
// anyone booked were handed numbers already on the road. Minting is fixed — it now reads the
// highest number in use — but that only stops new collisions. Rows already written stay
// wrong, and a trip number that identifies two different runs is worse than useless to a
// driver quoting it down the phone.
//
// The oldest holder keeps the number, on the grounds that it has been in circulation longest
// and is likelier to be on paperwork. Every later one is given a fresh number, and keeps a
// note of what it used to be so the change can be traced.
//
//   node lib/fix-trip-numbers.js --env .env.mnl          (dry run)
//   node lib/fix-trip-numbers.js --env .env.mnl --write

const path = require('path');

const args = process.argv.slice(2);
const ENV_FILE = (() => { const i = args.indexOf('--env'); return i >= 0 ? args[i + 1] : null; })();
const WRITE = args.includes('--write');

if (ENV_FILE) Object.assign(process.env, require('./env').load(ENV_FILE));

const store = require('./store');
const NODE = require('./node');

function tripNumberOf(t) { return String(t.trip_number || ''); }

function plan(doc) {
  const trips = doc.trips || [];
  const byNumber = new Map();
  for (const t of trips) {
    const n = tripNumberOf(t);
    if (!n) continue;
    if (!byNumber.has(n)) byNumber.set(n, []);
    byNumber.get(n).push(t);
  }

  // Highest number in use per year prefix, so replacements continue the series rather than
  // starting a second one.
  const highestFor = (prefix) => {
    let hi = 0;
    for (const t of trips) {
      const n = tripNumberOf(t);
      if (!n.startsWith(prefix)) continue;
      const v = parseInt(n.slice(prefix.length), 10);
      if (Number.isFinite(v)) hi = Math.max(hi, v);
    }
    return hi;
  };

  const changes = [];
  for (const [number, list] of byNumber) {
    if (list.length < 2) continue;
    // Oldest first; the first one keeps the number.
    const ordered = list.slice().sort((a, b) =>
      String(a.created_at || '').localeCompare(String(b.created_at || '')) || (a.id - b.id));
    const prefix = number.slice(0, number.lastIndexOf('-') + 1);
    let next = highestFor(prefix);
    for (const t of ordered.slice(1)) {
      next += 1;
      const replacement = prefix + String(next).padStart(4, '0');
      changes.push({ trip: t, from: number, to: replacement });
      // Reflect it immediately so the next duplicate does not reuse this number.
      t._planned = replacement;
    }
  }
  return { trips, changes, byNumber };
}

(async () => {
  console.log(`Target: ${store.backend}${ENV_FILE ? ` (from ${ENV_FILE})` : ''} · node ${NODE.NODE_ID}`);
  const doc = await store.loadDoc();
  if (!doc) { console.log('No database document found.'); return; }

  const { trips, changes } = plan(doc);
  console.log(`\n${trips.length} trip(s) on this node.`);

  if (!changes.length) {
    console.log('No duplicate trip numbers. Nothing to repair.');
  } else {
    console.log(`\n${changes.length} trip(s) would be renumbered:`);
    for (const c of changes) {
      console.log(`  ${c.from} → ${c.to}   (${c.trip.driver_name || 'no driver'}, created ${String(c.trip.created_at).slice(0, 10)}, ${c.trip.status})`);
    }
  }

  // Whatever else happens, the counter should sit above everything in use, so the next trip
  // booked cannot land on an existing number.
  const prefix = `TRIP-${new Date().getFullYear()}-`;
  let hi = 0;
  for (const t of trips) {
    const n = tripNumberOf(t);
    const v = n.startsWith(prefix) ? parseInt(n.slice(prefix.length), 10) : NaN;
    if (Number.isFinite(v)) hi = Math.max(hi, v);
  }
  for (const c of changes) {
    const v = parseInt(String(c.to).slice(prefix.length), 10);
    if (Number.isFinite(v)) hi = Math.max(hi, v);
  }
  const seqNow = Number((doc.seq || {}).trip_number) || 0;
  console.log(`\nCounter: seq.trip_number = ${seqNow}; highest number in use = ${hi}.`);
  if (seqNow < hi) console.log(`  → would be raised to ${hi}, so the next trip is ${prefix}${String(hi + 1).padStart(4, '0')}.`);

  if (!WRITE) {
    console.log('\nDry run — nothing written. Re-run with --write to apply.');
    return;
  }

  for (const c of changes) {
    c.trip.renumbered_from = c.from;
    c.trip.renumbered_at = new Date().toISOString();
    c.trip.trip_number = c.to;
    delete c.trip._planned;
  }
  for (const t of trips) delete t._planned;
  doc.seq = doc.seq || {};
  if (seqNow < hi) doc.seq.trip_number = hi;

  await store.saveDoc(doc);
  console.log(`\nWritten. ${changes.length} trip(s) renumbered.`);
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
