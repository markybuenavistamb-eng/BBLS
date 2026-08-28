/* VFIC Box Operations — staff single-page app (demo) */
let ME = null;
let scanner = null;

const STATUS_LABELS_EN = {
  CREATED: 'Created', PICKED_UP: 'Picked up from sender', RECEIVED_BRANCH: 'Received (branch office)', RECEIVED_ORIGIN: 'Received (origin WH)',
  LOADED_CONTAINER: 'Loaded in container',
  IN_TRANSIT: 'In transit', ARRIVED_PORT: 'Arrived (PH port)', RECEIVED_WAREHOUSE: 'Received (warehouse)',
  SORTED: 'Sorted', ASSIGNED: 'Assigned to trip', LOADED_TRUCK: 'Loaded on truck',
  OUT_FOR_DELIVERY: 'Out for delivery', DELIVERED: 'Delivered', RETURNED: 'Returned', CANCELLED: 'Cancelled'
};
// Language-aware view over the labels: every existing STATUS_LABELS[x] lookup auto-translates.
const STATUS_LABELS = new Proxy(STATUS_LABELS_EN, {
  get: (tgt, k) => (typeof k === 'string' && tgt[k] != null) ? VI.t('status.' + k, tgt[k]) : tgt[k]
});
const PIPELINE = ['CREATED', 'PICKED_UP', 'RECEIVED_BRANCH', 'RECEIVED_ORIGIN', 'LOADED_CONTAINER', 'IN_TRANSIT', 'ARRIVED_PORT',
  'RECEIVED_WAREHOUSE', 'SORTED', 'ASSIGNED', 'LOADED_TRUCK', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED', 'CANCELLED'];
const NEXT_STATUS = {
  // Note: LOADED_CONTAINER → IN_TRANSIT is deliberately NOT a manual action — a box goes
  // In-Transit only when its container is marked Departed. 'RECEIVED_ORIGIN' here = unload.
  // A box is booked in at the branch counter, then trucked to the origin warehouse. Both are
  // offered from Created because a sender who walks straight to the warehouse skips the first,
  // and forcing a step that did not happen would put a lie in the timeline.
  CREATED: ['PICKED_UP', 'RECEIVED_BRANCH', 'RECEIVED_ORIGIN'],
  PICKED_UP: ['RECEIVED_BRANCH', 'RECEIVED_ORIGIN'],
  RECEIVED_BRANCH: ['RECEIVED_ORIGIN'],
  RECEIVED_ORIGIN: ['LOADED_CONTAINER'], LOADED_CONTAINER: ['RECEIVED_ORIGIN'],
  IN_TRANSIT: ['ARRIVED_PORT'], ARRIVED_PORT: ['RECEIVED_WAREHOUSE'], RECEIVED_WAREHOUSE: ['SORTED'],
  SORTED: ['ASSIGNED'], ASSIGNED: ['LOADED_TRUCK', 'SORTED'], LOADED_TRUCK: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'RETURNED'], RETURNED: ['ASSIGNED'], DELIVERED: [], CANCELLED: []
};
const CONTAINER_SIZE_LABELS = { C20: '20 ft', C40: '40 ft', C40HQ: '40 ft HQ' };
const CONTAINER_SIZE_KEYS = ['C20', 'C40', 'C40HQ'];
// The 17 official PSGC regions — the single region taxonomy shared by warehouse
// segregation, trucking dispatch, reports and public tracking (mirrors lib/regions.js).
const REGION_DEFS = [
  { code: 'NCR', short: 'Metro Manila (NCR)', label: 'NCR – National Capital Region', island: 'Luzon' },
  { code: 'CAR', short: 'Cordillera (CAR)', label: 'CAR – Cordillera Administrative Region', island: 'Luzon' },
  { code: 'R1', short: 'Ilocos Region', label: 'Region I – Ilocos Region', island: 'Luzon' },
  { code: 'R2', short: 'Cagayan Valley', label: 'Region II – Cagayan Valley', island: 'Luzon' },
  { code: 'R3', short: 'Central Luzon', label: 'Region III – Central Luzon', island: 'Luzon' },
  { code: 'R4A', short: 'CALABARZON', label: 'Region IV-A – CALABARZON', island: 'Luzon' },
  { code: 'MIMAROPA', short: 'MIMAROPA', label: 'MIMAROPA (Region IV-B)', island: 'Luzon' },
  { code: 'R5', short: 'Bicol Region', label: 'Region V – Bicol Region', island: 'Luzon' },
  { code: 'R6', short: 'Western Visayas', label: 'Region VI – Western Visayas', island: 'Visayas' },
  { code: 'R7', short: 'Central Visayas', label: 'Region VII – Central Visayas', island: 'Visayas' },
  { code: 'R8', short: 'Eastern Visayas', label: 'Region VIII – Eastern Visayas', island: 'Visayas' },
  { code: 'R9', short: 'Zamboanga Peninsula', label: 'Region IX – Zamboanga Peninsula', island: 'Mindanao' },
  { code: 'R10', short: 'Northern Mindanao', label: 'Region X – Northern Mindanao', island: 'Mindanao' },
  { code: 'R11', short: 'Davao Region', label: 'Region XI – Davao Region', island: 'Mindanao' },
  { code: 'R12', short: 'SOCCSKSARGEN', label: 'Region XII – SOCCSKSARGEN', island: 'Mindanao' },
  { code: 'R13', short: 'Caraga', label: 'Region XIII – Caraga', island: 'Mindanao' },
  { code: 'BARMM', short: 'BARMM', label: 'BARMM – Bangsamoro', island: 'Mindanao' }
];
const REGIONS = REGION_DEFS.map(r => r.code);
const REGION_LABELS = Object.fromEntries(REGION_DEFS.map(r => [r.code, r.label]));
// <option> list grouped by island (Luzon / Visayas / Mindanao) for the sort & dispatch pickers.
function regionOptions(selected) {
  return ['Luzon', 'Visayas', 'Mindanao'].map(grp =>
    `<optgroup label="${grp}">` +
    REGION_DEFS.filter(r => r.island === grp)
      .map(r => `<option value="${r.code}"${r.code === selected ? ' selected' : ''}>${esc(r.label)}</option>`).join('') +
    `</optgroup>`).join('');
}
// Box-size catalogue — loaded once from /api/box-sizes so the staff app, booking form and
// printed documents all share one source of truth. Fallback mirrors lib/boxsizes.js.
let BOX_SIZE_CATALOG = [
  { key: 'SMALL', label: 'Small', dimensions: '55 x 55 x 40 cm', standard_weight_kg: 50, cbm: 0.121 },
  { key: 'MEDIUM', label: 'Medium', dimensions: '55 x 55 x 60 cm', standard_weight_kg: 60, cbm: 0.1815 },
  { key: 'LARGE', label: 'Large', dimensions: '55 x 55 x 75 cm', standard_weight_kg: 70, cbm: 0.2269 },
  { key: 'GIGA', label: 'Giga Box', dimensions: '55 x 55 x 105 cm', standard_weight_kg: 80, cbm: 0.3176 }
];
const SIZES = () => BOX_SIZE_CATALOG.map(s => s.key);
async function loadBoxSizeCatalog() {
  try {
    const d = await api('/api/box-sizes');
    if (Array.isArray(d.sizes) && d.sizes.length) BOX_SIZE_CATALOG = d.sizes;
  } catch (e) { /* keep fallback */ }
}
function sizeSelectOptions(selected) {
  return BOX_SIZE_CATALOG.map(s =>
    `<option value="${esc(s.key)}"${s.key === (selected || 'LARGE') ? ' selected' : ''}>${esc(s.label)} — ${esc(s.dimensions)}, up to ${s.standard_weight_kg} kg</option>`).join('');
}
const SERVICE_TYPES_EN = { DOOR_TO_DOOR: 'Door to Door', PORT_TO_PORT: 'Port to Port', DOOR_TO_PORT: 'Door to Port', DOOR_TO_AIRPORT: 'Door to Airport' };
const SERVICE_TYPES = new Proxy(SERVICE_TYPES_EN, {
  get: (tgt, k) => (typeof k === 'string' && tgt[k] != null) ? VI.t('service.' + k, tgt[k]) : tgt[k]
});
// Service level = freight product chosen at booking.
const SERVICE_LEVELS = ['OCEAN_ECONOMY', 'OCEAN_PRIORITY', 'EXPRESS_AIR'];
const SERVICE_LEVEL_LABELS = { OCEAN_ECONOMY: 'Ocean Economy', OCEAN_PRIORITY: 'Ocean Priority', EXPRESS_AIR: 'Express Air' };
const svcLevelLabel = (s) => SERVICE_LEVEL_LABELS[s && s.service_level] || (s && s.service_level) || (SERVICE_TYPES[s && s.service_type] || (s && s.service_type) || '—');
const COLLECTION_LABELS = { PICKUP: 'Pick-up from sender', DROPOFF: 'Drop-off at office' };
const FAILURE_REASONS = { UNREACHABLE: 'Receiver unreachable by phone', ADDRESS_NOT_FOUND: 'Address not found', RECEIVER_ABSENT: 'Receiver absent', REFUSED: 'Delivery refused', OTHER: 'Other' };

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
}
function fmtDay(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' });
}
function ageDays(iso) { return iso ? Math.floor((Date.now() - new Date(iso)) / 86400000) : 0; }
function badge(status) {
  const cls = 'st-' + String(status).toLowerCase();
  return `<span class="badge ${cls}">${esc(STATUS_LABELS[status] || String(status).replace(/_/g, ' '))}</span>`;
}
function payBadge(p) { return `<span class="badge pay-${esc(String(p).toLowerCase())}">${esc(p)}</span>`; }
function regionBadge(r) { return r ? `<span class="badge st-sorted">${esc(REGION_LABELS[r] || r)}</span>` : '<span class="muted">—</span>'; }
// Whether the branch collects the boxes or the sender brings them in. The words are the ones
// staff use out loud, and the van says at a glance which shipments are somebody's errand today.
// Mirrors the roles the endpoint allows, so the button is not offered to someone it would refuse.
// The branch counter and head office count this stock; Manila's warehouse and delivery staff have
// nothing to do with a box that has not left Bangkok yet.
// Which truck went out. The plate is what a guard at a gate, a customer on the phone, or a
// police report actually refers to, so it leads; the hauler underneath matters when the run is
// subcontracted and someone has to be rung about it.
function truckDetails(pass) {
  const plate = pass.plate_number || '';
  const company = pass.trucking_company || '';
  if (!plate && !company) return '<span class="muted">Not recorded</span>';
  return `${plate ? `<b>${esc(plate)}</b>` : '<span class="muted">No plate</span>'}
    ${company ? `<div class="muted" style="font-size:11px">${esc(company)}</div>` : ''}`;
}

// Where a driver's van has got to, and — just as important — how long ago that was. A position
// with no age on it is worse than none: half an hour later it still looks like the answer. The
// link opens the point in a map rather than embedding one, so no page here loads a third party.
function whereabouts(pass) {
  const loc = pass.last_location;
  if (pass.state !== 'ACTIVE') return '<span class="muted">—</span>';
  if (!loc) return '<span class="muted" title="The driver has not shared a location. It is optional and the run works without it.">Not shared</span>';
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(loc.at)) / 60000));
  const ago = mins < 1 ? 'just now' : mins < 60 ? mins + ' min ago'
    : Math.floor(mins / 60) + ' hr ' + (mins % 60) + ' min ago';
  // Anything older than a quarter of an hour is stale enough to be worth doubting.
  const stale = mins > 15;
  return `<a href="https://www.google.com/maps?q=${loc.lat},${loc.lng}" target="_blank" rel="noopener noreferrer">📍 On the map</a>
    <div class="muted" style="font-size:11px${stale ? ';font-weight:700' : ''}">${esc(ago)}${loc.accuracy_m ? ' · ±' + loc.accuracy_m + ' m' : ''}</div>`;
}

const canSeeBranchStock = () =>
  !!ME && R_ADMINS.concat(R_BRANCH_ADMINS, R_SHIPPERS).includes(ME.role);
function collectionBadge(c) {
  if (c === 'PICKUP') return '<span class="badge col-pickup">🚚 Pick-up</span>';
  if (c === 'DROPOFF') return '<span class="badge col-dropoff">🏢 Drop-off</span>';
  return '<span class="muted">Not stated</span>';
}

// Endpoints that can be narrowed to a single branch. When head office is viewing a branch
// block in the sidebar (#/shipments?branch=TH_BANGKOK), the filter rides along automatically.
const BRANCH_FILTERABLE = ['/api/shipments', '/api/boxes', '/api/containers', '/api/intake-requests', '/api/origin-warehouse', '/api/branch-office', '/api/accounting/pnl'];
function withBranchFilter(path) {
  const branch = new URLSearchParams(location.hash.split('?')[1] || '').get('branch');
  if (!branch) return path;
  const base = path.split('?')[0];
  if (!BRANCH_FILTERABLE.includes(base)) return path;
  return path + (path.includes('?') ? '&' : '?') + 'branch=' + encodeURIComponent(branch);
}
async function api(path, opts = {}) {
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    opts.body = JSON.stringify(opts.body);
  }
  if (!opts.method || opts.method === 'GET') path = withBranchFilter(path);
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON */ }
  // The account was opened somewhere else, so this session is no longer the one holding it.
  // Saying so beats every screen quietly turning into "Not logged in" with no explanation.
  if (res.status === 401 && ME && path !== '/api/login') {
    ME = null;
    renderLogin();
    const err = document.getElementById('lgErr');
    if (err) err.textContent = 'You have been signed out — this account was opened somewhere else.';
    throw Object.assign(new Error('Signed out'), { status: 401, handled: true });
  }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `Request failed (${res.status})`;
    throw Object.assign(new Error(msg), { status: res.status, data });
  }
  return data;
}

// Banner shown to head office when a page is narrowed to one branch.
function branchBanner() {
  const key = new URLSearchParams(location.hash.split('?')[1] || '').get('branch');
  if (!key || !MY || !MY.sees_all_branches) return '';
  const b = (MY.branches || []).find(x => x.key === key);
  if (!b) return '';
  const route = location.hash.split('?')[0];
  return `<div class="branch-banner">
    <span>${esc(b.flag || '')} Viewing <b>${esc(b.label)}</b> only</span>
    <a href="${route}">Show all branches ✕</a></div>`;
}
// Our own trail of pages visited inside the portal. The browser's history can hold entries
// from before the app was opened, so Back walks this stack instead — it can never leave.
// (The app's own hashchange listener re-renders, so goBack only has to set the hash.)
const NAV_STACK = [];
let NAV_PREV = location.hash || '#/dashboard';
let NAV_GOING_BACK = false;
window.addEventListener('hashchange', () => {
  if (NAV_GOING_BACK) NAV_GOING_BACK = false;
  else if (NAV_PREV !== location.hash) {
    NAV_STACK.push(NAV_PREV);
    if (NAV_STACK.length > 50) NAV_STACK.shift();
  }
  NAV_PREV = location.hash;
});
function goBack() {
  const to = NAV_STACK.pop() || '#/dashboard';
  if (location.hash === to) { route(); return; }
  NAV_GOING_BACK = true;
  location.hash = to;
}
// A Back control shown on every page except the dashboard, which is the root.
function backBar() {
  const hash = location.hash || '#/dashboard';
  if (hash.startsWith('#/dashboard') || hash === '#/' || hash === '') return '';
  return `<div class="back-bar no-print"><button class="secondary small" onclick="goBack()">← ${esc(VI.t('nav.back'))}</button></div>`;
}
function view(html) {
  stopScanner();
  document.getElementById('view2').innerHTML = backBar() + branchBanner() + html;
  watchTables();
  enhanceTables(document.getElementById('view2'));
}
/* ---------- filter + sort, added to every list table ---------- */
// Sorting reads the rendered cell, so it has to work out what a column actually holds. A
// column of "PHP 1,234.56" sorts as money, "Aug 12, 2026" as a date, and "TH-2026-000001"
// as text — that last one matters, because stripping its letters leaves something that
// looks numeric but is not a number.
const DATEISH = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i;
const ISOISH = /^\d{4}-\d{2}-\d{2}/;

function cellText(td) { return (td ? td.textContent : '').replace(/\s+/g, ' ').trim(); }

function asNumber(text) {
  if (!text || text === '—') return NaN;
  // Normalise the typographic minus used in the P&L before anything else.
  const t = text.replace(/[\u2212\u2013]/g, '-').replace(/[A-Za-z\s,]/g, '');
  if (!/^-?\d*\.?\d+$/.test(t)) return NaN;
  return Number(t);
}
function asDate(text) {
  if (!text || text === '—') return NaN;
  if (!DATEISH.test(text) && !ISOISH.test(text) && !/^\d{1,2}\/\d{1,2}\//.test(text)) return NaN;
  const v = Date.parse(text);
  return Number.isNaN(v) ? NaN : v;
}
const MONEYISH = /^[\u2212-]?\s*([A-Z]{3})\s*[\u2212-]?[\d,]/;
function currencyOf(text) { const m = MONEYISH.exec(text || ''); return m ? m[1] : null; }

// Decide a column's type from the values actually in it, not from its heading.
function columnType(rows, idx) {
  let num = 0, date = 0, money = 0, seen = 0;
  const codes = new Set();
  for (const r of rows) {
    const t = cellText(r.cells[idx]);
    if (!t || t === '—') continue;
    seen += 1;
    const ccy = currencyOf(t);
    if (ccy && !Number.isNaN(asNumber(t))) { money += 1; codes.add(ccy); }
    if (!Number.isNaN(asNumber(t))) num += 1;
    else if (!Number.isNaN(asDate(t))) date += 1;
  }
  if (!seen) return 'text';
  // Only worth treating as money when more than one currency is actually present —
  // a single-currency column sorts identically either way.
  if (money / seen >= 0.6 && codes.size > 1) return 'money';
  if (num / seen >= 0.6) return 'number';
  if (date / seen >= 0.6) return 'date';
  return 'text';
}
function sortValue(row, idx, type) {
  const t = cellText(row.cells[idx]);
  if (type === 'money') {
    const n = asNumber(t), ccy = currencyOf(t);
    return (Number.isNaN(n) || !ccy) ? null : [ccy, n];
  }
  if (type === 'number') { const n = asNumber(t); return Number.isNaN(n) ? null : n; }
  if (type === 'date') { const d = asDate(t); return Number.isNaN(d) ? null : d; }
  return t ? t.toLowerCase() : null;
}
// Money sorts on a pair, everything else on a scalar.
function cmpValues(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

// A table on a phone is a row you read a quarter of at a time. Rather than shrink it, each
// row becomes a card and every cell carries its column name — the heading moves next to the
// value instead of sitting a screen and a half away at the top.
//
// The labels are stamped here, in markup, so the same table serves both layouts and no page
// has to know which one it is in.
function labelCellsForCards(table) {
  const all = Array.from(table.rows);
  const head = all.find(r => r.querySelector('th'));
  if (!head) return;
  head.classList.add('tbl-head-row');
  const labels = Array.from(head.cells).map(c => (c.textContent || '').replace(/\s+/g, ' ').trim());
  for (const row of all) {
    if (row === head) continue;
    // A row spanning the table is a placeholder, not a record; it reads fine as it is.
    if (row.querySelector('[colspan]')) { row.classList.add('tbl-filler-row'); continue; }
    Array.from(row.cells).forEach((td, i) => {
      if (!td.hasAttribute('data-label')) td.setAttribute('data-label', labels[i] || '');
    });
  }
  table.classList.add('as-cards');
}

function enhanceTables(root) {
  (root || document).querySelectorAll('.table-scroll table').forEach(table => {
    if (table.closest('.receipt, .boc-page, .no-tools')) return;   // printed documents keep their shape
    if (table.classList.contains('rc-table')) return;

    // Card labels go on every list, however short — the toolbar below has its own thresholds.
    if (!table.dataset.carded) { table.dataset.carded = '1'; labelCellsForCards(table); }

    if (table.dataset.tools) return;                       // already wired

    const all = Array.from(table.rows);
    const head = all.find(r => r.querySelector('th'));
    if (!head) return;
    const heads = Array.from(head.cells);
    // Rows spanning the table are placeholders ("No shipments"), not data.
    const body = all.filter(r => r !== head && !r.querySelector('[colspan]'));
    const filler = all.filter(r => r !== head && r.querySelector('[colspan]'));
    if (heads.length < 3 || body.length < 3) return;
    table.dataset.tools = '1';

    body.forEach((r, i) => { r.dataset.i = i; });
    const types = heads.map((_, i) => columnType(body, i));

    const tools = document.createElement('div');
    tools.className = 'tbl-tools no-print';
    tools.innerHTML = `
      <input class="tbl-filter" type="search" placeholder="Filter ${body.length} rows…" aria-label="Filter rows">
      <label class="tbl-lbl">Sort by</label>
      <select class="tbl-sort" aria-label="Sort by">
        <option value="">As listed</option>
        ${heads.map((th, i) => `<option value="${i}">${esc(cellText(th))}</option>`).join('')}
      </select>
      <button type="button" class="tbl-dir secondary small" title="Ascending / descending">↑</button>
      <span class="tbl-count muted"></span>
      <button type="button" class="tbl-clear small secondary" hidden>Clear</button>`;
    table.parentElement.insertBefore(tools, table);

    const $ = (sel) => tools.querySelector(sel);
    const state = { col: '', dir: 1 };

    function apply() {
      const terms = $('.tbl-filter').value.toLowerCase().split(/\s+/).filter(Boolean);
      let shown = 0;
      for (const r of body) {
        const hay = r.textContent.toLowerCase();
        const ok = terms.every(t => hay.includes(t));
        r.style.display = ok ? '' : 'none';
        if (ok) shown += 1;
      }
      // The placeholder row belongs to an empty table, not to a filtered-out one.
      for (const r of filler) r.style.display = terms.length ? 'none' : '';

      const ordered = body.slice();
      if (state.col !== '') {
        const idx = Number(state.col), type = types[idx];
        ordered.sort((a, b) => {
          const va = sortValue(a, idx, type), vb = sortValue(b, idx, type);
          // Blanks sort last whichever way the column is pointing.
          if (va === null && vb === null) return Number(a.dataset.i) - Number(b.dataset.i);
          if (va === null) return 1;
          if (vb === null) return -1;
          const c = cmpValues(va, vb);
          if (c) return c * state.dir;
          return Number(a.dataset.i) - Number(b.dataset.i);   // stable
        });
      } else {
        ordered.sort((a, b) => Number(a.dataset.i) - Number(b.dataset.i));
      }
      const parent = body[0].parentElement;
      for (const r of ordered) parent.appendChild(r);
      for (const r of filler) parent.appendChild(r);

      const active = terms.length || state.col !== '';
      $('.tbl-count').textContent = terms.length ? `showing ${shown} of ${body.length}` : '';
      $('.tbl-clear').hidden = !active;
      $('.tbl-dir').textContent = state.dir === 1 ? '↑' : '↓';
      $('.tbl-dir').disabled = state.col === '';
      heads.forEach((th, i) => {
        th.classList.toggle('sorted', String(i) === String(state.col));
        th.dataset.dir = String(i) === String(state.col) ? (state.dir === 1 ? 'asc' : 'desc') : '';
      });
    }

    $('.tbl-filter').addEventListener('input', apply);
    $('.tbl-sort').addEventListener('change', e => { state.col = e.target.value; apply(); });
    $('.tbl-dir').addEventListener('click', () => { state.dir = -state.dir; apply(); });
    $('.tbl-clear').addEventListener('click', () => {
      $('.tbl-filter').value = ''; $('.tbl-sort').value = ''; state.col = ''; state.dir = 1; apply();
    });
    // Clicking a heading is the quicker way in: first click sorts, next click reverses.
    heads.forEach((th, i) => {
      th.classList.add('sortable');
      th.addEventListener('click', () => {
        if (String(state.col) === String(i)) state.dir = -state.dir;
        else { state.col = String(i); state.dir = 1; }
        $('.tbl-sort').value = state.col;
        apply();
      });
    });
    apply();
  });
}

// Tables also arrive after the initial render — a P&L drill-down, a reloaded sort list — so
// watch the view rather than relying on every caller to remember. The data-tools flag makes
// re-running cheap and stops the observer from reacting to its own toolbars.
let tblTimer = null;
function watchTables() {
  const host = document.getElementById('view2');
  if (!host || host.dataset.watching) return;
  host.dataset.watching = '1';
  new MutationObserver(() => {
    clearTimeout(tblTimer);
    tblTimer = setTimeout(() => enhanceTables(host), 40);
  }).observe(host, { childList: true, subtree: true });
}

/* ---------- confirmation ---------- */
// Returns a promise for yes/no. The body may be HTML, because the useful part of a
// confirmation is usually a list of what is about to happen rather than a sentence about it.
function confirmAction({ title, body = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel',
                         danger = false, prompt = null }) {
  return new Promise(resolve => {
    document.querySelectorAll('.confirm-back').forEach(x => x.remove());
    const back = document.createElement('div');
    back.className = 'confirm-back no-print';
    back.innerHTML = `
      <div class="confirm-box" role="dialog" aria-modal="true">
        <h2>${esc(title)}</h2>
        <div class="confirm-body">${body}</div>
        ${prompt ? `<label style="margin-top:10px">${esc(prompt.label || '')}</label>
          <input id="confirmInput" placeholder="${esc(prompt.placeholder || '')}" maxlength="200">
          <div class="error" id="confirmInputErr"></div>` : ''}
        <div class="confirm-actions">
          <button class="secondary" data-no>${esc(cancelLabel)}</button>
          <button class="${danger ? 'danger' : ''}" data-yes>${esc(confirmLabel)}</button>
        </div>
      </div>`;
    const done = (answer) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(answer); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    // With a prompt the dialog resolves to the text typed; without one, to true. Either way a
    // refusal is false, so callers can keep testing the result as a truthy answer.
    const accept = () => {
      if (!prompt) return done(true);
      const input = back.querySelector('#confirmInput');
      const v = String(input.value || '').trim();
      if (prompt.required !== false && !v) {
        back.querySelector('#confirmInputErr').textContent = prompt.requiredMessage || 'This is required.';
        input.focus();
        return;
      }
      done(v);
    };
    back.addEventListener('click', (e) => {
      if (e.target.hasAttribute('data-no') || e.target === back) done(false);
      if (e.target.hasAttribute('data-yes')) accept();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    const input = back.querySelector('#confirmInput');
    if (input) {
      input.focus();
      input.addEventListener('keydown', e => { if (e.key === 'Enter') accept(); });
    } else {
      const yes = back.querySelector('[data-yes]');
      if (yes) yes.focus();
    }
  });
}

// Whether to move at all. Someone who has asked their system for less motion has usually asked
// for a reason, and an operations screen is exactly where that request deserves honouring.
const MOTION_OK = () => !window.matchMedia || !matchMedia('(prefers-reduced-motion: reduce)').matches;

function flash(msg, cls = 'success') {
  const el = document.createElement('div');
  el.className = cls + ' vf-toast';
  el.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px 18px;box-shadow:0 4px 14px rgba(0,0,0,.15);z-index:99;font-weight:600;max-width:90vw';
  el.textContent = msg;
  document.body.appendChild(el);
  // Leave the way it arrived, rather than vanishing mid-sentence.
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 320); }, 3200);
}

// Count a figure up to itself. A number that lands by climbing reads as something measured;
// the same number simply appearing reads as decoration. Short enough not to be a wait — anyone
// who glances away and back sees the final figure, because that is where it settles.
function countUp(el, target, ms = 750) {
  const end = Number(target) || 0;
  // A hidden tab does not run animation frames, so a figure started at zero would sit at zero
  // until somebody looked — showing a wrong number, which is worse than showing a still one.
  if (!MOTION_OK() || end === 0 || document.hidden) { el.textContent = String(end); return; }
  const started = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - started) / ms);
    // Fast at first, easing to a stop, so the last few digits are readable.
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = String(Math.round(end * eased));
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = String(end);
  };
  requestAnimationFrame(tick);
}

// Bring a freshly drawn dashboard to life: tiles rise in, their figures climb, and the charts
// grow from nothing. Called after the markup is in the page, so it works no matter how the
// dashboard was rendered. The stagger is capped — twelve tiles should not take three seconds.
function animateDashboard(root) {
  root = root || document.getElementById('view2') || document;
  if (!root || !MOTION_OK()) return;
  const step = (i, per, cap) => Math.min(i * per, cap) + 's';
  root.querySelectorAll('.tile').forEach((tile, i) => {
    tile.style.setProperty('--d', step(i, 0.045, 0.45));
    tile.classList.add('animate-in');
    const num = tile.querySelector('.num');
    if (num) {
      const target = num.textContent.trim();
      // Only whole numbers climb. Money and percentages carry symbols that would read as
      // nonsense part-way up, so they are left exactly as rendered.
      if (/^\d+$/.test(target) && !document.hidden) {
        num.textContent = '0';
        setTimeout(() => countUp(num, target), i * 45 + 120);
      }
    }
  });
  root.querySelectorAll('.bar-fill').forEach((bar, i) => {
    bar.style.setProperty('--d', step(i, 0.06, 0.5));
    bar.classList.add('animate-in');
  });
  root.querySelectorAll('.col-bar').forEach((col, i) => {
    col.style.setProperty('--d', step(i, 0.07, 0.5));
    col.classList.add('animate-in');
  });
}
function showErr(e) { flash(e.message || String(e), 'error'); }

/* ---------- brand imagery (stock photos w/ graceful navy fallback) ---------- */
const IMG = {
  hero: 'https://images.unsplash.com/photo-1578575437130-527eed3abbec?auto=format&fit=crop&w=1400&q=70',
  boxes: 'https://images.unsplash.com/photo-1607166452427-7e4477079cb9?auto=format&fit=crop&w=1000&q=70'
};

