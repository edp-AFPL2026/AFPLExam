const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { parse: parseCsv } = require('csv-parse/sync');
const { z } = require('zod');
const { db } = require('../firebase');
const { sign, requireAdmin } = require('../middleware/auth');
const { getExamConfig, saveExamConfig, getCompany, saveCompany, examEndTime } = require('../config');
const { invalidateQuestionCache } = require('../services/questions');
const { sweepExpired } = require('../services/attempts');
const { trashResume } = require('../drive');
const { evaluate } = require('../utils/result');
const { clientKey, HttpError, asyncHandler, normEmail, commitInChunks, csvCell } = require('../utils/helpers');

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, keyGenerator: clientKey, validate: { ip: false } });

const memUpload = (maxMb, mimeOk) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: Math.round(maxMb * 1024 * 1024), files: 1 },
    fileFilter: (req, file, cb) => (mimeOk(file) ? cb(null, true) : cb(new HttpError(400, 'Unsupported file type'))),
  });
// The logo is stored inside Firestore (as a small data URL), so it must stay under 300 KB
const uploadLogo = memUpload(0.3, (f) => ['image/png', 'image/jpeg', 'image/webp'].includes(f.mimetype));
const uploadCsv = memUpload(5, (f) => /csv|excel|text\/plain/.test(f.mimetype) || /\.csv$/i.test(f.originalname));

// ------------------------------------------------------------------ login
router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const snap = await db.collection('admins').doc(normEmail(email)).get();
    if (!snap.exists || !(await bcrypt.compare(password, snap.data().passwordHash))) {
      throw new HttpError(401, 'Invalid email or password');
    }
    res.json({ token: sign({ sub: snap.id, role: 'admin' }, '12h'), admin: { email: snap.id } });
  })
);

router.use(requireAdmin);
// any change made by the admin refreshes the cached landing-page data (company, colleges, places)
router.use((req, res, next) => {
  if (req.method !== 'GET') res.on('finish', () => require('../services/publicCache').clear());
  next();
});

router.post(
  '/change-password',
  asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = z.object({ oldPassword: z.string(), newPassword: z.string().min(8).max(100) }).parse(req.body);
    const ref = db.collection('admins').doc(req.user.sub);
    const snap = await ref.get();
    if (!(await bcrypt.compare(oldPassword, snap.data().passwordHash))) throw new HttpError(400, 'Old password is wrong');
    await ref.update({ passwordHash: await bcrypt.hash(newPassword, 10) });
    res.json({ ok: true });
  })
);

// ------------------------------------------------------------------ exam settings
// "2026-10-20T10:15" has no time zone, so it is read as India time (+05:30) unless DEFAULT_UTC_OFFSET says otherwise
const DEFAULT_OFFSET = process.env.DEFAULT_UTC_OFFSET || '+05:30';
const toMillis = (v) => {
  if (v === null || v === '') return null;
  let input = v;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(v.trim())) {
    input = `${v.trim().replace(' ', 'T')}${v.trim().length === 16 ? ':00' : ''}${DEFAULT_OFFSET}`;
  }
  const ms = typeof input === 'number' ? input : Date.parse(input);
  if (Number.isNaN(ms)) throw new HttpError(400, 'Invalid start time');
  return ms;
};

const configSchema = z
  .object({
    examName: z.string().trim().min(3).max(120),
    // e.g. "2026-10-20T10:15" (read as India time +05:30) or a full ISO string with its own offset
    startTime: z.union([z.string(), z.number(), z.null()]),
    durationMinutes: z.number().min(1).max(600),
    markingType: z.enum(['positive', 'negative', 'both']),
    positiveMarks: z.number().positive().max(100),
    negativeMarks: z.number().min(0).max(100),
    gradeGreatFrom: z.number().min(0).max(100000),
    gradeVeryGoodFrom: z.number().min(0).max(100000),
    gradeExcellentFrom: z.number().min(0).max(100000),
    shortlistFromMarks: z.number().min(0).max(100000),
    mockCount: z.number().int().min(0).max(9),
    requireMocks: z.boolean(),
    clearAnswersOnTabSwitch: z.boolean(),
    shuffleExamQuestions: z.boolean(),
    examQuestionCount: z.number().int().min(0).max(2000),
    registrationOpen: z.boolean(),
    rules: z.array(z.string().trim().min(1).max(500)).max(30),
    testForOptions: z.array(z.string().trim().min(1).max(120)).max(50),
    branchOptions: z.array(z.string().trim().min(1).max(120)).max(80),
    shortlistMessage: z.string().trim().min(1).max(1500),
    rejectMessage: z.string().trim().min(1).max(1500),
  })
  .partial()
  .strict();

