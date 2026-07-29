// The 17 official PSGC administrative regions of the Philippines.
// Source: PhilAtlas / PSA (https://www.philatlas.com/regions.html).
// This is the single canonical region taxonomy used across every module —
// intake → warehouse segregation → trucking dispatch → reports → public tracking —
// so all modules stay synchronized on one list.

const REGIONS = [
  { code: 'NCR',      short: 'Metro Manila (NCR)',   label: 'NCR – National Capital Region',            island: 'Luzon' },
  { code: 'CAR',      short: 'Cordillera (CAR)',     label: 'CAR – Cordillera Administrative Region',   island: 'Luzon' },
  { code: 'R1',       short: 'Ilocos Region',        label: 'Region I – Ilocos Region',                 island: 'Luzon' },
  { code: 'R2',       short: 'Cagayan Valley',       label: 'Region II – Cagayan Valley',               island: 'Luzon' },
  { code: 'R3',       short: 'Central Luzon',        label: 'Region III – Central Luzon',               island: 'Luzon' },
  { code: 'R4A',      short: 'CALABARZON',           label: 'Region IV-A – CALABARZON',                 island: 'Luzon' },
  { code: 'MIMAROPA', short: 'MIMAROPA',             label: 'MIMAROPA (Region IV-B)',                   island: 'Luzon' },
  { code: 'R5',       short: 'Bicol Region',         label: 'Region V – Bicol Region',                  island: 'Luzon' },
  { code: 'R6',       short: 'Western Visayas',      label: 'Region VI – Western Visayas',              island: 'Visayas' },
  { code: 'R7',       short: 'Central Visayas',      label: 'Region VII – Central Visayas',             island: 'Visayas' },
  { code: 'R8',       short: 'Eastern Visayas',      label: 'Region VIII – Eastern Visayas',            island: 'Visayas' },
  { code: 'R9',       short: 'Zamboanga Peninsula',  label: 'Region IX – Zamboanga Peninsula',          island: 'Mindanao' },
  { code: 'R10',      short: 'Northern Mindanao',    label: 'Region X – Northern Mindanao',             island: 'Mindanao' },
  { code: 'R11',      short: 'Davao Region',         label: 'Region XI – Davao Region',                 island: 'Mindanao' },
  { code: 'R12',      short: 'SOCCSKSARGEN',         label: 'Region XII – SOCCSKSARGEN',                island: 'Mindanao' },
  { code: 'R13',      short: 'Caraga',               label: 'Region XIII – Caraga',                     island: 'Mindanao' },
  { code: 'BARMM',    short: 'BARMM',                label: 'BARMM – Bangsamoro',                       island: 'Mindanao' }
];

const CODES = REGIONS.map(r => r.code);
const LABELS = Object.fromEntries(REGIONS.map(r => [r.code, r.label]));
const SHORT = Object.fromEntries(REGIONS.map(r => [r.code, r.short]));
const ISLAND = Object.fromEntries(REGIONS.map(r => [r.code, r.island]));
const ISLAND_GROUPS = ['Luzon', 'Visayas', 'Mindanao'];

// Map a PSGC region *name* (as returned by the address cascade) to its region code.
function mapPsgcRegion(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return null;
  if (n.includes('national capital') || /\bncr\b/.test(n)) return 'NCR';
  if (n.includes('cordillera') || /\bcar\b/.test(n)) return 'CAR';
  if (n.includes('ilocos')) return 'R1';
  if (n.includes('cagayan valley')) return 'R2';
  if (n.includes('central luzon')) return 'R3';
  if (n.includes('calabarzon') || n.includes('iv-a') || n.includes('iv a')) return 'R4A';
  if (n.includes('mimaropa') || n.includes('iv-b')) return 'MIMAROPA';
  if (n.includes('bicol')) return 'R5';
  if (n.includes('western visayas')) return 'R6';
  if (n.includes('central visayas')) return 'R7';
  if (n.includes('eastern visayas')) return 'R8';
  if (n.includes('zamboanga')) return 'R9';
  if (n.includes('northern mindanao')) return 'R10';
  if (n.includes('davao')) return 'R11';
  if (n.includes('soccsksargen') || n.includes('cotabato')) return 'R12';
  if (n.includes('caraga')) return 'R13';
  if (n.includes('bangsamoro') || n.includes('barmm') || n.includes('muslim mindanao')) return 'BARMM';
  // island-group fallbacks for coarse inputs
  if (n.includes('visayas')) return 'R7';
  if (n.includes('mindanao')) return 'R10';
  if (n.includes('luzon')) return 'R3';
  return null;
}

module.exports = { REGIONS, CODES, LABELS, SHORT, ISLAND, ISLAND_GROUPS, mapPsgcRegion };
