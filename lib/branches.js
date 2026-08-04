// Branches / business partners.
//
// VFIC's origin operations in Thailand and Cambodia run as independent business partners
// (vendors): each has its own staff, its own warehouse and its own book of shipments, but
// everything settles back to the Manila head office. A branch's staff only ever see their
// own operation — only a Master Admin (or Developer Admin) sees across all of them.

const BRANCHES = [
  {
    key: 'HQ_MANILA', label: 'VFIC Head Office — Manila', short: 'Manila HQ',
    country: 'Philippines', type: 'HQ',
    partner_name: 'Victors Freight International Corporation',
    address: 'Rm. 205 Sitio Grande Bldg., 409 A. Soriano Ave., Intramuros, Manila 1002',
    contact: '+63 2 84255264', email: 'info@victorsfreight.ph',
    tax_id: '', commission_pct: 0, settlement_terms: 'n/a — head office'
  },
  {
    key: 'TH_BANGKOK', label: 'VFIC Thailand — Bangkok', short: 'Thailand',
    country: 'Thailand', type: 'PARTNER',
    partner_name: '', address: '', contact: '', email: '',
    tax_id: '', commission_pct: 0, settlement_terms: 'Net 30 after container arrival'
  },
  {
    key: 'KH_PHNOMPENH', label: 'VFIC Cambodia — Phnom Penh', short: 'Cambodia',
    country: 'Cambodia', type: 'PARTNER',
    partner_name: '', address: '', contact: '', email: '',
    tax_id: '', commission_pct: 0, settlement_terms: 'Net 30 after container arrival'
  }
];

// ISO-style country code used as the prefix of every shipment / box number, so a box's
// origin is readable straight off its ID (e.g. TH-2026-000013-01).
const COUNTRY_CODES = { Thailand: 'TH', Cambodia: 'KH', Philippines: 'PH' };
const DEFAULT_CODE = 'VF';
const countryCode = (country) => COUNTRY_CODES[String(country || '').trim()] || DEFAULT_CODE;

const BRANCH_KEYS = BRANCHES.map(b => b.key);
const BRANCH_LABELS = Object.fromEntries(BRANCHES.map(b => [b.key, b.label]));
const byCountry = (country) => BRANCHES.find(b => b.country === country) || null;
const byKey = (key) => BRANCHES.find(b => b.key === key) || null;

// Which branch a role belongs to. null = sees every branch (HQ admins).
const ROLE_BRANCH = {
  BRANCH_ADMIN_TH: 'TH_BANGKOK',
  SHIPPER_AGENT_TH: 'TH_BANGKOK',
  BRANCH_ADMIN_KH: 'KH_PHNOMPENH',
  SHIPPER_AGENT_KH: 'KH_PHNOMPENH',
  CONSIGNEE_AGENT: 'HQ_MANILA',
  WAREHOUSE: 'HQ_MANILA'
};
const branchForRole = (role) => ROLE_BRANCH[role] || null;

// Only these roles get the cross-branch consolidated view.
const seesAllBranches = (role) => ['DEVELOPER_ADMIN', 'MASTER_ADMIN'].includes(role);

// ---- branch portals ----
// Each branch signs in at its own URL. The portal is only an entry point + branding: all
// branches write into the one VFIC system, so Manila HQ always sees the consolidated picture.
const PORTALS = {
  th: { branch: 'TH_BANGKOK', slug: 'th', name: 'VFIC Thailand', city: 'Bangkok', flag: '🇹🇭', accent: '#c8102e' },
  kh: { branch: 'KH_PHNOMPENH', slug: 'kh', name: 'VFIC Cambodia', city: 'Phnom Penh', flag: '🇰🇭', accent: '#032ea1' },
  mnl: { branch: 'HQ_MANILA', slug: 'mnl', name: 'VFIC Head Office', city: 'Manila', flag: '🇵🇭', accent: '#F0531C' }
};
const portalBySlug = (slug) => PORTALS[String(slug || '').toLowerCase()] || null;
const portalForBranch = (branchKey) => Object.values(PORTALS).find(p => p.branch === branchKey) || null;

// May a user with this role sign in at this portal?
// HQ admins can sign in anywhere (they oversee every branch); everyone else must match.
function roleAllowedAtPortal(role, slug) {
  const portal = portalBySlug(slug);
  if (!portal) return true;                       // main staff login — no branch restriction
  if (seesAllBranches(role)) return true;
  return branchForRole(role) === portal.branch;
}

// Merge the seeded definition with whatever the admin has edited (stored in settings).
function resolve(saved) {
  const overrides = saved && typeof saved === 'object' ? saved : {};
  return BRANCHES.map(b => ({ ...b, ...(overrides[b.key] || {}), key: b.key, type: b.type, country: b.country }));
}

module.exports = {
  BRANCHES, BRANCH_KEYS, BRANCH_LABELS, ROLE_BRANCH, PORTALS,
  COUNTRY_CODES, DEFAULT_CODE, countryCode,
  byCountry, byKey, branchForRole, seesAllBranches, resolve,
  portalBySlug, portalForBranch, roleAllowedAtPortal
};
