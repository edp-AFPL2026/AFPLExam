/**
 * End-to-end smoke test (no Firebase needed):  npm test
 * Walks through: admin setup -> student registers -> 3 mocks -> waits for start -> exam -> auto-submit -> publish result
 */
process.env.USE_MEMORY_DB = '1';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'Passw0rd!123';

const assert = require('assert');
const { db } = require('../src/firebase');
const { seed } = require('../seed');
const { app } = require('../server');
const { sweepExpired, GRACE_MS } = require('../src/services/attempts');

let base;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, { token, json, form } = {}) {
  const headers = {};
  let body;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  if (form) body = form;
  const res = await fetch(base + url, { method, headers, body });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

function pdfForm(fields) {
  const f = new FormData();
  Object.entries(fields).forEach(([k, v]) => f.append(k, v));
  f.append('resume', new Blob(['%PDF-1.4 fake resume'], { type: 'application/pdf' }), 'resume.pdf');
  return f;
}

(async () => {
  const server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  const ok = (m) => console.log(`  ok  ${m}`);

  await seed({ withSamples: true });

  // ---- admin
  const login = await api('POST', '/api/admin/login', { json: { email: 'admin@test.com', password: 'Passw0rd!123' } });
  assert.strictEqual(login.status, 200);
  const A = login.data.token;
  assert.strictEqual((await api('POST', '/api/admin/login', { json: { email: 'admin@test.com', password: 'bad' } })).status, 401);
  assert.strictEqual((await api('GET', '/api/admin/dashboard')).status, 401);
  ok('admin login + protection');

  // marking: both, +2 / -1 ; exam starts shortly, 1 minute long
  let cfg = await api('PUT', '/api/admin/exam-config', {
    token: A,
    json: { markingType: 'both', positiveMarks: 2, negativeMarks: 1, gradeGreatFrom: 4, gradeVeryGoodFrom: 8, gradeExcellentFrom: 12, shortlistFromMarks: 8, durationMinutes: 1, startTime: new Date(Date.now() + 3000).toISOString() },
  });
  assert.strictEqual(cfg.status, 200, JSON.stringify(cfg.data));
  assert.strictEqual(cfg.data.examName, 'Internship Aptitude Test');
  ok('exam config saved');

  // CSV upload
  const csv = 'question,optionA,optionB,optionC,optionD,correct,explanation\nCapital of India?,Mumbai,Delhi,Pune,Chennai,B,New Delhi\nBad row,X,,,,Z,\n';
  const f = new FormData();
  f.append('file', new Blob([csv], { type: 'text/csv' }), 'q.csv');
  f.append('set', 'mock1');
  const bad = await api('POST', '/api/admin/questions/upload', { token: A, form: f });
  assert.strictEqual(bad.status, 400);
  const f2 = new FormData();
  f2.append('file', new Blob([csv.split('\n').slice(0, 2).join('\n')], { type: 'text/csv' }), 'q.csv');
  f2.append('set', 'mock1');
  const good = await api('POST', '/api/admin/questions/upload', { token: A, form: f2 });
  assert.strictEqual(good.status, 201, JSON.stringify(good.data));
  ok('CSV upload validates rows and stores questions');

  const colleges = (await api('GET', '/api/admin/colleges', { token: A })).data;
  const places = (await api('GET', '/api/admin/places', { token: A })).data;
  assert.ok(colleges.length >= 2 && places.length >= 2);

  // ---- landing + registration
  const landing = await api('GET', '/api/public/landing');
  assert.strictEqual(landing.data.company.name, 'Aakar Foundry Pvt. Ltd.');
  assert.ok(landing.data.exam.rules.length > 0);
  ok('landing page data');

  const fields = { name: 'Rahul Patil', email: 'Rahul@Example.com', contact: '9876543210', collegeId: colleges[0].id, branch: 'Mechanical Engineering', testFor: 'Production Engineering Intern', placeId: places[0].id };
  const reg = await api('POST', '/api/student/register', { form: pdfForm(fields) });
  assert.strictEqual(reg.status, 201, JSON.stringify(reg.data));
  assert.strictEqual((await api('POST', '/api/student/register', { form: pdfForm(fields) })).status, 409);
  const S = reg.data.token;
  const relogin = await api('POST', '/api/student/login', { json: { email: 'rahul@example.com', contact: '+91 98765 43210' } });
  assert.strictEqual(relogin.status, 200);
  ok('registration (duplicate blocked, re-login works)');

  // ---- mocks
  let st = (await api('GET', '/api/student/status', { token: S })).data;
  assert.strictEqual(st.state, 'mocks_pending');
  assert.strictEqual(st.mocksRemaining, 3);
  for (let n = 1; n <= 3; n += 1) {
    const qs = await api('GET', `/api/student/mocks/${n}/questions`, { token: S });
    assert.strictEqual(qs.status, 200);
    assert.ok(!JSON.stringify(qs.data).includes('correctIndex'), 'correct answers leaked');
    const answers = {};
    // answer only the first question, deliberately wrong (index 3 is wrong for every sample question except one)
    answers[qs.data.questions[0].id] = 0;
    const sub = await api('POST', `/api/student/mocks/${n}/submit`, { token: S, json: { answers } });
    assert.strictEqual(sub.status, 200, JSON.stringify(sub.data));
    assert.strictEqual(sub.data.review.length, 1, 'review must list only attempted questions');
    assert.strictEqual(sub.data.attempted, 1);
  }
  assert.strictEqual((await api('POST', '/api/student/mocks/1/submit', { token: S, json: { answers: {} } })).status, 409);
  ok('3 mocks: review lists attempted questions only, no resubmit');

  // ---- waiting room
  st = (await api('GET', '/api/student/status', { token: S })).data;
  assert.strictEqual(st.state, 'waiting');
  assert.ok(st.msToStart > 0 && st.msToStart <= 3000);
  const early = await api('POST', '/api/student/exam/start', { token: S });
  assert.strictEqual(early.status, 403);
  ok('countdown / cannot start early');

  await sleep(st.msToStart + 200);
  st = (await api('GET', '/api/student/status', { token: S })).data;
  assert.strictEqual(st.state, 'ready');

  // ---- exam
  const start = await api('POST', '/api/student/exam/start', { token: S });
  assert.strictEqual(start.status, 200, JSON.stringify(start.data));
  assert.ok(!JSON.stringify(start.data).includes('correctIndex'));
  assert.strictEqual(start.data.total, 5);
  const q = start.data.questions;
  // sample exam answers: correct = [2,2,1,3,1]. Answer q0 right, q1 wrong, q2 right, leave q3,q4 blank
  const save = await api('PUT', '/api/student/exam/answers', { token: S, json: { answers: { [q[0].id]: 2, [q[1].id]: 0 } } });
  assert.strictEqual(save.data.saved, true);
  ok('exam started, questions hide answers, autosave works');

  // ---- tab switch: warning counted, all answers cleared, stale saves ignored, retries not double-counted
  const v1 = await api('POST', '/api/student/exam/violation', { token: S, json: { seq: 1 } });
  assert.strictEqual(v1.data.tabSwitches, 1);
  assert.strictEqual(v1.data.clear, true);
  assert.deepStrictEqual((await db.collection('attempts').doc(reg.data.student.id).get()).data().answers, {});
  const vRetry = await api('POST', '/api/student/exam/violation', { token: S, json: { seq: 1 } });
  assert.strictEqual(vRetry.data.tabSwitches, 1, 'same seq must not count twice');
  await api('PUT', '/api/student/exam/answers', { token: S, json: { answers: { [q[0].id]: 2 }, epoch: 0 } });
  assert.deepStrictEqual((await db.collection('attempts').doc(reg.data.student.id).get()).data().answers, {}, 'stale save must not bring answers back');
  const restart = await api('POST', '/api/student/exam/start', { token: S });
  assert.strictEqual(restart.data.tabSwitches, 1);
  await api('PUT', '/api/student/exam/answers', { token: S, json: { answers: { [q[0].id]: 2, [q[1].id]: 0 }, epoch: 1 } });
  assert.strictEqual(Object.keys((await db.collection('attempts').doc(reg.data.student.id).get()).data().answers).length, 2);
  ok('tab switch: counted once, answers cleared, stale save ignored');

  // random order: stored per student, same on every reload, same set of questions
  const again = await api('POST', '/api/student/exam/start', { token: S });
  assert.deepStrictEqual(again.data.questions.map((x) => x.id), restart.data.questions.map((x) => x.id), 'order stays the same on reload');
  assert.deepStrictEqual(again.data.questions.map((x) => x.id).sort(), q.map((x) => x.id).sort(), 'same questions, only the order differs');
  const storedOrder = (await db.collection('attempts').doc(reg.data.student.id).get()).data().order;
  assert.ok(Array.isArray(storedOrder) && storedOrder.length === q.length, 'order saved on the attempt');
  ok('live exam: question order is stored per student and stable on reload');

  // Simulate the student closing the browser: the server must auto-submit after the timer ends (+grace)
  const aRef = db.collection('attempts').doc(reg.data.student.id);
  await aRef.update({ endsAt: Date.now() - GRACE_MS - 1000 });
  assert.strictEqual(await sweepExpired(), 1);
  const after = (await aRef.get()).data();
  assert.strictEqual(after.status, 'submitted');
  assert.strictEqual(after.autoSubmitted, true);
  assert.strictEqual(after.attempted, 2);
  assert.strictEqual(after.score, 2 * 1 - 1); // +2 for the correct answer, -1 for the wrong one  -> 1
  ok('auto-submit grades only the attempted questions (+2 / -1 => score 1)');

  const sub2 = await api('POST', '/api/student/exam/submit', { token: S, json: {} });
  assert.strictEqual(sub2.data.submitted, true);
  assert.ok(!('score' in sub2.data), 'score must not be shown after the exam');
  assert.strictEqual((await api('GET', '/api/student/result', { token: S })).data.published, false);
  ok('result hidden until published');

  // ---- admin dashboard + publish
  const dash = (await api('GET', '/api/admin/dashboard', { token: A })).data;
  assert.strictEqual(dash.totals.registered, 1);
  assert.strictEqual(dash.totals.submitted, 1);
  assert.strictEqual(dash.totals.pending, 0);
  const row = dash.collegeWise.find((c) => c.name === colleges[0].name);
  assert.strictEqual(row.registered, 1);
  assert.strictEqual(row.submitted, 1);
  const other = dash.collegeWise.find((c) => c.name === colleges[1].name);
  assert.strictEqual(other.registered, 0);
  ok('dashboard college-wise numbers');

  await api('PUT', '/api/admin/exam-config', { token: A, json: { shortlistMessage: 'Congrats, shortlisted!', rejectMessage: 'Sorry, not shortlisted.' } });
  const pub = await api('POST', '/api/admin/results/publish', { token: A, json: {} });
  assert.strictEqual(pub.status, 200, JSON.stringify(pub.data));
  assert.strictEqual(pub.data.rejected, 1); // score 1 is below the shortlist limit of 8
  const res1 = (await api('GET', '/api/student/result', { token: S })).data;
  assert.strictEqual(res1.published, true);
  assert.strictEqual(res1.status, 'rejected');
  assert.strictEqual(res1.score, 1);
  assert.strictEqual(res1.grade, 'Fail'); // below 4
  assert.strictEqual(res1.percentage, Math.round((1 / res1.maxMarks) * 10000) / 100);
  assert.strictEqual(res1.message, 'Sorry, not shortlisted.');

  await api('PATCH', `/api/admin/students/${reg.data.student.id}/decision`, { token: A, json: { decision: 'shortlisted' } });
  const res2 = (await api('GET', '/api/student/result', { token: S })).data;
  assert.strictEqual(res2.status, 'shortlisted');
  assert.strictEqual(res2.message, 'Congrats, shortlisted!');
  ok('publish result + shortlist/reject messages + manual override');

  const csvOut = await api('GET', '/api/admin/results/export', { token: A });
  assert.ok(csvOut.data.includes('Rahul Patil'));
  const list = (await api('GET', '/api/admin/students?status=submitted', { token: A })).data;
  assert.strictEqual(list.total, 1);
  ok('CSV export + student list filters');

  // ---- grades, percentage, optional resume, limits validation
  const { gradeOf, autoStatusOf, percentageOf } = require('../src/utils/result');
  const limits = { gradeGreatFrom: 15, gradeVeryGoodFrom: 21, gradeExcellentFrom: 26, shortlistFromMarks: 21 };
  const expect = [[0, 'Fail', 'rejected'], [14, 'Fail', 'rejected'], [15, 'Great', 'rejected'], [20, 'Great', 'rejected'], [21, 'Very Good', 'shortlisted'], [25, 'Very Good', 'shortlisted'], [26, 'Excellent', 'shortlisted'], [30, 'Excellent', 'shortlisted']];
  for (const [score, grade, status] of expect) {
    assert.strictEqual(gradeOf(score, limits), grade, `grade of ${score}`);
    assert.strictEqual(autoStatusOf(score, limits), status, `status of ${score}`);
  }
  assert.strictEqual(percentageOf(15, 30), 50);
  const badLimits = await api('PUT', '/api/admin/exam-config', { token: A, json: { gradeGreatFrom: 20, gradeVeryGoodFrom: 10, gradeExcellentFrom: 26 } });
  assert.strictEqual(badLimits.status, 400);
  ok('grades: 15-20 Great, 21-25 Very Good, 26-30 Excellent, below 15 Fail; 15 of 30 = 50%');

  const noResume = await api('POST', '/api/student/register', { form: (() => { const x = new FormData(); Object.entries({ ...fields, email: 'noresume@example.com', name: 'No Resume' }).forEach(([k, v]) => x.append(k, v)); return x; })() });
  assert.strictEqual(noResume.status, 201, JSON.stringify(noResume.data));
  const nr = (await api('GET', `/api/admin/students/${noResume.data.student.id}`, { token: A })).data;
  assert.strictEqual(nr.resumeUrl, null);
  const rr = (await api('GET', '/api/admin/results', { token: A })).data.results[0];
  assert.ok('grade' in rr && 'percentage' in rr && 'autoStatus' in rr && 'status' in rr);
  ok('resume is optional; admin results carry grade, percentage and status');

  // ---- results stay hidden for exams submitted AFTER a publish, until the admin publishes again
  const late = noResume.data;
  const lateS = late.token;
  await db.collection('attempts').doc(late.student.id).set({ status: 'submitted', score: 9, maxMarks: 30, correct: 9, wrong: 0, attempted: 9, totalQuestions: 30, submittedAt: Date.now(), startedAt: Date.now(), endsAt: Date.now(), answers: {}, marking: { markingType: 'both', positiveMarks: 1, negativeMarks: 1 } });
  const hidden = (await api('GET', '/api/student/result', { token: lateS })).data;
  assert.strictEqual(hidden.published, false, 'a result submitted after the last publish must stay hidden');
  assert.strictEqual((await api('GET', '/api/student/status', { token: lateS })).data.resultPublished, false);
  const resRows = (await api('GET', '/api/admin/results', { token: A })).data;
  assert.strictEqual(resRows.waitingForPublish, 1);
  await api('PATCH', `/api/admin/students/${late.student.id}/decision`, { token: A, json: { decision: 'shortlisted' } });
  assert.strictEqual((await api('GET', '/api/student/result', { token: lateS })).data.published, false, 'changing status must not publish');
  await api('POST', '/api/admin/results/publish', { token: A, json: { force: true } });
  const shown = (await api('GET', '/api/student/result', { token: lateS })).data;
  assert.strictEqual(shown.published, true);
  assert.strictEqual(shown.status, 'shortlisted');
  ok('result appears only after the admin publishes it for that student');

  // ---- delete a student record
  const del = await api('DELETE', `/api/admin/students/${late.student.id}`, { token: A });
  assert.strictEqual(del.status, 200);
  assert.strictEqual((await api('GET', `/api/admin/students/${late.student.id}`, { token: A })).status, 404);
  assert.strictEqual((await db.collection('attempts').doc(late.student.id).get()).exists, false);
  assert.strictEqual((await api('DELETE', `/api/admin/students/${late.student.id}`, { token: A })).status, 404);
  ok('admin can delete a student record (details + exam attempt)');

  console.log('\nAll checks passed.');
  server.close();
  process.exit(0);
})().catch((e) => {
  console.error('\nTEST FAILED:', e);
  process.exit(1);
});