router.get(
  '/exam-config',
  asyncHandler(async (req, res) => {
    const cfg = await getExamConfig();
    res.json({ ...cfg, endTime: examEndTime(cfg), serverTime: Date.now() });
  })
);

router.put(
  '/exam-config',
  asyncHandler(async (req, res) => {
    const patch = configSchema.parse(req.body);
    if ('startTime' in patch) patch.startTime = toMillis(patch.startTime);
    const m = { ...(await getExamConfig()), ...patch };
    if (!(m.gradeGreatFrom < m.gradeVeryGoodFrom && m.gradeVeryGoodFrom < m.gradeExcellentFrom)) {
      throw new HttpError(400, 'Grade limits must go up: Great, then Very Good, then Excellent.');
    }
    if (m.shortlistFromMarks < m.gradeGreatFrom) throw new HttpError(400, 'Shortlist marks cannot be lower than the Great limit (below that is Fail).');
    const cfg = await saveExamConfig(patch);
    res.json({ ...cfg, endTime: examEndTime(cfg) });
  })
);

// ------------------------------------------------------------------ company info + logo
const companySchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    tagline: z.string().trim().max(200),
    about: z.string().trim().min(10).max(5000),
    website: z.string().trim().url(),
    highlights: z.array(z.string().trim().min(1).max(250)).max(20),
    address: z.string().trim().max(500),
    phone: z.string().trim().max(60),
    email: z.string().trim().email(),
  })
  .partial()
  .strict();

router.get('/company', asyncHandler(async (req, res) => res.json(await getCompany())));
router.put('/company', asyncHandler(async (req, res) => res.json(await saveCompany(companySchema.parse(req.body)))));

router.post(
  '/company/logo',
  uploadLogo.single('logo'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Choose a logo image (PNG, JPG or WEBP, max 300 KB)');
    // Stored directly in Firestore as a data URL - no extra storage service needed
    const logoUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    res.json(await saveCompany({ logoUrl }));
  })
);

// ------------------------------------------------------------------ colleges & places (same CRUD)
function simpleList(collection, label) {
  const r = express.Router();

  r.get(
    '/',
    asyncHandler(async (req, res) => {
      const snap = await db.collection(collection).get();
      res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name)));
    })
  );

  // { "name": "ABC College" }  or  { "names": ["A", "B", "C"] } for bulk add
  r.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = z
        .object({ name: z.string().trim().min(2).max(200).optional(), names: z.array(z.string().trim().min(2).max(200)).max(500).optional() })
        .parse(req.body);
      const wanted = [...(body.names || []), ...(body.name ? [body.name] : [])];
      if (!wanted.length) throw new HttpError(400, `Provide a ${label} name`);

      const existing = new Set((await db.collection(collection).get()).docs.map((d) => d.data().name.toLowerCase()));
      const created = [];
      for (const name of wanted) {
        if (existing.has(name.toLowerCase())) continue;
        existing.add(name.toLowerCase());
        const ref = db.collection(collection).doc();
        // eslint-disable-next-line no-await-in-loop
        await ref.set({ name, active: true, createdAt: Date.now() });
        created.push({ id: ref.id, name, active: true });
      }
      res.status(201).json({ created, skippedDuplicates: wanted.length - created.length });
    })
  );

  r.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const patch = z.object({ name: z.string().trim().min(2).max(200).optional(), active: z.boolean().optional() }).strict().parse(req.body);
      const ref = db.collection(collection).doc(req.params.id);
      if (!(await ref.get()).exists) throw new HttpError(404, `${label} not found`);
      await ref.update(patch);
      res.json({ id: ref.id, ...(await ref.get()).data() });
    })
  );

  r.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      await db.collection(collection).doc(req.params.id).delete();
      res.json({ ok: true });
    })
  );
  return r;
}
router.use('/colleges', simpleList('colleges', 'college'));
router.use('/places', simpleList('places', 'place'));

