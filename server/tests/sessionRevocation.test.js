import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import jwt from 'jsonwebtoken';
import { io as client } from 'socket.io-client';
import app from '../src/app.js';
import pool from '../src/config/db.js';
import { createRealtimeServer, broadcastTaskChange } from '../src/realtime/socket.js';

// Real HTTP/Socket.IO connections, with account removal simulated in memory.
async function harness(options) {
  const originalExecute = pool.execute;
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  const accounts = new Set([1, 2]);
  let unavailable = false;
  pool.execute = async (sql, values) => {
    if (unavailable) throw Object.assign(new Error('Database unavailable'), { code: 'ECONNREFUSED' });
    if (sql === 'SELECT id FROM users WHERE id = ?' || sql.startsWith('SELECT id FROM users WHERE id IN (')) {
      return [values.filter(id => accounts.has(id)).map(id => ({ id }))];
    }
    if (sql.includes('FROM tasks t')) return [[{ id: 77, title: 'Authorized task' }]];
    throw new Error(`Unexpected query: ${sql}`);
  };
  const { httpServer, io } = createRealtimeServer(app, options);
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  const url = `http://127.0.0.1:${httpServer.address().port}`;
  const sockets = [];
  const token = id => jwt.sign({}, process.env.JWT_SECRET, { subject: String(id), expiresIn: '1h' });
  async function connect(id) {
    const socket = client(url, { auth: { token: token(id) }, reconnection: false, autoConnect: false, transports: ['websocket'] });
    sockets.push(socket);
    const ready = new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
    socket.connect();
    return ready;
  }
  return {
    accounts, connect, broadcast: () => broadcastTaskChange({ app }, 'updated', 77),
    unavailable: value => { unavailable = value; },
    request: id => fetch(`${url}/api/tasks`, { headers: { Authorization: `Bearer ${token(id)}` } }),
    close: async () => {
      sockets.forEach(socket => socket.disconnect());
      await new Promise(resolve => io.close(resolve));
      pool.execute = originalExecute;
      if (originalSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = originalSecret;
    },
  };
}

function wait(socket, event) {
  return new Promise((resolve, reject) => {
    const done = value => { clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => { socket.off(event, done); reject(new Error(`Timed out waiting for ${event}`)); }, 3000);
    socket.once(event, done);
  });
}

test('a revoked REST request disconnects existing user sockets and returns 401', async () => {
  const h = await harness();
  try {
    const current = await h.connect(1);
    const removed = await h.connect(2);
    assert.equal((await h.request(2)).status, 200);
    h.accounts.delete(2);
    const disconnected = wait(removed, 'disconnect');
    assert.equal((await h.request(2)).status, 401);
    await disconnected;
    assert.equal(current.connected, true);
    assert.equal((await h.request(1)).status, 200);
    await assert.rejects(h.connect(2), error => error.data?.code === 'AUTH_FAILED');
  } finally { await h.close(); }
});

test('broadcast checks account existence before delivery and disconnects removed recipients', async () => {
  const h = await harness();
  try {
    const current = await h.connect(1);
    const removed = await h.connect(2);
    const leaked = [];
    removed.on('tasks:changed', event => leaked.push(event));
    h.accounts.delete(2);
    const received = wait(current, 'tasks:changed');
    const disconnected = wait(removed, 'disconnect');
    await h.broadcast();
    assert.deepEqual(await received, { action: 'updated', taskId: 77 });
    await disconnected;
    await delay(100);
    assert.deepEqual(leaked, []);
  } finally { await h.close(); }
});

test('idle sockets are rechecked and disconnected without waiting for a REST request or broadcast', async () => {
  const h = await harness({ accountCheckIntervalMs: 50 });
  try {
    const current = await h.connect(1);
    const removed = await h.connect(2);
    const disconnected = wait(removed, 'disconnect');
    h.accounts.delete(2);
    await disconnected;
    assert.equal(removed.connected, false);
    assert.equal(current.connected, true);
  } finally { await h.close(); }
});

test('database authorization failures send no socket events and do not mislabel REST requests as invalid tokens', async () => {
  const h = await harness();
  try {
    const socket = await h.connect(1);
    const received = [];
    socket.on('tasks:changed', event => received.push(event));
    h.unavailable(true);
    assert.equal((await h.request(1)).status, 503);
    await h.broadcast();
    await delay(100);
    assert.deepEqual(received, []);
    assert.equal(socket.connected, true);
    h.unavailable(false);
    const resumed = wait(socket, 'tasks:changed');
    await h.broadcast();
    assert.deepEqual(await resumed, { action: 'updated', taskId: 77 });
  } finally { await h.close(); }
});

after(() => pool.end());
