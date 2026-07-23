// Deletes data/db.json so the server re-seeds demo data on next start.
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'data', 'db.json');
if (fs.existsSync(file)) {
  fs.unlinkSync(file);
  console.log('Demo database reset. It will be re-seeded on next server start.');
} else {
  console.log('No database file found; nothing to reset.');
}
