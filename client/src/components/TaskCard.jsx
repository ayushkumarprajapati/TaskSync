import { statuses, priorities, displayDate } from '../utils/tasks.js';

export default function TaskCard({ task, userId, busy, onStatus, onEdit, onDelete }) {
  const own = task.created_by === userId;
  const canUpdateStatus = own || task.assigned_to === userId;
  const overdue = task.due_date && task.status !== 'done' && new Date(`${task.due_date}T23:59:59`) < new Date();
  return (
    <article className={`task-card ${task.status === 'done' ? 'task-done' : ''}`}>
      <div className="task-top"><span className={`priority priority-${task.priority}`}><span aria-hidden="true">●</span> {priorities[task.priority]} priority</span><span className="task-number">#{task.id}</span></div>
      <h3>{task.title}</h3>
      {task.description && <p className="task-description">{task.description}</p>}
      <dl className="task-meta"><div><dt>Assigned to</dt><dd>{task.assignee_name || 'Unassigned'}{task.assigned_to === userId ? ' (you)' : ''}</dd></div><div><dt>Created by</dt><dd>{own ? 'You' : task.creator_name}</dd></div><div><dt>Due date</dt><dd className={overdue ? 'overdue' : ''}>{displayDate(task.due_date)}{overdue ? ' · Overdue' : ''}</dd></div></dl>
      <div className="task-bottom"><label className="sr-only" htmlFor={`status-${task.id}`}>Status of {task.title}</label><select id={`status-${task.id}`} className={`task-status status-${task.status}`} value={task.status} onChange={event => onStatus(task, event.target.value)} disabled={busy || !canUpdateStatus} title={canUpdateStatus ? 'Update status' : 'Only the creator or assigned user can change status'}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{own ? <div className="task-actions"><button className="text-button" aria-label={`Edit ${task.title}`} onClick={() => onEdit(task)} disabled={busy}>Edit</button><button className="text-button danger-text" aria-label={`Delete ${task.title}`} onClick={() => onDelete(task)} disabled={busy}>Delete</button></div> : !canUpdateStatus && <span className="read-only-label">View only</span>}</div>
    </article>
  );
}
