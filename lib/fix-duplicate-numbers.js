// Repair the numbers people quote, where two of them were minted the same.
//
// Shipment numbers, the box numbers built from them, and the booking / box-order references
// all shared one defect: the counter behind each only ever counted what its own deployment
// had issued, while the prefix names the country the cargo ships FROM. Manila and Bangkok both
// book Thailand cargo, so both minted TH-2026-000001 upwards and both minted IR-2026-000001;
// once the nodes replicated, one database held two different records under each number. Staff
// and drivers look boxes up by number and senders quote their booking reference, so a lookup
// could land on whichever record happened to be stored first, and nothing said which.
//
// Minting is fixed — each node now mints inside its own band (lib/node.js: Manila 000001…,
// Thailand 100001…, Cambodia 200001…), the same idea that already keeps record ids apart, and
// the counter is floored at the highest number in use so it cannot fall behind the data. But
// that only stops new collisions: numbers already on labels and in senders' inboxes stay as
// they are until they are repaired here.
//
// The oldest holder keeps the number, on the grounds that it has been in circulation longest
// and is likelier to be on paperwork. Every later one moves into its owning node's band, keeps
// a note of what it used to be, and a shipment takes its boxes with it.
//
// ONLY COLLIDING NUMBERS MOVE. A number that is already unique is left exactly where it is,
// even when it sits in another node's band — Bangkok's TH-2026-000002 clashes with nothing, so
// renumbering it would change what a customer is holding to buy nothing but tidiness. Bangkok
// therefore keeps records numbered in Manila's band. The band says where a node mints from now
// on; it is not a property every existing record satisfies, and no lookup may read it as one.
//
// Nothing else about a record is touched. A box keeps its qr_token, so the tracking link on a
// printed label still opens the right box after its number has moved. Bookings and box orders
// carry no token at all — their reference code IS the only thing the customer was given, so
// moving one is not softened by anything.
//
// A record may only be changed by the node that owns it — that is the rule the whole
// replication design rests on, and a number rewritten anywhere else is overwritten by the
// owner on its next pull. So this is run on every node: each repairs its own records, every
// node computes the same plan because it is computed from the same replicated data, and the
// changes reach the other nodes by replication rather than by being applied three times.
//
//   node lib/fix-duplicate-numbers.js --env .env.mnl          (dry run)
//   node lib/fix-duplicate-numbers.js --env .env.mnl --write
//   …then the same for .env.th and .env.kh.
//
// Sync the nodes first (Developer Console → ⟳ Sync now): a node that cannot see the other copy
// cannot know its number is shared, and will report nothing to repair.
//
// A renumbered record is a number somebody may already be holding. Read the dry run before
// writing: it names who holds each side of every collision, so the choice of which one moves
// is made with the paperwork in view rather than by the script alone.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const argOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const ENV_FILE = argOf('--env');
const WRITE = args.includes('--write');
const ONLY = (argOf('--only') || '').split(',').map(s => s.trim()).filter(Boolean);

if (ENV_FILE) require('./env').load(ENV_FILE);

const store = require('./store');
const NODE = require('./node');
const BRANCH = require('./branches');

// PREFIX-YEAR-DIGITS, e.g. TH-2026-000007 or IR-2026-000001. Box numbers add the box index.
const NUMBER = /^([A-Za-z]{2,3})-(\d{4})-(\d{6,})$/;
const BOX_NUMBER = /^([A-Za-z]{2,3}-\d{4}-\d{6,})-(\d{2,})$/;

const day = (v) => String(v || '').slice(0, 10) || 'undated';
const nodeLabel = (id) => (NODE.NODES[id] || {}).label || id;
// Who may change a record. _node is stamped on save; before a record has ever been stamped its
// id band says which deployment minted it, which is the same answer lib/sync.js would reach.
const ownerOf = (rec) => rec._node || (NODE.nodeForId(rec.id) || {}).id || NODE.NODE_ID;
const bandOf = (digits) => Math.floor(digits / NODE.NUMBER_BAND_SIZE) * NODE.NUMBER_BAND_SIZE;
const bandFor = (nodeId) => (NODE.NODES[nodeId] || {}).numberBand || 0;

