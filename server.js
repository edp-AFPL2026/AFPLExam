require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { ZodError } = require('zod');
const multer = require('multer');

const publicRoutes = require('./src/routes/public');
const adminRoutes = require('./src/routes/admin');
const studentRoutes = require('./src/routes/student');
const { sweepExpired } = require('./src/services/attempts');
const { HttpError } = require('./src/utils/helpers');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

const origins = (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: origins.includes('*') ? true : origins }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, serverTime: Date.now() }));

app.use('/api/public', publicRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/admin', adminRoutes);

// On Netlify the /public folder is served by Netlify itself. This line lets `npm start` on your PC serve the website too.
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; ') });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  console.error(err);
  return res.status(500).json({ error: 'Something went wrong. Please try again' });
});

// Only used when running as a normal server on your own PC (npm start).
// On Netlify the scheduled function "autosubmit" does this job instead.
function startSweeper(everyMs = 20000) {
  const timer = setInterval(() => {
    sweepExpired().catch((e) => console.error('Auto-submit sweep failed:', e.message));
  }, everyMs);
  timer.unref();
  return timer;
}

module.exports = { app, startSweeper };

if (require.main === module) {
  const port = process.env.PORT || 5000;
  app.listen(port, () => {
    console.log(`Aakar exam API running on http://localhost:${port}`);
    startSweeper();
  });
}
