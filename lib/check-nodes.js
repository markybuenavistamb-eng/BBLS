// Checks a deployed VFIC network end to end.
//
//   npm run check-nodes -- https://vfic-mnl.vercel.app https://vfic-th.vercel.app https://vfic-kh.vercel.app
//
// Hits /api/health on each deployment and reports whether it is actually ready: a real
// database rather than ephemeral /tmp, a node identity set, replication configured. Then it
// cross-checks the network as a whole — the mistakes that matter here are the ones a single
// node cannot see, like two projects sharing a node id (their records would collide) or a
// peer URL pointing at the wrong deployment.
//
// Reads no secrets and sends none: /api/health is unauthenticated and returns only
// booleans about what is configured.
require('./env').load();

const NODES = require('./node').NODES;

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const ok = (s) => `  ${green('✓')} ${s}`;
const bad = (s) => `  ${red('✗')} ${s}`;
const warn = (s) => `  ${yellow('!')} ${s}`;
const info = (s) => `    ${s}`;

function normalise(u) {
  let s = String(u).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  return s;
}

async function probe(url) {
  const started = Date.now();
  try {
    const res = await fetch(url + '/api/health', { headers: { Accept: 'application/json' } });
    const ms = Date.now() - started;
    if (!res.ok) return { url, error: `HTTP ${res.status}`, ms };
    return { url, health: await res.json(), ms };
  } catch (e) {
    return { url, error: e.message, ms: Date.now() - started };
  }
}

