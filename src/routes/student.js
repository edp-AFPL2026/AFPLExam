const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { db } = require('../firebase');
const { uploadResume } = require('../drive');
const { sign, requireStudent } = require('../middleware/auth');
const { getExamConfig, examEndTime, describeMarking } = require('../config');
const { getSet, publicQuestion } = require('../services/questions');
const { finalizeAttempt, finalizeIfExpired, GRACE_MS } = require('../services/attempts');
const { gradeAnswers } = require('../utils/grading');
const { evaluate } = require('../utils/result');
const { clientKey, HttpError, asyncHandler, normEmail, normPhone, studentIdFromEmail } = require('../utils/helpers');

const router = express.Router();

// College labs usually share ONE public IP, so these limits are deliberately generous.
const registerLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 400, standardHeaders: true, legacyHeaders: false, keyGenerator: clientKey, validate: { ip: false } });
const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false, keyGenerator: clientKey, validate: { ip: false } });

const ALLOWED_RESUME = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
const upload = multer({
  storage: multer.memoryStorage(),
  // Netlify Functions accept request bodies up to ~6 MB, so keep resumes at 4 MB
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) =>
    ALLOWED_RESUME[file.mimetype] ? cb(null, true) : cb(new HttpError(400, 'Resume must be a PDF, DOC or DOCX file')),
});

const answersSchema = z.record(z.string().max(128), z.number().int().min(0).max(9)).refine((o) => Object.keys(o).length <= 1000, 'Too many answers');

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(160),
  contact: z.string().trim().regex(/^\+?[0-9\s-]{10,15}$/, 'Enter a valid contact number'),
  collegeId: z.string().min(1),
  branch: z.string().trim().min(2).max(120),
  testFor: z.string().trim().min(2).max(120),
  placeId: z.string().min(1),
});

// ---------------------------------------------------------------- helpers
async function loadStudent(id) {
  const snap = await db.collection('students').doc(id).get();
  if (!snap.exists) throw new HttpError(401, 'Student not found. Please register again');
  return { id: snap.id, ...snap.data() };
}

async function loadAttempt(id) {
  const snap = await db.collection('attempts').doc(id).get();
  return snap.exists ? finalizeIfExpired({ id: snap.id, ...snap.data() }) : null;
}

const mocksDone = (student) => Object.keys(student.mocks || {}).length;

function tokenFor(student) {
  return sign({ sub: student.id, role: 'student' }, '24h');
}

// A result is visible only after the admin published it for THIS student. An exam submitted after the last
// "Publish results" click stays hidden until the admin publishes again.
function resultVisible(cfg, attempt) {
  if (!cfg.resultPublished) return false;
  if (attempt && attempt.status === 'in_progress') return false;
  if (attempt && attempt.status === 'submitted') return !!attempt.resultStatus;
  return true;
}

// ---------------------------------------------------------------- register / login
router.post(
  '/register',
  registerLimiter,
  upload.single('resume'),
  asyncHandler(async (req, res) => {
    const cfg = await getExamConfig();
    if (!cfg.registrationOpen) throw new HttpError(403, 'Registration is closed');

    const data = registerSchema.parse(req.body);
    // The resume is optional
    if (req.file && req.file.mimetype === 'application/pdf' && !req.file.buffer.subarray(0, 5).toString().startsWith('%PDF')) {
      throw new HttpError(400, 'The resume file is not a valid PDF');
    }

    const email = normEmail(data.email);
    const id = studentIdFromEmail(email);
    const ref = db.collection('students').doc(id);
    if ((await ref.get()).exists) {
      throw new HttpError(409, 'This email is already registered. Please use "Continue" and log in with your email and contact number.');
    }

    const [collegeSnap, placeSnap] = await Promise.all([
      db.collection('colleges').doc(data.collegeId).get(),
      db.collection('places').doc(data.placeId).get(),
    ]);
    if (!collegeSnap.exists) throw new HttpError(400, 'Please select a valid college');
    if (!placeSnap.exists) throw new HttpError(400, 'Please select a valid place');

    let resume = { url: null, fileId: null };
    if (req.file) {
      resume = await uploadResume({
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        ext: ALLOWED_RESUME[req.file.mimetype],
        collegeName: collegeSnap.data().name,
        studentName: data.name,
        contact: normPhone(data.contact),
      });
    }

    const student = {
      name: data.name,
      email,
      contact: normPhone(data.contact),
      collegeId: data.collegeId,
      collegeName: collegeSnap.data().name,
      placeId: data.placeId,
      placeName: placeSnap.data().name,
      branch: data.branch,
      testFor: data.testFor,
      resumeUrl: resume.url, // Google Drive link (opens for the Drive owner account)
      resumeFileId: resume.fileId,
      mocks: {},
      manualDecision: null,
      createdAt: Date.now(),
    };

    await db.runTransaction(async (t) => {
      if ((await t.get(ref)).exists) throw new HttpError(409, 'This email is already registered');
      t.set(ref, student);
    });

    res.status(201).json({ token: tokenFor({ id }), student: { id, name: student.name, email } });
  })
);

