import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import app from '../src/app.js';
import pool from '../src/config/db.js';

// HTTP tests use real bcrypt/JWT with a temporary database substitute.
// They do not test MySQL connectivity or SQL constraints.
test('authentication HTTP flow', async (t) => {
  const originalExecute = pool.execute;
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  const users = [];
  let failDatabase = false;
  let duplicateInsert = false;
  pool.execute = async (sql, params) => {
    if (failDatabase) throw Object.assign(new Error('Unavailable'), { code: 'ECONNREFUSED' });
    if (sql.startsWith('INSERT INTO users')) {
      if (duplicateInsert) throw Object.assign(new Error('Duplicate'), { code: 'ER_DUP_ENTRY' });
      const user = { id: users.length + 1, name: params[0], email: params[1], password: params[2] };
      users.push(user);
      return [{ insertId: user.id }];
    }
    if (sql === 'SELECT id FROM users WHERE email = ?') {
      return [users.filter(user => user.email === params[0]).map(user => ({ id: user.id }))];
    }
    if (sql === 'SELECT id FROM users WHERE id = ?') {
      return [users.filter(user => user.id === params[0]).map(user => ({ id: user.id }))];
    }
    if (sql === 'SELECT id, name, email, password FROM users WHERE email = ?') {
      return [users.filter(user => user.email === params[0])];
    }
    if (sql === 'SELECT id, name, email, created_at FROM users WHERE id = ?') {
      return [users.filter(user => user.id === params[0]).map(({ password, ...user }) => user)];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/auth`;
  const request = async (path, body, token) => {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  };
  const account = { name: ' Student ', email: ' STUDENT@example.com ', password: 'StudentPass123!' };
  let token;

  try {
    await t.test('validates required fields and bcrypt password length', async () => {
      const empty = await request('/register', {});
      assert.equal(empty.status, 400);
      assert.deepEqual(Object.keys(empty.data.error.fields), ['name', 'email', 'password']);
      assert.equal((await request('/register', { ...account, password: 'a'.repeat(73) })).status, 400);
      assert.equal((await request('/register', { ...account, email: 'invalid' })).status, 400);
    });
    await t.test('registers and stores a bcrypt hash, with normalized email', async () => {
      const result = await request('/register', account);
      assert.equal(result.status, 201);
      assert.equal(result.data.user.email, 'student@example.com');
      assert.equal(result.data.user.name, 'Student');
      assert.equal(result.data.user.password, undefined);
      assert.notEqual(users[0].password, account.password);
      assert.equal(await bcrypt.compare(account.password, users[0].password), true);
    });
    await t.test('rejects duplicate emails including different capitalization', async () => {
      assert.equal((await request('/register', account)).status, 409);
    });
    await t.test('handles a duplicate insert race', async () => {
      duplicateInsert = true;
      try { assert.equal((await request('/register', { ...account, email: 'other@example.com' })).status, 409); }
      finally { duplicateInsert = false; }
    });
    await t.test('validates login fields', async () => {
      assert.equal((await request('/login', {})).status, 400);
    });
    await t.test('rejects incorrect passwords and unknown accounts', async () => {
      const wrong = await request('/login', { ...account, password: 'wrong-password' });
      const unknown = await request('/login', { ...account, email: 'unknown@example.com' });
      assert.equal(wrong.status, 401);
      assert.equal(unknown.status, 401);
      assert.deepEqual(wrong.data, unknown.data);
    });
    await t.test('returns a signed JWT expiring after one hour', async () => {
      const result = await request('/login', account);
      assert.equal(result.status, 200);
      token = result.data.token;
      const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      assert.equal(payload.sub, '1');
      assert.equal(payload.exp - payload.iat, 3600);
      assert.equal(result.data.user.password, undefined);
    });
    await t.test('protects /me from missing, invalid, expired, and incorrectly signed tokens', async () => {
      assert.equal((await request('/me')).status, 401);
      assert.equal((await request('/me', undefined, 'invalid')).status, 401);
      const expired = jwt.sign({}, process.env.JWT_SECRET, { subject: '1', expiresIn: -1 });
      const wrongSecret = jwt.sign({}, 'a-different-secret', { subject: '1' });
      assert.equal((await request('/me', undefined, expired)).status, 401);
      assert.equal((await request('/me', undefined, wrongSecret)).status, 401);
    });
    await t.test('returns the authenticated user without the password', async () => {
      const result = await request('/me', undefined, token);
      assert.equal(result.status, 200);
      assert.equal(result.data.user.id, 1);
      assert.equal(result.data.user.password, undefined);
    });
    await t.test('rejects tokens for deleted users', async () => {
      const deleted = jwt.sign({}, process.env.JWT_SECRET, { subject: '99', expiresIn: '1h' });
      assert.equal((await request('/me', undefined, deleted)).status, 401);
      for (const path of ['/api/tasks', '/api/tasks/summary', '/api/tasks/1', '/api/users']) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers: { Authorization: `Bearer ${deleted}` } });
        assert.equal(response.status, 401, path);
        assert.deepEqual(await response.json(), { error: { message: 'User account no longer exists.' } });
      }
      for (const [method, path, body] of [['POST', '/api/tasks', { title: 'Not allowed' }], ['PUT', '/api/tasks/1', { title: 'Not allowed' }], ['PATCH', '/api/tasks/1/status', { status: 'done' }], ['DELETE', '/api/tasks/1', undefined]]) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
          method, headers: { Authorization: `Bearer ${deleted}`, 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        assert.equal(response.status, 401, `${method} ${path}`);
      }
    });
    await t.test('a previously valid token loses access after its account is removed', async () => {
      const originalUser = users.pop();
      try {
        assert.equal((await request('/me', undefined, token)).status, 401);
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/tasks`, { headers: { Authorization: `Bearer ${token}` } });
        assert.equal(response.status, 401);
      } finally { users.push(originalUser); }
    });
    await t.test('returns clean malformed JSON errors', async () => {
      const response = await fetch(`${base}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: { message: 'Request body must be valid JSON.' } });
    });
    await t.test('returns a clean error when MySQL is unavailable', async () => {
      failDatabase = true;
      const result = await request('/login', account);
      assert.equal(result.status, 503);
      assert.deepEqual(result.data, { error: { message: 'Database unavailable. Please try again later.' } });
      const profile = await request('/me', undefined, token);
      assert.equal(profile.status, 503);
    });
    await t.test('actual registration and login routes enforce the rate limits', async () => {
      for (const path of ['/register', '/login']) {
        let blocked;
        for (let attempt = 0; attempt < 40; attempt++) {
          const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          const data = await response.json();
          if (response.status === 429) {
            blocked = response;
            assert.match(data.error.message, /Too many/);
            break;
          }
          assert.equal(response.status, 400);
        }
        assert.ok(blocked, `${path} must reject repeated attempts`);
        assert.ok(Number(blocked.headers.get('Retry-After')) > 0);
      }
    });
  } finally {
    pool.execute = originalExecute;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
});
