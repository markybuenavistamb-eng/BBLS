// Verification of an uploaded passport / government ID against the sender's declared details.
//
// WHAT THIS CAN AND CANNOT DO
// ---------------------------
// For PDFs we can read the embedded text layer, so we can genuinely check whether the
// sender's surname, given name and passport number appear on the document, and we can parse
// a passport MRZ if present. That gives a real MATCH / MISMATCH verdict.
//
// For photos (JPG/PNG/WEBP/HEIC) there is no text to read without OCR, which this server does
// not run. Those are marked NEEDS_REVIEW with structural warnings (e.g. an implausible aspect
// ratio, or a file so small it cannot be a legible ID) and must be eyeballed by staff.
//
// Every result is advisory: staff confirm or reject in the intake review screen.

const zlib = require('zlib');

const VERDICTS = { MATCH: 'MATCH', MISMATCH: 'MISMATCH', NEEDS_REVIEW: 'NEEDS_REVIEW' };

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normName = (s) => String(s || '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();

// --- PDF text extraction (uncompressed + Flate streams) ---
function extractPdfText(buf) {
  let out = '';
  try {
    const raw = buf.toString('latin1');
    // Pull each stream, inflating the ones that are Flate-encoded.
    const re = /stream\r?\n?([\s\S]*?)endstream/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const chunk = Buffer.from(m[1], 'latin1');
      let text = null;
      try { text = zlib.inflateSync(chunk).toString('latin1'); }
      catch (e) { text = /[A-Za-z]{3}/.test(m[1]) ? m[1] : null; }
      if (text) out += ' ' + text;
    }
    if (!out) out = raw;
    // Text-showing operators: (literal) Tj  and  [(a) -2 (b)] TJ
    let show = '';
    const tj = /\(((?:\\.|[^\\()])*)\)\s*(?:Tj|TJ|'|")/g;
    let t;
    while ((t = tj.exec(out)) !== null) show += ' ' + t[1].replace(/\\([()\\])/g, '$1');
    const arr = /\[((?:[^\][]|\\.)*)\]\s*TJ/g;
    while ((t = arr.exec(out)) !== null) {
      const inner = /\(((?:\\.|[^\\()])*)\)/g;
      let p;
      while ((p = inner.exec(t[1])) !== null) show += p[1].replace(/\\([()\\])/g, '$1');
    }
    return (show + ' ' + out).slice(0, 400000);
  } catch (e) { return ''; }
}

// --- Machine Readable Zone (passport line 2 carries the document number) ---
function findMrz(text) {
  const t = String(text || '').replace(/\s+/g, '');
  const line1 = /P[<A-Z0-9]{20,}/.exec(t);
  const docNo = /\b([A-Z0-9]{6,9})[0-9][A-Z]{3}[0-9]{7}[MFX<][0-9]{7}/.exec(t);
  return { present: !!(line1 || docNo), document_number: docNo ? docNo[1].replace(/</g, '') : null };
}

// --- image header parsing, to sanity-check a photo without OCR ---
function imageSize(buf, mime) {
  try {
    if (mime === 'image/png' && buf.length > 24) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xFF) { i++; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
    if (mime === 'image/webp' && buf.length > 30 && buf.slice(12, 16).toString('latin1') === 'VP8X') {
      return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
  } catch (e) { /* fall through */ }
  return null;
}

/**
 * @param file   multer file ({ buffer, mimetype, originalname, size })
 * @param sender { family_name, given_name, middle_name, passport_number }
 */
function verifyIdDocument(file, sender = {}) {
  const checks = [];
  const flags = [];
  const mime = String(file.mimetype || '').toLowerCase();
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  const family = normName(sender.family_name);
  const given = normName(sender.given_name);
  const passportNo = norm(sender.passport_number);

  if (mime === 'application/pdf') {
    const text = extractPdfText(file.buffer);
    const flat = normName(text);
    const flatAll = norm(text);
    const readable = flat.replace(/\s/g, '').length > 40;
    add('Document text readable', readable, readable ? 'Text layer extracted' : 'No readable text layer — cannot auto-match');

    if (!readable) {
      flags.push('The PDF has no readable text (it is probably a scan) — verify the name and passport number by eye.');
      return { verdict: VERDICTS.NEEDS_REVIEW, checks, flags, method: 'pdf-no-text' };
    }

    const famOk = !!family && flat.includes(family);
    const givOk = !!given && flat.includes(given);
    add('Surname on document', famOk, family ? `Looked for “${family}”` : 'No surname declared');
    add('Given name on document', givOk, given ? `Looked for “${given}”` : 'No given name declared');

    const mrz = findMrz(text);
    let passOk = null;
    if (passportNo) {
      passOk = flatAll.includes(passportNo) || (mrz.document_number && norm(mrz.document_number) === passportNo);
      add('Passport number on document', passOk, `Looked for “${passportNo}”${mrz.document_number ? ` · MRZ shows “${mrz.document_number}”` : ''}`);
    }
    if (mrz.present) add('Passport MRZ detected', true, mrz.document_number ? `Document no. ${mrz.document_number}` : 'MRZ pattern found');

    const looksLikeId = mrz.present || /PASSPORT|REPUBLIKA|REPUBLIC|DRIVER|LICENSE|LICENCE|IDENTIFICATION|NATIONAL ID|PHILSYS|UMID|POSTAL ID/.test(flat);
    add('Looks like an ID document', looksLikeId, looksLikeId ? 'Recognised ID wording or MRZ' : 'No ID wording found — this may not be an ID');
    if (!looksLikeId) flags.push('This file does not look like a passport or government ID.');

    if (!famOk) flags.push(`The surname “${sender.family_name || '—'}” does not appear on the uploaded ID.`);
    if (!givOk) flags.push(`The given name “${sender.given_name || '—'}” does not appear on the uploaded ID.`);
    if (passOk === false) flags.push(`Passport number “${sender.passport_number}” does not appear on the uploaded ID.`);

    const nameOk = famOk && givOk;
    const verdict = (nameOk && passOk !== false && looksLikeId) ? VERDICTS.MATCH : VERDICTS.MISMATCH;
    return { verdict, checks, flags, method: 'pdf-text' };
  }

  // ---- image: structural checks only ----
  const dim = imageSize(file.buffer, mime);
  if (dim) {
    const ratio = dim.width && dim.height ? +(Math.max(dim.width, dim.height) / Math.min(dim.width, dim.height)).toFixed(2) : 0;
    const bigEnough = Math.min(dim.width, dim.height) >= 400;
    add('Resolution adequate', bigEnough, `${dim.width}×${dim.height}px`);
    if (!bigEnough) flags.push('The image is low-resolution — the ID may not be legible enough for customs.');
    const plausible = ratio > 0 && ratio <= 2.2; // ID cards ~1.58, passport page ~1.4
    add('Aspect ratio plausible for an ID', plausible, `Ratio ${ratio}:1`);
    if (!plausible) flags.push('The image proportions do not look like an ID card or passport page (it may be a screenshot or a full-page photo).');
  } else {
    add('Image header readable', false, 'Could not read image dimensions');
  }
  if (file.size < 40 * 1024) {
    add('File size plausible', false, `${Math.round(file.size / 1024)} KB`);
    flags.push('The file is very small for a photo of an ID — it may be a placeholder or a screenshot.');
  } else {
    add('File size plausible', true, `${Math.round(file.size / 1024)} KB`);
  }

  flags.push('Photo IDs cannot be name-matched automatically — please confirm the name and passport number against the sender details by eye.');
  return { verdict: VERDICTS.NEEDS_REVIEW, checks, flags, method: 'image-structural' };
}

module.exports = { verifyIdDocument, VERDICTS, extractPdfText, findMrz, imageSize };