// Returning students (browser closed / refreshed / PC restarted) log in with e-mail + contact number
router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, contact } = z.object({ email: z.string().email(), contact: z.string().min(10) }).parse(req.body);
    const id = studentIdFromEmail(email);
    const snap = await db.collection('students').doc(id).get();
    if (!snap.exists || snap.data().contact !== normPhone(contact)) {
      throw new HttpError(401, 'Email or contact number is incorrect');
    }
    res.json({ token: tokenFor({ id }), student: { id, name: snap.data().name, email: snap.data().email } });
  })
);

router.use(requireStudent);

// ---------------------------------------------------------------- status (the frontend polls this)
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const [cfg, student, attempt] = await Promise.all([getExamConfig(), loadStudent(req.user.sub), loadAttempt(req.user.sub)]);
    const now = Date.now();
    const start = cfg.startTime;
    const end = examEndTime(cfg);
    const mocksRemaining = Math.max(0, cfg.mockCount - mocksDone(student));

    let state;
    if (attempt && attempt.status === 'submitted') state = 'submitted';
    else if (attempt && attempt.status === 'in_progress') state = 'in_progress';
    else if (!start) state = 'not_scheduled';
    else if (now >= end) state = 'missed';
    else if (cfg.requireMocks && mocksRemaining > 0) state = 'mocks_pending';
    else if (now < start) state = 'waiting';
    else state = 'ready';

    res.json({
      serverTime: now,
      examName: cfg.examName,
      student: { id: student.id, name: student.name, email: student.email, collegeName: student.collegeName, testFor: student.testFor },
      state,
      startTime: start,
      endTime: end,
      durationMinutes: cfg.durationMinutes,
      msToStart: start ? Math.max(0, start - now) : null,
      msRemaining: attempt && attempt.status === 'in_progress' ? Math.max(0, attempt.endsAt - now) : null,
      markingScheme: describeMarking(cfg),
      mocksRequired: cfg.requireMocks,
      mocks: Array.from({ length: cfg.mockCount }, (_, i) => {
        const m = (student.mocks || {})[i + 1];
        return { number: i + 1, completed: !!m, score: m ? m.score : null, maxMarks: m ? m.maxMarks : null };
      }),
      mocksRemaining,
      // true only once the admin has published AND this student's result was part of that publish
      resultPublished: resultVisible(cfg, attempt),
    });
  })
);

// ---------------------------------------------------------------- mock tests
async function mockSetFor(req) {
  const cfg = await getExamConfig();
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 1 || n > cfg.mockCount) throw new HttpError(404, 'Mock test not found');
  return { cfg, n, setName: `mock${n}` };
}

router.get(
  '/mocks/:n/questions',
  asyncHandler(async (req, res) => {
    const { n, setName } = await mockSetFor(req);
    const student = await loadStudent(req.user.sub);
    if ((student.mocks || {})[n]) throw new HttpError(409, 'You have already submitted this mock test. Open its result instead.');
    const questions = await getSet(setName);
    if (!questions.length) throw new HttpError(404, 'Questions for this mock test are not uploaded yet');
    const cfg = await getExamConfig();
    res.json({ mock: n, total: questions.length, clearOnSwitch: cfg.clearAnswersOnTabSwitch !== false, questions: questions.map(publicQuestion) });
  })
);

