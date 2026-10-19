/**
 * Calls the Netlify function handler directly with Lambda-style events (no network, no Firebase).
 *   npm run test:netlify
 */
process.env.USE_MEMORY_DB = '1';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'Passw0rd!123';

const assert = require('assert');
const { seed } = require('../seed');
const { handler } = require('../netlify/functions/api');
const auto = require('../netlify/functions/autosubmit');

function event(method, path, { json, headers = {}, rawBody, base64 = false } = {}) {
  const h = { host: 'example.netlify.app', ...headers };
  let body = rawBody || null;
  if (json) {
    h['content-type'] = 'application/json';
    body = JSON.stringify(json);
  }
  return { path, httpMethod: method, headers: h, queryStringParameters: {}, body, isBase64Encoded: base64 };
}

async function call(method, path, opts) {
  const res = await handler(event(method, path, opts), {});
  let data = res.body;
  try {
    data = JSON.parse(res.body);
  } catch (e) {
    /* not json */
  }
  return { status: res.statusCode, data };
}

function multipart(fields, file) {
  const boundary = '----testboundary123';
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
  }
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="resume"; filename="cv.pdf"\r\nContent-Type: application/pdf\r\n\r\n`);
  const buf = Buffer.concat([Buffer.from(parts.join('')), file, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return { rawBody: buf.toString('base64'), base64: true, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

(async () => {
  await seed({ withSamples: true });

  // both URL shapes Netlify can send
  assert.strictEqual((await call('GET', '/api/health')).data.ok, true);
  assert.strictEqual((await call('GET', '/.netlify/functions/api/health')).data.ok, true);
  console.log('  ok  /api/health works for original and rewritten paths');

  const landing = await call('GET', '/api/public/landing');
  assert.strictEqual(landing.status, 200);
  const { colleges, places } = landing.data.form;

  // admin login through the handler
  const login = await call('POST', '/api/admin/login', { json: { email: 'admin@test.com', password: 'Passw0rd!123' } });
  assert.strictEqual(login.status, 200);
  console.log('  ok  admin login via function');

  // multipart resume upload (base64 body like Netlify sends it)
  const branchList = (await call('GET', '/api/public/landing')).data.form.branches;
  const fields = { rollNumber: 'PE-7', name: 'Asha Kulkarni', email: 'asha@example.com', contact: '9123456780', collegeId: colleges[0].id, branchId: branchList[0].id, testFor: 'Quality Engineering Intern', placeId: places[0].id };
  const reg = await call('POST', '/api/student/register', multipart(fields, Buffer.from('%PDF-1.4 test resume content')));
  assert.strictEqual(reg.status, 201, JSON.stringify(reg.data));
  assert.ok(reg.data.token);
  console.log('  ok  multipart resume upload via function (stored in Drive stub)');

  const st = await call('GET', '/api/student/status', { headers: { authorization: `Bearer ${reg.data.token}` } });
  assert.strictEqual(st.status, 200);
  assert.strictEqual(st.data.state, 'not_scheduled');

  const list = await call('GET', '/api/admin/students', { headers: { authorization: `Bearer ${login.data.token}` } });
  assert.strictEqual(list.data.total, 1);
  assert.ok(list.data.students[0].resumeUrl.includes('drive.google.com'));
  console.log('  ok  admin sees student with Google Drive resume link');

  const a = await auto.handler();
  assert.strictEqual(a.statusCode, 200);
  console.log('  ok  scheduled auto-submit function runs');

  // start time without a zone is read as India time
  const put = await call('PUT', '/api/admin/exam-config', { json: { startTime: '2026-10-20T10:15' }, headers: { authorization: `Bearer ${login.data.token}` } });
  assert.strictEqual(new Date(put.data.startTime).toISOString(), '2026-10-20T04:45:00.000Z');
  console.log('  ok  "2026-10-20T10:15" is stored as 10:15 AM India time');

  console.log('\nNetlify handler checks passed.');
  process.exit(0);
})().catch((e) => {
  console.error('\nTEST FAILED:', e);
  process.exit(1);
});
