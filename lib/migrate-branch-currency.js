// Restate a branch's books in the currency that branch actually trades in.
//
//   npm run migrate-currency -- --env .env.kh                 (dry run — prints the plan)
//   npm run migrate-currency -- --env .env.kh --apply         (writes it)
//
// Cambodia was set up billing in US dollars and Thailand's rate card was never restamped
// after the split, so their books carry amounts in a currency the branch does not price in.
// Relabelling alone would be wrong — USD 907 is not KHR 907 — so every amount is converted
// at the branch's own stored exchange rate, and the label follows the money.
//
// Converts, for the branch this deployment serves:
//   • the rate card (every price, and its currency)
//   • each shipment's shipping fee
//   • each expense recorded against the branch
//
// Inter-branch settlements are left alone: they are issued by head office in pesos and are
// already restated for display at read time.
const envArg = process.argv.indexOf('--env');
require('./env').load(envArg !== -1 ? process.argv[envArg + 1] : undefined);

const fs = require('fs');
const path = require('path');
const store = require('./store');
const BRANCH = require('./branches');
const FX = require('./fx');
const NODE = require('./node');

const APPLY = process.argv.includes('--apply');
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

// Which branch's books this deployment holds. --branch overrides, for a single-node setup.
function targetBranch() {
  const i = process.argv.indexOf('--branch');
  if (i !== -1 && BRANCH.byKey(process.argv[i + 1])) return process.argv[i + 1];
  return NODE.NODE_ID;
}

function main() {
  const branch = targetBranch();
  const b = BRANCH.byKey(branch);
  if (!b) { console.log(red(`\n  Unknown branch: ${branch}\n`)); process.exitCode = 1; return; }
  const target = BRANCH.currencyFor(branch);

  console.log('\nBranch currency migration');
  console.log('─'.repeat(68));
  console.log(`  Branch: ${b.label}`);
  console.log(`  Target currency: ${green(target)}${APPLY ? '' : dim('   (dry run — nothing will be written)')}`);

  return store.loadDoc().then((doc) => {
    if (!doc) { console.log(red('\n  No database document found for this store.\n')); process.exitCode = 1; return; }

    const fx = FX.normalizeFx((doc.settings.fxByBranch || {})[branch] || doc.settings.fx);
    console.log(`  Rates: ${fx.source} as of ${fx.as_of}`);

    const rate = (from) => {
      const c = FX.convert(1, from, target, fx);
      return c.converted ? c.rate : null;
    };

    // ---- rate card ----
    const cards = doc.settings.rateCards || {};
    const card = cards[branch];
    const cardFrom = card && card.currency;
    const cardRate = cardFrom && cardFrom !== target ? rate(cardFrom) : null;

    // ---- shipments ----
    const country = b.country;
    const shipments = (doc.shipments || []).filter(s => s.origin_country === country
      && s.shipping_fee_amount != null && (s.currency || target) !== target);
    // ---- expenses ----
    const expenses = (doc.expenses || []).filter(e => !e.deleted_at && (e.branch || 'HQ_MANILA') === branch
      && (e.currency || target) !== target);

    const nothing = !cardRate && !shipments.length && !expenses.length;
    if (nothing) {
      console.log(green(`\n  Nothing to convert — this branch's books are already in ${target}.\n`));
      return;
    }

    console.log('');
    if (cardRate) {
      console.log(`  Rate card: ${cardFrom} → ${target} at ${cardRate}`);
      const l = card.ocean && card.ocean.OCEAN_ECONOMY && card.ocean.OCEAN_ECONOMY.METRO_MANILA;
      if (l) console.log(dim(`      Large box to Metro Manila (economy): ${l.LARGE} → ${(l.LARGE * cardRate).toFixed(2)}`));
    } else if (card) {
      console.log(dim(`  Rate card already in ${target}.`));
    }

    if (shipments.length) {
      const byCcy = {};
      for (const s of shipments) byCcy[s.currency || '?'] = (byCcy[s.currency || '?'] || 0) + 1;
      console.log(`  Shipments: ${shipments.length} to convert (${Object.entries(byCcy).map(([c, n]) => `${n} in ${c}`).join(', ')})`);
      for (const s of shipments.slice(0, 3)) {
        const r = rate(s.currency);
        console.log(dim(`      ${s.shipment_number}: ${s.currency} ${s.shipping_fee_amount} → ${target} ${r ? (s.shipping_fee_amount * r).toFixed(2) : '— no rate'}`));
      }
      if (shipments.length > 3) console.log(dim(`      …and ${shipments.length - 3} more`));
    }
    if (expenses.length) console.log(`  Expenses: ${expenses.length} to convert`);

    // Anything we cannot price is left untouched rather than guessed at.
    const unpriced = [...new Set([
      ...(cardFrom && !cardRate && cardFrom !== target ? [cardFrom] : []),
      ...shipments.filter(s => !rate(s.currency)).map(s => s.currency),
      ...expenses.filter(e => !rate(e.currency)).map(e => e.currency)
    ])];
    if (unpriced.length) {
      console.log(red(`\n  No exchange rate on file for: ${unpriced.join(', ')}`));
      console.log('  Those records will be left as they are. Set the rate in Accounting → Rate Cards first.');
    }

    if (!APPLY) {
      console.log(`\n  ${dim('Dry run.')} Re-run with ${green('--apply')} to write these changes.\n`);
      return;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(store.DATA_DIR, `backup-before-currency-${stamp}.json`);
    fs.mkdirSync(store.DATA_DIR, { recursive: true });
    fs.writeFileSync(backup, JSON.stringify(doc, null, 2));
    console.log(`\n  Backup written: ${backup}`);

    let n = 0;
    if (cardRate) {
      const scale = (o) => { for (const k of Object.keys(o)) o[k] = +(o[k] * cardRate).toFixed(2); };
      if (card.empty_box_price) scale(card.empty_box_price);
      for (const lvl of Object.keys(card.ocean || {})) for (const z of Object.keys(card.ocean[lvl])) scale(card.ocean[lvl][z]);
      for (const lvl of Object.keys(card.air || {})) scale(card.air[lvl]);
      card.currency = target;
      n += 1;
    }
    let sn = 0;
    for (const s of shipments) {
      const r = rate(s.currency);
      if (!r) continue;
      s.shipping_fee_amount = +(s.shipping_fee_amount * r).toFixed(2);
      s.currency = target;
      sn += 1;
    }
    let en = 0;
    for (const e of expenses) {
      const r = rate(e.currency);
      if (!r) continue;
      e.amount = +(e.amount * r).toFixed(2);
      e.currency = target;
      en += 1;
    }

    try { require('./sync').stampRevisions(doc); } catch (err) { /* single-node setup */ }
    return store.saveDoc(doc).then(() => {
      console.log(green(`\n  Converted ${n} rate card, ${sn} shipment(s) and ${en} expense(s) to ${target}.`));
      console.log(dim('  Revisions were bumped, so peers will pick this up on the next sync.\n'));
    });
  });
}

Promise.resolve().then(main).catch(e => { console.error('\n' + red(e.message) + '\n'); process.exitCode = 1; });
