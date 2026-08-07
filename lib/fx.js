// Foreign-exchange conversion to the peso, for the head-office consolidated books.
//
// Thailand bills in THB and Cambodia in USD, so head office needs one figure in PHP to see
// the group's revenue. The rate VFIC uses is the Bangko Sentral ng Pilipinas Reference
// Exchange Rate Bulletin (RERB), which is the rate Philippine accounting and BIR filings
// are expected to reference:
//   https://www.bsp.gov.ph/SitePages/Statistics/DailyRERB.aspx
//
// Rates live in settings so they are always editable by hand — the consolidated view must
// never depend on BSP being reachable. refreshFromBsp() is a convenience on top of that:
// it pulls the latest bulletin when it can and reports plainly when it cannot.

const https = require('https');

const BSP_PAGE = 'https://www.bsp.gov.ph/SitePages/Statistics/DailyRERB.aspx';

// Currencies the portal can bill in. Values are pesos per one unit of the currency,
// the "Peso Equivalent" column of the RERB.
const CURRENCIES = ['PHP', 'USD', 'THB', 'KHR', 'VND', 'EUR', 'GBP', 'AED', 'CAD'];

// How BSP names each currency in the bulletin. Used only as a fallback — the symbol is
// what we match on, because names like "Dollar" and "Pound" appear on several rows.
const BSP_NAMES = {
  USD: ['United States'],
  THB: ['Thailand'],
  KHR: ['Cambodia'],
  VND: ['Vietnam'],
  EUR: ['Euro'],
  GBP: ['United Kingdom'],
  AED: ['United Arab Emirates'],
  CAD: ['Canada']
};

// Starting figures, from the BSP bulletin of the date below. VFIC updates these in
// Accounting → Rate Cards; they are a defensible starting point, not a live feed.
const DEFAULT_FX = {
  base: 'PHP',
  source: 'BSP Reference Exchange Rate Bulletin',
  source_url: BSP_PAGE,
  as_of: '2026-08-06',
  updated_at: null,
  updated_by: null,
  rates: {
    PHP: 1,
    USD: 61.70,
    THB: 1.8383,
    KHR: 0.0154,
    VND: 0.0024,
    EUR: 71.40,
    GBP: 82.90,
    AED: 16.80,
    CAD: 45.10
  }
};

function normalizeFx(fx) {
  const f = fx && typeof fx === 'object' ? fx : {};
  const rates = { ...DEFAULT_FX.rates };
  for (const [k, v] of Object.entries(f.rates || {})) {
    const n = Number(v);
    if (CURRENCIES.includes(k) && isFinite(n) && n > 0) rates[k] = n;
  }
  rates.PHP = 1; // the base never moves
  return {
    base: 'PHP',
    source: f.source || DEFAULT_FX.source,
    source_url: f.source_url || DEFAULT_FX.source_url,
    as_of: f.as_of || DEFAULT_FX.as_of,
    updated_at: f.updated_at || null,
    updated_by: f.updated_by || null,
    rates
  };
}

