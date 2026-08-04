// Staff role model.
//
// The system is divided into a Developer Admin (system owner), a Master Admin (business
// owner), per-origin Shipper Agents (Thailand / Cambodia), the PH-side Consignee Agent,
// Warehouse staff and Accounting.
//
// A Shipper Agent is scoped to its origin country: it only sees shipments, boxes,
// containers and intake requests originating from that country.

const ROLES = [
  { key: 'DEVELOPER_ADMIN',   label: 'Developer Admin',            blurb: 'Full system access, including developer tools and user management.' },
  { key: 'MASTER_ADMIN',      label: 'Master Admin',               blurb: 'Full business access across all origins.' },
  { key: 'SHIPPER_AGENT_TH',  label: 'Shipper Agent — Thailand',   blurb: 'Origin operations for Thailand only.' },
  { key: 'SHIPPER_AGENT_KH',  label: 'Shipper Agent — Cambodia',   blurb: 'Origin operations for Cambodia only.' },
  { key: 'CONSIGNEE_AGENT',   label: 'Consignee Agent (Manila)',   blurb: 'PH-side arrival, sorting and delivery.' },
  { key: 'WAREHOUSE',         label: 'Warehouse Staff',            blurb: 'Receiving, stripping and segregation scans.' },
  { key: 'ACCOUNTING',        label: 'Accounting',                 blurb: 'Rate cards, billing, receipts and profit & loss.' }
];

const ROLE_KEYS = ROLES.map(r => r.key);
const ROLE_LABELS = Object.fromEntries(ROLES.map(r => [r.key, r.label]));

// Roles from before the split still appear in stored users/sessions.
const LEGACY_ROLES = { ADMIN: 'MASTER_ADMIN', SHIPPER_AGENT: 'SHIPPER_AGENT_TH' };
const normalizeRole = (role) => {
  const r = String(role || '').toUpperCase();
  return ROLE_KEYS.includes(r) ? r : (LEGACY_ROLES[r] || r);
};

// ---- role groups used for endpoint authorisation ----
const ADMINS = ['DEVELOPER_ADMIN', 'MASTER_ADMIN'];
const SHIPPERS = ['SHIPPER_AGENT_TH', 'SHIPPER_AGENT_KH'];
const AGENTS = [...ADMINS, ...SHIPPERS, 'CONSIGNEE_AGENT'];
const PH_SIDE = [...ADMINS, 'CONSIGNEE_AGENT', 'WAREHOUSE'];
const ALL_STAFF = [...AGENTS, 'WAREHOUSE', 'ACCOUNTING'];
const ACCOUNTING = [...ADMINS, 'ACCOUNTING'];

const isAdmin = (role) => ADMINS.includes(normalizeRole(role));

// Origin country a shipper agent is limited to (null = sees every origin).
const ORIGIN_SCOPE = { SHIPPER_AGENT_TH: 'Thailand', SHIPPER_AGENT_KH: 'Cambodia' };
const originScope = (role) => ORIGIN_SCOPE[normalizeRole(role)] || null;

module.exports = {
  ROLES, ROLE_KEYS, ROLE_LABELS, LEGACY_ROLES, normalizeRole,
  ADMINS, SHIPPERS, AGENTS, PH_SIDE, ALL_STAFF, ACCOUNTING,
  isAdmin, originScope, ORIGIN_SCOPE
};
