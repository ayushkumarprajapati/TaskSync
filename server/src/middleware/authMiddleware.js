import { verifyToken } from '../config/token.js';
import pool from '../config/db.js';
import { disconnectUserSockets } from '../realtime/socket.js';

export default async function authenticate(req, res, next) {
  const match = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') || '');
  if (!match) return res.status(401).json({ error: { message: 'A Bearer token is required.' } });
  let user;
  try {
    user = verifyToken(match[1]);
  } catch (error) {
    const message = error.name === 'TokenExpiredError' ? 'Authentication token has expired.' : 'Invalid authentication token.';
    return res.status(401).json({ error: { message } });
  }
  try {
    const [users] = await pool.execute('SELECT id FROM users WHERE id = ?', [user.id]);
    if (!users.length) {
      disconnectUserSockets(req.app.get('io'), user.id);
      return res.status(401).json({ error: { message: 'User account no longer exists.' } });
    }
    req.user = { id: user.id };
    return next();
  } catch (error) {
    // A database outage is not an invalid token; preserve normal service errors.
    return next(error);
  }
}