// ------------------------------------------------------------------ questions
const setName = z.string().regex(/^(exam|mock[1-9])$/, 'set must be "exam" or "mock1".."mock9"');

const questionSchema = z
  .object({
    set: setName,
    text: z.string().trim().min(1).max(2000),
    options: z.array(z.string().trim().min(1).max(500)).min(2).max(6),
    correctIndex: z.number().int().min(0),
    marks: z.number().positive().max(100).nullable().optional(), // overrides the default +marks for this question
    negativeMarks: z.number().min(0).max(100).nullable().optional(),
    explanation: z.string().max(2000).optional(),
    order: z.number().int().optional(),
  })
  .strict()
  .refine((q) => q.correctIndex < q.options.length, { message: 'correctIndex must point to one of the options' });

function cleanQuestion(q) {
  const out = { ...q, createdAt: Date.now() };
  if (out.marks == null) delete out.marks;
  if (out.negativeMarks == null) delete out.negativeMarks;
  return out;
}

router.get(
  '/questions',
  asyncHandler(async (req, res) => {
    let ref = db.collection('questions');
    if (req.query.set) ref = ref.where('set', '==', String(req.query.set));
    const snap = await ref.get();
    const list = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.set.localeCompare(b.set) || (a.order ?? 0) - (b.order ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
    res.json({ count: list.length, questions: list });
  })
);

router.post(
  '/questions',
  asyncHandler(async (req, res) => {
    const q = questionSchema.parse(req.body);
    const ref = db.collection('questions').doc();
    await ref.set(cleanQuestion(q));
    invalidateQuestionCache();
    res.status(201).json({ id: ref.id, ...q });
  })
);

router.post(
  '/questions/bulk',
  asyncHandler(async (req, res) => {
    const { questions, replace } = z
      .object({ questions: z.array(questionSchema).min(1).max(1000), replace: z.boolean().optional() })
      .parse(req.body);
    res.status(201).json(await storeQuestions(questions, replace));
  })
);

async function storeQuestions(questions, replace) {
  if (replace) {
    const sets = [...new Set(questions.map((q) => q.set))];
    for (const s of sets) {
      // eslint-disable-next-line no-await-in-loop
      await deleteSet(s);
    }
  }
  const ops = questions.map((q, i) => (batch) => batch.set(db.collection('questions').doc(), { ...cleanQuestion(q), order: q.order ?? i }));
  await commitInChunks(db, ops);
  invalidateQuestionCache();
  return { added: questions.length };
}

async function deleteSet(s) {
  const snap = await db.collection('questions').where('set', '==', s).get();
  await commitInChunks(db, snap.docs.map((d) => (batch) => batch.delete(d.ref)));
  invalidateQuestionCache();
  return snap.size;
}

/**
 * CSV upload. Columns (header row required, any order):
 *   question, optionA, optionB, optionC, optionD, [optionE, optionF], correct, marks, negativeMarks, explanation, set
 *   - correct : A / B / C / D  (or 1-4, or the exact option text)
 *   - set     : exam / mock1 / mock2 / mock3  (optional if you send a `set` field in the form)
 * Form fields: file (csv), set (default set), mode = append | replace
 */
router.post(
  '/questions/upload',
  uploadCsv.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Attach a CSV file in the "file" field');
    const defaultSet = req.body.set;
    const rows = parseCsv(req.file.buffer, {
      columns: (h) => h.map((x) => String(x).trim().toLowerCase().replace(/[\s_]/g, '')),
      skip_empty_lines: true,
      bom: true,
      trim: true,
      relax_column_count: true,
    });
    if (!rows.length) throw new HttpError(400, 'The CSV file is empty');

    const errors = [];
    const questions = [];
    rows.forEach((row, i) => {
      const line = i + 2;
      const options = ['a', 'b', 'c', 'd', 'e', 'f'].map((l) => row[`option${l}`] ?? row[l]).filter((o) => o !== undefined && o !== '');
      const raw = String(row.correct ?? row.answer ?? row.correctanswer ?? '').trim();
      let correctIndex = -1;
      if (/^[a-fA-F]$/.test(raw)) correctIndex = raw.toUpperCase().charCodeAt(0) - 65;
      else if (/^[1-6]$/.test(raw)) correctIndex = Number(raw) - 1;
      else correctIndex = options.findIndex((o) => o.toLowerCase() === raw.toLowerCase());

      const candidate = {
        set: String(row.set || defaultSet || '').trim(),
        text: row.question || row.text || '',
        options,
        correctIndex,
        marks: row.marks ? Number(row.marks) : null,
        negativeMarks: row.negativemarks ? Number(row.negativemarks) : null,
        explanation: row.explanation || '',
      };
      const parsed = questionSchema.safeParse(candidate);
      if (parsed.success) questions.push(parsed.data);
      else errors.push({ line, error: parsed.error.issues.map((x) => x.message).join('; ') });
    });

    if (errors.length) return res.status(400).json({ error: 'Some rows are invalid. Nothing was uploaded.', errors: errors.slice(0, 50) });
    return res.status(201).json(await storeQuestions(questions, req.body.mode === 'replace'));
  })
);