// The name a booking was filed under, so a collision can be read as the two people it affects
// rather than as two ids.
const personName = (p) => [p && p.given_name, p && p.middle_name, p && p.family_name, p && p.suffix]
  .filter(x => x && !/^(n\/?a|none|null|-)$/i.test(String(x).trim())).join(' ').replace(/\s+/g, ' ').trim();

// The three series this repairs. Each is a collection, the field holding the number, and the
// timestamp that decides which holder is the older one.
const SERIES = [
  {
    key: 'shipments', label: 'shipment', coll: 'shipments',
    field: 'shipment_number', when: 'created_at', seq: 'shipment_number',
    // The prefix says where the cargo shipped from, and that does not change because the
    // number does. An unknown origin keeps whatever prefix the number already carries.
    prefixFor: (rec, current) => {
      const code = BRANCH.countryCode(rec.origin_country);
      return code === BRANCH.DEFAULT_CODE ? current : code;
    },
    describe: (r) => `${r.origin_country || 'unknown origin'}, created ${day(r.created_at)}`
  },
  {
    key: 'intake_requests', label: 'booking reference', coll: 'intake_requests',
    field: 'reference_code', when: 'submitted_at', seq: 'intake_request_code',
    prefixFor: () => 'IR',
    describe: (r) => `${personName(r.sender) || 'no name on file'}`
      + `${(r.sender || {}).contact_numbers ? ` (${r.sender.contact_numbers})` : ''}`
      + `, ${r.status}, submitted ${day(r.submitted_at)}`
  },
  {
    key: 'box_orders', label: 'box order', coll: 'box_orders',
    field: 'reference_code', when: 'submitted_at', seq: 'box_order_code',
    prefixFor: () => 'BO',
    describe: (r) => `${((r.contact || {}).name) || 'no name on file'}`
      + `${(r.contact || {}).phone ? ` (${r.contact.phone})` : ''}`
      + `, ${r.status}, submitted ${day(r.submitted_at)}`
  }
];

// Hands out replacement numbers: the next free one in a node's band, continuing that band's
// series rather than starting a second one, and never a string already in use.
function allocator(records, field) {
  const taken = new Set(records.map(r => String(r[field] || '').toUpperCase()));
  const highest = new Map();                       // "PREFIX|band" → highest digits in use
  for (const r of records) {
    const m = NUMBER.exec(String(r[field] || ''));
    if (!m) continue;
    const digits = parseInt(m[3], 10);
    const key = `${m[1].toUpperCase()}|${bandOf(digits)}`;
    highest.set(key, Math.max(highest.get(key) || 0, digits));
  }
  return function next(prefix, year, band) {
    const key = `${prefix}|${band}`;
    let n = Math.max(highest.get(key) || 0, band);
    let candidate;
    do { n += 1; candidate = `${prefix}-${year}-${String(n).padStart(6, '0')}`; }
    while (taken.has(candidate));
    highest.set(key, n);
    taken.add(candidate);
    return candidate;
  };
}

function planSeries(doc, spec) {
  const records = doc[spec.coll] || [];
  const byNumber = new Map();
  for (const r of records) {
    const n = String(r[spec.field] || '').toUpperCase();
    if (!n) continue;
    if (!byNumber.has(n)) byNumber.set(n, []);
    byNumber.get(n).push(r);
  }

  const next = allocator(records, spec.field);
  const changes = [];
  const unrepairable = [];

  // Sorted so the plan does not depend on the order records happen to sit in the document —
  // every node has to reach the same answer, or they will renumber each other's records apart.
  for (const number of [...byNumber.keys()].sort()) {
    const holders = byNumber.get(number);
    if (holders.length < 2) continue;

    // Oldest first; the first one keeps the number.
    const ordered = holders.slice().sort((a, b) =>
      String(a[spec.when] || '').localeCompare(String(b[spec.when] || '')) || (a.id - b.id));
    const parsed = NUMBER.exec(String(ordered[0][spec.field] || ''));
    if (!parsed) {
      unrepairable.push({ what: number, why: 'not in the PREFIX-YEAR-NUMBER form — renumber it by hand' });
      continue;
    }

    for (const rec of ordered.slice(1)) {
      const owner = ownerOf(rec);
      const prefix = spec.prefixFor(rec, parsed[1].toUpperCase());
      changes.push({
        spec, record: rec, owner, keeper: ordered[0],
        from: rec[spec.field], to: next(prefix, parsed[2], bandFor(owner)),
        boxes: []
      });
    }
  }
  return { changes, unrepairable };
}