router.post(
  '/mocks/:n/submit',
  asyncHandler(async (req, res) => {
    const { cfg, n, setName } = await mockSetFor(req);
    const { answers } = z.object({ answers: answersSchema }).parse(req.body);
    const student = await loadStudent(req.user.sub);
    if ((student.mocks || {})[n]) throw new HttpError(409, 'You have already submitted this mock test');

    const questions = await getSet(setName);
    const g = gradeAnswers(questions, answers, cfg);
    const summary = {
      score: g.score,
      correct: g.correct,
      wrong: g.wrong,
      attempted: g.attempted,
      unattempted: g.unattempted,
      totalQuestions: g.totalQuestions,
      maxMarks: g.maxMarks,
      submittedAt: Date.now(),
    };

    await db.collection('students').doc(student.id).set({ mocks: { [n]: summary } }, { merge: true });
    await db.collection('mockAttempts').doc(`${student.id}_${n}`).set({ studentId: student.id, mock: n, ...summary, review: g.review });

    // Shows ONLY the attempted questions, marked correct / wrong, plus the score
    res.json({ mock: n, ...summary, review: g.review });
  })
);

router.get(
  '/mocks/:n/result',
  asyncHandler(async (req, res) => {
    const { n } = await mockSetFor(req);
    const snap = await db.collection('mockAttempts').doc(`${req.user.sub}_${n}`).get();
    if (!snap.exists) throw new HttpError(404, 'You have not submitted this mock test yet');
    res.json(snap.data());
  })
);

// ---------------------------------------------------------------- main exam
router.post(
  '/exam/start',
  asyncHandler(async (req, res) => {
    const cfg = await getExamConfig();
    const student = await loadStudent(req.user.sub);
    const now = Date.now();
    const start = cfg.startTime;
    const end = examEndTime(cfg);

    const existing = await loadAttempt(student.id);
    if (existing && existing.status === 'submitted') throw new HttpError(409, 'You have already submitted the exam');

    if (!start) throw new HttpError(403, 'The exam has not been scheduled yet');
    if (!existing) {
      if (now < start) throw new HttpError(403, 'The exam has not started yet', { msToStart: start - now });
      if (now >= end) throw new HttpError(410, 'The exam window is closed');
      if (cfg.requireMocks && mocksDone(student) < cfg.mockCount) {
        throw new HttpError(403, 'Please complete all mock tests before starting the exam');
      }
    }

    const questions = await getSet('exam');
    if (!questions.length) throw new HttpError(500, 'Exam questions are not uploaded yet. Please inform the invigilator');

    let attempt = existing;
    if (!attempt) {
      attempt = {
        id: student.id,
        studentId: student.id,
        collegeId: student.collegeId,
        collegeName: student.collegeName,
        placeId: student.placeId,
        status: 'in_progress',
        startedAt: now,
        // Everybody shares the same end time: scheduled start + duration (late starters get less time)
        endsAt: end,
        answers: {},
        marking: { markingType: cfg.markingType, positiveMarks: cfg.positiveMarks, negativeMarks: cfg.negativeMarks },
        autoSubmitted: false,
      };
      const { id, ...doc } = attempt;
      await db.runTransaction(async (t) => {
        const ref = db.collection('attempts').doc(id);
        if ((await t.get(ref)).exists) return;
        t.set(ref, doc);
      });
      attempt = await loadAttempt(student.id);
    }

    res.json({
      serverTime: Date.now(),
      endsAt: attempt.endsAt,
      msRemaining: Math.max(0, attempt.endsAt - Date.now()),
      markingScheme: describeMarking({ ...cfg, ...attempt.marking }),
      savedAnswers: attempt.answers || {},
      tabSwitches: attempt.tabSwitches || 0,
      clearOnSwitch: cfg.clearAnswersOnTabSwitch !== false,
      total: questions.length,
      questions: questions.map(publicQuestion),
    });
  })
);

