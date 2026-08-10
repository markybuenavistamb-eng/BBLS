// Loads .env into process.env for local runs.
//
// The repo ships a .env.example and .gitignore keeps .env out of git, but nothing was
// reading the file — so a local Supabase setup would look configured and silently fall back
// to the filesystem. This closes that gap with no new dependency.
//
// On Vercel the platform injects the variables itself, so this is a no-op there.
// Values already present in the environment always win: a real env var beats the file.
const fs = require('fs');
const path = require('path');

function parse(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    // Strip one layer of matching quotes; unquoted values keep everything up to a # comment.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

function load(file) {
  const target = file || path.join(__dirname, '..', '.env');
  if (!fs.existsSync(target)) return { loaded: false, file: target, keys: [] };
  const vars = parse(fs.readFileSync(target, 'utf8'));
  const keys = [];
  for (const [k, v] of Object.entries(vars)) {
    if (process.env[k] === undefined) { process.env[k] = v; keys.push(k); }
  }
  return { loaded: true, file: target, keys };
}

module.exports = { load, parse };
