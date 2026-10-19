const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const normEmail = (e) => String(e || '').trim().toLowerCase();

const normPhone = (p) => String(p || '').replace(/\D/g, '').slice(-10);

// Student document id is derived from the e-mail so one e-mail = one student (no duplicate check races)
// Roll numbers compare ignoring case, spaces and dashes/slashes ("ab 12/3" == "AB123")
const normRoll = (r) => String(r || '').toUpperCase().replace(/[\s\-/._]/g, '');
const rollDocId = (r) => crypto.createHash('sha256').update(normRoll(r)).digest('hex').slice(0, 28);
const studentIdFromEmail = (email) => crypto.createHash('sha256').update(normEmail(email)).digest('hex').slice(0, 28);

async function commitInChunks(db, ops, size = 400) {
  for (let i = 0; i < ops.length; i += size) {
    const batch = db.batch();
    ops.slice(i, i + size).forEach((op) => op(batch));
    // eslint-disable-next-line no-await-in-loop
    await batch.commit();
  }
}

// CSV cell escaping + protection against spreadsheet formula injection
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}


// Client key for rate limiting. On Netlify the visitor IP arrives in this header.
const clientKey = (req) => String(req.headers['x-nf-client-connection-ip'] || req.headers['client-ip'] || req.ip || 'unknown');

module.exports = { clientKey, HttpError, asyncHandler, normEmail, normPhone, studentIdFromEmail, normRoll, rollDocId, commitInChunks, csvCell };