// A box number is its shipment's number plus the box index, so a renumbered shipment takes its
// boxes with it. Anything that does not read as a box of that shipment was written by hand and
// is reported rather than guessed at.
function planBoxes(doc, changes) {
  const boxes = doc.boxes || [];
  const unrepairable = [];
  for (const c of changes) {
    if (c.spec.key !== 'shipments') continue;
    const was = String(c.from).toUpperCase();
    for (const box of boxes.filter(b => b.shipment_id === c.record.id)) {
      const bm = BOX_NUMBER.exec(String(box.box_number || ''));
      if (!bm || bm[1].toUpperCase() !== was) {
        unrepairable.push({
          what: box.box_number || `box id=${box.id}`,
          why: `does not read as a box of ${was} — encoded by hand; renumber it with the shipment`
        });
        continue;
      }
      c.boxes.push({ box, from: box.box_number, to: `${c.to}-${bm[2]}` });
    }
  }

  // Box numbers that collide for some other reason than their shipment's number. Nothing here
  // can guess which box a duplicate index belongs to, so they are only reported.
  const renumbering = new Set(changes.flatMap(c => c.boxes.map(b => b.box.id)));
  const byNumber = new Map();
  for (const b of boxes) {
    const n = String(b.box_number || '').toUpperCase();
    if (!n) continue;
    if (!byNumber.has(n)) byNumber.set(n, []);
    byNumber.get(n).push(b);
  }
  for (const [n, list] of byNumber) {
    const left = list.filter(b => !renumbering.has(b.id));
    if (left.length < 2) continue;
    unrepairable.push({
      what: n,
      why: `${left.length} boxes share this number under shipment(s) ${[...new Set(left.map(b => b.shipment_id))].join(', ')} — check with the branch which is which`
    });
  }
  return unrepairable;
}

function plan(doc) {
  const specs = SERIES.filter(s => !ONLY.length || ONLY.includes(s.key));
  let changes = [];
  let unrepairable = [];
  for (const spec of specs) {
    const r = planSeries(doc, spec);
    changes = changes.concat(r.changes);
    unrepairable = unrepairable.concat(r.unrepairable);
  }
  unrepairable = unrepairable.concat(planBoxes(doc, changes));
  return { changes, unrepairable, specs };
}

// Every series this node mints should sit above what is already in use in its own band, so the
// next record filed here cannot land on a number that is already out there. Counters are kept
// per prefix, so Thailand's series and Cambodia's each run on their own.
function counterRaises(doc, specs, changes) {
  const band = NODE.NUMBER_BAND;
  const raises = [];
  for (const spec of specs) {
    const highest = new Map();
    const consider = (number) => {
      const m = NUMBER.exec(String(number || ''));
      if (!m) return;
      const digits = parseInt(m[3], 10);
      if (digits <= band || digits >= band + NODE.NUMBER_BAND_SIZE) return;
      const prefix = m[1].toUpperCase();
      highest.set(prefix, Math.max(highest.get(prefix) || 0, digits));
    };
    for (const r of (doc[spec.coll] || [])) consider(r[spec.field]);
    for (const c of changes) if (c.spec.key === spec.key) consider(c.to);

    for (const [prefix, hi] of highest) {
      const key = `${spec.seq}:${prefix}`;
      const now = Number((doc.seq || {})[key]) || 0;
      if (now < hi) raises.push({ key, from: now, to: hi, prefix, label: spec.label });
    }
  }
  return raises;
}

