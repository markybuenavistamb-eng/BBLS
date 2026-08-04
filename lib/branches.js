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

const BRANCH_KEYS = BRANCHES.map(b => b.key);
const BRANCH_LABELS = Object.fromEntries(BRANCHES.map(b => [b.key, b.label]));
const byCountry = (country) => BRANCHES.find(b => b.country === country) || null;
const byKey = (key) => BRANCHES.find(b => b.key === key) || null;

// Which branch a role belongs to. null = sees every branch (admins).
const ROLE_BRANCH = {
  SHIPPER_AGENT_TH: 'TH_BANGKOK',
  SHIPPER_AGENT_KH: 'KH_PHNOMPENH',
  CONSIGNEE_AGENT: 'HQ_MANILA',
  WAREHOUSE: 'HQ_MANILA'
};
const branchForRole = (role) => ROLE_BRANCH[role] || null;

// Only these roles get the cross-branch consolidated view.
const seesAllBranches = (role) => ['DEVELOPER_ADMIN', 'MASTER_ADMIN'].includes(role);

// Merge the seeded definition with whatever the admin has edited (stored in settings).
function resolve(saved) {
  const overrides = saved && typeof saved === 'object' ? saved : {};
  return BRANCHES.map(b => ({ ...b, ...(overrides[b.key] || {}), key: b.key, type: b.type, country: b.country }));
}

module.exports = {
  BRANCHES, BRANCH_KEYS, BRANCH_LABELS, ROLE_BRANCH,
  byCountry, byKey, branchForRole, seesAllBranches, resolve
};
