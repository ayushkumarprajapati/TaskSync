import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function credentials(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  return { email, password };
}

export async function register(req, res) {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const { email, password } = credentials(req.body);
  const errors = {};
  if (!name || name.length > 100) errors.name = 'Name must contain 1–100 characters.';
  if (!emailPattern.test(email) || email.length > 255) errors.email = 'Enter a valid email address.';
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    errors.password = 'Password must contain at least 8 characters and at most 72 UTF-8 bytes.';
  }
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: { message: 'Validation failed.', fields: errors } });
  }

  const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length) return res.status(409).json({ error: { message: 'Email is already registered.' } });

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [name, email, passwordHash],
    );
    return res.status(201).json({
      message: 'Registration successful.',
      user: { id: result.insertId, name, email },
    });
  } catch (error) {
    // The unique constraint also handles two simultaneous registrations.
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: { message: 'Email is already registered.' } });
    }
    throw error;
  }
}

export async function login(req, res) {
  const { email, password } = credentials(req.body);
  if (!emailPattern.test(email) || email.length > 255 || !password || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: { message: 'A valid email and password are required.' } });
  }

  const [users] = await pool.execute('SELECT id, name, email, password FROM users WHERE email = ?', [email]);
  const user = users[0];
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: { message: 'Invalid email or password.' } });
  }
  const token = jwt.sign({}, process.env.JWT_SECRET, {
    subject: String(user.id),
    expiresIn: '1h',
    algorithm: 'HS256',
  });
  return res.json({ token, tokenType: 'Bearer', expiresIn: 3600, user: { id: user.id, name: user.name, email: user.email } });
}

export async function me(req, res) {
  const [users] = await pool.execute('SELECT id, name, email, created_at FROM users WHERE id = ?', [req.user.id]);
  if (!users.length) return res.status(401).json({ error: { message: 'User account no longer exists.' } });
  return res.json({ user: users[0] });
}
