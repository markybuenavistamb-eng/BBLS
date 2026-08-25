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
//
// The numbers people quote — shipment and box numbers, intake and box-order references — are
// banded the same way, for the same reason. Their prefix names the ORIGIN COUNTRY, not the
// office that keyed them (Manila books Thailand shipments too), so the prefix cannot keep two
// offices apart: Manila and Bangkok each minted TH-2026-000007 for a different shipment, and
// replication put both in every database. The band makes the digits say who minted them —
// Manila 000001…, Thailand 100001…, Cambodia 200001… — with no coordination between nodes.
//
// A band is where a node MINTS, not a property every record it owns satisfies. Everything
// numbered before the bands existed sits in Manila's band wherever it was actually keyed, and
// lib/fix-duplicate-numbers.js moves only the numbers that genuinely collide — a unique number
// is left where it is rather than churned for tidiness, because moving one changes a number a
// customer is already holding. Bangkok therefore owns records numbered in Manila's band, and
// always will. Read a record's owner from its _node; never infer it from the digits.

// How many numbers each node's band holds (99,999 per prefix). The counter is never reset, so
// a series that ever approaches this needs a wider band rather than being allowed to wrap into
// the next node's.
const NUMBER_BAND_SIZE = 100000;

const NODES = {
  HQ_MANILA:    { id: 'HQ_MANILA',    label: 'VFIC Manila (Head Office)', short: 'Manila HQ', country: 'Philippines', type: 'HQ',     idOffset: 0,       numberBand: 0 },
  TH_BANGKOK:   { id: 'TH_BANGKOK',   label: 'VFIC Thailand (Bangkok)',   short: 'Thailand',  country: 'Thailand',    type: 'BRANCH', idOffset: 1000000, numberBand: 100000 },
  KH_PHNOMPENH: { id: 'KH_PHNOMPENH', label: 'VFIC Cambodia (Phnom Penh)', short: 'Cambodia', country: 'Cambodia',    type: 'BRANCH', idOffset: 2000000, numberBand: 200000 }
};

const NODE_ID = NODES[process.env.VFIC_NODE_ID] ? process.env.VFIC_NODE_ID : 'HQ_MANILA';
const SELF = NODES[NODE_ID];
const IS_HQ = SELF.type === 'HQ';
const ID_OFFSET = SELF.idOffset;
const NUMBER_BAND = SELF.numberBand;

// Shared secret both ends of a sync must present. Sync is disabled without it.
// Trimmed, and stripped of surrounding quotes, because it is pasted by hand into a
// dashboard field: a stray newline or space would otherwise be sent as an HTTP header and
// rejected by fetch itself, long before the peer is ever contacted.
const SYNC_SECRET = String(process.env.VFIC_SYNC_SECRET || '').trim().replace(/^["']|["']$/g, '');

// Whether the configured secret can actually be sent as a header, and if not, why.
// Copying from a terminal easily takes the prompt and the command along with the output,
// which fails deep inside fetch with "invalid header value" and no hint about the cause.
function secretIssue() {
  const raw = process.env.VFIC_SYNC_SECRET;
  if (raw == null || String(raw).trim() === '') return 'VFIC_SYNC_SECRET is not set on this deployment.';
  const s = SYNC_SECRET;
  if (/[\r\n]/.test(String(raw))) {
    return 'VFIC_SYNC_SECRET spans multiple lines — it looks like a whole terminal block was pasted. Set it to just the generated value, one line, no command and no prompt.';
  }
  // A header value may only hold visible ASCII plus space/tab.
  if (/[^\x20-\x7e\t]/.test(s)) {
    return 'VFIC_SYNC_SECRET contains characters that cannot be sent in an HTTP header. Set it to just the generated value.';
  }
  if (/(^|\s)(PS |node -e|console\.log|randomBytes|C:\\|\$ )/i.test(s)) {
    return 'VFIC_SYNC_SECRET contains shell text (a prompt or the command that generated it). Set it to only the generated value — the random string on its own.';
  }
  if (s.length < 16) return 'VFIC_SYNC_SECRET is too short to be the generated value; it should be around 43 characters.';
  return null;
}

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
// A secret that cannot be sent as a header is not a working secret, so it does not count
// as enabled — better to report sync as off with a reason than to fail on every attempt.
const syncEnabled = () => !!SYNC_SECRET && !secretIssue() && PEERS.length > 0;

module.exports = {
  NODES, NODE_ID, SELF, IS_HQ, ID_OFFSET, NUMBER_BAND, NUMBER_BAND_SIZE, SYNC_SECRET, PEERS,
  nodeForCountry, nodeForId, syncEnabled, secretIssue
};
