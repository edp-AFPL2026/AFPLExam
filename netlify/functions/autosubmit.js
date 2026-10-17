// Scheduled function (every minute, see netlify.toml): auto-submits attempts whose timer has ended.
const { sweepExpired } = require('../../src/services/attempts');

exports.handler = async () => {
  try {
    const count = await sweepExpired();
    if (count) console.log(`Auto-submitted ${count} exam attempt(s)`);
    return { statusCode: 200, body: JSON.stringify({ autoSubmitted: count }) };
  } catch (e) {
    console.error('Auto-submit failed:', e);
    return { statusCode: 500, body: 'failed' };
  }
};
