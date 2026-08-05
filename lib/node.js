// Node identity for a multi-deployment VFIC network.
//
// ARCHITECTURE
// ------------
// The same codebase is deployed once per branch, each with its own database:
//
//   VFIC_NODE_ID=HQ_MANILA     → Manila head office   (its own Supabase/KV)
//   VFIC_NODE_ID=TH_BANGKOK    → Thailand branch      (its own Supabase/KV)
//   VFIC_NODE_ID=KH_PHNOMPENH  → Cambodia branch      (its own Supabase/KV)
//
// Nodes replicate to each other over HTTP (see lib/sync.js): each node periodically pulls
// the records its peers own. A node only ever writes records it owns, so there is no
// write-conflict resolution to get wrong.
//
// Record IDs are namespaced per node by an offset, so the numeric ids minted on different
// deployments can never collide and foreign-key joins survive replication untouched.

const NODES = {
  HQ_MANILA:    { id: 'HQ_MANILA',    label: 'VFIC Manila (Head Office)', short: 'Manila HQ', country: 'Philippines', type: 'HQ',     idOffset: 0 },
  TH_BANGKOK:   { id: 'TH_BANGKOK',   label: 'VFIC Thailand (Bangkok)',   short: 'Thailand',  country: 'Thailand',    type: 'BRANCH', idOffset: 1000000 },
  KH_PHNOMPENH: { id: 'KH_PHNOMPENH', label: 'VFIC Cambodia (Phnom Penh)', short: 'Cambodia', country: 'Cambodia',    type: 'BRANCH', idOffset: 2000000 }
};

const NODE_ID = NODES[process.env.VFIC_NODE_ID] ? process.env.VFIC_NODE_ID : 'HQ_MANILA';
const SELF = NODES[NODE_ID];
const IS_HQ = SELF.type === 'HQ';
const ID_OFFSET = SELF.idOffset;

// Shared secret both ends of a sync must present. Sync is disabled without it.
const SYNC_SECRET = process.env.VFIC_SYNC_SECRET || '';

// Peers to replicate with, as JSON: [{"id":"TH_BANGKOK","url":"https://vfic-th.vercel.app"}]
function parsePeers() {
  try {
    const raw = JSON.parse(process.env.VFIC_PEERS || '[]');
    return (Array.isArray(raw) ? raw : [])
      .map(p => ({ id: String(p.id || '').trim(), url: String(p.url || '').replace(/\/+$/, '') }))
      .filter(p => NODES[p.id] && p.url && p.id !== NODE_ID);
  } catch (e) { return []; }
}
const PEERS = parsePeers();

// Which node owns a record originating from a given country.
function nodeForCountry(country) {
  return Object.values(NODES).find(n => n.country === country) || NODES.HQ_MANILA;
}
// Which node minted a numeric id (from its offset band).
function nodeForId(id) {
  const n = Number(id) || 0;
  return Object.values(NODES).find(x => n >= x.idOffset && n < x.idOffset + 1000000) || null;
}

const syncEnabled = () => !!SYNC_SECRET && PEERS.length > 0;

module.exports = {
  NODES, NODE_ID, SELF, IS_HQ, ID_OFFSET, SYNC_SECRET, PEERS,
  nodeForCountry, nodeForId, syncEnabled
};
