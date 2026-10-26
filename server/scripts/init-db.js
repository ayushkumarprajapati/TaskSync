import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import pool, { databaseConfig } from '../src/config/db.js';

let connection;

try {
  // Connect without selecting a database because the schema creates it.
  const { database, ...connectionConfig } = databaseConfig;
  if (database !== 'tasksync') {
    throw new Error('DB_NAME must be tasksync to match database/schema.sql.');
  }
  connection = await mysql.createConnection({
    ...connectionConfig,
    connectTimeout: 10000,
    // Only this setup script executes multiple statements from our local schema.
    multipleStatements: true,
  });
  const schema = await readFile(new URL('../../database/schema.sql', import.meta.url), 'utf8');
  await connection.query(schema);
  console.log('TaskSync database and tables are ready.');
} catch (error) {
  console.error(`Database setup failed: ${error.code || error.message}`);
  process.exitCode = 1;
} finally {
  if (connection) await connection.end();
  await pool.end();
}
