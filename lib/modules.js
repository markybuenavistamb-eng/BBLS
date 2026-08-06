// Application modules and which roles may use them.
//
// Every navigable area of the staff app is a "module". Admin → Roles & Modules shows the
// role × module matrix and lets an admin switch any module on or off per role. The saved
// matrix lives in settings.roleModules; anything missing falls back to DEFAULTS below.

const MODULES = [
  { key: 'dashboard',        label: 'Dashboard',          route: '#/dashboard',        group: 'Operations' },
  { key: 'shipments',        label: 'Shipments',          route: '#/shipments',        group: 'Operations' },
  { key: 'box_orders',       label: 'Box Orders',         route: '#/box-orders',       group: 'Operations' },
  { key: 'boxes',            label: 'Boxes',              route: '#/boxes',            group: 'Operations' },
  { key: 'containers',       label: 'Containers',         route: '#/containers',       group: 'Operations' },
  { key: 'origin_warehouse', label: 'Origin Warehouse',   route: '#/origin-warehouse', group: 'Operations' },
  { key: 'ph_warehouse',     label: 'PH Warehouse',       route: '#/warehouse',        group: 'Operations' },
  { key: 'trips',            label: 'Trips',              route: '#/trips',            group: 'Operations' },
  { key: 'returns',          label: 'Returns',            route: '#/returns',          group: 'Operations' },
  { key: 'customers',        label: 'Customers',          route: '#/customers',        group: 'People & Comms' },
  { key: 'sms',              label: 'SMS',                route: '#/notifications',    group: 'People & Comms' },
  { key: 'reports',          label: 'Reports',            route: '#/reports',          group: 'People & Comms' },
  { key: 'accounting',       label: 'Accounting',         route: '#/accounting',       group: 'People & Comms' },
  { key: 'developer',        label: 'Developer Console',  route: '#/developer',        group: 'System' },
  { key: 'scan',             label: 'Scan',               route: '#/scan',             group: 'System' },
  { key: 'admin',            label: 'Admin',              route: '#/admin',            group: 'System' }
];

const MODULE_KEYS = MODULES.map(m => m.key);
const MODULE_LABELS = Object.fromEntries(MODULES.map(m => [m.key, m.label]));

const ALL = MODULE_KEYS.slice();
const ALL_BUSINESS = MODULE_KEYS.filter(k => k !== 'developer'); // everything except the dev console
const SHIPPER_MODULES = ['dashboard', 'shipments', 'box_orders', 'boxes', 'containers', 'origin_warehouse', 'customers', 'sms', 'reports', 'scan'];
// A branch admin runs their own branch end to end — including their own staff (admin) and
// their own numbers (accounting) — but never the cross-branch Branches & Partners view.
const BRANCH_ADMIN_MODULES = [...SHIPPER_MODULES, 'accounting', 'admin'];

// Starting matrix. Admins can change any of this except that an admin role always keeps
// access to `admin` (otherwise nobody could edit permissions again).
const DEFAULTS = {
  DEVELOPER_ADMIN: ALL,
  MASTER_ADMIN: ALL_BUSINESS,
  BRANCH_ADMIN_TH: BRANCH_ADMIN_MODULES,
  BRANCH_ADMIN_KH: BRANCH_ADMIN_MODULES,
  SHIPPER_AGENT_TH: SHIPPER_MODULES,
  SHIPPER_AGENT_KH: SHIPPER_MODULES,
  CONSIGNEE_AGENT: ['dashboard', 'shipments', 'box_orders', 'boxes', 'containers', 'ph_warehouse', 'trips', 'returns', 'customers', 'sms', 'reports', 'scan'],
  WAREHOUSE: ['dashboard', 'boxes', 'ph_warehouse', 'scan'],
  ACCOUNTING: ['dashboard', 'accounting', 'reports', 'shipments', 'box_orders']
};

// Modules a role can never lose, so the system stays administrable.
const LOCKED = {
  DEVELOPER_ADMIN: ['admin', 'developer'], MASTER_ADMIN: ['admin'],
  BRANCH_ADMIN_TH: ['admin'], BRANCH_ADMIN_KH: ['admin']
};

function defaultsFor(role) { return (DEFAULTS[role] || ['dashboard']).slice(); }

// Resolve the effective module list for a role from saved settings + defaults + locks.
function modulesForRole(role, saved) {
  const stored = saved && Array.isArray(saved[role]) ? saved[role] : null;
  const base = stored ? stored.filter(k => MODULE_KEYS.includes(k)) : defaultsFor(role);
  const locked = LOCKED[role] || [];
  return [...new Set([...base, ...locked])];
}

// Full matrix for every known role.
function matrix(roleKeys, saved) {
  return Object.fromEntries(roleKeys.map(r => [r, modulesForRole(r, saved)]));
}

function canUseModule(role, moduleKey, saved) {
  return modulesForRole(role, saved).includes(moduleKey);
}

module.exports = { MODULES, MODULE_KEYS, MODULE_LABELS, DEFAULTS, LOCKED, defaultsFor, modulesForRole, matrix, canUseModule };
