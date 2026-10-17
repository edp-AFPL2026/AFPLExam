/**
 * Set or change the admin login.
 *
 *   node set-admin.js <email> <password>
 *   node set-admin.js admin@aakarfoundry.com "MyNewPass@123"
 *
 * - Makes this the ONLY admin (all other admin records are deleted). Add --keep-others to keep them.
 * - Does not need .env for the email/password (JWT_SECRET is still needed to run the site).
 * - Afterwards it tests the login against the running website (http://localhost:5000) if it is running.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db } = require('./src/firebase');
const { normEmail } = require('./src/utils/helpers');

(async () => {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const keepOthers = process.argv.includes('--keep-others');
  const email = normEmail(args[0] || '');
  const password = args[1] || '';

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.log('Email is not valid. Example:  node set-admin.js admin@aakarfoundry.com "MyPass@123"');
    process.exit(1);
  }
  if (password.length < 8) {
    console.log('Password must be at least 8 characters.');
    process.exit(1);
  }

  const col = db.collection('admins');
  if (!keepOthers) {
    const all = await col.get();
    for (const d of all.docs) {
      if (d.id !== email) {
        await d.ref.delete();
        console.log('Removed old admin:', d.id);
      }
    }
  }
  await col.doc(email).set({ email, passwordHash: await bcrypt.hash(password, 10), createdAt: Date.now() });
  const saved = await col.doc(email).get();
  const ok = await bcrypt.compare(password, saved.data().passwordHash);
  console.log(`Admin saved: ${email}  (password ${password.length} characters, stored check: ${ok ? 'OK' : 'FAILED'})`);

  // Try the real login endpoint of a running server
  const port = process.env.PORT || 5000;
  try {
    const r = await fetch(`http://localhost:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await r.json().catch(() => ({}));
    if (r.ok) console.log(`Website login test: SUCCESS. Open http://localhost:${port}/admin/ and log in.`);
    else console.log(`Website login test: FAILED (${r.status}) ${body.error || ''}`);
    if (!r.ok && r.status === 401) console.log('  -> The running server uses a different database or is an old process. Close ALL terminals, then run npm start once.');
    if (r.status === 429) console.log('  -> Too many attempts. Wait 15 minutes or restart the server.');
    if (r.status === 500) console.log('  -> Server error. Check JWT_SECRET in .env (16+ characters) and restart the server.');
  } catch (e) {
    console.log(`Website login test: server not running on port ${port}. Start it with npm start, then log in.`);
  }
})().then(() => process.exit(0)).catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
