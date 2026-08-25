// Repair boxes addressed to the wrong person.
//
// A customer used to be matched on telephone number alone. A sender abroad who books using the
// number of the family that will receive the box — or who ships to their own house in the
// Philippines — therefore matched the record just written for the sender, and the box inherited
// the sender's address abroad. The box would have been delivered back where it came from.
//
// Matching is fixed (name and capacity must agree too), but that only protects new bookings.
// Rows already written still point at the wrong person, so this restores each box to the
// receiver the sender actually typed into the booking, creating that person's record if it was
// never written. Boxes carry no address of their own — this link is the delivery address — so
// nothing else has to change.
//
// Only boxes whose booking is still on file can be repaired: the booking is the evidence of who
// the receiver was meant to be. Anything encoded by hand is listed and left alone.
//
//   node lib/fix-receiver-addresses.js --env .env.mnl                      (dry run)
//   node lib/fix-receiver-addresses.js --env .env.mnl --write
//   node lib/fix-receiver-addresses.js --env .env.mnl --write --ids 1000031,1000032
//
// The nodes replicate, so the same customer must carry the same id everywhere. Run the owning
// node first, note the ids it prints, and pass them to the others with --ids.

const path = require('path');

const args = process.argv.slice(2);
const argOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const ENV_FILE = argOf('--env');
const WRITE = args.includes('--write');
const FIXED_IDS = (argOf('--ids') || '').split(',').map(x => x.trim()).filter(Boolean).map(Number);

if (ENV_FILE) Object.assign(process.env, require('./env').load(ENV_FILE));

const store = require('./store');
const NODE = require('./node');
const REGION = require('./regions');

const phoneKey = (v) => String(v == null ? '' : v).replace(/\D/g, '').slice(-10);
const nameKey = (v) => String(v == null ? '' : v).toLowerCase()
  .replace(/\bn\/?a\b/g, ' ').replace(/[^a-z]+/g, ' ').trim();

// Same rule the intake form uses, so a repaired record reads like one written today.
const NOT_GIVEN = (v) => /^(n\/?a|none|null|-)$/i.test(String(v || '').trim());
function properName(raw) {
  const v = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  if (!v) return v;
  const capToken = (t) => t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : t;
  return v.split(' ').map(w => w.split('-').map(p => p.split("'").map(capToken).join("'")).join('-')).join(' ');
}
const typedName = (r) => [r.given_name, r.middle_name, r.family_name, r.suffix]
  .filter(x => x && !NOT_GIVEN(x)).join(' ').replace(/\s+/g, ' ').trim();

function plan(doc) {
  const customers = doc.customers || [];
  const byId = new Map(customers.map(c => [c.id, c]));
  const shipments = new Map((doc.shipments || []).map(s => [s.id, s]));
  const bookingFor = new Map();
  for (const r of (doc.intake_requests || [])) {
    if (r.converted_shipment_id) bookingFor.set(r.converted_shipment_id, r);
  }

  const repairs = [];
  const unrepairable = [];

  for (const box of (doc.boxes || [])) {
    const ship = shipments.get(box.shipment_id);
    if (!ship || !box.receiver_id) continue;

    const booking = bookingFor.get(box.shipment_id);
    const current = byId.get(box.receiver_id);
    if (!current) continue;

    if (!booking) {
      // No booking to check against. Only worth reporting when the box is plainly addressed to
      // the person who sent it, which is never a real delivery instruction.
      if (box.receiver_id === ship.sender_id) {
        unrepairable.push({ box: box.box_number, why: 'encoded by hand — no booking on file',
                            addressed_to: current.full_name });
      }
      continue;
    }

    // Boxes were written in the order they were booked, so position identifies which is which.
    const idx = (doc.boxes || []).filter(b => b.shipment_id === box.shipment_id)
      .sort((a, b) => String(a.box_number).localeCompare(String(b.box_number)))
      .findIndex(b => b.id === box.id);
    const typed = ((booking.boxes || [])[idx] || {}).receiver;
    if (!typed) continue;

    const want = typedName(typed);
    if (!want) continue;

    const wantAddr = String(typed.street_address || '');
    const sameName = nameKey(current.full_name) === nameKey(want);
    const sameAddr = String(current.address_line || '').replace(/[^a-z0-9]+/gi, '').toLowerCase()
                   === wantAddr.replace(/[^a-z0-9]+/gi, '').toLowerCase();
    if (sameName && sameAddr) continue;   // already correct

    repairs.push({ box, ship, booking, typed, want, wantAddr, current });
  }

  return { repairs, unrepairable };
}

