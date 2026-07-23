const crypto = require('crypto');

function hashPassword(pw) {
  const salt = crypto.randomBytes(8).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 32).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(pw, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

module.exports = { hashPassword, verifyPassword };
