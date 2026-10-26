import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import jwt from 'jsonwebtoken';
import { io as client } from 'socket.io-client';
import app from '../src/app.js';
import pool from '../src/config/db.js';
import { createRealtimeServer } from '../src/realtime/socket.js';

const ids = [];
const sockets = [];
const { httpServer, io } = createRealtimeServer(app);
httpServer.listen(0, '127.0.0.1');
await once(httpServer, 'listening');
const base = `http://127.0.0.1:${httpServer.address().port}`;

function wait(socket, event) {
  return new Promise((resolve, reject) => {
    const done = value => { clearTimeout(timer); socket.off(event, done); resolve(value); };
    const timer = setTimeout(() => { socket.off(event, done); reject(new Error(`Timed out waiting for ${event}`)); }, 4000);
    socket.once(event, done);
  });
}
async function connect(token, transport = 'websocket') {
  const socket = client(base, { auth: { token }, transports: [transport], reconnection: false, autoConnect: false });
  sockets.push(socket);
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Connection timed out')), 4000);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('connect_error', error => { clearTimeout(timer); reject(error); });
  });
  socket.connect();
  return result;
}
async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${base}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}

try {
  for (const role of ['creator', 'assignee', 'viewer']) {
    const [result] = await pool.execute('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [`Realtime ${role}`, `realtime-${randomUUID()}@example.com`, 'test-only-not-a-login-hash']);
    ids.push(result.insertId);
  }
  const [creator, assignee, viewer] = ids.map(id => jwt.sign({}, process.env.JWT_SECRET, { subject: String(id), expiresIn: '5m' }));
  for (const token of [undefined, 'invalid', jwt.sign({}, 'incorrect-secret', { subject: String(ids[0]), expiresIn: '1h' }), jwt.sign({}, process.env.JWT_SECRET, { subject: String(ids[0]), expiresIn: -1 }), jwt.sign({}, process.env.JWT_SECRET, { subject: '4294967295', expiresIn: '1h' })]) {
    await assert.rejects(connect(token), error => error.data?.code === 'AUTH_FAILED');
  }
  const observers = [await connect(creator), await connect(assignee), await connect(viewer, 'polling')];
  const events = observers.map(() => []);
  observers.forEach((socket, index) => socket.on('tasks:changed', event => events[index].push(event)));
  console.log('PASS: invalid/expired/deleted-user socket authentication rejected; websocket and polling clients connected');

  async function mutation(path, token, method, body, action, expectedStatus, taskId) {
    const received = Promise.all(observers.filter(socket => socket.connected).map(socket => wait(socket, 'tasks:changed')));
    const result = await request(path, token, method, body);
    assert.equal(result.status, expectedStatus, JSON.stringify(result.data));
    const id = taskId || result.data.task.id;
    for (const event of await received) assert.deepEqual(event, { action, taskId: id });
    return result;
  }
  const body = { title: 'Realtime integration task', priority: 'high', assigned_to: ids[1] };
  const created = await mutation('/tasks', creator, 'POST', body, 'created', 201);
  const id = created.data.task.id;
  assert.equal((await request(`/tasks/${id}`, viewer)).status, 200);

  const count = events.map(list => list.length);
  assert.equal((await request(`/tasks/${id}`, viewer, 'PUT', { ...body, title: 'Forbidden edit' })).status, 403);
  assert.equal((await request(`/tasks/${id}`, assignee, 'PUT', body)).status, 403);
  assert.equal((await request(`/tasks/${id}`, viewer, 'DELETE')).status, 403);
  assert.equal((await request(`/tasks/${id}`, assignee, 'DELETE')).status, 403);
  assert.equal((await request(`/tasks/${id}/status`, viewer, 'PATCH', { status: 'done' })).status, 403);
  assert.equal((await request(`/tasks/${id}/status`, undefined, 'PATCH', { status: 'done' })).status, 401);
  assert.equal((await request('/tasks', creator, 'POST', {})).status, 400);
  observers[2].emit('tasks:changed', { action: 'deleted', taskId: id });
  observers[2].emit('task:update', { id, status: 'done' });
  await delay(200);
  assert.deepEqual(events.map(list => list.length), count);
  const unchanged = (await request(`/tasks/${id}`, creator)).data.task;
  assert.equal(unchanged.status, 'todo');
  assert.equal(unchanged.title, body.title);
  console.log('PASS: rejected REST writes and client-emitted fake events neither modify MySQL nor broadcast');

  await mutation(`/tasks/${id}`, creator, 'PUT', { ...body, title: 'Edited via REST' }, 'updated', 200, id);
  await mutation(`/tasks/${id}/status`, assignee, 'PATCH', { status: 'in_progress' }, 'status_updated', 200, id);
  assert.equal((await request(`/tasks/${id}`, viewer)).data.task.status, 'in_progress');
  console.log('PASS: create, edit and status broadcasts reach creator, assignee and view-only user');

  observers[2].disconnect();
  await mutation(`/tasks/${id}/status`, creator, 'PATCH', { status: 'done' }, 'status_updated', 200, id);
  const reconnect = wait(observers[2], 'connect');
  observers[2].connect();
  await reconnect;
  assert.equal((await request(`/tasks/${id}`, viewer)).data.task.status, 'done');
  await mutation(`/tasks/${id}`, creator, 'PUT', { ...body, title: 'Reassigned', assigned_to: null }, 'updated', 200, id);
  assert.equal((await request(`/tasks/${id}/status`, assignee, 'PATCH', { status: 'todo' })).status, 403);
  await mutation(`/tasks/${id}`, creator, 'DELETE', undefined, 'deleted', 200, id);
  assert.equal((await request(`/tasks/${id}`, viewer)).status, 404);
  console.log('PASS: reconnect/resync, unassignment authorization and delete broadcasts');

  const expiring = await connect(jwt.sign({}, process.env.JWT_SECRET, { subject: String(ids[0]), expiresIn: '2s' }));
  await wait(expiring, 'disconnect');
  assert.equal(expiring.connected, false);
  console.log('PASS: an established socket is disconnected when its JWT expires');

  // Remove only our temporary, view-only account while its socket is active.
  // The next mutation must notify remaining users without leaking an event.
  const viewerEventCount = events[2].length;
  const disconnectedViewer = wait(observers[2], 'disconnect');
  await pool.execute('DELETE FROM users WHERE id = ?', [ids[2]]);
  const allowedEvents = Promise.all(observers.slice(0, 2).map(socket => wait(socket, 'tasks:changed')));
  const afterRemoval = await request('/tasks', creator, 'POST', { title: 'Account revocation check' });
  assert.equal(afterRemoval.status, 201);
  await allowedEvents;
  await disconnectedViewer;
  assert.equal(events[2].length, viewerEventCount);
  assert.equal((await request('/tasks', viewer)).status, 401);
  await assert.rejects(connect(viewer), error => error.data?.code === 'AUTH_FAILED');
  console.log('PASS: actual MySQL account deletion revokes REST, blocks socket reconnects, and prevents further task broadcasts');
} finally {
  sockets.forEach(socket => socket.disconnect());
  await new Promise(resolve => io.close(resolve));
  try {
    for (const id of ids) await pool.execute('DELETE FROM tasks WHERE created_by = ?', [id]);
    for (const id of ids) await pool.execute('DELETE FROM users WHERE id = ?', [id]);
  } finally { await pool.end(); }
}
