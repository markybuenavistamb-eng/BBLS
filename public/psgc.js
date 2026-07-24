/* Linked Philippine address dropdowns: Region → City/Municipality → Barangay.
   Data source: PSGC API (psgc.gitlab.io) — the machine-readable form of the same
   PSA/PhilAtlas geographic data. Results are cached per session.
   Degrades gracefully: if the API is unreachable, the selects become free-text inputs
   so a booking can still be completed. */
(function () {
  const BASE = 'https://psgc.gitlab.io/api';
  const cache = new Map();

  async function getJSON(url) {
    if (cache.has(url)) return cache.get(url);
    const res = await fetch(url);
    if (!res.ok) throw new Error('PSGC ' + res.status);
    const data = await res.json();
    cache.set(url, data);
    return data;
  }

  const byName = (a, b) => String(a.name).localeCompare(String(b.name));

  const regions = () => getJSON(`${BASE}/regions/`).then(r => r.slice().sort(byName));
  const cities = (regionCode) =>
    getJSON(`${BASE}/regions/${regionCode}/cities-municipalities/`).then(r => r.slice().sort(byName));
  const barangays = (cityCode) =>
    getJSON(`${BASE}/cities-municipalities/${cityCode}/barangays/`).then(r => r.slice().sort(byName));

  function fill(sel, items, placeholder) {
    sel.innerHTML = `<option value="">${placeholder}</option>` +
      items.map(i => `<option value="${i.code}" data-name="${String(i.name).replace(/"/g, '&quot;')}">${i.name}</option>`).join('');
    sel.disabled = false;
  }
  function reset(sel, placeholder) {
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    sel.disabled = true;
  }
  // Turn the three selects into plain text inputs (offline / API failure fallback).
  function degrade(els, note) {
    [['region', 'Region'], ['city', 'City / Municipality'], ['barangay', 'Barangay']].forEach(([k, label]) => {
      const sel = els[k];
      if (!sel || sel.tagName === 'INPUT') return;
      const input = document.createElement('input');
      input.id = sel.id; input.name = sel.name || sel.id;
      input.placeholder = label; input.required = sel.required;
      input.className = sel.className;
      sel.parentNode.replaceChild(input, sel);
      els[k] = input;
    });
    if (note) {
      const n = document.createElement('div');
      n.className = 'muted';
      n.style.fontSize = '12px';
      n.textContent = note;
      (els.region.parentNode || document.body).appendChild(n);
    }
  }

  /* Wire three <select> elements together.
     els = { region, city, barangay } (elements or ids). Selected NAMES are mirrored into
     hidden inputs (if provided as els.regionName / cityName / barangayName) for submission. */
  async function mountCascade(els) {
    const $ = (v) => (typeof v === 'string' ? document.getElementById(v) : v);
    const region = $(els.region), city = $(els.city), barangay = $(els.barangay);
    if (!region || !city || !barangay) return;
    const refs = { region, city, barangay };

    const mirror = (sel, targetId) => {
      const t = targetId && document.getElementById(targetId);
      if (t) t.value = sel.selectedOptions[0] ? (sel.selectedOptions[0].dataset.name || '') : '';
    };

    reset(city, 'Select city / municipality');
    reset(barangay, 'Select barangay');
    region.innerHTML = '<option value="">Loading regions…</option>';
    region.disabled = true;

    try {
      fill(region, await regions(), 'Select region');
    } catch (e) {
      degrade(refs, 'Address lookup is offline — please type your region, city and barangay.');
      return;
    }

    region.addEventListener('change', async () => {
      mirror(region, els.regionName);
      reset(city, 'Loading…'); reset(barangay, 'Select barangay');
      if (!region.value) { reset(city, 'Select city / municipality'); return; }
      try { fill(city, await cities(region.value), 'Select city / municipality'); }
      catch (e) { reset(city, 'Unavailable'); }
    });

    city.addEventListener('change', async () => {
      mirror(city, els.cityName);
      reset(barangay, 'Loading…');
      if (!city.value) { reset(barangay, 'Select barangay'); return; }
      try { fill(barangay, await barangays(city.value), 'Select barangay'); }
      catch (e) { reset(barangay, 'Unavailable'); }
    });

    barangay.addEventListener('change', () => mirror(barangay, els.barangayName));
  }

  window.PSGC = { regions, cities, barangays, mountCascade };
})();
