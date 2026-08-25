// Pull from this node's peers, once, from the command line.
//
// Replication otherwise only happens inside a request: the views that read cross-node data pull
// first, at most once a minute. That is right for a system in use, but it means an idle
// deployment sits on stale data until somebody opens a page — and after a repair has been
// written to one node, waiting for a person to visit the others is a poor way to find out
// whether it travelled. This runs the same pull the app runs, against whichever node the given
// env file names.
//
//   node lib/run-sync.js --env .env.mnl
//   node lib/run-sync.js                  (every node in turn)
//
// Reads the deployment's own VFIC_SYNC_SECRET from that env file, exactly as the server does.

const path = require('path');
const ROOT = path.join(__dirname, '..');

const args = process.argv.slice(2);
const argOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const ONE = argOf('--env');
const ENVS = ONE ? [ONE] : ['.env.mnl', '.env.th', '.env.kh'];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function freshModules(envFile) {
  for (const k of Object.keys(process.env)) if (/^(SUPABASE|REDIS|KV|VFIC|STORE)/.test(k)) delete process.env[k];
  Object.assign(process.env, require(path.join(ROOT, 'lib/env.js')).load(envFile));
  for (const m of ['lib/store.js', 'lib/node.js', 'lib/sync.js']) {
    delete require.cache[require.resolve(path.join(ROOT, m))];
  }
  return {
    store: require(path.join(ROOT, 'lib/store.js')),
    sync: require(path.join(ROOT, 'lib/sync.js')),
    NODE: require(path.join(ROOT, 'lib/node.js'))
  };
}

async function loadWithRetry(store) {
  for (let i = 0; i < 4; i++) {
    try { return await store.loadDoc(); } catch (e) { if (i === 3) throw e; await sleep(1500); }
  }
}

(async () => {
  for (const env of ENVS) {
    const { store, sync, NODE } = freshModules(env);
    if (!NODE.syncEnabled()) { console.log(`${env.padEnd(10)} ${NODE.NODE_ID} — sync not configured here`); continue; }

    let doc;
    try { doc = await loadWithRetry(store); } catch (e) { console.log(`${env.padEnd(10)} unreachable: ${e.message}`); continue; }
    if (!doc) { console.log(`${env.padEnd(10)} no database document yet`); continue; }

    const result = await sync.runSync(doc);
    console.log(`${env.padEnd(10)} ${NODE.NODE_ID}`);
    for (const p of result.peers) {
      console.log(p.ok
        ? `   ${String(p.peer).padEnd(14)} applied ${p.applied}, skipped ${p.skipped}, cursor ${p.cursor}`
        : `   ${String(p.peer).padEnd(14)} FAILED: ${p.error}`);
    }

    // Only write when something actually arrived — a pull that changed nothing should not
    // rewrite the whole document and bump every revision behind it.
    const applied = result.peers.reduce((n, p) => n + (p.applied || 0), 0);
    if (applied) {
      sync.stampRevisions(doc);
      await store.saveDoc(doc);
      console.log(`   saved ${applied} incoming record(s)`);
    } else {
      console.log('   nothing new');
    }
  }
})().catch(e => { console.error('failed:', e.message); process.exit(1); });
