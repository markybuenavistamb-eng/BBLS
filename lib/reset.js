// Clears the app's database document so the server re-seeds demo data on next start.
// Works against whichever backend is configured — filesystem locally, or Supabase/Redis
// when the cloud variables are set. Previously this only ever deleted data/db.json, so
// against Supabase it reported success while leaving the real data untouched.
require('./env').load();

const fs = require('fs');
const path = require('path');
const store = require('./store');

const yes = process.argv.includes('--yes') || process.argv.includes('-y');

async function main() {
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
