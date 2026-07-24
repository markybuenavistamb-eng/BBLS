/* VFIC Box Operations â€” staff single-page app (demo) */
let ME = null;
let scanner = null;

const STATUS_LABELS_EN = {
  CREATED: 'Created', RECEIVED_ORIGIN: 'Received (origin)', LOADED_CONTAINER: 'Loaded in container',
  IN_TRANSIT: 'In transit', ARRIVED_PORT: 'Arrived (PH port)', RECEIVED_WAREHOUSE: 'Received (warehouse)',
  SORTED: 'Sorted', ASSIGNED: 'Assigned to trip', LOADED_TRUCK: 'Loaded on truck',
  OUT_FOR_DELIVERY: 'Out for delivery', DELIVERED: 'Delivered', RETURNED: 'Returned', CANCELLED: 'Cancelled'
};
// Language-aware view over the labels: every existing STATUS_LABELS[x] lookup auto-translates.
const STATUS_LABELS = new Proxy(STATUS_LABELS_EN, {
  get: (tgt, k) => (typeof k === 'string' && tgt[k] != null) ? VI.t('status.' + k, tgt[k]) : tgt[k]
});
const PIPELINE = ['CREATED', 'RECEIVED_ORIGIN', 'LOADED_CONTAINER', 'IN_TRANSIT', 'ARRIVED_PORT',
  'RECEIVED_WAREHOUSE', 'SORTED', 'ASSIGNED', 'LOADED_TRUCK', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED', 'CANCELLED'];
const NEXT_STATUS = {
  CREATED: ['RECEIVED_ORIGIN'], RECEIVED_ORIGIN: ['LOADED_CONTAINER'], LOADED_CONTAINER: ['IN_TRANSIT', 'RECEIVED_ORIGIN'],
  IN_TRANSIT: ['ARRIVED_PORT'], ARRIVED_PORT: ['RECEIVED_WAREHOUSE'], RECEIVED_WAREHOUSE: ['SORTED'],
  SORTED: ['ASSIGNED'], ASSIGNED: ['LOADED_TRUCK', 'SORTED'], LOADED_TRUCK: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'RETURNED'], RETURNED: ['ASSIGNED'], DELIVERED: [], CANCELLED: []
};
const REGIONS = ['NCR', 'NORTH_LUZON', 'SOUTH_LUZON', 'CALABARZON', 'MIMAROPA', 'VISAYAS', 'MINDANAO'];
const REGION_LABELS = { NCR: 'NCR / Metro Manila', NORTH_LUZON: 'North Luzon', SOUTH_LUZON: 'South Luzon', CALABARZON: 'CALABARZON', MIMAROPA: 'MIMAROPA', VISAYAS: 'Visayas', MINDANAO: 'Mindanao' };
const SIZES = ['SMALL', 'MEDIUM', 'LARGE', 'JUMBO', 'CUSTOM'];
const SERVICE_TYPES_EN = { DOOR_TO_DOOR: 'Door to Door', PORT_TO_PORT: 'Port to Port', DOOR_TO_PORT: 'Door to Port', DOOR_TO_AIRPORT: 'Door to Airport' };
const SERVICE_TYPES = new Proxy(SERVICE_TYPES_EN, {
  get: (tgt, k) => (typeof k === 'string' && tgt[k] != null) ? VI.t('service.' + k, tgt[k]) : tgt[k]
});
const FAILURE_REASONS = { UNREACHABLE: 'Receiver unreachable by phone', ADDRESS_NOT_FOUND: 'Address not found', RECEIVER_ABSENT: 'Receiver absent', REFUSED: 'Delivery refused', OTHER: 'Other' };

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDate(iso) {
  if (!iso) return 'â€”';
  return new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
}
function fmtDay(iso) {
  if (!iso) return 'â€”';
  return new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' });
}
function ageDays(iso) { return iso ? Math.floor((Date.now() - new Date(iso)) / 86400000) : 0; }
function badge(status) {
  const cls = 'st-' + String(status).toLowerCase();
  return `<span class="badge ${cls}">${esc(STATUS_LABELS[status] || String(status).replace(/_/g, ' '))}</span>`;
}
function payBadge(p) { return `<span class="badge pay-${esc(String(p).toLowerCase())}">${esc(p)}</span>`; }
function regionBadge(r) { return r ? `<span class="badge st-sorted">${esc(REGION_LABELS[r] || r)}</span>` : '<span class="muted">â€”</span>'; }

async function api(path, opts = {}) {
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON */ }
  if (!res.ok) throw Object.assign(new Error((data && data.error) || `Request failed (${res.status})`), { status: res.status, data });
  return data;
}

function view(html) { stopScanner(); document.getElementById('view2').innerHTML = html; }
function flash(msg, cls = 'success') {
  const el = document.createElement('div');
  el.className = cls;
  el.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px 18px;box-shadow:0 4px 14px rgba(0,0,0,.15);z-index:99;font-weight:600;max-width:90vw';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
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
  try { ME = await api('/api/me'); } catch (e) { ME = null; }
  VI.onChange(() => { if (ME) { renderShell(); route(); } });
  if (!ME) return renderLogin();
  renderShell();
  route();
}

