// Fill in the delivery region on Philippine addresses that have none.
//
// The online booking stores the region as the sender saw it on the form — "Davao Region" — while
// a customer record holds the PSGC code the system sorts on, R11. Anything that wrote the label
// straight through, or failed to map it, left the field empty. An empty region is not cosmetic:
// changeBoxStatus refuses to mark a box SORTED without one, so the box reaches Manila and then
// cannot be routed for delivery.
//
// The city and province already on the record are enough to recover it, so nothing has to be
// asked of the sender again.
//
//   node lib/fix-missing-regions.js            (dry run, all three nodes)
//   node lib/fix-missing-regions.js --write

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
  const REGION = require(path.join(ROOT, 'lib/regions.js'));
  let total = 0;

  for (const env of ENVS) {
    const store = freshStore(env);
    let doc;
    try { doc = await loadWithRetry(store); } catch (e) { console.log(`${env.padEnd(10)} unreachable: ${e.message}`); continue; }
    if (!doc) { console.log(`${env.padEnd(10)} no database document yet`); continue; }

    const fixes = [];
    const stuck = [];
    for (const c of (doc.customers || [])) {
      if (!c || c.region) continue;
      // Only Philippine addresses have a PSGC region. A sender abroad has none and wants none.
      const looksPH = c.country === 'Philippines' || c.type === 'RECEIVER' || c.type === 'BOTH';
      if (!looksPH) continue;
      if (!c.city_municipality && !c.province) continue;
      const code = REGION.mapPsgcRegion(c.province) || REGION.mapPsgcRegion(c.city_municipality);
      if (!code) { stuck.push(c); continue; }
      fixes.push({ c, code });
    }

    if (!fixes.length && !stuck.length) { console.log(`${env.padEnd(10)} every Philippine address has its region`); continue; }

    console.log(`${env.padEnd(10)}`);
    for (const f of fixes) {
      console.log(`   ${String(f.c.full_name).padEnd(26)} ${String(f.c.city_municipality || '-').padEnd(18)} ${String(f.c.province || '-').padEnd(18)} → ${f.code} (${REGION.LABELS[f.code] || f.code})`);
      if (WRITE) f.c.region = f.code;
    }
    for (const c of stuck) {
      console.log(`   !! ${String(c.full_name).padEnd(23)} ${String(c.city_municipality || '-').padEnd(18)} ${String(c.province || '-').padEnd(18)} — no region matches, set it by hand`);
    }
    total += fixes.length;
    if (WRITE && fixes.length) { await store.saveDoc(doc); console.log('   written'); }
  }

  if (!total) return;
  console.log(WRITE ? `\n${total} address(es) given a region.` : `\n(dry run — nothing written. ${total} would be filled. add --write to apply)`);
})().catch(e => { console.error('failed:', e.message); process.exit(1); });
