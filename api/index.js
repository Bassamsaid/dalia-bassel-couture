// Vercel hands a function the same (req, res) that Node's http server does, so
// the app's own handler is the function — no adapter, no second router.
module.exports = require('../dbbackend/server.js');
