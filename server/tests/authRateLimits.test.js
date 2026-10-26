import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import { createAuthRateLimits } from '../src/middleware/authRateLimits.js';

// A small HTTP harness exercises the actual middleware without hashing passwords
// or writing accounts. Limits are lowered here; production defaults are unchanged.
async function harness(options = {}, proxyHops = 0) {
  const app = express();
  app.set('trust proxy', proxyHops);
  app.use(express.json());
  const limits = createAuthRateLimits(options);
  const reached = { register: 0, login: 0 };
  app.post('/register', limits.registration, (_req, res) => { reached.register++; res.status(201).json({ ok: true }); });
  app.post('/login', limits.loginIp, limits.loginAccount, (req, res) => { reached.login++; res.status(req.body.password === 'valid' ? 200 : 401).json({ ok: true }); });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    reached,
    post: (path, body = {}, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    }),
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

test('registration/IP throttle returns clean 429, Retry-After, and blocks controller work', async () => {
  const h = await harness({ registrationLimit: 2 });
  try {
    assert.equal((await h.post('/register')).status, 201);
    assert.equal((await h.post('/register')).status, 201);
    const blocked = await h.post('/register');
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('Retry-After')) > 0);
    assert.ok(blocked.headers.get('RateLimit'));
    assert.equal((await blocked.json()).error.message, 'Too many registration attempts. Please try again later.');
    assert.equal(h.reached.register, 2);
    assert.equal((await h.post('/login', { password: 'valid' })).status, 200);
  } finally { await h.close(); }
});

test('login/IP throttle bounds attempts across different emails', async () => {
  const h = await harness({ loginIpLimit: 2, loginAccountLimit: 20 });
  try {
    assert.equal((await h.post('/login', { email: 'one@example.com' })).status, 401);
    assert.equal((await h.post('/login', { email: 'two@example.com' })).status, 401);
    assert.equal((await h.post('/login', { email: 'three@example.com' })).status, 429);
    assert.equal(h.reached.login, 2);
  } finally { await h.close(); }
});

test('account throttle normalizes email and applies across trusted client IPs', async () => {
  const h = await harness({ loginIpLimit: 20, loginAccountLimit: 2 }, 1);
  try {
    assert.equal((await h.post('/login', { email: ' USER@example.com ' }, { 'X-Forwarded-For': '192.0.2.1' })).status, 401);
    assert.equal((await h.post('/login', { email: 'user@example.com' }, { 'X-Forwarded-For': '192.0.2.2' })).status, 401);
    const blocked = await h.post('/login', { email: 'USER@example.com' }, { 'X-Forwarded-For': '192.0.2.3' });
    assert.equal(blocked.status, 429);
    assert.match((await blocked.json()).error.message, /this account/);
    assert.equal((await h.post('/login', { email: 'other@example.com' })).status, 401);
  } finally { await h.close(); }
});

test('successful logins do not exhaust the failed-account budget', async () => {
  const h = await harness({ loginIpLimit: 20, loginAccountLimit: 2 });
  try {
    for (let i = 0; i < 4; i++) assert.equal((await h.post('/login', { email: 'user@example.com', password: 'valid' })).status, 200);
    assert.equal((await h.post('/login', { email: 'user@example.com' })).status, 401);
    assert.equal((await h.post('/login', { email: 'user@example.com' })).status, 401);
    assert.equal((await h.post('/login', { email: 'user@example.com' })).status, 429);
  } finally { await h.close(); }
});

test('rate limits reset after their window', async () => {
  const h = await harness({ windowMs: 500, registrationLimit: 1 });
  try {
    assert.equal((await h.post('/register')).status, 201);
    assert.equal((await h.post('/register')).status, 429);
    await delay(600);
    assert.equal((await h.post('/register')).status, 201);
  } finally { await h.close(); }
});
