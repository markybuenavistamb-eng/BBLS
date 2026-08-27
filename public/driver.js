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
    const form = opts.body instanceof FormData;
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: (opts.body && !form) ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? (form ? opts.body : JSON.stringify(opts.body)) : undefined
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
    // The code is read out over the phone as two halves, so the dash appears on its own
    // rather than being one more thing to get right while somebody is talking. It is only
    // added once there is a fifth character, or backspacing into it would put it straight
    // back and the field would refuse to empty.
    const format = (raw) => {
      const clean = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      return clean.length > 4 ? clean.slice(0, 4) + '-' + clean.slice(4) : clean;
    };
    box.addEventListener('input', () => {
      const atEnd = box.selectionStart === box.value.length;
      const before = box.value;
      const next = format(before);
      if (next === before) return;
      box.value = next;
      // Typing forwards is the normal case; keep the caret at the end so the inserted dash
      // does not push it backwards. Editing mid-code is rare enough to leave alone.
      if (atEnd) box.setSelectionRange(next.length, next.length);
    });
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
    stopSharing();
    RUN = null; LOG = [];
    renderLogin();
  };

  /* ---------- where the van is ---------- */
  // The office needs to know where a run has got to, and the phone in the driver's hand is the
  // only thing that knows. The phone asks their permission, which they may refuse — so this is
  // built to be optional throughout: a refusal costs the run nothing and is never asked twice.
  //
  // A fix every couple of minutes is what the question deserves. Watching continuously would
  // drain the battery of the device the whole shift depends on, to answer "where is the van"
  // more precisely than anybody needs.
  let geoTimer = null;
  let geoState = 'off';        // off | asking | on | refused | unavailable

  function sendFix(pos) {
    geoState = 'on';
    paintGeo();
    api('/api/driver/location', {
      method: 'POST',
      body: {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy
      }
    }).catch(e => {
      // The run finished between the fix and sending it. Nothing to fix, just stop.
      if (e.error === 'run_finished') stopSharing();
    });
  }

  function geoTrouble(err) {
    // 1 = permission denied. Anything else is the phone failing to get a fix, which may pass.
    geoState = err && err.code === 1 ? 'refused' : 'unavailable';
    if (geoState === 'refused') stopSharing();
    paintGeo();
  }

  function startSharing() {
    if (!navigator.geolocation || geoTimer) return;
    geoState = 'asking';
    paintGeo();
    const ask = () => navigator.geolocation.getCurrentPosition(sendFix, geoTrouble,
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
    ask();
    geoTimer = setInterval(ask, 120000);
  }

  function stopSharing() {
    if (geoTimer) { clearInterval(geoTimer); geoTimer = null; }
  }

  function paintGeo() {
    const el = gid('drvGeo');
    if (!el) return;
    const TEXT = {
      asking: 'Asking your phone for its location…',
      on: 'Sharing your location with the office while this run is open',
      refused: 'Location is off. The run works without it — turn it on in your browser settings if the office asks.',
      unavailable: 'Cannot get a location right now. The run is unaffected.',
      off: ''
    };
    el.textContent = TEXT[geoState] || '';
    el.className = 'drv-geo' + (geoState === 'on' ? ' on' : '');
  }

  /* ---------- the run ---------- */
  async function loadRun() {
    try { RUN = await api('/api/driver/me'); }
    catch (e) { return renderLogin(e.message); }
    if (!MODE) MODE = ACTIONS[RUN.kind][0].key;
    renderRun();
    startSharing();
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
          <div class="muted">${stopsFor(RUN.boxes).length} stop(s) · ${RUN.boxes.length} box(es) · <b>${RUN.outstanding}</b> still to do</div>
          ${RUN.plate_number || RUN.trucking_company ? `<div class="muted drv-truck">🚛 ${esc([RUN.plate_number, RUN.trucking_company].filter(Boolean).join(' · '))}</div>` : ''}
        </div>
        <button class="drv-out" onclick="drvLogout()">End</button>
      </div>

      <div class="drv-modes">
        ${actions.map(a => `
          <button class="drv-mode${a.key === MODE ? ' on' : ''}${a.danger ? ' danger' : ''}"
                  onclick="drvSetMode('${a.key}')">${esc(a.label)}</button>`).join('')}
      </div>
      <div class="muted drv-hint" id="drvHint"></div>
      <div class="drv-geo" id="drvGeo"></div>

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
    paintGeo();
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

  // Who took the box, remembered per stop. Three boxes handed to one person at one door is
  // one answer, not three — asking again for each is how a driver learns to type anything.
  const receivedByStop = {};
  let lastAnswerFor = null;

  function askText({ title, hint, value = '', confirmLabel = 'Save' }) {
    return new Promise(resolve => {
      const back = document.createElement('div');
      back.className = 'drv-ask';
      back.innerHTML = `
        <div class="drv-ask-box">
          <h2>${esc(title)}</h2>
          ${hint ? `<p class="muted">${esc(hint)}</p>` : ''}
          <input class="drv-ask-input" value="${esc(value)}" autocomplete="name" enterkeyhint="done">
          <div class="drv-ask-actions">
            <button class="drv-btn secondary" data-no>Cancel</button>
            <button class="drv-btn" data-yes>${esc(confirmLabel)}</button>
          </div>
        </div>`;
      const input = back.querySelector('.drv-ask-input');
      const done = (v) => { back.remove(); resolve(v); };
      back.addEventListener('click', (e) => {
        if (e.target.hasAttribute('data-no') || e.target === back) done(null);
        if (e.target.hasAttribute('data-yes')) done(input.value.trim() || null);
      });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') done(input.value.trim() || null); });
      document.body.appendChild(back);
      input.focus(); input.select();
    });
  }

  function askChoice({ title, options }) {
    return new Promise(resolve => {
      const back = document.createElement('div');
      back.className = 'drv-ask';
      back.innerHTML = `
        <div class="drv-ask-box">
          <h2>${esc(title)}</h2>
          <div class="drv-ask-list">
            ${options.map(o => `<button class="drv-btn secondary" data-pick="${esc(o.value)}">${esc(o.label)}</button>`).join('')}
          </div>
          <div class="drv-ask-actions"><button class="drv-btn secondary" data-no>Cancel</button></div>
        </div>`;
      const done = (v) => { back.remove(); resolve(v); };
      back.addEventListener('click', (e) => {
        const pick = e.target.getAttribute && e.target.getAttribute('data-pick');
        if (pick) return done(pick);
        if (e.target.hasAttribute('data-no') || e.target === back) done(null);
      });
      document.body.appendChild(back);
    });
  }

  // A photograph is what makes a proof of delivery a proof, so it is taken at the door rather
  // than chased afterwards. The file input with capture opens the camera straight away on
  // both phones, which is more reliable than driving the camera ourselves and leaves the
  // driver their own gallery if they would rather pick a shot they already took.
  function askPhoto({ title, hint }) {
    return new Promise(resolve => {
      const back = document.createElement('div');
      back.className = 'drv-ask';
      back.innerHTML = `
        <div class="drv-ask-box">
          <h2>${esc(title)}</h2>
          <p class="muted">${esc(hint)}</p>
          <input type="file" accept="image/*" capture="environment" class="drv-shot" hidden>
          <div class="drv-shot-preview" hidden><img alt=""></div>
          <div class="drv-ask-actions">
            <button class="drv-btn secondary" data-no>Cancel</button>
            <button class="drv-btn" data-take>📷 Take photo</button>
            <button class="drv-btn" data-use hidden>Use this</button>
          </div>
        </div>`;
      const input = back.querySelector('.drv-shot');
      const preview = back.querySelector('.drv-shot-preview');
      const img = preview.querySelector('img');
      const take = back.querySelector('[data-take]');
      const use = back.querySelector('[data-use]');
      let chosen = null;
      const done = (v) => { back.remove(); resolve(v); };
      input.addEventListener('change', () => {
        chosen = input.files && input.files[0];
        if (!chosen) return;
        img.src = URL.createObjectURL(chosen);
        preview.hidden = false;
        take.textContent = '📷 Retake';
        use.hidden = false;
      });
      back.addEventListener('click', (e) => {
        if (e.target.hasAttribute('data-no') || e.target === back) return done(null);
        if (e.target.hasAttribute('data-take')) return input.click();
        if (e.target.hasAttribute('data-use')) return done(chosen);
      });
      document.body.appendChild(back);
    });
  }

  const REASON_LABELS = {
    UNREACHABLE: 'Could not reach them by phone',
    ADDRESS_NOT_FOUND: 'Address could not be found',
    RECEIVER_ABSENT: 'Nobody there to receive it',
    REFUSED: 'They refused it',
    OTHER: 'Something else'
  };

  // Which stop a box belongs to, so one answer covers everything handed over together.
  // A number that matches two boxes on the same run names no single stop, so it gets a key of
  // its own rather than borrowing the signature and photographs from someone else's doorstep.
  function stopKeyFor(code) {
    const hits = (RUN.boxes || []).filter(x =>
      String(x.box_number).toLowerCase() === String(code).trim().toLowerCase());
    const b = hits.length === 1 ? hits[0] : null;
    return b ? [b.who || '', b.address || ''].join('¦') : String(code);
  }

  // Photographs already taken at this stop, so a second and third box through the same door
  // reuse the one signature and the one photograph rather than asking again.
  const podByStop = {};

  async function submit(code, extra) {
    let r;
    let body = { box_number: code, action: MODE, ...(extra || {}) };
    if (!extra && MODE === 'DELIVER') {
      const key = stopKeyFor(code);
      let name = receivedByStop[key];
      if (!name) {
        name = await askText({ title: 'Who received it?',
          hint: 'The name of the person taking the box. It goes on the proof of delivery.',
          confirmLabel: 'Next' });
        if (!name) { LOG.unshift({ ok: false, text: 'Not recorded — no name given' }); paintLog(); return; }
        receivedByStop[key] = name;
      }
      body.received_by_name = name;

      // The two photographs the office form requires. Taken once per handover.
      const have = podByStop[key] || {};
      let receiptFile = null, receiverFile = null;
      if (!have.receipt) {
        receiptFile = await askPhoto({ title: 'Photo of the signed receipt',
          hint: 'The delivery receipt with the receiver\'s signature on it.' });
        if (!receiptFile) { LOG.unshift({ ok: false, text: 'Not delivered — no receipt photo' }); paintLog(); return; }
      }
      if (!have.receiver) {
        receiverFile = await askPhoto({ title: 'Photo of the receiver with the box',
          hint: 'Show the person and the box together at the door.' });
        if (!receiverFile) { LOG.unshift({ ok: false, text: 'Not delivered — no receiver photo' }); paintLog(); return; }
      }

      const fd = new FormData();
      Object.entries(body).forEach(([k, v]) => fd.append(k, v));
      if (receiptFile) fd.append('pod_receipt_photo', receiptFile);
      else fd.append('pod_receipt_ref', have.receipt);
      if (receiverFile) fd.append('pod_receiver_photo', receiverFile);
      else fd.append('pod_receiver_ref', have.receiver);
      body = fd;
      body._stopKey = key;
    }
    if (!extra && MODE === 'RETURN') {
      const reason = await askChoice({ title: 'Why could it not be delivered?',
        options: Object.keys(REASON_LABELS).map(k => ({ value: k, label: REASON_LABELS[k] })) });
      if (!reason) { LOG.unshift({ ok: false, text: 'Not recorded — no reason given' }); paintLog(); return; }
      body.failure_reason = reason;
    }
    try {
      r = await api('/api/driver/scan', { method: 'POST', body });
    } catch (e) {
      LOG.unshift({ ok: false, text: String(code).slice(0, 30) + ' — ' + e.message });
      paintLog();
      buzz(false);
      return;
    }
    if (r.pod && body instanceof FormData) {
      const key = stopKeyFor(code);
      podByStop[key] = { receipt: r.pod.receipt, receiver: r.pod.receiver };
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

  // One card per stop. Boxes going to (or coming from) the same person at the same address
  // belong together — that is what the driver loads and checks off in one visit.
  function stopsFor(boxes) {
    const stops = new Map();
    for (const b of boxes) {
      const key = [b.who || '', b.address || '', b.window || ''].join('¦');
      if (!stops.has(key)) {
        stops.set(key, { who: b.who, address: b.address, window: b.window,
                         landmark: b.landmark, phone: b.phone, boxes: [] });
      }
      stops.get(key).boxes.push(b);
    }
    return [...stops.values()];
  }

  /* ---------- telling one doorstep you are close ---------- */
  // Not a scan. Approaching an address is not something there is a label in your hand for — the
  // boxes are still in the back of the van — so it belongs on the stop, as one tap that sends
  // one text to that receiver. The office already sends one message per doorstep however many
  // boxes are on it, so tapping it with three boxes aboard still sends one.
  function nearbyButton(st) {
    if (RUN.kind !== 'DELIVERY') return '';
    const out = st.boxes.filter(b => b.status === 'OUT_FOR_DELIVERY');
    if (!out.length) return '';                       // not on the road yet, or already finished
    if (out.some(b => b.nearby_notified)) {
      return '<div class="drv-told">✓ Receiver told you are nearby</div>';
    }
    return `<button class="drv-near" onclick="drvNearby('${esc(out[0].box_number)}', this)">
      📣 Tell them you are nearly there</button>`;
  }

  window.drvNearby = async function (boxNumber, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    try {
      const r = await api('/api/driver/scan', { method: 'POST', body: { box_number: boxNumber, action: 'NEARBY' } });
      LOG.unshift({ ok: true, text: r.message || 'Receiver told you are nearby' });
      paintLog();
      await loadRun();                                 // redraw so the stop shows it is done
    } catch (e) {
      LOG.unshift({ ok: false, text: e.message || 'Could not send the message' });
      paintLog();
      if (btn) { btn.disabled = false; btn.textContent = '📣 Tell them you are nearly there'; }
    }
  };

  function paintList() {
    const done = RUN.kind === 'DELIVERY'
      ? ['DELIVERED', 'RETURNED', 'CANCELLED']
      : ['RECEIVED_ORIGIN', 'LOADED_CONTAINER', 'IN_TRANSIT'];
    const heading = RUN.kind === 'DELIVERY' ? 'Deliver to' : 'Collect from';
    const t = gid('drvListTitle');
    if (t) t.textContent = heading;

    const stops = stopsFor(RUN.boxes);
    gid('drvList').innerHTML = stops.map(st => {
      // On a collection run "to go" means not yet on the van; on a delivery it means not yet
      // delivered. Either way it is the number of labels still to scan at this stop.
      const left = st.boxes.filter(b => RUN.kind === 'PICKUP'
        ? !(b.picked_up || done.includes(b.status))
        : !done.includes(b.status)).length;
      return `
      <div class="drv-box${left === 0 ? ' done' : ''}">
        <div class="drv-box-top">
          <b>${esc(st.who || '')}</b>
          <span class="drv-box-status">${left ? left + ' of ' + st.boxes.length + ' to go' : 'all done'}</span>
        </div>
        ${st.address ? `<div class="drv-box-addr">${esc(st.address)}</div>` : ''}
        ${st.window ? `<div class="drv-box-when">🕑 ${esc(st.window)}</div>` : ''}
        ${st.landmark ? `<div class="muted drv-box-lm">${esc(st.landmark)}</div>` : ''}
        <div class="drv-stop-boxes">
          ${st.boxes.map(b => {
            const isDone = done.includes(b.status);
            const onVan = !isDone && b.picked_up;
            const cls = isDone ? ' got' : (onVan ? ' loaded' : '');
            const tick = isDone ? '✓ ' : (onVan ? '▪ ' : '');
            return `<span class="drv-chip${cls}" title="${esc(onVan ? 'On the van' : b.status_label)}">${tick}${esc(b.box_number)}${b.size_label ? ' · ' + esc(b.size_label) : ''}</span>`;
          }).join('')}
        </div>
        ${st.phone ? `<a class="drv-call" href="tel:${esc(st.phone)}">📞 ${esc(st.phone)}</a>` : ''}
        ${nearbyButton(st)}
      </div>`;
    }).join('');
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
