const { db } = require('../firebase');

const CACHE_MS = 30 * 1000;
const cache = new Map(); // setName -> { at, list }

/** Question sets: "exam", "mock1", "mock2", "mock3" ... */
async function getSet(setName) {
  const hit = cache.get(setName);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list;

  const snap = await db.collection('questions').where('set', '==', setName).get();
  const list = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
  cache.set(setName, { at: Date.now(), list });
  return list;
}

function invalidateQuestionCache() {
  cache.clear();
}

/** What a student is allowed to see while answering (no correct answer, no explanation) */
function publicQuestion(q) {
  return { id: q.id, text: q.text, options: q.options, marks: q.marks ?? null };
}

module.exports = { getSet, invalidateQuestionCache, publicQuestion };
