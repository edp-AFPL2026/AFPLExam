const { db } = require('../firebase');
const { getSet } = require('./questions');
const { gradeAnswers } = require('../utils/grading');

// The browser auto-submits when its timer hits zero; the server waits a few seconds
// for that final request before it closes the attempt itself.
const GRACE_MS = 10 * 1000;

/**
 * Grade and lock an attempt. Safe to call many times (idempotent, runs in a transaction).
 * Only the questions the student actually attempted are graded.
 */
async function finalizeAttempt(studentId, { auto = false, answers = null } = {}) {
  const pool = await getSet('exam');
  const ref = db.collection('attempts').doc(studentId);

  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) return null;
    const attempt = snap.data();
    if (attempt.status === 'submitted') return { id: snap.id, ...attempt };

    const finalAnswers = answers ? { ...(attempt.answers || {}), ...answers } : attempt.answers || {};
    // grade only the questions this student was given (a random pick when the admin limits the number)
    const given = Array.isArray(attempt.order) ? new Set(attempt.order) : null;
    const questions = given ? pool.filter((q) => given.has(q.id)) : pool;
    const g = gradeAnswers(questions, finalAnswers, attempt.marking);
    const update = {
      status: 'submitted',
      autoDeadline: null, // no longer needs the auto-submit sweep
      submittedAt: Date.now(),
      autoSubmitted: auto,
      answers: finalAnswers,
      score: g.score,
      correct: g.correct,
      wrong: g.wrong,
      attempted: g.attempted,
      maxMarks: g.maxMarks,
      totalQuestions: g.totalQuestions,
    };
    t.update(ref, update);
    return { id: snap.id, ...attempt, ...update };
  });
}

/** If the attempt's timer is over, submit it now. Returns the (possibly updated) attempt. */
async function finalizeIfExpired(attempt) {
  if (attempt && attempt.status === 'in_progress' && Date.now() >= attempt.endsAt + GRACE_MS) {
    return (await finalizeAttempt(attempt.id, { auto: true })) || attempt;
  }
  return attempt;
}

/** Background job: auto-submit every attempt whose timer ended (even if the student closed the browser) */
async function sweepExpired() {
  // Only attempts whose time is already over are read (autoDeadline = endsAt + grace, set when the exam starts),
  // not every student who is still writing: this keeps the Firestore reads of the per-minute job near zero.
  const snap = await db.collection('attempts').where('autoDeadline', '<=', Date.now()).get();
  let count = 0;
  for (const d of snap.docs) {
    const a = d.data();
    if (a.status !== 'in_progress') continue;
    // eslint-disable-next-line no-await-in-loop
    await finalizeAttempt(d.id, { auto: true });
    count += 1;
  }
  return count;
}

module.exports = { GRACE_MS, finalizeAttempt, finalizeIfExpired, sweepExpired };