/* ---------- nav icons (inline SVG) ---------- */
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  package: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05"/><path d="M12 22.08V12"/>',
  box: '<path d="M12.89 1.45 20 5v14l-7.11 3.55a2 2 0 0 1-1.78 0L4 19V5l7.11-3.55a2 2 0 0 1 1.78 0Z"/><path d="M4 8l8 4 8-4"/>',
  container: '<rect x="2" y="6" width="20" height="12" rx="1"/><path d="M6 6v12M10 6v12M14 6v12M18 6v12"/>',
  warehouse: '<path d="M22 8.35V20a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8.35"/><path d="M2 8.35 12 3l10 5.35"/><path d="M6 21v-7h12v7"/>',
  truck: '<path d="M10 17h4V5H2v12h3"/><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="17.5" cy="17.5" r="1.5"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M3 12h18"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'
};
function icon(name) {
  return `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}

/* ---------- auth / shell ---------- */
async function boot() {
  await loadPortal();
  try { ME = await api('/api/me'); } catch (e) { ME = null; }
  VI.onChange(() => { if (ME) { renderShell(); route(); } else { renderLogin(); } });
  if (!ME) return renderLogin();
  await Promise.all([loadBoxSizeCatalog(), loadMyModules()]);
  renderShell();
  route();
}

/* ---------- branch portals ----------
   /th, /kh and /mnl are branded sign-in doors onto the same VFIC system. Branch staff sign
   in at their own door; the data all lands in one place so Manila sees everything. */
const PORTAL_SLUG = (() => {
  const m = /^\/(th|kh|mnl|dev)\/?$/i.exec(location.pathname);
  return m ? m[1].toLowerCase() : null;
})();
let PORTAL = null;
const DEMO_LOGINS = {
  th: 'admin.th@vfic.demo · shipper@vfic.demo',
  kh: 'admin.kh@vfic.demo · cambodia@vfic.demo',
  mnl: 'admin@vfic.demo · consignee@vfic.demo · warehouse@vfic.demo',
  dev: 'developer@vfic.demo'
};
async function loadPortal() {
  if (!PORTAL_SLUG) return;
  try { PORTAL = await api('/api/portal/' + PORTAL_SLUG); } catch (e) { PORTAL = null; }
}

function renderLogin() {
  document.getElementById('preauth').style.display = '';
  document.getElementById('shell').style.display = 'none';
  const p = PORTAL;
  // A branch deployment is that branch's own site. Listing the other countries' portals
  // there advertises the rest of the network to anyone who reaches the sign-in page, and
  // the links do not even work — those portals live on different deployments. Head office
  // keeps the pair it actually hosts.
  const HQ_PORTALS = [['mnl', 'Manila HQ'], ['dev', 'Developer']];
  const hostedHere = PORTAL && ['HQ', 'DEVELOPER'].includes(PORTAL.type);
  const otherPortals = (hostedHere ? HQ_PORTALS : []).filter(([s]) => s !== PORTAL_SLUG);
  document.getElementById('view').innerHTML = `
    <div class="login-wrap">
      <div class="login-brandside" style="--hero-img:url('${IMG.hero}')${p ? `;--accent:${p.accent}` : ''}">
        <div class="lb-top">
          <span class="vf-logo-plate">
            <img class="vf-logo-img" src="/vfic-logo.png" alt="Vîctors Freight International Corporation — Chosen to Deliver" style="width:280px">
          </span>
        </div>
        <div>
          ${p ? `<div class="portal-chip" style="background:${esc(p.accent)}">${esc(p.flag)} ${esc(p.name)} · ${esc(p.city)}</div>` : ''}
          <h2>${p ? esc(p.label || p.name) : VI.t('login.subtitle')}</h2>
          <p>${p
            ? `${esc(p.type === 'HQ' ? 'Head office' : 'Branch operations')} — connected to VFIC Manila. Bookings, boxes and containers recorded here flow straight to head office.`
            : `${VI.t('brand.company')} — ${VI.t('brand.tagline')}`}</p>
          <ul class="lb-points">
            ${p ? `<li>Your branch's own shipments, warehouse and containers</li>
                   <li>Your own staff accounts and rate card</li>
                   <li>Consolidated at VFIC Manila head office</li>`
                : `<li>${VI.t('land.svc.sea.t')} · ${VI.t('land.svc.air.t')} · ${VI.t('service.DOOR_TO_DOOR')}</li>
                   <li>${VI.t('land.hero.ctaTrack')} — ${VI.t('land.stat.tracking')}</li>
                   <li>${VI.t('land.contact.head')}: Intramuros, Manila</li>`}
          </ul>
        </div>
        <div style="font-size:12px;color:#8aa0bf">© ${new Date().getFullYear()} ${VI.t('brand.company')}</div>
      </div>
      <div class="login-formside">
        <div class="login-box card" id="lgCard">
          <div style="display:flex;justify-content:center;margin-bottom:10px">
            <img class="vf-logo-img" src="/vfic-logo.png" alt="Vîctors Freight International Corporation — Chosen to Deliver" style="width:290px">
          </div>
          ${p ? `<div class="portal-chip" style="background:${esc(p.accent)};margin:0 auto 10px">${esc(p.flag)} ${esc(p.name)}</div>` : ''}
          <div style="text-align:center;margin-bottom:12px">${VI.toggleHtml('renderLogin()')}</div>
          <h1 style="font-size:20px;text-align:center;margin:0 0 14px">${p ? esc(p.name) + ' Sign In' : VI.t('login.title')}</h1>
          <label>${VI.t('common.email')}</label><input id="lgEmail" type="email" autocomplete="username">
          <label>${VI.t('common.password')}</label><input id="lgPass" type="password" autocomplete="current-password">
          <div style="margin-top:14px"><button id="lgBtn" style="width:100%" onclick="doLogin()">${VI.t('common.login')}</button></div>
          <div class="error" id="lgErr"></div>
          <div class="demo-creds">
            <b>${VI.t('login.demo')}</b> (${VI.t('login.password_is')} <code>demo1234</code>):<br>
            ${esc(DEMO_LOGINS[PORTAL_SLUG] || 'admin@vfic.demo · shipper@vfic.demo · consignee@vfic.demo · warehouse@vfic.demo')}
          </div>
          ${otherPortals.length ? `<div style="margin-top:12px;font-size:13px;text-align:center">
            <span class="muted">Other portals:</span>
            ${otherPortals.map(([s, n]) => `<a href="/${s}" style="margin-left:8px">${esc(n)}</a>`).join('')}
          </div>` : ''}
          <div style="display:flex;justify-content:space-between;margin-top:10px;font-size:13px">
            <a href="/">${VI.t('login.home')}</a>
            <a href="/track.html">${VI.t('login.track')} →</a>
          </div>
        </div>
      </div>
    </div>`;
  const langBtns = document.querySelectorAll('#view .lang-toggle');
  langBtns.forEach(g => g.classList.add('on-light'));
  document.getElementById('lgPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}
async function doLogin() {
  const btn = document.getElementById('lgBtn');
  try {
    document.getElementById('lgErr').textContent = '';
    if (btn) { btn.disabled = true; btn.textContent = VI.t('login.checking'); }
    ME = await api('/api/login', { method: 'POST', body: { email: lgEmail.value.trim(), password: lgPass.value, portal: PORTAL_SLUG } });
    // Say plainly that the details were right before the screen changes. Signing in is the
    // one moment someone is unsure whether they typed their password correctly, and a portal
    // that simply redraws leaves them guessing what just happened.
    await loginAccepted();
    await Promise.all([loadBoxSizeCatalog(), loadMyModules()]);
    renderShell();
    location.hash = '#/dashboard';
    route();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = VI.t('login.signin'); }
    document.getElementById('lgErr').textContent = e.message;
  }
}

// A green circle with a check, drawn over the sign-in card and held just long enough to be
// read. The circle and tick are stroked rather than dropped in as an image so they animate.
function loginAccepted() {
  return new Promise(resolve => {
    const host = document.getElementById('lgCard') || document.getElementById('view');
    if (!host) return resolve();
    const first = ME && ME.name ? String(ME.name).split(' ')[0] : '';
    const ok = document.createElement('div');
    ok.className = 'login-ok';
    ok.innerHTML = [
      '<div class="login-ok-ring"><svg viewBox="0 0 52 52" aria-hidden="true">',
      '<circle class="lo-circle" cx="26" cy="26" r="23"/>',
      '<path class="lo-check" d="M15 27 l7.5 7.5 l14.5 -16"/>',
      '</svg></div>',
      '<div class="login-ok-text">' + esc(VI.t('login.welcome')) + (first ? ', ' + esc(first) : '') + '</div>'
    ].join('');
    host.appendChild(ok);
    setTimeout(resolve, 1150);
  });
}
async function logout() {
  await api('/api/logout', { method: 'POST' });
  ME = null;
  teardownSignedIn();
  location.hash = '';
  renderLogin();
}

// The chat button, its panel and the alert poller are built once when the shell appears and
// were never taken down again, so they sat on top of the login screen after signing out —
// still polling, still holding the last person's conversations. Signing out has to undo
// everything signing in put on the page.
function teardownSignedIn() {
  if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
  if (alertTimer) { clearInterval(alertTimer); alertTimer = null; }
  ['chatFab', 'chatPanel'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
  document.querySelectorAll('.chat-toast').forEach(t => t.remove());
  const mount = document.getElementById('alertMount');
  if (mount) mount.innerHTML = '';
  CHAT = { open: false, branch: null, me: null, view: 'list', peer: null, peerName: '',
           peerReadonly: false, threads: [], msgs: [], unread: 0, firstUnreadAt: null, contacts: [] };
  ALERTS = { total: 0, items: [], by_kind: {}, read_count: 0 };
  chatToastFor = null;
  alertMenuFor = null;
}
function toggleNav(open) {
  document.getElementById('shell').classList.toggle('nav-open', open);
}

/* ---------- roles (mirrors lib/roles.js) ---------- */
const R_ADMINS = ['DEVELOPER_ADMIN', 'MASTER_ADMIN'];
// A branch admin runs their branch's origin operations, so they count as origin staff
// everywhere a shipper agent does (booking containers, encoding shipments, intake review).
const R_BRANCH_ADMINS = ['BRANCH_ADMIN_TH', 'BRANCH_ADMIN_KH'];
const R_SHIPPERS = ['SHIPPER_AGENT_TH', 'SHIPPER_AGENT_KH'];
const R_AGENTS = R_ADMINS.concat(R_BRANCH_ADMINS, R_SHIPPERS, ['CONSIGNEE_AGENT']);
// Rate cards and BSP exchange rates are the Developer's to edit.
const isDeveloper = () => ME && ME.role === 'DEVELOPER_ADMIN';
// A branch admin runs their own branch: its rate card, receipt details and staff.
const isAnyAdmin = () => ME && R_ADMINS.concat(R_BRANCH_ADMINS).includes(ME.role);
const ROLE_LABELS = {
  DEVELOPER_ADMIN: 'Developer Admin', MASTER_ADMIN: 'Master Admin',
  SHIPPER_AGENT_TH: 'Shipper Agent — Thailand', SHIPPER_AGENT_KH: 'Shipper Agent — Cambodia',
  CONSIGNEE_AGENT: 'Consignee Agent (Manila)', WAREHOUSE: 'Warehouse Staff', ACCOUNTING: 'Accounting'
};
const isAccounting = () => ME && R_ADMINS.concat(R_BRANCH_ADMINS, ['ACCOUNTING']).includes(ME.role);

// Sidebar entries are gated by MODULE (see lib/modules.js), so an admin can switch any
// module off for a role in Admin → Roles & Modules and it disappears from that role's nav.
const NAV2 = [
  { section: 'nav.section.ops' },
  ['#/dashboard', 'nav.dashboard', 'grid', 'dashboard'],
  ['#/shipments', 'nav.shipments', 'package', 'shipments'],
  ['#/box-orders', 'nav.boxorders', 'box', 'box_orders'],
  ['#/boxes', 'nav.boxes', 'box', 'boxes'],
  ['#/containers', 'nav.containers', 'container', 'containers'],
  ['#/origin-warehouse', 'nav.originwh', 'warehouse', 'origin_warehouse'],
  ['#/warehouse', 'nav.warehouse', 'warehouse', 'ph_warehouse'],
  ['#/trips', 'nav.trips', 'truck', 'trips'],
  ['#/driver-passes', 'nav.driverpasses', 'truck', 'driver_passes'],
  ['#/schedule', 'nav.schedule', 'grid', 'schedule'],
  ['#/returns', 'nav.returns', 'undo', 'returns'],
  { section: 'nav.section.people' },
  ['#/customers', 'nav.customers', 'users', 'customers'],
  ['#/notifications', 'nav.sms', 'chat', 'sms'],
  ['#/reports', 'nav.reports', 'chart', 'reports'],
  ['#/accounting', 'nav.accounting', 'chart', 'accounting'],
  { section: 'nav.section.system' },
  ['#/developer', 'nav.developer', 'gear', 'developer'],
  ['#/scan', 'nav.scan', 'scan', 'scan'],
  ['#/admin', 'nav.admin', 'gear', 'admin']
];

const NAV = [
  { section: 'nav.section.ops' },
  ['#/dashboard', 'nav.dashboard', 'grid', R_AGENTS.concat(['WAREHOUSE', 'ACCOUNTING'])],
  ['#/shipments', 'nav.shipments', 'package', R_AGENTS],
  ['#/box-orders', 'nav.boxorders', 'box', R_AGENTS],
  ['#/boxes', 'nav.boxes', 'box', R_AGENTS.concat(['WAREHOUSE'])],
  ['#/containers', 'nav.containers', 'container', R_AGENTS],
  ['#/origin-warehouse', 'nav.originwh', 'warehouse', R_ADMINS.concat(R_SHIPPERS)],
  ['#/warehouse', 'nav.warehouse', 'warehouse', R_ADMINS.concat(['CONSIGNEE_AGENT','WAREHOUSE'])],
  ['#/trips', 'nav.trips', 'truck', R_ADMINS.concat(['CONSIGNEE_AGENT'])],
  ['#/driver-passes', 'nav.driverpasses', 'truck', R_ADMINS.concat(['CONSIGNEE_AGENT'], R_SHIPPERS)],
  ['#/schedule', 'nav.schedule', 'grid', R_ADMINS.concat(['CONSIGNEE_AGENT'], R_SHIPPERS)],
  ['#/returns', 'nav.returns', 'undo', R_ADMINS.concat(['CONSIGNEE_AGENT'])],
  { section: 'nav.section.people' },
  ['#/customers', 'nav.customers', 'users', R_AGENTS],
  ['#/notifications', 'nav.sms', 'chat', R_AGENTS],
  ['#/reports', 'nav.reports', 'chart', R_AGENTS],
  ['#/accounting', 'nav.accounting', 'chart', R_ADMINS.concat(['ACCOUNTING'])],
  { section: 'nav.section.system' },
  ['#/scan', 'nav.scan', 'scan', R_AGENTS.concat(['WAREHOUSE'])],
  ['#/admin', 'nav.admin', 'gear', R_ADMINS]
];
/* ---------- sidebar: module-gated, collapsible, branch-aware ---------- */
let MY = null;                       // /api/my-modules for the signed-in user
const COLLAPSE_KEY = 'vfic_nav_collapsed';
const GROUP_KEY = 'vfic_nav_groups';
const isNavCollapsed = () => localStorage.getItem(COLLAPSE_KEY) === '1';
function toggleSidebar() {
  const next = !isNavCollapsed();
  localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
  document.getElementById('shell').classList.toggle('nav-collapsed', next);
  const btn = document.getElementById('collapseBtn');
  if (btn) { btn.textContent = next ? '»' : '«'; btn.title = next ? 'Expand sidebar' : 'Collapse sidebar'; }
}
function collapsedGroups() {
  try { return JSON.parse(localStorage.getItem(GROUP_KEY) || '[]'); } catch (e) { return []; }
}
function toggleNavGroup(key) {
  const set = new Set(collapsedGroups());
  set.has(key) ? set.delete(key) : set.add(key);
  localStorage.setItem(GROUP_KEY, JSON.stringify([...set]));
  renderShell();
}
async function loadMyModules() {
  try { MY = await api('/api/my-modules'); }
  catch (e) { MY = null; }
}

/* ---------- alerts: online bookings and box orders announce themselves ---------- */
// Work that arrives on its own is the work most easily missed — nobody refreshes a queue they
// have no reason to think has changed. The bell carries the count so the queue can be ignored
// until it matters.
let ALERTS = { total: 0, items: [], by_kind: {}, read_count: 0 };
let ALERT_SHOW = 'unread';        // an alert that has been read is done with, until asked for
let alertTimer = null;
let alertMenuFor = null;          // which row has its ⋯ menu open

// What the bell has already made a fuss about. The panel repaints on a timer, so without this
// the badge would pulse every few seconds forever and be tuned out within a day. Movement is
// reserved for the moment something actually arrives.
let alertsSeen = { total: 0, keys: new Set() };
let alertsFirstPaint = true;

async function loadAlerts() {
  const before = ALERTS.total || 0;
  try { ALERTS = await api('/api/alerts?show=' + ALERT_SHOW); }
  catch (e) { return; }                       // a failed poll is not worth a banner
  // Only a rise counts. Reading one makes the number fall, and nothing about that is news.
  const arrived = !alertsFirstPaint && (ALERTS.total || 0) > before;
  const fresh = new Set();
  for (const it of (ALERTS.items || [])) {
    if (!alertsFirstPaint && !alertsSeen.keys.has(it.key) && !it.read) fresh.add(it.key);
  }
  alertsSeen = { total: ALERTS.total || 0, keys: new Set((ALERTS.items || []).map(i => i.key)) };
  alertsFirstPaint = false;
  paintBell({ arrived, fresh });
}

// Marking is what makes the list shrink, so it always repaints from the server's answer
// rather than guessing locally.
async function markAlert(key, state) {
  alertMenuFor = null;
  try { await api('/api/alerts/mark', { method: 'POST', body: { keys: [key], state } }); }
  catch (e) { showErr(e); }
  await loadAlerts();
}
async function markAllRead() {
  const keys = (ALERTS.items || []).filter(i => !i.read).map(i => i.key);
  if (!keys.length) return;
  try { await api('/api/alerts/mark', { method: 'POST', body: { keys, state: 'read' } }); }
  catch (e) { showErr(e); }
  await loadAlerts();
}
function toggleAlertShow() {
  ALERT_SHOW = ALERT_SHOW === 'unread' ? 'all' : 'unread';
  loadAlerts();
}
function toggleAlertMenu(key) {
  alertMenuFor = alertMenuFor === key ? null : key;
  paintBell();
}
// Opening the thing is reading it, so the click marks it before it navigates.
async function openAlert(key, href) {
  await markAlert(key, 'read');
  closeAlerts();
  if (href === '#chat') { toggleChat(); return; }
  location.hash = href;
}
function paintBell(motion) {
  const host = document.getElementById('alertMount');
  if (!host) return;
  const open = host.querySelector('.bell-panel:not([hidden])');
  const n = ALERTS.total || 0;
  const items = ALERTS.items || [];
  const showingAll = ALERT_SHOW === 'all';
  host.innerHTML = `
    <button type="button" class="bell" onclick="toggleAlerts()" title="Bookings, box orders, branch messages and anything else waiting on you">
      <span class="bell-ico${motion && motion.arrived ? ' is-new' : ''}">🔔</span>
      <span class="bell-txt">${VI.t('alerts.title')}</span>
      ${n ? `<span class="bell-badge${motion && motion.arrived ? ' is-new' : ''}">${n > 99 ? '99+' : n}</span>` : ''}
    </button>
    <div class="bell-panel" ${open ? '' : 'hidden'}>
      <div class="bell-tools">
        <button type="button" class="bell-link" onclick="toggleAlertShow()">
          ${showingAll ? VI.t('alerts.showUnread') : VI.t('alerts.showAll')}${!showingAll && ALERTS.read_count ? ` (${ALERTS.read_count})` : ''}
        </button>
        ${n ? `<button type="button" class="bell-link" onclick="markAllRead()">${VI.t('alerts.markAll')}</button>` : ''}
      </div>
      ${items.length ? '' : `<div class="bell-empty muted">${showingAll ? VI.t('alerts.noneAtAll') : VI.t('alerts.none')}</div>`}
      ${items.map(it => `
        <div class="bell-item${it.read ? ' is-read' : ''}${motion && motion.fresh && motion.fresh.has(it.key) ? ' is-new' : ''}">
          <button type="button" class="bell-open" onclick="openAlert('${esc(it.key)}', '${esc(it.href)}')">
            <span class="bell-kind">${it.icon || '🔔'}</span>
            <span class="bell-body">
              <b>${esc(it.reference || '')}</b>
              <span class="muted">${esc([it.who, it.detail].filter(Boolean).join(' · '))}</span>
            </span>
            <span class="bell-when muted">${esc(sinceText(it.at))}</span>
          </button>
          <button type="button" class="bell-more" onclick="toggleAlertMenu('${esc(it.key)}')" aria-label="More">⋯</button>
          ${alertMenuFor === it.key ? `
            <div class="bell-menu">
              ${it.read
                ? `<button type="button" onclick="markAlert('${esc(it.key)}','unread')">${VI.t('alerts.markUnread')}</button>`
                : `<button type="button" onclick="markAlert('${esc(it.key)}','read')">${VI.t('alerts.markRead')}</button>`}
              <button type="button" class="danger" onclick="markAlert('${esc(it.key)}','deleted')">${VI.t('alerts.delete')}</button>
            </div>` : ''}
        </div>`).join('')}
    </div>`;
}
// Relative time reads better than a date here: "2h ago" says whether it needs attention now.
function sinceText(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const h = Math.floor(mins / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}
function toggleAlerts() {
  const panel = document.querySelector('#alertMount .bell-panel');
  if (!panel) return;
  panel.hidden = !panel.hidden;
  alertMenuFor = null;
  if (!panel.hidden) loadAlerts();
}
document.addEventListener('click', (e) => {
  const host = document.getElementById('alertMount');
  if (!host || host.contains(e.target)) return;
  const panel = host.querySelector('.bell-panel');
  if (panel && !panel.hidden) { panel.hidden = true; alertMenuFor = null; }
});
function closeAlerts() {
  const panel = document.querySelector('#alertMount .bell-panel');
  if (panel) panel.hidden = true;
}
function startAlerts() {
  if (alertTimer) return;
  loadAlerts();
  alertTimer = setInterval(loadAlerts, 45000);
}

/* ---------- portal chat ---------- */
// Three deployments run the same operation, and coordination between them used to happen
// entirely outside the system. Messages replicate like any other record, so a note written
// in Bangkok reaches Manila the same way a box does — which also means it is not instant,
// and the panel says so rather than pretending otherwise.
let CHAT = { open: false, branch: null, me: null, view: 'list', peer: null, peerName: '',
             peerReadonly: false, threads: [], msgs: [], unread: 0, firstUnreadAt: null,
             contacts: [] };
let chatTimer = null;
let chatToastFor = null;      // which message the toast is currently announcing

function chatMount() {
  if (document.getElementById('chatFab')) return;
  const fab = document.createElement('button');
  fab.id = 'chatFab';
  fab.className = 'chat-fab no-print';
  fab.type = 'button';
  fab.title = 'Portal chat';
  fab.onclick = toggleChat;
  fab.innerHTML = '<span>💬</span><span class="chat-badge" hidden></span>';
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = 'chatPanel';
  panel.className = 'chat-panel no-print';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="chat-head">
      <button type="button" class="chat-back" id="chatBack" onclick="chatShowList()" hidden aria-label="Back">‹</button>
      <b id="chatTitle">${VI.t('chat.title')}</b>
      <button type="button" class="chat-x" onclick="toggleChat()" aria-label="Minimize" title="Minimize">–</button>
    </div>
    <div class="chat-threads" id="chatThreads"><div class="muted" style="padding:10px">Loading…</div></div>
    <div class="chat-log" id="chatLog" hidden></div>
    <form class="chat-form" id="chatForm" hidden onsubmit="return sendChat(event)">
      <input id="chatInput" autocomplete="off" placeholder="${VI.t('chat.placeholder')}" maxlength="2000">
      <button type="submit" class="small">${VI.t('chat.send')}</button>
    </form>
    <div class="chat-newbar" id="chatNewBar">
      <select id="chatTo" class="chat-to" title="Start a conversation"></select>
      <button type="button" class="small" onclick="chatOpenPicked()">${VI.t('chat.start')}</button>
    </div>`;
  document.body.appendChild(panel);
}

// The people this user may write to, grouped by branch. The list is the restriction: a
// Thailand user is simply never offered a Cambodia colleague, so nothing has to be explained.
async function loadContacts() {
  try {
    const r = await api('/api/messages/contacts');
    CHAT.contacts = r.contacts || [];
    if (!CHAT.to && CHAT.contacts.length) CHAT.to = CHAT.contacts[0].id;
  } catch (e) { CHAT.contacts = []; }
  if (CHAT.open) paintChatPicker();
}
function chatRecipientOptions() {
  const groups = {};
  for (const c of CHAT.contacts) (groups[c.branch_label] = groups[c.branch_label] || []).push(c);
  return Object.entries(groups).map(([label, people]) =>
    `<optgroup label="${esc(label)}">${people.map(c =>
      `<option value="${c.id}">${esc(c.name)} — ${esc(c.role_label)}</option>`).join('')}</optgroup>`).join('');
}
const BRANCH_LABEL = { HQ_MANILA: 'Manila (HQ)', TH_BANGKOK: 'Thailand', KH_PHNOMPENH: 'Cambodia' };

async function loadChat(initial) {
  // Always refresh the conversation list: it carries the total unread and drives the badge
  // whether or not a thread happens to be open.
  let r;
  try { r = await api('/api/messages'); }
  catch (e) { return; }
  CHAT.branch = r.branch; CHAT.me = r.me;
  const before = CHAT.unread;
  CHAT.threads = r.threads || [];
  CHAT.unread = r.unread || 0;
  paintChatBadge();

  // Something new arrived while they were working elsewhere: say so once, quietly, and let
  // them open it. Without this the only sign is a number on a button they are not looking at.
  if (!CHAT.open && CHAT.unread > before) {
    const t = CHAT.threads.find(x => x.unread > 0);
    if (t && chatToastFor !== t.peer + ':' + t.last_at) {
      chatToastFor = t.peer + ':' + t.last_at;
      chatToast(t);
    }
  }

  if (CHAT.open && CHAT.view === 'thread' && CHAT.peer) {
    let c;
    try { c = await api('/api/messages?with=' + encodeURIComponent(CHAT.peer)); }
    catch (e) { return; }
    CHAT.msgs = c.messages || [];
    CHAT.firstUnreadAt = c.first_unread_at || null;
    paintChat(initial);
    if (c.unread) markChatRead();
  } else if (CHAT.open) {
    paintThreadList();
  }
}

// The list of correspondents, each with its own unread count — one window per person.
function paintThreadList() {
  const host = document.getElementById('chatThreads');
  if (!host) return;
  host.innerHTML = CHAT.threads.length ? CHAT.threads.map(t => `
    <button type="button" class="chat-thread${t.unread ? ' has-unread' : ''}" onclick="chatOpenThread('${esc(t.peer)}')">
      <span class="chat-thread-top">
        <b>${esc(t.name)}</b>
        ${t.unread ? `<span class="chat-thread-badge">${t.unread > 9 ? '9+' : t.unread}</span>` : ''}
        <span class="chat-when muted">${esc(sinceText(t.last_at))}</span>
      </span>
      <span class="muted chat-thread-sub">${esc(t.branch_label)}${t.role_label ? ' · ' + esc(t.role_label) : ''}</span>
      <span class="muted chat-thread-last">${t.last_from_me ? 'You: ' : ''}${esc(t.last_body)}</span>
    </button>`).join('')
    : `<div class="muted" style="padding:12px">${VI.t('chat.empty')}</div>`;
}

function chatShowList() {
  CHAT.view = 'list'; CHAT.peer = null; CHAT.msgs = [];
  chatSwapView();
  loadChat();
}
async function chatOpenThread(peer) {
  const t = CHAT.threads.find(x => String(x.peer) === String(peer));
  CHAT.view = 'thread'; CHAT.peer = String(peer);
  CHAT.peerName = t ? t.name : '';
  CHAT.peerReadonly = !!(t && t.readonly);
  chatSwapView();
  await loadChat(true);
  const i = document.getElementById('chatInput');
  if (i && !CHAT.peerReadonly) i.focus();
}
// Start a conversation with someone not yet in the list.
function chatOpenPicked() {
  const sel = document.getElementById('chatTo');
  if (!sel || !sel.value) return;
  const c = CHAT.contacts.find(x => String(x.id) === String(sel.value));
  CHAT.threads = CHAT.threads.some(t => String(t.peer) === String(sel.value))
    ? CHAT.threads
    : [{ peer: String(sel.value), name: c ? c.name : '', branch_label: c ? c.branch_label : '',
         role_label: c ? c.role_label : '', last_body: '', last_at: null, unread: 0 }, ...CHAT.threads];
  chatOpenThread(sel.value);
}

function chatSwapView() {
  const inThread = CHAT.view === 'thread';
  const el = (id) => document.getElementById(id);
  if (el('chatThreads')) el('chatThreads').hidden = inThread;
  if (el('chatLog')) el('chatLog').hidden = !inThread;
  if (el('chatForm')) el('chatForm').hidden = !inThread || CHAT.peerReadonly;
  if (el('chatNewBar')) el('chatNewBar').hidden = inThread;
  if (el('chatBack')) el('chatBack').hidden = !inThread;
  if (el('chatTitle')) el('chatTitle').textContent = inThread ? (CHAT.peerName || '') : VI.t('chat.title');
}

function paintChatBadge() {
  const b = document.querySelector('#chatFab .chat-badge');
  if (!b) return;
  b.hidden = !CHAT.unread;
  b.textContent = CHAT.unread > 9 ? '9+' : String(CHAT.unread);
}

// Tell the server how far they have read. That also clears these messages from the bell,
// so the two never disagree about whether a note still needs attention.
async function markChatRead() {
  if (!CHAT.peer) return;
  try { await api('/api/messages/read', { method: 'POST', body: { with: CHAT.peer, at: new Date().toISOString() } }); }
  catch (e) { return; }
  // Only this conversation is cleared; the others keep their own counts.
  const t = CHAT.threads.find(x => String(x.peer) === String(CHAT.peer));
  if (t) { CHAT.unread = Math.max(0, CHAT.unread - t.unread); t.unread = 0; }
  paintChatBadge();
  loadAlerts();
}

function chatToast(t) {
  document.querySelectorAll('.chat-toast').forEach(x => x.remove());
  const el = document.createElement('div');
  el.className = 'chat-toast no-print';
  el.innerHTML = `
    <div class="chat-toast-head">💬 ${esc(t.name)}
      ${t.branch_label ? `<span class="muted">· ${esc(t.branch_label)}</span>` : ''}</div>
    <div class="chat-toast-body">${esc(String(t.last_body || '').slice(0, 120))}</div>`;
  // Straight into their conversation, not just into the panel.
  el.onclick = () => {
    el.remove();
    if (!CHAT.open) toggleChat();
    setTimeout(() => chatOpenThread(t.peer), 60);
  };
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 8000);
}

function paintChatPicker() {
  const sel = document.getElementById('chatTo');
  if (!sel) return;
  // Rebuild when the people change, not merely when the box is empty: painting once left
  // head office without Cambodia whenever the first paint beat the contact list back.
  const sig = CHAT.contacts.map(c => c.id).join(',');
  if (CHAT.contacts.length && sel.dataset.sig !== sig) {
    const keep = sel.value;
    sel.innerHTML = chatRecipientOptions();
    sel.dataset.sig = sig;
    if (keep && sel.querySelector('option[value="' + keep + '"]')) sel.value = keep;
    sel.onchange = null;
  }
  if (!CHAT.contacts.length) { sel.innerHTML = '<option value="">No one to message</option>'; delete sel.dataset.sig; }
}

function paintChat(scrollToEnd) {
  const log = document.getElementById('chatLog');
  const sel = document.getElementById('chatTo');
  if (!log || !sel) return;
  if (CHAT.view !== 'thread') { paintThreadList(); return; }

  const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
  const mark = CHAT.firstUnreadAt;
  let drewDivider = false;
  log.innerHTML = CHAT.msgs.length ? CHAT.msgs.map(m => {
    const mine = String(m.from_user_id) === String(CHAT.me);
    // One line showing where they stopped reading, drawn before the first unread message.
    let divider = '';
    if (mark && !drewDivider && !mine && String(m.created_at) >= String(mark)) {
      drewDivider = true;
      divider = `<div class="chat-newline"><span>${VI.t('chat.newFrom')}</span></div>`;
    }
    // Inside a conversation the two names are already known, so only the time is worth room.
    return divider + `<div class="chat-msg ${mine ? 'mine' : ''}">
      <div class="chat-meta">${mine ? 'You' : esc(m.from_name || '')} · ${esc(sinceText(m.created_at))}</div>
      <div class="chat-bubble">${esc(m.body)}</div>
    </div>`;
  }).join('') : `<div class="muted" style="padding:12px">${VI.t('chat.empty')}</div>`;
  if (scrollToEnd || atEnd) log.scrollTop = log.scrollHeight;
}

function toggleChat() {
  chatMount();
  const panel = document.getElementById('chatPanel');
  CHAT.open = panel.hidden;
  panel.hidden = !CHAT.open;
  if (CHAT.open) {
    document.querySelectorAll('.chat-toast').forEach(t => t.remove());
    if (!CHAT.peer) CHAT.view = 'list';
    chatSwapView();
    loadContacts().then(() => { paintChatPicker(); loadChat(true); });
  }
}

async function sendChat(ev) {
  ev.preventDefault();
  const input = document.getElementById('chatInput');
  const body = input.value.trim();
  if (!body) return false;
  input.value = '';
  try {
    await api('/api/messages', { method: 'POST', body: { body, to_user_id: CHAT.peer } });
    await loadChat(true);
  } catch (e) { showErr(e); input.value = body; }
  return false;
}

function startChat() {
  chatMount();
  if (chatTimer) return;
  loadContacts();
  loadChat();
  // Cheap while shut (just the unread badge), livelier once someone is actually reading.
  chatTimer = setInterval(() => loadChat(), 12000);
}

function renderShell() {
  document.getElementById('preauth').style.display = 'none';
  const shell = document.getElementById('shell');
  shell.style.display = '';
  shell.classList.toggle('nav-collapsed', isNavCollapsed());
  startAlerts();
  startChat();
  document.getElementById('brandOps').textContent = VI.t('shell.ops');
  document.getElementById('logoutBtn').textContent = VI.t('common.logout');

  const allowed = MY && Array.isArray(MY.modules) ? MY.modules : null;
  const closed = new Set(collapsedGroups());
  const navGroup = (key, label, inner, openByDefault) => {
    const shut = closed.has(key) || (!closed.has(key) && openByDefault === false);
    return `<button type="button" class="nav-section nav-group${shut ? ' shut' : ''}" onclick="toggleNavGroup('${key}')">
        <span>${label}</span><span class="chev">${shut ? '▸' : '▾'}</span></button>
      <div class="nav-group-items${shut ? ' hidden' : ''}">${inner}</div>`;
  };
  // Modules that have tabs or sections inside get a nested submenu in the sidebar, so an
  // agent can jump straight to the tab they want instead of landing on the module first.
  const SUBMENUS = {
    accounting: [['#/accounting/rates', 'sub.rates'], ['#/accounting/interbranch', 'sub.interbranch'],
                 ['#/accounting/expenses', 'sub.expenses'], ['#/accounting/pnl', 'sub.pnl']],
    origin_warehouse: [['#/origin-warehouse', 'sub.stock'], ['#/origin-warehouse-doc', 'sub.printable'],
                       ['#/branch-office-doc', 'sub.branchstock']],
    reports: [['#/reports?at=rp-box-movement', 'sub.boxmovement'], ['#/reports?at=rp-boxes-per-container', 'sub.percontainer'],
              ['#/reports?at=rp-delivery-performance', 'sub.delivperf'], ['#/reports?at=rp-failed-reasons', 'sub.failed'],
              ['#/reports?at=rp-unpaid-shipments', 'sub.unpaid']],
    shipments: [['#/shipments', 'sub.allshipments'], ['#/shipments/new', 'sub.newintake'], ['#/intake-requests', 'sub.online']],
    containers: [['#/containers', 'sub.allcontainers'], ['#/containers?at=cnBook', 'sub.bookcontainer']],
    admin: [['#/admin', 'sub.users'], ['#/role-modules', 'sub.roles']]
  };
  const linkFor = ([href, key, ic, moduleKey], suffix = '') => {
    const subs = !suffix && SUBMENUS[moduleKey];
    const open = subs && location.hash.startsWith(href);
    const shut = subs && (closed.has('sub:' + moduleKey) || !open);
    const main = `<a href="${href}${suffix}" data-nav="${href}${suffix}" title="${esc(VI.t(key))}" onclick="toggleNav(false)">${icon(ic)}<span>${VI.t(key)}</span>${subs ? `<span class="sub-chev" onclick="event.preventDefault();event.stopPropagation();toggleNavGroup('sub:${moduleKey}')">${shut ? '▸' : '▾'}</span>` : ''}</a>`;
    if (!subs) return main;
    return main + `<div class="nav-sub${shut ? ' hidden' : ''}">${subs.map(([h, k]) =>
      `<a href="${h}" data-nav="${h}" onclick="navSub('${h}')"><span>${esc(VI.t(k))}</span></a>`).join('')}</div>`;
  };

  let html = '';
  // Head office view: one collapsible block of operations per branch, each filtered to that
  // branch, followed by the head-office-wide modules.
  if (MY && MY.sees_all_branches && Array.isArray(MY.branches) && MY.branches.length) {
    const BRANCH_OPS = NAV2.filter(i => !i.section && ['shipments', 'box_orders', 'boxes', 'containers', 'origin_warehouse'].includes(i[3]));
    for (const b of MY.branches.filter(x => x.type !== 'HQ')) {
      const inner = BRANCH_OPS.map(item => linkFor(item, `?branch=${b.key}`)).join('');
      html += navGroup('branch:' + b.key, `${esc(b.flag || '')} ${esc(b.short)}`.trim(), inner);
    }
  }

  let group = null, buffer = '', count = 0;
  const flush = () => {
    if (!group) { html += buffer; buffer = ''; return; }
    if (count) html += navGroup(group, VI.t(group), buffer);
    buffer = ''; count = 0;
  };
  for (const item of NAV2) {
    if (item.section) { flush(); group = item.section; continue; }
    const [href, key, ic, moduleKey] = item;
    if (allowed && !allowed.includes(moduleKey)) continue;
    if (!allowed && !R_ADMINS.includes(ME.role)) continue; // fail closed if modules unknown
    buffer += linkFor(item);
    count += 1;
  }
  flush();

  document.getElementById('nav').innerHTML = html;
  mountSearch();
  document.getElementById('who').textContent = ME.name;
  const roleLine = ROLE_LABELS[ME.role] || ME.role.replace(/_/g, ' ');
  const branch = MY && MY.branch ? MY.branch.short : (MY && MY.sees_all_branches ? 'All branches' : '');
  document.getElementById('whoRole').innerHTML = `${esc(roleLine)}${branch ? `<div class="who-branch">${esc(branch)}</div>` : ''}`;
  document.getElementById('langMount').innerHTML = VI.toggleHtml('renderShell();route()');
  markNav(location.hash || '#/dashboard');
}
// A submenu entry can point at a section of an already-open page (?at=…), where changing
// the hash alone would not re-render. Re-route when the page changes, scroll either way.
function navSub(href) {
  toggleNav(false);
  if (location.hash === href) route().then(() => scrollToSection(href));
  else setTimeout(() => scrollToSection(href), 60);
}
function scrollToSection(href, tries = 12) {
  const at = (href.split('?at=')[1] || '').split('&')[0];
  if (!at) return;
  const el = document.getElementById(at);
  // Some sections (box movement) load after the page renders, so wait for them.
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else if (tries > 0) setTimeout(() => scrollToSection(href, tries - 1), 120);
}
function markNav(hash) {
  // Branch links carry ?branch=…, so an exact match wins; otherwise fall back to the
  // plain route so #/boxes/12 still highlights Boxes.
  const links = [...document.querySelectorAll('#nav a')];
  const exact = links.find(a => a.dataset.nav === hash);
  links.forEach(a => {
    const nav = a.dataset.nav;
    a.classList.toggle('active', exact ? a === exact : (!nav.includes('?') && hash.split('?')[0].startsWith(nav)));
  });
}

/* ---------- global search ---------- */
let SEARCH_T = null;
function mountSearch() {
  const host = document.getElementById('searchMount');
  if (!host) return;
  host.innerHTML = `
    <div class="gsearch">
      <input id="gq" type="search" placeholder="Search box, shipment, container, customer…"
             autocomplete="off" oninput="onSearchInput()" onkeydown="if(event.key==='Escape')closeSearch()">
      <div class="gsearch-results" id="gres" style="display:none"></div>
    </div>`;
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.gsearch')) closeSearch();
  });
}
function closeSearch() { const r = document.getElementById('gres'); if (r) r.style.display = 'none'; }
function onSearchInput() {
  clearTimeout(SEARCH_T);
  SEARCH_T = setTimeout(runSearch, 220);
}
async function runSearch() {
  const q = (document.getElementById('gq') || {}).value || '';
  const box = document.getElementById('gres');
  if (!box) return;
  if (q.trim().length < 2) { closeSearch(); return; }
  try {
    const d = await api('/api/search?q=' + encodeURIComponent(q));
    box.style.display = '';
    box.innerHTML = d.groups.length
      ? d.groups.map(g => `
          <div class="gs-group">${esc(g.label)}</div>
          ${g.items.map(i => `<a class="gs-item" href="${i.href}" onclick="closeSearch()">
              <div class="gs-label">${esc(i.label)}</div>
              <div class="gs-sub">${esc(i.sub || '')}</div></a>`).join('')}`).join('')
      : `<div class="gs-empty">Nothing found for “${esc(q)}”</div>`;
  } catch (e) { closeSearch(); }
}

/* ---------- router ---------- */
async function route() {
  if (!ME) return renderLogin();
  const hash = location.hash || '#/dashboard';
  markNav(hash);
  const p = hash.slice(2).split('?')[0].split('/');
  try {
    if (p[0] === 'dashboard' || !p[0]) return pageDashboard();
    if (p[0] === 'shipments' && p[1] === 'new') return pageShipmentNew(+(hashQuery().get('intake')) || null);
    if (p[0] === 'receiving-form-blank') return pageReceivingFormBlank(+(hashQuery().get('extra')) || 0);
    if (p[0] === 'intake-requests') return pageIntakeRequests();
    if (p[0] === 'box-orders') return pageBoxOrders();
    if (p[0] === 'shipments' && p[1]) return pageShipmentDetail(+p[1]);
    if (p[0] === 'shipments') return pageShipments();
    if (p[0] === 'labels' && p[1] === 's') return pageLabels('shipment', +p[2]);
    if (p[0] === 'labels' && p[1] === 'b') return pageLabels('box', +p[2]);
    if (p[0] === 'receiving-form') return pageReceivingForm(+p[1]);
    if (p[0] === 'packing-list') return pagePackingList(+p[1]);
    if (p[0] === 'truck-receipt' && p[1] === 't') return pageTruckReceipt('trip', +p[2]);
    if (p[0] === 'truck-receipt' && p[1] === 'b') return pageTruckReceipt('box', +p[2]);
    if (p[0] === 'delivery-receipt') return pageDeliveryReceipt(+p[1]);
    if (p[0] === 'sender-receipt') return pageSenderReceipt(+p[1]);
    if (p[0] === 'driver-passes') return pageDriverPasses();
    if (p[0] === 'schedule') return pageSchedule();
    if (p[0] === 'boxes' && p[1]) return pageBoxDetail(+p[1]);
    if (p[0] === 'boxes') return pageBoxes();
    if (p[0] === 'container-manifest') return pageContainerManifest(+p[1]);
    if (p[0] === 'containers' && p[1]) return pageContainerDetail(+p[1]);
    if (p[0] === 'containers') return pageContainers();
    if (p[0] === 'origin-warehouse-doc') return pageOriginWarehouseDoc();
    if (p[0] === 'branch-office-doc') return pageBranchOfficeDoc();
    if (p[0] === 'origin-warehouse') return pageOriginWarehouse();
    if (p[0] === 'warehouse') return pageWarehouse();
    if (p[0] === 'trips' && p[1]) return pageTripDetail(+p[1]);
    if (p[0] === 'trips') return pageTrips();
    if (p[0] === 'manifest') return pageManifest(+p[1]);
    if (p[0] === 'returns') return pageReturns();
    if (p[0] === 'customers' && p[1]) return pageCustomerDetail(+p[1]);
    if (p[0] === 'customers') return pageCustomers();
    if (p[0] === 'notifications') return pageNotifications();
    if (p[0] === 'reports') return pageReports();
    if (p[0] === 'accounting') return pageAccounting(p[1] || 'rates');
    if (p[0] === 'developer') return pageDeveloper();
    if (p[0] === 'role-modules') return pageRoleModules();
    if (p[0] === 'admin') return pageAdmin();
    if (p[0] === 'scan') return pageScan();
    pageDashboard();
  } catch (e) { view(`<div class="card error">${esc(e.message)}</div>`); }
}
window.addEventListener('hashchange', route);

const isAdmin = () => ME && R_ADMINS.includes(ME.role);
const isAgent = () => ME && R_AGENTS.includes(ME.role);
// Mirrors canCancel() in lib/statuses.js — head office may cancel anything before delivery,
// a branch only while the box is still at its own end. The server is what enforces this; the
// point of repeating it here is to not offer a button that would only come back refused.
const ORIGIN_SIDE = ['CREATED', 'PICKED_UP', 'RECEIVED_BRANCH', 'RECEIVED_ORIGIN', 'LOADED_CONTAINER'];
const canCancelBox = (status) => {
  if (!ME || ['DELIVERED', 'CANCELLED'].includes(status)) return false;
  if (R_ADMINS.includes(ME.role)) return true;
  return R_BRANCH_ADMINS.includes(ME.role) && ORIGIN_SIDE.includes(status);
};
const canDispatch = () => ME && R_ADMINS.concat(['CONSIGNEE_AGENT']).includes(ME.role);
const canIntake = () => ME && R_ADMINS.concat(R_BRANCH_ADMINS, R_SHIPPERS).includes(ME.role);

/* ---------- QR scanning ---------- */
function scannerHtml(hint) {
  return `
    <div class="scan-panel card">
      <div id="qr-reader"></div>
      <div class="row" style="justify-content:center;margin-top:10px">
        <button class="secondary small" onclick="startCam()">📷 Start camera</button>
      </div>
      <div class="muted" style="margin:8px 0">${esc(hint || 'Scan a box QR label, or type the box number:')}</div>
      <div class="row" style="justify-content:center">
        <input id="manualCode" placeholder="VF-2026-000001-01" style="max-width:240px" autocomplete="off">
        <button class="small" onclick="submitManual()">Go</button>
      </div>
      <div id="scanResult"></div>
    </div>`;
}
let scanHandler = null;
function setScanHandler(fn) {
  scanHandler = fn;
  const inp = document.getElementById('manualCode');
  if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') submitManual(); });
}
async function startCam() {
  stopScanner();
  try {
    scanner = new Html5Qrcode('qr-reader');
    let busy = false;
    await scanner.start({ facingMode: 'environment' }, { fps: 8, qrbox: 220 }, async text => {
      if (busy) return;
      busy = true;
      await handleCode(text);
      setTimeout(() => { busy = false; }, 1500);
    }, () => {});
  } catch (e) { flash('Camera unavailable: ' + e, 'error'); }
}
function stopScanner() {
  if (scanner) { try { scanner.stop().catch(() => {}); } catch (e) {} scanner = null; }
}
async function submitManual() {
  const code = document.getElementById('manualCode').value.trim();
  if (code) await handleCode(code);
}
async function handleCode(code) {
  if (!scanHandler) return;
  try { await scanHandler(code); } catch (e) { scanFeedback(`<div class="scan-last warn"><div class="big">✗ ${esc(e.message)}</div></div>`); }
}
function scanFeedback(html) {
  const el = document.getElementById('scanResult');
  if (el) el.innerHTML = html;
}
async function lookupBox(code) { return api('/api/boxes/lookup/' + encodeURIComponent(code)); }