function renderLogin() {
  document.getElementById('preauth').style.display = '';
  document.getElementById('shell').style.display = 'none';
  document.getElementById('view').innerHTML = `
    <div class="login-wrap">
      <div class="login-brandside" style="--hero-img:url('${IMG.hero}')">
        <div class="lb-top">
          <span class="vf-logo-plate">
            <img class="vf-logo-img" src="/vfic-logo.png" alt="VÃ®ctors Freight International Corporation â€” Chosen to Deliver" style="width:280px">
          </span>
        </div>
        <div>
          <h2>${VI.t('login.subtitle')}</h2>
          <p>${VI.t('brand.company')} â€” ${VI.t('brand.tagline')}</p>
          <ul class="lb-points">
            <li>${VI.t('land.svc.sea.t')} Â· ${VI.t('land.svc.air.t')} Â· ${VI.t('service.DOOR_TO_DOOR')}</li>
            <li>${VI.t('land.hero.ctaTrack')} â€” ${VI.t('land.stat.tracking')}</li>
            <li>${VI.t('land.contact.head')}: Intramuros, Manila</li>
          </ul>
        </div>
        <div style="font-size:12px;color:#8aa0bf">Â© ${new Date().getFullYear()} ${VI.t('brand.company')}</div>
      </div>
      <div class="login-formside">
        <div class="login-box card">
          <div style="display:flex;justify-content:center;margin-bottom:10px">
            <img class="vf-logo-img" src="/vfic-logo.png" alt="VÃ®ctors Freight International Corporation â€” Chosen to Deliver" style="width:290px">
          </div>
          <div style="text-align:center;margin-bottom:12px">${VI.toggleHtml('renderLogin()')}</div>
          <h1 style="font-size:20px;text-align:center;margin:0 0 14px">${VI.t('login.title')}</h1>
          <label>${VI.t('common.email')}</label><input id="lgEmail" type="email" autocomplete="username">
          <label>${VI.t('common.password')}</label><input id="lgPass" type="password" autocomplete="current-password">
          <div style="margin-top:14px"><button style="width:100%" onclick="doLogin()">${VI.t('common.login')}</button></div>
          <div class="error" id="lgErr"></div>
          <div class="demo-creds">
            <b>${VI.t('login.demo')}</b> (${VI.t('login.password_is')} <code>demo1234</code>):<br>
            admin@vfic.demo Â· shipper@vfic.demo<br>consignee@vfic.demo Â· warehouse@vfic.demo
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:12px;font-size:13px">
            <a href="/">${VI.t('login.home')}</a>
            <a href="/track.html">${VI.t('login.track')} â†’</a>
          </div>
        </div>
      </div>
    </div>`;
  const langBtns = document.querySelectorAll('#view .lang-toggle');
  langBtns.forEach(g => g.classList.add('on-light'));
  document.getElementById('lgPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}
async function doLogin() {
  try {
    ME = await api('/api/login', { method: 'POST', body: { email: lgEmail.value.trim(), password: lgPass.value } });
    renderShell();
    location.hash = '#/dashboard';
    route();
  } catch (e) { document.getElementById('lgErr').textContent = e.message; }
}
async function logout() {
  await api('/api/logout', { method: 'POST' });
  ME = null;
  location.hash = '';
  renderLogin();
}
function toggleNav(open) {
  document.getElementById('shell').classList.toggle('nav-open', open);
}

const NAV = [
  { section: 'nav.section.ops' },
  ['#/dashboard', 'nav.dashboard', 'grid', ['ADMIN', 'SHIPPER_AGENT', 'CONSIGNEE_AGENT', 'WAREHOUSE']],
  ['#/shipments', 'nav.shipments', 'package', ['ADMIN', 'SHIPPER_AGENT', 'CONSIGNEE_AGENT']],
  ['#/boxes', 'nav.boxes', 'box', ['ADMIN', 'SHIPPER_AGENT', 'CONSIGNEE_AGENT', 'WAREHOUSE']],
  ['#/containers', 'nav.containers', 'container', ['ADMIN', 'SHIPPER_AGENT', 'CONSIGNEE_AGENT']],
  ['#/warehouse', 'nav.warehouse', 'warehouse', ['ADMIN', 'CONSIGNEE_AGENT', 'WAREHOUSE']],
  ['#/trips', 'nav.trips', 'truck', ['ADMIN', 'CONSIGNEE_AGENT']],
  ['#/returns', 'nav.returns', 'undo', ['ADMIN', 'CONSIGNEE_AGENT']],
  { section: 'nav.section.people' },
  ['#/customers', 'nav.customers', 'users', ['ADMIN', 'SHIPPER_AGENT', 'CONSIGNEE_AGENT']],
  ['#/notifications', 'nav.sms', 'chat', ['ADMIN', 'SHIPPER_AGENT', 'CONSIGNEE_AGENT']],
  ['#/reports', 'nav.reports', 'chart', ['ADMIN', 'SHIPPER_AGENT', 'CONSIGNEE_AGENT']],
  { section: 'nav.section.system' },
  ['#/scan', 'nav.scan', 'scan', ['ADMIN', 'SHIPPER_AGENT', 'CONSIGNEE_AGENT', 'WAREHOUSE']],
  ['#/admin', 'nav.admin', 'gear', ['ADMIN']]
];
function renderShell() {
  document.getElementById('preauth').style.display = 'none';
  document.getElementById('shell').style.display = '';
  document.getElementById('brandOps').textContent = VI.t('shell.ops');
  document.getElementById('logoutBtn').textContent = VI.t('common.logout');
  let html = '';
  for (const item of NAV) {
    if (item.section) { html += `<div class="nav-section">${VI.t(item.section)}</div>`; continue; }
    const [href, key, ic, roles] = item;
    if (!roles.includes(ME.role)) continue;
    html += `<a href="${href}" data-nav="${href}" onclick="toggleNav(false)">${icon(ic)}<span>${VI.t(key)}</span></a>`;
  }
  document.getElementById('nav').innerHTML = html;
  document.getElementById('who').textContent = ME.name;
  document.getElementById('whoRole').textContent = ME.role.replace(/_/g, ' ');
  document.getElementById('langMount').innerHTML = VI.toggleHtml('renderShell();route()');
  markNav(location.hash || '#/dashboard');
}
function markNav(hash) {
  document.querySelectorAll('#nav a').forEach(a => {
    a.classList.toggle('active', hash.startsWith(a.dataset.nav));
  });
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
    if (p[0] === 'shipments' && p[1]) return pageShipmentDetail(+p[1]);
    if (p[0] === 'shipments') return pageShipments();
    if (p[0] === 'labels' && p[1] === 's') return pageLabels('shipment', +p[2]);
    if (p[0] === 'labels' && p[1] === 'b') return pageLabels('box', +p[2]);
    if (p[0] === 'receiving-form') return pageReceivingForm(+p[1]);
    if (p[0] === 'packing-list') return pagePackingList(+p[1]);
    if (p[0] === 'truck-receipt' && p[1] === 't') return pageTruckReceipt('trip', +p[2]);
    if (p[0] === 'truck-receipt' && p[1] === 'b') return pageTruckReceipt('box', +p[2]);
    if (p[0] === 'delivery-receipt') return pageDeliveryReceipt(+p[1]);
    if (p[0] === 'boxes' && p[1]) return pageBoxDetail(+p[1]);
    if (p[0] === 'boxes') return pageBoxes();
    if (p[0] === 'containers' && p[1]) return pageContainerDetail(+p[1]);
    if (p[0] === 'containers') return pageContainers();
    if (p[0] === 'warehouse') return pageWarehouse();
    if (p[0] === 'trips' && p[1]) return pageTripDetail(+p[1]);
    if (p[0] === 'trips') return pageTrips();
    if (p[0] === 'manifest') return pageManifest(+p[1]);
    if (p[0] === 'returns') return pageReturns();
    if (p[0] === 'customers' && p[1]) return pageCustomerDetail(+p[1]);
    if (p[0] === 'customers') return pageCustomers();
    if (p[0] === 'notifications') return pageNotifications();
    if (p[0] === 'reports') return pageReports();
    if (p[0] === 'admin') return pageAdmin();
    if (p[0] === 'scan') return pageScan();
    pageDashboard();
  } catch (e) { view(`<div class="card error">${esc(e.message)}</div>`); }
}
window.addEventListener('hashchange', route);

const isAdmin = () => ME && ME.role === 'ADMIN';
const isAgent = () => ME && ['ADMIN', 'SHIPPER_AGENT', 'CONSIGNEE_AGENT'].includes(ME.role);
const canDispatch = () => ME && ['ADMIN', 'CONSIGNEE_AGENT'].includes(ME.role);
const canIntake = () => ME && ['ADMIN', 'SHIPPER_AGENT'].includes(ME.role);

/* ---------- QR scanning ---------- */
function scannerHtml(hint) {
  return `
    <div class="scan-panel card">
      <div id="qr-reader"></div>
      <div class="row" style="justify-content:center;margin-top:10px">
        <button class="secondary small" onclick="startCam()">ðŸ“· Start camera</button>
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
  try { await scanHandler(code); } catch (e) { scanFeedback(`<div class="scan-last warn"><div class="big">âœ— ${esc(e.message)}</div></div>`); }
}
function scanFeedback(html) {
  const el = document.getElementById('scanResult');
  if (el) el.innerHTML = html;
}
async function lookupBox(code) { return api('/api/boxes/lookup/' + encodeURIComponent(code)); }

/* ---------- dashboard ---------- */
async function pageDashboard() {
  const d = await api('/api/dashboard');
  const tiles = PIPELINE.filter(s => s !== 'CANCELLED').map(s =>
    `<a class="tile" href="#/boxes?status=${s}"><div class="num">${d.byStatus[s] || 0}</div><div class="lbl">${esc(STATUS_LABELS[s])}</div></a>`).join('');
  view(`
    <h1>${VI.t('dash.title')}</h1>
    <div class="tiles">
      <a class="tile" href="#/boxes"><div class="num">${d.totalBoxes}</div><div class="lbl">${VI.t('dash.totalBoxes')}</div></a>
      <a class="tile" href="#/returns" style="outline:2px solid var(--red)"><div class="num" style="color:var(--red)">${d.returnsCount}</div><div class="lbl">${VI.t('dash.returns')}</div></a>
      <a class="tile" href="#/reports"><div class="num">${d.unpaidShipments}</div><div class="lbl">${VI.t('dash.unpaid')}</div></a>
    </div>
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
        ${canIntake() ? `<a href="#/intake-requests"><button class="secondary" ${pending.length ? 'style="outline:2px solid var(--primary)"' : ''}>ðŸ“¥ Online intake requests${pending.length ? ` (${pending.length})` : ''}</button></a>` : ''}
        ${canIntake() ? '<a href="#/receiving-form-blank"><button class="secondary">ðŸ–¨ Blank receiving form</button></a>' : ''}
        ${canIntake() ? '<a href="#/shipments/new"><button>+ New shipment intake</button></a>' : ''}
      </div>
    </div>
    <div class="card row">
      <input id="shipQ" placeholder="Search shipment #, sender name, phoneâ€¦" style="max-width:340px" value="${esc(q.get('q') || '')}">
      <button class="small" onclick="location.hash='#/shipments?q='+encodeURIComponent(shipQ.value)">Search</button>
    </div>
    <div class="card table-scroll">
      <table><tr><th>Shipment #</th><th>Sender</th><th>Boxes</th><th>Service</th><th>Origin</th><th>Fee</th><th>Payment</th><th>Created</th></tr>
      ${list.map(s => `<tr>
        <td><a href="#/shipments/${s.id}">${esc(s.shipment_number)}</a></td>
        <td>${esc(s.sender_name)}</td><td>${s.box_count}</td>
        <td>${esc(SERVICE_TYPES[s.service_type] || s.service_type)}</td>
        <td>${esc(s.origin_agent || s.origin_country)}</td>
        <td>${s.shipping_fee_amount != null ? esc(s.currency) + ' ' + s.shipping_fee_amount : 'â€”'}</td>
        <td>${payBadge(s.payment_status)}</td><td>${fmtDay(s.created_at)}</td>
      </tr>`).join('') || '<tr><td colspan="8" class="muted">No shipments</td></tr>'}
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
      <table><tr><th>Reference</th><th>Sender</th><th>Phone</th><th>Boxes</th><th>Submitted</th><th>Status</th><th>Actions</th></tr>
      ${list.map(r => `<tr>
        <td>${esc(r.reference_code)}</td><td>${esc(r.sender_name)}</td><td>${esc(r.sender_phone)}</td>
        <td>${r.box_count}</td><td>${fmtDate(r.submitted_at)}</td>
        <td><span class="badge ${r.status === 'PENDING' ? 'st-created' : r.status === 'CONVERTED' ? 'st-delivered' : 'st-cancelled'}">${esc(r.status)}</span></td>
        <td class="inline-actions">
          ${r.status === 'PENDING' && canIntake() ? `<a href="#/shipments/new?intake=${r.id}"><button class="small">Review & encode</button></a>
            <button class="small secondary" onclick="dismissIntake(${r.id})">Dismiss</button>` : ''}
        </td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">No online submissions yet</td></tr>'}
      </table>
    </div>`);
}
async function dismissIntake(id) {
  if (!confirm('Dismiss this submission? Use this for spam or accidental duplicates.')) return;
  try { await api('/api/intake-requests/' + id, { method: 'PUT', body: { status: 'DISMISSED' } }); route(); } catch (e) { showErr(e); }
}

let CUSTOMERS = [];
async function loadCustomers() { CUSTOMERS = await api('/api/customers'); }
function customerOptions(type, selected) {
  const eligible = CUSTOMERS.filter(c => c.type === type || c.type === 'BOTH');
  return `<option value="">â€” select â€”</option>` + eligible.map(c =>
    `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.full_name)} Â· ${esc(c.phone_primary)}${c.city_municipality ? ' Â· ' + esc(c.city_municipality) : ''}</option>`).join('');
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
        <div><label>Receiver *</label><select id="bxReceiver${n}">${customerOptions('RECEIVER')}</select></div>
        <div><label>Size</label><select id="bxSize${n}">${SIZES.map(s => `<option ${s === 'LARGE' ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div><label>Weight (kg)</label><input id="bxWeight${n}" type="number" min="0" step="0.1"></div>
        <div><label>LÃ—WÃ—H (cm)</label><div class="row" style="flex-wrap:nowrap;gap:4px">
          <input id="bxL${n}" type="number" placeholder="L"><input id="bxW${n}" type="number" placeholder="W"><input id="bxH${n}" type="number" placeholder="H"></div></div>
      </div>
      <label>Declared contents (summary)</label><textarea id="bxContents${n}" placeholder="Clothes, canned goods, chocolatesâ€¦"></textarea>
      <label>Special instructions</label><input id="bxInstr${n}" placeholder="Fragile / call before delivery / â€¦">
      <label>Packing list â€” itemized contents (printed on the Packing List document)</label>
      <div id="items${n}">${itemRowHtml()}</div>
      <button type="button" class="secondary small" onclick="document.getElementById('items${n}').insertAdjacentHTML('beforeend', itemRowHtml())">+ Add item</button>
    </div>`;
}
function itemRowHtml() {
  return `
    <div class="row itemRow" style="flex-wrap:nowrap;gap:6px">
      <input placeholder="Item description (e.g. canned goods)" class="itemDesc">
      <input placeholder="Qty" class="itemQty" style="max-width:90px">
      <button type="button" class="secondary small" onclick="this.parentElement.remove()">âœ•</button>
    </div>`;
}
function collectItems(itemsContainerId) {
  return [...document.querySelectorAll(`#${itemsContainerId} .itemRow`)]
    .map(row => ({ description: row.querySelector('.itemDesc').value.trim(), qty: row.querySelector('.itemQty').value.trim() }))
    .filter(it => it.description);
}

/* ---------- Blank Receiving Form (paper form for the sender to fill out before encoding) ---------- */
// Compact variants below are scoped to THIS form only via inline styles (blankLine/pairRow/
// blankBoxBlockHtml aren't used elsewhere) so the shared .rc-line/.rc-box/.rc-table/.label-card
// classes used by other printable documents are left untouched.
function blankLine(label) {
  return `<div class="rc-line" style="padding:0"><span style="font-size:10px">${esc(label)}</span><div style="flex:1;border-bottom:1px solid #000;min-height:12px;line-height:12px">&nbsp;</div></div>`;
}
function pairRow(labelA, labelB) {
  return `<div class="row" style="flex-wrap:nowrap;gap:10px;margin:0">
    <div style="flex:1">${blankLine(labelA)}</div>
    <div style="flex:1">${blankLine(labelB)}</div>
  </div>`;
}
function blankBoxBlockHtml(n) {
  return `
    <div class="label-card" style="text-align:left;padding:8px">
      <div class="rc-label" style="margin-bottom:3px">BOX ${n} <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">(box # assigned by VFIC upon encoding)</span></div>
      ${pairRow('Receiver name', 'Receiver phone')}
      ${pairRow('Alt. phone', 'Landmark')}
      ${blankLine('Address (house/brgy)')}
      ${pairRow('City/Municipality', 'Province')}
      ${pairRow('Size (S/M/L/Jumbo)', 'Weight (kg)')}
      ${blankLine('Special instructions')}
      <div class="rc-label" style="margin:5px 0 2px">ITEMIZED CONTENTS</div>
      <table class="rc-table" style="font-size:10px">
        <tr><th style="width:20px;padding:2px 6px">#</th><th style="padding:2px 6px">Item description</th><th style="width:60px;padding:2px 6px">Qty</th></tr>
        ${Array.from({ length: 10 }, (_, i) => `<tr><td style="padding:2px 6px">${i + 1}</td><td style="padding:2px 6px">&nbsp;</td><td style="padding:2px 6px">&nbsp;</td></tr>`).join('')}
      </table>
    </div>`;
}
function pageReceivingFormBlank(extraBoxCount) {
  const extra = Math.max(0, Math.min(19, extraBoxCount || 0));
  view(`
    <style>@page { size: 8.5in 13in; margin: 0.4in; }</style>
    <div class="row no-print" style="justify-content:space-between">
      <h1>Blank Receiving Form</h1>
      <div class="row" style="flex-wrap:nowrap">
        <label style="margin:0">Additional boxes (rider sheet)</label>
        <input id="extraBoxCount" type="number" min="0" max="19" value="${extra}" style="max-width:70px">
        <button class="secondary small" onclick="pageReceivingFormBlank(+document.getElementById('extraBoxCount').value)">Update</button>
        <button onclick="window.print()">ðŸ–¨ Print</button>
      </div>
    </div>
    <div class="muted no-print" style="margin-bottom:10px">
      One Receiving Form per box. Hand this to a sender to fill out by hand, or have them scan the QR code to fill it up online instead.
      If they have more than one box, print a rider sheet for the additional boxes. Sized to fit legal paper (8.5Ã—13in). Once completed, encode it in <a href="#/shipments/new">New Shipment Intake</a>.
    </div>
    <div class="receipt">
      <div class="rc-head">
        <div>
          <img src="/vfic-logo.png" alt="VÃ®ctors Freight International Corporation â€” Chosen to Deliver" style="width:300px;display:block;margin-bottom:4px">
          <div class="rc-title">BALIKBAYAN BOX RECEIVING FORM â€” SENDER COPY</div>
          <div class="rc-meta">Please print clearly. One box per form â€” use a rider sheet for additional boxes.<br>Or scan the QR code to fill this up online.</div>
        </div>
        <div class="rc-qr">
          <img src="/api/intake-form-qr" alt="Scan to fill up online" style="width:85px;height:85px">
          <div class="muted" style="font-size:10px">Scan to fill up online</div>
        </div>
      </div>
      <div style="border:1px solid #000;padding:4px 12px;margin:6px 0 8px;max-width:320px">
        <div class="muted" style="font-size:10px;font-weight:800;letter-spacing:1px">FOR VFIC USE</div>
        ${blankLine('Shipment #')}
        ${blankLine("Date rec'd")}
      </div>
      <div class="rc-box" style="padding:6px 10px">
        <div class="rc-label" style="margin-bottom:3px">SENDER / SHIPPER INFORMATION</div>
        ${pairRow('Full name', 'Phone (primary)')}
        ${pairRow('Alt phone', 'Country')}
        ${blankLine('Address')}
        ${pairRow('City/Municipality', 'Province')}
      </div>

      <div class="rc-title" style="margin:8px 0 4px">BOX DETAILS</div>
      ${blankBoxBlockHtml(1)}

      <div class="rc-box" style="margin-top:8px;padding:6px 10px;border-color:var(--red)">
        <div class="rc-label" style="color:var(--red);margin-bottom:3px">REQUIRED â€” SENDER'S PASSPORT / GOVERNMENT ID</div>
        <div class="rc-line" style="padding:0"><span style="font-size:10px">ID on file</span><div style="font-size:11px">â˜ Photocopy attached to this form &nbsp; â˜ Soft copy submitted online (QR code above)</div></div>
        <div class="muted" style="font-size:10px;margin-top:2px">VFIC requires a scanned or photographed copy of the sender's passport or government ID on file before a shipment can be processed.</div>
      </div>

      <div class="rc-terms" style="margin:8px 0 6px;font-size:10px">
        I certify that the information and contents described above are true and correct, and I authorize Victors Freight International Corporation (VFIC)
        to transport, consolidate, and deliver the box described under VFIC's standard terms and conditions of carriage.
      </div>
      <div class="rc-sign" style="margin-bottom:0">
        <div><div class="rc-sigline"></div>Sender signature over printed name & date</div>
        <div><div class="rc-sigline"></div>Received by (VFIC agent) over printed name & date</div>
      </div>
    </div>
    ${Array.from({ length: extra }, (_, i) => `
    <div class="receipt" style="page-break-before:always">
      <div class="rc-title">ADDITIONAL BOX RIDER SHEET <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">(box ${i + 2} of ${extra + 1})</span></div>
      <div class="rc-meta">One box per sheet â€” attach to the signed Receiving Form for:</div>
      <div style="max-width:420px">${blankLine('Sender full name')}</div>
      <div style="margin-top:10px">${blankBoxBlockHtml(i + 2)}</div>
    </div>`).join('')}`);
}

let PREFILL_INTAKE = null; // set when opened via a Pending Intake Request (#/shipments/new?intake=ID)

async function createOrMatchCustomer(fields) {
  try {
    return await api('/api/customers', { method: 'POST', body: fields });
  } catch (e) {
    if (e.status === 409) return e.data.existing; // phone already on file â€” reuse it, don't duplicate
    throw e;
  }
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
      <a href="#/receiving-form-blank"><button class="secondary">ðŸ–¨ Blank receiving form</button></a>
    </div>
    <div class="muted" style="margin:-8px 0 12px">Encoding from a filled-out paper form? Have the sender complete a <a href="#/receiving-form-blank">blank receiving form</a> first, then transcribe it below. Or check <a href="#/intake-requests">pending online submissions</a>.</div>
    ${intake ? `<div class="card" style="border-color:var(--primary)">
      <b>Reviewing online submission ${esc(intake.reference_code)}</b> from ${esc(personName(intake.sender))}, submitted ${fmtDate(intake.submitted_at)}.
      Fields below are pre-filled from what the sender entered â€” verify weights/sizes and the passport copy, then save.
      ${intake.passport_file ? `<div><a href="${esc(intake.passport_file)}" target="_blank">View submitted passport/ID scan â†’</a></div>` : ''}
    </div>` : ''}
    <div class="card">
      <h2 style="margin-top:0">Sender</h2>
      <div class="form-grid">
        <div><label>Sender *</label><select id="shSender">${customerOptions('SENDER')}</select></div>
        <div><label>Origin country</label><input id="shOrigin" value="${intake ? esc(intake.origin_country) : 'USA'}"></div>
        <div><label>Origin branch / agent</label><input id="shAgent" value="${intake ? esc(intake.origin_agent) : ''}"></div>
        <div><label>Service type</label><select id="shService">${Object.entries(SERVICE_TYPES).map(([k, v]) => `<option value="${k}" ${intake && intake.service_type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      </div>
      <details class="collapse"><summary>+ Create new customer (sender or receiver)</summary>${newCustomerFormHtml('nc')}</details>
      <h2>Fees & documents</h2>
      <div class="form-grid">
        <div><label>Shipping fee</label><input id="shFee" type="number" min="0" step="0.01" value="${intake && intake.shipping_fee_amount != null ? intake.shipping_fee_amount : ''}"></div>
        <div><label>Currency</label><select id="shCurrency"><option ${intake && intake.currency === 'USD' ? 'selected' : ''}>USD</option><option ${intake && intake.currency === 'CAD' ? 'selected' : ''}>CAD</option><option ${intake && intake.currency === 'AED' ? 'selected' : ''}>AED</option><option ${intake && intake.currency === 'EUR' ? 'selected' : ''}>EUR</option><option ${intake && intake.currency === 'GBP' ? 'selected' : ''}>GBP</option><option ${intake && intake.currency === 'PHP' ? 'selected' : ''}>PHP</option></select></div>
        <div><label>Payment status</label><select id="shPaid"><option value="UNPAID">UNPAID</option><option value="PAID">PAID</option></select></div>
      </div>
      <div class="form-grid">
        <div><label>Receiving form</label><input id="fReceiving" type="file"></div>
        <div><label>Packing list</label><input id="fPacking" type="file"></div>
        <div><label>Passport / ID copy ${intake && intake.passport_file ? '' : '*'}</label><input id="fPassport" type="file">
          ${intake && intake.passport_file ? '<div class="muted">Already on file from the online submission â€” only attach a new one to replace it.</div>' : ''}</div>
      </div>
    </div>
    <h2>Boxes</h2>
    <div id="boxRows">${(intake ? intake.boxes : [null]).map(() => boxRowHtml()).join('')}</div>
    <button class="secondary" onclick="document.getElementById('boxRows').insertAdjacentHTML('beforeend', boxRowHtml())">+ Add another box</button>
    <div class="card">
      <button onclick="createShipment()">Save shipment & generate box numbers + QR</button>
      <div class="muted">Boxes start at CREATED. Confirm physical receipt on the shipment page to notify the sender.</div>
    </div>`);

  if (!intake) return;
  PREFILL_INTAKE = intake;

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
      region: mapPsgcRegion(r.region), country: 'Philippines', landmark: r.landmark || ''
    });
    await loadCustomers();
    document.getElementById('bxReceiver' + n).innerHTML = customerOptions('RECEIVER', receiverCustomer.id);
    document.getElementById('bxSize' + n).value = bx.size_category;
    if (bx.weight_kg) document.getElementById('bxWeight' + n).value = bx.weight_kg;
    // BOC goods checklist â†’ the encoder's itemized packing list rows
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

// Display name from BOC name parts (Given Middle Family, Suffix).
function personName(p) {
  if (!p) return '';
  const suffix = p.suffix && !/^n\/?a$/i.test(p.suffix) ? p.suffix : '';
  return [p.given_name, p.middle_name, p.family_name].filter(Boolean).join(' ').trim() + (suffix ? ' ' + suffix : '');
}
// PSGC region names â†’ the app's internal delivery-region enum (used for sorting/dispatch).
function mapPsgcRegion(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return null;
  if (n.includes('national capital') || /\bncr\b/.test(n)) return 'NCR';
  if (n.includes('calabarzon') || n.includes('iv-a')) return 'CALABARZON';
  if (n.includes('mimaropa')) return 'MIMAROPA';
  if (n.includes('ilocos') || n.includes('cagayan') || n.includes('cordillera') || n.includes('central luzon')) return 'NORTH_LUZON';
  if (n.includes('bicol')) return 'SOUTH_LUZON';
  if (n.includes('visayas')) return 'VISAYAS';
  if (n.includes('mindanao') || n.includes('davao') || n.includes('zamboanga') || n.includes('soccsksargen') || n.includes('caraga') || n.includes('bangsamoro')) return 'MINDANAO';
  return null;
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
      <div><label>Region</label><select id="${prefix}Region"><option value="">â€”</option>${REGIONS.map(r => `<option value="${r}">${REGION_LABELS[r]}</option>`).join('')}</select></div>
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
    if (e.status === 409 && confirm(`A customer with this phone already exists: ${e.data.existing.full_name}. Create anyway?`)) {
      return createCustomerInline(prefix, true);
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
        boc: src ? { receiver: src.receiver, goods: src.goods } : null,
        total_value_php: src ? src.total_value_php : null
      };
    });
    if (!boxes.length) throw new Error('Add at least one box');
    if (boxes.some(b => !b.receiver_id)) throw new Error('Every box needs a receiver');
    if (!+shSender.value) throw new Error('Select a sender');
    const [receiving_form_file, packing_list_file, uploadedPassport] = await Promise.all([
      uploadIfAny('fReceiving'), uploadIfAny('fPacking'), uploadIfAny('fPassport')
    ]);
    const passport_file = uploadedPassport || (PREFILL_INTAKE ? PREFILL_INTAKE.passport_file : null);
    if (!passport_file) throw new Error("A scanned/soft copy of the sender's passport or government ID is required");
    const s = await api('/api/shipments', {
      method: 'POST',
      body: {
        sender_id: +shSender.value, origin_country: shOrigin.value, origin_agent: shAgent.value,
        service_type: shService.value, shipping_fee_amount: shFee.value || null, currency: shCurrency.value,
        payment_status: shPaid.value, receiving_form_file, packing_list_file, passport_file, boxes,
        boc: PREFILL_INTAKE ? {
          availment_type: PREFILL_INTAKE.availment_type,
          sender_type: PREFILL_INTAKE.sender_type,
          sender: PREFILL_INTAKE.sender,
          pickup: PREFILL_INTAKE.pickup,
          total_value_php: PREFILL_INTAKE.total_value_php,
          reference_code: PREFILL_INTAKE.reference_code
        } : null
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
        <a href="#/labels/s/${s.id}"><button class="secondary">ðŸ–¨ Print labels</button></a>
        <a href="#/receiving-form/${s.id}"><button class="secondary">ðŸ–¨ Receiving form</button></a>
        <a href="#/packing-list/${s.id}"><button class="secondary">ðŸ–¨ Packing list</button></a>
        ${canIntake() && createdBoxes ? `<button onclick="confirmOriginReceipt(${s.id})">âœ“ Confirm origin receipt (${createdBoxes})</button>` : ''}
      </div>
    </div>
    <div class="card form-grid">
      <div><label>Sender</label><a href="#/customers/${s.sender_id}">${esc(s.sender ? s.sender.full_name : '')}</a><div class="muted">${esc(s.sender ? s.sender.phone_primary : '')}</div></div>
      <div><label>Service</label>${esc(SERVICE_TYPES[s.service_type] || s.service_type)}</div>
      <div><label>Origin</label>${esc([s.origin_agent, s.origin_country].filter(Boolean).join(', '))}</div>
      <div><label>Fee</label>${s.shipping_fee_amount != null ? esc(s.currency) + ' ' + s.shipping_fee_amount : 'â€”'} ${payBadge(s.payment_status)}
        ${canIntake() ? `<button class="small secondary" onclick="togglePayment(${s.id}, '${s.payment_status === 'PAID' ? 'UNPAID' : 'PAID'}')">Mark ${s.payment_status === 'PAID' ? 'unpaid' : 'paid'}</button>` : ''}</div>
      <div><label>Documents</label>
        ${s.receiving_form_file ? `<a href="${esc(s.receiving_form_file)}" target="_blank">Receiving form</a> Â· ` : ''}
        ${s.packing_list_file ? `<a href="${esc(s.packing_list_file)}" target="_blank">Packing list</a> Â· ` : ''}
        ${s.passport_file ? `<a href="${esc(s.passport_file)}" target="_blank">Passport/ID</a>` : ''}
        ${!s.receiving_form_file && !s.packing_list_file && !s.passport_file ? '<span class="muted">None uploaded</span>' : ''}
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
        <td><a href="#/labels/b/${b.id}">ðŸ–¨</a></td>
      </tr>`).join('')}
      </table>
    </div>`);
}
async function confirmOriginReceipt(id) {
  try {
    const r = await api(`/api/shipments/${id}/receive`, { method: 'POST' });
    flash(`${r.received} box(es) marked Received at origin â€” sender notified by SMS`);
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
      <h1>Labels â€” ${esc(title)}</h1>
      <button onclick="window.print()">ðŸ–¨ Print</button>
    </div>
    <div class="labels-grid">
      ${boxes.map(b => `
        <div class="label-card">
          <div style="font-weight:800;letter-spacing:.5px">VFIC Â· VICTORS FREIGHT INTL CORP</div>
          <div class="tid">${esc(b.box_number)}</div>
          <img src="/api/qr/${esc(b.qr_token)}" alt="QR">
          <div class="muted">Scan to track</div>
          <div class="dest">FROM: ${esc(b.sender_name)}</div>
          <div class="dest">TO: ${esc(b.receiver_name)} â€” ${esc(b.receiver_city)}</div>
          <div>${esc(b.size_category)}${b.weight_kg ? ' Â· ' + b.weight_kg + ' kg' : ''}</div>
          ${b.special_instructions ? `<div class="flag">âš  ${esc(b.special_instructions)}</div>` : ''}
          <div class="region-big">${esc(REGION_LABELS[b.region || b.receiver_region] || 'REGION TBD')}</div>
        </div>`).join('')}
    </div>`);
}

/* Printed BOC forms (Information Sheet p.1 / Packing List p.2) live in boc-forms.js */

/* ---------- Delivery Receipt (blank, travels with the truck for the receiver to sign) ---------- */
function truckReceiptBlockHtml(box, trip, isLast) {
  const r = box.receiver || {};
  return `
    <div class="receipt" style="${isLast ? '' : 'page-break-after:always'}">
      <div class="rc-head">
        <div>
          <div class="rc-company">VICTORS FREIGHT INTERNATIONAL CORPORATION</div>
          <div class="rc-title">DELIVERY RECEIPT</div>
          <div class="rc-meta">
            To be signed by the receiver upon delivery<br>
            Trip: <b>${esc(trip ? trip.trip_number : 'â€”')}</b> Â· Date: ${fmtDay(trip ? trip.scheduled_date : null)}<br>
            Driver: <b>${esc(trip ? trip.driver_name : 'â€”')}</b>${trip && trip.driver_contact ? ' (' + esc(trip.driver_contact) + ')' : ''}${trip && trip.plate_number ? ' Â· Plate ' + esc(trip.plate_number) : ''}
          </div>
        </div>
        <div class="rc-qr">
          <img src="/api/qr/${esc(box.qr_token)}" alt="QR">
          <div class="rc-tid">${esc(box.box_number)}</div>
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
      <div class="rc-details">
        <div class="rc-cell"><span>Box #</span>${esc(box.box_number)}</div>
        <div class="rc-cell"><span>Size</span>${esc(box.size_category || 'â€”')}</div>
        <div class="rc-cell"><span>Weight</span>${box.weight_kg ? box.weight_kg + ' kg' : 'â€”'}</div>
        <div class="rc-cell"><span>Instructions</span>${esc(box.special_instructions || 'â€”')}</div>
      </div>
      <div class="rc-terms">
        I acknowledge receipt of the balikbayan box listed above, delivered by Victors Freight International Corporation (VFIC),
        in good order and condition unless otherwise noted below.
      </div>
      <div class="rc-sign">
        <div><div class="rc-sigline"></div>Receiver signature over printed name & date/time</div>
        <div><div class="rc-sigline"></div>Driver signature over printed name</div>
      </div>
      <div class="rc-terms" style="margin-top:8px">
        <b>If undeliverable</b>, indicate reason: â˜ Unreachable â˜ Address not found â˜ Receiver absent â˜ Refused â˜ Other: ______________________
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
    boxes = [b];
    trip = b.trip;
    title = b.box_number;
  }
  view(`
    <div class="row no-print" style="justify-content:space-between">
      <h1>Delivery Receipt${kind === 'trip' ? 's' : ''} â€” ${esc(title)}</h1>
      <button onclick="window.print()">ðŸ–¨ Print</button>
    </div>
    <div class="muted no-print" style="margin-bottom:10px">Print and send with the driver â€” one copy per box, for the receiver to sign on delivery.</div>
    ${boxes.length ? boxes.map((b, i) => truckReceiptBlockHtml(b, kind === 'trip' ? trip : b.trip, i === boxes.length - 1)).join('')
      : '<div class="card muted">No boxes to print.</div>'}`);
}

/* ---------- Proof of Delivery (internal record: printed after outcome recorded, embeds POD photos) ---------- */
async function pageDeliveryReceipt(boxId) {
  const b = await api('/api/boxes/' + boxId);
  const attempt = [...b.attempts].reverse().find(a => a.outcome === 'DELIVERED');
  if (!attempt) {
    view(`<h1>Proof of Delivery</h1><div class="card error">Box ${esc(b.box_number)} has no recorded delivery yet. Record the delivery outcome first.</div>
      <a href="#/boxes/${b.id}"><button class="secondary">â† Back to box</button></a>`);
    return;
  }
  const r = b.receiver || {};
  view(`
    <div class="row no-print" style="justify-content:space-between">
      <h1>Proof of Delivery â€” ${esc(b.box_number)}</h1>
      <div><button onclick="window.print()">ðŸ–¨ Print</button> <a href="#/boxes/${b.id}"><button class="secondary">â† Back to box</button></a></div>
    </div>
    <div class="muted no-print" style="margin-bottom:10px">Internal record for VFIC's files â€” generated after the outcome is recorded. For the document the driver carries and the receiver signs at the door, see <a href="#/truck-receipt/b/${b.id}">Delivery Receipt</a>.</div>
    <div class="receipt">
      <div class="rc-company">VICTORS FREIGHT INTERNATIONAL CORPORATION</div>
      <div class="rc-title">PROOF OF DELIVERY â€” INTERNAL RECORD</div>
      <div class="rc-meta">
        Box #: <b>${esc(b.box_number)}</b> Â· Delivered: <b>${fmtDate(attempt.attempted_at)}</b>
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
      ${b.trip ? `<div class="rc-line"><span>Driver / trip</span>${esc(b.trip.driver_name)} (${esc(b.trip.driver_contact)}) Â· ${esc(b.trip.trip_number)}${b.trip.plate_number ? ' Â· Plate ' + esc(b.trip.plate_number) : ''}</div>` : ''}
      ${attempt.notes ? `<div class="rc-line"><span>Notes</span>${esc(attempt.notes)}</div>` : ''}
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
    <h1>Boxes</h1>
    <div class="card row">
      <input id="bq" placeholder="Search box #, sender, receiver, phoneâ€¦" style="max-width:280px" value="${esc(q.get('q') || '')}">
      <select id="bstatus" style="max-width:210px"><option value="">All statuses</option>
        ${PIPELINE.map(s => `<option value="${s}" ${q.get('status') === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}</select>
      <select id="bregion" style="max-width:190px"><option value="">All regions</option>
        ${REGIONS.map(r => `<option value="${r}" ${q.get('region') === r ? 'selected' : ''}>${REGION_LABELS[r]}</option>`).join('')}</select>
      <button class="small" onclick="boxFilter()">Filter</button>
    </div>
    <div class="card table-scroll">
      <table><tr><th>Box #</th><th>Sender</th><th>Receiver</th><th>City</th><th>Region</th><th>Status</th><th>Updated</th></tr>
      ${list.map(b => `<tr>
        <td><a href="#/boxes/${b.id}">${esc(b.box_number)}</a></td>
        <td>${esc(b.sender_name)}</td><td>${esc(b.receiver_name)}</td><td>${esc(b.receiver_city)}</td>
        <td>${regionBadge(b.region || b.receiver_region)}</td><td>${badge(b.status)}</td><td>${fmtDay(b.status_updated_at)}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">No boxes match</td></tr>'}
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
        <a href="#/labels/b/${b.id}"><button class="secondary">ðŸ–¨ Label</button></a>
        ${['ASSIGNED', 'LOADED_TRUCK', 'OUT_FOR_DELIVERY'].includes(b.status) ? `<a href="#/truck-receipt/b/${b.id}"><button class="secondary">ðŸ–¨ Delivery receipt (for driver)</button></a>` : ''}
        ${b.status === 'DELIVERED' ? `<a href="#/delivery-receipt/${b.id}"><button class="secondary">ðŸ–¨ Proof of delivery</button></a>` : ''}
      </div>
    </div>
    <div class="card form-grid">
      <div><label>Shipment</label><a href="#/shipments/${b.shipment_id}">${esc(b.shipment ? b.shipment.shipment_number : '')}</a> ${b.shipment ? payBadge(b.shipment.payment_status) : ''}</div>
      <div><label>Sender</label>${b.sender ? `<a href="#/customers/${b.sender.id}">${esc(b.sender.full_name)}</a><div class="muted">${esc(b.sender.phone_primary)}</div>` : 'â€”'}</div>
      <div><label>Receiver</label>${r.id ? `<a href="#/customers/${r.id}">${esc(r.full_name)}</a><div class="muted">${esc(r.phone_primary)}${r.phone_alternate ? ' / ' + esc(r.phone_alternate) : ''}</div>` : 'â€”'}</div>
      <div><label>Address</label><div class="muted">${esc([r.address_line, r.barangay, r.city_municipality, r.province].filter(Boolean).join(', '))}</div>
        ${r.landmark ? `<div class="muted">ðŸ“ ${esc(r.landmark)}</div>` : ''}</div>
      <div><label>Region</label>${regionBadge(b.region || r.region)}</div>
      <div><label>Size / weight</label>${esc(b.size_category)}${b.weight_kg ? ' Â· ' + b.weight_kg + ' kg' : ''}
        ${b.length_cm ? `<div class="muted">${b.length_cm}Ã—${b.width_cm}Ã—${b.height_cm} cm</div>` : ''}</div>
      <div><label>Contents</label><div class="muted">${esc(b.declared_contents || 'â€”')}</div>
        ${(b.packing_list_items || []).length ? `<ul style="margin:4px 0 0 18px;padding:0;font-size:13px;color:var(--muted)">${b.packing_list_items.map(it => `<li>${esc(it.description)}${it.qty ? ' â€” ' + esc(it.qty) : ''}</li>`).join('')}</ul>` : ''}</div>
      <div><label>Special instructions</label><div class="muted">${esc(b.special_instructions || 'â€”')}</div></div>
      <div><label>Container</label>${b.container ? `<a href="#/containers/${b.container.id}">${esc(b.container.container_number)}</a>` : 'â€”'}</div>
      <div><label>Trip</label>${b.trip ? `<a href="#/trips/${b.trip.id}">${esc(b.trip.trip_number)}</a> (${esc(b.trip.driver_name)})` : 'â€”'}</div>
      <div><label>Public tracking</label><a href="/track.html?t=${esc(b.qr_token)}" target="_blank">Open tracking page â†’</a></div>
    </div>

    <div class="card">
      <h2 style="margin-top:0">Actions</h2>
      <div class="inline-actions">
        ${nexts.map(s => s === 'SORTED'
          ? `<select id="sortRegion" style="max-width:190px">${REGIONS.map(rg => `<option value="${rg}" ${rg === receiverRegion ? 'selected' : ''}>${REGION_LABELS[rg]}</option>`).join('')}</select>
             <button onclick="doStatus(${b.id}, 'SORTED', '', document.getElementById('sortRegion').value)">â†’ Sorted</button>`
          : `<button onclick="doStatus(${b.id}, '${s}')">â†’ ${STATUS_LABELS[s]}</button>`).join('')}
        ${isAdmin() && !['DELIVERED', 'CANCELLED'].includes(b.status) ? `<button class="danger" onclick="cancelBox(${b.id})">âœ— Cancel box</button>` : ''}
        ${!nexts.length && b.status !== 'OUT_FOR_DELIVERY' ? '<span class="muted">No manual actions available at this status.</span>' : ''}
      </div>
      ${b.status === 'OUT_FOR_DELIVERY' ? podFormHtml(b.id) : ''}
    </div>

    <h2>Status timeline</h2>
    <div class="card">
      <ul class="timeline">
        ${b.events.slice().reverse().map((e, i) => `
          <li class="${i === 0 ? 'current' : ''}">
            <div class="t-status">${esc(STATUS_LABELS[e.to_status] || e.to_status)}</div>
            <div class="t-meta">${fmtDate(e.created_at)} Â· ${esc(e.actor)}</div>
            ${e.note ? `<div class="t-note">${esc(e.note)}</div>` : ''}
          </li>`).join('')}
      </ul>
    </div>

    ${b.attempts.length ? `<h2>Delivery attempts</h2>
    <div class="card">
      ${b.attempts.map(a => `
        <div style="border-bottom:1px solid var(--border);padding:8px 0">
          <b>Attempt ${a.attempt_number}</b> â€” ${a.outcome === 'DELIVERED' ? badge('DELIVERED') : badge('RETURNED') + ' ' + esc(FAILURE_REASONS[a.failure_reason] || '')}
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
}
async function doStatus(id, status, note = '', region = null) {
  try {
    await api(`/api/boxes/${id}/status`, { method: 'POST', body: { status, note, region } });
    flash(`Status â†’ ${STATUS_LABELS[status]}`);
    route();
  } catch (e) { showErr(e); }
}
async function cancelBox(id) {
  const reason = prompt('Cancellation reason (required):');
  if (!reason) return;
  await doStatus(id, 'CANCELLED', reason);
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
      flash('Marked failed â€” box returned to warehouse pool.');
      route();
    }
  } catch (e) { showErr(e); }
}

/* ---------- containers ---------- */
async function pageContainers() {
  const list = await api('/api/containers');
  view(`
    <h1>Containers</h1>
    ${canIntake() ? `
    <details class="collapse card"><summary>+ Book new container</summary>
      <div class="form-grid" style="margin-top:8px">
        <div><label>Container number *</label><input id="cnNumber" placeholder="MSCU1234567"></div>
        <div><label>Size</label><select id="cnSize"><option value="C40">40 ft (â‰ˆ250â€“280 boxes)</option><option value="C20">20 ft (â‰ˆ150â€“180 boxes)</option></select></div>
        <div><label>Shipping line</label><input id="cnLine"></div>
        <div><label>Vessel</label><input id="cnVessel"></div>
        <div><label>Booking #</label><input id="cnBooking"></div>
        <div><label>Origin port</label><input id="cnOrigin"></div>
        <div><label>Destination port</label><input id="cnDest" value="Manila (MICP)"></div>
        <div><label>ETD</label><input id="cnEtd" type="date"></div>
        <div><label>ETA</label><input id="cnEta" type="date"></div>
      </div>
      <button onclick="createContainer()">Book container</button>
    </details>` : ''}
    <div class="card table-scroll">
      <table><tr><th>Container</th><th>Size</th><th>Line / vessel</th><th>Route</th><th>Boxes</th><th>ETA</th><th>Status</th></tr>
      ${list.map(c => `<tr>
        <td><a href="#/containers/${c.id}">${esc(c.container_number)}</a></td>
        <td>${c.size === 'C20' ? "20'" : "40'"}</td>
        <td>${esc([c.shipping_line, c.vessel_name].filter(Boolean).join(' / '))}</td>
        <td>${esc([c.origin_port, c.destination_port].filter(Boolean).join(' â†’ '))}</td>
        <td>${c.box_count} / ${c.size === 'C20' ? '150â€“180' : '250â€“280'}</td>
        <td>${fmtDay(c.eta)}</td><td>${badge(c.status)}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">None</td></tr>'}
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
  const strippable = ['ARRIVED', 'AT_CUSTOMS', 'RELEASED'].includes(c.status) && ['ADMIN', 'CONSIGNEE_AGENT', 'WAREHOUSE'].includes(ME.role);
  view(`
    <div class="row" style="justify-content:space-between">
      <h1>${esc(c.container_number)} ${badge(c.status)}</h1>
      <div>
        ${canIntake() && ['LOADING', 'BOOKING'].includes(c.status) ? `<button onclick="containerAction(${c.id}, 'depart', 'Container departed â€” loaded boxes now In Transit')">ðŸš¢ Mark departed</button>` : ''}
        ${c.status === 'IN_TRANSIT' && isAgent() ? `<button onclick="containerAction(${c.id}, 'arrive', 'Container arrived â€” receivers notified by SMS')">âš“ Mark arrived</button>` : ''}
        ${['ARRIVED', 'AT_CUSTOMS'].includes(c.status) && isAgent() ? `
          <button class="secondary" onclick="setContainerStatus(${c.id}, '${c.status === 'ARRIVED' ? 'AT_CUSTOMS' : 'RELEASED'}')">â†’ ${c.status === 'ARRIVED' ? 'At customs' : 'Released'}</button>` : ''}
      </div>
    </div>
    <div class="card form-grid">
      <div><label>Size</label>${c.size === 'C20' ? "20 ft" : "40 ft"} â€” typical ${c.typical_capacity} boxes</div>
      <div><label>Line / vessel</label>${esc([c.shipping_line, c.vessel_name].filter(Boolean).join(' / '))}</div>
      <div><label>Booking</label>${esc(c.booking_number || 'â€”')}</div>
      <div><label>Route</label>${esc([c.origin_port, c.destination_port].filter(Boolean).join(' â†’ '))}</div>
      <div><label>ETD / ETA</label>${fmtDay(c.etd)} â†’ ${fmtDay(c.eta)}</div>
      <div><label>Departed / arrived</label>${fmtDay(c.actual_departure)} â†’ ${fmtDay(c.actual_arrival)}</div>
      <div><label>Boxes loaded</label><b>${c.boxes.length}</b> / typical ${c.typical_capacity}</div>
    </div>

    ${loadable ? `
    <h2>Load boxes (scan or pick)</h2>
    ${scannerHtml('Scan a box QR to load it into this container')}
    <div class="card" id="loadPick">Loadingâ€¦</div>` : ''}

    ${strippable ? `
    <h2>Warehouse stripping (scan each box)</h2>
    ${scannerHtml('Scan each box as it comes off the container â€” marks it Received at warehouse')}
    <div class="card">
      <b>Discrepancy â€” on manifest, not yet scanned (${c.pending_strip.length}):</b>
      <div class="muted wrap-cell">${c.pending_strip.map(esc).join(', ') || 'None â€” all boxes scanned âœ“'}</div>
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
    <h2>Arrival notice â€” document bundle</h2>
    <div class="card table-scroll">
      <table><tr><th>Shipment</th><th>Sender</th><th>Packing list</th><th>Passport/ID</th><th>Receiving form</th></tr>
      ${c.documents.map(doc => `<tr>
        <td>${esc(doc.shipment_number)}</td><td>${esc(doc.sender_name)}</td>
        <td>${doc.packing_list_file ? `<a href="${esc(doc.packing_list_file)}" target="_blank">Download</a>` : '<span class="muted">â€”</span>'}</td>
        <td>${doc.passport_file ? `<a href="${esc(doc.passport_file)}" target="_blank">Download</a>` : '<span class="muted">â€”</span>'}</td>
        <td>${doc.receiving_form_file ? `<a href="${esc(doc.receiving_form_file)}" target="_blank">Download</a>` : '<span class="muted">â€”</span>'}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">No documents</td></tr>'}
      </table>
    </div>`);

  if (loadable) {
    setScanHandler(async code => {
      const box = await lookupBox(code);
      const r = await api(`/api/containers/${c.id}/load`, { method: 'POST', body: { box_id: box.id } });
      scanFeedback(`<div class="scan-last"><div class="big">âœ“ ${esc(r.box.box_number)} loaded</div><div class="scan-count">${r.box_count}</div><div class="muted">boxes in container</div></div>`);
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
        <div class="big">${r.off_manifest ? 'âš  NOT ON MANIFEST â€” ' : 'âœ“ '}${esc(r.box.box_number)} received</div>
        <div class="scan-count">${r.remaining}</div><div class="muted">still to strip</div></div>`);
    });
  }
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

/* ---------- warehouse scan hub ---------- */
async function pageWarehouse() {
  const containers = await api('/api/containers');
  const toStrip = containers.filter(c => ['ARRIVED', 'AT_CUSTOMS', 'RELEASED'].includes(c.status));
  view(`
    <h1>Warehouse</h1>
    <div class="card">
      <h2 style="margin-top:0">1 Â· Strip a container</h2>
      ${toStrip.length
        ? toStrip.map(c => `<a href="#/containers/${c.id}"><button class="secondary">${esc(c.container_number)} Â· ${esc(c.status)} Â· ${c.box_count} boxes</button></a>`).join(' ')
        : '<span class="muted">No containers awaiting stripping. Mark a container arrived first.</span>'}
    </div>
    <div class="card">
      <h2 style="margin-top:0">2 Â· Segregate by region</h2>
      <div class="muted">Scan any received box â€” its destination region is prefilled from the receiver's address. Or pick a region lane first for bulk sorting.</div>
      <label>Region lane (optional â€” forces every scan into this lane)</label>
      <select id="laneRegion" style="max-width:260px"><option value="">Auto (use receiver's region)</option>
        ${REGIONS.map(r => `<option value="${r}">${REGION_LABELS[r]}</option>`).join('')}</select>
    </div>
    ${scannerHtml('Scan a box to mark it Sorted into its region lane')}
    <div class="card" id="sortPick">Loadingâ€¦</div>`);
  setScanHandler(async code => {
    const box = await lookupBox(code);
    const lane = document.getElementById('laneRegion').value;
    const region = lane || (box.receiver ? box.receiver.region : null);
    const r = await api(`/api/boxes/${box.id}/status`, { method: 'POST', body: { status: 'SORTED', region } });
    scanFeedback(`<div class="scan-last"><div class="big">âœ“ ${esc(r.box_number)}</div>
      <div class="scan-count">${esc(REGION_LABELS[r.region] || r.region)}</div><div class="muted">sorted into lane</div></div>`);
  });
  const pending = await api('/api/boxes?status=RECEIVED_WAREHOUSE');
  document.getElementById('sortPick').innerHTML = `
    <b>Received at warehouse, awaiting sorting (${pending.length}):</b>
    <div class="table-scroll"><table><tr><th>Box #</th><th>Receiver</th><th>City</th><th>Suggested region</th><th></th></tr>
    ${pending.map(b => `<tr><td><a href="#/boxes/${b.id}">${esc(b.box_number)}</a></td><td>${esc(b.receiver_name)}</td><td>${esc(b.receiver_city)}</td>
      <td>${regionBadge(b.receiver_region)}</td>
      <td><button class="small" onclick="doStatus(${b.id}, 'SORTED', '', '${esc(b.receiver_region || '')}')">Sort</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nothing waiting</td></tr>'}
    </table></div>`;
}

/* ---------- trips ---------- */
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
        <div><label>Region *</label><select id="tpRegion">${REGIONS.map(r => `<option value="${r}">${REGION_LABELS[r]}</option>`).join('')}</select></div>
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
        <a href="#/manifest/${t.id}"><button class="secondary">ðŸ–¨ Trip manifest</button></a>
        ${t.boxes.length ? `<a href="#/truck-receipt/t/${t.id}"><button class="secondary">ðŸ–¨ Delivery receipts (${t.boxes.length})</button></a>` : ''}
        ${canDispatch() && loaded.length ? `<button onclick="dispatchTrip(${t.id})">ðŸšš Dispatch trip (${loaded.length} loaded)</button>` : ''}
      </div>
    </div>
    <div class="card form-grid">
      <div><label>Region</label>${regionBadge(t.region)}</div>
      <div><label>Driver</label>${esc(t.driver_name)} Â· ${esc(t.driver_contact)}</div>
      <div><label>Plate / company</label>${esc([t.plate_number, t.trucking_company].filter(Boolean).join(' Â· '))}</div>
      <div><label>Scheduled</label>${fmtDay(t.scheduled_date)}</div>
    </div>

    ${canAssign ? `<h2>Assign boxes (${REGION_LABELS[t.region]})</h2><div class="card" id="assignList">Loadingâ€¦</div>` : ''}

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
      <span class="muted">RETURNED boxes shown first â€” assigning them is the one-click re-dispatch.</span>`
      : '<span class="muted">No sorted or returned boxes for this region.</span>';
    if (assigned.length) {
      setScanHandler(async code => {
        const box = await lookupBox(code);
        const r = await api(`/api/trips/${t.id}/load-scan`, { method: 'POST', body: { box_id: box.id } });
        scanFeedback(`<div class="scan-last"><div class="big">âœ“ ${esc(r.box.box_number)} on truck</div>
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
    flash(`${r.box.box_number} loaded â€” ${r.remaining} remaining`);
    route();
  } catch (e) { showErr(e); }
}
async function tripRemoveBox(tripId, boxId) {
  try { await api(`/api/trips/${tripId}/remove-box`, { method: 'POST', body: { box_id: boxId } }); route(); } catch (e) { showErr(e); }
}
async function dispatchTrip(id) {
  try {
    const r = await api(`/api/trips/${id}/dispatch`, { method: 'POST' });
    flash(`Trip dispatched â€” ${r.dispatched} boxes out for delivery, receivers notified by SMS`);
    route();
  } catch (e) { showErr(e); }
}

async function pageManifest(id) {
  const t = await api('/api/trips/' + id);
  view(`
    <div class="row no-print" style="justify-content:space-between">
      <h1>Trip manifest</h1><button onclick="window.print()">ðŸ–¨ Print</button>
    </div>
    <div class="manifest">
      <div class="rc-company">VICTORS FREIGHT INTERNATIONAL CORPORATION</div>
      <div class="rc-title">DELIVERY TRIP MANIFEST â€” ${esc(t.trip_number)}</div>
      <div class="rc-meta">
        Region: <b>${esc(REGION_LABELS[t.region] || t.region)}</b> Â· Date: <b>${fmtDay(t.scheduled_date)}</b><br>
        Driver: <b>${esc(t.driver_name)}</b> (${esc(t.driver_contact)}) Â· Plate: <b>${esc(t.plate_number)}</b> Â· ${esc(t.trucking_company)}
      </div>
      <table class="rc-table" style="margin-top:12px">
        <tr><th>#</th><th>Box</th><th>Receiver</th><th>Phone</th><th>Address & landmark</th><th>Instructions</th><th>Received by / sign</th></tr>
        ${t.boxes.map((b, i) => `<tr>
          <td>${i + 1}</td><td><b>${esc(b.box_number)}</b></td>
          <td>${esc(b.receiver.full_name || '')}</td>
          <td>${esc(b.receiver.phone_primary || '')}${b.receiver.phone_alternate ? '<br>' + esc(b.receiver.phone_alternate) : ''}</td>
          <td>${esc([b.receiver.address_line, b.receiver.barangay, b.receiver.city_municipality, b.receiver.province].filter(Boolean).join(', '))}
            ${b.receiver.landmark ? `<br>ðŸ“ <i>${esc(b.receiver.landmark)}</i>` : ''}</td>
          <td>${esc(b.special_instructions || '')}</td><td style="min-width:110px"></td>
        </tr>`).join('')}
      </table>
    </div>`);
}

/* ---------- returns queue ---------- */
async function pageReturns() {
  const list = await api('/api/returns');
  view(`
    <h1>Returns Queue <span class="muted">(oldest first â€” these need action)</span></h1>
    <div class="card table-scroll">
      <table><tr><th>Age</th><th>Box #</th><th>Receiver</th><th>Phones</th><th>Region</th><th>Last failure</th><th>Attempts</th><th>Re-dispatch</th></tr>
      ${list.map(b => `<tr>
        <td><b>${ageDays(b.status_updated_at)}d</b></td>
        <td><a href="#/boxes/${b.id}">${esc(b.box_number)}</a></td>
        <td>${esc(b.receiver_name)}</td><td>${esc(b.receiver_phone)}</td>
        <td>${regionBadge(b.region || b.receiver_region)}</td>
        <td>${esc(FAILURE_REASONS[b.last_failure_reason] || 'â€”')}</td>
        <td>${b.attempts_count}</td>
        <td class="inline-actions">
          ${b.candidate_trips.length
            ? b.candidate_trips.map(t => `<button class="small" onclick="requeueBox(${b.id}, ${t.id}, '${esc(t.trip_number)}')">â†’ ${esc(t.trip_number)} (${fmtDay(t.scheduled_date)})</button>`).join('')
            : `<a href="#/trips"><button class="small secondary">Create ${esc(REGION_LABELS[b.region || b.receiver_region] || '')} trip</button></a>`}
        </td>
      </tr>`).join('') || '<tr><td colspan="8" class="muted">ðŸŽ‰ No returned boxes</td></tr>'}
      </table>
    </div>
    <div class="muted">One click adds the box to a planned trip for its region â€” the fast re-dispatch flow.</div>`);
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
  view(`
    <h1>Customers</h1>
    <div class="card row">
      <input id="custQ" placeholder="Search name, phone, cityâ€¦" style="max-width:300px" value="${esc(q.get('q') || '')}">
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
        <div><label>Region</label><select id="edRegion"><option value="">â€”</option>${REGIONS.map(r => `<option value="${r}" ${c.region === r ? 'selected' : ''}>${REGION_LABELS[r]}</option>`).join('')}</select></div>
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
  try { await api('/api/notifications/retry/' + id, { method: 'POST' }); flash('Re-queued â€” worker will retry shortly'); route(); } catch (e) { showErr(e); }
}

/* ---------- reports ---------- */
async function pageReports() {
  const reports = [
    ['boxes-per-container', 'Boxes per container'],
    ['delivery-performance', 'Delivery performance (warehouse â†’ delivered days)'],
    ['failed-reasons', 'Failed delivery reasons'],
    ['unpaid-shipments', 'Unpaid shipments']
  ];
  const data = await Promise.all(reports.map(([k]) => api('/api/reports/' + k)));
  view(`
    <h1>Reports</h1>
    ${reports.map(([key, label], i) => {
      const rows = data[i];
      const cols = rows.length ? Object.keys(rows[0]) : [];
      return `<h2>${esc(label)} <a href="/api/reports/${key}?format=csv" download><button class="small secondary">â¬‡ CSV</button></a></h2>
      <div class="card table-scroll">
        <table><tr>${cols.map(cl => `<th>${esc(cl.replace(/_/g, ' '))}</th>`).join('')}</tr>
        ${rows.map(rw => `<tr>${cols.map(cl => `<td>${esc(String(rw[cl] == null ? '' : rw[cl]).match(/^\d{4}-\d{2}-\d{2}T/) ? fmtDay(rw[cl]) : rw[cl])}</td>`).join('')}</tr>`).join('') || `<tr><td class="muted">No data</td></tr>`}
        </table>
      </div>`;
    }).join('')}`);
}

/* ---------- admin ---------- */
async function pageAdmin() {
  const [users, tpl] = await Promise.all([api('/api/users'), api('/api/templates')]);
  view(`
    <h1>Admin</h1>
    <h2>SMS templates</h2>
    <div class="card">
      <div class="muted">Placeholders: ${tpl.placeholders.map(p => `<code>{${p}}</code>`).join(' ')}</div>
      ${Object.entries(tpl.templates).map(([key, t]) => `
        <label>${esc(key)} â†’ ${esc(t.recipients.join(' + '))}</label>
        <div class="row" style="flex-wrap:nowrap">
          <textarea id="tpl_${key}" style="min-height:52px">${esc(t.body)}</textarea>
          <button class="small" onclick="saveTemplate('${key}')">Save</button>
        </div>`).join('')}
    </div>
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
      <table><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th></th></tr>
      ${users.map(u => `<tr>
        <td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td>
        <td>${u.active ? 'âœ“' : 'âœ—'}</td>
        <td>${u.id !== ME.id ? `<button class="small secondary" onclick="toggleUser(${u.id}, ${!u.active})">${u.active ? 'Deactivate' : 'Activate'}</button>` : '<span class="muted">you</span>'}</td>
      </tr>`).join('')}
      </table>
    </div>`);
}
async function saveTemplate(key) {
  try {
    await api('/api/templates/' + key, { method: 'PUT', body: { body: document.getElementById('tpl_' + key).value } });
    flash('Template saved');
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
async function pageScan() {
  view(`<h1>Find a box</h1>${scannerHtml('Scan any box QR label or type its number to open it')}`);
  setScanHandler(async code => {
    const box = await lookupBox(code);
    location.hash = '#/boxes/' + box.id;
  });
}

boot();