async function main() {
  const urls = process.argv.slice(2).filter(a => !a.startsWith('-')).map(normalise);
  if (!urls.length) {
    console.error('\nUsage: npm run check-nodes -- <url> [url] [url]\n');
    console.error('  e.g. npm run check-nodes -- https://vfic-mnl.vercel.app https://vfic-th.vercel.app\n');
    process.exitCode = 1;
    return;
  }

  console.log('\nVFIC network check');
  console.log('─'.repeat(64));

  const results = await Promise.all(urls.map(probe));
  let problems = 0;

  for (const r of results) {
    console.log(`\n${r.url}  ${dim(r.ms + 'ms')}`);
    if (r.error) {
      console.log(bad('Unreachable: ' + r.error));
      console.log(info('Check the URL, and that the deployment finished building.'));
      problems++;
      continue;
    }
    const h = r.health;
    const label = (h.node && h.node.label) || 'unknown node';
    console.log(info(`${label}  ${dim('· id band ' + ((h.node && h.node.id_band) || '?'))}`));
    // Which commit is live, so "is my fix deployed?" is answerable without guessing.
    const b = h.build || {};
    if (b.commit) console.log(info(dim(`build ${b.commit}${b.message ? ' · ' + b.message.slice(0, 60) : ''}`)));
    // A node still on 'demo' will refill itself with the worked example if it is wiped.
    if (h.seed_mode && h.seed_mode !== 'demo') console.log(ok(`Empty-database seed: ${h.seed_mode}`));
    else if (h.seed_mode === 'demo') console.log(warn('Empty-database seed: demo — wiping this node would recreate the sample data.'));

    if (h.ready) console.log(ok('Ready.'));
    else console.log(bad('Not ready — see below.'));

    // Persistence is the one that silently loses data, so call it out specifically.
    if (h.backend === 'ephemeral-tmp') {
      console.log(bad('Storage is ephemeral /tmp — every cold start wipes this node.'));
      console.log(info('Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or the KV pair) on this project, then redeploy.'));
      problems++;
    } else {
      console.log(ok(`Storage: ${h.backend}${h.persistent ? ' (persistent)' : ''}`));
    }

    const c = h.checks || {};
    if (h.files) {
      if (h.files.persistent) console.log(ok(`Uploads: ${h.files.backend}`));
      else {
        console.log(bad('Uploads go to ephemeral /tmp — an ID scan saved at intake disappears when the instance recycles.'));
        const vars = h.files.blob_vars || [];
        if (!vars.length) {
          console.log(info('This build can see no BLOB variable at all, so the store is not connected to it.'));
          console.log(info('Storage → vfic-files → Projects → Connect Project, with Production ticked. Then push or redeploy so a new build picks it up.'));
        } else if (!vars.includes('BLOB_READ_WRITE_TOKEN')) {
          console.log(info(`The store is connected but the token arrived as: ${vars.join(', ')}`));
          console.log(info('Add BLOB_READ_WRITE_TOKEN with that same value, or rename it.'));
        } else {
          console.log(info('BLOB_READ_WRITE_TOKEN is present but empty — re-copy it from the store.'));
        }
        problems++;
      }
    }
    if (!c.database_connected) {
      console.log(bad('Database not reachable from this deployment.'));
      if (h.storage_error) {
        console.log(info(`Reason: ${h.storage_error.reason}`));
        // Shape findings pin down which mistake it is, so lead with them.
        for (const n of h.storage_error.notes || []) console.log(`    ${yellow('→')} ${n}`);
        console.log(info(h.storage_error.fix));
      }
      problems++;
    }
    if (!c.node_id_set) {
      console.log(bad(`VFIC_NODE_ID is not set — this deployment is defaulting to ${h.node && h.node.id}.`));
      console.log(info('Two deployments both defaulting to HQ_MANILA would mint colliding ids.'));
      problems++;
    }
    if (!c.sync_secret_set) {
      const why = h.replication && h.replication.secret_error;
      console.log(warn(why || 'VFIC_SYNC_SECRET not set — replication is off for this node.'));
      problems++;
    }
    if (!c.peers_configured) { console.log(warn('VFIC_PEERS not set — this node has nobody to sync with.')); problems++; }
    if (h.replication && h.replication.enabled) {
      console.log(ok(`Replication on, peers: ${(h.replication.peers || []).join(', ') || 'none listed'}`));
    }
  }

  // ---- network-wide checks ----
  console.log('\n' + '─'.repeat(64));
  console.log('Network');
  const live = results.filter(r => r.health && r.health.node);

  // Every node must have a distinct identity, or their id bands overlap and records collide.
  const byId = {};
  for (const r of live) (byId[r.health.node.id] ||= []).push(r.url);
  const dupes = Object.entries(byId).filter(([, u]) => u.length > 1);
  if (dupes.length) {
    for (const [id, u] of dupes) {
      console.log(bad(`${id} is claimed by ${u.length} deployments: ${u.join(', ')}`));
      console.log(info('Give each project its own VFIC_NODE_ID, or their ids will collide and replication will mis-assign ownership.'));
    }
    problems++;
  } else if (live.length > 1) {
    console.log(ok(`All ${live.length} deployments have distinct node identities.`));
  }

  // A peer list pointing at the wrong deployment is invisible from any single node.
  if (live.length > 1) {
    const idByUrl = Object.fromEntries(live.map(r => [r.url, r.health.node.id]));
    const seen = new Set(live.map(r => r.health.node.id));
    let mismatched = 0;
    for (const r of live) {
      for (const peer of (r.health.replication && r.health.replication.peers) || []) {
        if (!NODES[peer]) { console.log(bad(`${r.health.node.id} lists unknown peer "${peer}".`)); mismatched++; }
        else if (!seen.has(peer)) console.log(warn(`${r.health.node.id} expects peer ${peer}, which was not among the URLs checked.`));
      }
    }
    if (mismatched) problems++;
    console.log(info('Peer URLs themselves are only proven by a real sync — run ⟳ Sync now in the Developer Console.'));
    void idByUrl;
  }

  const expected = Object.keys(NODES).length;
  if (live.length < expected) {
    console.log(warn(`${live.length} of ${expected} nodes checked. Missing: ${Object.keys(NODES).filter(k => !byId[k]).join(', ')}`));
  }

  console.log('');
  if (problems) {
    console.log(red(`${problems} problem(s) found — fix the variables above and redeploy.\n`));
    process.exitCode = 1;
  } else {
    console.log(green('All checked nodes are ready and distinctly identified.\n'));
  }
}

main().catch(e => { console.error('\n' + bad(e.message) + '\n'); process.exitCode = 1; });
