export const taskSelection = `SELECT t.id, t.title, t.description, t.status, t.priority,
  t.assigned_to, t.created_by, DATE_FORMAT(t.due_date, '%Y-%m-%d') AS due_date,
  t.created_at, t.updated_at, creator.name AS creator_name, assignee.name AS assignee_name
  FROM tasks t JOIN users creator ON creator.id = t.created_by
  LEFT JOIN users assignee ON assignee.id = t.assigned_to`;

// Values are validated in the controller and always passed as SQL parameters.
// Kept here so the EXPLAIN script measures the same query as the endpoint.
export function taskListQuery(userId, { status, priority, assignedTo, search } = {}) {
  const conditions = [];
  const values = [];
  if (status) { conditions.push('t.status = ?'); values.push(status); }
  if (priority) { conditions.push('t.priority = ?'); values.push(priority); }
  if (assignedTo) { conditions.push('t.assigned_to = ?'); values.push(assignedTo === 'me' ? userId : Number(assignedTo)); }
  if (search?.trim()) { conditions.push('LOCATE(?, t.title) > 0'); values.push(search.trim()); }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  return { sql: `${taskSelection}${where} ORDER BY t.created_at DESC, t.id DESC`, values };
}
