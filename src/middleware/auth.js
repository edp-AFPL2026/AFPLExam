const jwt = require('jsonwebtoken');
const { HttpError } = require('../utils/helpers');

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) throw new Error('JWT_SECRET is missing or too short. Set it in .env');
  return s;
}

const sign = (payload, expiresIn) => jwt.sign(payload, secret(), { expiresIn });

const requireRole = (role) => (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Login required'));
  try {
    const payload = jwt.verify(token, secret());
    if (payload.role !== role) return next(new HttpError(403, 'Not allowed'));
    req.user = payload;
    return next();
  } catch (e) {
    return next(new HttpError(401, 'Session expired. Please log in again'));
  }
};

module.exports = {
  sign,
  requireAdmin: requireRole('admin'),
  requireStudent: requireRole('student'),
};
