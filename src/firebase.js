require('dotenv').config();

let db;

// Netlify's text box can change a pasted private key (quotes kept, \n turned into spaces or real line breaks).
// This rebuilds a clean PEM from whatever was pasted.
function normalizePrivateKey(raw) {
  let k = String(raw || '').trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1);
  k = k.replace(/\\r/g, '').replace(/\\n/g, '\n');
  const m = k.match(/-----BEGIN ([A-Z ]*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/);
  if (!m) return k;
  const body = m[2].replace(/[^A-Za-z0-9+/=]/g, '');
  return `-----BEGIN ${m[1]}-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END ${m[1]}-----\n`;
}

if (process.env.USE_MEMORY_DB === '1') {
  // Local fake database used only by `npm test` (no Firebase needed)
  ({ db } = require('../test/memoryDb'));
} else {
  // load only the app + Firestore parts of firebase-admin: a much shorter cold start on Netlify
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');

  if (!getApps().length) {
    // 1. The key file in the project folder (same as Firebase's own sample code):
    //      var serviceAccount = require("path/to/serviceAccountKey.json");
    //    Put the downloaded file next to package.json and name it serviceAccountKey.json.
    // The path is built at run time on purpose: Netlify's bundler follows a plain require('../serviceAccountKey.json')
    // and fails the build when the file is not on GitHub. With a run-time path it just looks for the file
    // and falls back to the FIREBASE_* variables when it is not there.
    let serviceAccount = null;
    try {
      const fs = require('fs');
      const path = require('path');
      const candidates = [
        path.join(__dirname, '..', 'serviceAccountKey.json'),
        path.join(process.cwd(), 'serviceAccountKey.json'),
        path.join(process.env.LAMBDA_TASK_ROOT || '', 'serviceAccountKey.json'),
      ];
      const found = candidates.find((f) => f && fs.existsSync(f));
      if (found) serviceAccount = JSON.parse(fs.readFileSync(found, 'utf8'));
    } catch (e) {
      serviceAccount = null;
    }

    let credential;
    if (serviceAccount) {
      credential = cert(serviceAccount);
    } else if (process.env.FIREBASE_PRIVATE_KEY) {
      // 2. Fallback: three short environment variables (Netlify limits all variables to 4 KB in total)
      credential = cert({
        projectId: String(process.env.FIREBASE_PROJECT_ID || '').trim(),
        clientEmail: String(process.env.FIREBASE_CLIENT_EMAIL || '').trim(),
        privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
      });
    } else {
      throw new Error('Firebase key not found. Put serviceAccountKey.json in the project folder (next to package.json).');
    }

    initializeApp({ credential });
    // One line in the function log (no secrets): which key source is used and a short fingerprint of the key,
    // so it can be compared with the same line printed by `node check-firebase.js` on your PC.
    try {
      const k = serviceAccount ? serviceAccount.private_key : normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
      const fp = require('crypto').createHash('sha256').update(String(k || '')).digest('hex').slice(0, 10);
      const mail = serviceAccount ? serviceAccount.client_email : String(process.env.FIREBASE_CLIENT_EMAIL || '').trim();
      const proj = serviceAccount ? serviceAccount.project_id : String(process.env.FIREBASE_PROJECT_ID || '').trim();
      console.log(`[firebase] source=${serviceAccount ? 'keyfile' : 'env'} project=${proj} email=${mail} keyLen=${String(k || '').length} keyFingerprint=${fp}`);
    } catch (e) { /* logging only */ }
  }

  db = getFirestore();
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch (e) {
    // settings() can only be called once per process; a warm function instance already did it
  }
}

module.exports = { db };