// Auto-save (call every ~10-15 s and on each answer change). Needed so that auto-submit still has the answers
router.put(
  '/exam/answers',
  asyncHandler(async (req, res) => {
    const { answers, epoch } = z.object({ answers: answersSchema, epoch: z.number().int().min(0).optional() }).parse(req.body);
    const attempt = await loadAttempt(req.user.sub);
    if (!attempt) throw new HttpError(404, 'Exam not started');
    if (attempt.status === 'submitted') return res.json({ submitted: true });
    if (Date.now() >= attempt.endsAt + GRACE_MS) return res.json({ submitted: true });
    // answers sent before a tab-switch warning must not bring back what the warning cleared
    if (epoch !== undefined && epoch < (attempt.tabSwitches || 0)) return res.json({ saved: false, stale: true, tabSwitches: attempt.tabSwitches || 0 });

    await db.collection('attempts').doc(attempt.id).set({ answers: { ...(attempt.answers || {}), ...answers }, savedAt: Date.now() }, { merge: true });
    return res.json({ saved: true, serverTime: Date.now(), msRemaining: Math.max(0, attempt.endsAt - Date.now()) });
  })
);

// The student left the exam tab. Count it and (unless the admin turned it off) clear every selected answer.
// body: { seq } = the violation number the browser is reporting. Safe to retry (a repeated seq is not counted twice).
router.post(
  '/exam/violation',
  asyncHandler(async (req, res) => {
    const { seq } = z.object({ seq: z.number().int().min(1).optional() }).parse(req.body || {});
    const attempt = await loadAttempt(req.user.sub);
    if (!attempt) throw new HttpError(404, 'Exam not started');
    const cfg = await getExamConfig();
    const clear = cfg.clearAnswersOnTabSwitch !== false;
    const count = attempt.tabSwitches || 0;
    if (attempt.status === 'submitted' || Date.now() >= attempt.endsAt + GRACE_MS) return res.json({ tabSwitches: count, clear });
    if (seq !== undefined && seq <= count) return res.json({ tabSwitches: count, clear }); // already counted
    const update = { tabSwitches: count + 1, lastTabSwitchAt: Date.now() };
    if (clear) update.answers = {};
    await db.collection('attempts').doc(attempt.id).update(update);
    return res.json({ tabSwitches: count + 1, clear });
  })
);

// Submit (button click OR the browser's timer reached zero). NOTE: no score is returned here.
router.post(
  '/exam/submit',
  asyncHandler(async (req, res) => {
    const body = z.object({ answers: answersSchema.optional(), auto: z.boolean().optional() }).parse(req.body || {});
    const attempt = await loadAttempt(req.user.sub);
    if (!attempt) throw new HttpError(404, 'Exam not started');
    if (attempt.status === 'submitted') return res.json({ submitted: true, message: 'Your exam has been submitted.' });

    const withinTime = Date.now() <= attempt.endsAt + GRACE_MS;
    const timerEnded = Date.now() >= attempt.endsAt - 2000;
    await finalizeAttempt(attempt.id, { auto: !!body.auto && timerEnded, answers: withinTime ? body.answers || null : null });
    res.json({ submitted: true, message: 'Your exam has been submitted. Your result will be shown here once the company publishes it.' });
  })
);

// ---------------------------------------------------------------- result (hidden until the admin publishes)
router.get(
  '/result',
  asyncHandler(async (req, res) => {
    const cfg = await getExamConfig();
    const notYet = { published: false, message: 'Your result has not been published yet. Please check again later.' };
    if (!cfg.resultPublished) return res.json(notYet);

    const [student, attempt] = await Promise.all([loadStudent(req.user.sub), loadAttempt(req.user.sub)]);
    if (attempt && attempt.status === 'in_progress') return res.json(notYet);
    if (!attempt || attempt.status !== 'submitted') {
      return res.json({ published: true, attended: false, name: student.name, message: 'You did not attend / submit the exam.' });
    }
    if (!attempt.resultStatus) return res.json(notYet); // submitted after the last publish

    const ev = evaluate(attempt, student.manualDecision, cfg);
    const status = attempt.resultStatus || ev.status;
    res.json({
      published: true,
      attended: true,
      name: student.name,
      score: attempt.score,
      maxMarks: attempt.maxMarks,
      correct: attempt.correct,
      wrong: attempt.wrong,
      attempted: attempt.attempted,
      totalQuestions: attempt.totalQuestions,
      percentage: ev.percentage,
      grade: ev.grade,
      status, // 'shortlisted' | 'rejected'
      message: status === 'shortlisted' ? cfg.shortlistMessage : cfg.rejectMessage,
    });
  })
);

module.exports = router;
