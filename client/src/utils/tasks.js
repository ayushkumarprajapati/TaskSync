export const statuses = { todo: 'To do', in_progress: 'In progress', done: 'Done' };
export const priorities = { low: 'Low', medium: 'Medium', high: 'High' };
export function displayDate(date) {
  return date ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T00:00:00`)) : 'No due date';
}
