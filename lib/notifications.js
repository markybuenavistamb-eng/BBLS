// SMS notifications: template rendering, DB-backed queue, provider abstraction, polling worker.
const db = require('./db');

// ---------- providers ----------
class ConsoleSmsProvider {
  async send(phone, message) {
    console.log(`[SMS→${phone}] ${message}`);
    return { ok: true, provider: 'console' };
  }
}

class SemaphoreSmsProvider {
  constructor(apiKey, senderName) {
    this.apiKey = apiKey;
    this.senderName = senderName || 'VFIC';
  }
  async send(phone, message) {
    const res = await fetch('https://api.semaphore.co/api/v4/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apikey: this.apiKey, number: phone, message, sendername: this.senderName })
    });
    if (!res.ok) throw new Error(`Semaphore HTTP ${res.status}: ${await res.text()}`);
    return { ok: true, provider: 'semaphore' };
  }
}

function getProvider() {
  if (process.env.SMS_PROVIDER === 'semaphore') {
    if (!process.env.SEMAPHORE_API_KEY) throw new Error('SMS_PROVIDER=semaphore requires SEMAPHORE_API_KEY');
    return new SemaphoreSmsProvider(process.env.SEMAPHORE_API_KEY, process.env.SEMAPHORE_SENDER_NAME);
  }
  return new ConsoleSmsProvider();
}

// ---------- default templates (editable by admin, stored in settings.smsTemplates) ----------
const DEFAULT_TEMPLATES = {
  RECEIVED_ORIGIN: {
    recipients: ['SENDER'],
    body: 'VFIC: We received your box {box_number}. Track it anytime: {link}'
  },
  ARRIVED_PORT: {
    recipients: ['RECEIVER'],
    body: 'VFIC: Box {box_number} from {sender_first_name} has arrived in the Philippines! We will text you again once it is out for delivery. Track: {link}'
  },
  OUT_FOR_DELIVERY: {
    recipients: ['RECEIVER'],
    body: 'VFIC: Box {box_number} is out for delivery today. Driver: {driver_name} {driver_contact}. Please keep your phone open. Track: {link}'
  },
  DELIVERED: {
    recipients: ['SENDER', 'RECEIVER'],
    body: 'VFIC: Box {box_number} was delivered and received by {received_by_name}. Salamat po for trusting VFIC!'
  },
  RETURNED: {
    recipients: ['RECEIVER'],
    body: 'VFIC: We attempted to deliver box {box_number} today but {reason}. Please contact us at {vfic_phone} to reschedule.'
  }
};

const REASON_TEXT = {
  UNREACHABLE: 'we could not reach you by phone',
  ADDRESS_NOT_FOUND: 'we could not find the address',
  RECEIVER_ABSENT: 'no one was available to receive it',
  REFUSED: 'delivery was refused',
  OTHER: 'delivery was not possible'
};

function renderTemplate(body, vars) {
  return body.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

function templateVars(d, box, extra = {}) {
  const shipment = d.shipments.find(s => s.id === box.shipment_id) || {};
  const sender = d.customers.find(c => c.id === shipment.sender_id) || {};
  const receiver = d.customers.find(c => c.id === box.receiver_id) || {};
  const trip = box.trucking_assignment_id ? d.trips.find(t => t.id === box.trucking_assignment_id) : null;
  const base = process.env.PUBLIC_BASE_URL || d.settings.publicBaseUrl || 'http://localhost:3000';
  return {
    box_number: box.box_number,
    link: `${base}/track.html?t=${box.qr_token}`,
    sender_first_name: (sender.full_name || '').split(' ')[0],
    receiver_first_name: (receiver.full_name || '').split(' ')[0],
    driver_name: trip ? trip.driver_name : '',
    driver_contact: trip ? trip.driver_contact : '',
    vfic_phone: d.settings.supportPhone,
    ...extra
  };
}

// Queue notifications for a box status trigger. Returns queued rows.
function queueForTrigger(box, triggerKey, extraVars = {}) {
  const d = db.get();
  const templates = { ...DEFAULT_TEMPLATES, ...(d.settings.smsTemplates || {}) };
  const tpl = templates[triggerKey];
  if (!tpl) return [];
  const shipment = d.shipments.find(s => s.id === box.shipment_id) || {};
  const sender = d.customers.find(c => c.id === shipment.sender_id);
  const receiver = d.customers.find(c => c.id === box.receiver_id);
  const vars = templateVars(d, box, extraVars);
  const queued = [];
  for (const role of tpl.recipients) {
    const person = role === 'SENDER' ? sender : receiver;
    if (!person || !person.phone_primary) continue;
    const n = {
      id: db.nextId('notification'),
      box_id: box.id,
      recipient_phone: person.phone_primary,
      recipient_role: role,
      template_key: triggerKey,
      message_body: renderTemplate(tpl.body, vars),
      status: 'QUEUED',
      attempts: 0,
      last_error: null,
      sent_at: null,
      created_at: new Date().toISOString()
    };
    d.notifications.push(n);
    queued.push(n);
  }
  return queued; // caller persists
}

// ---------- queue processing: send QUEUED notifications, up to 3 attempts ----------
// Operates on the in-memory doc and marks it dirty via db.persist(). It does NOT load or
// flush — callers do that (a request handler via res.json, or the local worker below).
// Returns { processed, sent, failed }.
async function processOnce() {
  const provider = getProvider();
  const d = db.get();
  const pending = d.notifications.filter(n => n.status === 'QUEUED' && n.attempts < 3);
  let sent = 0, failed = 0;
  for (const n of pending) {
    n.attempts += 1;
    try {
      await provider.send(n.recipient_phone, n.message_body);
      n.status = 'SENT';
      n.sent_at = new Date().toISOString();
      sent += 1;
    } catch (err) {
      n.last_error = String(err.message || err);
      if (n.attempts >= 3) { n.status = 'FAILED'; failed += 1; }
    }
  }
  if (pending.length) db.persist();
  return { processed: pending.length, sent, failed };
}

// Local (non-serverless) polling worker. On Vercel this is replaced by a Cron hitting
// /api/cron/process-notifications. Loads + flushes around each tick since there is no request.
let workerTimer = null;
function startWorker(intervalMs = 4000) {
  workerTimer = setInterval(async () => {
    try {
      await db.load();
      const r = await processOnce();
      if (r.processed) await db.flush();
    } catch (e) { /* transient; retried next tick */ }
  }, intervalMs);
  workerTimer.unref();
}

module.exports = { queueForTrigger, processOnce, startWorker, DEFAULT_TEMPLATES, REASON_TEXT, renderTemplate, templateVars };
