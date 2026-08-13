// Clears the app's database document so the server re-seeds demo data on next start.
// Works against whichever backend is configured — filesystem locally, or Supabase/Redis
// when the cloud variables are set. Previously this only ever deleted data/db.json, so
// against Supabase it reported success while leaving the real data untouched.
// --env picks which deployment's store to clear, the same as every other script here.
// Without it this loaded the default .env, found no cloud credentials, fell back to the
// filesystem and reported a successful reset — of a local file, while the deployment it was
// aimed at was never touched. A destructive command that quietly misses is worse than one
// that fails, so the target is now stated back before anything is cleared.
const envArg = process.argv.indexOf('--env');
const ENV_FILE = envArg !== -1 ? process.argv[envArg + 1] : undefined;
if (envArg !== -1 && !ENV_FILE) {
  console.error('--env needs a file, e.g. --env .env.th');
  process.exit(1);
}
require('./env').load(ENV_FILE);

const fs = require('fs');
const path = require('path');
const store = require('./store');

const yes = process.argv.includes('--yes') || process.argv.includes('-y');

async function main() {
  // Say what is about to be cleared. Aiming at a deployment and hitting a local file is
  // exactly the mistake this guards against, and it is invisible without this line.
  const node = require('./node').NODE_ID;
  console.log(`Target: ${store.backend}${ENV_FILE ? ` (from ${ENV_FILE})` : ''} · node ${node}`);
  if (ENV_FILE && (store.backend === 'filesystem' || store.backend === 'ephemeral-tmp')) {
    console.error(`\n${ENV_FILE} did not configure a cloud store, so this would clear a local file`);
    console.error('rather than the deployment you meant. Check its SUPABASE_* / KV_* values.');
    process.exitCode = 1;
    return;
  }

  if (store.backend === 'filesystem' || store.backend === 'ephemeral-tmp') {
    const file = path.join(store.DATA_DIR, 'db.json');
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log('Demo database reset. It will be re-seeded on next server start.');
    } else {
      console.log('No database file found; nothing to reset.');
    }
    return;
  }

  // Cloud backends hold live data, so wiping one needs to be deliberate.
  if (!yes) {
    console.error(`Refusing to wipe the ${store.backend} database without confirmation.`);
    console.error('This deletes every shipment, box, customer and user in it.');
    console.error('Re-run with --yes if that is what you want:  npm run reset -- --yes');
    process.exitCode = 1;
    return;
  }
  const existing = await store.loadDoc();
  if (!existing) {
    console.log(`No document stored in ${store.backend} yet; nothing to reset.`);
    return;
  }
  await store.saveDoc(null);
  console.log(`Cleared the ${store.backend} database. It will be re-seeded on next server start.`);
}

main().catch(e => { console.error(e.message); process.exitCode = 1; });
