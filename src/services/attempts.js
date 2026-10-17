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
  const questions = await getSet('exam');
  const ref = db.collection('attempts').doc(studentId);

  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) return null;
    const attempt = snap.data();
    if (attempt.status === 'submitted') return { id: snap.id, ...attempt };

    const finalAnswers = answers ? { ...(attempt.answers || {}), ...answers } : attempt.answers || {};
    const g = gradeAnswers(questions, finalAnswers, attempt.marking);
    const update = {
      status: 'submitted',
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
  const snap = await db.collection('attempts').where('status', '==', 'in_progress').get();
  const now = Date.now();
  let count = 0;
  for (const d of snap.docs) {
    const a = d.data();
    if (now >= a.endsAt + GRACE_MS) {
      // eslint-disable-next-line no-await-in-loop
      await finalizeAttempt(d.id, { auto: true });
      count += 1;
    }
  }
  return count;
}

module.exports = { GRACE_MS, finalizeAttempt, finalizeIfExpired, sweepExpired };
