const { db } = require('../firebase');

const CACHE_MS = 30 * 1000;
const cache = new Map(); // setName -> { at, list }

/** Question sets: "exam", "mock1", "mock2", "mock3" ... */
async function getSet(setName) {
  const hit = cache.get(setName);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list;

  // One shared document holds the whole set, so 200 students starting together cost 1 read each
  // instead of one read per question (every new serverless instance starts with an empty memory cache).
  const shared = db.collection('qcache').doc(setName);
  const cachedDoc = await shared.get();
  if (cachedDoc.exists && Array.isArray(cachedDoc.data().items)) {
    const list = cachedDoc.data().items;
    cache.set(setName, { at: Date.now(), list });
    return list;
  }

  const snap = await db.collection('questions').where('set', '==', setName).get();
  const list = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
  cache.set(setName, { at: Date.now(), list });
  try {
    if (JSON.stringify(list).length < 900 * 1024) await shared.set({ items: list, at: Date.now() }); // Firestore documents max 1 MB
  } catch (e) { /* the cache is only a speed-up */ }
  return list;
}

// Call (and await) after ANY change to the questions: clears this instance and the shared copy
async function invalidateQuestionCache() {
  cache.clear();
  const snap = await db.collection('qcache').get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

/** What a student is allowed to see while answering (no correct answer, no explanation) */
function publicQuestion(q) {
  return { id: q.id, text: q.text, options: q.options, marks: q.marks ?? null };
}

module.exports = { getSet, invalidateQuestionCache, publicQuestion };
