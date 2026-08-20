/* VFIC driver app — one run, one phone, no account.
 *
 * A driver signs in with a pass code the office reads out, works the run by scanning box
 * labels, and the pass stops working once the run is finished. Everything here assumes a
 * phone held in one hand at a tailgate: large targets, one decision at a time, and a running
 * tally so the driver can see what is left without counting boxes.
 */
(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const gid = (id) => document.getElementById(id);

  let RUN = null;        // the manifest
  let MODE = null;       // which action a scan performs
  let LOG = [];          // what has happened this session, newest first
  let scanner = null;

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'Something went wrong'); Object.assign(e, data); throw e; }
    return data;
  }

  /* ---------- the two kinds of run ---------- */
  // Each action is one thing a driver does, in the order they do it, so the buttons read as
  // the shift reads rather than as a list of statuses.
  const ACTIONS = {
    DELIVERY: [
      { key: 'LOAD',    label: 'Loaded at PH warehouse', hint: 'Scan each box as it goes on the truck' },
      { key: 'DEPART',  label: 'Out for delivery',       hint: 'Scan when you set off on the route' },
      { key: 'DELIVER', label: 'Delivered',              hint: "Scan at the receiver's door, once handed over" },
      { key: 'RETURN',  label: 'Could not deliver',      hint: 'Scan if it is coming back with you', danger: true }
    ],
    PICKUP: [
      { key: 'PICKUP', label: 'Picked up from sender',  hint: "Scan each box as you load it at the sender's address" },
      { key: 'DROP',   label: 'Handed to warehouse',    hint: 'Scan on arrival at the origin warehouse' }
    ]
  };

  /* ---------- sign in ---------- */
  function renderLogin(message) {
    stopScanner();
    gid('drvWho').textContent = '';
    gid('drvApp').innerHTML = `
      <div class="drv-card">
        <h1>Driver sign-in</h1>
        <p class="muted">Enter the pass code the office gave you for today's run.</p>
        <input id="drvCode" class="drv-code" inputmode="latin" autocapitalize="characters"
               autocomplete="one-time-code" maxlength="9" placeholder="ABCD-2345">
        <div class="error" id="drvErr">${message ? esc(message) : ''}</div>
        <button class="drv-btn" onclick="drvLogin()">Start run</button>
        <p class="muted drv-note">The pass stops working by itself once the run is finished.</p>
      </div>`;
    const box = gid('drvCode');
    box.focus();
    box.addEventListener('input', () => { box.value = box.value.toUpperCase(); });
    box.addEventListener('keydown', e => { if (e.key === 'Enter') drvLogin(); });
  }

  window.drvLogin = async function () {
    const err = gid('drvErr');
    err.textContent = '';
    try {
      await api('/api/driver/login', { method: 'POST', body: { code: gid('drvCode').value } });
      await loadRun();
    } catch (e) { err.textContent = e.message; }
  };

  window.drvLogout = async function () {
    await api('/api/driver/logout', { method: 'POST' }).catch(() => {});
    RUN = null; LOG = [];
    renderLogin();
  };

  /* ---------- the run ---------- */
  async function loadRun() {
    try { RUN = await api('/api/driver/me'); }
    catch (e) { return renderLogin(e.message); }
    if (!MODE) MODE = ACTIONS[RUN.kind][0].key;
    renderRun();
  }

  function renderRun() {
    gid('drvWho').textContent = RUN.driver_name;
    const actions = ACTIONS[RUN.kind];
    const title = RUN.kind === 'DELIVERY'
      ? (RUN.trip_number ? 'Delivery · ' + RUN.trip_number : 'Delivery run')
      : 'Sender pick-ups · ' + RUN.branch_label;

    gid('drvApp').innerHTML = `
      <div class="drv-head">
        <div>
          <div class="drv-title">${esc(title)}</div>
          <div class="muted">${RUN.boxes.length} box(es) · <b>${RUN.outstanding}</b> still to do</div>
        </div>
        <button class="drv-out" onclick="drvLogout()">End</button>
      </div>

      <div class="drv-modes">
        ${actions.map(a => `
          <button class="drv-mode${a.key === MODE ? ' on' : ''}${a.danger ? ' danger' : ''}"
                  onclick="drvSetMode('${a.key}')">${esc(a.label)}</button>`).join('')}
      </div>
      <div class="muted drv-hint" id="drvHint"></div>

      <div id="drvScanner" class="drv-scanner"></div>
      <div class="drv-manual">
        <input id="drvBox" placeholder="Or type the box number" autocomplete="off">
        <button class="drv-btn small" onclick="drvManual()">Go</button>
      </div>

      <div id="drvLog" class="drv-log"></div>

      <div class="drv-list-title" id="drvListTitle">On this run</div>
      <div id="drvList" class="drv-list"></div>`;

    gid('drvBox').addEventListener('keydown', e => { if (e.key === 'Enter') drvManual(); });
    paintHint();
    paintLog();
    paintList();
    startScanner();
  }

  window.drvSetMode = function (key) {
    MODE = key;
    document.querySelectorAll('.drv-mode').forEach(b => b.classList.remove('on'));
    const list = ACTIONS[RUN.kind];
    const idx = list.findIndex(a => a.key === key);
    document.querySelectorAll('.drv-mode')[idx].classList.add('on');
    paintHint();
  };

  function paintHint() {
    const a = ACTIONS[RUN.kind].find(x => x.key === MODE);
    gid('drvHint').textContent = a ? a.hint : '';
  }

  /* ---------- scanning ---------- */
  // One scan is one action. The camera keeps running and the tally updates underneath, so a
  // driver can work a pallet without touching the screen between boxes.
  let lastCode = '';
  let lastAt = 0;

  function startScanner() {
    stopScanner();
    if (!window.Html5Qrcode) return;
    scanner = new Html5Qrcode('drvScanner', { verbose: false });
    scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } },
      (text) => {
        // The same label stays in frame for several reads; act on it once.
        const now = Date.now();
        if (text === lastCode && now - lastAt < 2500) return;
        lastCode = text; lastAt = now;
        submit(text);
      },
      () => {}
    ).catch(() => {
      gid('drvScanner').innerHTML = '<div class="muted drv-nocam">Camera unavailable — type the box number below.</div>';
    });
  }
  function stopScanner() {
    if (scanner) { try { scanner.stop().catch(() => {}); } catch (e) {} scanner = null; }
  }

  window.drvManual = function () {
    const v = gid('drvBox').value.trim();
    if (!v) return;
    gid('drvBox').value = '';
    submit(v);
  };

  async function submit(code) {
    let r;
    try {
      r = await api('/api/driver/scan', { method: 'POST', body: { box_number: code, action: MODE } });
    } catch (e) {
      LOG.unshift({ ok: false, text: String(code).slice(0, 30) + ' — ' + e.message });
      paintLog();
      buzz(false);
      return;
    }
    LOG.unshift({ ok: true, text: r.message });
    buzz(true);
    if (typeof r.outstanding === 'number') RUN.outstanding = r.outstanding;
    // Refresh the manifest so the list and the tally agree with what just happened.
    try { RUN = await api('/api/driver/me'); } catch (e) { /* the log already told them */ }
    paintLog();
    paintList();
    const left = gid('drvApp').querySelector('.drv-head b');
    if (left) left.textContent = RUN.outstanding;
    if (r.finished) finishRun();
  }

  // A phone at a tailgate is often not being looked at; a short buzz says it landed.
  function buzz(ok) {
    if (!navigator.vibrate) return;
    navigator.vibrate(ok ? 40 : [60, 60, 60]);
  }

  function paintLog() {
    gid('drvLog').innerHTML = LOG.slice(0, 8).map(l =>
      `<div class="drv-line ${l.ok ? 'ok' : 'bad'}">${l.ok ? '✓' : '✗'} ${esc(l.text)}</div>`).join('');
  }

  function paintList() {
    const done = RUN.kind === 'DELIVERY'
      ? ['DELIVERED', 'RETURNED', 'CANCELLED']
      : ['RECEIVED_ORIGIN', 'LOADED_CONTAINER', 'IN_TRANSIT'];
    const heading = RUN.kind === 'DELIVERY' ? 'Deliver to' : 'Collect from';
    const t = gid('drvListTitle');
    if (t) t.textContent = heading;
    gid('drvList').innerHTML = RUN.boxes.map(b => `
      <div class="drv-box${done.includes(b.status) ? ' done' : ''}">
        <div class="drv-box-top">
          <b>${esc(b.box_number)}</b>
          <span class="drv-box-status">${esc(b.status_label)}</span>
        </div>
        <div class="drv-box-who">${esc(b.who || b.receiver_name || b.sender_name || '')}${b.size_label ? ' · ' + esc(b.size_label) : ''}</div>
        ${b.address ? `<div class="drv-box-addr">${esc(b.address)}</div>` : ''}
        ${b.window ? `<div class="drv-box-when">🕑 ${esc(b.window)}</div>` : ''}
        ${b.landmark ? `<div class="muted drv-box-lm">${esc(b.landmark)}</div>` : ''}
        ${b.phone ? `<a class="drv-call" href="tel:${esc(b.phone)}">📞 ${esc(b.phone)}</a>` : ''}
      </div>`).join('');
  }

  function finishRun() {
    stopScanner();
    gid('drvApp').innerHTML = `
      <div class="drv-card drv-done">
        <div class="drv-tick">✓</div>
        <h1>Run finished</h1>
        <p class="muted">Every box on this run is done. Your pass has closed itself —
           ask the office for a new one next time.</p>
        <button class="drv-btn" onclick="drvLogout()">Close</button>
      </div>`;
  }

  /* ---------- boot ---------- */
  (async () => {
    try { RUN = await api('/api/driver/me'); MODE = ACTIONS[RUN.kind][0].key; renderRun(); }
    catch (e) { renderLogin(); }
  })();
})();
