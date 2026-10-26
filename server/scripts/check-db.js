import pool from '../src/config/db.js';

try {
  await pool.query('SELECT 1');
  console.log('MySQL connection successful.');
} catch (error) {
  console.error(`MySQL connection failed (${error.code || 'UNKNOWN'}). Check server/.env and make sure MySQL is running.`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
