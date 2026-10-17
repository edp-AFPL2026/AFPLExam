/* Student site: landing -> register -> mock tests -> waiting room -> exam -> result */
(function () {
  'use strict';
  const { Clock, $, $$, esc, api, toast, openModal, confirmModal, fmtClock, fmtCountdown, fmtDate, fmtTime, signed, letter } = AF;

  const S = {
    token: sessionStorage.getItem('af_token'),
    landing: null,
    status: null,
    timers: [],
    cleanup: [],
  };
  const app = $('#app');

  // ---------------------------------------------------------------- small utilities
  function every(fn, ms) {
    const id = setInterval(fn, ms);
    S.timers.push(id);
    return id;
  }
  function leaveView() {
    S.timers.forEach(clearInterval);
    S.timers = [];
    S.cleanup.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    S.cleanup = [];
    document.body.classList.remove('landing');
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function call(path, opts) {
    return api(path, { ...(opts || {}), token: S.token }).catch((e) => {
      if (e.status === 401 && S.token) logout('Your session ended. Continue with your email and contact number.');
      throw e;
    });
  }

  function logout(message) {
    sessionStorage.removeItem('af_token');
    S.token = null;
    S.status = null;
    leaveView();
    showLanding(message);
    window.scrollTo(0, 0);
  }

  function setChrome() {
    const c = S.landing.company;
    $('#brand-name').textContent = c.name;
    if (c.logoUrl) $('#brand-logo').src = c.logoUrl;
    document.title = `${S.landing.exam.examName} - ${c.name}`;
    $('#footer').innerHTML = `<div class="wrap">${esc(c.name)}${c.address ? `<br>${esc(c.address)}` : ''}</div>`;
    const who = $('#who');
    if (S.token && S.status) {
      who.innerHTML = `<span>${esc(S.status.student.name)}</span><button class="btn btn-ghost btn-sm" id="btn-logout">Log out</button>`;
      $('#btn-logout').onclick = async () => {
        const ok = await confirmModal({ title: 'Log out?', body: '<p>You can continue later with your email and contact number.</p>', confirmText: 'Log out' });
        if (ok) logout();
      };
    } else {
      who.innerHTML = '';
    }
  }

  async function loadStatus() {
    S.status = await call('/student/status');
    return S.status;
  }

  // ---------------------------------------------------------------- landing
  function showLanding(notice) {
    leaveView();
    document.body.classList.add('landing');
    setChrome();
    const L = S.landing;
    const c = L.company;
    const ex = L.exam;
    const f = L.form;
    const hasStart = !!ex.startTime;

    const opts = (list, ph) => `<option value="">${esc(ph)}</option>${list.map((x) => `<option value="${esc(x.id || x)}">${esc(x.name || x)}</option>`).join('')}`;

    const aboutHtml = `
      <div class="two-col">
        <div>
          <h2>About ${esc(c.name)}</h2>
          <div class="prose">${String(c.about || '').split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('')}</div>
          ${c.website ? `<p><a href="${esc(c.website)}" target="_blank" rel="noopener">Visit our website</a></p>` : ''}
        </div>
        <div>
          ${(c.highlights || []).length ? `<h3 style="margin-bottom:12px">At a glance</h3><ul class="ticks">${c.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
          <address class="contact">
            ${c.address ? `<strong>Address</strong><br>${esc(c.address)}<br>` : ''}
            ${c.phone ? `<strong>Phone</strong> ${esc(c.phone)}<br>` : ''}
            ${c.email ? `<strong>Email</strong> ${esc(c.email)}` : ''}
          </address>
        </div>
      </div>`;

    const rulesHtml = `
      <h2>Test instructions</h2>
      <ol class="rules">${ex.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>
      <div class="callout"><strong>Marking:</strong> ${esc(ex.markingScheme)} The test lasts ${esc(ex.durationMinutes)} minutes.</div>`;

    const registerHtml = `
      <h2>Student information</h2>
      <p class="muted">Fill in every field before you start the test. You cannot change these details later.</p>
      ${notice ? `<div class="notice warn">${esc(notice)}</div>` : ''}
      ${!ex.registrationOpen ? '<div class="notice error">Registration is closed. If you already registered, use "I already registered".</div>' : ''}
      ${!f.colleges.length ? '<div class="notice warn">The college list is not ready yet. Please try again shortly.</div>' : ''}
      <form class="form-panel" id="reg-form" novalidate>
        <div class="form-grid">
          <div class="field"><label for="f-name">Full name</label><input id="f-name" name="name" type="text" autocomplete="name" maxlength="100" required><span class="err"></span></div>
          <div class="field"><label for="f-email">Email</label><input id="f-email" name="email" type="email" autocomplete="email" maxlength="160" required><span class="err"></span></div>
          <div class="field"><label for="f-contact">Contact number</label><input id="f-contact" name="contact" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" placeholder="10 digit mobile number" required><span class="err"></span></div>
          <div class="field"><label for="f-college">College name</label><select id="f-college" name="collegeId" required>${opts(f.colleges, 'Select your college')}</select><span class="err"></span></div>
          <div class="field"><label for="f-branch">Branch / Degree</label><input id="f-branch" name="branch" type="text" list="branch-list" maxlength="120" placeholder="Select or type your branch" required><datalist id="branch-list">${f.branchOptions.map((b) => `<option value="${esc(b)}"></option>`).join('')}</datalist><span class="err"></span></div>
          <div class="field"><label for="f-testfor">Test for</label><select id="f-testfor" name="testFor" required>${opts(f.testForOptions, 'Select the internship')}</select><span class="err"></span></div>
          <div class="field"><label for="f-place">Place</label><select id="f-place" name="placeId" required>${opts(f.places, 'Select your place')}</select><span class="err"></span></div>
          <div class="field"><label for="f-resume">Upload resume <span class="opt-tag">(optional)</span></label><input id="f-resume" name="resume" type="file" accept=".pdf,.doc,.docx,application/pdf"><span class="hint">PDF, DOC or DOCX, up to 4 MB. You can skip this.</span><span class="err"></span></div>
          <div class="field full"><label class="check"><input type="checkbox" id="f-confirm"><span>I confirm that the details above are correct and I have read the test instructions.</span></label><span class="err"></span></div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary btn-lg" type="submit" id="btn-submit" ${!ex.registrationOpen || !f.colleges.length ? 'disabled' : ''}>Start Aptitude Test</button>
          <span class="muted small" id="form-msg" role="status"></span>
        </div>
      </form>`;

    const TABS = [
      { id: 'about', label: 'About company', html: aboutHtml, next: { to: 'rules', text: 'Next: Test instructions' } },
      { id: 'rules', label: 'Test instructions', html: rulesHtml, next: { to: 'register', text: 'Next: Student information' } },
      { id: 'register', label: 'Student information', html: registerHtml },
    ];

    app.innerHTML = `
      <section class="hero">
        <div class="wrap hero-grid">
          <div>
            <p class="hero-company">${esc(c.name)}</p>
            <h1>${esc(ex.examName)}</h1>
            <p class="hero-lead">${esc(c.tagline || '')}</p>
            <div class="hero-actions">
              <button class="btn btn-red btn-lg" type="button" data-goto="register">Fill in your details</button>
              <button class="btn btn-ghost btn-lg" id="btn-continue" type="button">I already registered</button>
            </div>
          </div>
          <dl class="spec">
            <div class="spec-title">Exam details</div>
            <div class="spec-grid">
              <div class="spec-cell"><dt>Date</dt><dd>${hasStart ? esc(fmtDate(ex.startTime)) : 'To be announced'}</dd></div>
              <div class="spec-cell"><dt>Start time</dt><dd>${hasStart ? esc(fmtTime(ex.startTime)) : 'To be announced'}</dd></div>
              <div class="spec-cell"><dt>Duration</dt><dd>${esc(ex.durationMinutes)} minutes</dd></div>
              <div class="spec-cell"><dt>Before the exam</dt><dd>${ex.mockCount ? `${esc(ex.mockCount)} mock tests` : 'No mock tests'}</dd></div>
              <div class="spec-cell wide"><dt>Marking</dt><dd>${esc(ex.markingScheme)}</dd></div>
            </div>
            ${hasStart ? '<div class="spec-count"><span class="label" id="lc-label">Exam starts in</span><span class="count-big" id="lc-time">--:--:--</span></div>' : ''}
          </dl>
        </div>
      </section>

      <section class="ltabs-section">
        <div class="wrap">
          <div class="ltabs" role="tablist" aria-label="Test information">
            ${TABS.map((t) => `<button class="ltab" role="tab" type="button" id="tab-${t.id}" data-tab="${t.id}" aria-controls="panel-${t.id}" aria-selected="false" tabindex="-1">${esc(t.label)}</button>`).join('')}
          </div>
          <div class="ltab-panels">
            ${TABS.map((t) => `<div class="ltab-panel" role="tabpanel" id="panel-${t.id}" aria-labelledby="tab-${t.id}" hidden>${t.html}${t.next ? `<p class="ltab-next"><button class="btn btn-ghost" type="button" data-goto="${t.next.to}">${esc(t.next.text)}</button></p>` : ''}</div>`).join('')}
          </div>
        </div>
      </section>`;

    const selectTab = (id, focus) => {
      TABS.forEach((t) => {
        const on = t.id === id;
        const tab = $(`#tab-${t.id}`);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
        $(`#panel-${t.id}`).hidden = !on;
        if (on && focus) tab.focus();
      });
    };
    $$('[data-tab]').forEach((b) => {
      b.onclick = () => selectTab(b.dataset.tab);
      b.onkeydown = (e) => {
        const i = TABS.findIndex((t) => t.id === b.dataset.tab);
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (step) { e.preventDefault(); selectTab(TABS[(i + step + TABS.length) % TABS.length].id, true); }
      };
    });
    $$('[data-goto]').forEach((b) => { b.onclick = () => { selectTab(b.dataset.goto); const p = $('.ltab-panels'); if (p) p.scrollTop = 0; }; });
    const fromHash = TABS.find((t) => `#${t.id}` === location.hash);
    selectTab(fromHash ? fromHash.id : notice ? 'register' : 'about');

    $('#btn-continue').onclick = openLogin;
    $('#reg-form').addEventListener('submit', onRegister);

    if (hasStart) {
      const tick = () => {
        const ms = ex.startTime - Clock.now();
        const end = ex.endTime || ex.startTime + ex.durationMinutes * 60000;
        const time = $('#lc-time');
        if (!time) return;
        if (ms > 0) {
          $('#lc-label').textContent = 'Exam starts in';
          time.textContent = fmtCountdown(ms);
        } else if (Clock.now() < end) {
          $('#lc-label').textContent = 'Exam is running';
          time.textContent = 'Live now';
        } else {
          $('#lc-label').textContent = 'Exam window';
          time.textContent = 'Closed';
        }
      };
      tick();
      every(tick, 1000);
    }
  }

  function fieldError(input, message) {
    const field = input.closest('.field');
    if (!field) return;
    field.classList.toggle('invalid', !!message);
    const err = field.querySelector('.err');
    if (err) err.textContent = message || '';
  }

  async function onRegister(e) {
    e.preventDefault();
    const form = e.target;
    const msg = $('#form-msg');
    const v = (n) => (form.elements[n].value || '').trim();
    let ok = true;
    const check = (name, cond, text) => {
      fieldError(form.elements[name], cond ? '' : text);
      if (!cond) ok = false;
    };

    check('name', v('name').length >= 2, 'Enter your full name.');
    check('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email')), 'Enter a valid email address.');
    check('contact', v('contact').replace(/\D/g, '').length >= 10, 'Enter a 10 digit contact number.');
    check('collegeId', !!v('collegeId'), 'Select your college.');
    check('branch', v('branch').length >= 2, 'Enter your branch or degree.');
    check('testFor', !!v('testFor'), 'Select the internship you are applying for.');
    check('placeId', !!v('placeId'), 'Select your place.');

    const file = form.elements.resume.files[0];
    let fileErr = '';
    if (!file) fileErr = '';
    else if (!/\.(pdf|docx?)$/i.test(file.name)) fileErr = 'The resume must be a PDF, DOC or DOCX file.';
    else if (file.size > 4 * 1024 * 1024) fileErr = 'The resume is larger than 4 MB. Upload a smaller file.';
    fieldError(form.elements.resume, fileErr);
    if (fileErr) ok = false;

    const confirmBox = $('#f-confirm');
    fieldError(confirmBox, confirmBox.checked ? '' : 'Tick the box to continue.');
    if (!confirmBox.checked) ok = false;

    if (!ok) {
      msg.textContent = 'Check the highlighted fields.';
      const bad = $('.field.invalid input, .field.invalid select');
      if (bad) bad.focus();
      return;
    }

    const fd = new FormData();
    ['name', 'email', 'contact', 'collegeId', 'branch', 'testFor', 'placeId'].forEach((n) => fd.append(n, v(n)));
    if (file) fd.append('resume', file);

    const btn = $('#btn-submit');
    btn.disabled = true;
    msg.textContent = file ? 'Saving your details and resume...' : 'Saving your details...';
    try {
      const res = await api('/student/register', { method: 'POST', form: fd });
      S.token = res.token;
      sessionStorage.setItem('af_token', res.token);
      await loadStatus();
      toast('Details saved. Start with the mock tests.', 'ok');
      showHub();
      window.scrollTo(0, 0);
    } catch (err) {
      msg.textContent = '';
      btn.disabled = false;
      if (err.status === 409) {
        openLogin(v('email'), 'This email is already registered. Continue with your email and contact number.');
      } else {
        toast(err.message, 'error');
        msg.textContent = err.message;
      }
    }
  }

  function openLogin(prefillEmail, note) {
    const email = typeof prefillEmail === 'string' ? prefillEmail : '';
    const m = openModal(`
      <h2>Continue your test</h2>
      ${note ? `<div class="notice">${esc(note)}</div>` : '<p class="muted">Enter the email and contact number you registered with.</p>'}
      <form id="login-form" novalidate>
        <div class="field" style="margin-bottom:14px"><label for="l-email">Email</label><input id="l-email" type="email" value="${esc(email)}" autocomplete="email" required></div>
        <div class="field"><label for="l-contact">Contact number</label><input id="l-contact" type="tel" inputmode="tel" autocomplete="tel" required></div>
        <p class="err" id="l-err" style="color:var(--red-700);min-height:1.2em;margin:10px 0 0"></p>
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" data-cancel>Cancel</button>
          <button class="btn btn-primary" type="submit">Continue</button>
        </div>
      </form>`);
    m.el.querySelector('[data-cancel]').onclick = m.close;
    m.el.querySelector('#login-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const err = m.el.querySelector('#l-err');
      err.textContent = '';
      try {
        const res = await api('/student/login', { method: 'POST', json: { email: m.el.querySelector('#l-email').value.trim(), contact: m.el.querySelector('#l-contact').value.trim() } });
        S.token = res.token;
        sessionStorage.setItem('af_token', res.token);
        m.close();
        await loadStatus();
        showHub();
        window.scrollTo(0, 0);
      } catch (e2) {
        err.textContent = e2.message;
      }
    };
  }

  // ---------------------------------------------------------------- hub (mocks, waiting room, result)
  function signature(st) {
    return JSON.stringify([st.state, st.mocksRemaining, st.resultPublished, st.startTime, st.mocks.map((m) => m.completed)]);
  }

  async function showHub(opts) {
    leaveView();
    const st = S.status;
    setChrome();
    if (st.state === 'in_progress' && !(opts && opts.noAuto)) return startExam();

    let resultHtml = '';
    if (st.state === 'submitted' && st.resultPublished) {
      try {
        resultHtml = renderResult(await call('/student/result'));
      } catch (e) {
        resultHtml = '';
      }
    }

    const mockRows = st.mocks
      .map((m) => `
        <li class="mock ${m.completed ? 'done' : ''}">
          <div>
            <div class="mock-name">Mock test ${m.number}</div>
            <div class="mock-note">${m.completed ? `Your score: ${esc(m.score)} out of ${esc(m.maxMarks)}` : 'Practice only. The score does not count.'}</div>
          </div>
          ${m.completed
            ? `<button class="btn btn-ghost btn-sm" data-mock-result="${m.number}">View answers</button>`
            : `<button class="btn btn-primary btn-sm" data-mock-start="${m.number}" ${st.state === 'submitted' || st.state === 'missed' ? 'disabled' : ''}>Start</button>`}
        </li>`)
      .join('');

    app.innerHTML = `
      <div class="wrap">
        <div class="page-head">
          <span class="slash"></span>
          <h1>Hello, ${esc(st.student.name.split(' ')[0])}</h1>
          <p class="muted">${esc(st.student.collegeName)}. Applying for ${esc(st.student.testFor)}.</p>
        </div>
        <div class="hub-grid">
          <div>
            <section class="block" id="state-block">${stateBlock(st)}</section>
            ${resultHtml}
          </div>
          <div>
            ${st.mocks.length ? `<section class="block"><h2>Mock tests</h2><ul class="mock-list">${mockRows}</ul></section>` : ''}
            <section class="block">
              <h2>Before you start</h2>
              <ul class="ticks">
                <li>${esc(st.markingScheme)}</li>
                <li>The exam lasts ${esc(st.durationMinutes)} minutes. The timer starts for everyone at the scheduled time.</li>
                <li>Your answers are saved automatically. When the timer ends, your answers are submitted for you.</li>
                <li>Do not close or refresh the page during the exam.</li>
              </ul>
            </section>
          </div>
        </div>
      </div>`;

    $$('[data-mock-start]').forEach((b) => { b.onclick = () => startMock(Number(b.dataset.mockStart)); });
    $$('[data-mock-result]').forEach((b) => { b.onclick = () => viewMockResult(Number(b.dataset.mockResult)); });
    const startBtn = $('#btn-start-exam');
    if (startBtn) startBtn.onclick = startExam;

    // live countdown + background refresh
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const before = signature(S.status);
        await loadStatus();
        // only redraw the hub if it is still on screen (never wipe a mock test or the exam the student just opened)
        if (signature(S.status) !== before && document.getElementById('state-block')) showHub();
      } catch (e) { /* offline: keep what we have */ }
      refreshing = false;
    };
    const tick = () => {
      const cd = $('#cd');
      const s = S.status;
      if (!cd || !s.startTime) return;
      const ms = s.startTime - Clock.now();
      if (ms > 0) cd.textContent = fmtCountdown(ms);
      else {
        cd.textContent = '00:00:00';
        if (s.state === 'waiting') refresh();
      }
    };
    tick();
    every(tick, 1000);
    every(refresh, 30000);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    S.cleanup.push(() => window.removeEventListener('focus', onFocus));
  }

  function stateBlock(st) {
    const when = st.startTime ? `${fmtDate(st.startTime)} at ${fmtTime(st.startTime)}` : '';
    switch (st.state) {
      case 'not_scheduled':
        return '<h2>Exam not scheduled yet</h2><p>The company has not set the exam time. Try the mock tests now and check this page again later.</p>';
      case 'mocks_pending': {
        const started = st.startTime && Clock.now() >= st.startTime;
        return `<h2>Finish the mock tests</h2>
          <p class="state-big">${st.mocksRemaining} mock test${st.mocksRemaining > 1 ? 's' : ''} left</p>
          <p>You need to complete all mock tests before the exam opens for you.</p>
          ${started
            ? '<div class="notice warn">The exam has already started. Finish the mock tests quickly. The exam timer is running for everyone.</div>'
            : `<div class="countdown"><span id="cd">--:--:--</span><small>until the exam starts (${esc(when)})</small></div>`}`;
      }
      case 'waiting':
        return `<h2>You are ready. Wait for the exam to start.</h2>
          <div class="countdown"><span id="cd">--:--:--</span><small>until the exam starts (${esc(when)})</small></div>
          <p>Keep this page open. The start button turns on by itself at the scheduled time.</p>
          <button class="btn btn-primary btn-lg" disabled>Exam opens at ${esc(fmtTime(st.startTime))}</button>`;
      case 'ready':
        return `<h2>The exam is open</h2>
          <p>The timer ends at ${esc(fmtTime(st.endTime))}, the same time for everyone. Start now to use all the time you have.</p>
          <button class="btn btn-red btn-lg" id="btn-start-exam">Start the exam</button>`;
      case 'in_progress':
        return '<h2>Your exam is in progress</h2><button class="btn btn-red btn-lg" id="btn-start-exam">Go back to the exam</button>';
      case 'submitted':
        return `<h2>Your exam is submitted</h2>
          <p>${st.resultPublished ? 'Your result is below.' : 'Your result does not show right after the exam. It appears here once the company publishes it. Check this page again later.'}</p>`;
      case 'missed':
        return '<h2>The exam window is closed</h2><p>You did not start the exam before the time ended. Please contact the company if you think this is a mistake.</p>';
      default:
        return '';
    }
  }

  function renderResult(r) {
    if (!r.published) return '';
    if (!r.attended) return `<section class="block result-panel"><h2>Result</h2><p>${esc(r.message)}</p></section>`;
    const good = r.status === 'shortlisted';
    const gradeClass = String(r.grade || '').toLowerCase().replace(/\s+/g, '-');
    return `<section class="block result-panel ${good ? 'shortlisted' : 'rejected'}">
      <h2>${good ? 'You are shortlisted' : 'You are not shortlisted this time'}</h2>
      <div class="result-stats">
        <div><span class="rs-label">Marks</span><span class="rs-val">${esc(r.score)}<small> / ${esc(r.maxMarks)}</small></span></div>
        <div><span class="rs-label">Percentage</span><span class="rs-val">${esc(r.percentage)}<small>%</small></span></div>
        <div><span class="rs-label">Grade</span><span class="rs-val"><span class="grade g-${gradeClass}">${esc(r.grade)}</span></span></div>
      </div>
      <p class="muted">Attempted ${esc(r.attempted)} of ${esc(r.totalQuestions)} questions. ${esc(r.correct)} correct, ${esc(r.wrong)} wrong.</p>
      <p>${esc(r.message)}</p>
    </section>`;
  }

  // ---------------------------------------------------------------- quiz component (mock + exam)
  function renderQuiz(container, o) {
    const qs = o.questions;
    const answers = o.answers;
    let idx = 0;
    let advanceTimer = null;

    container.innerHTML = `
      <div class="quiz">
        <aside class="quiz-side">
          <div class="tally" id="tally"></div>
          <div class="legend"><span><i class="a"></i>Answered</span><span><i></i>Not answered</span></div>
          <div class="palette" id="pal"></div>
          <button class="btn btn-red" id="q-submit" type="button" style="width:100%">${esc(o.submitText)}</button>
          ${o.sideNote ? `<p class="side-note">${esc(o.sideNote)}</p>` : ''}
        </aside>
        <div>
          <div class="q-meta"><span>Question <b id="qn"></b> of ${qs.length}</span><span id="qmarks"></span></div>
          <h2 class="q-text" id="qtext"></h2>
          <div class="opts" id="opts" role="radiogroup" aria-labelledby="qtext"></div>
          <div class="q-nav">
            <button class="btn btn-ghost" id="q-prev" type="button">Previous</button>
            <button class="btn btn-primary" id="q-next" type="button">Next</button>
            <span class="spacer"></span>
            <button class="btn btn-ghost" id="q-clear" type="button">Clear answer</button>
          </div>
        </div>
      </div>`;

    const q = (sel) => $(sel, container);
    const answeredCount = () => qs.filter((x) => Number.isInteger(answers[x.id])).length;

    function paint() {
      const cur = qs[idx];
      q('#qn').textContent = idx + 1;
      q('#qmarks').textContent = cur.marks ? `Worth ${cur.marks} mark${cur.marks > 1 ? 's' : ''}` : '';
      q('#qtext').textContent = cur.text;
      q('#opts').innerHTML = cur.options
        .map((t, i) => `<button type="button" class="opt" role="radio" aria-checked="${answers[cur.id] === i}" data-i="${i}"><span class="letter">${letter(i)}</span><span class="txt">${esc(t)}</span></button>`)
        .join('');
      $$('.opt', container).forEach((b) => { b.onclick = () => pick(Number(b.dataset.i)); });
      q('#q-prev').disabled = idx === 0;
      q('#q-next').disabled = idx === qs.length - 1;
      q('#q-clear').disabled = !Number.isInteger(answers[cur.id]);
      q('#tally').textContent = `Answered ${answeredCount()} of ${qs.length}`;
      q('#pal').innerHTML = qs
        .map((x, i) => `<button type="button" class="tile ${Number.isInteger(answers[x.id]) ? 'answered' : ''} ${i === idx ? 'current' : ''}" data-go="${i}" aria-label="Question ${i + 1}${Number.isInteger(answers[x.id]) ? ', answered' : ''}">${i + 1}</button>`)
        .join('');
      $$('.tile', container).forEach((b) => { b.onclick = () => go(Number(b.dataset.go)); });
    }
    function go(i) {
      clearTimeout(advanceTimer);
      idx = Math.max(0, Math.min(qs.length - 1, i));
      paint();
    }
    function pick(i) {
      const at = idx;
      answers[qs[at].id] = i;
      o.onChange();
      paint();
      // Answered: move on to the next question by itself (a short pause shows the chosen option first)
      clearTimeout(advanceTimer);
      if (at < qs.length - 1) advanceTimer = setTimeout(() => { if (idx === at) go(at + 1); }, 450);
    }

    q('#q-prev').onclick = () => go(idx - 1);
    q('#q-next').onclick = () => go(idx + 1);
    q('#q-clear').onclick = () => { delete answers[qs[idx].id]; o.onChange(); paint(); };
    q('#q-submit').onclick = () => o.onSubmit({ answered: answeredCount(), total: qs.length });

    const onKey = (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') go(idx + 1);
      else if (e.key === 'ArrowLeft') go(idx - 1);
      else if (/^[a-fA-F]$/.test(e.key)) {
        const i = e.key.toUpperCase().charCodeAt(0) - 65;
        if (i < qs[idx].options.length) pick(i);
      }
    };
    document.addEventListener('keydown', onKey);
    S.cleanup.push(() => { document.removeEventListener('keydown', onKey); clearTimeout(advanceTimer); });

    paint();
    return { answeredCount, reset() { clearTimeout(advanceTimer); idx = 0; paint(); } };
  }

  // ---------------------------------------------------------------- mock tests
  async function startMock(n) {
    leaveView();
    app.innerHTML = '<div class="loading">Loading the mock test...</div>';
    let data;
    try {
      data = await call(`/student/mocks/${n}/questions`);
    } catch (e) {
      toast(e.message, 'error');
      await loadStatus().catch(() => {});
      return showHub();
    }
    const mockKey = `af_mock_${S.status.student.id}_${n}`;
    let answers = {};
    try { answers = JSON.parse(sessionStorage.getItem(mockKey) || '{}'); } catch (e) { answers = {}; }
    app.innerHTML = `
      <div class="exam-bar"><div class="exam-title">Mock test ${n}<span class="exam-sub">Practice only. The score does not count.</span></div>
      <button class="btn btn-ghost btn-sm" id="mock-exit" style="color:#fff;border-color:rgba(255,255,255,.4)">Leave mock test</button></div>
      <div class="proctor-note" id="proctor-note"></div>
      <div class="wrap" id="quiz"></div>`;
    const clearOnSwitch = data.clearOnSwitch !== false;
    const M = { warnings: 0, away: false, pending: false, submitting: false };
    const paintNote = () => {
      $('#proctor-note').textContent = `Same rules as the real exam: do not switch tabs or windows.${clearOnSwitch ? ' If you leave this page, all your selected answers are cleared.' : ''}${M.warnings ? ` Warnings so far: ${M.warnings}.` : ''}`;
      $('#proctor-note').classList.toggle('hit', M.warnings > 0);
    };
    paintNote();
    $('#mock-exit').onclick = async () => {
      const ok = await confirmModal({ title: 'Leave this mock test?', body: '<p>Your answers in this mock test will be lost.</p>', confirmText: 'Leave', cancelText: 'Keep going' });
      if (ok) { try { sessionStorage.removeItem(mockKey); } catch (e) { /* ignore */ } await loadStatus().catch(() => {}); showHub(); }
    };
    const quiz = renderQuiz($('#quiz'), {
      questions: data.questions,
      answers,
      submitText: 'Submit mock test',
      sideNote: 'Submit to see which answers were right and wrong.',
      onChange() { try { sessionStorage.setItem(mockKey, JSON.stringify(answers)); } catch (e) { /* ignore */ } },
      async onSubmit({ answered, total }) {
        const ok = await confirmModal({
          title: 'Submit this mock test?',
          body: `<p>You answered ${answered} of ${total} questions.${answered < total ? ' Unanswered questions are not marked.' : ''}</p>`,
          confirmText: 'Submit mock test',
          cancelText: 'Keep working',
        });
        if (!ok) return;
        try {
          const res = await call(`/student/mocks/${n}/submit`, { method: 'POST', json: { answers } });
          try { sessionStorage.removeItem(mockKey); } catch (e) { /* ignore */ }
          await loadStatus().catch(() => {});
          showReview(res);
        } catch (e) {
          toast(e.message, 'error');
        }
      },
    });
    // tab-switch rule (practice only: nothing is sent to the server or counted for the company)
    const leftMock = () => {
      if (M.away || M.submitting) return;
      M.away = true; M.warnings += 1; M.pending = true;
      if (clearOnSwitch) {
        Object.keys(answers).forEach((k) => delete answers[k]);
        try { sessionStorage.removeItem(mockKey); } catch (e) { /* ignore */ }
        quiz.reset();
      }
    };
    const showMockWarning = () => {
      if (!M.pending || document.visibilityState !== 'visible') return;
      M.pending = false;
      paintNote();
      const m = openModal(`
        <h2>Warning: you left the mock test</h2>
        <p>You switched away from this tab or window (warning ${esc(M.warnings)}). In the real exam this is recorded for the company.</p>
        <p>${clearOnSwitch ? '<b>All the answers you selected have been cleared.</b> Please answer the questions again.' : 'Please stay on this page until you submit.'}</p>
        <div class="modal-actions"><button class="btn btn-red" data-ok>I understand</button></div>`, { locked: true });
      m.el.querySelector('[data-ok]').onclick = m.close;
      m.el.querySelector('[data-ok]').focus();
    };
    const onVis = () => { if (document.visibilityState === 'hidden') leftMock(); else { M.away = false; showMockWarning(); } };
    let blurT = null;
    const onBlurM = () => { clearTimeout(blurT); blurT = setTimeout(() => { if (!document.hasFocus()) leftMock(); }, 350); };
    const onFocusM = () => { clearTimeout(blurT); M.away = false; showMockWarning(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlurM);
    window.addEventListener('focus', onFocusM);
    S.cleanup.push(() => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlurM);
      window.removeEventListener('focus', onFocusM);
      clearTimeout(blurT);
    });
  }

  async function viewMockResult(n) {
    try {
      showReview(await call(`/student/mocks/${n}/result`));
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function showReview(r) {
    leaveView();
    setChrome();
    const items = r.review
      .map((it) => `
        <article class="rv ${it.isCorrect ? 'ok' : 'bad'}">
          <div class="rv-head">
            <div class="rv-q">${esc(it.text)}</div>
            <span class="badge ${it.isCorrect ? 'ok' : 'bad'}">${it.isCorrect ? 'Correct' : 'Wrong'} ${esc(signed(it.marksAwarded))}</span>
          </div>
          <ul class="rv-opts">
            ${it.options.map((t, i) => {
              const isCorrect = i === it.correctIndex;
              const isPicked = i === it.selectedIndex;
              const cls = isCorrect ? 'is-correct' : isPicked ? 'is-wrong' : '';
              const tag = isCorrect && isPicked ? 'Your answer, correct' : isCorrect ? 'Correct answer' : isPicked ? 'Your answer' : '';
              return `<li class="${cls}"><b>${letter(i)}</b><span>${esc(t)}</span>${tag ? `<span class="tag">${tag}</span>` : ''}</li>`;
            }).join('')}
          </ul>
          ${it.explanation ? `<p class="rv-explain">${esc(it.explanation)}</p>` : ''}
        </article>`)
      .join('');

    app.innerHTML = `
      <div class="wrap">
        <div class="page-head">
          <span class="slash"></span>
          <h1>Mock test ${esc(r.mock)} result</h1>
          <div class="review-summary">
            <div class="stat"><b>${esc(r.score)} / ${esc(r.maxMarks)}</b>Score</div>
            <div class="stat"><b>${esc(r.attempted)} / ${esc(r.totalQuestions)}</b>Attempted</div>
            <div class="stat"><b>${esc(r.correct)}</b>Correct</div>
            <div class="stat"><b>${esc(r.wrong)}</b>Wrong</div>
            <div class="stat"><b>${esc(r.unattempted)}</b>Not attempted</div>
          </div>
          <button class="btn btn-primary" id="rv-back">Back to my page</button>
        </div>
        <h2 style="margin:26px 0 14px">Questions you attempted</h2>
        ${items || '<div class="empty">You did not attempt any question in this mock test.</div>'}
        <p style="margin:22px 0 64px"><button class="btn btn-primary" id="rv-back2">Back to my page</button></p>
      </div>`;
    const back = async () => { await loadStatus().catch(() => {}); showHub(); window.scrollTo(0, 0); };
    $('#rv-back').onclick = back;
    $('#rv-back2').onclick = back;
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- main exam
  async function startExam() {
    leaveView();
    app.innerHTML = '<div class="loading">Opening your exam...</div>';
    let data;
    try {
      data = await call('/student/exam/start', { method: 'POST' });
    } catch (e) {
      toast(e.message, 'error');
      await loadStatus().catch(() => {});
      return showHub({ noAuto: true });
    }
    runExam(data);
  }

  function runExam(data) {
    leaveView();
    const key = `af_ans_${S.status.student.id}`;
    // answers are also kept in this browser (all tabs) so switching or reloading a tab never loses them
    const readLocal = () => {
      let out = {};
      for (const store of [localStorage, sessionStorage]) {
        try { out = { ...out, ...JSON.parse(store.getItem(key) || '{}') }; } catch (e) { /* ignore */ }
      }
      return out;
    };
    const writeLocal = (obj) => { for (const store of [localStorage, sessionStorage]) { try { store.setItem(key, JSON.stringify(obj)); } catch (e) { /* storage full or blocked */ } } };
    const clearLocal = () => { for (const store of [localStorage, sessionStorage]) { try { store.removeItem(key); } catch (e) { /* ignore */ } } };
    const local = readLocal();
    const answers = { ...(data.savedAnswers || {}), ...local };
    const E = { dirty: Object.keys(local).length > 0, saving: false, finishing: false, epoch: data.tabSwitches || 0, reported: data.tabSwitches || 0, warnings: data.tabSwitches || 0, pendingWarning: false, away: false, reporting: false };
    const clearOnSwitch = data.clearOnSwitch !== false;
    // use the server's remaining time, then count with the local clock (no dependence on the PC clock being right)
    const endsAtLocal = Date.now() + data.msRemaining;
    const remaining = () => endsAtLocal - Date.now();

    app.innerHTML = `
      <div class="exam-bar">
        <div class="exam-title">${esc(S.landing.exam.examName)}<span class="exam-sub">${esc(S.status.student.name)}</span></div>
        <div class="timer" id="timer" role="timer" aria-label="Time left">--:--</div>
      </div>
      <div class="proctor-note" id="proctor-note"></div>
      <div class="wrap" id="quiz"></div>`;
    const paintNote = () => {
      $('#proctor-note').textContent = `${clearOnSwitch ? 'Do not switch tabs or windows. If you leave this page, all your selected answers are cleared.' : 'Do not switch tabs or windows. Leaving this page is recorded.'}${E.warnings ? ` Warnings so far: ${E.warnings}.` : ''}`;
      $('#proctor-note').classList.toggle('hit', E.warnings > 0);
    };
    paintNote();

    const timerEl = $('#timer');
    const paintTimer = () => {
      const ms = remaining();
      timerEl.textContent = fmtClock(ms);
      timerEl.classList.toggle('warn', ms <= 5 * 60000 && ms > 60000);
      timerEl.classList.toggle('danger', ms <= 60000);
      if (ms <= 0) finish(true);
    };

    async function save(keepalive) {
      if (!E.dirty || E.saving || E.finishing) return;
      E.saving = true;
      try {
        await call('/student/exam/answers', { method: 'PUT', json: { answers, epoch: E.epoch }, keepalive: !!keepalive });
        E.dirty = false;
      } catch (e) { /* try again on the next round */ }
      E.saving = false;
    }

    const quiz = renderQuiz($('#quiz'), {
      questions: data.questions,
      answers,
      submitText: 'Submit exam',
      sideNote: data.markingScheme,
      onChange() {
        E.dirty = true;
        writeLocal(answers);
        clearTimeout(E.saveTimer);
        E.saveTimer = setTimeout(() => save(false), 8000); // save soon after the last click, not only once a minute
      },
      async onSubmit({ answered, total }) {
        const left = total - answered;
        const ok = await confirmModal({
          title: 'Submit your exam?',
          body: `<p>You answered ${answered} of ${total} questions${left ? `, and ${left} ${left > 1 ? 'are' : 'is'} not answered` : ''}. You cannot change your answers after you submit.</p>`,
          confirmText: 'Submit exam',
          cancelText: 'Keep working',
          danger: true,
        });
        if (ok) finish(false);
      },
    });

    async function finish(auto) {
      if (E.finishing) return;
      E.finishing = true;
      leaveView();
      app.innerHTML = `<div class="wrap"><div class="loading"><h2>${auto ? 'Time is up. Submitting your answers...' : 'Submitting your answers...'}</h2><p>Do not close this page.</p></div></div>`;
      let done = false;
      for (let attempt = 0; attempt < 5 && !done; attempt += 1) {
        try {
          await call('/student/exam/submit', { method: 'POST', json: { answers, auto: !!auto } });
          done = true;
        } catch (e) {
          if (e.status === 401) return; // logged out; the server will still auto-submit saved answers
          await sleep(2000);
        }
      }
      if (!done) {
        app.innerHTML = `<div class="wrap"><div class="block" style="margin:40px 0"><h2>We could not reach the server</h2>
          <p>Keep this page open and check your internet. Your saved answers are submitted automatically when the exam time ends.</p>
          <button class="btn btn-primary" id="retry-submit">Try again</button></div></div>`;
        $('#retry-submit').onclick = () => { E.finishing = false; finish(auto); };
        return;
      }
      clearLocal();
      await loadStatus().catch(() => {});
      showSubmitted();
    }

    paintTimer();
    every(paintTimer, 250);
    every(() => save(false), 60000); // one save a minute keeps the database inside its free limits
    // ---- tab-switch rule: warning + (optionally) every selected answer is cleared
    async function reportLeave() {
      if (E.reporting) return;
      E.reporting = true;
      try {
        const r = await call('/student/exam/violation', { method: 'POST', json: { seq: E.epoch }, keepalive: true });
        E.reported = Math.max(E.reported, E.epoch);
        if (r && typeof r.tabSwitches === 'number') E.warnings = Math.max(E.warnings, r.tabSwitches);
      } catch (e) { /* retried below until the server has it */ }
      E.reporting = false;
    }
    function leftExam() {
      if (E.away || E.finishing) return;
      E.away = true;
      E.epoch += 1;
      E.warnings += 1;
      E.pendingWarning = true;
      if (clearOnSwitch) {
        Object.keys(answers).forEach((k) => delete answers[k]);
        clearLocal();
        clearTimeout(E.saveTimer);
        E.dirty = false;
        quiz.reset();
      }
      reportLeave();
    }
    function showWarning() {
      if (!E.pendingWarning || E.finishing || document.visibilityState !== 'visible') return;
      E.pendingWarning = false;
      paintNote();
      const m = openModal(`
        <h2>Warning: you left the exam</h2>
        <p>You switched away from the exam tab or window. This has been recorded (warning ${esc(E.warnings)}).</p>
        <p>${clearOnSwitch ? '<b>All the answers you selected have been cleared.</b> Please answer the questions again. The timer kept running.' : 'Please stay on this page until you submit.'}</p>
        <p class="muted small">Leaving again will ${clearOnSwitch ? 'clear your answers again' : 'be recorded again'}.</p>
        <div class="modal-actions"><button class="btn btn-red" data-ok>I understand</button></div>`, { locked: true });
      m.el.querySelector('[data-ok]').onclick = m.close;
      m.el.querySelector('[data-ok]').focus();
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') leftExam();
      else { E.away = false; showWarning(); }
    };
    let blurTimer = null;
    const onBlur = () => {
      clearTimeout(blurTimer);
      blurTimer = setTimeout(() => { if (!document.hasFocus()) leftExam(); }, 350);
    };
    const onFocus = () => { clearTimeout(blurTimer); E.away = false; showWarning(); };
    const onPageHide = () => { if (!clearOnSwitch) save(true); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', onPageHide);
    every(() => { if (E.reported < E.epoch) reportLeave(); }, 3000); // make sure the server got every warning
    S.cleanup.push(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pagehide', onPageHide);
      clearTimeout(blurTimer);
      clearTimeout(E.saveTimer);
    });
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    S.cleanup.push(() => window.removeEventListener('beforeunload', onBeforeUnload));
    window.scrollTo(0, 0);
  }

  function showSubmitted() {
    leaveView();
    setChrome();
    app.innerHTML = `
      <div class="wrap">
        <div class="page-head">
          <span class="slash"></span>
          <h1>Your exam is submitted</h1>
          <p class="muted" style="max-width:60ch">Thank you. We do not show the result right after the exam. It appears on your page once the company publishes it. Log in again later with your email and contact number to see it.</p>
          <button class="btn btn-primary" id="to-hub">Go to my page</button>
        </div>
      </div>`;
    $('#to-hub').onclick = () => { showHub(); window.scrollTo(0, 0); };
  }

  // ---------------------------------------------------------------- start
  async function boot() {
    try {
      S.landing = await api('/public/landing');
    } catch (e) {
      app.innerHTML = `<div class="wrap"><div class="notice error" style="margin-top:40px">${esc(e.message)} <button class="btn-link" onclick="location.reload()">Reload</button></div></div>`;
      return;
    }
    if (S.token) {
      try {
        await loadStatus();
        return showHub();
      } catch (e) {
        if (e.status !== 401) {
          app.innerHTML = `<div class="wrap"><div class="notice error" style="margin-top:40px">${esc(e.message)} <button class="btn-link" onclick="location.reload()">Reload</button></div></div>`;
          return;
        }
      }
    }
    showLanding();
  }

  boot();
})();