// How old the rates are, in whole days. The UI warns once this gets large, because a stale
// bulletin quietly misstates the consolidated total.
function ageInDays(fx) {
  const t = Date.parse((fx && fx.as_of) || '');
  if (!isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function rateFor(currency, fx) {
  const f = normalizeFx(fx);
  const r = f.rates[String(currency || '').toUpperCase()];
  return isFinite(r) && r > 0 ? r : null;
}

// Convert one amount to pesos. Returns converted:false rather than guessing when the
// currency has no published rate, so the caller can say so instead of showing a wrong total.
function toPhp(amount, currency, fx) {
  const rate = rateFor(currency, fx);
  const n = Number(amount) || 0;
  if (rate == null) return { amount: null, rate: null, converted: false };
  return { amount: +(n * rate).toFixed(2), rate, converted: true };
}

// Convert between any two currencies via the peso. Head office bills its branches in PHP,
// so a Thailand statement has to restate that charge in baht to be readable.
function convert(amount, from, to, fx) {
  const a = String(from || '').toUpperCase();
  const b = String(to || '').toUpperCase();
  const n = Number(amount) || 0;
  if (!a || !b || a === b) return { amount: +n.toFixed(2), rate: 1, converted: true };
  const rFrom = rateFor(a, fx);
  const rTo = rateFor(b, fx);
  if (rFrom == null || rTo == null) return { amount: null, rate: null, converted: false };
  const rate = rFrom / rTo;
  return { amount: +(n * rate).toFixed(2), rate: +rate.toFixed(6), converted: true };
}

// Convert a {CCY: {billed, collected, receivable, …}} breakdown into pesos and total it.
// Any currency without a rate is listed in `unconverted` and left out of the total.
function consolidate(byCurrency, fx, fields = ['billed', 'collected', 'receivable']) {
  const f = normalizeFx(fx);
  const lines = [];
  const totals = {};
  for (const k of fields) totals[k] = 0;
  const unconverted = [];
  for (const [ccy, row] of Object.entries(byCurrency || {})) {
    const rate = rateFor(ccy, f);
    const line = { currency: ccy, rate, converted: rate != null, php: {} };
    for (const k of fields) {
      line[k] = +(row[k] || 0);
      line.php[k] = rate == null ? null : +((row[k] || 0) * rate).toFixed(2);
      if (rate != null) totals[k] = +(totals[k] + line.php[k]).toFixed(2);
    }
    if (row.shipments != null) line.shipments = row.shipments;
    if (rate == null) unconverted.push(ccy);
    lines.push(line);
  }
  lines.sort((a, b) => (b.php.billed || 0) - (a.php.billed || 0));
  return {
    base: 'PHP', source: f.source, source_url: f.source_url, as_of: f.as_of,
    age_days: ageInDays(f), lines, totals, unconverted
  };
}

// --- pulling the current bulletin from BSP -------------------------------------------
// BSP publishes the RERB as a dated PDF linked from the page above. The attachment id
// changes every day, so we read the page, take the newest attachment, and parse its text.

function get(url, { redirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 12000,
      headers: { 'User-Agent': 'VFIC-Ops/1.0', 'Accept': '*/*' }
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), { redirects: redirects - 1 }));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('BSP returned HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error('BSP did not respond within 12s')));
    req.on('error', reject);
  });
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// Find the most recent RERB attachment linked on the bulletin page.
function latestBulletinLink(html) {
  const re = /\/Lists\/RERB\/Attachments\/(\d+)\/(\d{2})([A-Za-z]{3})(\d{4})\.pdf/g;
  let m, best = null;
  while ((m = re.exec(html)) !== null) {
    const mon = MONTHS[m[3].toLowerCase()];
    if (!mon) continue;
    const date = `${m[4]}-${String(mon).padStart(2, '0')}-${m[2]}`;
    if (!best || date > best.date) best = { id: +m[1], date, url: 'https://www.bsp.gov.ph' + m[0] };
  }
  return best;
}

// Pull each currency's peso equivalent out of the bulletin text. Each row runs
// "country/currency · symbol · US dollar equivalent · peso equivalent", so we anchor on
// the symbol and take the second number after it — the peso figure.
function parseBulletin(text) {
  const flat = String(text || '').replace(/\s+/g, ' ');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out = {};
  for (const ccy of CURRENCIES) {
    if (ccy === 'PHP') continue;
    const anchors = [ccy, ...(BSP_NAMES[ccy] || [])];
    for (const a of anchors) {
      const m = new RegExp('\\b' + esc(a) + '\\b[^0-9]{0,40}([\\d.,]+)\\s+([\\d.,]+)', 'i').exec(flat);
      if (!m) continue;
      const php = Number(String(m[2]).replace(/,/g, ''));
      if (isFinite(php) && php > 0) { out[ccy] = +php.toFixed(6); break; }
    }
  }
  return out;
}

// Best-effort refresh. Resolves with { ok, rates, as_of, url } or { ok:false, error } —
// it never throws, because a failed refresh must leave the stored rates untouched.
async function refreshFromBsp() {
  try {
    const page = (await get(BSP_PAGE)).toString('utf8');
    const link = latestBulletinLink(page);
    if (!link) return { ok: false, error: 'Could not find a bulletin link on the BSP page — its layout may have changed. Enter the rates by hand.' };
    const { extractPdfText } = require('./idcheck');
    const rates = parseBulletin(extractPdfText(await get(link.url)));
    if (!rates.USD) return { ok: false, error: `Read the bulletin for ${link.date} but could not find the peso equivalents in it. Enter the rates by hand.`, url: link.url };
    return { ok: true, rates, as_of: link.date, url: link.url };
  } catch (e) {
    return { ok: false, error: 'Could not reach BSP: ' + e.message };
  }
}

module.exports = {
  BSP_PAGE, CURRENCIES, DEFAULT_FX,
  normalizeFx, ageInDays, rateFor, toPhp, convert, consolidate,
  refreshFromBsp, latestBulletinLink, parseBulletin
};
