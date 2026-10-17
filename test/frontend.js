/**
 * Frontend smoke test: opens the real pages in jsdom (a simulated browser), clicks through them and
 * checks that nothing throws.   npm run test:frontend
 */
process.env.USE_MEMORY_DB = '1';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'Passw0rd!123';

const assert = require('assert');
const { JSDOM, requestInterceptor, VirtualConsole } = require('jsdom');
const { db } = require('../src/firebase');
const { seed } = require('../seed');
const { app } = require('../server');

let base;
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, { token, json, form } = {}) {
  const headers = {};
  let body;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(base + url, { method, headers, body });
  return { status: res.status, data: await res.json().catch(() => null) };
}

// No Google Fonts and no CSS needed in this test: answer those requests with an empty stylesheet
const localOnly = requestInterceptor((request) => {
  if (!request.url.startsWith(base) || request.url.endsWith('.css')) {
    return new Response('', { status: 200, headers: { 'Content-Type': 'text/css' } });
  }
  return undefined;
});

async function openPage(path, { token, adminToken } = {}) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}`));
  vc.on('error', (...a) => errors.push(`console.error: ${a.join(' ')}`));
  const dom = await JSDOM.fromURL(base + path, {
    runScripts: 'dangerously',
    resources: { interceptors: [localOnly] },
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u, o) => fetch(new URL(u, base), o);
      w.scrollTo = () => {};
      if (token) w.sessionStorage.setItem('af_token', token);
      if (adminToken) w.sessionStorage.setItem('af_admin_token', adminToken);
    },
  });
  return dom.window;
}

async function waitFor(win, selector, timeout = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const el = win.document.querySelector(selector);
    if (el) return el;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${selector}. Page text: ${win.document.body.textContent.replace(/\s+/g, ' ').slice(0, 300)}`);
}
const click = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
const ok = (m) => console.log(`  ok  ${m}`);

