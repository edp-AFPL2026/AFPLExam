/**
 * Percentage, grade and shortlist / reject rule for the MAIN exam only (mock tests never decide anything).
 *
 * Default limits (marks, not percentile) for a 30 mark exam:
 *   Excellent  26 and above      -> shortlisted
 *   Very Good  21 to 25          -> shortlisted
 *   Great      15 to 20          -> rejected by the marks rule (admin can shortlist by hand)
 *   Fail       below 15          -> rejected
 * The admin can change every limit in Exam settings.
 */
const round2 = (n) => Math.round(n * 100) / 100;

function percentageOf(score, maxMarks) {
  if (!maxMarks || maxMarks <= 0) return 0;
  return round2((Math.max(0, score) / maxMarks) * 100);
}

function gradeOf(score, cfg) {
  if (score >= cfg.gradeExcellentFrom) return 'Excellent';
  if (score >= cfg.gradeVeryGoodFrom) return 'Very Good';
  if (score >= cfg.gradeGreatFrom) return 'Great';
  return 'Fail';
}

function autoStatusOf(score, cfg) {
  return score >= cfg.shortlistFromMarks ? 'shortlisted' : 'rejected';
}

/** Everything derived from one submitted attempt. `manual` is the admin's own decision (or null). */
function evaluate(attempt, manual, cfg) {
  const autoStatus = autoStatusOf(attempt.score, cfg);
  return {
    percentage: percentageOf(attempt.score, attempt.maxMarks),
    grade: gradeOf(attempt.score, cfg),
    autoStatus,
    status: manual || autoStatus,
  };
}

module.exports = { percentageOf, gradeOf, autoStatusOf, evaluate };
