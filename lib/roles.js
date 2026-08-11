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
  { key: 'MASTER_ADMIN',      label: 'Master Admin',               blurb: 'Full business access across all origins and branches.' },
  { key: 'BRANCH_ADMIN_TH',   label: 'Branch Admin — Thailand',    blurb: 'Runs the Thailand branch: its staff, its operations, its numbers.' },
  { key: 'BRANCH_ADMIN_KH',   label: 'Branch Admin — Cambodia',    blurb: 'Runs the Cambodia branch: its staff, its operations, its numbers.' },
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
const ADMINS = ['DEVELOPER_ADMIN', 'MASTER_ADMIN'];               // see and run everything
const BRANCH_ADMINS = ['BRANCH_ADMIN_TH', 'BRANCH_ADMIN_KH'];     // run one branch only
const SHIPPERS = ['SHIPPER_AGENT_TH', 'SHIPPER_AGENT_KH'];
// Anywhere an "admin" is required for branch-local work, a branch admin qualifies too.
const ANY_ADMIN = [...ADMINS, ...BRANCH_ADMINS];
const AGENTS = [...ANY_ADMIN, ...SHIPPERS, 'CONSIGNEE_AGENT'];
const PH_SIDE = [...ADMINS, 'CONSIGNEE_AGENT', 'WAREHOUSE'];
const ALL_STAFF = [...AGENTS, 'WAREHOUSE', 'ACCOUNTING'];
// Each branch keeps its own books, so a branch admin reaches the accounting endpoints too —
// scoped to their own branch. Editing rate cards stays Developer-only.
const ACCOUNTING = [...ADMINS, ...BRANCH_ADMINS, 'ACCOUNTING'];

const isAdmin = (role) => ADMINS.includes(normalizeRole(role));
const isBranchAdmin = (role) => BRANCH_ADMINS.includes(normalizeRole(role));
const isAnyAdmin = (role) => ANY_ADMIN.includes(normalizeRole(role));

// Origin country a branch role is limited to (null = sees every origin).
const ORIGIN_SCOPE = {
  BRANCH_ADMIN_TH: 'Thailand', SHIPPER_AGENT_TH: 'Thailand',
  BRANCH_ADMIN_KH: 'Cambodia', SHIPPER_AGENT_KH: 'Cambodia'
};
const originScope = (role) => ORIGIN_SCOPE[normalizeRole(role)] || null;

// Seeing every shipment across both origin portals is a head-office admin capability.
// Manila's other staff work the Philippine end: they see cargo from the moment it sails,
// not boxes still sitting in a branch warehouse abroad, which remain branch business.
const seesEveryShipment = (role) => ADMINS.includes(normalizeRole(role));
const SHIPPED_ONLY_ROLES = ['CONSIGNEE_AGENT', 'WAREHOUSE', 'ACCOUNTING'];
const shippedCargoOnly = (role) => SHIPPED_ONLY_ROLES.includes(normalizeRole(role));

// Roles a branch admin is allowed to create/manage inside their own branch.
const BRANCH_MANAGEABLE = {
  BRANCH_ADMIN_TH: ['SHIPPER_AGENT_TH'],
  BRANCH_ADMIN_KH: ['SHIPPER_AGENT_KH']
};
const manageableRoles = (role) => {
  const r = normalizeRole(role);
  if (ADMINS.includes(r)) return ROLE_KEYS.slice();
  return (BRANCH_MANAGEABLE[r] || []).slice();
};

module.exports = {
  ROLES, ROLE_KEYS, ROLE_LABELS, LEGACY_ROLES, normalizeRole,
  ADMINS, BRANCH_ADMINS, ANY_ADMIN, SHIPPERS, AGENTS, PH_SIDE, ALL_STAFF, ACCOUNTING,
  isAdmin, isBranchAdmin, isAnyAdmin, originScope, ORIGIN_SCOPE, manageableRoles,
  seesEveryShipment, shippedCargoOnly, SHIPPED_ONLY_ROLES
};