router.put(
  '/questions/:id',
  asyncHandler(async (req, res) => {
    const q = questionSchema.parse(req.body);
    const ref = db.collection('questions').doc(req.params.id);
    if (!(await ref.get()).exists) throw new HttpError(404, 'Question not found');
    const doc = cleanQuestion(q);
    delete doc.createdAt;
    await ref.set(doc, { merge: true });
    invalidateQuestionCache();
    res.json({ id: ref.id, ...(await ref.get()).data() });
  })
);

router.delete(
  '/questions/:id',
  asyncHandler(async (req, res) => {
    await db.collection('questions').doc(req.params.id).delete();
    invalidateQuestionCache();
    res.json({ ok: true });
  })
);

// DELETE /api/admin/questions?set=mock1&confirm=yes   (clear a whole set)
router.delete(
  '/questions',
  asyncHandler(async (req, res) => {
    const s = setName.parse(req.query.set);
    if (req.query.confirm !== 'yes') throw new HttpError(400, 'Add &confirm=yes to delete the whole set');
    res.json({ deleted: await deleteSet(s) });
  })
);

// ------------------------------------------------------------------ dashboard
async function loadAll() {
  // Once the exam window is over, close any attempt that is still open so the numbers are always final
  // (a safety net in case the scheduled auto-submit function is late)
  const cfg = await getExamConfig();
  const end = examEndTime(cfg);
  if (end && Date.now() >= end) await sweepExpired();

  const [students, attempts, colleges, places] = await Promise.all([
    db.collection('students').get(),
    db.collection('attempts').get(),
    db.collection('colleges').get(),
    db.collection('places').get(),
  ]);
  const attemptBy = new Map(attempts.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
  return {
    cfg,
    students: students.docs.map((d) => ({ id: d.id, ...d.data() })),
    attemptBy,
    colleges: colleges.docs.map((d) => ({ id: d.id, ...d.data() })),
    places: places.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}

const emptyRow = (name) => ({ name, registered: 0, attended: 0, submitted: 0, inProgress: 0, notStarted: 0, pending: 0, autoSubmitted: 0, avgScore: 0, _sum: 0 });

function tally(row, student, attempt) {
  row.registered += 1;
  if (attempt) {
    row.attended += 1;
    if (attempt.status === 'submitted') {
      row.submitted += 1;
      row._sum += attempt.score || 0;
      if (attempt.autoSubmitted) row.autoSubmitted += 1;
    } else row.inProgress += 1;
  } else row.notStarted += 1;
}

function finish(rows) {
  return rows
    .map((r) => {
      const { _sum, ...rest } = r;
      return { ...rest, pending: r.registered - r.submitted, avgScore: r.submitted ? Math.round((_sum / r.submitted) * 100) / 100 : 0 };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const { cfg, students, attemptBy, colleges, places } = await loadAll();

    const total = emptyRow('Total');
    const byCollege = new Map(colleges.map((c) => [c.id, emptyRow(c.name)]));
    const byPlace = new Map(places.map((p) => [p.id, emptyRow(p.name)]));
    let shortlisted = 0;
    let rejected = 0;

    for (const s of students) {
      const a = attemptBy.get(s.id);
      tally(total, s, a);
      if (!byCollege.has(s.collegeId)) byCollege.set(s.collegeId, emptyRow(s.collegeName));
      tally(byCollege.get(s.collegeId), s, a);
      if (!byPlace.has(s.placeId)) byPlace.set(s.placeId, emptyRow(s.placeName));
      tally(byPlace.get(s.placeId), s, a);
      if (a && a.status === 'submitted') {
        if (evaluate(a, s.manualDecision, cfg).status === 'shortlisted') shortlisted += 1;
        else rejected += 1;
      }
    }

    res.json({
      serverTime: Date.now(),
      exam: {
        examName: cfg.examName,
        startTime: cfg.startTime,
        endTime: examEndTime(cfg),
        durationMinutes: cfg.durationMinutes,
        resultPublished: cfg.resultPublished,
        resultPublishedAt: cfg.resultPublishedAt,
      },
      totals: { ...finish([total])[0], shortlisted, rejected },
      collegeWise: finish([...byCollege.values()]),
      placeWise: finish([...byPlace.values()]),
    });
  })
);

// ------------------------------------------------------------------ students & results
function studentRow(s, a, cfg) {
  const done = a && a.status === 'submitted';
  const ev = done ? evaluate(a, s.manualDecision, cfg) : null;
  return {
    id: s.id,
    name: s.name,
    email: s.email,
    contact: s.contact,
    college: s.collegeName,
    collegeId: s.collegeId,
    branch: s.branch,
    testFor: s.testFor,
    place: s.placeName,
    placeId: s.placeId,
    resumeUrl: s.resumeUrl,
    registeredAt: s.createdAt,
    mocksCompleted: Object.keys(s.mocks || {}).length,
    examStatus: a ? a.status : 'not_started', // not_started | in_progress | submitted
    startedAt: a ? a.startedAt : null,
    submittedAt: a ? a.submittedAt || null : null,
    autoSubmitted: a ? !!a.autoSubmitted : false,
    score: a && a.status === 'submitted' ? a.score : null,
    maxMarks: a && a.status === 'submitted' ? a.maxMarks : null,
    correct: a && a.status === 'submitted' ? a.correct : null,
    wrong: a && a.status === 'submitted' ? a.wrong : null,
    attempted: a && a.status === 'submitted' ? a.attempted : null,
    tabSwitches: a ? a.tabSwitches || 0 : 0,
    loggedIn: !!(s.sessionId && Date.now() - (s.sessionSeen || 0) < 3 * 60 * 1000),
    percentage: ev ? ev.percentage : null,
    grade: ev ? ev.grade : null,
    autoStatus: ev ? ev.autoStatus : null, // by the marks rule
    status: ev ? ev.status : null, // what the student will see after publishing (admin choice wins)
    resultStatus: a ? a.resultStatus || null : null, // what was published
    manualDecision: s.manualDecision || null,
  };
}

router.get(
  '/students',
  asyncHandler(async (req, res) => {
    const { cfg, students, attemptBy } = await loadAll();
    const { collegeId, placeId, status, q } = req.query;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const page = Math.max(Number(req.query.page) || 1, 1);

    let rows = students.map((s) => studentRow(s, attemptBy.get(s.id), cfg));
    if (collegeId) rows = rows.filter((r) => r.collegeId === collegeId);
    if (placeId) rows = rows.filter((r) => r.placeId === placeId);
    if (status === 'pending') rows = rows.filter((r) => r.examStatus !== 'submitted');
    else if (status) rows = rows.filter((r) => r.examStatus === status);
    if (q) {
      const needle = String(q).toLowerCase();
      rows = rows.filter((r) => [r.name, r.email, r.contact, r.college].some((v) => String(v).toLowerCase().includes(needle)));
    }
    rows.sort((a, b) => b.registeredAt - a.registeredAt);
    res.json({ total: rows.length, page, limit, students: rows.slice((page - 1) * limit, page * limit) });
  })
);

router.get(
  '/students/:id',
  asyncHandler(async (req, res) => {
    const [s, a, cfg] = await Promise.all([db.collection('students').doc(req.params.id).get(), db.collection('attempts').doc(req.params.id).get(), getExamConfig()]);
    if (!s.exists) throw new HttpError(404, 'Student not found');
    res.json({ ...studentRow({ id: s.id, ...s.data() }, a.exists ? { id: a.id, ...a.data() } : null, cfg), mocks: s.data().mocks || {} });
  })
);

// Manually shortlist / reject one student (overrides the marks rule). decision: "shortlisted" | "rejected" | null
router.patch(
  '/students/:id/decision',
  asyncHandler(async (req, res) => {
    const { decision } = z.object({ decision: z.enum(['shortlisted', 'rejected']).nullable() }).parse(req.body);
    const sRef = db.collection('students').doc(req.params.id);
    const aRef = db.collection('attempts').doc(req.params.id);
    const [s, a] = await Promise.all([sRef.get(), aRef.get()]);
    if (!s.exists) throw new HttpError(404, 'Student not found');
    await sRef.update({ manualDecision: decision });
    const cfg = await getExamConfig();
    // only students whose result was already published see the change straight away
    if (cfg.resultPublished && a.exists && a.data().status === 'submitted' && a.data().resultStatus) {
      await aRef.update({ resultStatus: decision || evaluate(a.data(), null, cfg).status });
    }
    res.json({ ok: true, decision });
  })
);

// Delete a student completely: details, mock scores, exam answers and result. The resume goes to the Drive trash.
router.delete(
  '/students/:id',
  asyncHandler(async (req, res) => {
    const sRef = db.collection('students').doc(req.params.id);
    const s = await sRef.get();
    if (!s.exists) throw new HttpError(404, 'Student not found');
    const resumeMoved = await trashResume(s.data().resumeFileId);
    await Promise.all([db.collection('attempts').doc(req.params.id).delete(), sRef.delete()]);
    res.json({ deleted: true, resumeMoved });
  })
);

// A student cannot log in because the account still shows as open on another device: free it
router.post(
  '/students/:id/release-login',
  asyncHandler(async (req, res) => {
    const ref = db.collection('students').doc(req.params.id);
    if (!(await ref.get()).exists) throw new HttpError(404, 'Student not found');
    await ref.update({ sessionId: null, sessionSeen: 0, sessionDevice: null });
    res.json({ ok: true });
  })
);

// Reset a student's exam and give them a fresh personal time: the full exam duration (default) or a custom number of minutes.
// The time starts when the student presses "Start exam", and it works even after the exam window has closed.
router.post(
  '/students/:id/reset-exam',
  asyncHandler(async (req, res) => {
    const { minutes } = z.object({ minutes: z.number().int().min(1).max(600).nullable().optional() }).parse(req.body || {});
    const sRef = db.collection('students').doc(req.params.id);
    if (!(await sRef.get()).exists) throw new HttpError(404, 'Student not found');
    const cfg = await getExamConfig();
    const given = minutes || cfg.durationMinutes;
    await db.collection('attempts').doc(req.params.id).delete();
    await sRef.update({ examAllowanceMinutes: given });
    res.json({ ok: true, minutes: given });
  })
);

// Technical problem? Wipe a student's exam attempt so they can start again (only while the exam window is open)
router.delete(
  '/students/:id/attempt',
  asyncHandler(async (req, res) => {
    await db.collection('attempts').doc(req.params.id).delete();
    res.json({ ok: true });
  })
);

router.get(
  '/results',
  asyncHandler(async (req, res) => {
    const { cfg, students, attemptBy } = await loadAll();
    const rows = students
      .map((s) => studentRow(s, attemptBy.get(s.id), cfg))
      .filter((r) => r.examStatus === 'submitted')
      .sort((a, b) => b.score - a.score || a.submittedAt - b.submittedAt)
      .map((r, i) => ({ rank: i + 1, ...r }));
    const waiting = cfg.resultPublished ? rows.filter((r) => !r.resultStatus).length : 0; // submitted after the last publish
    res.json({ count: rows.length, results: rows, waitingForPublish: waiting });
  })
);

router.get(
  '/results/export',
  asyncHandler(async (req, res) => {
    const { cfg, students, attemptBy } = await loadAll();
    const rows = students.map((s) => studentRow(s, attemptBy.get(s.id), cfg)).sort((a, b) => (b.score ?? -1e9) - (a.score ?? -1e9));
    const head = ['Name', 'Email', 'Contact', 'College', 'Branch/Degree', 'Test For', 'Place', 'Exam Status', 'Score', 'Max Marks', 'Percentage', 'Grade', 'Correct', 'Wrong', 'Attempted', 'Auto Submitted', 'Tab Switches', 'Result (published)', 'Status by marks / admin', 'Submitted At', 'Resume'];
    const lines = [head.map(csvCell).join(',')];
    for (const r of rows) {
      lines.push(
        [r.name, r.email, r.contact, r.college, r.branch, r.testFor, r.place, r.examStatus, r.score, r.maxMarks, r.percentage === null ? '' : `${r.percentage}%`, r.grade || '', r.correct, r.wrong, r.attempted, r.autoSubmitted ? 'Yes' : 'No', r.tabSwitches, r.resultStatus || '', r.status || '', r.submittedAt ? new Date(r.submittedAt).toISOString() : '', r.resumeUrl]
          .map(csvCell)
          .join(',')
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="internship-aptitude-results.csv"');
    res.send(`﻿${lines.join('\n')}`);
  })
);

// ------------------------------------------------------------------ publish / unpublish result
router.post(
  '/results/publish',
  asyncHandler(async (req, res) => {
    // Make sure nothing is left "in progress" after the timer ended
    await sweepExpired();
    const cfg = await getExamConfig();
    const end = examEndTime(cfg);
    const { students, attemptBy } = await loadAll();

    const stillRunning = [...attemptBy.values()].filter((a) => a.status === 'in_progress').length;
    if (stillRunning && !(req.body && req.body.force === true)) {
      throw new HttpError(409, `${stillRunning} student(s) are still taking the exam (timer not finished). Wait until ${end ? new Date(end).toISOString() : 'the exam ends'} or send {"force": true}.`);
    }

    let shortlisted = 0;
    let rejected = 0;
    const ops = [];
    for (const s of students) {
      const a = attemptBy.get(s.id);
      if (!a || a.status !== 'submitted') continue;
      const resultStatus = evaluate(a, s.manualDecision, cfg).status;
      if (resultStatus === 'shortlisted') shortlisted += 1;
      else rejected += 1;
      ops.push((batch) => batch.update(db.collection('attempts').doc(a.id), { resultStatus }));
    }
    await commitInChunks(db, ops);
    await saveExamConfig({ resultPublished: true, resultPublishedAt: Date.now() });
    res.json({ published: true, shortlisted, rejected, shortlistFromMarks: cfg.shortlistFromMarks });
  })
);

router.post(
  '/results/unpublish',
  asyncHandler(async (req, res) => {
    await saveExamConfig({ resultPublished: false, resultPublishedAt: null });
    res.json({ published: false });
  })
);

module.exports = router;
