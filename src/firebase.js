require('dotenv').config();

let db;

if (process.env.USE_MEMORY_DB === '1') {
  // Local fake database used only by `npm test` (no Firebase needed)
  ({ db } = require('../test/memoryDb'));
} else {
  const admin = require('firebase-admin');

  if (!admin.apps.length) {
    // 1. The key file in the project folder (same as Firebase's own sample code):
    //      var serviceAccount = require("path/to/serviceAccountKey.json");
    //    Put the downloaded file next to package.json and name it serviceAccountKey.json.
    //    (A plain require() with a fixed path also lets Netlify find and bundle the file.)
    let serviceAccount = null;
    try {
      // eslint-disable-next-line global-require
      serviceAccount = require('../serviceAccountKey.json');
    } catch (e) {
      serviceAccount = null;
    }

    let credential;
    if (serviceAccount) {
      credential = admin.credential.cert(serviceAccount);
    } else if (process.env.FIREBASE_PRIVATE_KEY) {
      // 2. Fallback: three short environment variables (Netlify limits all variables to 4 KB in total)
      credential = admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      });
    } else {
      throw new Error('Firebase key not found. Put serviceAccountKey.json in the project folder (next to package.json).');
    }

    admin.initializeApp({ credential });
  }

  db = admin.firestore();
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch (e) {
    // settings() can only be called once per process; a warm function instance already did it
  }
}

module.exports = { db };
