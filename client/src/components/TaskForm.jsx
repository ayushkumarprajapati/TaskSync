import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { priorities } from '../utils/tasks.js';

export default function TaskForm({ task, users, onSave, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      title: form.get('title'), description: form.get('description') || null,
      priority: form.get('priority'), assigned_to: form.get('assigned_to') ? Number(form.get('assigned_to')) : null,
      due_date: form.get('due_date') || null,
    };
    setBusy(true);
    setError('');
    setFields({});
    try { await onSave(body); }
    catch (error) { setError(error.message); setFields(error.fields || {}); }
    finally { setBusy(false); }
  }
  return (
    <Dialog title={task.id ? 'Edit task' : 'Create a task'} onClose={onClose} busy={busy}>
      <p className="subtitle">A clear next step makes all the difference.</p>
      {error && <p className="notice error" role="alert">{error}</p>}
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <label htmlFor="task-title">Task title <span className="required">*</span></label>
          <input id="task-title" name="title" placeholder="What needs to get done?" defaultValue={task.title || ''} required maxLength={200} autoFocus aria-invalid={Boolean(fields.title)} aria-describedby={fields.title ? 'task-title-error' : undefined} />
          {fields.title && <p className="field-error" id="task-title-error">{fields.title}</p>}
          <label htmlFor="task-description">Description</label>
          <textarea id="task-description" name="description" rows={3} defaultValue={task.description || ''} placeholder="Add context, notes, or a little direction…" aria-invalid={Boolean(fields.description)} />
          {fields.description && <p className="field-error">{fields.description}</p>}
          <div className="form-columns">
            <div><label htmlFor="task-priority">Priority</label><select id="task-priority" name="priority" defaultValue={task.priority || 'medium'}>{Object.entries(priorities).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
            <div><label htmlFor="task-due">Due date</label><input id="task-due" name="due_date" type="date" min="1000-01-01" max="9999-12-31" defaultValue={task.due_date || ''} aria-invalid={Boolean(fields.due_date)} /></div>
          </div>
          {fields.due_date && <p className="field-error">{fields.due_date}</p>}
          <label htmlFor="task-assignee">Assign to</label>
          <select id="task-assignee" name="assigned_to" defaultValue={task.assigned_to || ''} aria-invalid={Boolean(fields.assigned_to)}><option value="">Unassigned</option>{users.map(user => <option key={user.id} value={user.id}>{user.name} (#{user.id})</option>)}</select>
          {fields.assigned_to && <p className="field-error">{fields.assigned_to}</p>}
        </fieldset>
        <div className="dialog-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : task.id ? 'Save changes' : 'Create task'}</button></div>
      </form>
    </Dialog>
  );
}
