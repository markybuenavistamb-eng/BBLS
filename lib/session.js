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
  return sign({ uid: userId, exp: Date.now() + MAX_AGE_MS });
}

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
const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: MAX_AGE_MS, path: '/' };

module.exports = { sign, verify, tokenFor, parseCookies, COOKIE_NAME, cookieOptions };
