import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import app from '../src/app.js';
import pool from '../src/config/db.js';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('Configure JWT_SECRET in server/.env before testing.');
}

const email = `auth-test-${randomUUID()}@example.com`;
const account = { name: 'Authentication Test', email, password: randomUUID() };
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}/api/auth`;
async function request(path, body, token) {
  const response = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}

try {
  assert.equal((await request('/register', account)).status, 201);
  const [[saved]] = await pool.execute('SELECT id, password FROM users WHERE email = ?', [email]);
  assert.ok(saved);
  assert.notEqual(saved.password, account.password);
  assert.equal(await bcrypt.compare(account.password, saved.password), true);
  console.log('PASS: registration persists a bcrypt hash in MySQL');

  assert.equal((await request('/register', { ...account, email: email.toUpperCase() })).status, 409);
  assert.equal((await request('/login', { email, password: 'incorrect-password' })).status, 401);
  const login = await request('/login', account);
  assert.equal(login.status, 200);
  assert.ok(login.data.token);
  assert.equal(login.data.user.password, undefined);
  console.log('PASS: duplicate email, incorrect password, and successful JWT login');

  assert.equal((await request('/me')).status, 401);
  const profile = await request('/me', undefined, login.data.token);
  assert.equal(profile.status, 200);
  assert.equal(profile.data.user.id, saved.id);
  assert.equal(profile.data.user.email, email);
  assert.equal(profile.data.user.password, undefined);
  console.log('PASS: protected profile loads the persisted user');
} finally {
  // Only delete the unique account created by this test run.
  await pool.execute('DELETE FROM users WHERE email = ?', [email]);
  await new Promise(resolve => server.close(resolve));
  await pool.end();
}
