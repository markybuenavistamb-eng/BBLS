// One-off migration: rename legacy load codes to the per-origin form.
//
//   C1 → TH-C1      (container sailing from Thailand)
//   C2 → KH-C2      (container sailing from Cambodia)
//
// Load codes used to run in a single sequence shared by both branches, so Bangkok's and
// Phnom Penh's interleaved and a bare "C4" meant nothing without asking whose it was. New
// containers are already minted per origin; this brings existing ones into line.
//
//   npm run migrate-load-codes -- --env .env.th             (dry run — prints the plan)
//   npm run migrate-load-codes -- --env .env.th --apply     (writes it)
//
// The number is preserved rather than renumbered (C4 becomes TH-C4, not TH-C1), so a code
// printed on an old box label is still recognisable after the change.
//
// Safe to run more than once: an already-prefixed code is left alone.
const envArg = process.argv.indexOf('--env');
require('./env').load(envArg !== -1 ? process.argv[envArg + 1] : undefined);

const fs = require('fs');
const path = require('path');
const store = require('./store');
const REF = require('./refdata');
const BRANCH = require('./branches');

const APPLY = process.argv.includes('--apply');
const LEGACY = /^C(\d+)$/i;

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

// Which country a container sailed from, so its code can carry the right prefix.
function prefixFor(container) {
  const country = REF.countryForOriginPort(container.origin_port)
    || (BRANCH.byKey(container.booked_by_branch) || {}).country;
  return country ? BRANCH.countryCode(country) : null;
}

async function main() {
  console.log('\nLoad code migration');
  console.log('─'.repeat(66));
  console.log(`  Store: ${store.backend}${APPLY ? '' : dim('   (dry run — nothing will be written)')}`);

  const doc = await store.loadDoc();
  if (!doc) { console.log(red('\n  No database document found for this store.\n')); process.exitCode = 1; return; }

  const containers = Array.isArray(doc.containers) ? doc.containers : [];
  const boxes = Array.isArray(doc.boxes) ? doc.boxes : [];

  // Every node seeded the same demo dataset and replication then merged the copies, so a
  // container can appear twice — once minted here, once pulled from a peer. Renaming both
  // would give two records the same code, which is the confusion this migration exists to
  // remove. Duplicates are reported and left alone until one copy is dealt with.
  const seenNumber = {};
  for (const c of containers) {
    const n = String(c.container_number || '').toUpperCase();
    if (n) (seenNumber[n] = seenNumber[n] || []).push(c);
  }

  const plan = [];
  const skipped = [];
  for (const c of containers) {
    const code = String(c.load_code || '');
    if (!code) continue;
    if (!LEGACY.test(code)) { skipped.push({ c, why: 'already per-origin' }); continue; }
    const twins = seenNumber[String(c.container_number || '').toUpperCase()] || [];
    if (twins.length > 1) {
      skipped.push({ c, why: `${twins.length} records share this container number (${twins.map(t => t._node || 'local').join(', ')}) — resolve the duplicate first` });
      continue;
    }
    const prefix = prefixFor(c);
    if (!prefix) { skipped.push({ c, why: 'origin unknown — cannot tell which branch it sailed from' }); continue; }
    const next = `${prefix}-${code.toUpperCase()}`;
    if (containers.some(x => x !== c && String(x.load_code || '') === next)) {
      skipped.push({ c, why: `${next} is already taken by another container` });
      continue;
    }
    plan.push({ container: c, from: code, to: next, boxes: boxes.filter(b => b.container_id === c.id) });
  }

  if (!plan.length) {
    console.log(green('\n  Nothing to rename — every container already carries a per-origin code.\n'));
    if (skipped.length) skipped.forEach(s => console.log(dim(`    ${s.c.container_number}: ${s.why}`)));
    return;
  }

  console.log(`\n  ${plan.length} container(s) to rename:\n`);
  for (const p of plan) {
    console.log(`    ${p.container.container_number.padEnd(14)} ${p.from.padEnd(5)} → ${green(p.to.padEnd(8))} ${dim(`${p.boxes.length} box(es)`)}`);
    for (const b of p.boxes.slice(0, 3)) {
      const cbn = String(b.container_box_number || '');
      console.log(dim(`        ${b.box_number}  ${cbn} → ${cbn.replace(new RegExp(`/${p.from}$`, 'i'), '/' + p.to)}`));
    }
    if (p.boxes.length > 3) console.log(dim(`        …and ${p.boxes.length - 3} more`));
  }
  for (const s of skipped) console.log(dim(`\n    skipped ${s.c.container_number} (${s.c.load_code}): ${s.why}`));

  if (!APPLY) {
    console.log(`\n  ${dim('Dry run.')} Re-run with ${green('--apply')} to write these changes.\n`);
    return;
  }

  // Keep a copy of the whole document before touching anything.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(store.DATA_DIR, `backup-before-loadcodes-${stamp}.json`);
  fs.mkdirSync(store.DATA_DIR, { recursive: true });
  fs.writeFileSync(backup, JSON.stringify(doc, null, 2));
  console.log(`\n  Backup written: ${backup}`);

  let boxesTouched = 0;
  for (const p of plan) {
    p.container.load_code = p.to;
    for (const b of p.boxes) {
      if (String(b.container_load_code || '').toUpperCase() === p.from.toUpperCase()) b.container_load_code = p.to;
      // The load code is embedded in the box's container-stamped number.
      if (b.container_box_number) {
        b.container_box_number = String(b.container_box_number).replace(new RegExp(`/${p.from}$`, 'i'), '/' + p.to);
      }
      boxesTouched += 1;
    }
  }

  // Bump revisions so peers pull the renamed records instead of keeping their old copies.
  try { require('./sync').stampRevisions(doc); } catch (e) { /* sync not configured — local only */ }

  await store.saveDoc(doc);
  console.log(green(`\n  Renamed ${plan.length} container(s) and updated ${boxesTouched} box(es).`));
  console.log(dim('  Revisions were bumped, so peers will pick this up on the next sync.\n'));
}

main().catch(e => { console.error('\n' + red(e.message) + '\n'); process.exitCode = 1; });