/* ---------- dashboard ---------- */
// A horizontal bar chart drawn with plain elements — prints cleanly and needs no library.
function barChart(rows, { max, fmt = (v) => v } = {}) {
  const top = max || Math.max(1, ...rows.map(r => r.value));
  return rows.map(r => `
    <div class="bar-row">
      <div class="muted">${esc(r.label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round((r.value / top) * 100)}%${r.color ? ';background:' + r.color : ''}"></div></div>
      <div class="bar-val">${esc(String(fmt(r.value)))}</div>
    </div>`).join('');
}
// Boxes handled per month over the last six months, as a sparkline-style column chart.
function columnChart(points, { height = 90 } = {}) {
  const top = Math.max(1, ...points.map(p => p.value));
  return `<div style="display:flex;align-items:flex-end;gap:8px;height:${height}px;margin-top:6px">
    ${points.map(p => `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%">
        <div style="font-size:11px;font-weight:700">${p.value}</div>
        <div class="col-bar" style="width:100%;background:var(--primary);border-radius:4px 4px 0 0;height:${Math.max(2, Math.round((p.value / top) * (height - 22)))}px"></div>
      </div>`).join('')}
  </div>
  <div style="display:flex;gap:8px;margin-top:4px">
    ${points.map(p => `<div style="flex:1;text-align:center;font-size:10.5px;color:var(--muted)">${esc(p.label)}</div>`).join('')}
  </div>`;
}

