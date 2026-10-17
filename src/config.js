const { db } = require('./firebase');

const EXAM_DOC = db.collection('settings').doc('exam');
const COMPANY_DOC = db.collection('settings').doc('company');

const EXAM_CACHE_MS = 10 * 1000;
let examCache = null;

const DEFAULT_EXAM = {
  examName: 'Internship Aptitude Test',
  startTime: null, // epoch milliseconds, set by the admin
  durationMinutes: 60,
  // 'positive' : correct = +marks, wrong = 0
  // 'negative' : correct = 0,      wrong = -negativeMarks   (penalty only)
  // 'both'     : correct = +marks, wrong = -negativeMarks
  markingType: 'both',
  positiveMarks: 1,
  negativeMarks: 1,
  // Result grades (marks, not percentile). Below gradeGreatFrom = Fail. Shortlisted = shortlistFromMarks or more.
  gradeGreatFrom: 15,
  gradeVeryGoodFrom: 21,
  gradeExcellentFrom: 26,
  shortlistFromMarks: 21,
  mockCount: 3,
  requireMocks: true,
  // Leaving the exam tab (switching tab / window) gives a warning and, when this is true, clears every selected answer
  clearAnswersOnTabSwitch: true,
  registrationOpen: true,
  rules: [
    'Fill in all your student information correctly before starting. Details cannot be changed later.',
    'Complete all 3 mock tests first. They help you understand the exam pattern and their scores do not count.',
    'The main exam starts automatically at the scheduled time. A countdown is shown while you wait.',
    'The exam timer is fixed by the company. When the timer ends, the questions you have attempted are submitted automatically.',
    'Do not switch to another tab or window during the exam. If you do, you get a warning and all the answers you selected so far are cleared, and the company can see how many times it happened.',
    'Do not close the browser. Your answers are saved automatically. If you get disconnected, log in again with your email and contact number.',
    'Your result will not be shown after the exam. It appears on this site once the company publishes it.',
    'Any kind of malpractice will lead to disqualification.',
  ],
  testForOptions: ['Production Engineering Intern', 'Quality Engineering Intern', 'Maintenance Engineering Intern', 'Tool Room Intern', 'IT / Software Intern', 'HR / Admin Intern'],
  branchOptions: ['Mechanical Engineering', 'Production Engineering', 'Electrical Engineering', 'Electronics & Telecommunication', 'Computer Engineering / IT', 'Metallurgy', 'Diploma (Any Branch)', 'ITI', 'B.Sc', 'MBA / BBA'],
  shortlistMessage:
    'Congratulations! You have been shortlisted for the next round of the Aakar Foundry Internship selection process. Our HR team will contact you shortly.',
  rejectMessage:
    'Thank you for taking the Aakar Foundry Internship Aptitude Test. Unfortunately you have not been shortlisted this time. We wish you the very best for your future.',
  resultPublished: false,
  resultPublishedAt: null,
};

// Researched from https://aakarfoundry.com/ - the admin can edit all of it from the dashboard.
const DEFAULT_COMPANY = {
  name: 'Aakar Foundry Pvt. Ltd.',
  website: 'https://aakarfoundry.com/',
  tagline: 'Crafting solutions in aluminium die casting',
  about:
    'Aakar Foundry Pvt. Ltd. started in 2007 as a green-field project in Talegaon Dabhade, near Pune, Maharashtra. ' +
    'The company manufactures aluminium die-cast components using all three processes: Gravity Die Casting (GDC), ' +
    'Low Pressure Die Casting (LPDC) and High Pressure Die Casting (HPDC, with machines up to 660T locking force). ' +
    'It supplies critical parts as import substitutes directly to automotive OEMs (two-wheelers, four-wheelers and commercial vehicles) ' +
    'and to more than 15 customers in non-automotive sectors. ' +
    'Complete in-house facilities include a tool room, melting, heat treatment, machine shop, impregnation and powder coating, ' +
    'backed by in-house simulation support to keep rejection low. ' +
    'Aakar Foundry is TUV Nord certified for IATF 16949, ISO 14001 and ISO 45001. ' +
    'Its clients include well-known names such as Tata, Mahindra, Bajaj, Cummins, Garrett, BorgWarner, ZF, Knorr-Bremse, Kirloskar, Greaves and Force Motors.',
  highlights: [
    'Established 2007 - Talegaon Dabhade, Pune',
    'GDC, LPDC and HPDC aluminium die casting',
    'Direct supplier to automotive OEMs (2W, 4W, CV)',
    'IATF 16949, ISO 14001 and ISO 45001 certified (TUV Nord)',
    'In-house tool room, machine shop, heat treatment, impregnation and powder coating',
  ],
  address: 'Survey No. 341/2, Old Pune Mumbai Highway, Somatane Phata, Talegaon Dabhade, Tal - Maval, Dist - Pune, 410506, Maharashtra, India',
  phone: '02114-239500',
  email: 'sales@aakarfoundry.com',
  logoUrl: '/assets/aakar-logo.svg',
};

async function getExamConfig() {
  // Short cache: every student request needs these settings, and the free Firestore plan has a daily read limit
  if (examCache && Date.now() - examCache.at < EXAM_CACHE_MS) return examCache.value;
  const snap = await EXAM_DOC.get();
  const value = { ...DEFAULT_EXAM, ...(snap.exists ? snap.data() : {}) };
  examCache = { at: Date.now(), value };
  return value;
}

async function saveExamConfig(patch) {
  await EXAM_DOC.set(patch, { merge: true });
  examCache = null;
  return getExamConfig();
}

async function getCompany() {
  const snap = await COMPANY_DOC.get();
  return { ...DEFAULT_COMPANY, ...(snap.exists ? snap.data() : {}) };
}

async function saveCompany(patch) {
  await COMPANY_DOC.set(patch, { merge: true });
  return getCompany();
}

function examEndTime(cfg) {
  return cfg.startTime ? cfg.startTime + Math.round(cfg.durationMinutes * 60000) : null;
}

function describeMarking(cfg) {
  const p = cfg.positiveMarks;
  const n = cfg.negativeMarks;
  if (cfg.markingType === 'positive') return `+${p} for every correct answer. No negative marking.`;
  if (cfg.markingType === 'negative') return `-${n} for every wrong answer. Correct answers carry no marks.`;
  return `+${p} for every correct answer and -${n} for every wrong answer. Unattempted questions carry 0 marks.`;
}

module.exports = {
  DEFAULT_EXAM,
  DEFAULT_COMPANY,
  getExamConfig,
  saveExamConfig,
  getCompany,
  saveCompany,
  examEndTime,
  describeMarking,
};
