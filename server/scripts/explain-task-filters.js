import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import pool from '../src/config/db.js';
import { taskListQuery } from '../src/queries/taskQueries.js';

// Only the two uniquely named scratch tables are populated or altered.
// Existing users/tasks are read for metadata/counts, never copied or modified.
const suffix = randomBytes(6).toString('hex');
const taskTable = `perf_tasks_${suffix}`;
const userTable = `perf_users_${suffix}`;
const db = await pool.getConnection();
let usersCreated = false;
let tasksCreated = false;
let seed = 20261026;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
const cases = [
  { name: 'No filters', userId: 1, filters: {} },
  { name: 'Status only', userId: 1, filters: { status: 'done' } },
  { name: 'Priority only', userId: 1, filters: { priority: 'high' } },
  { name: 'Status + priority', userId: 1, filters: { status: 'done', priority: 'high' } },
  { name: 'Assigned to me', userId: 1, filters: { assignedTo: 'me' } },
  { name: 'Me + status + priority', userId: 1, filters: { assignedTo: 'me', status: 'done', priority: 'high' } },
  { name: 'Other assignee + status + priority', userId: 1, filters: { assignedTo: '2', status: 'done', priority: 'high' } },
  { name: 'Sparse user + status + priority', userId: 2, filters: { status: 'done', priority: 'high' } },
];
const candidates = [
  { name: 'idx_tasks_creator_status_priority', columns: 'created_by, status, priority' },
  { name: 'idx_tasks_assignee_status_priority', columns: 'assigned_to, status, priority' },
  { name: 'idx_tasks_status_priority', columns: 'status, priority' },
];

async function explain(entry, scratch) {
  const query = taskListQuery(entry.userId, entry.filters);
  const sql = scratch ? query.sql.replace('FROM tasks t', `FROM ${taskTable} t`)
    .replace('JOIN users creator', `JOIN ${userTable} creator`)
    .replace('JOIN users assignee', `JOIN ${userTable} assignee`) : query.sql;
  const [plan] = await db.execute(`EXPLAIN ${sql}`, query.values);
  const [analysis] = await db.execute(`EXPLAIN ANALYZE ${sql}`, query.values);
  const [rows] = await db.execute(sql, query.values);
  return { sql: query.sql, values: query.values, plan, analysis: Object.values(analysis[0])[0], returned: rows.length, ids: rows.map(row => row.id) };
}

