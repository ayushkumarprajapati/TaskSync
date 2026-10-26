export default function errorHandler(error, _req, res, _next) {
  if (error.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(400).json({ error: { message: 'A referenced user no longer exists. Refresh and try again.' } });
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Request body must be valid JSON.' } });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: { message: 'Request body is too large.' } });
  }
  const databaseErrors = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE'];
  if (databaseErrors.includes(error.code)) {
    console.error(`Database unavailable: ${error.code}`);
    return res.status(503).json({ error: { message: 'Database unavailable. Please try again later.' } });
  }
  console.error(`Request failed: ${error.code || error.name || 'UnknownError'}`);
  return res.status(500).json({ error: { message: 'An unexpected server error occurred.' } });
}
