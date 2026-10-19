/* Admin dashboard */
(function () {
  'use strict';
  const { $, $$, esc, api, toast, openModal, confirmModal, fmtDateTime, signed, letter } = AF;

  const root = $('#root');
  let token = sessionStorage.getItem('af_admin_token');
  let timers = [];
  const ui = { qset: 'exam', studentPage: 1, studentFilters: { q: '', collegeId: '', placeId: '', status: '' } };

  const NAV = [
    ['dashboard', 'Dashboard'],
    ['settings', 'Exam settings'],
    ['questions', 'Questions'],
    ['lists', 'Colleges and places'],
    ['company', 'Company'],
    ['students', 'Students'],
    ['results', 'Results'],
  ];

  function A(path, opts) {
    return api(path, { ...(opts || {}), token }).catch((e) => {
      if (e.status === 401 && token) logout('Your session ended. Log in again.');
      throw e;
    });
  }
  const clearTimers = () => { timers.forEach(clearInterval); timers = []; };

  function logout(msg) {
    sessionStorage.removeItem('af_admin_token');
    token = null;
    clearTimers();
    showLogin(msg);
  }

  // ---------------------------------------------------------------- login
  function showLogin(msg) {
    root.innerHTML = `
      <div class="admin-login">
        <form class="login-card" id="login" novalidate>
          <img src="/assets/aakar-logo.svg" alt="Aakar Foundry">
          <h1>Admin login</h1>
          ${msg ? `<div class="notice warn">${esc(msg)}</div>` : ''}
          <div class="field" style="margin-bottom:14px"><label for="a-email">Email</label><input id="a-email" type="email" autocomplete="username" required></div>
          <div class="field"><label for="a-pass">Password</label><input id="a-pass" type="password" autocomplete="current-password" required></div>
          <p id="a-err" style="color:var(--red-700);min-height:1.3em;margin:12px 0 0"></p>
          <button class="btn btn-primary btn-lg" style="width:100%;margin-top:8px" type="submit">Log in</button>
        </form>
      </div>`;
    $('#login').onsubmit = async (e) => {
      e.preventDefault();
      $('#a-err').textContent = '';
      try {
        const res = await api('/admin/login', { method: 'POST', json: { email: $('#a-email').value.trim(), password: $('#a-pass').value } });
        token = res.token;
        sessionStorage.setItem('af_admin_token', token);
        showShell();
      } catch (err) {
        $('#a-err').textContent = err.message;
      }
    };
  }

  // ---------------------------------------------------------------- shell + router
  function showShell() {
    root.innerHTML = `
      <div class="shell">
        <aside class="side">
          <a class="brand" href="#/dashboard"><img src="/assets/aakar-logo.svg" alt=""><span class="brand-name">Test admin</span></a>
          <nav id="nav">${NAV.map(([id, label]) => `<a href="#/${id}" data-view="${id}">${label}</a>`).join('')}</nav>
          <div class="side-foot">
            <a href="/" target="_blank" rel="noopener" style="color:#cfd8ea">Open student site</a><br>
            <button class="btn btn-ghost btn-sm" id="btn-pass" style="color:#fff;border-color:rgba(255,255,255,.35)">Change password</button>
            <button class="btn btn-ghost btn-sm" id="btn-out" style="color:#fff;border-color:rgba(255,255,255,.35)">Log out</button>
          </div>
        </aside>
        <main class="main" id="main"></main>
      </div>`;
    $('#btn-out').onclick = () => logout();
    $('#btn-pass').onclick = changePassword;
    window.removeEventListener('hashchange', route);
    window.addEventListener('hashchange', route);
    if (!location.hash) location.hash = '#/dashboard';
    else route();
  }

  const VIEWS = { dashboard: viewDashboard, settings: viewSettings, questions: viewQuestions, lists: viewLists, company: viewCompany, students: viewStudents, results: viewResults };

  async function route() {
    if (!token) return;
    clearTimers();
    const id = (location.hash.replace(/^#\//, '') || 'dashboard').split('?')[0];
    const name = VIEWS[id] ? id : 'dashboard';
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === name));
    const main = $('#main');
    main.innerHTML = '<div class="loading">Loading...</div>';
    try {
      await VIEWS[name](main);
    } catch (e) {
      if (e.status !== 401) {
        console.error(e);
        main.innerHTML = `<div class="notice error">${esc(e.message)}</div>`;
      }
    }
    window.scrollTo(0, 0);
  }

  const head = (title, actions) => `<div class="main-head"><h1>${esc(title)}</h1><div class="row-actions">${actions || ''}</div></div>`;
  const lines = (text) => String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const numOrNull = (v) => (String(v).trim() === '' ? null : Number(v));

  function changePassword() {
    const m = openModal(`
      <h2>Change password</h2>
      <form id="pw" novalidate>
        <div class="field" style="margin-bottom:14px"><label for="pw-old">Current password</label><input id="pw-old" type="password" autocomplete="current-password"></div>
        <div class="field"><label for="pw-new">New password (at least 8 characters)</label><input id="pw-new" type="password" autocomplete="new-password"></div>
        <div class="modal-actions"><button type="button" class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" type="submit">Change password</button></div>
      </form>`);
    m.el.querySelector('[data-x]').onclick = m.close;
    m.el.querySelector('#pw').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await A('/admin/change-password', { method: 'POST', json: { oldPassword: $('#pw-old', m.el).value, newPassword: $('#pw-new', m.el).value } });
        m.close();
        toast('Password changed', 'ok');
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  // ---------------------------------------------------------------- dashboard
  async function viewDashboard(main) {
    const d = await A('/admin/dashboard');
    const t = d.totals;
    const ex = d.exam;
    let phase = 'Not scheduled';
    if (ex.startTime) phase = d.serverTime < ex.startTime ? 'Upcoming' : d.serverTime < ex.endTime ? 'Live now' : 'Finished';

    const rows = (list) => list.map((r) => `
      <tr>
        <td>${esc(r.name)}</td>
        <td class="num">${r.registered}</td>
        <td class="num">${r.attended}</td>
        <td class="num"><b>${r.submitted}</b></td>
        <td class="num">${r.inProgress}</td>
        <td class="num">${r.pending ? `<span class="badge ${phase === 'Finished' ? 'bad' : 'warn'}">${r.pending}</span>` : '0'}</td>
        <td class="num">${r.avgScore}</td>
        <td><div class="bar" title="${r.submitted} of ${r.registered} submitted"><i style="width:${r.registered ? Math.round((r.submitted / r.registered) * 100) : 0}%"></i></div></td>
      </tr>`).join('');
    const table = (title, list) => `
      <section class="panel">
        <h2>${esc(title)}</h2>
        ${list.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th class="num">Registered</th><th class="num">Attended</th><th class="num">Submitted</th><th class="num">Writing now</th><th class="num">Pending</th><th class="num">Average score</th><th>Submitted share</th></tr></thead><tbody>${rows(list)}</tbody></table></div>` : '<div class="empty">Nothing here yet.</div>'}
      </section>`;

    main.innerHTML = `
      ${head('Dashboard', `<label class="check" style="align-items:center"><input type="checkbox" id="auto"> <span class="small">Refresh every minute</span></label><button class="btn btn-ghost" id="refresh">Refresh now</button>`)}
      <div class="strip">
        <span><b>${esc(ex.examName)}</b></span>
        <span>Status: <b>${phase}</b></span>
        <span>Starts: <b>${esc(fmtDateTime(ex.startTime))}</b></span>
        <span>Ends: <b>${esc(fmtDateTime(ex.endTime))}</b></span>
        <span>Duration: <b>${esc(ex.durationMinutes)} min</b></span>
        <span>Result: <b>${ex.resultPublished ? `Published ${esc(fmtDateTime(ex.resultPublishedAt))}` : 'Not published'}</b></span>
      </div>
      <div class="stats">
        <div class="stat-tile hl"><div class="n">${t.registered}</div><div class="l">Registered</div></div>
        <div class="stat-tile hl"><div class="n">${t.attended}</div><div class="l">Attended (started the exam)</div></div>
        <div class="stat-tile hl"><div class="n">${t.submitted}</div><div class="l">Submitted</div></div>
        <div class="stat-tile alert"><div class="n">${t.pending}</div><div class="l">Pending (not submitted)</div></div>
      </div>
      <div class="stats">
        <div class="stat-tile"><div class="n">${t.inProgress}</div><div class="l">Writing right now</div></div>
        <div class="stat-tile"><div class="n">${t.notStarted}</div><div class="l">Not started</div></div>
        <div class="stat-tile"><div class="n">${t.autoSubmitted}</div><div class="l">Auto-submitted at timer end</div></div>
        <div class="stat-tile"><div class="n">${t.avgScore}</div><div class="l">Average score</div></div>
        ${ex.resultPublished ? `<div class="stat-tile"><div class="n">${t.shortlisted}</div><div class="l">Shortlisted</div></div><div class="stat-tile"><div class="n">${t.rejected}</div><div class="l">Rejected</div></div>` : ''}
      </div>
      ${table('College wise', d.collegeWise)}
      ${table('Place wise', d.placeWise)}`;

    $('#refresh').onclick = route;
    const auto = $('#auto');
    auto.checked = sessionStorage.getItem('af_auto') === '1';
    auto.onchange = () => { sessionStorage.setItem('af_auto', auto.checked ? '1' : '0'); route(); };
    if (auto.checked) timers.push(setInterval(route, 60000));
  }

  // ---------------------------------------------------------------- exam settings
  const toLocalInput = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  async function viewSettings(main) {
    const c = await A('/admin/exam-config');
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const mk = (v, title, text) => `<label><input type="radio" name="markingType" value="${v}" ${c.markingType === v ? 'checked' : ''}><span><b>${title}</b><br><span class="small muted">${text}</span></span></label>`;

    main.innerHTML = `
      ${head('Exam settings', '<button class="btn btn-primary" form="settings-form" type="submit">Save settings</button>')}
      <form id="settings-form" novalidate>
        <section class="panel">
          <h2>Schedule</h2>
          <div class="form-grid">
            <div class="field full"><label for="s-name">Test name</label><input id="s-name" type="text" value="${esc(c.examName)}"></div>
            <div class="field"><label for="s-start">Exam start</label><input id="s-start" type="datetime-local" value="${esc(toLocalInput(c.startTime))}"><span class="hint">Time zone of this computer: ${esc(tz)}. Students see a countdown to this time.</span></div>
            <div class="field"><label for="s-dur">Exam timer (minutes)</label><input id="s-dur" type="number" min="1" max="600" step="1" value="${esc(c.durationMinutes)}"><span class="hint">The exam ends at the start time plus this timer, for every student.</span></div>
            <div class="field"><label for="s-mocks">Number of mock tests</label><input id="s-mocks" type="number" min="0" max="9" step="1" value="${esc(c.mockCount)}"></div>
            <div class="field"><span class="label-text">Rules for mock tests</span><label class="check"><input type="checkbox" id="s-reqmock" ${c.requireMocks ? 'checked' : ''}><span>Students must finish all mock tests before the exam</span></label></div>
            <div class="field full"><label class="check"><input type="checkbox" id="s-reg" ${c.registrationOpen ? 'checked' : ''}><span>Registration is open</span></label></div>
          </div>
        </section>
        <section class="panel">
          <h2>Marking</h2>
          <div class="radio-row" style="margin-bottom:18px">
            ${mk('positive', 'Positive only', 'Correct answer gets marks. Wrong answer gets 0.')}
            ${mk('both', 'Positive and negative', 'Correct answer gets marks. Wrong answer loses marks.')}
            ${mk('negative', 'Negative only', 'Wrong answer loses marks. Correct answer gets 0.')}
          </div>
          <div class="form-grid">
            <div class="field"><label for="s-pos">Marks for a correct answer</label><input id="s-pos" type="number" min="0.25" step="0.25" value="${esc(c.positiveMarks)}"><span class="hint">Used for every question unless the question sets its own marks.</span></div>
            <div class="field"><label for="s-neg">Marks lost for a wrong answer</label><input id="s-neg" type="number" min="0" step="0.25" value="${esc(c.negativeMarks)}"></div>
          </div>
        </section>
        <section class="panel">
          <h2>Result grades</h2>
          <p class="muted">Grades use the marks a student scored in the main exam, not percentile. Below the Great limit is Fail, and Fail is always rejected. The percentage is marks scored divided by total marks.</p>
          <div class="grade-grid">
            <div class="field"><label for="s-great">Great from (marks)</label><input id="s-great" type="number" min="0" step="0.25" value="${esc(c.gradeGreatFrom)}"><span class="hint">Below this = Fail</span></div>
            <div class="field"><label for="s-vgood">Very Good from (marks)</label><input id="s-vgood" type="number" min="0" step="0.25" value="${esc(c.gradeVeryGoodFrom)}"></div>
            <div class="field"><label for="s-excel">Excellent from (marks)</label><input id="s-excel" type="number" min="0" step="0.25" value="${esc(c.gradeExcellentFrom)}"></div>
            <div class="field"><label for="s-short-from">Shortlist from (marks)</label><input id="s-short-from" type="number" min="0" step="0.25" value="${esc(c.shortlistFromMarks)}"><span class="hint">Students with this many marks or more are shortlisted. Default 21 = Very Good and Excellent.</span></div>
          </div>
          <p class="small muted" style="margin-top:12px">Example for 30 marks: Fail 0 to 14, Great 15 to 20, Very Good 21 to 25, Excellent 26 to 30. If your exam has a different total, change these numbers.</p>
          <label class="check" style="margin-top:14px"><input type="checkbox" id="s-clear" ${c.clearAnswersOnTabSwitch !== false ? 'checked' : ''}> <span>When a student switches tab or window during the live exam: show a warning and clear all selected answers</span></label>
          <label class="check" style="margin-top:10px"><input type="checkbox" id="s-shuffle" ${c.shuffleExamQuestions !== false ? 'checked' : ''}> <span>Show the live-exam questions to every student in a different random order</span></label>
          <div class="field" style="max-width:360px;margin-top:10px"><label for="s-qcount">Questions in the live exam (per student)</label><input id="s-qcount" type="number" min="0" max="2000" step="1" value="${esc(c.examQuestionCount || 0)}"><span class="hint">Each student gets this many questions picked at random from all the uploaded exam questions. Example: upload 100, enter 30. Enter 0 to give everyone all questions.</span></div>
          <p class="small muted">Every tab switch is counted and shown in Results and Students. Mock tests are not affected.</p>
        </section>
        <section class="panel">
          <h2>Messages for students</h2>
          <div class="form-grid">
            <div class="field full"><label for="s-short">Shortlist message (passed)</label><textarea id="s-short" rows="3">${esc(c.shortlistMessage)}</textarea></div>
            <div class="field full"><label for="s-rej">Reject message (not passed)</label><textarea id="s-rej" rows="3">${esc(c.rejectMessage)}</textarea></div>
          </div>
        </section>
        <section class="panel">
          <h2>Student page content</h2>
          <div class="form-grid">
            <div class="field full"><label for="s-rules">Test rules (one rule per line)</label><textarea id="s-rules" rows="8">${esc(c.rules.join('\n'))}</textarea></div>
            <div class="field"><label for="s-testfor">"Test for" choices (one per line)</label><textarea id="s-testfor" rows="6">${esc(c.testForOptions.join('\n'))}</textarea></div>
          </div>
        </section>
      </form>`;

    $('#settings-form').onsubmit = async (e) => {
      e.preventDefault();
      const start = $('#s-start').value;
      const body = {
        examName: $('#s-name').value.trim(),
        startTime: start ? new Date(start).toISOString() : null,
        durationMinutes: Number($('#s-dur').value),
        mockCount: Number($('#s-mocks').value),
        requireMocks: $('#s-reqmock').checked,
        registrationOpen: $('#s-reg').checked,
        markingType: ($('input[name="markingType"]:checked') || {}).value || 'both',
        positiveMarks: Number($('#s-pos').value),
        negativeMarks: Number($('#s-neg').value),
        gradeGreatFrom: Number($('#s-great').value),
        gradeVeryGoodFrom: Number($('#s-vgood').value),
        gradeExcellentFrom: Number($('#s-excel').value),
        shortlistFromMarks: Number($('#s-short-from').value),
        clearAnswersOnTabSwitch: $('#s-clear').checked,
        shuffleExamQuestions: $('#s-shuffle').checked,
        examQuestionCount: Math.max(0, Math.floor(Number($('#s-qcount').value) || 0)),
        shortlistMessage: $('#s-short').value.trim(),
        rejectMessage: $('#s-rej').value.trim(),
        rules: lines($('#s-rules').value),
        testForOptions: lines($('#s-testfor').value),
      };
      try {
        await A('/admin/exam-config', { method: 'PUT', json: body });
        toast('Settings saved', 'ok');
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  // ---------------------------------------------------------------- questions
  async function viewQuestions(main) {
    const [all, cfg] = await Promise.all([A('/admin/questions'), A('/admin/exam-config')]);
    const sets = ['exam', ...Array.from({ length: cfg.mockCount }, (_, i) => `mock${i + 1}`)];
    const label = (s) => (s === 'exam' ? 'Exam' : `Mock test ${s.slice(4)}`);
    if (!sets.includes(ui.qset)) ui.qset = 'exam';
    const count = (s) => all.questions.filter((q) => q.set === s).length;

    const paint = () => {
      const list = all.questions.filter((q) => q.set === ui.qset);
      main.innerHTML = `
        ${head('Questions', '<button class="btn btn-primary" id="q-add">Add question</button>')}
        <div class="tabs" role="tablist">${sets.map((s) => `<button class="tab" role="tab" aria-selected="${s === ui.qset}" data-set="${s}">${label(s)} (${count(s)})</button>`).join('')}</div>
        <section class="panel">
          <h2>${label(ui.qset)} questions</h2>
          ${list.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Question</th><th>Options</th><th>Correct</th><th>Marks</th><th></th></tr></thead><tbody>
            ${list.map((q, i) => `<tr><td>${i + 1}</td><td style="max-width:460px">${esc(q.text.length > 110 ? `${q.text.slice(0, 110)}...` : q.text)}</td><td>${q.options.length}</td><td>${letter(q.correctIndex)}</td><td><span class="muted">exam setting</span></td>
            <td class="nowrap"><button class="btn btn-ghost btn-sm" data-edit="${esc(q.id)}">Edit</button> <button class="btn btn-danger btn-sm" data-del="${esc(q.id)}">Delete</button></td></tr>`).join('')}
          </tbody></table></div>` : `<div class="empty">No questions in this set yet. Add one, or upload a CSV file below.</div>`}
          ${list.length ? `<p style="margin:16px 0 0"><button class="btn btn-danger btn-sm" id="q-clear">Delete all ${list.length} questions in this set</button></p>` : ''}
        </section>
        <section class="panel">
          <h2>Upload questions from a CSV file</h2>
          <p class="muted">Columns: question, optionA, optionB, optionC, optionD, correct (A, B, C or D), marks, negativeMarks, explanation. Marks columns can stay empty to use the default marking.</p>
          <form id="csv-form" class="form-grid" novalidate>
            <div class="field"><label for="c-set">Add to</label><select id="c-set">${sets.map((s) => `<option value="${s}" ${s === ui.qset ? 'selected' : ''}>${label(s)}</option>`).join('')}</select></div>
            <div class="field"><label for="c-mode">If the set already has questions</label><select id="c-mode"><option value="append">Add the new questions after them</option><option value="replace">Replace all of them</option></select></div>
            <div class="field full"><label for="c-file">CSV file</label><input id="c-file" type="file" accept=".csv,text/csv"></div>
            <div class="field full row-actions"><button class="btn btn-primary" type="submit">Upload questions</button><button class="btn btn-ghost" type="button" id="c-template">Download a sample CSV</button></div>
          </form>
        </section>`;

      $$('.tab', main).forEach((b) => { b.onclick = () => { ui.qset = b.dataset.set; paint(); }; });
      $('#q-add').onclick = () => questionModal(null, ui.qset, reload);
      $$('[data-edit]', main).forEach((b) => { b.onclick = () => questionModal(all.questions.find((q) => q.id === b.dataset.edit), ui.qset, reload); });
      $$('[data-del]', main).forEach((b) => {
        b.onclick = async () => {
          if (!(await confirmModal({ title: 'Delete this question?', body: '<p>This cannot be undone.</p>', confirmText: 'Delete question', danger: true }))) return;
          try { await A(`/admin/questions/${b.dataset.del}`, { method: 'DELETE' }); toast('Question deleted', 'ok'); reload(); } catch (e) { toast(e.message, 'error'); }
        };
      });
      const clr = $('#q-clear');
      if (clr) {
        clr.onclick = async () => {
          if (!(await confirmModal({ title: `Delete all ${label(ui.qset)} questions?`, body: `<p>All ${list.length} questions in this set will be deleted. This cannot be undone.</p>`, confirmText: 'Delete all', danger: true }))) return;
          try { await A(`/admin/questions?set=${ui.qset}&confirm=yes`, { method: 'DELETE' }); toast('Set cleared', 'ok'); reload(); } catch (e) { toast(e.message, 'error'); }
        };
      }
      $('#c-template').onclick = () => {
        const csv = 'question,optionA,optionB,optionC,optionD,correct,marks,negativeMarks,explanation\n"What is 15% of 200?",20,25,30,35,C,,,"0.15 x 200 = 30"\n"Next number: 2, 4, 8, 16, ?",24,30,32,64,C,2,0.5,"Each number doubles"\n';
        download(new Blob([csv], { type: 'text/csv' }), 'questions-sample.csv');
      };
      $('#csv-form').onsubmit = async (e) => {
        e.preventDefault();
        const file = $('#c-file').files[0];
        if (!file) return toast('Choose a CSV file first', 'error');
        const fd = new FormData();
        fd.append('file', file);
        fd.append('set', $('#c-set').value);
        fd.append('mode', $('#c-mode').value);
        try {
          const r = await A('/admin/questions/upload', { method: 'POST', form: fd });
          toast(`${r.added} questions added`, 'ok');
          ui.qset = $('#c-set').value;
          reload();
        } catch (err) {
          if (err.data && err.data.errors) {
            openModal(`<h2>Fix these rows and upload again</h2><p>Nothing was uploaded.</p><ul>${err.data.errors.map((x) => `<li>Line ${x.line}: ${esc(x.error)}</li>`).join('')}</ul><div class="modal-actions"><button class="btn btn-primary" data-x>Close</button></div>`, { wide: true }).el.querySelector('[data-x]').onclick = (ev) => ev.target.closest('.modal-back').remove();
          } else toast(err.message, 'error');
        }
      };
    };
    const reload = () => route();
    paint();
  }

  function questionModal(q, set, done) {
    const opts = q ? [...q.options] : ['', '', '', ''];
    let correct = q ? q.correctIndex : 0;
    const m = openModal('<div id="qm"></div>', { wide: true, locked: true });
    const box = $('#qm', m.el);

    const paint = () => {
      box.innerHTML = `
        <h2>${q ? 'Edit question' : 'Add question'} (${set === 'exam' ? 'Exam' : `Mock test ${set.slice(4)}`})</h2>
        <form id="qf" novalidate>
          <div class="field" style="margin-bottom:14px"><label for="qf-text">Question</label><textarea id="qf-text" rows="3">${esc(q ? q.text : '')}</textarea></div>
          <span class="label-text">Options. Select the correct one.</span>
          <div id="qf-opts" style="margin:8px 0 6px">
            ${opts.map((t, i) => `<div class="opt-edit"><label class="letter"><input type="radio" name="correct" value="${i}" ${correct === i ? 'checked' : ''} aria-label="Option ${letter(i)} is correct"><br>${letter(i)}</label><input type="text" data-opt="${i}" value="${esc(t)}" aria-label="Option ${letter(i)}"><button type="button" class="btn btn-ghost btn-sm" data-rm="${i}" ${opts.length <= 2 ? 'disabled' : ''} aria-label="Remove option ${letter(i)}">x</button></div>`).join('')}
          </div>
          ${opts.length < 6 ? '<button type="button" class="btn btn-ghost btn-sm" id="qf-more">Add option</button>' : ''}
          <div class="form-grid" style="margin-top:16px">
            <div class="field"><label for="qf-marks">Marks (leave empty for default)</label><input id="qf-marks" type="number" min="0" step="0.25" value="${q && q.marks ? esc(q.marks) : ''}"></div>
            <div class="field"><label for="qf-neg">Marks lost if wrong (leave empty for default)</label><input id="qf-neg" type="number" min="0" step="0.25" value="${q && q.negativeMarks !== undefined && q.negativeMarks !== null ? esc(q.negativeMarks) : ''}"></div>
            <div class="field full"><label for="qf-exp">Explanation (shown in mock test results)</label><textarea id="qf-exp" rows="2">${esc(q ? q.explanation || '' : '')}</textarea></div>
          </div>
          <div class="modal-actions"><button type="button" class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" type="submit">Save question</button></div>
        </form>`;
      const syncOpts = () => { $$('[data-opt]', box).forEach((inp) => { opts[Number(inp.dataset.opt)] = inp.value; }); const r = $('input[name="correct"]:checked', box); if (r) correct = Number(r.value); };
      $('[data-x]', box).onclick = m.close;
      const more = $('#qf-more', box);
      if (more) more.onclick = () => { syncOpts(); opts.push(''); paint(); };
      $$('[data-rm]', box).forEach((b) => { b.onclick = () => { syncOpts(); const i = Number(b.dataset.rm); opts.splice(i, 1); if (correct >= opts.length) correct = opts.length - 1; else if (correct > i) correct -= 1; paint(); }; });
      $('#qf', box).onsubmit = async (e) => {
        e.preventDefault();
        syncOpts();
        const body = {
          set,
          text: $('#qf-text', box).value.trim(),
          options: opts.map((o) => o.trim()),
          correctIndex: correct,
          marks: numOrNull($('#qf-marks', box).value),
          negativeMarks: numOrNull($('#qf-neg', box).value),
          explanation: $('#qf-exp', box).value.trim(),
        };
        if (!body.text) return toast('Type the question', 'error');
        if (body.options.some((o) => !o)) return toast('Fill in every option or remove the empty ones', 'error');
        try {
          if (q) await A(`/admin/questions/${q.id}`, { method: 'PUT', json: body });
          else await A('/admin/questions', { method: 'POST', json: body });
          m.close();
          toast('Question saved', 'ok');
          done();
        } catch (err) { toast(err.message, 'error'); }
      };
    };
    paint();
  }

  // ---------------------------------------------------------------- colleges + places
  async function viewLists(main) {
    main.innerHTML = `${head('Colleges, branches and places')}<div class="form-grid" style="align-items:start"><div id="col-colleges"></div><div id="col-branches"></div><div id="col-places"></div></div>`;
    await Promise.all([listPanel($('#col-branches'), 'branches', 'Branches', 'branch'), listPanel($('#col-colleges'), 'colleges', 'Colleges', 'college'), listPanel($('#col-places'), 'places', 'Places', 'place')]);
  }

  async function listPanel(box, path, title, single) {
    const items = await A(`/admin/${path}`);
    box.innerHTML = `
      <section class="panel">
        <h2>${title} (${items.length})</h2>
        <form class="row-actions js-add-one" style="margin-bottom:12px;flex-wrap:nowrap" novalidate>
          <input type="text" class="js-one" placeholder="Add one ${single}" aria-label="Add one ${single}"><button class="btn btn-primary" type="submit">Add</button>
        </form>
        <details style="margin-bottom:14px"><summary class="small" style="cursor:pointer;color:var(--blue-700);font-weight:600">Add many at once</summary>
          <div class="field" style="margin-top:8px"><textarea class="js-many" rows="5" placeholder="One ${single} per line" aria-label="Add many ${path}"></textarea></div>
          <button class="btn btn-ghost btn-sm js-add-many" style="margin-top:8px">Add all</button>
        </details>
        ${items.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Show on form</th><th></th></tr></thead><tbody>
          ${items.map((x) => `<tr><td>${esc(x.name)}</td><td><input type="checkbox" data-act="${esc(x.id)}" ${x.active !== false ? 'checked' : ''} aria-label="Show ${esc(x.name)} on the form"></td><td><button class="btn btn-danger btn-sm" data-del="${esc(x.id)}">Delete</button></td></tr>`).join('')}
        </tbody></table></div>` : `<div class="empty">No ${path} yet. Add the first ${single} above.</div>`}
      </section>`;
    const reload = () => listPanel(box, path, title, single);
    const add = async (body) => {
      try {
        const r = await A(`/admin/${path}`, { method: 'POST', json: body });
        toast(`${r.created.length} added${r.skippedDuplicates ? `, ${r.skippedDuplicates} already in the list` : ''}`, 'ok');
        reload();
      } catch (e) { toast(e.message, 'error'); }
    };
    $('.js-add-one', box).onsubmit = (e) => { e.preventDefault(); const v = $('.js-one', box).value.trim(); if (v.length < 2) return toast('Type at least 2 characters', 'error'); add({ name: v }); };
    $('.js-add-many', box).onclick = (e) => { e.preventDefault(); const l = lines($('.js-many', box).value); if (!l.length) return toast('Type at least one name', 'error'); add({ names: l }); };
    $$('[data-act]', box).forEach((c) => { c.onchange = async () => { try { await A(`/admin/${path}/${c.dataset.act}`, { method: 'PUT', json: { active: c.checked } }); } catch (e) { toast(e.message, 'error'); c.checked = !c.checked; } }; });
    $$('[data-del]', box).forEach((b) => {
      b.onclick = async () => {
        if (!(await confirmModal({ title: `Delete this ${single}?`, body: '<p>Students who already registered keep their saved value.</p>', confirmText: 'Delete', danger: true }))) return;
        try { await A(`/admin/${path}/${b.dataset.del}`, { method: 'DELETE' }); reload(); } catch (e) { toast(e.message, 'error'); }
      };
    });
  }

  // ---------------------------------------------------------------- company
  async function viewCompany(main) {
    const c = await A('/admin/company');
    main.innerHTML = `
      ${head('Company', '<button class="btn btn-primary" form="co-form" type="submit">Save company information</button>')}
      <section class="panel">
        <h2>Logo</h2>
        <img class="logo-preview" id="co-logo" src="${esc(c.logoUrl)}" alt="Current logo" style="margin-bottom:14px">
        <div class="row-actions"><input type="file" id="co-file" accept="image/png,image/jpeg,image/webp" style="max-width:340px"><button class="btn btn-ghost" id="co-up">Upload logo</button></div>
        <p class="hint small muted" style="margin-top:8px">PNG, JPG or WEBP, up to 300 KB.</p>
      </section>
      <form id="co-form" class="panel" novalidate>
        <h2>About the company</h2>
        <div class="form-grid">
          <div class="field"><label for="co-name">Company name</label><input id="co-name" type="text" value="${esc(c.name)}"></div>
          <div class="field"><label for="co-tag">Tagline</label><input id="co-tag" type="text" value="${esc(c.tagline || '')}"></div>
          <div class="field full"><label for="co-about">About the company</label><textarea id="co-about" rows="9">${esc(c.about)}</textarea><span class="hint">Leave a blank line between paragraphs.</span></div>
          <div class="field full"><label for="co-high">Highlights (one per line)</label><textarea id="co-high" rows="5">${esc((c.highlights || []).join('\n'))}</textarea></div>
          <div class="field"><label for="co-web">Website</label><input id="co-web" type="text" value="${esc(c.website)}"></div>
          <div class="field"><label for="co-mail">Email</label><input id="co-mail" type="email" value="${esc(c.email || '')}"></div>
          <div class="field"><label for="co-phone">Phone</label><input id="co-phone" type="text" value="${esc(c.phone || '')}"></div>
          <div class="field"><label for="co-addr">Address</label><textarea id="co-addr" rows="3">${esc(c.address || '')}</textarea></div>
        </div>
      </form>`;
    $('#co-up').onclick = async () => {
      const f = $('#co-file').files[0];
      if (!f) return toast('Choose a logo image first', 'error');
      if (f.size > 300 * 1024) return toast('The logo is larger than 300 KB. Use a smaller image.', 'error');
      const fd = new FormData();
      fd.append('logo', f);
      try { const r = await A('/admin/company/logo', { method: 'POST', form: fd }); $('#co-logo').src = r.logoUrl; toast('Logo updated', 'ok'); } catch (e) { toast(e.message, 'error'); }
    };
    $('#co-form').onsubmit = async (e) => {
      e.preventDefault();
      const body = { name: $('#co-name').value.trim(), tagline: $('#co-tag').value.trim(), about: $('#co-about').value.trim(), highlights: lines($('#co-high').value), website: $('#co-web').value.trim(), email: $('#co-mail').value.trim(), phone: $('#co-phone').value.trim(), address: $('#co-addr').value.trim() };
      try { await A('/admin/company', { method: 'PUT', json: body }); toast('Company information saved', 'ok'); } catch (err) { toast(err.message, 'error'); }
    };
  }

  // ---------------------------------------------------------------- students
  const statusBadge = (s) => (s === 'submitted' ? '<span class="badge ok">Submitted</span>' : s === 'in_progress' ? '<span class="badge warn">Writing</span>' : '<span class="badge">Not started</span>');
  const gradeBadge = (g) => (g ? `<span class="badge g-${esc(String(g).toLowerCase().replace(/\s+/g, '-'))}">${esc(g)}</span>` : '');
  const resultBadge = (r) => {
    const st = r.status || r.resultStatus;
    if (!st) return r.manualDecision ? `<span class="badge info">${esc(r.manualDecision)} (admin)</span>` : '';
    return `<span class="badge ${st === 'shortlisted' ? 'ok' : 'bad'}">${st === 'shortlisted' ? 'Shortlisted' : 'Rejected'}${r.manualDecision ? ' (admin)' : ''}</span>`;
  };

  async function deleteStudent(id, name) {
    const ok = await confirmModal({
      title: `Delete ${name}?`,
      body: '<p>This permanently deletes the student\'s details, mock scores, exam answers and result. Their resume is moved to the Google Drive trash. This cannot be undone. The student could register again with the same email.</p>',
      confirmText: 'Delete record',
      danger: true,
    });
    if (!ok) return false;
    try {
      const r = await A(`/admin/students/${id}`, { method: 'DELETE' });
      toast(r.resumeMoved ? 'Record deleted. Resume moved to the Drive trash.' : 'Record deleted', 'ok');
      return true;
    } catch (e) { toast(e.message, 'error'); return false; }
  }

  async function viewStudents(main) {
    const [colleges, places] = await Promise.all([A('/admin/colleges'), A('/admin/places')]);
    const f = ui.studentFilters;
    const limit = 50;
    const qs = new URLSearchParams({ page: ui.studentPage, limit });
    Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
    const data = await A(`/admin/students?${qs}`);
    const pages = Math.max(1, Math.ceil(data.total / limit));

    main.innerHTML = `
      ${head(`Students (${data.total})`)}
      <form class="filters" id="flt" novalidate>
        <input type="search" id="f-q" placeholder="Search name, email, contact" value="${esc(f.q)}" aria-label="Search students">
        <select id="f-col" aria-label="College"><option value="">All colleges</option>${colleges.map((c) => `<option value="${esc(c.id)}" ${f.collegeId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <select id="f-pl" aria-label="Place"><option value="">All places</option>${places.map((c) => `<option value="${esc(c.id)}" ${f.placeId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <select id="f-st" aria-label="Exam status">
          ${[['', 'Any status'], ['submitted', 'Submitted'], ['pending', 'Pending (not submitted)'], ['in_progress', 'Writing now'], ['not_started', 'Not started']].map(([v, l]) => `<option value="${v}" ${f.status === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <button class="btn btn-primary" type="submit">Apply</button>
      </form>
      <section class="panel">
        ${data.students.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Roll no.</th><th>College</th><th>Branch</th><th>Test for</th><th>Place</th><th>Exam</th><th class="num">Score</th><th class="num">%</th><th>Grade</th><th>Result</th><th class="num">Tab switches</th><th>Resume</th><th></th></tr></thead><tbody>
          ${data.students.map((s) => `<tr>
            <td><button class="btn-link" data-open="${esc(s.id)}">${esc(s.name)}</button><br><span class="small muted">${esc(s.contact)}</span></td>
            <td>${esc(s.rollNumber || '-')}</td><td>${esc(s.college)}</td><td>${esc(s.branch)}</td><td>${esc(s.testFor)}</td><td>${esc(s.place)}</td>
            <td>${statusBadge(s.examStatus)}${s.autoSubmitted ? '<br><span class="small muted">auto-submitted</span>' : ''}</td>
            <td class="num">${s.score === null ? '-' : `${esc(s.score)} / ${esc(s.maxMarks)}`}</td>
            <td class="num">${s.percentage === null ? '-' : `${esc(s.percentage)}%`}</td>
            <td>${gradeBadge(s.grade) || '-'}</td>
            <td>${resultBadge(s)}</td>
            <td class="num">${s.tabSwitches ? `<span class="badge g-fail">${esc(s.tabSwitches)}</span>` : '0'}</td>
            <td>${s.resumeUrl ? `<a href="${esc(s.resumeUrl)}" target="_blank" rel="noopener">Open in Drive</a>` : '-'}</td>
            <td><div class="row-btns">${s.examStatus !== 'not_started' ? `<button class="btn btn-ghost btn-sm" data-reset="${esc(s.id)}">Reset exam</button>` : ''}<button class="btn btn-danger btn-sm" data-del="${esc(s.id)}" data-name="${esc(s.name)}">Delete</button></div></td>
          </tr>`).join('')}
        </tbody></table></div>
        <div class="row-actions" style="margin-top:14px"><button class="btn btn-ghost btn-sm" id="pg-prev" ${ui.studentPage <= 1 ? 'disabled' : ''}>Previous</button><span class="small muted">Page ${ui.studentPage} of ${pages}</span><button class="btn btn-ghost btn-sm" id="pg-next" ${ui.studentPage >= pages ? 'disabled' : ''}>Next</button></div>`
          : '<div class="empty">No students match these filters.</div>'}
      </section>`;

    $('#flt').onsubmit = (e) => {
      e.preventDefault();
      ui.studentFilters = { q: $('#f-q').value.trim(), collegeId: $('#f-col').value, placeId: $('#f-pl').value, status: $('#f-st').value };
      ui.studentPage = 1;
      route();
    };
    const prev = $('#pg-prev');
    if (prev) { prev.onclick = () => { ui.studentPage -= 1; route(); }; $('#pg-next').onclick = () => { ui.studentPage += 1; route(); }; }
    $$('[data-open]', main).forEach((b) => { b.onclick = () => studentDetail(b.dataset.open); });
    $$('[data-dec]', main).forEach((b) => {
      b.onclick = async () => {
        try { await A(`/admin/students/${b.dataset.id}/decision`, { method: 'PATCH', json: { decision: b.dataset.dec || null } }); toast('Saved', 'ok'); route(); } catch (e) { toast(e.message, 'error'); }
      };
    });
    $$('[data-del]', main).forEach((b) => { b.onclick = async () => { if (await deleteStudent(b.dataset.del, b.dataset.name)) route(); }; });
    $$('[data-reset]', main).forEach((b) => {
      b.onclick = async () => {
        let dur = 60;
        try { dur = (await A('/admin/exam-config')).durationMinutes || 60; } catch (e) { /* default */ }
        const m = openModal(`
          <h2>Reset this student's exam?</h2>
          <p>Their answers and score are deleted. They start the exam again with a fresh time that begins when they press Start. It works even if the exam window has closed. Use this only after a technical problem.</p>
          <div class="field" style="margin:12px 0"><label class="check"><input type="radio" name="rt" value="default" checked> <span>Full exam duration (${esc(dur)} minutes)</span></label></div>
          <div class="field" style="margin:12px 0"><label class="check"><input type="radio" name="rt" value="custom"> <span>Custom time (extra time):</span></label>
            <input id="rt-min" type="number" min="1" max="600" step="1" value="${esc(dur)}" style="max-width:140px;margin-top:6px" aria-label="Minutes"> <span class="small muted">minutes in total</span></div>
          <div class="modal-actions"><button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-danger" data-ok>Reset exam</button></div>`, { locked: true });
        m.el.querySelector('#rt-min').addEventListener('focus', () => { m.el.querySelector('input[value="custom"]').checked = true; });
        m.el.querySelector('[data-cancel]').onclick = m.close;
        m.el.querySelector('[data-ok]').onclick = async () => {
          const custom = m.el.querySelector('input[value="custom"]').checked;
          const minutes = custom ? Math.floor(Number(m.el.querySelector('#rt-min').value)) : null;
          if (custom && !(minutes >= 1 && minutes <= 600)) return toast('Enter minutes between 1 and 600', 'error');
          try {
            const r = await A(`/admin/students/${b.dataset.reset}/reset-exam`, { method: 'POST', json: { minutes } });
            m.close();
            toast(`Exam reset. The student gets ${r.minutes} minutes when they start.`, 'ok');
            route();
          } catch (e) { toast(e.message, 'error'); }
        };
      };
    });
  }

  async function studentDetail(id) {
    try {
      const s = await A(`/admin/students/${id}`);
      const mocks = Object.entries(s.mocks || {}).map(([n, m]) => `<li>Mock test ${esc(n)}: ${esc(m.score)} of ${esc(m.maxMarks)} (${esc(m.attempted)} attempted)</li>`).join('');
      const m = openModal(`
        <h2>${esc(s.name)}</h2>
        <div class="table-wrap"><table class="data"><tbody>
          <tr><th>Email</th><td>${esc(s.email)}</td></tr><tr><th>Contact</th><td>${esc(s.contact)}</td></tr>
          <tr><th>Roll number</th><td>${esc(s.rollNumber || '-')}</td></tr><tr><th>College</th><td>${esc(s.college)}</td></tr><tr><th>Branch</th><td>${esc(s.branch)}</td></tr>
          <tr><th>Test for</th><td>${esc(s.testFor)}</td></tr><tr><th>Place</th><td>${esc(s.place)}</td></tr>
          <tr><th>Registered</th><td>${esc(fmtDateTime(s.registeredAt))}</td></tr>
          <tr><th>Exam</th><td>${statusBadge(s.examStatus)} ${s.startedAt ? `started ${esc(fmtDateTime(s.startedAt))}` : ''} ${s.submittedAt ? `, submitted ${esc(fmtDateTime(s.submittedAt))}${s.autoSubmitted ? ' (auto)' : ''}` : ''}</td></tr>
          ${s.score !== null ? `<tr><th>Score</th><td>${esc(s.score)} of ${esc(s.maxMarks)} (${esc(s.percentage)}%) ${gradeBadge(s.grade)}. ${esc(s.correct)} correct, ${esc(s.wrong)} wrong, ${esc(s.attempted)} attempted.</td></tr>` : ''}
          <tr><th>Result</th><td>${resultBadge(s) || '-'}</td></tr>
          <tr><th>Login</th><td>${s.loggedIn ? 'Logged in on a device now <button class="btn btn-ghost btn-sm" data-release>Release login</button>' : 'Not logged in'}</td></tr>
          <tr><th>Tab switches</th><td>${esc(s.tabSwitches || 0)}${s.tabSwitches ? ' (answers were cleared each time if the rule was on)' : ''}</td></tr>
          <tr><th>Resume</th><td>${s.resumeUrl ? `<a href="${esc(s.resumeUrl)}" target="_blank" rel="noopener">Open in Google Drive</a>` : '-'}</td></tr>
        </tbody></table></div>
        <h3 style="margin:16px 0 6px">Mock tests</h3>${mocks ? `<ul>${mocks}</ul>` : '<p class="muted">No mock test finished yet.</p>'}
        <div class="modal-actions"><button class="btn btn-primary" data-x>Close</button></div>`);
      m.el.querySelector('[data-x]').onclick = m.close;
      const rel = m.el.querySelector('[data-release]');
      if (rel) rel.onclick = async () => {
        try { await A(`/admin/students/${id}/release-login`, { method: 'POST', json: {} }); toast('Login released. The student can log in again.', 'ok'); m.close(); } catch (e) { toast(e.message, 'error'); }
      };
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---------------------------------------------------------------- results
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function viewResults(main) {
    const [res, cfg] = await Promise.all([A('/admin/results'), A('/admin/exam-config')]);
    const pub = cfg.resultPublished;
    const all = res.results;
    const nShort = all.filter((r) => r.status === 'shortlisted').length;
    const nRej = all.length - nShort;
    const view = ui.resultFilter || 'all';
    const rows = view === 'all' ? all : all.filter((r) => r.status === view);
    const seg = (v, label, n) => `<button type="button" data-rf="${v}" aria-pressed="${view === v}">${label} (${n})</button>`;

    main.innerHTML = `
      ${head('Results', `<button class="btn btn-ghost" id="r-export">Download CSV</button>${pub ? '<button class="btn btn-danger" id="r-hide">Hide results</button>' : ''}<button class="btn btn-red" id="r-pub">${pub ? 'Publish again' : 'Publish results'}</button>`)}
      <div class="strip">
        <span>Status: <b>${pub ? `Published ${esc(fmtDateTime(cfg.resultPublishedAt))}` : 'Not published. Students cannot see any result or shortlist status.'}</b></span>
        <span>Grades: <b>Great ${esc(cfg.gradeGreatFrom)}+, Very Good ${esc(cfg.gradeVeryGoodFrom)}+, Excellent ${esc(cfg.gradeExcellentFrom)}+, below ${esc(cfg.gradeGreatFrom)} Fail</b></span>
        <span>Shortlisted from: <b>${esc(cfg.shortlistFromMarks)} marks</b></span>
        <span>Submitted: <b>${res.count}</b></span>
      </div>
      ${pub && res.waitingForPublish ? `<div class="notice warn">${esc(res.waitingForPublish)} student${res.waitingForPublish > 1 ? 's' : ''} submitted after the last publish and cannot see a result yet. Click <b>Publish again</b> to release ${res.waitingForPublish > 1 ? 'them' : 'it'}.</div>` : ''}
      <div class="filters" style="align-items:center">
        <div class="seg" role="group" aria-label="Filter by result">${seg('all', 'All', all.length)}${seg('shortlisted', 'Shortlisted by marks', nShort)}${seg('rejected', 'Rejected by marks', nRej)}</div>
      </div>
      <section class="panel">
        ${rows.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Rank</th><th>Name</th><th>College</th><th>Branch</th><th>Place</th><th class="num">Marks</th><th class="num">Percentage</th><th>Grade</th><th class="num">Attempted</th><th class="num">Tab switches</th><th>Status</th><th>Change status</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td>${r.rank}</td><td>${esc(r.name)}${r.autoSubmitted ? ' <span class="badge">auto</span>' : ''}</td><td>${esc(r.college)}</td><td>${esc(r.branch)}</td><td>${esc(r.place)}</td><td class="num"><b>${esc(r.score)}</b> / ${esc(r.maxMarks)}</td><td class="num"><b>${esc(r.percentage)}%</b></td><td>${gradeBadge(r.grade)}</td><td class="num">${esc(r.attempted)}</td><td class="num">${esc(r.tabSwitches || 0)}</td><td>${resultBadge(r)}${r.manualDecision && r.manualDecision !== r.autoStatus ? `<br><span class="small muted">marks say: ${esc(r.autoStatus)}</span>` : ''}</td>
            <td><div class="row-btns">${r.status === 'shortlisted' ? `<button class="btn btn-ghost btn-sm" data-dec="rejected" data-id="${esc(r.id)}">Move to Rejected</button>` : `<button class="btn btn-ghost btn-sm" data-dec="shortlisted" data-id="${esc(r.id)}">Move to Shortlisted</button>`}${r.manualDecision ? `<button class="btn btn-ghost btn-sm" data-dec="" data-id="${esc(r.id)}">Use marks rule</button>` : ''}<button class="btn btn-danger btn-sm" data-del="${esc(r.id)}" data-name="${esc(r.name)}">Delete</button></div></td></tr>`).join('')}
        </tbody></table></div>` : `<div class="empty">${all.length ? 'No students in this list.' : 'No submitted exams yet. Results appear here as students submit.'}</div>`}
      </section>`;

    $$('[data-del]', main).forEach((b) => { b.onclick = async () => { if (await deleteStudent(b.dataset.del, b.dataset.name)) route(); }; });
    $$('[data-rf]', main).forEach((b) => { b.onclick = () => { ui.resultFilter = b.dataset.rf; route(); }; });
    $$('[data-dec]', main).forEach((b) => {
      b.onclick = async () => {
        try { await A(`/admin/students/${b.dataset.id}/decision`, { method: 'PATCH', json: { decision: b.dataset.dec || null } }); toast(pub ? 'Saved. Students see the new status now.' : 'Saved', 'ok'); route(); } catch (e) { toast(e.message, 'error'); }
      };
    });

    $('#r-export').onclick = async () => {
      try { download(await A('/admin/results/export', { blob: true }), 'internship-aptitude-results.csv'); } catch (e) { toast(e.message, 'error'); }
    };
    const hide = $('#r-hide');
    if (hide) hide.onclick = async () => {
      if (!(await confirmModal({ title: 'Hide the results?', body: '<p>Students will see "result not published" again.</p>', confirmText: 'Hide results', danger: true }))) return;
      try { await A('/admin/results/unpublish', { method: 'POST', json: {} }); toast('Results hidden', 'ok'); route(); } catch (e) { toast(e.message, 'error'); }
    };
    $('#r-pub').onclick = async () => {
      const ok = await confirmModal({
        title: 'Publish results?',
        body: `<p>Students with <b>${esc(cfg.shortlistFromMarks)}</b> marks or more see the shortlist message. Everyone else sees the reject message. Students you moved by hand keep your choice. Until you publish, students see no status at all.</p>
               <p class="small muted"><b>Shortlist message:</b> ${esc(cfg.shortlistMessage)}</p><p class="small muted"><b>Reject message:</b> ${esc(cfg.rejectMessage)}</p>`,
        confirmText: 'Publish results',
      });
      if (!ok) return;
      const send = async (force) => {
        try {
          const r = await A('/admin/results/publish', { method: 'POST', json: { force } });
          toast(`Published. ${r.shortlisted} shortlisted, ${r.rejected} rejected.`, 'ok');
          route();
        } catch (e) {
          if (e.status === 409 && !force) {
            if (await confirmModal({ title: 'Some students are still writing', body: `<p>${esc(e.message)}</p>`, confirmText: 'Publish anyway', cancelText: 'Wait', danger: true })) send(true);
          } else toast(e.message, 'error');
        }
      };
      send(false);
    };
  }

  // ---------------------------------------------------------------- start
  if (token) showShell();
  else showLogin();
})();
