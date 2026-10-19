const { db } = require('../firebase');
const { getExamConfig } = require('../config');

// The branch list is managed by the admin (like colleges). The first time it is needed and the list is empty,
// it is filled from the old "branch suggestions" setting so nothing has to be typed again.
async function ensureBranches() {
  const snap = await db.collection('branches').get();
  if (!snap.empty) return snap;
  const cfg = await getExamConfig();
  for (const name of cfg.branchOptions || []) await db.collection('branches').doc().set({ name, active: true, createdAt: Date.now() });
  return db.collection('branches').get();
}

module.exports = { ensureBranches };
