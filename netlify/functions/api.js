// All /api/* requests land here (see netlify.toml). The Express app is wrapped with serverless-http.
const serverless = require('serverless-http');
const { app } = require('../../server');

const handle = serverless(app, { binary: ['multipart/form-data', 'application/pdf', 'application/octet-stream'] });

exports.handler = async (event, context) => {
  // The path can arrive as /api/... (original URL) or /.netlify/functions/api/... (rewritten URL).
  // Normalise both to /api/... which is what the Express routes expect.
  let p = event.path || '/';
  p = p.replace(/^\/\.netlify\/functions\/api/, '');
  if (!p.startsWith('/api')) p = `/api${p.startsWith('/') ? '' : '/'}${p}`;
  return handle({ ...event, path: p }, context);
};
