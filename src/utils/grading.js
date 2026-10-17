/**
 * Scores a set of answers.
 *  questions : [{ id, text, options[], correctIndex, marks?, negativeMarks?, explanation? }]
 *  answers   : { [questionId]: selectedOptionIndex }   (unattempted questions are simply missing)
 *  marking   : { markingType: 'positive' | 'negative' | 'both', positiveMarks, negativeMarks }
 *
 * Only ATTEMPTED questions are graded / listed in `review`.
 */
function gradeAnswers(questions, answers, marking) {
  const mode = marking.markingType;
  let score = 0;
  let correct = 0;
  let wrong = 0;
  let attempted = 0;
  let maxMarks = 0;
  const review = [];

  for (const q of questions) {
    // Global Exam Settings always win. Marks typed on a single question (or in the CSV) are ignored.
    const pos = Number(marking.positiveMarks);
    const neg = Number(marking.negativeMarks);
    maxMarks += pos;

    const selected = answers ? answers[q.id] : undefined;
    if (!Number.isInteger(selected) || selected < 0 || selected >= q.options.length) continue;

    attempted += 1;
    const isCorrect = selected === q.correctIndex;
    let delta = 0;
    if (isCorrect) {
      correct += 1;
      if (mode !== 'negative') delta = pos;
    } else {
      wrong += 1;
      if (mode !== 'positive') delta = -neg;
    }
    score += delta;

    review.push({
      questionId: q.id,
      text: q.text,
      options: q.options,
      selectedIndex: selected,
      correctIndex: q.correctIndex,
      isCorrect,
      marksAwarded: delta,
      explanation: q.explanation || '',
    });
  }

  return {
    score: Math.round(score * 100) / 100,
    correct,
    wrong,
    attempted,
    unattempted: questions.length - attempted,
    totalQuestions: questions.length,
    maxMarks: Math.round(maxMarks * 100) / 100,
    review,
  };
}

module.exports = { gradeAnswers };
