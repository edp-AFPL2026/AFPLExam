const express = require('express');
const { db } = require('../firebase');
const { getExamConfig, getCompany, describeMarking, examEndTime } = require('../config');
const { asyncHandler } = require('../utils/helpers');
const { ensureBranches } = require('../services/branches');
const { cached } = require('../services/publicCache');

const router = express.Router();

async function activeList(col) {
  const snap = col === 'branches' ? await ensureBranches() : await db.collection(col).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((x) => x.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ id, name }) => ({ id, name }));
}

// Server clock - the frontend uses it so every student's countdown matches (not the student's PC clock)
router.get('/time', (req, res) => res.json({ serverTime: Date.now() }));

// Everything the landing page needs
router.get(
  '/landing',
  asyncHandler(async (req, res) => {
    const [cfg, company, colleges, places, branches] = await Promise.all([
      getExamConfig(),
      cached('company', getCompany),
      cached('colleges', () => activeList('colleges')),
      cached('places', () => activeList('places')),
      cached('branches', () => activeList('branches')),
    ]);
    res.json({
      serverTime: Date.now(),
      company,
      exam: {
        examName: cfg.examName,
        startTime: cfg.startTime,
        endTime: examEndTime(cfg),
        durationMinutes: cfg.durationMinutes,
        markingScheme: describeMarking(cfg),
        mockCount: cfg.mockCount,
        rules: cfg.rules,
        registrationOpen: cfg.registrationOpen,
        resultPublished: cfg.resultPublished,
      },
      form: {
        colleges,
        places,
        testForOptions: cfg.testForOptions,
        branches,
      },
    });
  })
);

module.exports = router;