function receiverFor(doc, r, want, typed) {
  // Reuse a record that is already this person in this capacity, so re-running does not pile up
  // duplicates and a receiver who has had other boxes keeps one history.
  const existing = (doc.customers || []).find(c =>
    nameKey(c.full_name) === nameKey(want) &&
    phoneKey(c.phone_primary) === phoneKey(typed.contact_number) &&
    (c.type === 'RECEIVER' || c.type === 'BOTH'));
  if (existing) return { customer: existing, created: false };

  const region = typed.region && REGION.CODES.includes(typed.region) ? typed.region
    : (REGION.fromProvince ? REGION.fromProvince(typed.region) : null);
  const customer = {
    id: null,                       // filled by the caller, so both nodes can be given the same
    full_name: properName(want), type: 'RECEIVER',
    phone_primary: typed.contact_number || '', phone_alternate: '', phone_history: [],
    email: typed.email || '',
    address_line: typed.street_address || '', barangay: typed.barangay || '',
    city_municipality: typed.city_municipality || '', province: typed.province || typed.region || '',
    region: region || null, postal_code: typed.postal_code || '', country: 'Philippines',
    landmark: typed.landmark || '', notes: '',
    created_at: new Date().toISOString(),
    restored_from_booking: true      // so it is obvious later why this record appeared
  };
  return { customer, created: true };
}

(async () => {
  const doc = await store.loadDoc();
  const { repairs, unrepairable } = plan(doc);

  console.log(`node ${NODE.NAME || '(unnamed)'} — ${(doc.boxes || []).length} boxes, ${(doc.customers || []).length} customers`);

  if (!repairs.length && !unrepairable.length) { console.log('nothing to repair'); return; }

  let nextId = Math.max(NODE.ID_OFFSET, ...(doc.customers || []).map(c => Number(c.id) || 0)) + 1;
  const mintedIds = [];
  let minted = 0;

  for (const r of repairs) {
    const { customer, created } = receiverFor(doc, r.want, r.want, r.typed);
    let id = customer.id;
    if (created) {
      id = FIXED_IDS.length ? FIXED_IDS[minted] : nextId++;
      if (!id) { console.log('  !! ran out of --ids; pass one per created customer'); process.exit(1); }
      customer.id = id;
      mintedIds.push(id);
      minted++;
    }

    console.log(`\n${r.box.box_number}  (booking ${r.booking.reference_code})`);
    console.log(`   was addressed to : ${JSON.stringify(r.current.full_name)}  — ${r.current.address_line || '(no address)'}`);
    console.log(`   sender booked    : ${JSON.stringify(r.want)}  — ${r.wantAddr}`);
    console.log(`   ${created ? 'create receiver' : 'reuse receiver'} id=${id}`);

    if (WRITE) {
      if (created) {
        doc.customers.push(customer);
        if (doc.seq) doc.seq.customer = Math.max(doc.seq.customer || 0, id);
      }
      const box = (doc.boxes || []).find(b => b.id === r.box.id);
      box.receiver_id = id;
      box.receiver_repaired_from = r.current.id;
    }
  }

  for (const u of unrepairable) {
    console.log(`\n${u.box}  addressed to ${JSON.stringify(u.addressed_to)} — NOT repaired`);
    console.log(`   ${u.why}; check with the branch who the receiver should be`);
  }

  if (!WRITE) {
    console.log(`\n(dry run — nothing written. add --write to apply)`);
    if (mintedIds.length) console.log(`would mint customer ids: ${mintedIds.join(',')}`);
    return;
  }

  await store.saveDoc(doc);
  console.log(`\nwritten. ${repairs.length} box(es) repaired, ${minted} receiver(s) created.`);
  if (mintedIds.length) console.log(`pass to the other nodes with:  --ids ${mintedIds.join(',')}`);
})().catch(e => { console.error('failed:', e.message); process.exit(1); });
