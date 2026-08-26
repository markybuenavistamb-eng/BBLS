// Stateless signed-cookie sessions (HMAC-SHA256). Replaces express-session's
// in-memory store, which does not work across serverless invocations.
const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || 'vfic-demo-secret-change-me';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (p.exp && Date.now() > p.exp) return null;
  return p;
}

// `sid` names which sign-in this token belongs to. An account may only be open in one place at
// a time, so the server records the current sign-in against the user and refuses tokens from any
// other — without it, a stateless token could not be told apart from the one that replaced it.
function tokenFor(userId, sid) {
  return sign({ uid: userId, sid: sid || null, aud: 'staff', exp: Date.now() + MAX_AGE_MS });
}
const newSessionId = () => crypto.randomBytes(12).toString('base64url');

// Sender (customer) sessions are a separate audience on a separate cookie, so a sender
// token can never be presented as a staff token — and vice versa.
function senderTokenFor(senderId) {
  return sign({ sid: senderId, aud: 'sender', exp: Date.now() + MAX_AGE_MS });
}
// A driver holds a pass for one run, not an account. Its own audience means a pass can never
// be presented as a staff or sender token, and it carries the pass id so revoking the pass
// ends the session without waiting for the token to expire.
function driverTokenFor(passId, ttlMs) {
  return sign({ pid: passId, aud: 'driver', exp: Date.now() + (ttlMs || MAX_AGE_MS) });
}
const isDriverToken = (p) => !!p && p.aud === 'driver' && p.pid != null;

// Tokens minted before the audience claim existed are staff tokens.
const isStaffToken = (p) => !!p && (!p.aud || p.aud === 'staff') && p.uid != null;
const isSenderToken = (p) => !!p && p.aud === 'sender' && p.sid != null;

// Minimal cookie-header parser (avoids adding a dependency).
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const COOKIE_NAME = 'vfic_session';
const SENDER_COOKIE_NAME = 'vfic_sender';
const DRIVER_COOKIE_NAME = 'vfic_driver';
const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: MAX_AGE_MS, path: '/' };

module.exports = {
  sign, verify, tokenFor, newSessionId, senderTokenFor, isStaffToken, isSenderToken,
  parseCookies, COOKIE_NAME, SENDER_COOKIE_NAME, DRIVER_COOKIE_NAME, cookieOptions,
  driverTokenFor, isDriverToken
};
