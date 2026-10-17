// Diagnostic:  node check-admin.js
// Shows what is stored for the admin and whether the password in .env matches. Prints no secrets.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db } = require('./src/firebase');
const { normEmail } = require('./src/utils/helpers');

(async () => {
  const email = normEmail(process.env.ADMIN_EMAIL || '');
  const pw = process.env.ADMIN_PASSWORD || '';
  console.log('.env ADMIN_EMAIL    :', JSON.stringify(email));
  console.log('.env ADMIN_PASSWORD :', pw.length, 'characters');
  console.log('.env JWT_SECRET     :', (process.env.JWT_SECRET || '').length, 'characters (need 16 or more)');
  try {
    const keyJson = require('./serviceAccountKey.json');
    console.log('Firebase project    :', keyJson.project_id);
  } catch (e) {
    console.log('Firebase project    : (key file not loaded)');
  }
  const all = await db.collection('admins').get();
  console.log('Admins in database  :', all.docs.map((d) => d.id));
  const snap = await db.collection('admins').doc(email).get();
  if (!snap.exists) return console.log('RESULT: no admin with that email. Run: npm run reset-admin');
  const ok = await bcrypt.compare(pw, snap.data().passwordHash);
  console.log(ok ? 'RESULT: email and password MATCH. Log in with exactly these.' : 'RESULT: admin exists but password does NOT match. Run: npm run reset-admin');
})().then(() => process.exit(0)).catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