(async () => {
  const server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  await seed({ withSamples: true });

  const login = await api('POST', '/api/admin/login', { json: { email: 'admin@test.com', password: 'Passw0rd!123' } });
  const A = login.data.token;
  const landingData = (await api('GET', '/api/public/landing')).data;
  const { colleges, places } = landingData.form;

  // ---------------- student landing page
  let w = await openPage('/');
  await waitFor(w, '#reg-form');
  const text = w.document.body.textContent;
  assert.ok(text.includes('Internship Aptitude Test'));
  assert.ok(text.includes('Aakar Foundry Pvt. Ltd.'));
  assert.ok(text.includes('Test instructions'));
  assert.ok(w.document.querySelectorAll('[role="tab"]').length === 3);
  assert.ok(text.includes('Student information'));
  assert.ok(w.document.querySelectorAll('#f-college option').length >= 3);
  assert.ok(w.document.querySelector('#btn-submit').textContent.includes('Start Aptitude Test'));
  // empty submit shows errors instead of calling the server
  w.document.querySelector('#reg-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(100);
  assert.ok(w.document.querySelectorAll('.field.invalid').length >= 5);
  ok('landing page shows company, rules, form and validates empty submit');

  // the contact field keeps only digits and never more than 10
  const phone = w.document.querySelector('#f-contact');
  for (const [typed, expected] of [['98765432101', '9876543210'], ['+91 98765 43210', '9876543210'], ['98a76-54', '987654'], ['0 98765 43210', '9876543210']]) {
    phone.value = typed;
    phone.dispatchEvent(new w.Event('input', { bubbles: true }));
    assert.strictEqual(phone.value, expected, `"${typed}" should become "${expected}"`);
  }
  assert.strictEqual(phone.getAttribute('maxlength'), '10');
  ok('contact field accepts only 10 digits');
  w.close();

  // ---------------- register a student by API, then use the student pages
  const fd = new FormData();
  Object.entries({ name: 'Rahul <b>Patil</b>', email: 'rahul@example.com', contact: '9876543210', collegeId: colleges[0].id, branch: 'Mechanical', testFor: 'Production Engineering Intern', placeId: places[0].id }).forEach(([k, v]) => fd.append(k, v));
  fd.append('resume', new Blob(['%PDF-1.4 x'], { type: 'application/pdf' }), 'cv.pdf');
  const reg = await api('POST', '/api/student/register', { form: fd });
  assert.strictEqual(reg.status, 201, JSON.stringify(reg.data));
  const S = reg.data.token;

  w = await openPage('/', { token: S });
  await waitFor(w, '.mock-list');
  assert.strictEqual(w.document.querySelectorAll('[data-mock-start]').length, 3);
  assert.ok(!w.document.body.innerHTML.includes('<b>Patil</b>'), 'student name must be escaped');
  ok('hub shows 3 mock tests, user text is escaped');

  // mock test via the UI
  click(w, w.document.querySelector('[data-mock-start="1"]'));
  await waitFor(w, '.opt');
  click(w, w.document.querySelector('.opt'));
  Object.defineProperty(w.document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  Object.defineProperty(w.document, 'visibilityState', { configurable: true, get: () => 'visible' });
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await waitFor(w, '.modal [data-ok]');
  assert.ok(w.document.querySelector('.modal').textContent.includes('left the mock test'));
  assert.ok(!w.document.querySelector('.opt[aria-checked="true"]'), 'mock answers cleared on tab switch');
  click(w, w.document.querySelector('.modal [data-ok]'));
  click(w, w.document.querySelector('.opt'));
  click(w, w.document.querySelector('#q-submit'));
  await waitFor(w, '[data-yes]');
  click(w, w.document.querySelector('[data-yes]'));
  await waitFor(w, '.rv');
  assert.ok(w.document.body.textContent.includes('Mock test 1 result'));
  assert.strictEqual(w.document.querySelectorAll('.rv').length, 1, 'review lists only attempted questions');
  ok('mock test: answer, submit, review of attempted question');
  w.close();

  // finish the other mocks by API, schedule the exam to have started 1 s ago
  for (const n of [2, 3]) await api('POST', `/api/student/mocks/${n}/submit`, { token: S, json: { answers: {} } });
  await api('PUT', '/api/admin/exam-config', { token: A, json: { startTime: new Date(Date.now() - 1000).toISOString(), durationMinutes: 30, markingType: 'both', positiveMarks: 2, negativeMarks: 1, gradeGreatFrom: 1, gradeVeryGoodFrom: 2, gradeExcellentFrom: 3, shortlistFromMarks: 2 } });

  w = await openPage('/', { token: S });
  await waitFor(w, '#btn-start-exam');
  click(w, w.document.querySelector('#btn-start-exam'));
  await waitFor(w, '#timer');
  await waitFor(w, '.opt');
  assert.ok(/\d{2}:\d{2}/.test(w.document.querySelector('#timer').textContent), 'timer shows time left');
  click(w, w.document.querySelectorAll('.opt')[2]);
  await sleep(200);
  assert.ok(w.document.querySelector('.opt.sel, .opt.selected, .opt[aria-checked="true"], .opt.on'), 'an answer is selected');
  // student switches tab: page becomes hidden
  Object.defineProperty(w.document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await sleep(300);
  Object.defineProperty(w.document, 'visibilityState', { configurable: true, get: () => 'visible' });
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await waitFor(w, '.modal [data-ok]');
  assert.ok(w.document.querySelector('.modal').textContent.includes('All the answers you selected have been cleared'));
  assert.ok(!w.document.querySelector('.opt.sel, .opt.selected, .opt[aria-checked="true"], .opt.on'), 'answers cleared');
  click(w, w.document.querySelector('.modal [data-ok]'));
  const t1 = Date.now();
  let att;
  while (Date.now() - t1 < 4000) {
    att = (await db.collection('attempts').doc(reg.data.student.id).get()).data();
    if (att.tabSwitches === 1) break;
    await sleep(100);
  }
  assert.strictEqual(att.tabSwitches, 1, 'server counted the tab switch');
  assert.deepStrictEqual(att.answers || {}, {});
  ok('tab switch: warning shown, answers cleared, server counted it');
  click(w, w.document.querySelectorAll('.opt')[2]);
  click(w, w.document.querySelector('#q-next'));
  click(w, w.document.querySelector('#q-submit'));
  await waitFor(w, '[data-yes]');
  click(w, w.document.querySelector('[data-yes]'));
  await waitFor(w, '#to-hub', 8000);
  assert.ok(w.document.body.textContent.includes('Your exam is submitted'));
  assert.ok(!/score/i.test(w.document.querySelector('#app').textContent), 'no score right after the exam');
  const attempt = (await db.collection('attempts').doc(reg.data.student.id).get()).data();
  assert.strictEqual(attempt.status, 'submitted');
  assert.strictEqual(attempt.attempted, 1);
  ok('exam: start, timer, answer, submit, no score shown');
  w.close();

  // ---------------- admin pages
  w = await openPage('/admin/');
  await waitFor(w, '#login');
  w.document.querySelector('#a-email').value = 'admin@test.com';
  w.document.querySelector('#a-pass').value = 'Passw0rd!123';
  w.document.querySelector('#login').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(w, '.stats');
  assert.ok(w.document.body.textContent.includes('College wise'));
  assert.ok(w.document.body.textContent.includes('Sample Engineering College'));
  ok('admin login and dashboard');

  for (const [hash, expected] of [['#/settings', 'Marking'], ['#/questions', 'Upload questions from a CSV file'], ['#/lists', 'Colleges (2)'], ['#/company', 'About the company'], ['#/students', 'Students (1)'], ['#/results', 'Publish results']]) {
    w.location.hash = hash;
    const t0 = Date.now();
    while (!w.document.querySelector('#main').textContent.includes(expected) && Date.now() - t0 < 6000) await sleep(50);
    assert.ok(w.document.querySelector('#main').textContent.includes(expected), `${hash} should show "${expected}"`);
  }
  assert.ok(w.document.querySelector('#main').textContent.includes('Rahul'), 'results table shows the student');
  ok('admin pages: settings, questions, colleges, company, students, results');

  assert.deepStrictEqual(errors, [], `Browser errors: ${errors.join(' | ')}`);
  console.log('\nFrontend checks passed.');
  server.close();
  process.exit(0);
})().catch((e) => {
  console.error('\nTEST FAILED:', e.message);
  if (errors.length) console.error('Browser errors:', errors);
  process.exit(1);
});
