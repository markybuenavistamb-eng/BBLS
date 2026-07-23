// Vercel serverless entry: the Express app is required (not started) and exported as the handler.
// All routing/static/API lives in ../server.js; app.listen only runs when server.js is the main module.
module.exports = require('../server.js');
