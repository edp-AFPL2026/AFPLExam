/**
 * One-time setup:   npm run seed            -> creates the admin user + default exam settings + company info
 *                   npm run seed:samples    -> same, plus demo colleges, places and sample questions for testing
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db } = require('./src/firebase');
const { DEFAULT_EXAM, DEFAULT_COMPANY } = require('./src/config');
const { normEmail } = require('./src/utils/helpers');

async function seed({ withSamples = false } = {}) {
  const email = normEmail(process.env.ADMIN_EMAIL);
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env first');

  const adminRef = db.collection('admins').doc(email);
  const resetAdmin = process.argv.includes('--reset-admin');
  if (resetAdmin || !(await adminRef.get()).exists) {
    await adminRef.set({ email, passwordHash: await bcrypt.hash(password, 10), createdAt: Date.now() });
    console.log(`Admin ${resetAdmin ? 'password reset' : 'created'}: ${email}`);
    console.log(`Log in with email "${email}" and the password from ADMIN_PASSWORD (${password.length} characters).`);
  } else {
    console.log(`Admin already exists: ${email} (password unchanged)`);
  }

  const examRef = db.collection('settings').doc('exam');
  if (!(await examRef.get()).exists) await examRef.set(DEFAULT_EXAM);
  const companyRef = db.collection('settings').doc('company');
  if (!(await companyRef.get()).exists) await companyRef.set(DEFAULT_COMPANY);

  if (withSamples) {
    const colleges = ['Sample Engineering College, Pune', 'Demo Institute of Technology, Mumbai'];
    const places = ['Pune', 'Mumbai'];
    for (const name of colleges) await db.collection('colleges').doc().set({ name, active: true, createdAt: Date.now() });
    for (const name of places) await db.collection('places').doc().set({ name, active: true, createdAt: Date.now() });

    const bank = [
      ['What is 15% of 200?', ['20', '25', '30', '35'], 2],
      ['Next number: 2, 4, 8, 16, ?', ['24', '30', '32', '64'], 2],
      ['A train covers 60 km in 1.5 hours. Its speed is?', ['30 km/h', '40 km/h', '45 km/h', '90 km/h'], 1],
      ['Find the odd one out: Aluminium, Copper, Iron, Plastic', ['Aluminium', 'Copper', 'Iron', 'Plastic'], 3],
      ['If 5 machines make 5 parts in 5 minutes, 100 machines make 100 parts in?', ['1 minute', '5 minutes', '20 minutes', '100 minutes'], 1],
    ];
    const sets = { mock1: bank.slice(0, 3), mock2: bank.slice(1, 4), mock3: bank.slice(2, 5), exam: bank };
    for (const [set, qs] of Object.entries(sets)) {
      let order = 0;
      for (const [text, options, correctIndex] of qs) {
        await db.collection('questions').doc().set({ set, text, options, correctIndex, order: order++, createdAt: Date.now() });
      }
    }
    console.log('Sample colleges, places and questions added.');
  }
}

module.exports = { seed };

if (require.main === module) {
  seed({ withSamples: process.argv.includes('--samples') })
    .then(() => {
      console.log('Seed finished.');
      process.exit(0);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