try {
  const [[version]] = await db.query('SELECT VERSION() AS mysql_version');
  const [[live]] = await db.query('SELECT COUNT(*) AS task_count FROM tasks');
  const [liveIndexes] = await db.query('SHOW INDEX FROM tasks');
  const livePlans = [];
  for (const entry of cases) livePlans.push({ name: entry.name, ...await explain(entry, false) });

  await db.query(`CREATE TABLE ${userTable} LIKE users`);
  usersCreated = true;
  await db.query(`CREATE TABLE ${taskTable} LIKE tasks`);
  tasksCreated = true;
  const [copiedIndexes] = await db.query(`SHOW INDEX FROM ${taskTable}`);
  for (const name of new Set(copiedIndexes.map(index => index.Key_name))) {
    if (name !== 'PRIMARY') await db.query(`ALTER TABLE ${taskTable} DROP INDEX \`${name}\``);
  }
  await db.query(`ALTER TABLE ${taskTable} ADD INDEX idx_tasks_created_by (created_by), ADD INDEX idx_tasks_assigned_to (assigned_to)`);
  const users = Array.from({ length: 500 }, (_, index) => [index + 1, `Synthetic user ${index + 1}`, `synthetic-${index + 1}@example.com`, 'not-a-real-account']);
  await db.query(`INSERT INTO ${userTable} (id, name, email, password) VALUES ?`, [users]);
  for (let offset = 0; offset < 30000; offset += 1000) {
    const batch = [];
    for (let index = offset; index < offset + 1000; index++) {
      const creator = random() < 0.2 ? 1 : 2 + Math.floor(random() * 499);
      const assigned = random();
      const assignee = assigned < 0.2 ? null : assigned < 0.35 ? 1 : 2 + Math.floor(random() * 499);
      const state = random();
      const priority = random();
      const createdAt = new Date(Date.UTC(2026, 9, 1) + index * 60000).toISOString().slice(0, 19).replace('T', ' ');
      batch.push([index + 1, `Synthetic task ${index + 1}`, 'Synthetic description. '.repeat(5), state < 0.7 ? 'todo' : state < 0.9 ? 'in_progress' : 'done', priority < 0.6 ? 'low' : priority < 0.9 ? 'medium' : 'high', assignee, creator, createdAt, createdAt]);
    }
    await db.query(`INSERT INTO ${taskTable} (id, title, description, status, priority, assigned_to, created_by, created_at, updated_at) VALUES ?`, [batch]);
  }
  await db.query(`ANALYZE TABLE ${taskTable}, ${userTable}`);
  const before = [];
  for (const entry of cases) before.push({ name: entry.name, ...await explain(entry, true) });
  for (const index of candidates) await db.query(`ALTER TABLE ${taskTable} ADD INDEX ${index.name} (${index.columns})`);
  await db.query(`ANALYZE TABLE ${taskTable}, ${userTable}`);
  const trial = [];
  for (const entry of cases) trial.push({ name: entry.name, ...await explain(entry, true) });
  // The first trial did not use the creator-leading candidate for these queries.
  // Keep the final comparison limited to the indexes selected for deployment.
  await db.query(`ALTER TABLE ${taskTable} DROP INDEX idx_tasks_creator_status_priority`);
  await db.query(`ANALYZE TABLE ${taskTable}`);
  const after = [];
  for (let index = 0; index < cases.length; index++) {
    const result = { name: cases[index].name, ...await explain(cases[index], true) };
    assert.deepEqual(result.ids, before[index].ids, `Indexing changed results for ${result.name}`);
    after.push(result);
  }
  const [[distribution]] = await db.query(`SELECT COUNT(*) AS tasks,
    SUM(created_by = 1) AS created_by_1, SUM(assigned_to = 1) AS assigned_to_1,
    SUM(assigned_to IS NULL) AS unassigned,
    SUM(status = 'todo') AS todo, SUM(status = 'in_progress') AS in_progress, SUM(status = 'done') AS done,
    SUM(priority = 'low') AS low, SUM(priority = 'medium') AS medium, SUM(priority = 'high') AS high
    FROM ${taskTable}`);
  // Raw plans/iterator rows are retained; result ID arrays need not be stored.
  const compact = results => results.map(({ ids, ...result }) => result);
  const report = { measuredAt: new Date().toISOString(), ...version, live, liveIndexes, livePlans: compact(livePlans),
    fixture: { seed: 20261026, users: 500, ...distribution }, candidates,
    selectedIndexes: candidates.filter(index => index.name !== 'idx_tasks_creator_status_priority'),
    before: compact(before), trial: compact(trial), after: compact(after) };
  await writeFile(new URL('../../database/filter-explain-results.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
  for (let index = 0; index < cases.length; index++) {
    const brief = result => result.plan.filter(row => row.table === 't').map(row => ({ type: row.type, key: row.key, rows: row.rows, filtered: row.filtered, extra: row.Extra }));
    console.log(JSON.stringify({ query: cases[index].name, returned: after[index].returned, before: brief(before[index]), after: brief(after[index]) }));
  }
  console.log('Raw EXPLAIN and EXPLAIN ANALYZE saved to database/filter-explain-results.json. Result IDs/order match before and after.');
} finally {
  try {
    if (tasksCreated) await db.query(`DROP TABLE ${taskTable}`);
    if (usersCreated) await db.query(`DROP TABLE ${userTable}`);
  } finally {
    db.release();
    await pool.end();
  }
}
