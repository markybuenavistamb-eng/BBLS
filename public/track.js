/* VFIC public tracking page — QR token link or box-number + phone-last-4 lookup */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const resultEl = document.getElementById('result');
let LAST = null; // remember last payload to re-render on language switch

// language toggle mount + re-render hooks
function mountToggle() {
  const el = document.getElementById('langMount');
  if (el) { el.innerHTML = VI.toggleHtml(); }
}
mountToggle();
VI.onChange(() => { mountToggle(); VI.applyStatic(document); if (LAST) render(LAST); });

async function trackByToken(token) {
  resultEl.innerHTML = '<div class="card muted">' + esc(VI.t('track.loading')) + '</div>';
  try {
    const res = await fetch('/api/track/' + encodeURIComponent(token));
    const data = await res.json();
    if (!res.ok) { resultEl.innerHTML = '<div class="card error">' + esc(data.error || VI.t('track.unreachable')) + '</div>'; return; }
    render(data);
  } catch (e) {
    resultEl.innerHTML = '<div class="card error">' + esc(VI.t('track.unreachable')) + '</div>';
  }
}

async function lookup() {
  const box_number = document.getElementById('boxNum').value.trim();
  const phone_last4 = document.getElementById('phone4').value.trim();
  if (!box_number || !phone_last4) {
    resultEl.innerHTML = '<div class="card error">' + esc(VI.t('track.needBoth')) + '</div>';
    return;
  }
  resultEl.innerHTML = '<div class="card muted">' + esc(VI.t('track.loading')) + '</div>';
  try {
    const res = await fetch('/api/track-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ box_number, phone_last4 })
    });
    const data = await res.json();
    if (!res.ok) { resultEl.innerHTML = '<div class="card error">' + esc(data.error || VI.t('track.unreachable')) + '</div>'; return; }
    render(data);
  } catch (e) {
    resultEl.innerHTML = '<div class="card error">' + esc(VI.t('track.unreachable')) + '</div>';
  }
}

function render(d) {
  LAST = d;

  // Primary: the full expected journey — completed steps solid + timestamped, the current step
  // highlighted, upcoming steps hollow/greyed. Includes the overseas hub → region delivery legs.
  const jLabel = (step) => {
    const t = VI.t('journey.' + step.key, '');
    return t ? t.replace('{region}', d.region_label || '') : step.label;
  };
  const journey = (d.journey || []).map(step => {
    const cls = step.done ? (step.current ? 'j-current' : 'j-done') : 'j-upcoming';
    return `
      <li class="j-step ${cls}">
        <div class="j-label">${esc(jLabel(step))}</div>
        ${step.detail ? `<div class="j-detail">${esc(step.detail)}</div>` : ''}
        ${step.at ? `<div class="t-meta">${fmtDate(step.at)}</div>` : (step.done ? '' : `<div class="t-meta j-pending">${esc(VI.t('track.pending'))}</div>`)}
      </li>`;
  }).join('');

  // Secondary: the raw status log (collapsible), for full detail.
  const log = d.events.slice().reverse().map(h => `
    <li><div class="t-status">${esc(VI.t('pub.' + h.status, h.label))}</div>
      <div class="t-meta">${fmtDate(h.at)}</div></li>`).join('');

  resultEl.innerHTML = `
    <div class="card">
      <div class="muted">${esc(VI.t('track.boxLabel'))}</div>
      <div style="font-size:20px;font-weight:800;letter-spacing:.5px">${esc(d.box_number)}</div>
      <div class="big-status"><span class="badge st-${esc(String(d.status).toLowerCase())}" style="font-size:15px;padding:6px 14px">${esc(VI.t('pub.' + d.status, d.status_label))}</span></div>
      <p class="muted" style="margin:8px 0 2px">${esc(VI.t('track.for'))} ${esc(d.receiver_first_name)}${d.receiver_city ? ' · ' + esc(d.receiver_city) : ''}</p>
      ${d.eta_text ? `<p class="muted" style="margin:4px 0"><strong>${esc(d.eta_text)}</strong></p>` : ''}
    </div>
    ${d.return_note ? `<div class="card" style="border-left:5px solid var(--primary);background:#fff7ed">${esc(d.return_note)}</div>` : ''}
    <div class="card">
      <h2 style="margin-top:0">${esc(VI.t('track.timeline'))}</h2>
      <ul class="journey-timeline">${journey}</ul>
      <details class="collapse" style="margin-top:10px">
        <summary>${esc(VI.t('track.detailedLog'))}</summary>
        <ul class="timeline" style="margin-top:8px">${log}</ul>
      </details>
    </div>
    <div class="card muted">
      ${esc(VI.t('track.help'))} <strong>${esc(d.support.phone)}</strong> · <a href="mailto:${esc(d.support.email)}">${esc(d.support.email)}</a>.
    </div>`;
}

document.getElementById('phone4').addEventListener('keydown', e => { if (e.key === 'Enter') lookup(); });

const params = new URLSearchParams(location.search);
if (params.get('t')) {
  document.getElementById('lookupForm').parentElement.style.display = 'none';
  trackByToken(params.get('t'));
}
