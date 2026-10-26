import pool from '../src/config/db.js';

// Safe to rerun on an existing installation; never removes existing indexes.
const indexes = [
  { name: 'idx_tasks_status_priority', columns: ['status', 'priority'] },
  { name: 'idx_tasks_assignee_status_priority', columns: ['assigned_to', 'status', 'priority'] },
];

try {
  const [existing] = await pool.query('SHOW INDEX FROM tasks');
  for (const index of indexes) {
    const definition = existing.filter(row => row.Key_name === index.name).sort((a, b) => a.Seq_in_index - b.Seq_in_index);
    if (definition.length) {
      if (definition.map(row => row.Column_name).join(',') !== index.columns.join(',') || definition.some(row => row.Sub_part !== null || row.Visible !== 'YES')) {
        throw new Error(`Existing index ${index.name} has an unexpected definition. Inspect it before migrating.`);
      }
      console.log(`${index.name} already exists.`);
      continue;
    }
    // Names and columns come only from the fixed definitions above, not input.
    await pool.query(`ALTER TABLE tasks ADD INDEX ${index.name} (${index.columns.join(', ')})`);
    console.log(`Added ${index.name}.`);
  }
  await pool.query('ANALYZE TABLE tasks');
} catch (error) {
  console.error(`Task index setup failed: ${error.code || error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
