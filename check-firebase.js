// Run on your PC:  node check-firebase.js
// Prints the same "[firebase] ..." line the server writes to the Netlify function log, then tries to read the database.
// If the project / email / keyFingerprint here differ from the Netlify log line, the Netlify variables are not the same key.
require('dotenv').config();
const { db } = require('./src/firebase');

db.collection('settings').doc('exam').get()
  .then((s) => { console.log(`Database reachable. settings/exam exists: ${s.exists}`); process.exit(0); })
  .catch((e) => { console.error('Database error:', e.message); process.exit(1); });
