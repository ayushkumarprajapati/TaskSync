import pool from '../config/db.js';

export async function listUsers(_req, res) {
  const [users] = await pool.execute('SELECT id, name FROM users ORDER BY name, id');
  res.json({ users });
}
