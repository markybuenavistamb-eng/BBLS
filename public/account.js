/* VFIC sender account — sign up / sign in, track your boxes, saved drafts, past shipments. */

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const gid = (id) => document.getElementById(id);
const val = (id) => { const e = gid(id); return e ? e.value.trim() : ''; };
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtDay(iso) { return iso ? new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' }) : ''; }

let ME = null;

// Where new senders found us — feeds the marketing side of the customer record.
const HEARD_OPTIONS = [
  'Facebook', 'Instagram', 'TikTok', 'YouTube',
  'Google search', 'Friend or family referral', 'Walk-in / branch office',
  'Flyer or poster', 'Radio or TV', 'Other'
];
function onHeardChange() {
  const sel = gid('acHeard'), wrap = gid('acHeardOtherWrap');
  if (sel && wrap) wrap.style.display = sel.value === 'Other' ? '' : 'none';
}

// Country → international dialling code. Choosing a country pre-fills the phone field with
// its code, so a sender never has to remember it. VFIC's lanes are listed first.
const COUNTRY_CODES = [
  { name: 'Thailand', code: '+66' },
  { name: 'Cambodia', code: '+855' },
  { name: 'Vietnam', code: '+84' },
  { name: 'Philippines', code: '+63' },
  { name: 'Singapore', code: '+65' },
  { name: 'Malaysia', code: '+60' },
  { name: 'Indonesia', code: '+62' },
  { name: 'Hong Kong', code: '+852' },
  { name: 'China', code: '+86' },
  { name: 'Taiwan', code: '+886' },
  { name: 'South Korea', code: '+82' },
  { name: 'Japan', code: '+81' },
  { name: 'United Arab Emirates', code: '+971' },
  { name: 'Saudi Arabia', code: '+966' },
  { name: 'Qatar', code: '+974' },
  { name: 'Kuwait', code: '+965' },
  { name: 'Bahrain', code: '+973' },
  { name: 'Oman', code: '+968' },
  { name: 'United States', code: '+1' },
  { name: 'Canada', code: '+1' },
  { name: 'United Kingdom', code: '+44' },
  { name: 'Australia', code: '+61' },
  { name: 'New Zealand', code: '+64' },
  { name: 'Italy', code: '+39' },
  { name: 'Spain', code: '+34' },
  { name: 'Germany', code: '+49' }
];
// Swap the leading dial code when the country changes, keeping any number already typed.
function onCountryChange() {
  const sel = gid('acCountry'), phone = gid('acPhone');
  if (!sel || !phone) return;
  const next = (COUNTRY_CODES.find(c => c.name === sel.value) || {}).code || '';
  const current = phone.value.trim();
  const known = COUNTRY_CODES.map(c => c.code).sort((a, b) => b.length - a.length);
  const stripped = known.reduce((v, code) => (v.startsWith(code) ? v.slice(code.length) : v), current).trim();
  phone.value = next ? (stripped ? `${next} ${stripped}` : `${next} `) : stripped;
  phone.focus();
  phone.setSelectionRange(phone.value.length, phone.value.length);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
function flash(msg, cls = 'success') {
  const el = document.createElement('div');
  el.className = cls;
  el.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#fff;border:1px solid #d7dee8;border-radius:10px;padding:10px 18px;box-shadow:0 4px 14px rgba(0,0,0,.15);z-index:99;font-weight:600;max-width:90vw';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
function mountToggle() { const el = gid('langMount'); if (el && window.VI) el.innerHTML = VI.toggleHtml(); }

/* ---------- signed-out: sign in / sign up ---------- */
function renderAuth(mode) {
  mountToggle();
  const signup = mode === 'signup';
  gid('app').innerHTML = `
    <div style="text-align:center;margin:6px 0 14px">
      <h1 style="font-size:24px;margin:0 0 4px">${signup ? 'Create your VFIC account' : 'Sign in to your VFIC account'}</h1>
      <p class="muted" style="margin:0">Track your boxes, save a booking for later, and see everything you've sent before.</p>
    </div>
    <div class="card" style="max-width:460px;margin:0 auto">
      ${signup ? `
        <div class="form-grid">
          <div><label>Given Name *</label><input id="acGiven" autocomplete="given-name"></div>
          <div><label>Surname *</label><input id="acSurname" autocomplete="family-name"></div>
        </div>
        <label>Country *</label>
        <select id="acCountry" onchange="onCountryChange()">
          <option value="">— select your country —</option>
          ${COUNTRY_CODES.map(c => `<option value="${esc(c.name)}">${esc(c.name)} (${esc(c.code)})</option>`).join('')}
        </select>
        <label>Mobile Number</label>
        <input id="acPhone" autocomplete="tel" placeholder="Select a country to fill the code">
        <div class="muted" style="font-size:12px;margin-top:4px">Choosing your country fills in the dialling code automatically.</div>` : ''}
      <label>Email *</label><input id="acEmail" type="email" autocomplete="email">
      <label>Password *</label><input id="acPass" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}">
      ${signup ? `<div class="muted" style="font-size:12px;margin-top:4px">At least 8 characters.</div>
        <label>How did you hear about us?</label>
        <select id="acHeard" onchange="onHeardChange()">
          <option value="">— select —</option>
          ${HEARD_OPTIONS.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
        </select>
        <div id="acHeardOtherWrap" style="display:none;margin-top:6px">
          <input id="acHeardOther" placeholder="Please tell us where">
        </div>` : ''}
      <div id="acErr" class="error"></div>
      <button onclick="${signup ? 'doSignup()' : 'doSignin()'}" style="width:100%;margin-top:10px">${signup ? 'Create account' : 'Sign in'}</button>
      <div class="muted" style="text-align:center;margin-top:12px">
        ${signup
          ? `Already have an account? <a href="#" onclick="renderAuth('signin');return false">Sign in</a>`
          : `New to VFIC? <a href="#" onclick="renderAuth('signup');return false">Create an account</a>`}
      </div>
    </div>
    <div class="card muted" style="max-width:460px;margin:12px auto 0;text-align:center">
      Just want to track a box? <a href="/track.html">Track without an account →</a>
    </div>`;
  const pass = gid('acPass');
  if (pass) pass.addEventListener('keydown', e => { if (e.key === 'Enter') signup ? doSignup() : doSignin(); });
}
async function doSignup() {
  const err = gid('acErr'); err.textContent = '';
  try {
    const heard = val('acHeard') === 'Other' ? (val('acHeardOther') || 'Other') : val('acHeard');
    ME = await api('/api/public/sender/signup', { method: 'POST', body: {
      given_name: val('acGiven'), surname: val('acSurname'),
      name: [val('acGiven'), val('acSurname')].filter(Boolean).join(' '),
      heard_about_us: heard,
      phone: val('acPhone'), country: val('acCountry'),
      email: val('acEmail'), password: gid('acPass').value
    } });
    renderAccount();
  } catch (e) { err.textContent = e.message; }
}
async function doSignin() {
  const err = gid('acErr'); err.textContent = '';
  try {
    ME = await api('/api/public/sender/signin', { method: 'POST', body: { email: val('acEmail'), password: gid('acPass').value } });
    renderAccount();
  } catch (e) { err.textContent = e.message; }
}
async function doSignout() {
  await api('/api/public/sender/signout', { method: 'POST' });
  ME = null;
  renderAuth('signin');
}

/* ---------- signed-in ---------- */
async function renderAccount() {
  mountToggle();
  gid('app').innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:4px">
      <div>
        <h1 style="font-size:23px;margin:0">Hi, ${esc((ME.name || '').split(' ')[0] || 'there')} 👋</h1>
        <div class="muted">${esc(ME.email)}</div>
      </div>
      <button class="secondary" onclick="doSignout()">Sign out</button>
    </div>
    <div class="row" style="gap:8px;margin:12px 0">
      <a href="/intake-form.html"><button>＋ Book a new box</button></a>
      <a href="/order-box.html"><button class="secondary">Order an empty box</button></a>
      <a href="/track.html"><button class="secondary">Track a box</button></a>
    </div>
    <h2>Saved drafts</h2>
    <div class="card" id="drafts">Loading…</div>
    <h2>My bookings</h2>
    <div class="card" id="requests">Loading…</div>
    <h2>My shipments &amp; box tracking</h2>
    <div id="shipments" class="card">Loading…</div>`;
  loadDrafts();
  loadShipments();
}

async function loadDrafts() {
  try {
    const drafts = await api('/api/public/sender/drafts');
    gid('drafts').innerHTML = drafts.length ? `
      <div class="table-scroll"><table>
        <tr><th>Draft</th><th>Last saved</th><th></th></tr>
        ${drafts.map(d => `<tr>
          <td><b>${esc(d.label)}</b></td>
          <td>${fmtDate(d.updated_at)}</td>
          <td class="inline-actions">
            <a href="/intake-form.html?draft=${d.id}"><button class="small">Continue</button></a>
            <button class="small secondary danger" onclick="delDraft(${d.id})">Delete</button>
          </td>
        </tr>`).join('')}
      </table></div>`
      : `<span class="muted">No saved drafts yet. When you start a booking you can save it and come back later.</span>`;
  } catch (e) { gid('drafts').innerHTML = `<span class="error">${esc(e.message)}</span>`; }
}
async function delDraft(id) {
  if (!confirm('Delete this saved draft?')) return;
  try { await api('/api/public/sender/drafts/' + id, { method: 'DELETE' }); loadDrafts(); } catch (e) { flash(e.message, 'error'); }
}

async function loadShipments() {
  try {
    const { requests, shipments } = await api('/api/public/sender/shipments');
    gid('requests').innerHTML = requests.length ? `
      <div class="table-scroll"><table>
        <tr><th>Reference</th><th>Boxes</th><th>Size per box</th><th>Submitted</th><th>Status</th></tr>
        ${requests.map(r => `<tr>
          <td><b>${esc(r.reference_code)}</b></td>
          <td>${r.box_count}</td>
          <td class="wrap-cell">${esc(r.size_summary || '—')}</td>
          <td>${fmtDay(r.submitted_at)}</td>
          <td><span class="badge ${r.status === 'CONVERTED' ? 'st-delivered' : r.status === 'PENDING' ? 'st-created' : 'st-cancelled'}">${esc(r.status)}</span></td>
        </tr>`).join('')}
      </table></div>`
      : `<span class="muted">No online bookings yet. <a href="/intake-form.html">Book your first box →</a></span>`;

    gid('shipments').innerHTML = shipments.length ? shipments.map(s => `
      <div style="border-bottom:1px solid var(--border);padding:10px 0">
        <div class="row" style="justify-content:space-between">
          <b>${esc(s.shipment_number)}</b>
          <span class="muted">${fmtDay(s.created_at)} · ${esc(s.payment_status)}</span>
        </div>
        <div class="table-scroll" style="margin-top:6px"><table>
          <tr><th>Box #</th><th>Size</th><th>To</th><th>Status</th><th></th></tr>
          ${s.boxes.map(b => `<tr>
            <td>${esc(b.box_number)}</td>
            <td>${esc(b.size_label || '')}</td>
            <td>${esc(b.receiver_name)}${b.receiver_city ? ' · ' + esc(b.receiver_city) : ''}</td>
            <td><span class="badge st-${esc(String(b.status).toLowerCase())}">${esc(b.status_label)}</span></td>
            <td>${b.track_url ? `<a href="${esc(b.track_url)}" target="_blank">Track →</a>` : ''}</td>
          </tr>`).join('')}
        </table></div>
      </div>`).join('')
      : `<span class="muted">No shipments yet. Once VFIC receives your box(es), they will appear here with live tracking.</span>`;
  } catch (e) {
    gid('requests').innerHTML = `<span class="error">${esc(e.message)}</span>`;
    gid('shipments').innerHTML = '';
  }
}

/* ---------- boot ---------- */
(async () => {
  mountToggle();
  try { ME = await api('/api/public/sender/me'); renderAccount(); }
  catch (e) { renderAuth('signin'); }
})();
if (window.VI) VI.onChange(() => { ME ? renderAccount() : renderAuth('signin'); });
