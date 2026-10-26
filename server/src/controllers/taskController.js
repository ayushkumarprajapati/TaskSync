import pool from '../config/db.js';
import { taskSelection as selection, taskListQuery } from '../queries/taskQueries.js';
import { broadcastTaskChange } from '../realtime/socket.js';

const statuses = ['todo', 'in_progress', 'done'];
const priorities = ['low', 'medium', 'high'];
const isId = value => ['string', 'number'].includes(typeof value) && /^[1-9]\d*$/.test(String(value)) && Number(value) <= 4294967295;

async function visibleTask(id) {
  if (!isId(id)) return null;
  const [rows] = await pool.execute(`${selection} WHERE t.id = ?`, [id]);
  return rows[0] || null;
}

function taskInput(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const description = body?.description ?? null;
  const priority = body?.priority ?? 'medium';
  const assignedTo = body?.assigned_to ?? null;
  const dueDate = body?.due_date ?? null;
  const fields = {};
  if (!title || title.length > 200) fields.title = 'Title must contain 1–200 characters.';
  if (description !== null && (typeof description !== 'string' || Buffer.byteLength(description, 'utf8') > 65535)) {
    fields.description = 'Description must be text, up to 65,535 UTF-8 bytes.';
  }
  if (!priorities.includes(priority)) fields.priority = 'Choose low, medium, or high priority.';
  if (assignedTo !== null && !isId(assignedTo)) fields.assigned_to = 'Choose a registered user or leave unassigned.';
  if (dueDate !== null) {
    const validFormat = typeof dueDate === 'string' && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(dueDate);
    const parsed = validFormat ? new Date(`${dueDate}T00:00:00Z`) : null;
    if (!parsed || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== dueDate) fields.due_date = 'Enter a valid date in YYYY-MM-DD format.';
  }
  return { title, description, priority, assignedTo, dueDate, fields };
}

async function assigneeExists(id) {
  if (id === null) return true;
  const [rows] = await pool.execute('SELECT id FROM users WHERE id = ?', [id]);
  return rows.length > 0;
}

function notFound(res) {
  return res.status(404).json({ error: { message: 'Task not found.' } });
}

export async function listTasks(req, res) {
  const { status, priority, assignedTo, search } = req.query;
  if ((status !== undefined && !statuses.includes(status)) ||
      (priority !== undefined && !priorities.includes(priority)) ||
      (assignedTo !== undefined && assignedTo !== 'me' && !isId(assignedTo)) ||
      (search !== undefined && (typeof search !== 'string' || search.length > 200))) {
    return res.status(400).json({ error: { message: 'Invalid task filters.' } });
  }
  const { sql, values } = taskListQuery(req.user.id, req.query);
  const [tasks] = await pool.execute(sql, values);
  return res.json({ tasks });
}

export async function summary(_req, res) {
  const [[row]] = await pool.execute(`SELECT COUNT(*) AS total,
    COALESCE(SUM(status = 'todo'), 0) AS todo,
    COALESCE(SUM(status = 'in_progress'), 0) AS in_progress,
    COALESCE(SUM(status = 'done'), 0) AS done
    FROM tasks`);
  return res.json({ summary: Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])) });
}

export async function getTask(req, res) {
  const task = await visibleTask(req.params.id);
  return task ? res.json({ task }) : notFound(res);
}

export async function createTask(req, res) {
  const input = taskInput(req.body);
  if (Object.keys(input.fields).length) return res.status(400).json({ error: { message: 'Validation failed.', fields: input.fields } });
  if (!(await assigneeExists(input.assignedTo))) return res.status(400).json({ error: { message: 'The assigned user does not exist.', fields: { assigned_to: 'Choose a registered user.' } } });
  const [result] = await pool.execute(
    'INSERT INTO tasks (title, description, priority, assigned_to, created_by, due_date) VALUES (?, ?, ?, ?, ?, ?)',
    [input.title, input.description, input.priority, input.assignedTo, req.user.id, input.dueDate],
  );
  await broadcastTaskChange(req, 'created', result.insertId);
  return res.status(201).json({ task: await visibleTask(result.insertId) });
}

export async function updateTask(req, res) {
  const task = await visibleTask(req.params.id);
  if (!task) return notFound(res);
  if (task.created_by !== req.user.id) return res.status(403).json({ error: { message: 'Only the creator can edit task details.' } });
  const input = taskInput(req.body);
  if (Object.keys(input.fields).length) return res.status(400).json({ error: { message: 'Validation failed.', fields: input.fields } });
  if (!(await assigneeExists(input.assignedTo))) return res.status(400).json({ error: { message: 'The assigned user does not exist.', fields: { assigned_to: 'Choose a registered user.' } } });
  const [result] = await pool.execute(
    'UPDATE tasks SET title = ?, description = ?, priority = ?, assigned_to = ?, due_date = ? WHERE id = ? AND created_by = ?',
    [input.title, input.description, input.priority, input.assignedTo, input.dueDate, task.id, req.user.id],
  );
  if (!result.affectedRows) return notFound(res);
  await broadcastTaskChange(req, 'updated', task.id);
  return res.json({ task: await visibleTask(task.id) });
}

export async function updateStatus(req, res) {
  const status = req.body?.status;
  if (!statuses.includes(status)) return res.status(400).json({ error: { message: 'Status must be todo, in_progress, or done.' } });
  const task = await visibleTask(req.params.id);
  if (!task) return notFound(res);
  if (task.created_by !== req.user.id && task.assigned_to !== req.user.id) {
    return res.status(403).json({ error: { message: 'Only the creator or assigned user can update task status.' } });
  }
  const [result] = await pool.execute('UPDATE tasks SET status = ? WHERE id = ? AND (created_by = ? OR assigned_to = ?)', [status, task.id, req.user.id, req.user.id]);
  if (!result.affectedRows) return res.status(403).json({ error: { message: 'Task access changed. Refresh and try again.' } });
  await broadcastTaskChange(req, 'status_updated', task.id);
  return res.json({ task: await visibleTask(task.id) });
}

export async function deleteTask(req, res) {
  const task = await visibleTask(req.params.id);
  if (!task) return notFound(res);
  if (task.created_by !== req.user.id) return res.status(403).json({ error: { message: 'Only the creator can delete a task.' } });
  const [result] = await pool.execute('DELETE FROM tasks WHERE id = ? AND created_by = ?', [task.id, req.user.id]);
  if (!result.affectedRows) return notFound(res);
  await broadcastTaskChange(req, 'deleted', task.id);
  return res.json({ message: 'Task deleted.' });
}