async function pageDashboard() {
  const [d, pnl] = await Promise.all([
    api('/api/dashboard'),
    isAccounting() ? api('/api/accounting/pnl').catch(() => null) : Promise.resolve(null)
  ]);
  const tiles = PIPELINE.filter(s => s !== 'CANCELLED').map(s =>
    `<a class="tile" href="#/boxes?status=${s}"><div class="num">${d.byStatus[s] || 0}</div><div class="lbl">${esc(STATUS_LABELS[s])}</div></a>`).join('');
  // Pipeline as a bar chart, and the last six months of box volume.
  const pipelineRows = PIPELINE.filter(x => x !== 'CANCELLED')
    .map(x => ({ label: STATUS_LABELS[x], value: d.byStatus[x] || 0 }))
    .filter(r => r.value > 0);
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(); dt.setDate(1); dt.setMonth(dt.getMonth() - i);
    const key = dt.toISOString().slice(0, 7);
    months.push({ key, label: dt.toLocaleDateString('en-PH', { month: 'short' }), value: (d.boxesByMonth || {})[key] || 0 });
  }
  // Head office consolidates branches that bill in different currencies, so the peso total
  // is shown with the branch amounts that make it up and the BSP rate used.
  const revenueByCurrencyHtml = (p) => {
    const c = p.consolidated;
    if (!c) return '';
    return `
    ${c.lines.map(l => `
      <div class="pnl-line"><span class="muted" style="padding-left:10px">${esc(money(l.billed, l.currency))}${l.converted ? ` <span style="opacity:.7">× ${l.rate}</span>` : ''}</span>
        <span>${l.converted ? esc(money(l.php.billed, 'PHP')) : '<span class="muted">no rate</span>'}</span></div>`).join('')}
    <div class="pnl-line"><span>Revenue billed</span><b>${esc(money(p.revenue.billed, 'PHP'))}</b></div>
    <div class="pnl-line"><span class="muted">Collected</span><span>${esc(money(p.revenue.collected, 'PHP'))}</span></div>
    <div class="pnl-line"><span class="muted">Receivable</span><span>${esc(money(p.revenue.receivable, 'PHP'))}</span></div>
    <div class="pnl-line"><span class="muted" style="font-size:11.5px">BSP rate, ${esc(c.as_of)}</span><span></span></div>`;
  };
  const chartsHtml = `
    <div class="chart-grid">
      <div class="chart-card">
        <h3>Pipeline</h3>
        ${pipelineRows.length ? barChart(pipelineRows) : '<div class="muted">No boxes in the pipeline.</div>'}
      </div>
      <div class="chart-card">
        <h3>Boxes handled — last 6 months</h3>
        ${columnChart(months)}
      </div>
      ${pnl ? `<div class="chart-card">
        <h3>Profit &amp; Loss ${pnl.branch && pnl.branch !== 'ALL' ? `<span class="muted" style="font-weight:400">· ${esc(NODE_LABELS[pnl.branch] || pnl.branch)}</span>` : ''}</h3>
        ${pnl.mixed_currency ? revenueByCurrencyHtml(pnl) : `
        <div class="pnl-line"><span>${pnl.books === 'HQ' ? 'Settlements issued' : 'Revenue billed'}</span><b><button class="amount-link" onclick="pnlBreakdown('revenue')">${esc(money(pnl.revenue.billed, pnl.currency))}</button></b></div>
        <div class="pnl-line"><span class="muted">${pnl.books === 'HQ' ? 'Settled by branches' : 'Collected'}</span><span>${esc(money(pnl.revenue.collected, pnl.currency))}</span></div>
        <div class="pnl-line"><span class="muted">${pnl.books === 'HQ' ? 'Due from branches' : 'Receivable'}</span><span>${esc(money(pnl.revenue.receivable, pnl.currency))}</span></div>`}
        ${pnl.interbranch && pnl.interbranch.income ? `<div class="pnl-line"><span class="muted">Inter-branch income</span><span>${esc(money(pnl.interbranch.income, pnl.currency))}</span></div>` : ''}
        <div class="pnl-line"><span>${pnl.books === 'HQ' ? 'Local PH expenses' : 'Expenses'}</span><span class="neg">− <button class="amount-link" onclick="pnlBreakdown('expenses')">${esc(money(pnl.expenses.total, pnl.currency))}</button></span></div>
        ${pnl.interbranch && pnl.interbranch.cost ? `<div class="pnl-line"><span class="muted">Inter-branch charges</span><span class="neg">− <button class="amount-link" onclick="pnlBreakdown('interbranch')">${esc(money(pnl.interbranch.cost, pnl.currency))}</button></span></div>` : ''}
        <div class="pnl-line total"><span>Net profit</span>
          <span class="${pnl.net_profit >= 0 ? 'pos' : 'neg'}">${esc(money(pnl.net_profit, pnl.currency))}</span></div>
        <div style="margin-top:8px"><a href="#/accounting/pnl">Full profit &amp; loss →</a></div>
        <div class="muted" style="font-size:11.5px;margin-top:4px">Click a figure to see what makes it up.</div>
      </div>` : ''}
    </div>
    <div id="pnlDrill"></div>`;

  view(`
    <h1>${VI.t('dash.title')}</h1>
    <div class="tiles">
      <a class="tile" href="#/boxes"><div class="num">${d.totalBoxes}</div><div class="lbl">${VI.t('dash.totalBoxes')}</div></a>
      <a class="tile" href="#/returns" style="outline:2px solid var(--red)"><div class="num" style="color:var(--red)">${d.returnsCount}</div><div class="lbl">${VI.t('dash.returns')}</div></a>
      <a class="tile" href="#/reports"><div class="num">${d.unpaidShipments}</div><div class="lbl">${VI.t('dash.unpaid')}</div></a>
    </div>
    ${chartsHtml}
    <h2>${VI.t('dash.pipeline')}</h2>
    <div class="tiles">${tiles}</div>
    <h2>${VI.t('dash.inTransit')}</h2>
    <div class="card table-scroll">
      <table><tr><th>Container</th><th>Vessel</th><th>Boxes</th><th>ETA Manila</th><th>Status</th></tr>
      ${d.inTransitContainers.map(c => `<tr><td><a href="#/containers/${c.id}">${esc(c.container_number)}</a></td><td>${esc(c.vessel_name)}</td><td>${c.box_count}</td><td>${fmtDay(c.eta)}</td><td>${badge(c.status)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">None</td></tr>'}
      </table>
    </div>
    <h2>${VI.t('dash.activeTrips')}</h2>
    <div class="card table-scroll">
      <table><tr><th>Trip</th><th>Region</th><th>Driver</th><th>Boxes</th><th>Date</th><th>Status</th></tr>
      ${d.activeTrips.map(t => `<tr><td><a href="#/trips/${t.id}">${esc(t.trip_number)}</a></td><td>${regionBadge(t.region)}</td><td>${esc(t.driver_name)}</td><td>${t.box_count}</td><td>${fmtDay(t.scheduled_date)}</td><td>${badge(t.status)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">None</td></tr>'}
      </table>
    </div>
    <h2>${VI.t('dash.recentSms')}</h2>
    <div class="card table-scroll">
      <table><tr><th>Box</th><th>To</th><th>Message</th><th>Status</th></tr>
      ${d.recentNotifications.map(n => `<tr><td>${esc(n.box_number)}</td><td>${esc(n.recipient_phone)}</td><td class="wrap-cell" style="max-width:420px">${esc(n.message_body)}</td><td>${badge(n.status)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">None yet</td></tr>'}
      </table>
    </div>`);
  animateDashboard();
}

/* ---------- shipments ---------- */
function hashQuery() { return new URLSearchParams(location.hash.split('?')[1] || ''); }

async function pageShipments() {
  const q = hashQuery();
  const [list, pending] = await Promise.all([
    api('/api/shipments?q=' + encodeURIComponent(q.get('q') || '')),
    canIntake() ? api('/api/intake-requests?status=PENDING') : Promise.resolve([])
  ]);
  view(`
    <div class="row" style="justify-content:space-between">
      <h1>Shipments</h1>
      <div>
        ${canIntake() ? `<a href="#/intake-requests"><button class="secondary" ${pending.length ? 'style="outline:2px solid var(--primary)"' : ''}>📥 Online intake requests${pending.length ? ` (${pending.length})` : ''}</button></a>` : ''}
        ${canIntake() ? '<a href="#/receiving-form-blank"><button class="secondary">🖨 Blank receiving form</button></a>' : ''}
        ${canIntake() ? '<a href="#/shipments/new"><button>+ New shipment intake</button></a>' : ''}
      </div>
    </div>
    <div class="card row">
      <input id="shipQ" placeholder="Search shipment #, sender name, phone…" style="max-width:340px" value="${esc(q.get('q') || '')}">
      <button class="small" onclick="location.hash='#/shipments?q='+encodeURIComponent(shipQ.value)">Search</button>
    </div>
    <div class="card table-scroll">
      <table><tr><th>Shipment #</th><th>Sender</th><th>Collection</th><th>Boxes</th><th>Service</th><th>Origin</th><th>Fee</th><th>Payment</th><th>Created</th></tr>
      ${list.map(s => `<tr>
        <td><a href="#/shipments/${s.id}">${esc(s.shipment_number)}</a></td>
        <td>${esc(s.sender_name)}</td>
        <td>${collectionBadge(s.collection)}</td><td>${s.box_count}</td>
        <td>${esc(svcLevelLabel(s))}</td>
        <td>${esc(s.origin_agent || s.origin_country)}</td>
        <td>${s.shipping_fee_amount != null ? esc(s.currency) + ' ' + s.shipping_fee_amount : '—'}</td>
        <td>${payBadge(s.payment_status)}</td><td>${fmtDay(s.created_at)}</td>
      </tr>`).join('') || '<tr><td colspan="9" class="muted">No shipments</td></tr>'}
      </table>
    </div>`);
  document.getElementById('shipQ').addEventListener('keydown', e => { if (e.key === 'Enter') location.hash = '#/shipments?q=' + encodeURIComponent(e.target.value); });
}

async function pageIntakeRequests() {
  const list = await api('/api/intake-requests');
  view(`
    <h1>Online Intake Requests</h1>
    <div class="muted" style="margin-bottom:10px">Submitted by senders via the online receiving form (scan the QR code on the blank form to try it). Review and encode as a shipment, or dismiss duplicates/spam.</div>
    <div class="card table-scroll">
      <table><tr><th>Reference</th><th>Sender</th><th>Phone</th><th>Collection</th><th>Boxes</th><th>Size per box</th><th>Submitted</th><th>Status</th><th>Actions</th></tr>
      ${list.map(r => `<tr>
        <td>${esc(r.reference_code)}</td><td>${esc(r.sender_name)}</td><td>${esc(r.sender_phone)}</td>
        <td>${collectionBadge(r.collection)}${r.collection === 'PICKUP' && r.pickup_date ? `<div class="muted" style="font-size:11px">${esc(r.pickup_date)}</div>` : ''}</td>
        <td>${r.box_count}</td>
        <td class="wrap-cell" style="max-width:220px">${esc(r.size_summary || '—')}</td>
        <td>${fmtDate(r.submitted_at)}</td>
        <td><span class="badge ${r.status === 'PENDING' ? 'st-created' : r.status === 'CONVERTED' ? 'st-delivered' : 'st-cancelled'}">${esc(r.status)}</span></td>
        <td class="inline-actions">
          ${r.status === 'PENDING' && canIntake() ? `<a href="#/shipments/new?intake=${r.id}"><button class="small">Review & encode</button></a>
            <button class="small secondary" onclick="dismissIntake(${r.id})">Dismiss</button>` : ''}
        </td>
      </tr>`).join('') || '<tr><td colspan="9" class="muted">No online submissions yet</td></tr>'}
      </table>
    </div>`);
}
async function dismissIntake(id) {
  if (!confirm('Dismiss this submission? Use this for spam or accidental duplicates.')) return;
  try { await api('/api/intake-requests/' + id, { method: 'PUT', body: { status: 'DISMISSED' } }); route(); } catch (e) { showErr(e); }
}

const BOX_ORDER_STATUSES = ['NEW', 'PREPARING', 'DISPATCHED', 'FULFILLED', 'CANCELLED'];
const BOX_ORDER_BADGE = { NEW: 'st-created', PREPARING: 'st-sorted', DISPATCHED: 'st-out_for_delivery', FULFILLED: 'st-delivered', CANCELLED: 'st-cancelled' };
// Legacy imperial keys map onto the current catalogue so historical boxes still show a label.
const LEGACY_SIZE_ALIASES = { MINI: 'SMALL', XL: 'LARGE', JUMBO: 'GIGA', CUSTOM: 'LARGE' };
function SIZE_LABEL(key) {
  const k = String(key || '').toUpperCase();
  const hit = BOX_SIZE_CATALOG.find(s => s.key === (LEGACY_SIZE_ALIASES[k] || k));
  return hit ? hit.label : (key || '');
}
async function pageBoxOrders() {
  const list = await api('/api/box-orders');
  const fulfilLabel = { DELIVER_ADDRESS: 'Deliver to address abroad', PICKUP_OFFICE: 'Pick up at branch abroad' };
  view(`
    <h1>Box Orders</h1>
    <div class="muted" style="margin-bottom:10px">Customers with no box yet who ordered empty balikbayan box(es) via the public “Order a box” page. Prepare and deliver, or have them pick up at the office.</div>
    <div class="card table-scroll">
      <table><tr><th>Reference</th><th>Sender</th><th>Boxes ordered</th><th>Fulfilment</th><th>Submitted</th><th>Status</th></tr>
      ${list.map(o => `<tr>
        <td>${esc(o.reference_code)}</td>
        <td>${esc(o.contact.name)}<div class="muted">${esc(o.contact.phone)}${o.contact.email ? ' · ' + esc(o.contact.email) : ''}</div></td>
        <td>${esc(o.items.map(it => `${it.qty}× ${SIZE_LABEL(it.size)}`).join(', '))} <span class="muted">(${o.total_qty})</span></td>
        <td class="wrap-cell" style="max-width:280px"><b>${esc(fulfilLabel[o.delivery_method] || o.delivery_method)}</b>${o.delivery_method === 'DELIVER_ADDRESS' && o.address ? `<div class="muted">${esc([o.address.street_address, o.address.city, o.address.postal_code, o.address.country].filter(Boolean).join(', '))}${o.address.landmark ? ' · 📍 ' + esc(o.address.landmark) : ''}</div>` : ''}${o.delivery_method === 'PICKUP_OFFICE' && o.pickup_branch ? `<div class="muted">Branch: ${esc(o.pickup_branch)}</div>` : ''}${o.notes ? `<div class="muted">“${esc(o.notes)}”</div>` : ''}</td>
        <td>${fmtDate(o.submitted_at)}</td>
        <td><span class="badge ${BOX_ORDER_BADGE[o.status] || 'st-created'}">${esc(o.status)}</span>
          ${canIntake() ? `<div style="margin-top:4px"><select class="small" onchange="setBoxOrderStatus(${o.id}, this.value)">
            ${BOX_ORDER_STATUSES.map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
          </select></div>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">No box orders yet</td></tr>'}
      </table>
    </div>`);
}
async function setBoxOrderStatus(id, status) {
  try { await api('/api/box-orders/' + id, { method: 'PUT', body: { status } }); flash('Order → ' + status); route(); } catch (e) { showErr(e); }
}

let CUSTOMERS = [];
async function loadCustomers() { CUSTOMERS = await api('/api/customers'); }
function customerOptions(type, selected) {
  const eligible = CUSTOMERS.filter(c => c.type === type || c.type === 'BOTH');
  return `<option value="">— select —</option>` + eligible.map(c =>
    `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.full_name)} · ${esc(c.phone_primary)}${c.city_municipality ? ' · ' + esc(c.city_municipality) : ''}</option>`).join('');
}

let boxRowSeq = 0;
function boxRowHtml() {
  boxRowSeq += 1;
  const n = boxRowSeq;
  return `
    <div class="card" id="boxRow${n}" data-boxrow="${n}">
      <div class="row" style="justify-content:space-between">
        <b>Box</b>
        <button class="secondary small" onclick="document.getElementById('boxRow${n}').remove()">Remove</button>
      </div>
      <div class="form-grid">
        <div><label>Receiver *</label><select id="bxReceiver${n}" onchange="quoteShipmentFee()">${customerOptions('RECEIVER')}</select></div>
        <div><label>Size</label><select id="bxSize${n}" onchange="quoteShipmentFee()">${sizeSelectOptions()}</select></div>
        <div><label>Weight (kg)</label><input id="bxWeight${n}" type="number" min="0" step="0.1" oninput="quoteShipmentFee()"></div>
        <div><label>L×W×H (cm)</label><div class="row" style="flex-wrap:nowrap;gap:4px">
          <input id="bxL${n}" type="number" placeholder="L"><input id="bxW${n}" type="number" placeholder="W"><input id="bxH${n}" type="number" placeholder="H"></div></div>
      </div>
      <label>Declared contents (summary)</label><textarea id="bxContents${n}" placeholder="Clothes, canned goods, chocolates…"></textarea>
      <label>Special instructions</label><input id="bxInstr${n}" placeholder="Fragile / call before delivery / …">
      <label>Packing list — itemized contents (printed on the Packing List document)</label>
      <div id="items${n}">${itemRowHtml()}</div>
      <button type="button" class="secondary small" onclick="document.getElementById('items${n}').insertAdjacentHTML('beforeend', itemRowHtml())">+ Add item</button>
      ${bocGoodsHtml(n)}
    </div>`;
}

// Page 1 of BOC Form BB-IS-001 ticks a Type of Availment and a Type of Sender. Neither can
// be derived from the customer record, so a walk-in shipment printed both blocks empty.
// Prefilled from the online booking when there is one.
function bocDeclarationHtml(intake) {
  const boc = (intake && intake.boc) || intake || {};
  const availment = boc.availment_type || '';
  const senderType = boc.sender_type || '';
  const avail = (typeof BOC_AVAILMENT !== 'undefined' ? BOC_AVAILMENT : []);
  const qfwa = (typeof BOC_SENDER_QFWA !== 'undefined' ? BOC_SENDER_QFWA : []);
  const nqfwa = (typeof BOC_SENDER_NQFWA !== 'undefined' ? BOC_SENDER_NQFWA : []);
  const opt = (k, label, sel) => `<option value="${esc(k)}" ${sel === k ? 'selected' : ''}>${esc(label)}</option>`;
  return `
    <div class="card">
      <h2 style="margin-top:0">Customs declaration <span class="muted" style="font-size:13px;font-weight:400">· BOC Form BB-IS-001 page 1</span></h2>
      <div class="muted" style="margin-bottom:8px">
        These two boxes are ticked on the printed Information Sheet. They cannot be worked out from the
        sender's record, so a walk-in needs them set here — the same way the online form asks the sender.
      </div>
      <div class="form-grid">
        <div><label>Type of availment</label>
          <select id="shAvailment">
            <option value="">— not declared —</option>
            ${avail.filter(a => a.group).map(a => opt(a.key, 'Balikbayan Box privilege — ' + a.label, availment)).join('')}
            ${opt('DE_MINIMIS', 'De Minimis Value', availment)}
            ${opt('NONE', 'None', availment)}
          </select></div>
        <div><label>Type of sender</label>
          <select id="shSenderType">
            <option value="">— not declared —</option>
            ${qfwa.map(t => opt(t.key, 'QFWA — ' + t.label, senderType)).join('')}
            ${nqfwa.map(t => opt(t.key, 'NQFWA — ' + t.label, senderType)).join('')}
          </select></div>
      </div>
    </div>`;
}

// The BOC packing list prints a fixed table of goods categories with a quantity against
// each. An online booking collects them from the sender; a walk-in encoded here had no way
// to record them, so its printed packing list came out blank. Same categories, same order,
// so both routes produce an identical page 2.
function bocGoodsHtml(n) {
  const cats = (typeof BOC_GOODS !== 'undefined' ? BOC_GOODS : []);
  const half = Math.ceil(cats.length / 2);
  const col = (list, offset) => list.map((c, i) => `
    <div class="goods-row">
      <span>${esc(c)}</span>
      <input type="number" min="0" step="1" class="bxGoods" data-goodsbox="${n}" data-cat="${esc(c)}"
             aria-label="${esc(c)} quantity"${c === 'Others' ? ` oninput="toggleOthers(${n})"` : ''}>
    </div>`).join('');
  return `
    <details class="collapse" style="margin-top:10px">
      <summary>Declared goods for the BOC packing list <span class="muted">(quantity per category)</span></summary>
      <div class="muted" style="margin:6px 0 8px">
        Printed on BOC Form BB-IS-001 page 2. Leave blank any category the box does not contain.
      </div>
      <div class="goods-grid">
        <div>${col(cats.slice(0, half), 0)}</div>
        <div>${col(cats.slice(half), half)}</div>
      </div>
      <div id="othersWrap${n}" style="display:none;margin-top:8px">
        <label>“Others” — specify</label>
        <input id="bxOthers${n}" placeholder="What the Others quantity covers">
      </div>
    </details>`;
}
// "Others" only means something with a description attached.
function toggleOthers(n) {
  const qty = document.querySelector(`.bxGoods[data-goodsbox="${n}"][data-cat="Others"]`);
  const wrap = document.getElementById('othersWrap' + n);
  if (wrap) wrap.style.display = (qty && +qty.value > 0) ? '' : 'none';
}
// Collect one box's declared goods in the shape the printed packing list reads.
function collectBoxGoods(n) {
  const spec = (document.getElementById('bxOthers' + n) || {}).value || '';
  return [...document.querySelectorAll(`.bxGoods[data-goodsbox="${n}"]`)]
    .map(i => {
      const qty = parseInt(i.value, 10) || 0;
      const g = { category: i.dataset.cat, qty };
      if (i.dataset.cat === 'Others' && qty > 0 && spec.trim()) g.specify = spec.trim();
      return g;
    })
    .filter(g => g.qty > 0);
}
function itemRowHtml() {
  return `
    <div class="row itemRow" style="flex-wrap:nowrap;gap:6px">
      <input placeholder="Item description (e.g. canned goods)" class="itemDesc">
      <input placeholder="Qty" class="itemQty" style="max-width:90px">
      <button type="button" class="secondary small" onclick="this.parentElement.remove()">✕</button>
    </div>`;
}
function collectItems(itemsContainerId) {
  return [...document.querySelectorAll(`#${itemsContainerId} .itemRow`)]
    .map(row => ({ description: row.querySelector('.itemDesc').value.trim(), qty: row.querySelector('.itemQty').value.trim() }))
    .filter(it => it.description);
}

/* Blank Receiving Form (BOC BB-IS-001) is rendered by boc-forms.js */

let PREFILL_INTAKE = null; // set when opened via a Pending Intake Request (#/shipments/new?intake=ID)

async function createOrMatchCustomer(fields) {
  let existing;
  try {
    return await api('/api/customers', { method: 'POST', body: fields });
  } catch (e) {
    if (e.status !== 409) throw e;
    // Somebody is already on file with that number. Only reuse their record if the server says
    // it is the same person in the same capacity — otherwise it is a relative sharing a phone,
    // and adopting their record would silently send this box to their address instead.
    if (e.data.match !== 'person') return api('/api/customers', { method: 'POST', body: { ...fields, force: true } });
    existing = e.data.existing;
  }

  // The same person, but people move. The address typed for this booking is the address for this
  // booking, so a record that still holds the old one gets brought up to date rather than quietly
  // overriding what the sender just told us — boxes carry no address of their own, only this link.
  const stale = ['address_line', 'barangay', 'city_municipality', 'province', 'postal_code']
    .some(k => fields[k] && addrKey(fields[k]) !== addrKey(existing[k]));
  if (!stale) return existing;
  try {
    return await api('/api/customers/' + existing.id, { method: 'PUT', body: { ...existing, ...fields } });
  } catch (_) {
    return existing;   // a branch may not be allowed to edit them; better the match than nothing
  }
}
// Addresses are compared on their letters and digits alone, so "St." against "Street" or a
// stray double space does not read as a move to a new house.
function addrKey(v) {
  return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function pageShipmentNew(intakeId) {
  await loadCustomers();
  boxRowSeq = 0;
  PREFILL_INTAKE = null;
  let intake = null;
  if (intakeId) {
    try { intake = await api('/api/intake-requests/' + intakeId); } catch (e) { showErr(e); }
    if (intake && intake.status !== 'PENDING') { flash('That online submission was already reviewed.', 'error'); intake = null; }
  }
  view(`
    <div class="row" style="justify-content:space-between">
      <h1>New Shipment Intake</h1>
      <a href="#/receiving-form-blank"><button class="secondary">🖨 Blank receiving form</button></a>
    </div>
    <div class="muted" style="margin:-8px 0 12px">Encoding from a filled-out paper form? Have the sender complete a <a href="#/receiving-form-blank">blank receiving form</a> first, then transcribe it below. Or check <a href="#/intake-requests">pending online submissions</a>.</div>
    ${intake ? `<div class="card" style="border-color:var(--primary)">
      ${intakeSubmittedDetailsHtml(intake)}
      <b>Reviewing online submission ${esc(intake.reference_code)}</b> from ${esc(personName(intake.sender))}, submitted ${fmtDate(intake.submitted_at)}.
      Fields below are pre-filled from what the sender entered — verify weights/sizes and the passport copy, then save.
      ${intake.passport_file ? `<div><a href="${esc(intake.passport_file)}" target="_blank">View submitted passport/ID scan →</a></div>` : ''}
    </div>` : ''}
    <div class="card">
      <h2 style="margin-top:0">Sender</h2>
      <div class="form-grid">
        <div><label>Sender *</label><select id="shSender">${customerOptions('SENDER')}</select></div>
        <div><label>Origin country</label><select id="shOrigin" onchange="originPicked()">${['Thailand', 'Cambodia'].map(c => `<option ${(intake ? intake.origin_country : myOriginCountry()) === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div><label>Origin branch / agent</label><input id="shAgent" value="${esc(intake ? intake.origin_agent : originCity(myOriginCountry()))}"></div>
        <div><label>Service Level</label><select id="shService" onchange="quoteShipmentFee()">${SERVICE_LEVELS.map(k => `<option value="${k}" ${intake && intake.service_level === k ? 'selected' : ''}>${esc(SERVICE_LEVEL_LABELS[k])}</option>`).join('')}</select></div>
      </div>
      <details class="collapse"><summary>+ Create new customer (sender or receiver)</summary>${newCustomerFormHtml('nc')}</details>
      <h2>Fees &amp; documents</h2>
      <div class="muted" style="margin-bottom:8px">The fee is quoted from this branch's rate card — the same figure the sender was shown online. Recalculate after changing a box, or override it by typing.</div>
      <div id="feeQuote" class="fee-quote">Quoting…</div>
      <div class="form-grid">
        <div><label>Shipping fee</label><input id="shFee" type="number" min="0" step="0.01" value="${intake && intake.shipping_fee_amount != null ? intake.shipping_fee_amount : ''}"></div>
        <div><label>Currency</label><select id="shCurrency">${['PHP','THB','USD','KHR','VND','EUR','GBP','AED','CAD'].map(c => `<option ${(intake && intake.currency) === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div><label>Payment status</label><select id="shPaid"><option value="UNPAID">UNPAID</option><option value="PAID">PAID</option></select></div>
      </div>
      <div class="form-grid">
        <div><label>Receiving form</label><input id="fReceiving" type="file"></div>
        <div><label>Packing list</label><input id="fPacking" type="file"></div>
        <div><label>Passport / ID copy ${intake && intake.passport_file ? '' : '*'}</label><input id="fPassport" type="file">
          ${intake && intake.passport_file ? '<div class="muted">Already on file from the online submission — only attach a new one to replace it.</div>' : ''}</div>
      </div>
    </div>
    ${bocDeclarationHtml(intake)}
    <h2>Boxes</h2>
    <div id="boxRows">${(intake ? intake.boxes : [null]).map(() => boxRowHtml()).join('')}</div>
    <button class="secondary" onclick="document.getElementById('boxRows').insertAdjacentHTML('beforeend', boxRowHtml()); quoteShipmentFee();">+ Add another box</button>
    <div class="card">
      <button onclick="createShipment()">Save shipment & generate box numbers + QR</button>
      <div class="muted">Boxes start at CREATED. Confirm physical receipt on the shipment page to notify the sender.</div>
    </div>`);
  quoteShipmentFee();
  if (window.wireNameCase) wireNameCase('ncName');

  if (!intake) return;
  PREFILL_INTAKE = intake;

  // The sender was shown a figure online and is expecting to pay it. Put that exact amount
  // in the fee field and mark it as set by hand, so the rate-card quote cannot silently
  // replace it — the agent can still overtype it, which is the point of showing both.
  if (intake.shipping_fee_amount != null) {
    const fee = document.getElementById('shFee');
    if (fee) { fee.value = intake.shipping_fee_amount; fee.dataset.touched = '1'; }
    const ccy = document.getElementById('shCurrency');
    if (ccy && intake.currency) ccy.value = intake.currency;
  }

  const s = intake.sender || {};
  const senderCustomer = await createOrMatchCustomer({
    full_name: personName(s), type: 'SENDER',
    phone_primary: s.contact_numbers || '', email: s.email || '',
    address_line: s.address_abroad || '', country: intake.origin_country || '',
    city_municipality: intake.origin_agent || ''
  });
  await loadCustomers();
  document.getElementById('shSender').innerHTML = customerOptions('SENDER', senderCustomer.id);

  const rows = [...document.querySelectorAll('[data-boxrow]')];
  for (let i = 0; i < intake.boxes.length; i++) {
    const bx = intake.boxes[i];
    const r = bx.receiver || {};
    const n = rows[i].dataset.boxrow;
    const receiverCustomer = await createOrMatchCustomer({
      full_name: personName(r), type: 'RECEIVER',
      phone_primary: r.contact_number || '', email: r.email || '',
      address_line: r.street_address || '', barangay: r.barangay || '',
      city_municipality: r.city_municipality || '', province: r.region || '',
      region: mapPsgcRegion(r.region), country: 'Philippines', landmark: r.landmark || '',
      postal_code: r.postal_code || ''
    });
    await loadCustomers();
    const rSel = document.getElementById('bxReceiver' + n);
    rSel.innerHTML = customerOptions('RECEIVER', receiverCustomer.id);
    // The customer list is branch-scoped, so a consignee entered seconds ago can legitimately
    // be missing from it. Falling back to an empty picker reads as "no receiver" and is easy
    // to save straight past, so put the person we just matched in and select them.
    if (!rSel.value && receiverCustomer && receiverCustomer.id) {
      const label = [receiverCustomer.full_name, receiverCustomer.phone_primary, receiverCustomer.city_municipality]
        .filter(Boolean).join(' · ');
      const opt = document.createElement('option');
      opt.value = String(receiverCustomer.id);
      opt.textContent = label;
      rSel.appendChild(opt);
      rSel.value = String(receiverCustomer.id);
    }
    document.getElementById('bxSize' + n).value = bx.size_category;
    if (bx.weight_kg) document.getElementById('bxWeight' + n).value = bx.weight_kg;
    // Show the sender's declared goods in the same grid the agent would type into, so the
    // quantities can be checked against the physical box and corrected before saving.
    for (const g of (bx.goods || [])) {
      const cell = document.querySelector(`.bxGoods[data-goodsbox="${n}"][data-cat="${(g.category || '').replace(/"/g, '\\"')}"]`);
      if (cell) cell.value = g.qty;
      if (g.category === 'Others' && g.specify) {
        const spec = document.getElementById('bxOthers' + n);
        if (spec) spec.value = g.specify;
      }
    }
    toggleOthers(n);
    // BOC goods checklist → the encoder's itemized packing list rows
    document.getElementById('bxContents' + n).value = (bx.goods || []).map(g => g.category).join(', ');
    document.getElementById('bxInstr' + n).value = bx.special_instructions || '';
    const itemsEl = document.getElementById('items' + n);
    (bx.goods || []).forEach((g, idx) => {
      if (idx > 0) itemsEl.insertAdjacentHTML('beforeend', itemRowHtml());
      const row = itemsEl.querySelectorAll('.itemRow')[idx];
      row.querySelector('.itemDesc').value = g.category;
      row.querySelector('.itemQty').value = g.qty;
    });
  }
}

// VFIC ships out of two origin lanes. Branch staff only ever encode their own country,
// so the picker starts on their branch and the office city follows the country.
const ORIGIN_CITY = { Thailand: 'Bangkok', Cambodia: 'Phnom Penh' };
const originCity = (country) => ORIGIN_CITY[country] || '';
function myOriginCountry() {
  if (!ME) return 'Thailand';
  if (/_TH$/.test(ME.role)) return 'Thailand';
  if (/_KH$/.test(ME.role)) return 'Cambodia';
  return 'Thailand';
}
function originPicked() {
  const agent = document.getElementById('shAgent');
  const country = (document.getElementById('shOrigin') || {}).value;
  // Don't stomp a city the agent typed themselves.
  if (agent && (!agent.value || Object.values(ORIGIN_CITY).includes(agent.value))) agent.value = originCity(country);
  quoteShipmentFee();
}

// When the shipment came from an online booking, the sender already saw a price. Show it
// next to the rate-card figure so the agent is charging what was promised — and say so
// plainly when the two disagree, rather than letting one quietly win.
function onlineQuoteNoteHtml(q) {
  const quoted = PREFILL_INTAKE && PREFILL_INTAKE.shipping_fee_amount;
  if (quoted == null) return '';
  const ccy = (PREFILL_INTAKE && PREFILL_INTAKE.currency) || q.currency;
  const same = Math.abs(+quoted - +q.total) < 0.01;
  return `<div class="${same ? 'muted' : 'note-warn'}" style="margin-top:8px;font-size:12.5px">
    Sender was quoted <b>${esc(money(quoted, ccy))}</b> online.
    ${same
      ? 'The rate card agrees — the fee below is what they were promised.'
      : `The rate card now says <b>${esc(money(q.total, q.currency))}</b>. The fee below is set to the quoted figure;
         change it only if the boxes differ from what was booked.`}
  </div>`;
}

// Price the draft shipment from the branch rate card and fill the fee field, so what the
// agent records matches what the sender was quoted online.
let FEE_T = null;
function quoteShipmentFee() { clearTimeout(FEE_T); FEE_T = setTimeout(runShipmentQuote, 200); }
async function runShipmentQuote() {
  const host = document.getElementById('feeQuote');
  if (!host) return;
  const boxes = [...document.querySelectorAll('[data-boxrow]')].map(el => {
    const n = el.dataset.boxrow;
    return {
      receiver_id: +(document.getElementById('bxReceiver' + n) || {}).value || null,
      size_category: (document.getElementById('bxSize' + n) || {}).value,
      weight_kg: +(document.getElementById('bxWeight' + n) || {}).value || 0
    };
  }).filter(b => b.receiver_id);
  if (!boxes.length) { host.innerHTML = '<span class="muted">Pick a receiver on each box to see the quote.</span>'; return; }
  try {
    const q = await api('/api/accounting/quote', { method: 'POST', body: {
      origin_country: (document.getElementById('shOrigin') || {}).value,
      service_level: (document.getElementById('shService') || {}).value,
      boxes
    } });
    const fee = document.getElementById('shFee');
    const ccy = document.getElementById('shCurrency');
    // Only overwrite the fee while the agent has not typed their own figure.
    if (fee && !fee.dataset.touched) fee.value = q.total;
    if (ccy) ccy.value = q.currency;
    host.innerHTML = `
      <div class="fq-head">Quote from the <b>${esc(NODE_LABELS[q.branch] || q.branch)}</b> rate card ·
        ${esc(SERVICE_LEVEL_LABELS[q.service_level] || q.service_level)}</div>
      <table class="fq-table">
        <tr><th>#</th><th>Receiver</th><th>Size</th><th>Destination</th><th>Fee</th></tr>
        ${q.lines.map(l => `<tr>
          <td>${l.index}</td><td>${esc(l.receiver_name)}</td><td>${esc(SIZE_LABEL(l.size_category))}</td>
          <td>${l.zone_label ? esc(l.zone_label) : '<span class="muted">no region on receiver</span>'}</td>
          <td>${l.priced ? esc(money(l.amount, q.currency)) : '<span class="muted">—</span>'}</td>
        </tr>`).join('')}
        <tr><td colspan="4"><b>Total</b></td><td><b>${esc(money(q.total, q.currency))}</b></td></tr>
      </table>
      ${q.unpriced ? `<div class="muted" style="margin-top:4px">${q.unpriced} box(es) have no destination region yet, so they are not priced.</div>` : ''}
      ${onlineQuoteNoteHtml(q)}`;
  } catch (e) {
    host.innerHTML = `<span class="muted">Could not quote: ${esc(e.message)}</span>`;
  }
}

// Display name from BOC name parts (Given Middle Family, Suffix).
// "N/A" is a real answer on the BOC form, not a missing value — a person with no middle name
// types it. It must never reach a customer record, or the same consignee comes back as a new
// one on every booking.
const NOT_GIVEN = (v) => !v || /^n\.?\/?a\.?$/i.test(String(v).trim());
function personName(p) {
  if (!p) return '';
  return [p.given_name, p.middle_name, p.family_name, p.suffix]
    .filter(v => !NOT_GIVEN(v))
    .map(v => String(v).trim())
    .join(' ');
}
// PSGC region names → the 17-region delivery-region code (used for sorting/dispatch).
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
  if (n.includes('visayas')) return 'R7';
  if (n.includes('mindanao')) return 'R10';
  if (n.includes('luzon')) return 'R3';
  return null;
}

// Read-only view of everything the sender submitted online, so staff can verify the
// encoded shipment matches the submission.
const SENDER_TYPE_LABELS = {
  QFWA_OFW: 'QFWA - OFW', QFWA_RESIDENT: 'QFWA - Resident Filipino', QFWA_NON_RESIDENT: 'QFWA - Non-Resident Filipino',
  NQFWA_INDIVIDUAL: 'NQFWA - Individual', NQFWA_SOLE_PROP: 'NQFWA - Sole Prop. (DTI)',
  NQFWA_PARTNERSHIP: 'NQFWA - Partnership', NQFWA_CORPORATION: 'NQFWA - Corporation'
};
const AVAILMENT_LABELS = {
  BB_1ST: 'Balikbayan Box privilege - 1st Time', BB_2ND: 'Balikbayan Box privilege - 2nd Time',
  BB_3RD: 'Balikbayan Box privilege - 3rd Time', DE_MINIMIS: 'De Minimis Value', NONE: 'None'
};
function intakeSubmittedDetailsHtml(intake) {
  const s = intake.sender || {};
  const line = (label, val) => `<div class="rc-line"><span>${esc(label)}</span>${esc(val || '-')}</div>`;
  const boxes = (intake.boxes || []).map((b, i) => {
    const r = b.receiver || {};
    const addr = [r.street_address, r.barangay, r.city_municipality, r.region, r.postal_code].filter(Boolean).join(', ');
    const goods = (b.goods || []).map(g => `${esc(g.category)}${g.category === 'Others' && g.specify ? ' (' + esc(g.specify) + ')' : ''} x ${g.qty}`).join(', ');
    return `<div class="rc-box" style="margin-top:8px">
      <div class="rc-label">BOX ${i + 1} - ${esc(personName(r))}</div>
      ${line('Contact', r.contact_number)}
      ${line('Relationship', r.relationship)}
      ${line('PH address', addr)}
      ${line('Landmark', r.landmark)}
      ${line('Size / weight', [b.size_category, b.weight_kg ? b.weight_kg + ' kg' : ''].filter(Boolean).join(' / '))}
      ${b.excess_weight_kg ? line('Excess weight', b.excess_weight_kg + ' kg over - additional charge applies') : ''}
      ${line('Declared value', b.total_value_php != null ? 'Php ' + Number(b.total_value_php).toLocaleString() : '')}
      ${line('Special instructions', b.special_instructions)}
      <div class="rc-line"><span>Itemized goods</span><span class="wrap-cell">${goods ? esc(goods) : '-'}</span></div>
    </div>`;
  }).join('');
  const p = intake.pickup;
  return `
    <details class="collapse" style="margin-top:10px" open>
      <summary>View full submitted details (as entered by the sender)</summary>
      <div style="margin-top:8px">
        <div class="rc-box">
          <div class="rc-label">A. SENDER - ${esc(AVAILMENT_LABELS[intake.availment_type] || intake.availment_type || '')} / ${esc(SENDER_TYPE_LABELS[intake.sender_type] || intake.sender_type || '')}</div>
          ${s.business_name ? line('Business name', s.business_name) : ''}
          ${line('Name', personName(s))}
          ${line('Contact number/s', s.contact_numbers)}
          ${line('Email', s.email)}
          ${s.passport_number ? line('Passport', `${s.passport_number} / issued ${s.passport_date_issued || '-'} at ${s.passport_place_issued || '-'} / expires ${s.passport_expiry || '-'}`) : ''}
          ${line('Address abroad', s.address_abroad)}
          ${line('Address in PH', s.address_ph)}
          ${line('Origin', [intake.origin_agent, intake.origin_country].filter(Boolean).join(', '))}
          ${line('Service level', SERVICE_LEVEL_LABELS[intake.service_level] || intake.service_level)}
          ${line('Collection', COLLECTION_LABELS[intake.collection] || (intake.pickup ? 'Pick-up from sender' : 'Drop-off at office'))}
          ${line('Total shipment value', intake.total_value_php != null ? 'Php ' + Number(intake.total_value_php).toLocaleString() : '')}
          ${p ? line('Pick-up', `${p.date || ''} (${p.time_window || ''}) - ${p.address || ''}${p.notes ? ' / ' + p.notes : ''}`) : ''}
        </div>
        ${boxes}
      </div>
    </details>`;
}

function newCustomerFormHtml(prefix) {
  return `
    <div class="form-grid" style="margin-top:8px">
      <div><label>Full name *</label><input id="${prefix}Name"></div>
      <div><label>Type</label><select id="${prefix}Type"><option>RECEIVER</option><option>SENDER</option><option>BOTH</option></select></div>
      <div><label>Phone (primary) *</label><input id="${prefix}Phone" placeholder="+63 9xx xxx xxxx"></div>
      <div><label>Phone (alternate)</label><input id="${prefix}Alt"></div>
      <div><label>Address line</label><input id="${prefix}Addr"></div>
      <div><label>Barangay</label><input id="${prefix}Brgy"></div>
      <div><label>City / Municipality</label><input id="${prefix}City"></div>
      <div><label>Province</label><input id="${prefix}Prov"></div>
      <div><label>Region</label><select id="${prefix}Region"><option value="">—</option>${regionOptions()}</select></div>
      <div><label>Country</label><input id="${prefix}Country" value="Philippines"></div>
      <div><label>Landmark</label><input id="${prefix}Landmark" placeholder="Critical for remote addresses!"></div>
    </div>
    <button class="small" onclick="createCustomerInline('${prefix}')">Save customer</button>`;
}
async function createCustomerInline(prefix, force = false) {
  const $ = id => document.getElementById(prefix + id).value.trim();
  const body = {
    full_name: $('Name'), type: document.getElementById(prefix + 'Type').value,
    phone_primary: $('Phone'), phone_alternate: $('Alt'),
    address_line: $('Addr'), barangay: $('Brgy'), city_municipality: $('City'),
    province: $('Prov'), region: document.getElementById(prefix + 'Region').value || null,
    country: $('Country'), landmark: $('Landmark'), force
  };
  try {
    const c = await api('/api/customers', { method: 'POST', body });
    flash(`Customer ${c.full_name} saved`);
    await loadCustomers();
    document.querySelectorAll('select[id^="bxReceiver"]').forEach(sel => { const v = sel.value; sel.innerHTML = customerOptions('RECEIVER', +v || undefined); });
    const senderSel = document.getElementById('shSender');
    if (senderSel) { const v = senderSel.value; senderSel.innerHTML = customerOptions('SENDER', +v || undefined); }
  } catch (e) {
    if (e.status === 409) {
      const who = e.data.existing.full_name;
      const ask = e.data.match === 'person'
        ? `${who} is already on file with this number. Add a second record anyway?`
        : `${who} already uses this number. That is normal for a household — add this person as well?`;
      if (confirm(ask)) return createCustomerInline(prefix, true);
      return;
    }
    showErr(e);
  }
}

async function uploadIfAny(inputId) {
  const inp = document.getElementById(inputId);
  if (!inp || !inp.files.length) return null;
  const fd = new FormData();
  fd.append('file', inp.files[0]);
  const r = await api('/api/upload', { method: 'POST', body: fd });
  return r.url;
}

async function createShipment() {
  try {
    const boxes = [...document.querySelectorAll('[data-boxrow]')].map(el => {
      const n = el.dataset.boxrow;
      const $ = id => document.getElementById(id + n);
      // Carry the matching box's BOC block (recipient name parts, relationship, goods)
      // from the online booking so the printed Information Sheet can auto-fill.
      const idx = [...document.querySelectorAll('[data-boxrow]')].indexOf(el);
      const src = PREFILL_INTAKE && PREFILL_INTAKE.boxes ? PREFILL_INTAKE.boxes[idx] : null;
      return {
        receiver_id: +$('bxReceiver').value,
        size_category: $('bxSize').value,
        weight_kg: $('bxWeight').value, length_cm: $('bxL').value, width_cm: $('bxW').value, height_cm: $('bxH').value,
        declared_contents: $('bxContents').value, special_instructions: $('bxInstr').value,
        packing_list_items: collectItems('items' + n),
        // Goods typed here win over the online booking's, since the agent has the box in
        // front of them; the booking's list is the starting point, not the final word.
        boc: (() => {
          const goods = collectBoxGoods(n);
          const receiver = src ? src.receiver : null;
          const merged = { receiver, goods: goods.length ? goods : (src ? src.goods : []) };
          return (merged.receiver || (merged.goods && merged.goods.length)) ? merged : null;
        })(),
        total_value_php: src ? src.total_value_php : null
      };
    });
    if (!boxes.length) throw new Error('Add at least one box');
    if (boxes.some(b => !b.receiver_id)) throw new Error('Every box needs a receiver');
    if (!+shSender.value) throw new Error('Select a sender');
    // Box numbers and QR codes are what the sender walks away with, and an unpriced
    // shipment cannot be receipted or collected on later. Settle the fee before minting them.
    if (!(+shFee.value > 0)) throw new Error('Enter the shipping fee before generating box numbers — a shipment cannot be saved unpriced.');
    const [receiving_form_file, packing_list_file, uploadedPassport] = await Promise.all([
      uploadIfAny('fReceiving'), uploadIfAny('fPacking'), uploadIfAny('fPassport')
    ]);
    const passport_file = uploadedPassport || (PREFILL_INTAKE ? PREFILL_INTAKE.passport_file : null);
    if (!passport_file) throw new Error("A scanned/soft copy of the sender's passport or government ID is required");
    const s = await api('/api/shipments', {
      method: 'POST',
      body: {
        sender_id: +shSender.value, origin_country: shOrigin.value, origin_agent: shAgent.value,
        service_level: shService.value, collection: (PREFILL_INTAKE && PREFILL_INTAKE.collection) || null, shipping_fee_amount: shFee.value || null, currency: shCurrency.value,
        payment_status: shPaid.value, receiving_form_file, packing_list_file, passport_file, boxes,
        // Built for a walk-in too, not just an online booking — otherwise the printed
        // Information Sheet has no availment or sender type ticked. What the agent selects
        // overrides the booking, since they are looking at the sender's documents.
        boc: (() => {
          const availment_type = (document.getElementById('shAvailment') || {}).value || (PREFILL_INTAKE ? PREFILL_INTAKE.availment_type : '') || '';
          const sender_type = (document.getElementById('shSenderType') || {}).value || (PREFILL_INTAKE ? PREFILL_INTAKE.sender_type : '') || '';
          const base = PREFILL_INTAKE ? {
            sender: PREFILL_INTAKE.sender,
            pickup: PREFILL_INTAKE.pickup,
            total_value_php: PREFILL_INTAKE.total_value_php,
            reference_code: PREFILL_INTAKE.reference_code
          } : {};
          if (!availment_type && !sender_type && !PREFILL_INTAKE) return null;
          return { ...base, availment_type, sender_type };
        })()
      }
    });
    if (PREFILL_INTAKE) {
      await api('/api/intake-requests/' + PREFILL_INTAKE.id, { method: 'PUT', body: { status: 'CONVERTED', shipment_id: s.id } }).catch(() => {});
      PREFILL_INTAKE = null;
    }
    flash(`Shipment ${s.shipment_number} created with ${s.boxes.length} box(es)`);
    location.hash = '#/shipments/' + s.id;
  } catch (e) { showErr(e); }
}

async function pageShipmentDetail(id) {
  const s = await api('/api/shipments/' + id);
  const createdBoxes = s.boxes.filter(b => b.status === 'CREATED').length;
  view(`
    <div class="row" style="justify-content:space-between">
      <h1>${esc(s.shipment_number)}</h1>
      <div>
        <a href="#/labels/s/${s.id}"><button class="secondary">🖨 Print labels</button></a>
        ${s.payment_status === 'PAID'
          ? `<a href="#/sender-receipt/${s.id}"><button class="secondary">🧾 Official receipt</button></a>`
          : `<button class="secondary" disabled title="An official receipt can only be issued once the shipment is paid">🧾 Official receipt (unpaid)</button>`}
        <a href="#/receiving-form/${s.id}"><button class="secondary">🖨 Receiving form</button></a>
        <a href="#/packing-list/${s.id}"><button class="secondary">🖨 Packing list</button></a>
        ${canIntake() && createdBoxes ? `<button onclick="confirmOriginReceipt(${s.id})">✓ Confirm origin receipt (${createdBoxes})</button>` : ''}
      </div>
    </div>
    <div class="card form-grid">
      <div><label>Sender</label><a href="#/customers/${s.sender_id}">${esc(s.sender ? s.sender.full_name : '')}</a><div class="muted">${esc(s.sender ? s.sender.phone_primary : '')}</div></div>
      <div><label>Service level</label>${esc(svcLevelLabel(s))}</div>
      <div><label>Collection</label>${collectionBadge(s.collection)}
        <span class="muted">${s.collection === 'PICKUP' ? 'we collect from the sender'
          : s.collection === 'DROPOFF' ? 'sender brings it to the branch office' : ''}</span></div>
      <div><label>Origin</label>${esc([s.origin_agent, s.origin_country].filter(Boolean).join(', '))}</div>
      <div><label>Fee</label>${s.shipping_fee_amount != null ? esc(s.currency) + ' ' + s.shipping_fee_amount : '—'} ${payBadge(s.payment_status)}
        ${canIntake() ? `<button class="small secondary" onclick="togglePayment(${s.id}, '${s.payment_status === 'PAID' ? 'UNPAID' : 'PAID'}')">Mark ${s.payment_status === 'PAID' ? 'unpaid' : 'paid'}</button>` : ''}</div>
      <div><label>Documents</label>
        ${s.passport_file ? `<a href="${esc(s.passport_file)}" target="_blank" rel="noopener"><button class="small secondary">🪪 View passport / ID</button></a> ` : ''}
        ${s.receiving_form_file ? `<a href="${esc(s.receiving_form_file)}" target="_blank" rel="noopener"><button class="small secondary">📄 Receiving form</button></a> ` : ''}
        ${s.packing_list_file ? `<a href="${esc(s.packing_list_file)}" target="_blank" rel="noopener"><button class="small secondary">📄 Packing list</button></a>` : ''}
        ${!s.receiving_form_file && !s.packing_list_file && !s.passport_file ? '<span class="muted">None uploaded</span>' : ''}
        ${s.passport_file ? '<div class="muted" style="font-size:12px;margin-top:4px">Opens in a new tab. Only signed-in staff can fetch it — the file is never served by a public link.</div>' : ''}
      </div>
      <div><label>Created</label>${fmtDate(s.created_at)}</div>
    </div>
    <h2>Boxes (${s.boxes.length})</h2>
    <div class="card table-scroll">
      <table><tr><th>Box #</th><th>Receiver</th><th>City</th><th>Size</th><th>Status</th><th>Label</th></tr>
      ${s.boxes.map(b => `<tr>
        <td><a href="#/boxes/${b.id}">${esc(b.box_number)}</a></td>
        <td>${esc(b.receiver_name)}</td><td>${esc(b.receiver_city)}</td>
        <td>${esc(b.size_category)}</td><td>${badge(b.status)}</td>
        <td><a href="#/labels/b/${b.id}">🖨</a></td>
      </tr>`).join('')}
      </table>
    </div>`);
}
async function confirmOriginReceipt(id) {
  try {
    const r = await api(`/api/shipments/${id}/receive`, { method: 'POST' });
    flash(`${r.received} box(es) marked Received at origin — sender notified by SMS`);
    route();
  } catch (e) { showErr(e); }
}
async function togglePayment(id, status) {
  try { await api('/api/shipments/' + id, { method: 'PUT', body: { payment_status: status } }); route(); } catch (e) { showErr(e); }
}

/* ---------- labels ---------- */
async function pageLabels(kind, id) {
  let boxes, title;
  if (kind === 'shipment') {
    const s = await api('/api/shipments/' + id);
    boxes = s.boxes.map(b => ({ ...b, sender_name: s.sender ? s.sender.full_name : '' }));
    title = s.shipment_number;
  } else {
    const b = await api('/api/boxes/' + id);
    boxes = [{ ...b, sender_name: b.sender ? b.sender.full_name : '', receiver_name: b.receiver ? b.receiver.full_name : '', receiver_city: b.receiver ? b.receiver.city_municipality : '', receiver_region: b.receiver ? b.receiver.region : null }];
    title = b.box_number;
  }
  view(`
    <div class="row no-print" style="justify-content:space-between">
      <h1>Labels — ${esc(title)}</h1>
      <button onclick="window.print()" title="In the print dialog, choose “Save as PDF” · paper size Legal (8.5 × 13 in)">🖨 Print / Save as PDF</button>
    </div>
    <div class="labels-grid">
      ${boxes.map(b => `
        <div class="label-card">
          <div style="font-weight:800;letter-spacing:.5px">VFIC · VICTORS FREIGHT INTL CORP</div>
          <div class="tid">${esc(b.box_number)}</div>
          <img src="/api/qr/${esc(b.qr_token)}" alt="QR">
          <div class="muted">Scan to track</div>
          <div class="dest">FROM: ${esc(b.sender_name)}</div>
          <div class="dest">TO: ${esc(b.receiver_name)} — ${esc(b.receiver_city)}</div>
          <div>${esc(b.size_category)}${b.weight_kg ? ' · ' + b.weight_kg + ' kg' : ''}</div>
          ${b.special_instructions ? `<div class="flag">⚠ ${esc(b.special_instructions)}</div>` : ''}
          <div class="region-big">${esc(REGION_LABELS[b.region || b.receiver_region] || 'REGION TBD')}</div>
        </div>`).join('')}
    </div>`);
}

/* Printed BOC forms (Information Sheet p.1 / Packing List p.2) live in boc-forms.js */

/* ---------- Delivery Receipt (blank, travels with the truck for the receiver to sign) ---------- */
// Boxes handed over together are signed for together. Two boxes count as one consignment
// when they are for the same receiver *and* the same address — same person at a different
// address is a separate delivery, so the address is part of the key, not just the id.
function groupBoxesByConsignee(boxes) {
  const norm = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const keyOf = (b) => {
    const r = b.receiver || {};
    return [
      b.receiver_id || r.id || norm(r.full_name),
      norm(r.address_line), norm(r.barangay), norm(r.city_municipality), norm(r.province)
    ].join('|');
  };
  const groups = [];
  const index = new Map();
  for (const b of boxes) {
    const k = keyOf(b);
    if (index.has(k)) groups[index.get(k)].push(b);
    else { index.set(k, groups.length); groups.push([b]); }
  }
  return groups;
}
// One receipt per consignment, not per box: several boxes going to the same person at the
// same address are handed over together and signed for once. `boxes` is that group.
function truckReceiptBlockHtml(boxes, trip, isLast) {
  const list = Array.isArray(boxes) ? boxes : [boxes];
  const box = list[0];
  const r = box.receiver || {};
  const multi = list.length > 1;
  return `
    <div class="receipt" style="${isLast ? '' : 'page-break-after:always'}">
      <div class="rc-head">
        <div>
          <div class="rc-company">VICTORS FREIGHT INTERNATIONAL CORPORATION</div>
          <div class="rc-title">DELIVERY RECEIPT</div>
          <div class="rc-meta">
            To be signed by the receiver upon delivery<br>
            Trip: <b>${esc(trip ? trip.trip_number : '—')}</b> · Date: ${fmtDay(trip ? trip.scheduled_date : null)}<br>
            Driver: <b>${esc(trip ? trip.driver_name : '—')}</b>${trip && trip.driver_contact ? ' (' + esc(trip.driver_contact) + ')' : ''}${trip && trip.plate_number ? ' · Plate ' + esc(trip.plate_number) : ''}
          </div>
        </div>
        <div class="rc-qr">
          <img src="/api/qr/${esc(box.qr_token)}" alt="QR">
          <div class="rc-tid">${esc(box.box_number)}${multi ? ` +${list.length - 1} more` : ''}</div>
        </div>
      </div>
      <div class="rc-parties">
        <div class="rc-box">
          <div class="rc-label">FROM (SENDER)</div>
          <div class="rc-line"><span>Name</span>${esc(box.sender_name || '')}</div>
        </div>
        <div class="rc-box">
          <div class="rc-label">TO (RECEIVER)</div>
          <div class="rc-line"><span>Name</span>${esc(r.full_name || '')}</div>
          <div class="rc-line"><span>Phone</span>${esc(r.phone_primary || '')}${r.phone_alternate ? ' / ' + esc(r.phone_alternate) : ''}</div>
          <div class="rc-line"><span>Address</span>${esc([r.address_line, r.barangay, r.city_municipality, r.province].filter(Boolean).join(', '))}</div>
          ${r.landmark ? `<div class="rc-line"><span>Landmark</span>${esc(r.landmark)}</div>` : ''}
        </div>
      </div>
      ${multi ? `
      <div class="rc-details" style="display:block">
        <div class="rc-label" style="margin-bottom:4px">${list.length} BOXES IN THIS DELIVERY</div>
        <table class="rc-boxes"><tr><th>#</th><th>Box number</th><th>Load code</th><th>Size</th><th>Weight</th><th>Received ✓</th></tr>
          ${list.map((b, i) => `<tr>
            <td>${i + 1}</td>
            <td>${esc(b.box_number)}</td>
            <td>${esc(b.container_load_code || '—')}</td>
            <td>${esc(b.size_category || '—')}</td>
            <td>${b.weight_kg ? b.weight_kg + ' kg' : '—'}</td>
            <td class="rc-tick">☐</td>
          </tr>`).join('')}
        </table>
        ${list.some(b => b.special_instructions)
          ? `<div class="rc-line" style="margin-top:6px"><span>Instructions</span>${esc(list.map(b => b.special_instructions).filter(Boolean).join(' · '))}</div>`
          : ''}
      </div>` : `
      <div class="rc-details">
        <div class="rc-cell"><span>Box #</span>${esc(box.box_number)}</div>
        <div class="rc-cell"><span>Load code</span>${esc(box.container_load_code || '—')}</div>
        <div class="rc-cell"><span>Size</span>${esc(box.size_category || '—')}</div>
        <div class="rc-cell"><span>Weight</span>${box.weight_kg ? box.weight_kg + ' kg' : '—'}</div>
        <div class="rc-cell"><span>Instructions</span>${esc(box.special_instructions || '—')}</div>
      </div>`}
      <div class="rc-terms">
        I acknowledge receipt of the ${multi ? `${list.length} balikbayan boxes listed above` : 'balikbayan box listed above'}, delivered by Victors Freight International Corporation (VFIC),
        in good order and condition unless otherwise noted below.
      </div>
      <div class="rc-sign">
        <div><div class="rc-sigline"></div>Receiver signature over printed name & date/time</div>
        <div><div class="rc-sigline"></div>Driver signature over printed name</div>
      </div>
      <div class="rc-terms" style="margin-top:8px">
        <b>If undeliverable</b>, indicate reason: ☐ Unreachable ☐ Address not found ☐ Receiver absent ☐ Refused ☐ Other: ______________________
      </div>
    </div>`;
}
async function pageTruckReceipt(kind, id) {
  let boxes, trip, title;
  if (kind === 'trip') {
    trip = await api('/api/trips/' + id);
    boxes = trip.boxes;
    title = trip.trip_number;
  } else {
    const b = await api('/api/boxes/' + id);
    trip = b.trip;
    title = b.box_number;
    // Printing from one box still has to produce the receipt for the whole doorstep. The
    // driver hands over everything for that address at once and gets one signature, so pull
    // in this box's companions on the same trip rather than printing it alone.
    boxes = [b];
    if (trip && trip.id) {
      try {
        const full = await api('/api/trips/' + trip.id);
        const mine = groupBoxesByConsignee(full.boxes || []).find(g => g.some(x => x.id === b.id));
        if (mine && mine.length > 1) {
          boxes = mine;
          title = `${b.box_number} +${mine.length - 1}`;
        }
      } catch (e) { /* trip unreadable — fall back to the single box */ }
    }
  }
  const groups = groupBoxesByConsignee(boxes);
  view(`
    <div class="row no-print" style="justify-content:space-between">
      <h1>Delivery Receipt${groups.length > 1 ? 's' : ''} — ${esc(title)}</h1>
      <button onclick="window.print()" title="In the print dialog, choose “Save as PDF” · paper size Legal (8.5 × 13 in)">🖨 Print / Save as PDF</button>
    </div>
    <div class="muted no-print" style="margin-bottom:10px">
      Print and send with the driver, for the receiver to sign on delivery.
      Boxes going to the same person at the same address share one receipt${groups.length !== boxes.length ? ` — ${boxes.length} box(es) on ${groups.length} receipt(s)` : ''}.
    </div>
    ${groups.length ? groups.map((g, i) => truckReceiptBlockHtml(g, kind === 'trip' ? trip : g[0].trip, i === groups.length - 1)).join('')
      : '<div class="card muted">No boxes to print.</div>'}`);
}

/* ---------- Proof of Delivery (internal record: printed after outcome recorded, embeds POD photos) ---------- */
async function pageDeliveryReceipt(boxId) {
  const b = await api('/api/boxes/' + boxId);
  const attempt = [...b.attempts].reverse().find(a => a.outcome === 'DELIVERED');
  if (!attempt) {
    view(`<h1>Proof of Delivery</h1><div class="card error">Box ${esc(b.box_number)} has no recorded delivery yet. Record the delivery outcome first.</div>
      <a href="#/boxes/${b.id}"><button class="secondary">← Back to box</button></a>`);
    return;
  }
  const r = b.receiver || {};
  view(`
    <div class="row no-print" style="justify-content:space-between">
      <h1>Proof of Delivery — ${esc(b.box_number)}</h1>
      <div><button onclick="window.print()" title="In the print dialog, choose “Save as PDF” · paper size Legal (8.5 × 13 in)">🖨 Print / Save as PDF</button> <a href="#/boxes/${b.id}"><button class="secondary">← Back to box</button></a></div>
    </div>
    <div class="muted no-print" style="margin-bottom:10px">Internal record for VFIC's files — generated after the outcome is recorded. For the document the driver carries and the receiver signs at the door, see <a href="#/truck-receipt/b/${b.id}">Delivery Receipt</a>.</div>
    <div class="receipt">
      <div class="rc-company">VICTORS FREIGHT INTERNATIONAL CORPORATION</div>
      <div class="rc-title">PROOF OF DELIVERY — INTERNAL RECORD</div>
      <div class="rc-meta">
        Box #: <b>${esc(b.box_number)}</b> · Delivered: <b>${fmtDate(attempt.attempted_at)}</b>
      </div>
      <div class="rc-parties">
        <div class="rc-box">
          <div class="rc-label">SENDER</div>
          <div class="rc-line"><span>Name</span>${esc(b.sender ? b.sender.full_name : '')}</div>
          <div class="rc-line"><span>Phone</span>${esc(b.sender ? b.sender.phone_primary : '')}</div>
        </div>
        <div class="rc-box">
          <div class="rc-label">RECEIVER</div>
          <div class="rc-line"><span>Name</span>${esc(r.full_name || '')}</div>
          <div class="rc-line"><span>Phone</span>${esc(r.phone_primary || '')}</div>
          <div class="rc-line"><span>Address</span>${esc([r.address_line, r.barangay, r.city_municipality, r.province].filter(Boolean).join(', '))}</div>
          ${r.landmark ? `<div class="rc-line"><span>Landmark</span>${esc(r.landmark)}</div>` : ''}
        </div>
      </div>
      <div class="rc-line"><span>Received by</span><b>${esc(attempt.received_by_name || '')}</b></div>
      ${b.trip ? `<div class="rc-line"><span>Driver / trip</span>${esc(b.trip.driver_name)} (${esc(b.trip.driver_contact)}) · ${esc(b.trip.trip_number)}${b.trip.plate_number ? ' · Plate ' + esc(b.trip.plate_number) : ''}</div>` : ''}
      ${attempt.notes ? `<div class="rc-line"><span>Notes</span>${esc(attempt.notes)}</div>` : ''}
      ${attempt.recorded_by_driver ? `<div class="pod-provisional">
        Recorded at the door by <b>${esc(attempt.recorded_by_driver)}</b> on a driver pass.${
          attempt.photos_pending
            ? ' The signed receipt and receiver photos are not attached yet — this is not complete proof until they are.'
            : ''}
      </div>` : ''}
      <div class="rc-label" style="margin-top:14px">REQUIRED PHOTO EVIDENCE</div>
      <div class="rc-photos">
        <div>
          <div class="muted" style="font-size:11px;margin-bottom:4px">SIGNED RECEIPT</div>
          ${attempt.pod_receipt_photo
            ? `<a href="${esc(attempt.pod_receipt_photo)}" target="_blank"><img src="${esc(attempt.pod_receipt_photo)}" alt="Signed receipt"></a>`
            : `<div class="muted" style="width:150px;height:150px;border:1px dashed var(--border);display:flex;align-items:center;justify-content:center;text-align:center">No photo on file</div>`}
        </div>
        <div>
          <div class="muted" style="font-size:11px;margin-bottom:4px">RECEIVER WITH BOX(ES)</div>
          ${attempt.pod_receiver_photo
            ? `<a href="${esc(attempt.pod_receiver_photo)}" target="_blank"><img src="${esc(attempt.pod_receiver_photo)}" alt="Receiver with box"></a>`
            : `<div class="muted" style="width:150px;height:150px;border:1px dashed var(--border);display:flex;align-items:center;justify-content:center;text-align:center">No photo on file</div>`}
        </div>
      </div>
    </div>`);
}

/* ---------- boxes ---------- */
async function pageBoxes() {
  const q = hashQuery();
  const params = new URLSearchParams();
  for (const k of ['status', 'region', 'q']) if (q.get(k)) params.set(k, q.get(k));
  const list = await api('/api/boxes?' + params.toString());
  view(`
    <div class="row" style="justify-content:space-between;align-items:center">
      <h1>Boxes</h1>
      ${canSeeBranchStock() ? `<a href="#/branch-office-doc"><button class="secondary">📋 Branch office stock report</button></a>` : ''}
    </div>
    <div class="card row">
      <input id="bq" placeholder="Search box #, sender, receiver, phone…" style="max-width:280px" value="${esc(q.get('q') || '')}">
      <select id="bstatus" style="max-width:210px"><option value="">All statuses</option>
        ${PIPELINE.map(s => `<option value="${s}" ${q.get('status') === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}</select>
      <select id="bregion" style="max-width:210px"><option value="">All regions</option>
        ${regionOptions(q.get('region'))}</select>
      <button class="small" onclick="boxFilter()">Filter</button>
    </div>
    <div class="card table-scroll">
      <table><tr><th>Box #</th><th>Load code</th><th>Sender</th><th>Receiver</th><th>City</th><th>Region</th><th>Status</th><th>Updated</th></tr>
      ${list.map(b => `<tr>
        <td><a href="#/boxes/${b.id}">${esc(b.box_number)}</a></td>
        <td>${b.container_load_code
          ? `<a href="#/containers/${b.container_id}"><span class="badge st-loaded">${esc(b.container_load_code)}</span></a>`
          : '<span class="muted">not loaded</span>'}</td>
        <td>${esc(b.sender_name)}</td><td>${esc(b.receiver_name)}</td><td>${esc(b.receiver_city)}</td>
        <td>${regionBadge(b.region || b.receiver_region)}</td><td>${badge(b.status)}</td><td>${fmtDay(b.status_updated_at)}</td>
      </tr>`).join('') || '<tr><td colspan="8" class="muted">No boxes match</td></tr>'}
      </table>
      <div class="muted">${list.length} box(es)</div>
    </div>`);
  document.getElementById('bq').addEventListener('keydown', e => { if (e.key === 'Enter') boxFilter(); });
}
function boxFilter() {
  const p = new URLSearchParams();
  if (bq.value) p.set('q', bq.value);
  if (bstatus.value) p.set('status', bstatus.value);
  if (bregion.value) p.set('region', bregion.value);
  location.hash = '#/boxes?' + p.toString();
}

async function pageBoxDetail(id) {
  const b = await api('/api/boxes/' + id);
  const r = b.receiver || {};
  const nexts = (NEXT_STATUS[b.status] || []).filter(s => {
    if (ME.role === 'WAREHOUSE') return ['RECEIVED_WAREHOUSE', 'SORTED'].includes(s);
    if (['DELIVERED', 'RETURNED'].includes(s)) return false; // POD flow below
    if (s === 'ASSIGNED') return false; // via trips
    return true;
  });
  const receiverRegion = r.region || '';
  view(`
    <div class="row" style="justify-content:space-between">
      <h1>${esc(b.box_number)} ${badge(b.status)}</h1>
      <div>
        <a href="#/labels/b/${b.id}"><button class="secondary">🖨 Label</button></a>
        ${['ASSIGNED', 'LOADED_TRUCK', 'OUT_FOR_DELIVERY'].includes(b.status) ? `<a href="#/truck-receipt/b/${b.id}"><button class="secondary">🖨 Delivery receipt (for driver)</button></a>` : ''}
        ${b.status === 'DELIVERED' ? `<a href="#/delivery-receipt/${b.id}"><button class="secondary">🖨 Proof of delivery</button></a>` : ''}
      </div>
    </div>
    <div class="card form-grid">
      <div><label>Shipment</label><a href="#/shipments/${b.shipment_id}">${esc(b.shipment ? b.shipment.shipment_number : '')}</a> ${b.shipment ? payBadge(b.shipment.payment_status) : ''}</div>
      <div><label>Sender</label>${b.sender ? `<a href="#/customers/${b.sender.id}">${esc(b.sender.full_name)}</a><div class="muted">${esc(b.sender.phone_primary)}</div>` : '—'}</div>
      <div><label>Receiver</label>${r.id ? `<a href="#/customers/${r.id}">${esc(r.full_name)}</a><div class="muted">${esc(r.phone_primary)}${r.phone_alternate ? ' / ' + esc(r.phone_alternate) : ''}</div>` : '—'}</div>
      <div><label>Address</label><div class="muted">${esc([r.address_line, r.barangay, r.city_municipality, r.province].filter(Boolean).join(', '))}</div>
        ${r.landmark ? `<div class="muted">📍 ${esc(r.landmark)}</div>` : ''}</div>
      <div><label>Region</label>${regionBadge(b.region || r.region)}</div>
      <div><label>Size / weight</label>${esc(b.size_category)}${b.weight_kg ? ' · ' + b.weight_kg + ' kg' : ''}
        ${b.length_cm ? `<div class="muted">${b.length_cm}×${b.width_cm}×${b.height_cm} cm</div>` : ''}</div>
      <div><label>Contents</label><div class="muted">${esc(b.declared_contents || '—')}</div>
        ${(b.packing_list_items || []).length ? `<ul style="margin:4px 0 0 18px;padding:0;font-size:13px;color:var(--muted)">${b.packing_list_items.map(it => `<li>${esc(it.description)}${it.qty ? ' — ' + esc(it.qty) : ''}</li>`).join('')}</ul>` : ''}</div>
      <div><label>Special instructions</label><div class="muted">${esc(b.special_instructions || '—')}</div></div>
      <div><label>Container</label>${b.container ? `<a href="#/containers/${b.container.id}">${esc(b.container.container_number)}</a>` : '—'}</div>
      <div><label>Trip</label>${b.trip ? `<a href="#/trips/${b.trip.id}">${esc(b.trip.trip_number)}</a> (${esc(b.trip.driver_name)})` : '—'}</div>
      <div><label>Public tracking</label><a href="/track.html?t=${esc(b.qr_token)}" target="_blank">Open tracking page →</a></div>
    </div>

    <div class="card">
      <h2 style="margin-top:0">Actions</h2>
      <div class="inline-actions">
        ${nexts.map(s => s === 'SORTED'
          ? `<select id="sortRegion" style="max-width:220px">${regionOptions(receiverRegion)}</select>
             <button onclick="doStatus(${b.id}, 'SORTED', '', document.getElementById('sortRegion').value)">→ Sorted</button>`
          : `<button onclick="doStatus(${b.id}, '${s}')">→ ${STATUS_LABELS[s]}</button>`).join('')}
        ${canCancelBox(b.status) ? `<button class="danger" onclick="cancelBox(${b.id}, '${esc(b.box_number)}')">✗ Cancel box</button>` : ''}
        ${R_AGENTS.concat(['WAREHOUSE']).includes(ME.role) && b.events.length > 1 ? `<button class="secondary" onclick="revertBox(${b.id}, '${esc(STATUS_LABELS[b.events[b.events.length - 1].to_status] || b.status)}', '${esc(STATUS_LABELS[b.events[b.events.length - 1].from_status] || '')}')" title="Undo a mis-clicked Action">↩ Undo last action</button>` : ''}
        ${!nexts.length && b.status !== 'OUT_FOR_DELIVERY' ? '<span class="muted">No forward actions available at this status.</span>' : ''}
      </div>
      ${b.status === 'OUT_FOR_DELIVERY' ? podFormHtml(b.id) : ''}
    </div>

    <h2>Status timeline</h2>
    <div class="card">
      <ul class="timeline">
        ${b.events.slice().reverse().map((e, i) => `
          <li class="${i === 0 ? 'current' : ''}">
            <div class="t-status">${esc(STATUS_LABELS[e.to_status] || e.to_status)}</div>
            <div class="t-meta">${fmtDate(e.created_at)} · ${esc(e.actor)}</div>
            ${e.note ? `<div class="t-note">${esc(e.note)}</div>` : ''}
          </li>`).join('')}
      </ul>
    </div>

    ${b.attempts.length ? `<h2>Delivery attempts</h2>
    <div class="card">
      ${b.attempts.map(a => `
        <div style="border-bottom:1px solid var(--border);padding:8px 0">
          <b>Attempt ${a.attempt_number}</b> — ${a.outcome === 'DELIVERED' ? badge('DELIVERED') : badge('RETURNED') + ' ' + esc(FAILURE_REASONS[a.failure_reason] || '')}
          <span class="muted">${fmtDate(a.attempted_at)}</span>
          ${a.received_by_name ? `<div>Received by: <b>${esc(a.received_by_name)}</b></div>` : ''}
          ${a.notes ? `<div class="muted">${esc(a.notes)}</div>` : ''}
          <div class="photo-grid" style="margin-top:6px">
            ${a.pod_receipt_photo ? `<a href="${esc(a.pod_receipt_photo)}" target="_blank"><img src="${esc(a.pod_receipt_photo)}" alt="POD receipt"></a>` : ''}
            ${a.pod_receiver_photo ? `<a href="${esc(a.pod_receiver_photo)}" target="_blank"><img src="${esc(a.pod_receiver_photo)}" alt="Receiver with box"></a>` : ''}
          </div>
        </div>`).join('')}
    </div>` : ''}

    <h2>SMS log</h2>
    <div class="card table-scroll">
      <table><tr><th>When</th><th>To</th><th>Role</th><th>Message</th><th>Status</th></tr>
      ${b.notifications.map(n => `<tr><td>${fmtDate(n.created_at)}</td><td>${esc(n.recipient_phone)}</td><td>${esc(n.recipient_role)}</td><td class="wrap-cell" style="max-width:380px">${esc(n.message_body)}</td><td>${badge(n.status)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">None</td></tr>'}
      </table>
    </div>`);
  if (window.wireNameCase) wireNameCase('podName');
}
async function doStatus(id, status, note = '', region = null) {
  try {
    await api(`/api/boxes/${id}/status`, { method: 'POST', body: { status, note, region } });
    flash(`Status → ${STATUS_LABELS[status]}`);
    route();
  } catch (e) { showErr(e); }
}
async function cancelBox(id, boxNumber) {
  const reason = await confirmAction({
    title: 'Cancel this box?',
    body: `<p>${boxNumber ? '<b>' + esc(boxNumber) + '</b> is' : 'This box is'} taken out of the shipment.
             It stops moving through the pipeline and will not be delivered.</p>
           <p class="muted">The reason is kept on the box's history, so whoever asks later can
             see why it stopped.</p>`,
    prompt: { label: 'Why is it being cancelled?', placeholder: 'e.g. Sender withdrew the booking',
              requiredMessage: 'A reason is required — it goes on the record.' },
    confirmLabel: 'Cancel the box', cancelLabel: 'Keep it', danger: true
  });
  if (!reason) return;
  await doStatus(id, 'CANCELLED', reason);
}
async function revertBox(id, lastLabel, backTo) {
  const ok = await confirmAction({
    title: 'Undo the last action?',
    body: `<p>${lastLabel ? `This removes <b>${esc(lastLabel)}</b> from the box's history` : "This removes the box's last step"}${backTo ? ` and puts it back to <b>${esc(backTo)}</b>` : ''}.</p>
           <p class="muted">The step disappears from the timeline rather than being marked undone, so use it for a mis-click rather than to record a change of plan.</p>`,
    confirmLabel: 'Undo it', cancelLabel: 'Leave it', danger: true
  });
  if (!ok) return;
  try {
    const b = await api(`/api/boxes/${id}/revert`, { method: 'POST' });
    flash(`Reverted to ${STATUS_LABELS[b.status] || b.status}`);
    route();
  } catch (e) { showErr(e); }
}

function podFormHtml(boxId) {
  return `
    <div class="pod-form">
      <b>Record delivery outcome</b>
      <div class="form-grid">
        <div><label>Outcome</label>
          <select id="podOutcome" onchange="document.getElementById('podDelivered').style.display=this.value==='DELIVERED'?'':'none';document.getElementById('podFailed').style.display=this.value==='FAILED'?'':'none'">
            <option value="DELIVERED">DELIVERED</option><option value="FAILED">FAILED</option>
          </select></div>
      </div>
      <div id="podDelivered">
        <div class="form-grid">
          <div><label>Received by (name) *</label><input id="podName"></div>
          <div><label>Signed receipt photo *</label><input id="podReceipt" type="file" accept="image/*" capture="environment"></div>
          <div><label>Receiver-with-box photo *</label><input id="podReceiver" type="file" accept="image/*" capture="environment"></div>
        </div>
      </div>
      <div id="podFailed" style="display:none">
        <label>Failure reason *</label>
        <select id="podReason">${Object.entries(FAILURE_REASONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      </div>
      <label>Notes</label><input id="podNotes">
      <button onclick="submitPod(${boxId})">Save outcome</button>
      <div class="muted">DELIVERED sends SMS to sender + receiver. FAILED returns the box to the warehouse pool and notifies the receiver.</div>
    </div>`;
}
async function submitPod(boxId) {
  try {
    const fd = new FormData();
    const outcome = document.getElementById('podOutcome').value;
    fd.append('outcome', outcome);
    fd.append('notes', document.getElementById('podNotes').value);
    if (outcome === 'DELIVERED') {
      fd.append('received_by_name', document.getElementById('podName').value);
      const rec = document.getElementById('podReceipt'), rcv = document.getElementById('podReceiver');
      if (rec.files[0]) fd.append('pod_receipt_photo', rec.files[0]);
      if (rcv.files[0]) fd.append('pod_receiver_photo', rcv.files[0]);
    } else {
      fd.append('failure_reason', document.getElementById('podReason').value);
    }
    await api(`/api/boxes/${boxId}/delivery-attempts`, { method: 'POST', body: fd });
    if (outcome === 'DELIVERED') {
      flash('Delivered! SMS sent to sender and receiver. Print the delivery receipt for your records.');
      location.hash = '#/delivery-receipt/' + boxId;
    } else {
      flash('Marked failed — box returned to warehouse pool.');
      route();
    }
  } catch (e) { showErr(e); }
}

/* ---------- containers ---------- */
async function pageContainers() {
  const [list, ref] = await Promise.all([
    api('/api/containers'),
    canIntake() ? api('/api/refdata') : Promise.resolve({ shipping_lines: [], origin_ports: [], destination_ports: [] })
  ]);
  // Preview of the code the server will mint — sequenced per origin, so it must count only
  // this branch's containers or it would promise a number the server does not assign.
  const myPrefix = { Thailand: 'TH', Cambodia: 'KH' }[myOriginCountry()] || 'VF';
  const codeRe = new RegExp('^' + myPrefix + '-C(\\d+)$');
  const nextCode = myPrefix + '-C' + (list.reduce((m, c) => {
    const n = codeRe.exec(c.load_code || ''); return n ? Math.max(m, +n[1]) : m;
  }, 0) + 1);
  // Proper <select> dropdowns (origin ports stay grouped by country/region).
  const lineOpts = `<option value="">— select shipping line —</option>` +
    (ref.shipping_lines || []).map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  const originOpts = `<option value="">— select origin port —</option>` +
    (ref.origin_ports || []).map(g =>
      `<optgroup label="${esc(g.group)}">${(g.ports || []).map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}</optgroup>`).join('');
  const destOpts = (ref.destination_ports || []).map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  // Containers are booked at origin. A head-office user has no origin to book from.
  const canBook = canIntake() && (!MY || !MY.branch || MY.branch.key !== "HQ_MANILA");
  view(`
    <h1>Containers</h1>
    ${!canBook && canIntake() ? `<div class="note-info" style="margin-bottom:12px">Containers are booked by the origin branch (Thailand or Cambodia). Head office consolidates and tracks them here.</div>` : ""}
    ${canBook ? `
    <details class="collapse card" id="cnBook" ${hashQuery().get('at') === 'cnBook' ? 'open' : ''}><summary>+ Book new container</summary>
      <div class="form-grid" style="margin-top:8px">
        <div><label>Container number *</label><input id="cnNumber" placeholder="MSCU1234567"></div>
        <div><label>Size</label><select id="cnSize">
          <option value="C40">40 ft</option>
          <option value="C40HQ">40 ft HQ</option>
          <option value="C20">20 ft</option>
        </select></div>
        <div><label>Load code <span class="muted">(auto)</span></label><input value="${esc(nextCode)}" disabled title="Assigned automatically in sequence"></div>
        <div><label>Shipping line</label><select id="cnLine">${lineOpts}</select></div>
        <div><label>Vessel</label><input id="cnVessel"></div>
        <div><label>Booking #</label><input id="cnBooking"></div>
        <div><label>Origin port</label><select id="cnOrigin">${originOpts}</select></div>
        <div><label>Destination port</label><select id="cnDest">${destOpts}</select></div>
        <div><label>ETD</label><input id="cnEtd" type="date"></div>
        <div><label>ETA</label><input id="cnEta" type="date"></div>
      </div>
      <button onclick="createContainer()">Book container</button>
    </details>` : ''}
    <div class="card table-scroll">
      <table><tr><th>Container</th><th>Size</th><th>Load code</th><th>Line / vessel</th><th>Route</th><th>Boxes</th><th>ETA</th><th>Status</th></tr>
      ${list.map(c => `<tr>
        <td><a href="#/containers/${c.id}">${esc(c.container_number)}</a></td>
        <td>${esc(CONTAINER_SIZE_LABELS[c.size] || c.size)}</td>
        <td>${c.load_code ? `<span class="badge st-created">${esc(c.load_code)}</span>` : '<span class="muted">—</span>'}</td>
        <td>${esc([c.shipping_line, c.vessel_name].filter(Boolean).join(' / '))}</td>
        <td>${esc([c.origin_port, c.destination_port].filter(Boolean).join(' → '))}</td>
        <td>${c.box_count}</td>
        <td>${fmtDay(c.eta)}</td><td>${badge(c.status)}</td>
      </tr>`).join('') || '<tr><td colspan="8" class="muted">None</td></tr>'}
      </table>
    </div>`);
}
async function createContainer() {
  try {
    const c = await api('/api/containers', {
      method: 'POST',
      body: { container_number: cnNumber.value, size: cnSize.value, shipping_line: cnLine.value, vessel_name: cnVessel.value, booking_number: cnBooking.value, origin_port: cnOrigin.value, destination_port: cnDest.value, etd: cnEtd.value || null, eta: cnEta.value || null }
    });
    flash(`Container ${c.container_number} booked`);
    location.hash = '#/containers/' + c.id;
  } catch (e) { showErr(e); }
}

async function pageContainerDetail(id) {
  const c = await api('/api/containers/' + id);
  const loadable = ['BOOKING', 'LOADING'].includes(c.status) && canIntake();
  const strippable = ['ARRIVED', 'AT_CUSTOMS', 'RELEASED'].includes(c.status) && R_ADMINS.concat(['CONSIGNEE_AGENT','WAREHOUSE']).includes(ME.role);
  view(`
    <div class="row" style="justify-content:space-between">
      <h1>${esc(c.container_number)} ${badge(c.status)}</h1>
      <div>
        ${canIntake() && ['LOADING', 'BOOKING'].includes(c.status) ? `<button onclick="containerAction(${c.id}, 'depart', 'Container departed — loaded boxes now In Transit')">🚢 Mark departed</button>` : ''}
        ${c.status === 'IN_TRANSIT' && isAgent() ? `<button onclick="containerAction(${c.id}, 'arrive', 'Container arrived — receivers notified by SMS')">⚓ Mark arrived</button>` : ''}
        ${['ARRIVED', 'AT_CUSTOMS'].includes(c.status) && isAgent() ? `
          <button class="secondary" onclick="setContainerStatus(${c.id}, '${c.status === 'ARRIVED' ? 'AT_CUSTOMS' : 'RELEASED'}')">→ ${c.status === 'ARRIVED' ? 'At customs' : 'Released'}</button>` : ''}
        ${isAgent() && c.status !== 'BOOKING' ? `<button class="secondary danger" onclick="containerRevert(${c.id}, '${esc(c.status)}')" title="Undo a mis-clicked status">↩ Revert status</button>` : ''}
      </div>
    </div>
    <div class="card form-grid">
      <div><label>Size</label>${esc(c.size_label || CONTAINER_SIZE_LABELS[c.size] || c.size)}</div>
      <div><label>Load code</label>${c.load_code ? `<span class="badge st-created">${esc(c.load_code)}</span> <span class="muted">appended to box numbers</span>` : '—'}</div>
      <div><label>Line / vessel</label>${esc([c.shipping_line, c.vessel_name].filter(Boolean).join(' / '))}</div>
      <div><label>Booking</label>${esc(c.booking_number || '—')}</div>
      <div><label>Route</label>${esc([c.origin_port, c.destination_port].filter(Boolean).join(' → '))}</div>
      <div><label>ETD / ETA</label>${fmtDay(c.etd)} → ${fmtDay(c.eta)}</div>
      <div><label>Departed / arrived</label>${fmtDay(c.actual_departure)} → ${fmtDay(c.actual_arrival)}</div>
      <div><label>Boxes loaded</label><b>${c.boxes.length}</b></div>
    </div>

    <h2>Load plan &amp; manifest</h2>
    <div class="card" id="loadPlan">Loading…</div>

    ${loadable ? `
    <h2>Load boxes (scan or pick)</h2>
    ${scannerHtml('Scan a box QR to load it into this container')}
    <div class="card" id="loadPick">Loading…</div>` : ''}

    ${strippable ? `
    <h2>Warehouse stripping (scan each box)</h2>
    ${scannerHtml('Scan each box as it comes off the container — marks it Received at warehouse')}
    <div class="card">
      <b>Discrepancy — on manifest, not yet scanned (${c.pending_strip.length}):</b>
      <div class="muted wrap-cell">${c.pending_strip.map(esc).join(', ') || 'None — all boxes scanned ✓'}</div>
    </div>` : ''}

    <h2>Manifest (${c.boxes.length} boxes)</h2>
    <div class="card table-scroll">
      <table><tr><th>Box #</th><th>Sender</th><th>Receiver</th><th>City</th><th>Status</th></tr>
      ${c.boxes.map(b => `<tr>
        <td><a href="#/boxes/${b.id}">${esc(b.box_number)}</a></td>
        <td>${esc(b.sender_name)}</td><td>${esc(b.receiver_name)}</td><td>${esc(b.receiver_city)}</td><td>${badge(b.status)}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">No boxes loaded yet</td></tr>'}
      </table>
    </div>
    <h2>Arrival notice — document bundle</h2>
    <div class="card table-scroll">
      <table><tr><th>Shipment</th><th>Sender</th><th>Packing list</th><th>Passport/ID</th><th>Receiving form</th></tr>
      ${c.documents.map(doc => `<tr>
        <td>${esc(doc.shipment_number)}</td><td>${esc(doc.sender_name)}</td>
        <td>${doc.packing_list_file ? `<a href="${esc(doc.packing_list_file)}" target="_blank">Download</a>` : '<span class="muted">—</span>'}</td>
        <td>${doc.passport_file ? `<a href="${esc(doc.passport_file)}" target="_blank">Download</a>` : '<span class="muted">—</span>'}</td>
        <td>${doc.receiving_form_file ? `<a href="${esc(doc.receiving_form_file)}" target="_blank">Download</a>` : '<span class="muted">—</span>'}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">No documents</td></tr>'}
      </table>
    </div>`);

  renderLoadPlan(c.id);

  if (loadable) {
    setScanHandler(async code => {
      const box = await lookupBox(code);
      const r = await api(`/api/containers/${c.id}/load`, { method: 'POST', body: { box_id: box.id } });
      scanFeedback(`<div class="scan-last"><div class="big">✓ ${esc(r.box.box_number)} loaded</div><div class="scan-count">${r.box_count}</div><div class="muted">boxes in container</div></div>`);
    });
    const all = await api('/api/boxes?status=RECEIVED_ORIGIN');
    document.getElementById('loadPick').innerHTML = `
      <b>Boxes received at origin, ready to load (${all.length}):</b>
      <div class="table-scroll"><table><tr><th>Box #</th><th>Sender</th><th>Receiver</th><th></th></tr>
      ${all.map(b => `<tr><td>${esc(b.box_number)}</td><td>${esc(b.sender_name)}</td><td>${esc(b.receiver_name)}</td>
        <td><button class="small" onclick="loadBoxToContainer(${c.id}, ${b.id})">Load</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">None ready</td></tr>'}
      </table></div>`;
  } else if (strippable) {
    setScanHandler(async code => {
      const box = await lookupBox(code);
      const r = await api(`/api/containers/${c.id}/strip-scan`, { method: 'POST', body: { box_id: box.id } });
      scanFeedback(`<div class="scan-last ${r.off_manifest ? 'warn' : ''}">
        <div class="big">${r.off_manifest ? '⚠ NOT ON MANIFEST — ' : '✓ '}${esc(r.box.box_number)} received</div>
        <div class="scan-count">${r.remaining}</div><div class="muted">still to strip</div></div>`);
    });
  }
}
// Printable container manifest, grouped by destination region (for the consignee agent).
async function pageContainerManifest(containerId) {
  const [c, p] = await Promise.all([
    api('/api/containers/' + containerId),
    api(`/api/containers/${containerId}/load-plan`)
  ]);
  view(`
    <div class="row no-print" style="justify-content:space-between">
      <h1>Container Manifest — ${esc(c.container_number)}</h1>
      <button onclick="window.print()" title="In the print dialog, choose “Save as PDF” · paper size Legal (8.5 × 13 in)">🖨 Print / Save as PDF</button>
    </div>
    <div class="manifest">
      <div class="rc-company">VICTORS FREIGHT INTERNATIONAL CORPORATION</div>
      <div class="rc-title">CONTAINER LOAD MANIFEST — ${esc(c.container_number)}</div>
      <div class="rc-meta">
        Size: <b>${esc(p.size_label)}</b> · Load code: <b>${esc(p.load_code || '—')}</b> ·
        Vessel: <b>${esc(c.vessel_name || '—')}</b> · Booking: <b>${esc(c.booking_number || '—')}</b><br>
        Route: <b>${esc([c.origin_port, c.destination_port].filter(Boolean).join(' → '))}</b> ·
        ETD ${fmtDay(c.etd)} → ETA ${fmtDay(c.eta)} · Status: <b>${esc(c.status)}</b><br>
        Total: <b>${p.total_boxes}</b> box(es), <b>${p.total_weight_kg} kg</b>
      </div>
      ${p.load_plan_notes ? `<div class="rc-terms" style="margin:8px 0"><b>Load / discharge plan:</b> ${esc(p.load_plan_notes)}</div>` : ''}
      ${p.by_region.map(g => `
        <div class="rc-label" style="margin-top:12px">${esc(g.region === 'UNASSIGNED' ? 'NOT YET SORTED' : (REGION_LABELS[g.region] || g.region))} — ${g.box_count} box(es), ${g.total_weight_kg} kg</div>
        <table class="rc-table">
          <tr><th>#</th><th>Box number</th><th>Receiver</th><th>City</th><th>Size</th><th>Weight</th><th>Status</th></tr>
          ${g.boxes.map((b, i) => `<tr>
            <td>${i + 1}</td>
            <td><b>${esc(b.container_box_number || b.box_number)}</b></td>
            <td>${esc(b.receiver_name || '')}</td>
            <td>${esc(b.receiver_city || '')}</td>
            <td>${esc(b.size_category || '')}</td>
            <td>${b.weight_kg ? b.weight_kg + ' kg' : '—'}</td>
            <td>${esc(STATUS_LABELS[b.status] || b.status)}</td>
          </tr>`).join('')}
        </table>`).join('') || '<div class="muted">No boxes loaded.</div>'}
      <div class="rc-sign" style="margin-top:20px">
        <div><div class="rc-sigline"></div>Loaded/verified by (Shipper agent)</div>
        <div><div class="rc-sigline"></div>Received/stripped by (Consignee agent)</div>
      </div>
    </div>`);
}

// Load plan: boxes grouped by destination region so the consignee agent can plan the
// strip and regional dispatch before arrival.
async function renderLoadPlan(containerId) {
  const el = document.getElementById('loadPlan');
  if (!el) return;
  try {
    const p = await api(`/api/containers/${containerId}/load-plan`);
    el.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div class="muted">
          <b>${p.total_boxes}</b> box(es) · <b>${p.total_weight_kg} kg</b> total · ${esc(p.size_label)}
          ${p.load_code ? ` · load code <span class="badge st-created">${esc(p.load_code)}</span>` : ''}
        </div>
        <a href="#/container-manifest/${containerId}"><button class="secondary small">🖨 Print manifest</button></a>
      </div>
      <div class="table-scroll" style="margin-top:8px">
        <table><tr><th>Destination region</th><th>Boxes</th><th>Weight</th><th>Box numbers</th></tr>
        ${p.by_region.map(g => `<tr>
          <td>${g.region === 'UNASSIGNED' ? '<span class="muted">Not yet sorted</span>' : regionBadge(g.region)}</td>
          <td><b>${g.box_count}</b></td>
          <td>${g.total_weight_kg} kg</td>
          <td class="wrap-cell" style="max-width:420px">${g.boxes.map(b => esc(b.container_box_number || b.box_number)).join(', ')}</td>
        </tr>`).join('') || '<tr><td colspan="4" class="muted">No boxes loaded yet</td></tr>'}
        </table>
      </div>
      ${canDispatch() ? `
        <label style="margin-top:10px">Load / discharge plan notes <span class="muted">(consignee agent)</span></label>
        <textarea id="lpNotes" placeholder="e.g. Strip NCR boxes first, stage CALABARZON for Tuesday trip…">${esc(p.load_plan_notes || '')}</textarea>
        <button class="small" onclick="saveLoadPlan(${containerId})">Save plan</button>`
        : (p.load_plan_notes ? `<div class="muted" style="margin-top:8px"><b>Plan:</b> ${esc(p.load_plan_notes)}</div>` : '')}`;
  } catch (e) {
    el.innerHTML = `<div class="muted">Could not load plan: ${esc(e.message)}</div>`;
  }
}
async function saveLoadPlan(containerId) {
  try {
    await api(`/api/containers/${containerId}/load-plan`, { method: 'PUT', body: { load_plan_notes: document.getElementById('lpNotes').value } });
    flash('Load plan saved');
  } catch (e) { showErr(e); }
}

async function loadBoxToContainer(cid, boxId) {
  try {
    const r = await api(`/api/containers/${cid}/load`, { method: 'POST', body: { box_id: boxId } });
    flash(`${r.box.box_number} loaded (${r.box_count} in container)`);
    route();
  } catch (e) { showErr(e); }
}
async function containerAction(id, action, msg) {
  try {
    const r = await api(`/api/containers/${id}/${action}`, { method: 'POST' });
    flash(`${msg} (${r.boxes_updated} boxes)`);
    route();
  } catch (e) { showErr(e); }
}
async function setContainerStatus(id, status) {
  try { await api('/api/containers/' + id, { method: 'PUT', body: { status } }); route(); } catch (e) { showErr(e); }
}
const CONTAINER_PREV_LBL = { LOADING: 'Booking', IN_TRANSIT: 'Loading', ARRIVED: 'In-Transit', AT_CUSTOMS: 'Arrived', RELEASED: 'At customs', STRIPPED: 'Released' };
async function containerRevert(id, status) {
  const prev = CONTAINER_PREV_LBL[status] || 'the previous status';
  let extra = '';
  if (status === 'IN_TRANSIT') extra = '\n\nThis also moves its boxes back from In-Transit to Loaded-in-container.';
  if (status === 'ARRIVED') extra = '\n\nThis also moves its boxes back from Arrived to In-Transit.';
  if (!confirm(`Revert this container from ${status} back to ${prev}?${extra}`)) return;
  try {
    const r = await api(`/api/containers/${id}/revert`, { method: 'POST' });
    flash(`Reverted to ${r.reverted_to}${r.boxes_reverted ? ` (${r.boxes_reverted} box(es) rolled back)` : ''}`);
    route();
  } catch (e) { showErr(e); }
}

/* ---------- origin warehouse: master list + container load plan ---------- */
async function pageOriginWarehouse(size, util) {
  const planSize = size || 'C40';
  const planUtil = util || 0.85;
  const [wh, plan, containers, arrivals] = await Promise.all([
    api('/api/origin-warehouse'),
    api(`/api/origin-warehouse/load-plan?size=${planSize}&utilisation=${planUtil}`),
    canIntake() ? api('/api/containers').catch(() => []) : Promise.resolve([]),
    // Vans at the gate whose driver says they have arrived, waiting for somebody here to agree.
    api('/api/origin-warehouse/arrivals').catch(() => [])
  ]);
  // Stuffing happens here, at the origin warehouse, against a container still being loaded.
  // One that has sailed is closed to further boxes.
  const openContainers = (containers.rows || containers || []).filter(c => ['BOOKING', 'LOADING'].includes(c.status));
  const a = plan.actual;
  view(`
    <div class="row" style="justify-content:space-between">
      <h1>Origin Warehouse${wh.scope ? ` <span class="badge st-created">${esc(wh.scope)}</span>` : ''}</h1>
      <a href="#/origin-warehouse-doc"><button class="secondary">📄 Printable document (PDF)</button></a>
    </div>
    <div class="muted" style="margin-bottom:10px">Master list of boxes received at origin and waiting to be stuffed into a container${wh.scope ? ` — ${esc(wh.scope)} only` : ''}.</div>

    ${(arrivals || []).length ? `
      <h2>Vans at the gate</h2>
      <div class="muted" style="margin-bottom:8px;font-size:12.5px">
        The driver has reported arriving. Check the load is actually here, then confirm — that
        closes their pass. Book the boxes in afterwards by scanning each label as you unload.
      </div>
      ${arrivals.map(v => `
        <div class="card arrival-card">
          <div class="row" style="justify-content:space-between;align-items:flex-start">
            <div>
              <b>${esc(v.driver_name)}</b>
              ${v.driver_contact ? ` · <a href="tel:${esc(v.driver_contact)}">${esc(v.driver_contact)}</a>` : ''}
              <div class="muted" style="font-size:12.5px">
                ${v.plate_number ? '🚛 ' + esc(v.plate_number) : 'no plate recorded'}${v.trucking_company ? ' · ' + esc(v.trucking_company) : ''}
                · reported ${esc(sinceText(v.arrived_at))}
              </div>
              <div class="muted" style="font-size:12.5px">Pass <code>${esc(v.code)}</code> · ${v.boxes_total} box(es) on board</div>
            </div>
            <button onclick="verifyArrival(${v.id}, '${esc(v.driver_name)}', ${v.boxes_total})">✓ Confirm arrival</button>
          </div>
          <div class="drv-stop-boxes" style="margin-top:8px">
            ${v.boxes.map(b => `<span class="drv-chip">${esc(b.box_number)}</span>`).join('')}
          </div>
        </div>`).join('')}
    ` : ''}

    <div class="tiles">
      <div class="tile"><div class="num">${wh.totals.count}</div><div class="lbl">Boxes waiting</div></div>
      <div class="tile"><div class="num">${wh.totals.cbm}</div><div class="lbl">Total volume (cbm)</div></div>
      <div class="tile"><div class="num">${wh.totals.weight_kg}</div><div class="lbl">Total weight (kg)</div></div>
      <div class="tile"><div class="num">${a.containers_needed == null ? '—' : a.containers_needed}</div><div class="lbl">${esc(plan.container_label)} containers needed</div></div>
    </div>

    <h2>Load plan</h2>
    <div class="card no-print">
      <div class="row" style="gap:8px;align-items:flex-end">
        <div><label style="margin:0">Container</label>
          <select id="lpSize" onchange="pageOriginWarehouse(lpSize.value, lpUtil.value)">
            ${['C20', 'C40', 'C40HQ'].map(s => `<option value="${s}" ${s === plan.container_size ? 'selected' : ''}>${esc(CONTAINER_SIZE_LABELS[s])}</option>`).join('')}
          </select></div>
        <div><label style="margin:0">Stuffing utilisation</label>
          <select id="lpUtil" onchange="pageOriginWarehouse(lpSize.value, lpUtil.value)">
            ${[0.75, 0.8, 0.85, 0.9, 0.95].map(u => `<option value="${u}" ${Math.abs(u - plan.capacity.utilisation) < 0.001 ? 'selected' : ''}>${Math.round(u * 100)}%</option>`).join('')}
          </select></div>
        <div class="muted">Usable volume <b>${plan.capacity.usable_cbm} cbm</b> of ${plan.capacity.cbm} cbm · payload <b>${plan.capacity.payload_kg.toLocaleString()} kg</b></div>
      </div>
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <b id="lpTitle">How many fit in one ${esc(plan.container_label)} container (if loaded with a single size)</b>
        <div class="seg-toggle" id="lpToggle">
          <button type="button" class="seg on" data-mix="0" onclick="toggleLoadMix(0)">Single size</button>
          <button type="button" class="seg" data-mix="1" onclick="toggleLoadMix(1)">Mixed sizes</button>
        </div>
      </div>
      <div id="lpSingle">
      <div class="table-scroll" style="margin-top:8px"><table>
        <tr><th>Box size</th><th>Dimensions</th><th>Volume</th><th>Weight allowance</th><th>Max by volume</th><th>Max by weight</th><th>Fits</th><th>Limited by</th></tr>
        ${plan.per_size.map(s => `<tr>
          <td><b>${esc(s.label)}</b></td><td>${esc(s.dimensions)}</td><td>${s.cbm} cbm</td><td>${s.standard_weight_kg} kg</td>
          <td>${s.max_by_volume}</td><td>${s.max_by_weight}</td>
          <td><b>${s.max_boxes}</b></td>
          <td><span class="badge ${s.limited_by === 'volume' ? 'st-created' : 'st-sorted'}">${esc(s.limited_by)}</span></td>
        </tr>`).join('')}
      </table></div>
      </div>

      <div id="lpMixed" style="display:none">
      <div class="muted" style="margin:6px 0 10px">An even spread of every box size — closer to how a real consolidation fills.</div>
      <div class="table-scroll"><table>
        <tr><th>Box size</th><th>Volume each</th><th>Boxes</th></tr>
        ${plan.mixed.by_size.map(m => `<tr>
          <td><b>${esc(m.label)}</b></td><td>${m.cbm_each} cbm</td><td><b>${m.count}</b></td>
        </tr>`).join('')}
        <tr><td><b>TOTAL</b></td><td></td><td><b>${plan.mixed.boxes} boxes</b></td></tr>
      </table></div>
      <table style="margin-top:8px">
        <tr><td>Volume used</td><td style="text-align:right"><b>${plan.mixed.used_cbm} cbm</b> of ${plan.capacity.usable_cbm} usable</td></tr>
        <tr><td>Weight used</td><td style="text-align:right"><b>${plan.mixed.used_weight_kg.toLocaleString()} kg</b> of ${plan.capacity.payload_kg.toLocaleString()} kg</td></tr>
        <tr><td>Remaining</td><td style="text-align:right">${plan.mixed.remaining_cbm} cbm · ${plan.mixed.remaining_weight_kg.toLocaleString()} kg</td></tr>
        <tr><td>Limited by</td><td style="text-align:right"><span class="badge ${plan.mixed.limited_by === 'volume' ? 'st-created' : 'st-sorted'}">${esc(plan.mixed.limited_by)}</span></td></tr>
      </table>
      </div>
    </div>

    <div class="card">
      <b>Against the ${wh.totals.count} box(es) actually waiting</b>
      <div class="muted" style="margin:6px 0 10px">Packed largest-first, the way a container is really stuffed.</div>
      <table>
        <tr><td>Boxes that fit in this container</td><td style="text-align:right"><b>${a.fits_count}</b> of ${a.waiting_count}</td></tr>
        <tr><td>Volume used</td><td style="text-align:right">${a.used_cbm} / ${plan.capacity.usable_cbm} cbm (${a.volume_fill_pct}%)</td></tr>
        <tr><td>Weight used</td><td style="text-align:right">${a.used_weight_kg.toLocaleString()} / ${plan.capacity.payload_kg.toLocaleString()} kg (${a.weight_fill_pct}%)</td></tr>
        <tr><td>Left for the next container</td><td style="text-align:right"><b>${a.left_over_count}</b> box(es)</td></tr>
      </table>
    </div>

    <h2>Master list (${wh.totals.count})</h2>
    ${wh.by_size.length ? `<div class="card"><b>By size:</b> ${wh.by_size.map(s => `${s.count}× ${esc(s.label)} <span class="muted">(${s.cbm} cbm, ${s.weight_kg} kg)</span>`).join(' · ')}</div>` : ''}
    ${canIntake() ? `<div class="card">
      <h2 style="margin-top:0">Scan as you work</h2>
      <div class="muted" style="font-size:12.5px;margin-bottom:8px">
        Scan a box label to act on it. Receiving marks it in at this warehouse; stuffing puts
        it on the container chosen below. Each scan is applied as it is read, so a pallet can
        be worked without stopping.
      </div>
      <div class="seg-toggle" id="owScanMode">
        <button type="button" class="seg on" data-mode="receive" onclick="setOwScanMode('receive')">Receive at Origin WH</button>
        <button type="button" class="seg" data-mode="load" onclick="setOwScanMode('load')">Stuff into container</button>
      </div>
      ${scannerHtml('Scan a box label, or type its number')}
    </div>
    <div class="card">
      <div class="row" style="gap:8px;align-items:flex-end">
        <div style="max-width:340px">
          <label style="margin:0">Stuff into container</label>
          <select id="owContainer">
            ${openContainers.length
              ? openContainers.map(c => `<option value="${c.id}">${esc(c.container_number)} · ${esc(c.load_code || '')} · ${esc(CONTAINER_SIZE_LABELS[c.size] || c.size)} · ${c.box_count} loaded</option>`).join('')
              : '<option value="">— no container is open for loading —</option>'}
          </select>
        </div>
        ${openContainers.length ? `<button class="small" onclick="loadPlannedBoxes()">Load the ${a.fits.length} box(es) that fit</button>` : ''}
        <a href="#/containers?at=cnBook"><button class="small secondary">Book a container</button></a>
      </div>
      <div class="muted" style="font-size:12px;margin-top:6px">
        Boxes are stuffed here, at the origin warehouse. Only a container still being loaded
        can take more — once it departs it is closed. A container carries boxes from its own
        origin only.
      </div>
    </div>` : ''}
    <div class="card table-scroll">
      <table><tr><th>Box #</th><th>Sender</th><th>Receiver</th><th>Origin</th><th>Size</th><th>Volume</th><th>Weight</th><th>Fits this container</th>${canIntake() ? '<th></th>' : ''}</tr>
      ${wh.boxes.map(b => {
        const inPlan = a.fits.some(f => f.id === b.id);
        return `<tr>
          <td><a href="#/boxes/${b.id}">${esc(b.box_number)}</a></td>
          <td>${esc(b.sender_name || '')}</td><td>${esc(b.receiver_name || '')}</td>
          <td>${esc([b.origin_agent, b.origin_country].filter(Boolean).join(', '))}</td>
          <td>${esc(b.size_label)}<div class="muted">${esc(b.dimensions)}</div></td>
          <td>${b.cbm} cbm</td><td>${b.weight_kg || 0} kg</td>
          <td>${inPlan ? '<span class="badge st-delivered">Yes</span>' : '<span class="badge st-created">Next load</span>'}</td>
          ${canIntake() ? `<td class="inline-actions">${openContainers.length ? `<button class="small" onclick="loadBoxIntoContainer(${b.id})">Load</button>` : ''}</td>` : ''}
        </tr>`;
      }).join('') || `<tr><td colspan="${canIntake() ? 9 : 8}" class="muted">No boxes waiting at the origin warehouse</td></tr>`}
      </table>
    </div>`);
  if (canIntake()) setOwScanMode(OW_SCAN_MODE);
}

/* ---------- warehouse scan hub ---------- */
// Which action a scan performs at the Philippine warehouse.
let PH_SCAN_MODE = 'sort';
function setPhScanMode(mode) {
  PH_SCAN_MODE = mode === 'receive' ? 'receive' : 'sort';
  document.querySelectorAll('#phScanMode .seg').forEach(b => b.classList.toggle('on', b.dataset.mode === PH_SCAN_MODE));
  if (PH_SCAN_MODE === 'receive') {
    scanRunner('', async (box) => {
      if (box.status === 'RECEIVED_WAREHOUSE') return box.box_number + ' was already received';
      await api('/api/boxes/' + box.id + '/status', { method: 'POST', body: { status: 'RECEIVED_WAREHOUSE', note: 'Received at PH warehouse (scanned)' } });
      return box.box_number + ' received at PH warehouse';
    });
  } else {
    scanRunner('', async (box) => {
      const lane = (document.getElementById('laneRegion') || {}).value;
      const region = lane || (box.receiver ? box.receiver.region : null);
      const r = await api('/api/boxes/' + box.id + '/status', { method: 'POST', body: { status: 'SORTED', region } });
      return r.box_number + ' sorted → ' + (REGION_LABELS[r.region] || r.region || 'no region');
    });
  }
}

async function pageWarehouse() {
  const containers = await api('/api/containers');
  const toStrip = containers.filter(c => ['ARRIVED', 'AT_CUSTOMS', 'RELEASED'].includes(c.status));
  view(`
    <h1>Warehouse</h1>
    <div class="card">
      <h2 style="margin-top:0">1 · Strip a container</h2>
      ${toStrip.length
        ? toStrip.map(c => `<a href="#/containers/${c.id}"><button class="secondary">${esc(c.container_number)} · ${esc(c.status)} · ${c.box_count} boxes</button></a>`).join(' ')
        : '<span class="muted">No containers awaiting stripping. Mark a container arrived first.</span>'}
    </div>
    <div class="card">
      <h2 style="margin-top:0">2 · Scan as you work</h2>
      <div class="muted" style="font-size:12.5px;margin-bottom:8px">
        Receiving books a box in off a stripped container. Segregating sends it to a region
        lane — prefilled from the receiver's address unless a lane is forced below.
      </div>
      <div class="seg-toggle" id="phScanMode">
        <button type="button" class="seg" data-mode="receive" onclick="setPhScanMode('receive')">Receive at PH warehouse</button>
        <button type="button" class="seg on" data-mode="sort" onclick="setPhScanMode('sort')">Segregate by region</button>
      </div>
      <label>Region lane (optional — forces every scan into this lane)</label>
      <select id="laneRegion" style="max-width:280px"><option value="">Auto (use receiver's region)</option>
        ${regionOptions()}</select>
    </div>
    ${scannerHtml('Scan a box label, or type its number')}
    <div class="card" id="sortPick">Loading…</div>`);
  setPhScanMode(PH_SCAN_MODE);
  const pending = await api('/api/boxes?status=RECEIVED_WAREHOUSE');
  document.getElementById('sortPick').innerHTML = `
    <b>Received at warehouse, awaiting sorting (${pending.length}):</b>
    <div class="table-scroll"><table><tr><th>Box #</th><th>Receiver</th><th>City</th><th>Suggested region</th><th></th></tr>
    ${pending.map(b => `<tr><td><a href="#/boxes/${b.id}">${esc(b.box_number)}</a></td><td>${esc(b.receiver_name)}</td><td>${esc(b.receiver_city)}</td>
      <td>${regionBadge(b.receiver_region)}</td>
      <td><button class="small" onclick="doStatus(${b.id}, 'SORTED', '', '${esc(b.receiver_region || '')}')">Sort</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nothing waiting</td></tr>'}
    </table></div>`;
}

/* Printable origin-warehouse stock report — a proper document, not the screen page. */
// Stuff one box into the container chosen above. The server refuses a box from another
// origin, so a mistake is caught rather than quietly loaded.
async function loadBoxIntoContainer(boxId) {
  const pick = document.getElementById('owContainer');
  const containerId = pick && pick.value;
  if (!containerId) return flash('Pick a container first', 'error');
  try {
    await api('/api/containers/' + containerId + '/load', { method: 'POST', body: { box_id: boxId } });
    flash('Box loaded');
    pageOriginWarehouse();
  } catch (e) { showErr(e); }
}

// Load everything the plan says fits, in the plan's own order, and report what happened.
async function loadPlannedBoxes() {
  const pick = document.getElementById('owContainer');
  const containerId = pick && pick.value;
  if (!containerId) return flash('Pick a container first', 'error');
  const plan = await api('/api/origin-warehouse/load-plan?size=C40&utilisation=0.85').catch(() => null);
  const fits = (plan && plan.actual && plan.actual.fits) || [];
  if (!fits.length) return flash('Nothing to load', 'error');
  let loaded = 0;
  const failures = [];
  for (const b of fits) {
    try { await api('/api/containers/' + containerId + '/load', { method: 'POST', body: { box_id: b.id } }); loaded += 1; }
    catch (e) { failures.push((b.box_number || b.id) + ': ' + e.message); }
  }
  flash(`Loaded ${loaded} box(es)${failures.length ? `, ${failures.length} refused` : ''}`, failures.length ? 'error' : 'success');
  if (failures.length) console.warn('Not loaded:\n' + failures.join('\n'));
  pageOriginWarehouse();
}

// What is standing in the branch office, on paper. A counter clerk walks the shelf with this and
// ticks boxes off, so it is ordered by how long each has been waiting rather than by number —
// the point of counting is to find what has stopped moving, not to admire what arrived today.
async function pageBranchOfficeDoc() {
  const st = await api('/api/branch-office');
  const rows = st.boxes || [];
  const printedAt = new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
  const AGE_LIMIT = 7;   // a week on the shelf is long enough to want an explanation
  const stale = rows.filter(b => (b.days_waiting || 0) >= AGE_LIMIT).length;
  view(`
    <style>@page { size: 8.5in 13in; margin: 0.4in; }</style>
    <div class="row no-print" style="justify-content:space-between">
      <h1>Branch office — stock report</h1>
      <div>
        <a href="#/boxes"><button class="secondary">← Back</button></a>
        <button onclick="window.print()" title="In the print dialog, choose “Save as PDF” · paper size Legal (8.5 × 13 in)">🖨 Print / Save as PDF</button>
      </div>
    </div>

    <div class="manifest">
      <div class="rc-company">VICTORS FREIGHT INTERNATIONAL CORPORATION</div>
      <div class="rc-title">BRANCH OFFICE STOCK REPORT${st.scope ? ' — ' + esc(st.scope.toUpperCase()) : ''}</div>
      <div class="rc-meta">
        Printed: <b>${esc(printedAt)}</b> · Prepared by: <b>${esc(ME.name)}</b><br>
        Boxes at the counter: <b>${st.totals.count}</b> ·
        Total weight: <b>${st.totals.weight_kg} kg</b> ·
        Total volume: <b>${st.totals.cbm} cbm</b><br>
        Received at the branch and not yet sent to the origin warehouse.
        ${st.totals.oldest_days ? `Longest waiting: <b>${st.totals.oldest_days} day(s)</b>.` : ''}
        ${stale ? `<b>${stale}</b> box(es) waiting ${AGE_LIMIT} days or more.` : ''}
      </div>

      <div class="rc-label" style="margin-top:12px">SUMMARY BY BOX SIZE</div>
      <table class="rc-table">
        <tr><th>Size</th><th>Boxes</th><th>Weight (kg)</th><th>Volume (cbm)</th></tr>
        ${(st.by_size || []).map(v => `<tr>
          <td>${esc(v.label)}</td><td>${v.count}</td>
          <td>${v.weight_kg.toFixed(1)}</td><td>${v.cbm.toFixed(3)}</td></tr>`).join('')
          || '<tr><td colspan="4">None</td></tr>'}
        <tr><td><b>TOTAL</b></td><td><b>${st.totals.count}</b></td>
          <td><b>${st.totals.weight_kg}</b></td><td><b>${st.totals.cbm}</b></td></tr>
      </table>

      <div class="rc-label" style="margin-top:14px">BOX LIST (${rows.length}) — longest waiting first</div>
      <table class="rc-table">
        <tr><th>#</th><th>✓</th><th>Box number</th><th>Sender</th><th>Receiver</th><th>Destination</th>
            <th>Size</th><th>Kg</th><th>Received</th><th>Days</th></tr>
        ${rows.map((b, i) => `<tr>
          <td>${i + 1}</td>
          <td style="width:22px"></td>
          <td><b>${esc(b.box_number)}</b></td>
          <td>${esc(b.sender_name || '')}</td>
          <td>${esc(b.receiver_name || '')}</td>
          <td>${esc(b.receiver_city || '')}${b.region ? ' · ' + esc(REGION_LABELS[b.region] || b.region) : ''}</td>
          <td>${esc(SIZE_LABEL(b.size_category))}</td>
          <td>${b.weight_kg || ''}</td>
          <td>${fmtDay(b.waiting_since)}</td>
          <td${(b.days_waiting || 0) >= AGE_LIMIT ? ' style="font-weight:700"' : ''}>${b.days_waiting != null ? b.days_waiting : ''}</td>
        </tr>`).join('') || '<tr><td colspan="10">Nothing is standing at the branch office.</td></tr>'}
      </table>

      <div class="rc-sign" style="margin-top:26px">
        <div><div class="rc-sigline"></div>Counted by (Branch staff)</div>
        <div><div class="rc-sigline"></div>Verified by (Branch Manager)</div>
      </div>
    </div>`);
}

async function pageOriginWarehouseDoc() {
  const wh = await api('/api/origin-warehouse');
  const rows = wh.boxes || [];
  const bySize = {};
  for (const b of rows) {
    const k = b.size_category || '—';
    bySize[k] = bySize[k] || { count: 0, weight: 0, cbm: 0 };
    bySize[k].count += 1;
    bySize[k].weight += +(b.weight_kg || 0);
    bySize[k].cbm += +(b.cbm || 0);
  }
  const printedAt = new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
  view(`
    <style>@page { size: 8.5in 13in; margin: 0.4in; }</style>
    <div class="row no-print" style="justify-content:space-between">
      <h1>Origin Warehouse — stock report</h1>
      <div>
        <a href="#/origin-warehouse"><button class="secondary">← Back</button></a>
        <button onclick="window.print()" title="In the print dialog, choose “Save as PDF” · paper size Legal (8.5 × 13 in)">🖨 Print / Save as PDF</button>
      </div>
    </div>

    <div class="manifest">
      <div class="rc-company">VICTORS FREIGHT INTERNATIONAL CORPORATION</div>
      <div class="rc-title">ORIGIN WAREHOUSE STOCK REPORT${wh.scope ? ' — ' + esc(wh.scope.toUpperCase()) : ''}</div>
      <div class="rc-meta">
        Printed: <b>${esc(printedAt)}</b> · Prepared by: <b>${esc(ME.name)}</b><br>
        Boxes awaiting stuffing: <b>${wh.totals.count}</b> ·
        Total weight: <b>${wh.totals.weight_kg} kg</b> ·
        Total volume: <b>${wh.totals.cbm} cbm</b>
      </div>

      <div class="rc-label" style="margin-top:12px">SUMMARY BY BOX SIZE</div>
      <table class="rc-table">
        <tr><th>Size</th><th>Boxes</th><th>Weight (kg)</th><th>Volume (cbm)</th></tr>
        ${Object.entries(bySize).map(([k, v]) => `<tr>
          <td>${esc(SIZE_LABEL(k))}</td><td>${v.count}</td>
          <td>${v.weight.toFixed(1)}</td><td>${v.cbm.toFixed(3)}</td></tr>`).join('') || '<tr><td colspan="4">None</td></tr>'}
        <tr><td><b>TOTAL</b></td><td><b>${wh.totals.count}</b></td>
          <td><b>${wh.totals.weight_kg}</b></td><td><b>${wh.totals.cbm}</b></td></tr>
      </table>

      <div class="rc-label" style="margin-top:14px">BOX MASTER LIST (${rows.length})</div>
      <table class="rc-table">
        <tr><th>#</th><th>Box number</th><th>Sender</th><th>Receiver</th><th>Destination</th><th>Size</th><th>Kg</th><th>cbm</th><th>Received</th></tr>
        ${rows.map((b, i) => `<tr>
          <td>${i + 1}</td>
          <td><b>${esc(b.box_number)}</b></td>
          <td>${esc(b.sender_name || '')}</td>
          <td>${esc(b.receiver_name || '')}</td>
          <td>${esc(b.receiver_city || '')}${b.region ? ' · ' + esc(REGION_LABELS[b.region] || b.region) : ''}</td>
          <td>${esc(SIZE_LABEL(b.size_category))}</td>
          <td>${b.weight_kg || ''}</td>
          <td>${b.cbm != null ? b.cbm : ''}</td>
          <td>${fmtDay(b.status_updated_at || b.created_at)}</td>
        </tr>`).join('') || '<tr><td colspan="9">No boxes waiting.</td></tr>'}
      </table>

      <div class="rc-sign" style="margin-top:26px">
        <div><div class="rc-sigline"></div>Prepared by (Warehouse)</div>
        <div><div class="rc-sigline"></div>Verified by (Branch Manager)</div>
      </div>
    </div>`);
}

/* ---------- trips ---------- */
/* ---------- schedule ---------- */
// Two promises sit on a date: a driver coming for boxes that are packed, and empty boxes
// going out to whoever ordered them. Both were only visible by opening the record they live
// in, so nobody could see a day's work at once — or notice four pick-ups promised for the
// same morning until the morning arrived.
let SCHED_MONTH = null;      // first of the month being shown
let SCHED_DAY = null;        // the day whose detail is open

const ymd = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

async function pageSchedule() {
  if (!SCHED_MONTH) { const t = new Date(); SCHED_MONTH = new Date(t.getFullYear(), t.getMonth(), 1); }
  const first = SCHED_MONTH;
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const data = await api(`/api/schedule?from=${ymd(first)}&to=${ymd(last)}`);

  const byDay = {};
  for (const e of data.events) (byDay[e.date] = byDay[e.date] || []).push(e);

  // A calendar starts on Monday here — the working week the branches keep.
  const startPad = (first.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < startPad; i += 1) cells.push(null);
  for (let dnum = 1; dnum <= last.getDate(); dnum += 1) {
    cells.push(new Date(first.getFullYear(), first.getMonth(), dnum));
  }
  const today = ymd(new Date());
  const monthLabel = first.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });

  view(`
    <div class="row" style="justify-content:space-between;align-items:center">
      <h1>Schedule</h1>
      <div class="row" style="gap:6px">
        <button class="small secondary" onclick="schedMove(-1)">‹</button>
        <b style="min-width:150px;text-align:center">${esc(monthLabel)}</b>
        <button class="small secondary" onclick="schedMove(1)">›</button>
        <button class="small secondary" onclick="schedToday()">Today</button>
      </div>
    </div>
    <div class="muted" style="margin:-6px 0 12px">
      ${isHqSide()
        ? 'Delivery trips — one truck, one driver, one region, one day.'
        : 'Pick-ups of packed boxes and deliveries of empty boxes people have ordered.'}
      ${isHqSide() ? `<span class="sched-key"><i class="k-trip"></i> trip</span>`
        : `<span class="sched-key"><i class="k-pickup"></i> pick-up</span>
      <span class="sched-key"><i class="k-order"></i> empty boxes</span>`}
    </div>

    <div class="card">
      <div class="cal-grid cal-head">
        ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x => `<div>${x}</div>`).join('')}
      </div>
      <div class="cal-grid">
        ${cells.map(dt => {
          if (!dt) return '<div class="cal-cell empty"></div>';
          const key = ymd(dt);
          const evs = byDay[key] || [];
          const trips = evs.filter(e => e.kind === 'TRIP');
          const pick = evs.filter(e => e.kind === 'PICKUP');
          const ord = evs.filter(e => e.kind === 'BOX_ORDER');
          // Hovering a day says who is out and in what, without having to open it — useful when
          // scanning a week to find which truck was on the road on a particular day.
          const hint = trips.map(t => [t.ref, t.who, t.plate, t.company].filter(Boolean).join(' · ')).join('\n');
          return `<div class="cal-cell${key === today ? ' is-today' : ''}${key === SCHED_DAY ? ' is-open' : ''}${evs.length ? ' has' : ''}"
                       ${hint ? `title="${esc(hint)}"` : ''}
                       onclick="schedOpen('${key}')">
            <div class="cal-day">${dt.getDate()}</div>
            ${(() => {
              if (!trips.length) return '';
              const live = trips.filter(t => !t.done);
              // A day whose trips are all completed says so, the same way a finished pick-up does.
              if (!live.length) return '<div class="cal-pill k-done">completed</div>';
              // One truck fits on the face of the cell and is what dispatch is actually looking
              // for; several would not fit, so the count stands and the tooltip carries the rest.
              const plate = live.length === 1 ? (live[0].plate || '') : '';
              return `<div class="cal-pill k-trip">${live.length} trip${live.length === 1 ? '' : 's'}</div>
                ${plate ? `<div class="cal-truck">🚛 ${esc(plate)}</div>` : ''}`;
            })()}
            ${(() => {
              if (!pick.length) return '';
              const left = pick.reduce((n, e) => n + e.count, 0);
              // A pick-up whose boxes are already in says so, rather than advertising zero.
              return left
                ? `<div class="cal-pill k-pickup">${left} box${left === 1 ? '' : 'es'}</div>`
                : '<div class="cal-pill k-done">collected</div>';
            })()}
            ${ord.length ? `<div class="cal-pill k-order">${ord.length} order${ord.length === 1 ? '' : 's'}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>

    <div id="schedDay"></div>

    ${data.undated.length ? `<div class="card">
      <h2 style="margin-top:0">Not yet scheduled</h2>
      <div class="muted" style="margin-bottom:10px">
        ${isHqSide() ? 'Trips waiting for a day.' : 'Orders waiting for a date.'}
        They are listed here rather than hidden, because the work exists whether or not the
        calendar shows it.
      </div>
      <div class="table-scroll"><table>
        <tr><th>Reference</th><th>${isHqSide() ? 'Driver' : 'Who'}</th><th>Boxes</th><th>${isHqSide() ? 'Region' : 'Where'}</th><th>Give it a date</th></tr>
        ${data.undated.map(e => `<tr>
          <td>${esc(e.ref)}</td><td>${esc(e.who) || (e.kind === 'TRIP' ? '—' : '')}</td>
          <td>${esc(e.sizes || String(e.count))}</td>
          <td class="wrap-cell">${esc(e.kind === 'TRIP' ? e.region : e.address)}</td>
          <td class="inline-actions">
            <input type="date" id="sd${e.id}" style="max-width:150px">
            <button class="small" onclick="${e.kind === 'TRIP' ? 'setTripDate' : 'setOrderDate'}(${e.id})">Set</button>
          </td>
        </tr>`).join('')}
      </table></div>
    </div>` : ''}`);

  if (SCHED_DAY) schedOpen(SCHED_DAY, byDay[SCHED_DAY] || []);
}

function schedMove(delta) {
  SCHED_MONTH = new Date(SCHED_MONTH.getFullYear(), SCHED_MONTH.getMonth() + delta, 1);
  SCHED_DAY = null;
  pageSchedule();
}
function schedToday() {
  const t = new Date();
  SCHED_MONTH = new Date(t.getFullYear(), t.getMonth(), 1);
  SCHED_DAY = ymd(t);
  pageSchedule();
}

// The day's detail: who, where, and which box numbers the driver is going for.
async function schedOpen(day, preloaded) {
  SCHED_DAY = day;
  document.querySelectorAll('.cal-cell').forEach(c => c.classList.remove('is-open'));
  const data = preloaded || (await api(`/api/schedule?from=${day}&to=${day}`)).events;
  const host = document.getElementById('schedDay');
  if (!host) return;
  const pretty = new Date(day + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'long', day: 'numeric', month: 'long' });
  host.innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">${esc(pretty)}</h2>
      ${data.length ? data.map(e => e.kind === 'TRIP' ? `
        <div class="sched-item k-trip${e.done ? ' done' : ''}">
          <div class="row" style="justify-content:space-between;align-items:baseline">
            <b>Trip · <a href="${esc(e.href)}">${esc(e.ref)}</a></b>
            <span class="badge ${e.status === 'COMPLETED' ? 'st-delivered' : e.status === 'DISPATCHED' ? 'st-received_origin' : 'st-created'}">${esc(e.status_label)}</span>
          </div>
          <div>${esc(e.who) || '<span class="muted">No driver named yet</span>'}${e.phone ? ` · <a href="tel:${esc(e.phone)}">${esc(e.phone)}</a>` : ''}</div>
          <div class="muted">${esc(e.region)}${e.plate ? ` · Plate ${esc(e.plate)}` : ''}${e.company ? ` · ${esc(e.company)}` : ''}</div>
          <div class="sched-boxes"><span class="drv-chip">${e.count} box${e.count === 1 ? '' : 'es'} assigned</span></div>
        </div>` : `
        <div class="sched-item ${e.kind === 'PICKUP' ? 'k-pickup' : 'k-order'}${e.done ? ' done' : ''}">
          <div class="row" style="justify-content:space-between;align-items:baseline">
            <b>${e.kind === 'PICKUP' ? 'Pick-up' : 'Empty boxes'} · <a href="${esc(e.href)}">${esc(e.ref)}</a></b>
            <span class="muted">${esc(e.window || '')}</span>
          </div>
          <div>${esc(e.who)}${e.phone ? ` · <a href="tel:${esc(e.phone)}">${esc(e.phone)}</a>` : ''}</div>
          <div class="muted">${esc(e.address)}</div>
          ${e.note ? `<div class="muted" style="font-size:12px">${esc(e.note)}</div>` : ''}
          ${e.kind === 'PICKUP'
            ? (e.box_numbers && e.box_numbers.length
                ? `<div class="sched-boxes">${e.box_numbers.map(n => `<span class="drv-chip">${esc(n)}</span>`).join('')}</div>`
                : '<div class="muted" style="font-size:12px">All boxes already collected.</div>')
            : `<div class="sched-boxes"><span class="drv-chip">${esc(e.sizes || e.count + ' box(es)')}</span></div>`}
        </div>`).join('')
      : '<div class="muted">Nothing scheduled for this day.</div>'}
    </div>`;
  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function setTripDate(id) {
  const v = (document.getElementById('sd' + id) || {}).value;
  if (!v) return flash('Choose a date first', 'error');
  try { await api('/api/trips/' + id, { method: 'PUT', body: { scheduled_date: v } }); pageSchedule(); }
  catch (e) { showErr(e); }
}
async function setOrderDate(id) {
  const v = (document.getElementById('sd' + id) || {}).value;
  if (!v) return flash('Choose a date first', 'error');
  try { await api('/api/box-orders/' + id, { method: 'PUT', body: { scheduled_date: v } }); pageSchedule(); }
  catch (e) { showErr(e); }
}

// A driver gets a code, not an account. This is where the office hands one out and takes it
// back — and it deliberately shows what is left on each run, because that is what decides
// whether a pass is still doing anything.
async function pageDriverPasses() {
  const [passes, trips, sched, branchStock, roster] = await Promise.all([
    api('/api/driver-passes'),
    canDispatch() ? api('/api/trips').catch(() => []) : Promise.resolve([]),
    canDispatch() ? Promise.resolve(null) : api('/api/schedule').catch(() => null),
    // Boxes already standing at the counter, waiting to go on to the warehouse. A different
    // errand from collecting at a sender's door, but the same van and the same run.
    canDispatch() ? Promise.resolve(null) : api('/api/branch-office').catch(() => null),
    // Who this office has sent out before, and what a number here is supposed to look like.
    api('/api/drivers').catch(() => ({ drivers: [], phone_format: null }))
  ]);
  const atBranch = branchStock ? (branchStock.boxes || []) : [];
  KNOWN_DRIVERS = roster.drivers || [];
  // A branch hands a driver a route, and a route is a set of stops on particular days. Which
  // ones go on this run is the decision being made here, so it is made from the schedule
  // rather than by handing over everything outstanding.
  const stops = sched
    ? (sched.events || []).filter(e => e.kind === 'PICKUP' && !e.pending && (e.box_ids || []).length)
    : [];
  const pendingStops = sched ? (sched.events || []).filter(e => e.kind === 'PICKUP' && e.pending) : [];
  const hq = isHqSide();
  // Only three states now that nothing expires on its own: working, finished, or cancelled.
  // ARRIVED = the driver says they are at the warehouse and it has not been confirmed yet.
  const STATE_BADGE = { ACTIVE: 'st-received_origin', ARRIVED: 'st-sorted',
                        COMPLETED: 'st-delivered', REVOKED: 'st-cancelled' };
  const STATE_LABEL = { ARRIVED: 'AT THE GATE' };
  view(`
    <h1>Driver passes</h1>
    <div class="muted" style="margin-bottom:12px">
      A pass lets a driver work one run from their own phone — scanning box labels to move the
      timeline — without an account on the system. It stops working on its own once every box
      on the run is done, and can be cancelled here at any time.
    </div>

    <div class="card">
      <h2 style="margin-top:0">Issue a pass</h2>
      <div class="form-grid">
        <div>
          <label>Driver's name *</label>
          <input id="dpName" list="dpKnownDrivers" placeholder="e.g. Ramon Cruz"
                 oninput="this.dataset.touched='1'" onchange="driverPicked()" onblur="driverPicked()">
          <datalist id="dpKnownDrivers">
            ${(roster.drivers || []).map(x => `<option value="${esc(x.name)}">${esc([x.plate_number, x.contact].filter(Boolean).join(' · '))}</option>`).join('')}
          </datalist>
          ${(roster.drivers || []).length ? `<span class="dp-hint">Start typing — drivers you have sent out before fill themselves in.</span>` : ''}
        </div>
        <div>
          <label>Contact number *</label>
          <div class="dp-phone">
            <span class="dp-dial">${esc((roster.phone_format || {}).dial_code || '')}</span>
            <input id="dpPhone" inputmode="tel" placeholder="${esc(((roster.phone_format || {}).mobile || {}).example || '')}"
                   oninput="this.dataset.touched='1'">
          </div>
          <span class="dp-hint">${esc(((roster.phone_format || {}).mobile || {}).hint || '')}${
            (roster.phone_format || {}).note ? ' ' + esc(roster.phone_format.note) : ''}</span>
        </div>
        <div><label>Plate number</label><input id="dpPlate" placeholder="e.g. NBC 4471" oninput="this.dataset.touched='1'"></div>
        <div><label>Trucking company</label><input id="dpCompany" placeholder="Own fleet, or the hauler's name" oninput="this.dataset.touched='1'"></div>
      </div>
      ${hq ? `
        <label>Delivery trip *</label>
        <select id="dpTrip" onchange="tripPicked()">
          <option value="">— choose a trip —</option>
          ${(trips || []).filter(t => t.status !== 'COMPLETED')
            .map(t => `<option value="${t.id}"
              data-driver="${esc(t.driver_name || '')}"
              data-contact="${esc(t.driver_contact || '')}"
              data-plate="${esc(t.plate_number || '')}"
              data-company="${esc(t.trucking_company || '')}"
            >${esc(t.trip_number)} · ${esc(t.driver_name || '')}${t.plate_number ? ' · ' + esc(t.plate_number) : ''} · ${t.box_count} box(es)</option>`).join('')}
        </select>
        <div class="muted" id="dpTripInfo" style="font-size:12px;margin-top:4px"></div>
        <div class="muted" style="font-size:12px;margin-top:4px">
          The driver loads these at the PH warehouse and delivers to the receivers. The pass closes when every box is delivered or comes back.
        </div>
        <button style="margin-top:12px" onclick="issuePass('DELIVERY')">Issue delivery pass</button>`
      : `
        <div class="muted" style="font-size:12.5px;margin:6px 0 8px">
          Tick the stops going on this run. The pass closes on its own once the origin
          warehouse has booked in every box on it.
        </div>
        ${stops.length || atBranch.length ? `
          <div class="pass-pick">
            <label class="pass-all"><input type="checkbox" id="dpAll" onchange="passPickAll(this.checked)"> Select all</label>
            ${stops.length ? `<div class="pass-group">Collect from senders</div>` : ''}
            ${stops.map((e) => `
              <label class="pass-stop">
                <input type="checkbox" class="dpStop" data-ids="${esc((e.box_ids || []).join(','))}"
                       data-label="${esc(e.ref + ' · ' + e.who)}" onchange="passPickCount()">
                <span>
                  <b>${esc(e.date)}${e.window ? ' · ' + esc(e.window) : ''}</b> — ${esc(e.who)}
                  <span class="muted">${esc(e.ref)} · ${e.count} box(es)</span>
                  <span class="muted pass-addr">${esc(e.address)}</span>
                </span>
              </label>`).join('')}
            ${atBranch.length ? `
              <div class="pass-group">Take from the branch office to the warehouse — ${atBranch.length} box(es)</div>
              ${atBranch.map(b => `
                <label class="pass-stop">
                  <input type="checkbox" class="dpStop" data-ids="${b.id}"
                         data-label="${esc(b.box_number)}" onchange="passPickCount()">
                  <span>
                    <b>${esc(b.box_number)}</b> — ${esc(b.receiver_name || 'no receiver named')}
                    <span class="muted">${esc(b.sender_name || '')}${b.size_label ? ' · ' + esc(b.size_label) : ''}${b.weight_kg ? ' · ' + b.weight_kg + ' kg' : ''}</span>
                    <span class="muted pass-addr">Standing at the counter${b.days_waiting != null ? ' · ' + b.days_waiting + ' day(s)' : ''}</span>
                  </span>
                </label>`).join('')}` : ''}
          </div>
          <div class="muted" id="dpCount" style="font-size:12px;margin-top:6px"></div>
          <button style="margin-top:12px" onclick="issuePass('PICKUP')">Issue pick-up pass</button>`
        : '<div class="muted">Nothing to collect: no sender pick-ups are scheduled, and nothing is standing at the branch office.</div>'}
        ${pendingStops.length ? `<div class="note-warn" style="margin-top:12px;padding:10px 12px;border-radius:8px;font-size:12.5px">
          ${pendingStops.length} online booking(s) have a pick-up date but are not encoded yet, so they cannot go on a run.
          <a href="#/intake-requests">Review them →</a>
        </div>` : ''}`}
      <div class="error" id="dpErr"></div>
      <div id="dpIssued"></div>
    </div>

    <div class="card table-scroll">
      <table><tr><th>Code</th><th>Driver</th><th>Truck</th><th>Run</th><th>Boxes left</th><th>Where</th><th>Issued</th><th>State</th><th></th></tr>
      ${passes.map(x => `<tr>
        <td><code style="font-size:14px;font-weight:700">${esc(x.code)}</code></td>
        <td>${esc(x.driver_name)}
          ${x.driver_contact ? `<div class="muted" style="font-size:11px"><a href="tel:${esc(x.driver_contact)}">${esc(x.driver_contact)}</a></div>` : ''}</td>
        <td>${truckDetails(x)}</td>
        <td>${x.kind === 'DELIVERY' ? 'Delivery' + (x.trip_number ? ' · ' + esc(x.trip_number) : '') : 'Collection'}</td>
        <td>${x.boxes_left} of ${x.boxes_total}</td>
        <td>${whereabouts(x)}</td>
        <td>${fmtDay(x.created_at)}</td>
        <td><span class="badge ${STATE_BADGE[x.state] || ''}">${esc(STATE_LABEL[x.state] || x.state)}</span></td>
        <td>${x.state === 'ACTIVE' ? `<button class="small secondary danger" onclick="revokePass(${x.id})">Cancel</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="9" class="muted">No passes issued yet</td></tr>'}
      </table>
    </div>`);
  if (window.wireNameCase) wireNameCase('dpName');
}

// Selecting the trip fills in who is driving it. Typed-over values are respected — an
// agent correcting the name is telling us the trip's own record is out of date, not making a
// mistake — so only untouched fields are replaced.
// Confirming a van is here is what closes the driver's run, so it is asked properly. The boxes
// are booked in separately, label by label, which is the warehouse's own count and not the
// driver's — confirming the van arrived is not the same as agreeing what was on it.
async function verifyArrival(id, driver, total) {
  const ok = await confirmAction({
    title: 'Confirm this van has arrived?',
    body: `<p><b>${esc(driver)}</b>'s van is here with <b>${total}</b> box(es).</p>
           <p class="muted">This closes their pass — their phone stops working straight away.
             You still book each box in by scanning it as you unload, which is what actually
             moves them to Received at origin warehouse.</p>`,
    confirmLabel: 'Yes, the van is here', cancelLabel: 'Not yet'
  });
  if (!ok) return;
  try {
    const r = await api('/api/driver-passes/' + id + '/verify-arrival', { method: 'POST' });
    flash(r.message || 'Arrival confirmed');
    route();
  } catch (e) { showErr(e); }
}

// Drivers this office has sent out before, so the form can fill itself in.
let KNOWN_DRIVERS = [];

// Typing a name we already know fills in the rest — their number, and the truck they were last
// in. Only into blank fields: whatever the clerk has typed is theirs and stays, because the
// point is to save typing, not to overrule somebody who knows today is different.
function driverPicked() {
  const name = document.getElementById('dpName');
  if (!name || !name.value.trim()) return;
  const key = (s) => String(s || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  const hit = KNOWN_DRIVERS.find(x => key(x.name) === key(name.value));
  if (!hit) return;
  name.value = hit.name;                       // their name as it was last recorded
  const fill = (id, v) => {
    const el = document.getElementById(id);
    if (el && v && !el.value.trim()) el.value = v;
  };
  fill('dpPhone', hit.contact);
  fill('dpPlate', hit.plate_number);
  fill('dpCompany', hit.trucking_company);
  const err = document.getElementById('dpErr');
  if (err && !err.textContent) {
    err.className = 'muted';
    err.textContent = `Filled in from ${hit.name}'s last run${hit.runs ? ' (' + hit.runs + ' so far)' : ''}. Change anything that is different today.`;
  }
}

function tripPicked() {
  const sel = document.getElementById('dpTrip');
  const opt = sel.options[sel.selectedIndex];
  const name = document.getElementById('dpName');
  const phone = document.getElementById('dpPhone');
  const info = document.getElementById('dpTripInfo');
  if (!opt || !opt.value) { if (info) info.textContent = ''; return; }
  const driver = opt.dataset.driver || '';
  const contact = opt.dataset.contact || '';
  const plate = opt.dataset.plate || '';
  const company = opt.dataset.company || '';
  const plateEl = document.getElementById('dpPlate');
  const companyEl = document.getElementById('dpCompany');
  // Anything the clerk has already typed is theirs and stays; the trip only fills the blanks,
  // since the truck that turns up is not always the one that was booked.
  if (name && !name.dataset.touched) name.value = driver;
  if (phone && !phone.dataset.touched) phone.value = contact;
  if (plateEl && !plateEl.dataset.touched) plateEl.value = plate;
  if (companyEl && !companyEl.dataset.touched) companyEl.value = company;
  if (info) {
    const known = [driver && 'driver', plate && 'plate', company && 'hauler'].filter(Boolean);
    info.textContent = known.length
      ? `Filled in from the trip record: ${known.join(', ')}. Change anything that is different today.`
      : 'That trip has no driver or truck recorded — type them in.';
  }
}

function passPickAll(on) {
  document.querySelectorAll('.dpStop').forEach(c => { c.checked = on; });
  passPickCount();
}
function passPickCount() {
  const chosen = [...document.querySelectorAll('.dpStop:checked')];
  const boxes = chosen.reduce((n, c) => n + (c.dataset.ids ? c.dataset.ids.split(',').length : 0), 0);
  const el = document.getElementById('dpCount');
  if (el) el.textContent = chosen.length ? `${chosen.length} stop(s) · ${boxes} box(es) selected` : 'No stops selected yet.';
}

async function issuePass(kind) {
  const err = document.getElementById('dpErr');
  err.textContent = '';
  try {
    const body = { kind, driver_name: document.getElementById('dpName').value.trim(),
                   driver_contact: document.getElementById('dpPhone').value.trim(),
                   plate_number: (document.getElementById('dpPlate') || {}).value?.trim() || '',
                   trucking_company: (document.getElementById('dpCompany') || {}).value?.trim() || '' };
    err.className = 'error';
    if (!body.driver_name) { err.textContent = "The driver's name is required."; return; }
    // The server checks the shape of it; this only catches an empty box before a round trip.
    if (!body.driver_contact) {
      err.textContent = 'A contact number for the driver is required — the office needs to be able to ring them.';
      return;
    }
    const tripSel = document.getElementById('dpTrip');
    if (tripSel) body.trip_id = +tripSel.value || null;

    let summary = '';
    if (kind === 'PICKUP') {
      const chosen = [...document.querySelectorAll('.dpStop:checked')];
      if (!chosen.length) { err.textContent = 'Tick at least one stop for this run.'; return; }
      body.box_ids = chosen.flatMap(c => c.dataset.ids.split(',').map(Number));
      summary = `<ul>${chosen.map(c => `<li>${esc(c.dataset.label)}</li>`).join('')}</ul>
        <p class="muted">${body.box_ids.length} box(es) in total.</p>`;
    } else {
      const opt = tripSel && tripSel.options[tripSel.selectedIndex];
      if (!body.trip_id) { err.textContent = 'Choose a trip for this delivery run.'; return; }
      summary = `<ul><li>${esc(opt ? opt.textContent.trim() : '')}</li></ul>`;
    }

    // A pass is access to real customer addresses and phone numbers on somebody's own phone.
    // Worth reading back before it is handed over.
    const ok = await confirmAction({
      title: 'Issue this pass?',
      body: `<p><b>${esc(body.driver_name)}</b>${body.driver_contact ? ' · ' + esc(body.driver_contact) : ''}
             will be able to work the following on their own phone:</p>${summary}
             <p class="muted">The pass stops working once every box on it is done, and you can cancel it here at any time.</p>`,
      confirmLabel: 'Issue pass'
    });
    if (!ok) return;

    const r = await api('/api/driver-passes', { method: 'POST', body });
    // The code is the whole handover, so it is shown big enough to read down a phone line.
    document.getElementById('dpIssued').innerHTML = `
      <div class="note-warn" style="margin-top:12px;padding:14px;border-radius:10px;text-align:center">
        <div class="muted" style="font-size:12px">Give this code to ${esc(r.driver_name)}</div>
        <div style="font-size:32px;font-weight:800;letter-spacing:4px;margin:6px 0">${esc(r.code)}</div>
        <div class="muted" style="font-size:12px">
          They open <b>${esc(location.origin)}/driver.html</b> and enter it.
          Covers ${r.boxes_total} box(es) and stays open until the run is finished —
          cancel it here if it is no longer needed.
        </div>
      </div>`;
    flash('Pass issued for ' + r.driver_name);
    setTimeout(() => { const box = document.getElementById('dpIssued').innerHTML; pageDriverPasses().then(() => {
      const host = document.getElementById('dpIssued'); if (host) host.innerHTML = box;
    }); }, 400);
  } catch (e) { err.textContent = e.message; }
}

async function revokePass(id) {
  const ok = await confirmAction({
    title: 'Cancel this pass?',
    body: '<p>The driver is signed out immediately and the code stops working. Anything they have already scanned stays recorded.</p>',
    confirmLabel: 'Cancel the pass', cancelLabel: 'Keep it', danger: true
  });
  if (!ok) return;
  try { await api('/api/driver-passes/' + id + '/revoke', { method: 'POST' }); pageDriverPasses(); }
  catch (e) { showErr(e); }
}

// Manila dispatches deliveries; a branch collects from its own counter. canDispatch already
// names the Manila dispatch roles, so a pass form follows the same line.
function isHqSide() { return canDispatch(); }

async function pageTrips() {
  const list = await api('/api/trips');
  view(`
    <h1>Trucking Trips</h1>
    ${canDispatch() ? `
    <details class="collapse card"><summary>+ New trip</summary>
      <div class="form-grid" style="margin-top:8px">
        <div><label>Driver name *</label><input id="tpDriver"></div>
        <div><label>Driver contact</label><input id="tpContact" placeholder="+63 9xx"></div>
        <div><label>Plate number</label><input id="tpPlate"></div>
        <div><label>Trucking co / co-loader</label><input id="tpCompany"></div>
        <div><label>Region *</label><select id="tpRegion">${regionOptions()}</select></div>
        <div><label>Scheduled date</label><input id="tpDate" type="date"></div>
      </div>
      <button onclick="createTrip()">Create trip</button>
    </details>` : ''}
    <div class="card table-scroll">
      <table><tr><th>Trip</th><th>Region</th><th>Driver</th><th>Plate</th><th>Boxes</th><th>Date</th><th>Status</th></tr>
      ${list.map(t => `<tr>
        <td><a href="#/trips/${t.id}">${esc(t.trip_number)}</a></td>
        <td>${regionBadge(t.region)}</td><td>${esc(t.driver_name)}</td><td>${esc(t.plate_number)}</td>
        <td>${t.box_count}</td><td>${fmtDay(t.scheduled_date)}</td><td>${badge(t.status)}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">None</td></tr>'}
      </table>
    </div>`);
  if (window.wireNameCase) wireNameCase('tpDriver');
}
async function createTrip() {
  try {
    const t = await api('/api/trips', {
      method: 'POST',
      body: { driver_name: tpDriver.value, driver_contact: tpContact.value, plate_number: tpPlate.value, trucking_company: tpCompany.value, region: tpRegion.value, scheduled_date: tpDate.value || null }
    });
    flash(`Trip ${t.trip_number} created`);
    location.hash = '#/trips/' + t.id;
  } catch (e) { showErr(e); }
}

async function pageTripDetail(id) {
  const t = await api('/api/trips/' + id);
  const assigned = t.boxes.filter(b => b.status === 'ASSIGNED');
  const loaded = t.boxes.filter(b => b.status === 'LOADED_TRUCK');
  const canAssign = canDispatch() && ['PLANNED', 'LOADING'].includes(t.status);
  view(`
    <div class="row" style="justify-content:space-between">
      <h1>${esc(t.trip_number)} ${badge(t.status)}</h1>
      <div>
        <a href="#/manifest/${t.id}"><button class="secondary">🖨 Trip manifest</button></a>
        ${t.boxes.length ? `<a href="#/truck-receipt/t/${t.id}"><button class="secondary">🖨 Delivery receipts (${groupBoxesByConsignee(t.boxes).length})</button></a>` : ''}
        ${canDispatch() && loaded.length ? `<button onclick="dispatchTrip(${t.id})">🚚 Dispatch trip (${loaded.length} loaded)</button>` : ''}
      </div>
    </div>
    <div class="card form-grid">
      <div><label>Region</label>${regionBadge(t.region)}</div>
      <div><label>Driver</label>${esc(t.driver_name)} · ${esc(t.driver_contact)}</div>
      <div><label>Plate / company</label>${esc([t.plate_number, t.trucking_company].filter(Boolean).join(' · '))}</div>
      <div><label>Scheduled</label>${fmtDay(t.scheduled_date)}</div>
    </div>

    ${canAssign ? `<h2>Assign boxes (${REGION_LABELS[t.region]})</h2><div class="card" id="assignList">Loading…</div>` : ''}

    ${canAssign && assigned.length ? `
    <h2>Load-out scan (${assigned.length} to load)</h2>
    ${scannerHtml('Scan each box as it goes on the truck')}` : ''}

    <h2>Boxes on trip (${t.boxes.length})</h2>
    <div class="card table-scroll">
      <table><tr><th>Box #</th><th>Receiver</th><th>Phone</th><th>City</th><th>Status</th><th>Actions</th></tr>
      ${t.boxes.map(b => `<tr>
        <td><a href="#/boxes/${b.id}">${esc(b.box_number)}</a></td>
        <td>${esc(b.receiver_name)}</td><td>${esc(b.receiver_phone)}</td><td>${esc(b.receiver_city)}</td>
        <td>${badge(b.status)}</td>
        <td class="inline-actions">
          ${b.status === 'ASSIGNED' && canAssign ? `<button class="small" onclick="tripLoadBox(${t.id}, ${b.id})">Load</button>
            <button class="small secondary" onclick="tripRemoveBox(${t.id}, ${b.id})">Remove</button>` : ''}
          ${b.status === 'OUT_FOR_DELIVERY' ? `<a href="#/boxes/${b.id}"><button class="small">Record outcome</button></a>` : ''}
        </td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">No boxes assigned yet</td></tr>'}
      </table>
    </div>`);

  if (canAssign) {
    const [sorted, returned] = await Promise.all([
      api('/api/boxes?status=SORTED&region=' + t.region),
      api('/api/boxes?status=RETURNED&region=' + t.region)
    ]);
    const pool = [...returned, ...sorted];
    document.getElementById('assignList').innerHTML = pool.length ? `
      <div class="table-scroll"><table><tr><th></th><th>Box #</th><th>Receiver</th><th>City</th><th>Status</th></tr>
      ${pool.map(b => `<tr><td><input type="checkbox" class="assignChk" value="${b.id}"></td>
        <td>${esc(b.box_number)}</td><td>${esc(b.receiver_name)}</td><td>${esc(b.receiver_city)}</td><td>${badge(b.status)}</td></tr>`).join('')}
      </table></div>
      <button onclick="assignChecked(${t.id})">Assign selected to trip</button>
      <span class="muted">RETURNED boxes shown first — assigning them is the one-click re-dispatch.</span>`
      : '<span class="muted">No sorted or returned boxes for this region.</span>';
    if (assigned.length) {
      setScanHandler(async code => {
        const box = await lookupBox(code);
        const r = await api(`/api/trips/${t.id}/load-scan`, { method: 'POST', body: { box_id: box.id } });
        scanFeedback(`<div class="scan-last"><div class="big">✓ ${esc(r.box.box_number)} on truck</div>
          <div class="scan-count">${r.remaining}</div><div class="muted">still to load</div></div>`);
      });
    }
  }
}
async function assignChecked(tripId) {
  const ids = [...document.querySelectorAll('.assignChk:checked')].map(c => +c.value);
  if (!ids.length) return flash('Select at least one box', 'error');
  try {
    const r = await api(`/api/trips/${tripId}/assign-boxes`, { method: 'POST', body: { box_ids: ids } });
    flash(`${r.assigned} box(es) assigned`);
    route();
  } catch (e) { showErr(e); }
}
async function tripLoadBox(tripId, boxId) {
  try {
    const r = await api(`/api/trips/${tripId}/load-scan`, { method: 'POST', body: { box_id: boxId } });
    flash(`${r.box.box_number} loaded — ${r.remaining} remaining`);
    route();
  } catch (e) { showErr(e); }
}
async function tripRemoveBox(tripId, boxId) {
  try { await api(`/api/trips/${tripId}/remove-box`, { method: 'POST', body: { box_id: boxId } }); route(); } catch (e) { showErr(e); }
}
async function dispatchTrip(id) {
  try {
    const r = await api(`/api/trips/${id}/dispatch`, { method: 'POST' });
    flash(`Trip dispatched — ${r.dispatched} boxes out for delivery, receivers notified by SMS`);
    route();
  } catch (e) { showErr(e); }
}

async function pageManifest(id) {
  const t = await api('/api/trips/' + id);
  view(`
    <div class="row no-print" style="justify-content:space-between">
      <h1>Trip manifest</h1><button onclick="window.print()" title="In the print dialog, choose “Save as PDF” · paper size Legal (8.5 × 13 in)">🖨 Print / Save as PDF</button>
    </div>
    <div class="manifest">
      <div class="rc-company">VICTORS FREIGHT INTERNATIONAL CORPORATION</div>
      <div class="rc-title">DELIVERY TRIP MANIFEST — ${esc(t.trip_number)}</div>
      <div class="rc-meta">
        Region: <b>${esc(REGION_LABELS[t.region] || t.region)}</b> · Date: <b>${fmtDay(t.scheduled_date)}</b><br>
        Driver: <b>${esc(t.driver_name)}</b> (${esc(t.driver_contact)}) · Plate: <b>${esc(t.plate_number)}</b> · ${esc(t.trucking_company)}
      </div>
      <table class="rc-table" style="margin-top:12px">
        <tr><th>#</th><th>Box</th><th>Receiver</th><th>Phone</th><th>Address & landmark</th><th>Instructions</th><th>Received by / sign</th></tr>
        ${t.boxes.map((b, i) => `<tr>
          <td>${i + 1}</td><td><b>${esc(b.box_number)}</b></td>
          <td>${esc(b.receiver.full_name || '')}</td>
          <td>${esc(b.receiver.phone_primary || '')}${b.receiver.phone_alternate ? '<br>' + esc(b.receiver.phone_alternate) : ''}</td>
          <td>${esc([b.receiver.address_line, b.receiver.barangay, b.receiver.city_municipality, b.receiver.province].filter(Boolean).join(', '))}
            ${b.receiver.landmark ? `<br>📍 <i>${esc(b.receiver.landmark)}</i>` : ''}</td>
          <td>${esc(b.special_instructions || '')}</td><td style="min-width:110px"></td>
        </tr>`).join('')}
      </table>
    </div>`);
}

/* ---------- returns queue ---------- */
async function pageReturns() {
  const list = await api('/api/returns');
  view(`
    <h1>Returns Queue <span class="muted">(oldest first — these need action)</span></h1>
    <div class="card table-scroll">
      <table><tr><th>Age</th><th>Box #</th><th>Receiver</th><th>Phones</th><th>Region</th><th>Last failure</th><th>Attempts</th><th>Re-dispatch</th></tr>
      ${list.map(b => `<tr>
        <td><b>${ageDays(b.status_updated_at)}d</b></td>
        <td><a href="#/boxes/${b.id}">${esc(b.box_number)}</a></td>
        <td>${esc(b.receiver_name)}</td><td>${esc(b.receiver_phone)}</td>
        <td>${regionBadge(b.region || b.receiver_region)}</td>
        <td>${esc(FAILURE_REASONS[b.last_failure_reason] || '—')}</td>
        <td>${b.attempts_count}</td>
        <td class="inline-actions">
          ${b.candidate_trips.length
            ? b.candidate_trips.map(t => `<button class="small" onclick="requeueBox(${b.id}, ${t.id}, '${esc(t.trip_number)}')">→ ${esc(t.trip_number)} (${fmtDay(t.scheduled_date)})</button>`).join('')
            : `<a href="#/trips"><button class="small secondary">Create ${esc(REGION_LABELS[b.region || b.receiver_region] || '')} trip</button></a>`}
        </td>
      </tr>`).join('') || '<tr><td colspan="8" class="muted">🎉 No returned boxes</td></tr>'}
      </table>
    </div>
    <div class="muted">One click adds the box to a planned trip for its region — the fast re-dispatch flow.</div>`);
}
async function requeueBox(boxId, tripId, tripNo) {
  try {
    await api(`/api/trips/${tripId}/assign-boxes`, { method: 'POST', body: { box_ids: [boxId] } });
    flash(`Box added to ${tripNo}`);
    route();
  } catch (e) { showErr(e); }
}

/* ---------- customers ---------- */
async function pageCustomers() {
  const q = hashQuery();
  const list = await api('/api/customers?q=' + encodeURIComponent(q.get('q') || ''));
  // The export carries whatever search is showing, so the file matches the screen rather
  // than quietly being the whole book.
  const exportUrl = '/api/customers/export.xlsx' + (q.get('q') ? '?q=' + encodeURIComponent(q.get('q')) : '');
  view(`
    <div class="row" style="justify-content:space-between">
      <h1>Customers</h1>
      <a href="${esc(exportUrl)}" download><button class="secondary">⬇ Export to Excel</button></a>
    </div>
    <div class="card row">
      <input id="custQ" placeholder="Search name, phone, city…" style="max-width:300px" value="${esc(q.get('q') || '')}">
      <button class="small" onclick="location.hash='#/customers?q='+encodeURIComponent(custQ.value)">Search</button>
    </div>
    ${isAgent() ? `<details class="collapse card"><summary>+ New customer</summary>${newCustomerFormHtml('cc')}</details>` : ''}
    <div class="card table-scroll">
      <table><tr><th>Name</th><th>Type</th><th>Phones</th><th>City</th><th>Region</th><th>Landmark</th></tr>
      ${list.map(c => `<tr>
        <td><a href="#/customers/${c.id}">${esc(c.full_name)}</a></td>
        <td>${esc(c.type)}</td>
        <td>${esc(c.phone_primary)}${c.phone_alternate ? ' / ' + esc(c.phone_alternate) : ''}</td>
        <td>${esc(c.city_municipality)}</td><td>${regionBadge(c.region)}</td>
        <td class="wrap-cell">${esc(c.landmark || '')}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">No customers</td></tr>'}
      </table>
    </div>`);
  document.getElementById('custQ').addEventListener('keydown', e => { if (e.key === 'Enter') location.hash = '#/customers?q=' + encodeURIComponent(e.target.value); });
  if (window.wireNameCase) wireNameCase('ccName');
}

async function pageCustomerDetail(id) {
  const c = await api('/api/customers/' + id);
  view(`
    <h1>${esc(c.full_name)} <span class="badge st-created">${esc(c.type)}</span></h1>
    <div class="card">
      <div class="form-grid">
        <div><label>Phone (primary)</label><input id="edPhone" value="${esc(c.phone_primary)}"></div>
        <div><label>Phone (alternate)</label><input id="edAlt" value="${esc(c.phone_alternate)}"></div>
        <div><label>Email</label><input id="edEmail" value="${esc(c.email)}"></div>
        <div><label>Address line</label><input id="edAddr" value="${esc(c.address_line)}"></div>
        <div><label>Barangay</label><input id="edBrgy" value="${esc(c.barangay)}"></div>
        <div><label>City</label><input id="edCity" value="${esc(c.city_municipality)}"></div>
        <div><label>Province</label><input id="edProv" value="${esc(c.province)}"></div>
        <div><label>Region</label><select id="edRegion"><option value="">—</option>${regionOptions(c.region)}</select></div>
        <div><label>Landmark</label><input id="edLandmark" value="${esc(c.landmark)}"></div>
        <div><label>Notes</label><input id="edNotes" value="${esc(c.notes)}"></div>
      </div>
      ${isAgent() ? `<button onclick="saveCustomer(${c.id})">Save changes</button> <span class="muted">Phone changes are logged.</span>` : ''}
    </div>
    ${(c.phone_history || []).length ? `
    <h2>Phone change history</h2>
    <div class="card table-scroll"><table><tr><th>When</th><th>Field</th><th>From</th><th>To</th><th>By</th></tr>
      ${c.phone_history.map(h => `<tr><td>${fmtDate(h.changed_at)}</td><td>${esc(h.field)}</td><td>${esc(h.from)}</td><td>${esc(h.to)}</td><td>${esc(h.changed_by)}</td></tr>`).join('')}
    </table></div>` : ''}
    <h2>Boxes received (${c.received_boxes.length})</h2>
    <div class="card table-scroll"><table><tr><th>Box #</th><th>Sender</th><th>Status</th><th>Updated</th></tr>
      ${c.received_boxes.map(b => `<tr><td><a href="#/boxes/${b.id}">${esc(b.box_number)}</a></td><td>${esc(b.sender_name)}</td><td>${badge(b.status)}</td><td>${fmtDay(b.status_updated_at)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">None</td></tr>'}
    </table></div>
    <h2>Shipments sent (${c.shipments.length})</h2>
    <div class="card table-scroll"><table><tr><th>Shipment</th><th>Boxes</th><th>Payment</th><th>Date</th></tr>
      ${c.shipments.map(s => `<tr><td><a href="#/shipments/${s.id}">${esc(s.shipment_number)}</a></td>
        <td>${c.sent_boxes.filter(b => b.shipment_id === s.id).length}</td><td>${payBadge(s.payment_status)}</td><td>${fmtDay(s.created_at)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">None</td></tr>'}
    </table></div>`);
}
async function saveCustomer(id) {
  try {
    await api('/api/customers/' + id, {
      method: 'PUT',
      body: {
        phone_primary: edPhone.value, phone_alternate: edAlt.value, email: edEmail.value,
        address_line: edAddr.value, barangay: edBrgy.value, city_municipality: edCity.value,
        province: edProv.value, region: edRegion.value || null, landmark: edLandmark.value, notes: edNotes.value
      }
    });
    flash('Customer updated');
    route();
  } catch (e) { showErr(e); }
}

/* ---------- notifications ---------- */
async function pageNotifications() {
  const list = await api('/api/notifications');
  view(`
    <h1>SMS Notifications <span class="muted">(demo: simulated gateway, logs to server console)</span></h1>
    <div class="card table-scroll">
      <table><tr><th>When</th><th>Box</th><th>To</th><th>Role</th><th>Trigger</th><th>Message</th><th>Status</th><th></th></tr>
      ${list.map(n => `<tr>
        <td>${fmtDate(n.created_at)}</td><td>${esc(n.box_number)}</td>
        <td>${esc(n.recipient_phone)}</td><td>${esc(n.recipient_role)}</td><td>${esc(n.template_key)}</td>
        <td class="wrap-cell" style="max-width:360px">${esc(n.message_body)}</td>
        <td>${badge(n.status)}${n.last_error ? `<div class="muted">${esc(n.last_error)}</div>` : ''}</td>
        <td>${n.status === 'FAILED' && isAdmin() ? `<button class="small" onclick="retryNotif(${n.id})">Retry</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="8" class="muted">None yet</td></tr>'}
      </table>
    </div>`);
}
async function retryNotif(id) {
  try { await api('/api/notifications/retry/' + id, { method: 'POST' }); flash('Re-queued — worker will retry shortly'); route(); } catch (e) { showErr(e); }
}

/* ---------- developer console: the node network ---------- */
async function pageDeveloper() {
  view(`<h1>Developer Console</h1><div id="devBody" class="card muted">Contacting nodes…</div>`);
  let net;
  try { net = await api('/api/sync/network'); }
  catch (e) { document.getElementById('devBody').innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
  const self = net.self;
  const totals = Object.entries(self.counts).filter(([, c]) => c.total);

  const peerCard = (p) => `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <h2 style="margin:0">${esc(p.label || p.id)}</h2>
          <div class="muted">${esc(p.url)}</div>
        </div>
        <span class="badge ${p.reachable ? 'st-delivered' : 'st-cancelled'}">${p.reachable ? 'ONLINE' : 'UNREACHABLE'}</span>
      </div>
      <div class="form-grid" style="margin-top:8px">
        <div><label>Round trip</label>${p.ms != null ? p.ms + ' ms' : '—'}</div>
        <div><label>Sync cursor</label>${p.cursor || 0}</div>
        <div><label>Last successful pull</label>${p.last_ok ? fmtDate(p.last_ok) : '<span class="muted">never</span>'}</div>
        <div><label>Records applied</label>${p.last_applied != null ? p.last_applied : '—'}</div>
      </div>
      ${p.error || p.last_error ? `<div class="error" style="margin-top:6px">${esc(p.error || p.last_error)}</div>` : ''}
    </div>`;

  document.getElementById('devBody').outerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <h2 style="margin:0">This deployment — ${esc(self.node.label)}</h2>
          <div class="muted">Node <code>${esc(self.node.id)}</code> · ${esc(self.node.type)} · id band ${self.node.idOffset.toLocaleString()}–${(self.node.idOffset + 999999).toLocaleString()}</div>
        </div>
        <div style="text-align:right">
          <span class="badge ${self.enabled ? 'st-delivered' : 'st-created'}">${self.enabled ? 'SYNC ON' : 'SYNC OFF'}</span>
          <div class="muted" style="margin-top:4px">local revision ${self.rev}</div>
        </div>
      </div>
      ${!self.enabled ? `<div class="note-info" style="margin-top:10px">
        Replication is off on this deployment. Set <code>VFIC_SYNC_SECRET</code> (the same value on every node)
        and <code>VFIC_PEERS</code> (e.g. <code>[{"id":"TH_BANGKOK","url":"https://vfic-th.vercel.app"}]</code>),
        then redeploy. Each node also needs its own <code>VFIC_NODE_ID</code> and its own database.
      </div>` : ''}
      <div class="row" style="margin-top:12px;gap:8px">
        <button onclick="runSyncNow()" ${self.enabled ? '' : 'disabled'}>⟳ Sync now</button>
        <button class="secondary" onclick="pageDeveloper()">Refresh</button>
      </div>
    </div>

    <h2>Peer nodes (${net.peers.length})</h2>
    ${net.peers.map(peerCard).join('') || '<div class="card muted">No peers configured on this deployment.</div>'}

    <h2>Replicated data on this node</h2>
    <div class="card table-scroll">
      <table><tr><th>Collection</th><th>Total</th>${Object.values(NODE_LABELS).map(l => `<th>${esc(l)}</th>`).join('')}</tr>
      ${totals.map(([coll, c]) => `<tr>
        <td><b>${esc(coll.replace(/_/g, ' '))}</b></td><td>${c.total}</td>
        ${Object.keys(NODE_LABELS).map(n => `<td>${c.by_node[n] || 0}</td>`).join('')}
      </tr>`).join('')}
      </table>
      <div class="muted" style="margin-top:8px">Rows owned by another node arrived by replication; this node never edits them.</div>
    </div>`;
}
const NODE_LABELS = { HQ_MANILA: 'Manila HQ', TH_BANGKOK: 'Thailand', KH_PHNOMPENH: 'Cambodia' };
// The money each branch keeps its books in (mirrors lib/branches.js FINANCE).
const BRANCH_CURRENCY = { HQ_MANILA: 'PHP', TH_BANGKOK: 'THB', KH_PHNOMPENH: 'KHR' };
async function runSyncNow() {
  try {
    const r = await api('/api/sync/run', { method: 'POST' });
    const applied = (r.peers || []).reduce((n, p) => n + (p.applied || 0), 0);
    flash(r.ok ? `Sync complete — ${applied} record(s) applied` : 'Sync finished with errors', r.ok ? 'success' : 'error');
    pageDeveloper();
  } catch (e) { showErr(e); }
}

/* ---------- roles × modules matrix ---------- */
async function pageRoleModules() {
  const d = await api('/api/role-modules');
  const groups = [...new Set(d.modules.map(m => m.group))];
  view(`
    <div class="row" style="justify-content:space-between">
      <h1>Roles &amp; Modules</h1>
      <div><a href="#/admin"><button class="secondary">← Admin</button></a>
      <button onclick="saveRoleModules()">Save permissions</button></div>
    </div>
    <div class="muted" style="margin-bottom:10px">Tick which modules each role can open. Unticking a module hides it from that role's sidebar and blocks its API. Locked ticks (🔒) keep the system administrable.</div>
    ${groups.map(g => `
      <h2>${esc(g)}</h2>
      <div class="card table-scroll">
        <table>
          <tr><th>Module</th>${d.roles.map(r => `<th style="text-align:center">${esc(r.label)}</th>`).join('')}</tr>
          ${d.modules.filter(m => m.group === g).map(m => `<tr>
            <td><b>${esc(m.label)}</b><div class="muted">${esc(m.route)}</div></td>
            ${d.roles.map(r => {
              const locked = (d.locked[r.key] || []).includes(m.key);
              const on = (d.matrix[r.key] || []).includes(m.key);
              return `<td style="text-align:center">${locked
                ? `<span title="Always enabled for this role">🔒</span><input type="checkbox" class="rmChk" data-role="${r.key}" data-mod="${m.key}" checked disabled style="display:none">`
                : `<input type="checkbox" class="rmChk" data-role="${r.key}" data-mod="${m.key}" ${on ? 'checked' : ''} style="width:auto">`}</td>`;
            }).join('')}
          </tr>`).join('')}
        </table>
      </div>`).join('')}
    <div class="card"><button onclick="saveRoleModules()">Save permissions</button></div>`);
}
async function saveRoleModules() {
  const matrix = {};
  document.querySelectorAll('.rmChk').forEach(el => {
    const r = el.dataset.role;
    matrix[r] = matrix[r] || [];
    if (el.checked) matrix[r].push(el.dataset.mod);
  });
  try {
    await api('/api/role-modules', { method: 'PUT', body: { matrix } });
    await loadMyModules();
    flash('Module permissions saved');
    renderShell();
    route();
  } catch (e) { showErr(e); }
}

/* ---------- accounting ---------- */
const money = (v, ccy) => `${ccy || 'PHP'} ${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
let ACCT_META = null;

async function pageAccounting(tab) {
  if (!ACCT_META) ACCT_META = await api('/api/accounting/meta');
  const tabs = [['rates', 'Rate Cards'], ['interbranch', 'Inter-branch'], ['expenses', 'Expenses'], ['pnl', 'Profit & Loss']];
  view(`
    <h1>Accounting</h1>
    <div class="row" style="gap:6px;margin-bottom:12px">
      ${tabs.map(([k, l]) => `<a href="#/accounting/${k}"><button class="${k === tab ? '' : 'secondary'} small">${l}</button></a>`).join('')}
    </div>
    <div id="acctBody">Loading…</div>`);
  if (tab === 'rates') return renderRateCard();
  if (tab === 'invoices') { location.hash = '#/accounting/interbranch'; return; }
  if (tab === 'interbranch') return renderInterbranch();
  if (tab === 'expenses') return renderExpenses();
  return renderPnl();
}

let RC_BRANCH = '';
async function renderRateCard(branch) {
  if (branch !== undefined) RC_BRANCH = branch;
  const card = await api('/api/accounting/rate-card' + (RC_BRANCH ? '?branch=' + encodeURIComponent(RC_BRANCH) : ''));
  RC_BRANCH = card.branch || RC_BRANCH;
  const zones = ACCT_META.zones, sizes = ACCT_META.sizes;
  const editable = !!card.editable;
  const cell = (id, val) => `<input id="${id}" type="number" min="0" step="0.01" value="${val || 0}" style="width:110px;padding:5px 7px"${editable ? "" : " disabled"}>`;
  const oceanTable = (lvl) => `
    <div class="rc-label" style="margin-top:12px">${esc(ACCT_META.service_level_labels[lvl] || lvl)} — price per box</div>
    <div class="table-scroll"><table>
      <tr><th>Destination zone</th>${sizes.map(s => `<th>${esc(s.label)}<br><span class="muted" style="font-weight:400">${esc(s.dimensions)}</span></th>`).join('')}</tr>
      ${zones.map(z => `<tr><td><b>${esc(z.label)}</b></td>
        ${sizes.map(s => `<td>${cell(`rc_${lvl}_${z.key}_${s.key}`, card.ocean[lvl][z.key][s.key])}</td>`).join('')}
      </tr>`).join('')}
    </table></div>`;

  document.getElementById('acctBody').innerHTML = `
    <div class="card">
      ${(MY && MY.sees_all_branches) ? `<div style="margin-bottom:12px">
        <label style="margin:0">Rate card for branch</label>
        <select style="max-width:280px" onchange="renderRateCard(this.value)">
          ${(MY.branches || []).map(b => `<option value="${esc(b.key)}"${b.key === card.branch ? ' selected' : ''}>${esc(b.flag || '')} ${esc(b.label)}</option>`).join('')}
        </select>
        <div class="muted" style="font-size:12px;margin-top:4px">Each branch is priced separately — pick a branch to view or edit its card.</div>
      </div>` : ''}
      <div class="row" style="justify-content:space-between;align-items:flex-end">
        <div><label style="margin:0">Currency</label>
          <select id="rcCurrency" style="max-width:140px"${editable ? "" : " disabled"}>
            ${['PHP', 'USD', 'THB', 'KHR', 'VND'].map(c => `<option ${c === card.currency ? 'selected' : ''}>${c}</option>`).join('')}
          </select></div>
        <div class="muted">Rate card for <b>${esc(NODE_LABELS[card.branch] || card.branch || 'Head office')}</b><br>${card.updated_at ? `Last updated ${fmtDate(card.updated_at)} by ${esc(card.updated_by || '')}` : 'Not saved yet'}</div>
      </div>

      ${!card.sections || card.sections.customer ? `
      <div class="rc-label" style="margin-top:16px">Empty box price <span class="muted" style="font-weight:400">(what a customer pays to buy a box)</span></div>
      <div class="table-scroll"><table>
        <tr>${sizes.map(s => `<th>${esc(s.label)}<br><span class="muted" style="font-weight:400">${esc(s.dimensions)}</span></th>`).join('')}</tr>
        <tr>${sizes.map(s => `<td>${cell('rc_empty_' + s.key, card.empty_box_price[s.key])}</td>`).join('')}</tr>
      </table></div>

      ${ACCT_META.ocean_levels.map(oceanTable).join('')}` : ''}

      ${!card.sections || card.sections.interbranch ? `
      <div class="rc-label" style="margin-top:12px">Inter-branch charge — ALL-IN per container <span class="muted" style="font-weight:400">(one flat fee per container covering the whole destination-side service for every box inside)</span></div>
      <div class="table-scroll"><table>
        <tr>${CONTAINER_SIZE_KEYS.map(k => `<th>${esc(CONTAINER_SIZE_LABELS[k] || k)}</th>`).join('')}</tr>
        <tr>${CONTAINER_SIZE_KEYS.map(k => `<td>${cell('rc_ib_' + k, (card.interbranch_container || {})[k])}</td>`).join('')}</tr>
      </table></div>

      <div class="rc-label" style="margin-top:12px">Extra destination charges <span class="muted" style="font-weight:400">(billed on an inter-branch settlement only when they actually occur)</span></div>
      <div class="table-scroll"><table>
        <tr><th>Charge</th><th>Unit</th><th>Rate</th></tr>
        ${(ACCT_META.extra_charges || []).map(x => `<tr>
          <td>${esc(x.label)}</td><td class="muted">per ${esc(x.unit)}</td>
          <td>${cell('rc_x_' + x.key, (card.interbranch_extras || {})[x.key])}</td></tr>`).join('')}
      </table></div>

      ` : ''}

      ${!card.sections || card.sections.customer ? `
      <div class="rc-label" style="margin-top:12px">${esc(ACCT_META.service_level_labels[ACCT_META.air_level] || 'Express Air')} — price per kilo</div>
      <div class="table-scroll"><table>
        <tr>${zones.map(z => `<th>${esc(z.label)}</th>`).join('')}</tr>
        <tr>${zones.map(z => `<td>${cell('rc_air_' + z.key, card.air[ACCT_META.air_level][z.key])}</td>`).join('')}</tr>
      </table></div>` : ''}

      ${editable
        ? `<button onclick="saveRateCard()" style="margin-top:14px">Save rate card</button>
           <button class="secondary" style="margin-top:14px" onclick="undoRateCard()">↩ Undo last save</button>`
        : `<div class="note-info" style="margin-top:14px">This is a read-only view of the rates your branch is billed on — only an admin can change them.</div>`}
    </div>
    <div id="fxCard"></div>`;
  renderFxCard();
}

/* ---------- BSP exchange rates ---------- */
// Head office states the group's books in pesos, so it needs a peso rate for every currency
// a branch bills in. VFIC takes those from the BSP Reference Exchange Rate Bulletin.
async function renderFxCard() {
  const host = document.getElementById('fxCard');
  if (!host) return;
  let fx;
  try { fx = await api('/api/accounting/fx'); } catch (e) { host.innerHTML = ''; return; }
  // Head office issues its settlements in pesos and converts nothing, so it has no use for
  // a rate table. Only a branch does, and only to read what Manila has billed it.
  const home = BRANCH_CURRENCY[fx.branch];
  if (!home || home === 'PHP') { host.innerHTML = ''; return; }
  const stale = fx.age_days != null && fx.age_days > 7;
  const cell = (c) => `<td>${c === 'PHP'
    ? '<span class="muted">base</span>'
    : `<input id="fx_${c}" type="number" min="0" step="0.0001" value="${fx.rates[c] || ''}" style="width:110px;padding:5px 7px"${fx.editable ? '' : ' disabled'}>`}</td>`;
  const perPhp = fx.rates[home] ? (1 / fx.rates[home]) : null;   // how much of ours one peso buys
  host.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:flex-end">
        <div>
          <h2 style="margin:0">Settlement conversion <span class="muted" style="font-size:13px;font-weight:400">· PHP → ${esc(home)}</span></h2>
          <div class="muted" style="font-size:12.5px;margin-top:4px">
            Head office bills this branch in pesos. This is the rate those settlements are read at.
            Source: <a href="${esc(fx.source_url)}" target="_blank" rel="noopener">${esc(fx.source)}</a>.
          </div>
        </div>
        <div class="muted" style="text-align:right;font-size:12.5px">
          Rate date <b>${esc(fx.as_of)}</b>${fx.age_days != null ? ` · ${fx.age_days} day(s) old` : ''}<br>
          ${fx.updated_at ? `Saved ${fmtDate(fx.updated_at)} by ${esc(fx.updated_by || '')}` : 'Starting figure — not yet updated'}
        </div>
      </div>
      ${perPhp ? `<div class="fx-headline">PHP 1.00 = <b>${esc(home)} ${perPhp.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</b></div>` : ''}
      ${stale ? `<div class="note-warn" style="margin-top:10px">This rate is ${fx.age_days} days old — press Refresh, or type today's in.</div>` : ''}
      <div class="row" style="gap:8px;align-items:flex-end;margin-top:12px">
        <div style="max-width:190px">
          <label style="margin:0">Pesos per 1 ${esc(home)}</label>
          <input id="fx_${esc(home)}" type="number" min="0" step="0.000001" value="${fx.rates[home] || ''}"${fx.editable ? '' : ' disabled'}>
        </div>
        <div><label style="margin:0">Rate date</label><input id="fxAsOf" type="date" value="${esc(fx.as_of)}" style="max-width:180px"${fx.editable ? '' : ' disabled'}></div>
        ${fx.editable ? `
          <button onclick="saveFx()">Save</button>
          <button class="secondary" onclick="refreshFx(this)">↻ Refresh from ${esc(fx.source_short || fx.source)}</button>` : ''}
      </div>
      ${fx.editable ? `<div class="muted" style="font-size:12px;margin-top:6px">
        Refresh reads today's published rate. If the source cannot be reached, nothing is
        overwritten — type the rate in instead.
      </div>` : `<div class="note-info" style="margin-top:12px">Only an admin can change this rate.</div>`}
    </div>`;
}
async function saveFx() {
  const fx = await api('/api/accounting/fx');
  const rates = {};
  // Only the branch's own currency is on screen; the rest of the table is left as it is.
  for (const c of fx.currencies) {
    const el = document.getElementById('fx_' + c);
    if (el && el.value !== '') rates[c] = +el.value;
  }
  try {
    await api('/api/accounting/fx', { method: 'PUT', body: { rates, as_of: (document.getElementById('fxAsOf') || {}).value } });
    flash('Exchange rates saved');
    renderFxCard();
  } catch (e) { showErr(e); }
}
async function refreshFx(btn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Reading BSP…';
  try {
    const fx = await api('/api/accounting/fx/refresh', { method: 'POST' });
    flash(`Rates updated from the BSP bulletin of ${fx.as_of} (${(fx.fetched || []).join(', ')})`);
    renderFxCard();
  } catch (e) {
    showErr(e);
  } finally { btn.disabled = false; btn.textContent = label; }
}
async function saveRateCard() {
  const zones = ACCT_META.zones, sizes = ACCT_META.sizes;
  const v = (id) => +(document.getElementById(id) || {}).value || 0;
  const body = {
    currency: document.getElementById('rcCurrency').value,
    empty_box_price: Object.fromEntries(sizes.map(s => [s.key, v('rc_empty_' + s.key)])),
    ocean: Object.fromEntries(ACCT_META.ocean_levels.map(lvl => [lvl,
      Object.fromEntries(zones.map(z => [z.key,
        Object.fromEntries(sizes.map(s => [s.key, v(`rc_${lvl}_${z.key}_${s.key}`)]))]))])),
    air: { [ACCT_META.air_level]: Object.fromEntries(zones.map(z => [z.key, v('rc_air_' + z.key)])) },
    interbranch_container: Object.fromEntries(CONTAINER_SIZE_KEYS.map(k => [k, v('rc_ib_' + k)])),
    interbranch_extras: Object.fromEntries((ACCT_META.extra_charges || []).map(x => [x.key, v('rc_x_' + x.key)]))
  };
  try {
    await api('/api/accounting/rate-card' + (RC_BRANCH ? '?branch=' + encodeURIComponent(RC_BRANCH) : ''), { method: 'PUT', body });
    flash('Rate card saved for ' + (NODE_LABELS[RC_BRANCH] || 'head office'));
    renderRateCard();
  }
  catch (e) { showErr(e); }
}

async function renderInvoices() {
  const [list, shipments] = await Promise.all([api('/api/accounting/invoices'), api('/api/shipments')]);
  document.getElementById('acctBody').innerHTML = `
    <details class="collapse card"><summary>+ New invoice</summary>
      <div class="form-grid" style="margin-top:8px">
        <div><label>Bill to *</label><input id="invTo" placeholder="Customer name"></div>
        <div><label>From shipment <span class="muted">(optional — auto-prices the boxes)</span></label>
          <select id="invShipment" onchange="quoteShipment()">
            <option value="">— none —</option>
            ${shipments.map(s => `<option value="${s.id}">${esc(s.shipment_number)} · ${esc(s.sender_name || '')}</option>`).join('')}
          </select></div>
      </div>
      <div id="invLines"></div>
      <button class="secondary small" onclick="addInvLine()">+ Add line</button>
      <div><label>Notes</label><input id="invNotes"></div>
      <button onclick="createInvoice()">Create invoice</button>
    </details>
    <div class="card table-scroll">
      <table><tr><th>Invoice</th><th>Bill to</th><th>Total</th><th>Status</th><th>Receipt</th><th>Issued</th><th></th></tr>
      ${list.map(i => `<tr>
        <td><b>${esc(i.invoice_number)}</b></td>
        <td>${esc(i.bill_to)}<div class="muted">${i.lines.map(l => esc(l.description)).join(', ')}</div></td>
        <td>${esc(money(i.total, i.currency))}</td>
        <td><span class="badge ${i.status === 'PAID' ? 'st-delivered' : i.status === 'VOID' ? 'st-cancelled' : 'st-created'}">${esc(i.status)}</span></td>
        <td>${i.receipt_number ? `<b>${esc(i.receipt_number)}</b><div class="muted">${fmtDay(i.paid_at)}</div>` : '<span class="muted">—</span>'}</td>
        <td>${fmtDay(i.issued_at)}</td>
        <td class="inline-actions">
          ${i.status !== 'PAID' ? `<button class="small" onclick="setInvoice(${i.id}, 'PAID')">Mark paid</button>` : `<button class="small secondary" onclick="setInvoice(${i.id}, 'UNPAID')">Unpay</button>`}
          ${i.status !== 'VOID' ? `<button class="small secondary danger" onclick="setInvoice(${i.id}, 'VOID')">Void</button>` : ''}
        </td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">No invoices yet</td></tr>'}
      </table>
    </div>`;
  addInvLine();
}
let invLineSeq = 0;
function addInvLine(desc = '', qty = 1, unit = 0) {
  invLineSeq += 1;
  const n = invLineSeq;
  document.getElementById('invLines').insertAdjacentHTML('beforeend', `
    <div class="row invLine" data-line="${n}" style="gap:6px;margin-top:6px">
      <input class="ilDesc" placeholder="Description" value="${esc(desc)}" style="flex:2">
      <input class="ilQty" type="number" min="0" step="1" value="${qty}" placeholder="Qty" style="width:80px">
      <input class="ilUnit" type="number" min="0" step="0.01" value="${unit}" placeholder="Unit" style="width:110px">
      <button class="secondary small" onclick="this.parentElement.remove()">×</button>
    </div>`);
}
async function quoteShipment() {
  const id = document.getElementById('invShipment').value;
  if (!id) return;
  try {
    const q = await api('/api/accounting/quote/' + id);
    document.getElementById('invLines').innerHTML = '';
    q.boxes.forEach(b => addInvLine(`${b.box_number} · ${SIZE_LABEL(b.size_category)} · ${b.zone || 'unzoned'}`, 1, b.amount));
    if (!q.boxes.length) addInvLine();
    flash(`Priced ${q.boxes.length} box(es) — total ${money(q.total, q.currency)}`);
  } catch (e) { showErr(e); }
}
async function createInvoice() {
  const lines = [...document.querySelectorAll('.invLine')].map(el => ({
    description: el.querySelector('.ilDesc').value.trim(),
    qty: +el.querySelector('.ilQty').value || 0,
    unit_amount: +el.querySelector('.ilUnit').value || 0
  })).filter(l => l.description);
  try {
    await api('/api/accounting/invoices', { method: 'POST', body: {
      bill_to: document.getElementById('invTo').value.trim(),
      shipment_id: document.getElementById('invShipment').value || null,
      notes: document.getElementById('invNotes').value.trim(), lines
    } });
    flash('Invoice created'); renderInvoices();
  } catch (e) { showErr(e); }
}
async function setInvoice(id, status) {
  try { await api('/api/accounting/invoices/' + id, { method: 'PUT', body: { status } }); flash('Invoice → ' + status); renderInvoices(); }
  catch (e) { showErr(e); }
}

async function renderExpenses() {
  const { expenses, categories } = await api('/api/accounting/expenses');
  document.getElementById('acctBody').innerHTML = `
    <details class="collapse card" open><summary>+ Record an expense</summary>
      <div class="form-grid" style="margin-top:8px">
        <div><label>Category</label><select id="exCat">${categories.map(c => `<option value="${c}">${c.replace(/_/g, ' ')}</option>`).join('')}</select></div>
        <div><label>Description *</label><input id="exDesc" placeholder="e.g. Ocean freight for C3"></div>
        <div><label>Amount *</label><input id="exAmt" type="number" min="0" step="0.01"></div>
        <div><label>Date</label><input id="exDate" type="date"></div>
      </div>
      <button onclick="addExpense()">Record expense</button>
    </details>
    <div class="card table-scroll">
      <table><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>By</th><th></th></tr>
      ${expenses.map(e => `<tr>
        <td>${fmtDay(e.spent_at)}</td><td><span class="badge st-created">${esc(e.category.replace(/_/g, ' '))}</span></td>
        <td>${esc(e.description)}</td><td>${esc(money(e.amount, e.currency))}</td><td>${esc(e.recorded_by || '')}</td>
        <td><button class="small secondary danger" onclick="delExpense(${e.id})">Delete</button></td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">No expenses recorded</td></tr>'}
      </table>
    </div>`;
}
async function addExpense() {
  try {
    await api('/api/accounting/expenses', { method: 'POST', body: {
      category: exCat.value, description: exDesc.value.trim(),
      amount: exAmt.value, spent_at: exDate.value ? new Date(exDate.value).toISOString() : undefined
    } });
    flash('Expense recorded'); renderExpenses();
  } catch (e) { showErr(e); }
}
async function delExpense(id) {
  if (!confirm('Delete this expense?')) return;
  try { await api('/api/accounting/expenses/' + id, { method: 'DELETE' }); renderExpenses(); } catch (e) { showErr(e); }
}

async function renderPnl(from, to) {
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const p = await api('/api/accounting/pnl' + (q.toString() ? '?' + q : ''));
  const cat = Object.entries(p.expenses.by_category);
  document.getElementById('acctBody').innerHTML = `
    <div class="card">
      <div class="row" style="gap:8px;align-items:flex-end">
        ${(MY && MY.sees_all_branches) ? `<div><label style="margin:0">Books</label>
          <select style="max-width:260px" onchange="pnlBranch(this.value)">
            <option value="">Whole group (consolidated)</option>
            ${(MY.branches || []).map(b => `<option value="${esc(b.key)}"${b.key === p.branch ? ' selected' : ''}>${esc(b.flag || '')} ${esc(b.label)}</option>`).join('')}
          </select></div>` : ''}
        <div><label style="margin:0">From</label><input id="pnlFrom" type="date" value="${from || ''}"></div>
        <div><label style="margin:0">To</label><input id="pnlTo" type="date" value="${to || ''}"></div>
        <button class="small" onclick="renderPnl(pnlFrom.value, pnlTo.value)">Apply</button>
        ${from || to ? `<button class="small secondary" onclick="renderPnl()">Clear</button>` : ''}
      </div>
    </div>
    ${p.books === 'HQ' ? `<div class="note-info" style="margin-bottom:12px">
      Head office books the <b>inter-branch settlements it issues</b> against its <b>local Philippine costs</b>.
      What Thailand and Cambodia bill their own senders — and anything still owed on it — stays in those branches' books.
    </div>` : ''}
    <div class="tiles">
      <div class="tile"><div class="num">${esc(money(p.revenue.billed, p.currency))}</div><div class="lbl">${p.books === 'HQ' ? `Settlements issued (${p.revenue.invoice_count})` : `Revenue billed (${p.revenue.invoice_count} invoices)`}</div></div>
      <div class="tile"><div class="num">${esc(money(p.revenue.collected, p.currency))}</div><div class="lbl">${p.books === 'HQ' ? 'Settled by branches' : 'Collected'}</div></div>
      <div class="tile"><div class="num">${esc(money(p.revenue.receivable, p.currency))}</div><div class="lbl">${p.books === 'HQ' ? 'Due from branches' : 'Receivable'}</div></div>
      <div class="tile"><div class="num">${esc(money(p.expenses.total, p.currency))}</div><div class="lbl">${p.books === 'HQ' ? `Local PH expenses (${p.expenses.count})` : `Expenses (${p.expenses.count})`}</div></div>
    </div>
    ${p.mixed_currency ? fxBreakdownHtml(p.consolidated, p) : ''}
    ${(p.stray_currencies || []).length ? `<div class="note-warn" style="margin-bottom:12px">
      Some shipments here are booked in <b>${esc(p.stray_currencies.join(", "))}</b> rather than ${esc(p.currency)}.
      They are converted for this statement, but the figure will move with the exchange rate until they are corrected —
      usually a shipment encoded with the wrong currency.
    </div>` : ''}
    ${!p.mixed_currency && p.fx_note ? `<div class="muted" style="margin:-4px 0 12px;font-size:12.5px">
      Inter-branch settlements are billed in pesos and shown here in ${esc(p.currency)}, converted at the
      <a href="${esc(p.fx_note.source_url)}" target="_blank" rel="noopener">${esc(p.fx_note.source)}</a> rate of ${esc(p.fx_note.as_of)}.
      ${p.unconverted_settlements ? `<b>${p.unconverted_settlements} settlement(s) have no rate and are left out.</b>` : ''}
    </div>` : ''}
    <div class="card">
      <h2 style="margin-top:0">Profit &amp; Loss${p.mixed_currency ? ` <span class="muted" style="font-size:13px;font-weight:400">· converted to PHP</span>` : ''}</h2>
      <table>
        <tr><td><b>${p.books === 'HQ' ? 'Revenue (inter-branch settlements issued)' : 'Revenue (billed to customers)'}</b></td>
          <td style="text-align:right"><button class="amount-link" onclick="pnlBreakdown('revenue')">${esc(money(p.revenue.billed, p.currency))}</button></td></tr>
        ${p.interbranch && p.interbranch.income ? `<tr><td class="muted" style="padding-left:22px">Inter-branch billed to other branches</td><td style="text-align:right" class="muted">${esc(money(p.interbranch.income, p.currency))}</td></tr>` : ''}
        <tr><td><b>${p.books === 'HQ' ? 'Local Philippine costs' : 'Costs'}</b></td>
          <td style="text-align:right">${p.expenses.total ? `<button class="amount-link" onclick="pnlBreakdown('expenses')">− ${esc(money(p.expenses.total, p.currency))}</button>` : ''}</td></tr>
        ${cat.length ? cat.map(([k, v]) => `<tr><td class="muted" style="padding-left:22px">${esc(k.replace(/_/g, ' '))}</td><td style="text-align:right" class="muted">− ${esc(money(v, p.currency))}</td></tr>`).join('')
          : `<tr><td class="muted" style="padding-left:22px">No expenses recorded in this period</td><td style="text-align:right" class="muted">− ${esc(money(0, p.currency))}</td></tr>`}
        ${p.interbranch && p.interbranch.cost ? `<tr><td class="muted" style="padding-left:22px">Inter-branch charges from other branches</td>
          <td style="text-align:right"><button class="amount-link muted" onclick="pnlBreakdown('interbranch')">− ${esc(money(p.interbranch.cost, p.currency))}</button></td></tr>` : ''}
        <tr><td><b>Total costs</b></td><td style="text-align:right">− ${esc(money((p.totals && p.totals.costs) || p.expenses.total, p.currency))}</td></tr>
        <tr style="border-top:2px solid var(--border)">
          <td><b>Net profit (accrual)</b></td>
          <td style="text-align:right;font-weight:800;color:${p.net_profit >= 0 ? 'var(--green)' : 'var(--red)'}">${esc(money(p.net_profit, p.currency))}</td></tr>
        <tr><td><b>Net cash (collected − expenses)</b></td>
          <td style="text-align:right;font-weight:800;color:${p.net_cash >= 0 ? 'var(--green)' : 'var(--red)'}">${esc(money(p.net_cash, p.currency))}</td></tr>
      </table>
      ${p.interbranch && p.interbranch.note ? `<div class="muted" style="font-size:12px;margin-top:10px">${esc(p.interbranch.note)}</div>` : ''}
      <div class="muted no-print" style="font-size:12px;margin-top:10px">Click any amount to see what makes it up.</div>
    </div>
    <div id="pnlDrill"></div>`;
}

// The records behind one line of the statement. Built from the same filtered lists the
// figure came from, so the rows always add up to the total they were opened from.
async function pnlBreakdown(line) {
  const host = document.getElementById('pnlDrill');
  if (!host) return;
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const from = (document.getElementById('pnlFrom') || {}).value;
  const to = (document.getElementById('pnlTo') || {}).value;
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  q.set('breakdown', line);
  host.innerHTML = '<div class="card muted">Loading…</div>';
  try {
    const d = await api('/api/accounting/pnl?' + q.toString());
    host.innerHTML = `
      <div class="card">
        <div class="row" style="justify-content:space-between;align-items:baseline">
          <h2 style="margin:0">${esc(d.label)} <span class="muted" style="font-size:13px;font-weight:400">· ${d.rows.length} record(s)</span></h2>
          <button class="small secondary" onclick="document.getElementById('pnlDrill').innerHTML=''">Close</button>
        </div>
        ${d.rows.length ? `<div class="table-scroll" style="margin-top:8px"><table>
          <tr><th>Reference</th><th>Who</th><th>Date</th><th>Status</th>${d.converted ? '<th>As booked</th>' : ''}<th>${esc(d.currency)}</th></tr>
          ${d.rows.map(r => `<tr>
            <td>${r.href ? `<a href="${r.href}">${esc(r.ref)}</a>` : esc(r.ref)}</td>
            <td>${esc(r.who || '')}</td>
            <td>${fmtDay(r.when)}</td>
            <td>${r.status ? `<span class="badge ${IB_BADGE[r.status] || (r.status === 'PAID' ? 'pay-paid' : 'pay-unpaid')}">${esc(r.status)}</span>` : ''}</td>
            ${d.converted ? `<td class="muted">${esc(money(r.original, r.original_currency))}</td>` : ''}
            <td>${r.amount == null ? '<span class="muted">no rate</span>' : esc(money(r.amount, d.currency))}</td>
          </tr>`).join('')}
          <tr style="border-top:2px solid var(--border)"><td colspan="${d.converted ? 4 : 3}"><b>Total</b></td>
            ${d.converted ? '<td></td>' : ''}<td><b>${esc(money(d.total, d.currency))}</b></td></tr>
        </table></div>` : '<div class="muted" style="margin-top:8px">Nothing on this line for the period.</div>'}
      </div>`;
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) { host.innerHTML = `<div class="card error">${esc(e.message)}</div>`; }
}

// Switch which set of books the statement shows. It rides on the same ?branch= the rest of
// the portal uses, so the "Viewing … only" banner stays truthful.
function pnlBranch(key) {
  location.hash = '#/accounting/pnl' + (key ? '?branch=' + encodeURIComponent(key) : '');
}

// The conversion behind a consolidated peso total: what each branch currency contributed,
// at which BSP rate. Shown so the PHP figure can be checked line by line rather than trusted.
function fxBreakdownHtml(c, p) {
  if (!c) return '';
  const stale = c.age_days != null && c.age_days > 7;
  return `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:baseline">
        <h2 style="margin:0">Converted to pesos</h2>
        <span class="muted" style="font-size:12.5px">
          <a href="${esc(c.source_url)}" target="_blank" rel="noopener">${esc(c.source)}</a> · as of ${esc(c.as_of)}
        </span>
      </div>
      <div class="muted" style="margin:6px 0 10px">Each branch bills in its own currency. Revenue is converted at the BSP reference rate to give one peso total.</div>
      <div class="table-scroll"><table>
        <tr><th>Currency</th><th>Shipments</th><th>Billed</th><th>BSP rate</th><th>Billed (PHP)</th><th>Collected (PHP)</th></tr>
        ${c.lines.map(l => `<tr>
          <td><b>${esc(l.currency)}</b></td><td>${l.shipments == null ? '' : l.shipments}</td>
          <td>${esc(money(l.billed, l.currency))}</td>
          <td>${l.converted ? esc('₱ ' + l.rate.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 }) + ' / ' + l.currency) : '<span class="muted">no rate</span>'}</td>
          <td>${l.converted ? esc(money(l.php.billed, 'PHP')) : '<span class="muted">—</span>'}</td>
          <td>${l.converted ? esc(money(l.php.collected, 'PHP')) : '<span class="muted">—</span>'}</td>
        </tr>`).join('')}
        <tr style="border-top:2px solid var(--border)">
          <td colspan="4"><b>Total</b></td>
          <td><b>${esc(money(c.totals.billed, 'PHP'))}</b></td>
          <td><b>${esc(money(c.totals.collected, 'PHP'))}</b></td></tr>
      </table></div>
      ${c.unconverted.length ? `<div class="note-warn" style="margin-top:10px">
        No BSP rate on file for <b>${esc(c.unconverted.join(', '))}</b>, so ${c.unconverted.length > 1 ? 'those currencies are' : 'that currency is'} left out of the peso total.</div>` : ''}
      ${p && p.unconverted_expenses ? `<div class="note-warn" style="margin-top:10px">
        ${p.unconverted_expenses} expense(s) are in a currency with no BSP rate and are left out of the peso total.</div>` : ''}
      ${stale ? `<div class="note-warn" style="margin-top:10px">
        These rates are ${c.age_days} days old. ${isAnyAdmin() ? 'Refresh them in <a href="#/accounting/rates">Rate Cards → Exchange rates</a>.' : 'Ask an admin to refresh them.'}</div>` : ''}
    </div>`;
}

/* ---------- branch-to-branch settlements ---------- */
const IB_BADGE = { DRAFT: 'st-created', ISSUED: 'st-sorted', RECEIVED: 'st-assigned', REMITTED: 'st-loaded', PAID: 'st-delivered', DISPUTED: 'st-returned', VOID: 'st-cancelled' };
let IB_DRAFT = null;

// Pull from peers on demand. The list auto-syncs when it loads, but a branch chasing a
// settlement head office says it has issued needs a way to ask again without waiting.
async function syncInterbranch(btn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const r = await api('/api/sync/run', { method: 'POST' });
    const applied = (r.peers || []).reduce((n, p) => n + (p.applied || 0), 0);
    const failed = (r.peers || []).filter(p => !p.ok);
    if (failed.length) flash(`Could not reach ${failed.map(p => p.peer).join(', ')}: ${failed[0].error}`, 'error');
    else flash(applied ? `${applied} record(s) pulled in.` : 'Already up to date.');
    renderInterbranch();
  } catch (e) { showErr(e); }
  finally { btn.disabled = false; btn.textContent = label; }
}

async function renderInterbranch() {
  const d = await api('/api/accounting/interbranch');
  const canIssue = isAdmin() || (ME && ME.role === 'ACCOUNTING');
  const partners = d.branches.filter(b => b.type !== 'HQ');
  const row = (i) => `<tr>
    <td><b>${esc(i.invoice_number)}</b><div class="muted">${fmtDay(i.created_at)}</div></td>
    <td>${esc(i.from_label)} <span class="muted">→</span> ${esc(i.to_label)}
      ${i.direction !== 'BOTH' ? `<div><span class="badge ${i.direction === 'RECEIVABLE' ? 'st-delivered' : 'st-returned'}">${i.direction}</span></div>` : ''}</td>
    <td class="wrap-cell" style="max-width:320px">${i.lines.map(l => esc(l.description)).join('<br>')}
      ${i.period_from || i.period_to ? `<div class="muted">Period ${fmtDay(i.period_from)} – ${fmtDay(i.period_to)}</div>` : ''}
      ${i.notes ? `<div class="muted">“${esc(i.notes)}”</div>` : ''}</td>
    <td>${i.home
      ? `<b>${esc(money(i.home.amount, i.home.currency))}</b>
         <div class="muted" style="font-size:11.5px">billed ${esc(money(i.total, i.currency))}</div>`
      : `<b>${esc(money(i.total, i.currency))}</b>`}</td>
    <td><span class="badge ${IB_BADGE[i.status]}">${esc(i.status)}</span></td>
    <td class="inline-actions">
      ${i.status === 'DRAFT' && canIssue ? `<button class="small" onclick="setIb(${i.id},'ISSUED')">Issue</button>` : ''}
      ${i.status === 'ISSUED' && i.direction !== 'RECEIVABLE' ? `<button class="small" onclick="setIb(${i.id},'RECEIVED')">Acknowledge</button>` : ''}
      ${['ISSUED','RECEIVED'].includes(i.status) && i.direction !== 'RECEIVABLE' ? `<button class="small" onclick="remitIb(${i.id})">Pay / remit</button>` : ''}
      ${i.status === 'REMITTED' && canIssue ? `<button class="small" onclick="setIb(${i.id},'PAID')">Confirm received</button>` : ''}
      ${['ISSUED','RECEIVED','DISPUTED'].includes(i.status) && i.direction !== 'RECEIVABLE' ? `<button class="small secondary" onclick="disputeIb(${i.id})">Dispute</button>` : ''}
      ${(i.history || []).length ? `<button class="small secondary" onclick="undoIb(${i.id})" title="Undo the last change">↩ Undo</button>` : ''}
      ${i.status !== 'VOID' && canIssue ? `<button class="small secondary danger" onclick="setIb(${i.id},'VOID')">Void</button>` : ''}
    </td></tr>`;

  document.getElementById('acctBody').innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="num">${esc(money(d.totals.receivable, d.totals_currency))}</div><div class="lbl">Owed to us by other branches</div></div>
      <div class="tile"><div class="num">${esc(money(d.totals.payable, d.totals_currency))}</div><div class="lbl">We owe other branches</div></div>
    </div>
    ${d.fx ? `<div class="muted" style="font-size:12.5px;margin:-6px 0 10px">
      Head office bills in pesos. Amounts are shown in ${esc(d.home_currency)} at the
      <a href="${esc(d.fx.source_url)}" target="_blank" rel="noopener">${esc(d.fx.source)}</a> rate of ${esc(d.fx.as_of)},
      with the peso figure on the document beneath each one.
    </div>` : ''}
    ${isAnyAdmin() ? `<div class="row" style="justify-content:flex-end;align-items:center;gap:8px;margin:-6px 0 10px">
      <span class="muted" style="font-size:12.5px">Settlements are raised on the other branch's system and pulled here.</span>
      <button class="small secondary" onclick="syncInterbranch(this)">⟳ Check for new settlements</button>
    </div>` : ''}
    ${canIssue ? `
    <details class="collapse card" open><summary>Generate a settlement from delivered boxes</summary>
      <div class="muted" style="font-size:12px;margin:8px 0">
        Head office bills an origin branch an ALL-IN fee per container that arrived in the period,
        priced by container size — covering customs, stripping, sorting and delivery of every box
        inside — plus any agreed commission.
      </div>
      <div class="form-grid">
        <div><label>Billing branch</label><select id="ibFrom">${d.branches.map(b => `<option value="${b.key}" ${b.type === 'HQ' ? 'selected' : ''}>${esc(b.label)}</option>`).join('')}</select></div>
        <div><label>Branch to bill</label><select id="ibTo">${partners.map(b => `<option value="${b.key}">${esc(b.label)}</option>`).join('')}</select></div>
        <div><label>Period from</label><input id="ibFromDate" type="date"></div>
        <div><label>Period to</label><input id="ibToDate" type="date"></div>
      </div>
      <button onclick="generateIb()">Preview settlement</button>
      <div id="ibPreview"></div>
    </details>` : ''}
    <div class="card table-scroll">
      <table><tr><th>Settlement</th><th>Between</th><th>Lines</th><th>Total</th><th>Status</th><th></th></tr>
      ${d.invoices.map(row).join('') || '<tr><td colspan="6" class="muted">No inter-branch settlements yet</td></tr>'}
      </table>
    </div>`;
}

async function generateIb() {
  const body = {
    from_branch: ibFrom.value, to_branch: ibTo.value,
    period_from: ibFromDate.value || null, period_to: ibToDate.value || null
  };
  const out = document.getElementById('ibPreview');
  out.innerHTML = '<div class="muted">Working…</div>';
  try {
    const q = await api('/api/accounting/interbranch/generate', { method: 'POST', body });
    IB_DRAFT = { ...body, currency: q.currency, lines: q.lines, containers_counted: q.containers_counted, boxes_covered: q.boxes_covered };
    renderIbPreview();
  } catch (e) { out.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}
// Redraw the draft preview, with a remove button on every line.
function renderIbPreview() {
  const host = document.getElementById('ibPreview');
  if (!host || !IB_DRAFT) return;
  const total = IB_DRAFT.lines.reduce((n, l) => n + l.amount, 0);
  host.innerHTML = `
    <div class="card" style="margin-top:10px">
      <b>Draft settlement — ${esc(money(total, IB_DRAFT.currency))}</b>
      ${IB_DRAFT.containers_counted != null ? `<div class="muted">${IB_DRAFT.containers_counted} container(s) arrived, covering ${IB_DRAFT.boxes_covered} box(es)</div>` : ''}
      <table style="margin-top:8px">
        <tr><th>Line</th><th>Qty</th><th>Unit</th><th>Amount</th><th></th></tr>
        ${IB_DRAFT.lines.map((l, i) => `<tr>
          <td>${esc(l.description)}</td><td>${l.qty}</td>
          <td>${esc(money(l.unit_amount, IB_DRAFT.currency))}</td>
          <td>${esc(money(l.amount, IB_DRAFT.currency))}</td>
          <td><button class="small secondary" onclick="removeIbLine(${i})">×</button></td></tr>`).join('')}
      </table>

      <div class="rc-label" style="margin-top:12px">Add an extra charge <span class="muted" style="font-weight:400">(priced from the rate card)</span></div>
      <div class="row" style="gap:6px;flex-wrap:nowrap">
        <select id="ibExtra" style="flex:2">${(ACCT_META.extra_charges || []).map(x => `<option value="${x.key}">${esc(x.label)} (per ${esc(x.unit)})</option>`).join('')}</select>
        <input id="ibExtraQty" type="number" min="1" value="1" style="width:90px" title="Quantity">
        <button type="button" class="secondary" onclick="addIbExtra()">Add</button>
      </div>

      <div class="rc-label" style="margin-top:12px">Add a custom line <span class="muted" style="font-weight:400">(anything not on the rate card)</span></div>
      <div class="row" style="gap:6px;flex-wrap:nowrap">
        <input id="ibCustDesc" placeholder="Description" style="flex:2">
        <input id="ibCustQty" type="number" min="1" value="1" style="width:80px" title="Quantity">
        <input id="ibCustAmt" type="number" min="0" step="0.01" placeholder="Unit amount" style="width:130px">
        <button type="button" class="secondary" onclick="addIbCustomLine()">Add</button>
      </div>

      <button style="margin-top:12px" onclick="saveIb()">Create this settlement</button>
    </div>`;
}
function removeIbLine(i) {
  if (!IB_DRAFT) return;
  IB_DRAFT.lines.splice(i, 1);
  if (!IB_DRAFT.lines.length) { flash('All lines removed — add at least one before creating.', 'error'); }
  renderIbPreview();
}
// A line that is not on the rate card at all.
function addIbCustomLine() {
  if (!IB_DRAFT) { showErr(new Error('Preview a settlement first.')); return; }
  const desc = (document.getElementById('ibCustDesc').value || '').trim();
  const qty = Math.max(1, +document.getElementById('ibCustQty').value || 1);
  const unit = +document.getElementById('ibCustAmt').value || 0;
  if (!desc) { showErr(new Error('Give the line a description.')); return; }
  if (!unit) { showErr(new Error('Give the line an amount.')); return; }
  IB_DRAFT.lines.push({ description: desc, container_size: null, qty, unit_amount: unit, amount: +(qty * unit).toFixed(2) });
  document.getElementById('ibCustDesc').value = '';
  document.getElementById('ibCustAmt').value = '';
  renderIbPreview();
}
// Append an extra destination charge to the draft, priced from the rate card.
async function addIbExtra() {
  if (!IB_DRAFT) return;
  const key = document.getElementById('ibExtra').value;
  const qty = Math.max(1, +document.getElementById('ibExtraQty').value || 1);
  const meta = (ACCT_META.extra_charges || []).find(x => x.key === key) || { label: key, unit: '' };
  try {
    const card = await api('/api/accounting/rate-card?branch=' + encodeURIComponent(IB_DRAFT.from_branch));
    const unit = +((card.interbranch_extras || {})[key] || 0);
    if (!unit) { showErr(new Error(`No rate is set for “${meta.label}” — set it in Rate Cards first.`)); return; }
    IB_DRAFT.lines.push({ description: `${meta.label} × ${qty}`, container_size: null, qty, unit_amount: unit, amount: +(qty * unit).toFixed(2) });
    const total = IB_DRAFT.lines.reduce((n, l) => n + l.amount, 0);
    flash(`Added ${meta.label} — new total ${money(total, IB_DRAFT.currency)}`);
    renderIbPreview();
  } catch (e) { showErr(e); }
}
async function saveIb() {
  if (!IB_DRAFT) return;
  try {
    const inv = await api('/api/accounting/interbranch', { method: 'POST', body: IB_DRAFT });
    flash(`Settlement ${inv.invoice_number} created as a draft`);
    IB_DRAFT = null;
    renderInterbranch();
  } catch (e) { showErr(e); }
}
async function setIb(id, status) {
  if (status === 'VOID' && !confirm('Void this settlement?')) return;
  try { await api('/api/accounting/interbranch/' + id, { method: 'PUT', body: { status } }); flash('Settlement → ' + status); renderInterbranch(); }
  catch (e) { showErr(e); }
}
async function remitIb(id) {
  const ref = prompt('Payment reference (bank transfer or receipt number):');
  if (!ref) return;
  try { await api('/api/accounting/interbranch/' + id, { method: 'PUT', body: { status: 'REMITTED', settled_reference: ref } }); flash('Marked as remitted'); renderInterbranch(); }
  catch (e) { showErr(e); }
}
async function undoIb(id) {
  try { const r = await api('/api/accounting/interbranch/' + id + '/undo', { method: 'POST' }); flash('Undone — back to ' + r.undone_to); renderInterbranch(); }
  catch (e) { showErr(e); }
}
async function undoRateCard() {
  if (!confirm('Roll this rate card back to the version before the last save?')) return;
  try { await api('/api/accounting/rate-card/undo', { method: 'POST' }); flash('Rate card rolled back'); renderRateCard(); }
  catch (e) { showErr(e); }
}
async function disputeIb(id) {
  const notes = prompt('What is being disputed?');
  if (!notes) return;
  try { await api('/api/accounting/interbranch/' + id, { method: 'PUT', body: { status: 'DISPUTED', notes } }); flash('Marked disputed'); renderInterbranch(); }
  catch (e) { showErr(e); }
}

/* ---------- reports ---------- */
async function pageReports() {
  const reports = [
    ['boxes-per-container', 'Boxes per container'],
    ['delivery-performance', 'Delivery performance (warehouse → delivered days)'],
    ['failed-reasons', 'Failed delivery reasons'],
    ['unpaid-shipments', 'Unpaid shipments']
  ];
  const data = await Promise.all(reports.map(([k]) => api('/api/reports/' + k)));
  view(`
    <h1>Reports</h1>
    <div id="boxMovementSection"></div>
    ${reports.map(([key, label], i) => {
      const rows = data[i];
      const cols = rows.length ? Object.keys(rows[0]) : [];
      return `<h2 id="rp-${key}">${esc(label)} <a href="/api/reports/${key}?format=csv" download><button class="small secondary">⬇ CSV</button></a></h2>
      <div class="card table-scroll">
        <table><tr>${cols.map(cl => `<th>${esc(cl.replace(/_/g, ' '))}</th>`).join('')}</tr>
        ${rows.map(rw => `<tr>${cols.map(cl => `<td>${esc(String(rw[cl] == null ? '' : rw[cl]).match(/^\d{4}-\d{2}-\d{2}T/) ? fmtDay(rw[cl]) : rw[cl])}</td>`).join('')}</tr>`).join('') || `<tr><td class="muted">No data</td></tr>`}
        </table>
      </div>`;
    }).join('')}`);
  renderBoxMovement((hashQuery().get('container') || ''));
}

// Box movement: each box's container of loading + its full status timeline (expandable).
async function renderBoxMovement(filter) {
  const el = document.getElementById('boxMovementSection');
  if (!el) return;
  const rows = await api('/api/reports/box-movement' + (filter ? '?container=' + encodeURIComponent(filter) : ''));
  el.innerHTML = `
    <h2 id="rp-box-movement">Box movement — status timeline per box
      <a href="/api/reports/box-movement${filter ? '?container=' + encodeURIComponent(filter) + '&' : '?'}format=csv" download><button class="small secondary">⬇ CSV</button></a>
    </h2>
    <div class="card row">
      <input id="bmFilter" placeholder="Filter by container no. or load code (e.g. C1)" style="max-width:320px" value="${esc(filter)}">
      <button class="small" onclick="renderBoxMovement(document.getElementById('bmFilter').value.trim())">Filter</button>
      ${filter ? `<button class="small secondary" onclick="renderBoxMovement('')">Clear</button>` : ''}
      <span class="muted">${rows.length} box(es)</span>
    </div>
    <div class="card table-scroll">
      <table>
        <tr><th></th><th>Box #</th><th>Container</th><th>Loaded from</th><th>Current status</th><th>Region</th><th>Receiver</th></tr>
        ${rows.map((r, i) => `
          <tr>
            <td><button class="small secondary" onclick="document.getElementById('bmtl${i}').classList.toggle('hidden')">Timeline</button></td>
            <td><a href="#/boxes/${r.box_id}">${esc(r.box_number)}</a></td>
            <td>${esc(r.container)}${r.load_code ? ` <span class="badge st-created">${esc(r.load_code)}</span>` : ''}</td>
            <td>${esc(r.loaded_from || '—')}${r.vessel ? '<br><span class="muted">' + esc(r.vessel) + '</span>' : ''}</td>
            <td>${badge(r.current_status)}</td>
            <td>${r.region ? regionBadge(r.region) : '<span class="muted">—</span>'}</td>
            <td>${esc(r.receiver || '')}</td>
          </tr>
          <tr id="bmtl${i}" class="hidden bm-timeline"><td colspan="7">
            <ul class="timeline" style="margin:6px 0">
              ${(r.timeline || []).map((e, j) => `
                <li class="${j === r.timeline.length - 1 ? 'current' : ''}">
                  <div class="t-status">${esc(e.label)}</div>
                  <div class="t-meta">${fmtDate(e.at)} · ${esc(e.actor)}</div>
                  ${e.note ? `<div class="t-note">${esc(e.note)}</div>` : ''}
                </li>`).join('') || '<li class="muted">No status events</li>'}
            </ul>
          </td></tr>`).join('') || '<tr><td colspan="7" class="muted">No boxes match</td></tr>'}
      </table>
    </div>`;
}

/* ---------- admin ---------- */
const BIR_FIELDS = ['tin', 'accreditation_no', 'min', 'serial_no', 'permit_no'];
async function saveBir() {
  const body = Object.fromEntries(BIR_FIELDS.map(k => [k, (document.getElementById('bir_' + k) || {}).value || '']));
  const msg = document.getElementById('birMsg');
  try {
    await api('/api/settings/bir', { method: 'PUT', body });
    if (msg) msg.textContent = 'Saved — these now print on every official receipt.';
    flash('Receipt details saved');
  } catch (e) { showErr(e); }
}
async function pageAdmin() {
  const [users, tpl, bir] = await Promise.all([
    api('/api/users'),
    api('/api/templates').catch(() => null),   // head-office only; branch admins get null
    api('/api/settings/bir')
  ]);
  view(`
    <div class="row" style="justify-content:space-between">
      <h1>Admin</h1>
      <a href="#/role-modules"><button class="secondary">🔐 Roles &amp; Modules</button></a>
    </div>

    <h2>Official Receipt details <span class="muted" style="font-size:13px;font-weight:400">(printed on every receipt)</span></h2>
    <div class="card">
      <div class="muted" style="margin-bottom:6px">
        Registration particulars for <b>${esc(NODE_LABELS[bir.branch] || bir.branch || 'this branch')}</b>, printed on the receipts it issues.
        Anything left blank prints as “—”. Each branch keeps its own set.
      </div>
      <div class="form-grid" id="birForm">
        <div><label>VAT Reg. TIN</label><input id="bir_tin" placeholder="000-000-000-00000"></div>
        <div><label>Accreditation No.</label><input id="bir_accreditation_no" placeholder="PR0000000000"></div>
        <div><label>MIN <span class="muted">(Machine Identification No.)</span></label><input id="bir_min"></div>
        <div><label>Serial No.</label><input id="bir_serial_no"></div>
        <div><label>Permit No. <span class="muted">(if any)</span></label><input id="bir_permit_no"></div>
      </div>
      <button onclick="saveBir()">Save receipt details</button>
      <span id="birMsg" class="muted" style="margin-left:8px"></span>
    </div>

    ${tpl ? `
    <h2>SMS templates</h2>
    <div class="card">
      <div class="muted">Placeholders: ${tpl.placeholders.map(p => `<code>{${p}}</code>`).join(' ')}</div>
      <div class="muted">Only the ticked messages are sent. Untick one and it stops being raised
        at all, so turning it back on later will not release a backlog of old texts.</div>
      ${Object.entries(tpl.templates).map(([key, t]) => `
        <label style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="tplOn_${key}" ${t.enabled === false ? '' : 'checked'}
                 style="width:auto;margin:0">
          <span>${esc(key)} → ${esc(t.recipients.join(' + '))}</span>
        </label>
        <div class="row" style="flex-wrap:nowrap">
          <textarea id="tpl_${key}" style="min-height:52px">${esc(t.body)}</textarea>
          <button class="small" onclick="saveTemplate('${key}')">Save</button>
        </div>`).join('')}
    </div>` : ''}
    <h2>Users</h2>
    <details class="collapse card"><summary>+ New user</summary>
      <div class="form-grid" style="margin-top:8px">
        <div><label>Name</label><input id="usName"></div>
        <div><label>Email</label><input id="usEmail"></div>
        <div><label>Role</label><select id="usRole"><option>ADMIN</option><option>SHIPPER_AGENT</option><option>CONSIGNEE_AGENT</option><option>WAREHOUSE</option></select></div>
        <div><label>Password</label><input id="usPass" type="text"></div>
      </div>
      <button onclick="createUser()">Create user</button>
    </details>
    <div class="card table-scroll">
      <div class="muted" style="margin-bottom:8px;font-size:12.5px">
        An account can be open in one place at a time. If somebody has gone home leaving theirs
        signed in, free it here — otherwise it releases itself after about 15 minutes idle.
      </div>
      <table><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Signed in</th><th></th></tr>
      ${users.map(u => `<tr>
        <td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td>
        <td>${u.active ? '✓' : '✗'}</td>
        <td>${u.signed_in
          ? `<span class="badge st-received_origin">Open</span>${u.signed_in_where
              ? `<div class="muted" style="font-size:11px">${esc(u.signed_in_where)}</div>` : ''}`
          : '<span class="muted">—</span>'}</td>
        <td class="inline-actions">
          ${u.id !== ME.id ? `<button class="small secondary" onclick="toggleUser(${u.id}, ${!u.active})">${u.active ? 'Deactivate' : 'Activate'}</button>` : '<span class="muted">you</span>'}
          ${u.signed_in && u.id !== ME.id ? `<button class="small secondary" onclick="freeSession(${u.id}, '${esc(u.name)}')">Sign out</button>` : ''}
        </td>
      </tr>`).join('')}
      </table>
    </div>`);

  // Fill in the saved BIR particulars.
  BIR_FIELDS.forEach(k => { const el = document.getElementById('bir_' + k); if (el) el.value = bir[k] || ''; });
  if (window.wireNameCase) wireNameCase('usName');
}
// Free an account somebody left open. Whoever is holding it is signed out where they are, so
// it is worth a moment's confirmation rather than a button that acts on the first click.
async function freeSession(id, name) {
  const ok = await confirmAction({
    title: 'Sign this account out?',
    body: `<p><b>${esc(name)}</b> will be signed out wherever it is currently open, and can sign
             in again immediately.</p>
           <p class="muted">Anything they had typed but not saved on that screen is lost, so this
             is for accounts left open by mistake rather than one somebody is working in.</p>`,
    confirmLabel: 'Sign them out', cancelLabel: 'Leave it'
  });
  if (!ok) return;
  try {
    const r = await api('/api/users/' + id + '/sign-out', { method: 'POST' });
    flash(r.message || 'Signed out');
    route();
  } catch (e) { showErr(e); }
}

async function saveTemplate(key) {
  try {
    const on = document.getElementById('tplOn_' + key).checked;
    await api('/api/templates/' + key, {
      method: 'PUT',
      body: { body: document.getElementById('tpl_' + key).value, enabled: on }
    });
    flash(on ? 'Template saved — this message will be sent' : 'Template saved — this message is off');
  } catch (e) { showErr(e); }
}
async function createUser() {
  try {
    await api('/api/users', { method: 'POST', body: { name: usName.value, email: usEmail.value, role: usRole.value, password: usPass.value } });
    flash('User created');
    route();
  } catch (e) { showErr(e); }
}
async function toggleUser(id, active) {
  try { await api('/api/users/' + id, { method: 'PUT', body: { active } }); route(); } catch (e) { showErr(e); }
}

/* ---------- generic scan ---------- */
// Scan a run of boxes and apply the same action to each. `act` gets the looked-up box and
// returns a short line describing what happened; anything it throws is shown against that
// box and the run carries on, because one bad label should not stop a pallet.
function scanRunner(hint, act) {
  const log = [];
  setScanHandler(async code => {
    const out = document.getElementById('scanResult');
    let line;
    try {
      const box = await lookupBox(code);
      line = { ok: true, text: await act(box) };
    } catch (e) {
      line = { ok: false, text: (code || '').slice(0, 40) + ' — ' + e.message };
    }
    log.unshift(line);
    if (out) {
      out.innerHTML = `<div class="scan-log">${log.slice(0, 12).map(l =>
        `<div class="${l.ok ? 'ok' : 'bad'}">${l.ok ? '✓' : '✗'} ${esc(l.text)}</div>`).join('')}</div>`;
    }
    const inp = document.getElementById('manualCode');
    if (inp) { inp.value = ''; inp.focus(); }
  });
  return hint;
}

// Which action a scan performs at the origin warehouse.
let OW_SCAN_MODE = 'receive';
function setOwScanMode(mode) {
  OW_SCAN_MODE = mode === 'load' ? 'load' : 'receive';
  document.querySelectorAll('#owScanMode .seg').forEach(b => b.classList.toggle('on', b.dataset.mode === OW_SCAN_MODE));
  if (OW_SCAN_MODE === 'receive') {
    scanRunner('', async (box) => {
      // Scanning a box that is already booked in is not an error worth alarming anyone with —
      // it happens constantly when a pallet is re-checked. Say so and move on.
      if (box.status === 'RECEIVED_ORIGIN') return box.box_number + ' was already received';
      await api('/api/boxes/' + box.id + '/status', { method: 'POST', body: { status: 'RECEIVED_ORIGIN', note: 'Received at origin warehouse (scanned)' } });
      return box.box_number + ' received at origin WH';
    });
  } else {
    scanRunner('', async (box) => {
      const pick = document.getElementById('owContainer');
      if (!pick || !pick.value) throw new Error('pick a container first');
      await api('/api/containers/' + pick.value + '/load', { method: 'POST', body: { box_id: box.id } });
      const opt = pick.options[pick.selectedIndex];
      return box.box_number + ' → ' + (opt ? opt.text.split(' · ')[0] : 'container');
    });
  }
}

async function pageScan() {
  view(`<h1>Find a box</h1>${scannerHtml('Scan any box QR label or type its number to open it')}`);
  setScanHandler(async code => {
    const box = await lookupBox(code);
    location.hash = '#/boxes/' + box.id;
  });
}

boot();

/* Switch the load plan between the single-size ideal and a mixed load. */
function toggleLoadMix(mix) {
  const single = document.getElementById('lpSingle');
  const mixed = document.getElementById('lpMixed');
  const title = document.getElementById('lpTitle');
  if (!single || !mixed) return;
  const showMixed = !!+mix;
  mixed.style.display = showMixed ? '' : 'none';
  single.style.display = showMixed ? 'none' : '';
  document.querySelectorAll('#lpToggle .seg').forEach(b => b.classList.toggle('on', b.dataset.mix === String(+showMixed)));
  if (title) {
    if (!title.dataset.single) title.dataset.single = title.textContent;
    title.textContent = showMixed
      ? title.dataset.single.replace('a single size', 'a mixed size')
      : title.dataset.single;
  }
}
// Once an agent types their own fee, stop overwriting it from the rate card.
document.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'shFee') e.target.dataset.touched = '1';
});
