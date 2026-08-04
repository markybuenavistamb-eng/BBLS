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

function tokenFor(userId) {
  return sign({ uid: userId, aud: 'staff', exp: Date.now() + MAX_AGE_MS });
}

// Sender (customer) sessions are a separate audience on a separate cookie, so a sender
// token can never be presented as a staff token — and vice versa.
function senderTokenFor(senderId) {
  return sign({ sid: senderId, aud: 'sender', exp: Date.now() + MAX_AGE_MS });
}
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
const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: MAX_AGE_MS, path: '/' };

module.exports = {
  sign, verify, tokenFor, senderTokenFor, isStaffToken, isSenderToken,
  parseCookies, COOKIE_NAME, SENDER_COOKIE_NAME, cookieOptions
};
