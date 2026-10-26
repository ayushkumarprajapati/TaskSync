import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import pool from '../src/config/db.js';

const prefix = `task-test-${randomUUID()}`;
const ids = [];
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}/api`;
async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}
async function list(token, query = '') {
  return request(`/tasks?search=${prefix}&${query}`, token);
}

try {
  for (const role of ['creator', 'assignee', 'viewer']) {
    const [result] = await pool.execute('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [`Task Test ${role}`, `${role}-${randomUUID()}@example.com`, 'test-only-not-a-login-hash']);
    ids.push(result.insertId);
  }
  const [creator, assignee, viewer] = ids.map(id => jwt.sign({}, process.env.JWT_SECRET, { subject: String(id), expiresIn: '5m' }));
  const baseline = (await request('/tasks/summary', creator)).data.summary;
  assert.equal((await request('/tasks')).status, 401);
  assert.equal((await request('/users')).status, 401);
  const people = (await request('/users', creator)).data.users;
  assert.ok(people.some(user => user.id === ids[1]));
  assert.ok(people.every(user => !('password' in user) && !('email' in user)));

  const original = { title: `${prefix} interview demo`, description: 'Explain permissions', priority: 'high', assigned_to: ids[1], due_date: '2027-02-28', created_by: ids[2], status: 'done' };
  const created = await request('/tasks', creator, 'POST', original);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const task = created.data.task;
  assert.equal(task.created_by, ids[0]);
  assert.equal(task.status, 'todo');
  assert.equal(task.due_date, '2027-02-28');
  for (const token of [creator, assignee, viewer]) {
    assert.equal((await request(`/tasks/${task.id}`, token)).status, 200);
    assert.equal((await list(token)).data.tasks.length, 1);
  }
  assert.equal((await list(assignee, 'assignedTo=me')).data.tasks.length, 1);
  assert.equal((await list(creator, 'assignedTo=me')).data.tasks.length, 0);
  assert.equal((await list(viewer, `assignedTo=${ids[1]}&status=todo&priority=high`)).data.tasks.length, 1);
  assert.equal((await list(creator, 'status=done')).data.tasks.length, 0);
  console.log('PASS: authenticated workspace visibility, numeric/legacy filters and creator identity');

  for (const token of [assignee, viewer]) {
    assert.equal((await request(`/tasks/${task.id}`, token, 'PUT', original)).status, 403);
    assert.equal((await request(`/tasks/${task.id}`, token, 'DELETE')).status, 403);
  }
  assert.equal((await request(`/tasks/${task.id}/status`, viewer, 'PATCH', { status: 'done' })).status, 403);
  assert.equal((await request(`/tasks/${task.id}/status`, assignee, 'PATCH', { status: 'in_progress' })).status, 200);
  const expected = { ...baseline, total: baseline.total + 1, in_progress: baseline.in_progress + 1 };
  assert.deepEqual((await request('/tasks/summary', viewer)).data.summary, expected);
  console.log('PASS: backend creator/assignee/viewer permissions and shared summary');

  for (const body of [{}, { ...original, due_date: '2027-02-30' }, { ...original, priority: 'urgent' }, { ...original, assigned_to: [ids[1]] }, { ...original, description: {} }, { ...original, assigned_to: 4294967295 }]) {
    assert.equal((await request('/tasks', creator, 'POST', body)).status, 400);
  }
  assert.equal((await request('/tasks?status=invalid', creator)).status, 400);
  for (const invalid of ['0', '-1', '1.5', '4294967296', 'abc', '1%20OR%201%3D1', 'me&assignedTo=me']) {
    assert.equal((await request(`/tasks?assignedTo=${invalid}`, creator)).status, 400);
  }
  assert.equal((await request(`/tasks/${task.id}/status`, creator, 'PATCH', { status: 'invalid' })).status, 400);
  assert.equal((await request('/tasks/not-an-id', creator)).status, 404);

  const edited = await request(`/tasks/${task.id}`, creator, 'PUT', { title: `${prefix} updated`, priority: 'low', assigned_to: null, due_date: null });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.task.assigned_to, null);
  assert.equal(edited.data.task.due_date, null);
  assert.equal((await request(`/tasks/${task.id}`, assignee)).status, 200);
  assert.equal((await request(`/tasks/${task.id}/status`, assignee, 'PATCH', { status: 'done' })).status, 403);
  assert.equal((await request(`/tasks/${task.id}/status`, creator, 'PATCH', { status: 'done' })).status, 200);
  assert.equal((await request(`/tasks/${task.id}`, creator, 'DELETE')).status, 200);
  assert.equal((await request(`/tasks/${task.id}`, creator)).status, 404);
  assert.deepEqual((await request('/tasks/summary', creator)).data.summary, baseline);
  console.log('PASS: validation, creator edits/deletion, and status rights removed on unassignment');

  const first = (await request('/tasks', creator, 'POST', { title: `${prefix} low`, priority: 'low', assigned_to: ids[1] })).data.task;
  const second = (await request('/tasks', creator, 'POST', { title: `${prefix} high`, priority: 'high', assigned_to: ids[2] })).data.task;
  await request(`/tasks/${second.id}/status`, creator, 'PATCH', { status: 'done' });
  const taskIds = async (query = '', token = creator) => (await list(token, query)).data.tasks.map(item => item.id);
  assert.deepEqual(await taskIds(), [second.id, first.id]);
  assert.deepEqual(await taskIds('status=todo'), [first.id]);
  assert.deepEqual(await taskIds('priority=high'), [second.id]);
  assert.deepEqual(await taskIds(`assignedTo=${ids[2]}&status=done&priority=high`), [second.id]);
  assert.deepEqual(await taskIds(`assignedTo=${ids[1]}&status=done`), []);
  assert.deepEqual(await taskIds('assignedTo=me', assignee), [first.id]);
  assert.deepEqual(await taskIds(`assignedTo=${ids[2]}`, assignee), [second.id]);
  console.log('PASS: combined SQL filters and newest-first ordering across the shared workspace');
} finally {
  try {
    for (const id of ids) await pool.execute('DELETE FROM tasks WHERE created_by = ?', [id]);
    for (const id of ids) await pool.execute('DELETE FROM users WHERE id = ?', [id]);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
}