(async () => {
  console.log(`Target: ${store.backend}${ENV_FILE ? ` (from ${ENV_FILE})` : ''} · node ${NODE.NODE_ID}`);

  // Aiming at a deployment and repairing a local file instead is the one mistake that would
  // leave the real duplicates in place while reporting success.
  if (ENV_FILE && (store.backend === 'filesystem' || store.backend === 'ephemeral-tmp')) {
    console.log(`\n${ENV_FILE} did not configure a cloud store, so this would read a local file`);
    console.log('rather than the deployment you meant. Check its SUPABASE_* / KV_* values.');
    process.exitCode = 1;
    return;
  }

  const doc = await store.loadDoc();
  if (!doc) { console.log('No database document found.'); return; }

  const { changes, unrepairable, specs } = plan(doc);
  console.log('\nOn this node: ' + specs.map(s => `${(doc[s.coll] || []).length} ${s.coll}`).join(', ')
    + `, ${(doc.boxes || []).length} boxes.`);

  const mine = changes.filter(c => c.owner === NODE.NODE_ID);
  const theirs = changes.filter(c => c.owner !== NODE.NODE_ID);

  if (!changes.length) {
    console.log('No duplicate numbers. Nothing to repair.');
  } else {
    console.log(`\n${changes.length} record(s) share a number with an older one:`);
    for (const c of changes) {
      const flag = c.owner === NODE.NODE_ID ? '' : `   [owned by ${c.owner} — not this node]`;
      console.log(`\n  ${c.spec.label}  ${c.from} → ${c.to}${flag}`);
      console.log(`     moves : id=${c.record.id}, ${c.spec.describe(c.record)}, minted by ${nodeLabel(c.owner)}`);
      console.log(`     keeps : id=${c.keeper.id}, ${c.spec.describe(c.keeper)}, minted by ${nodeLabel(ownerOf(c.keeper))}`);
      for (const b of c.boxes) console.log(`     box ${b.from} → ${b.to}`);
      if (c.spec.key === 'shipments' && !c.boxes.length) console.log('     no boxes on this shipment');
    }
  }

  for (const u of unrepairable) console.log(`\n  ${u.what} — NOT repaired: ${u.why}`);

  const raises = counterRaises(doc, specs, mine);
  for (const r of raises) {
    console.log(`\nCounter: seq.${r.key} = ${r.from}; highest ${r.prefix} ${r.label} in this node's band = ${r.to}.`);
    console.log(`  → would be raised to ${r.to}, so the next one issued here is ${String(r.to + 1).padStart(6, '0')}.`);
  }

  if (theirs.length) {
    console.log(`\n${theirs.length} of these belong to another node and are left alone — only the node that owns`);
    console.log('a record may change it, or the owner overwrites the change on its next pull. Run this');
    console.log(`there too: ${[...new Set(theirs.map(c => c.owner))].join(', ')}. Their repairs reach this node by replication.`);
  }

  if (!WRITE) {
    console.log(`\nDry run — nothing written. Re-run with --write to apply${mine.length ? ` the ${mine.length} change(s) this node owns` : ''}.`);
    return;
  }

  if (!mine.length && !raises.length) {
    console.log('\nNothing for this node to write.');
    return;
  }

  // The numbers being rewritten are on labels, receipts and in senders' inboxes, and there is
  // no undo, so keep the document as it was first.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(store.DATA_DIR, `backup-before-renumbering-${stamp}.json`);
  fs.mkdirSync(store.DATA_DIR, { recursive: true });
  fs.writeFileSync(backup, JSON.stringify(doc, null, 2));
  console.log(`\nBackup written: ${backup}`);

  const at = new Date().toISOString();
  for (const c of mine) {
    c.record.renumbered_from = c.from;
    c.record.renumbered_at = at;
    c.record[c.spec.field] = c.to;
    for (const b of c.boxes) {
      b.box.renumbered_from = b.from;
      b.box.renumbered_at = at;
      b.box.box_number = b.to;
      // The load code is stamped onto the box number once a box is loaded into a container.
      if (b.box.container_box_number) {
        b.box.container_box_number = String(b.box.container_box_number)
          .replace(new RegExp(`^${b.from}(?=/|$)`, 'i'), b.to);
      }
    }
  }
  doc.seq = doc.seq || {};
  for (const r of raises) doc.seq[r.key] = r.to;

  // Bump revisions so peers pull the renumbered records instead of keeping their old copies.
  try { require('./sync').stampRevisions(doc); } catch (e) { /* sync not configured — local only */ }

  await store.saveDoc(doc);
  const boxCount = mine.reduce((n, c) => n + c.boxes.length, 0);
  console.log(`\nWritten. ${mine.length} record(s) and ${boxCount} box(es) renumbered on ${NODE.NODE_ID}.`);
  console.log('Revisions were bumped, so the other nodes pick this up on their next sync.');
})().catch(e => { console.error('failed:', e.message); process.exit(1); });
