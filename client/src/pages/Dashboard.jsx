import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/api.js';
import TaskForm from '../components/TaskForm.jsx';
import TaskCard from '../components/TaskCard.jsx';
import Dialog from '../components/Dialog.jsx';
import { statuses, priorities } from '../utils/tasks.js';
import useTaskUpdates from '../hooks/useTaskUpdates.js';

export default function Dashboard() {
  const { user, token, logout } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [summary, setSummary] = useState({ total: 0, todo: 0, in_progress: 0, done: 0 });
  const [filters, setFilters] = useState({ status: '', priority: '', assignedTo: '', search: '' });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [editor, setEditor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const connection = useTaskUpdates(token, setRefresh, logout);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    const options = { token, signal: controller.signal };
    Promise.all([api(`/tasks?${query}`, options), api('/tasks/summary', options), api('/users', options)])
      .then(([list, counts, people]) => { setTasks(list.tasks); setSummary(counts.summary); setUsers(people.users); })
      .catch(error => {
        if (error.name === 'AbortError') return;
        if (error.status === 401) logout('Your session has ended. Please sign in again.');
        else setError(error.message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, filters, refresh]);

  function changed(message) {
    setNotice(message);
    setRefresh(value => value + 1);
  }
  function handleError(error) {
    if (error.status === 401) logout('Your session has ended. Please sign in again.');
    else setError(error.message);
  }
  async function save(body) {
    try {
      await api(editor.id ? `/tasks/${editor.id}` : '/tasks', { method: editor.id ? 'PUT' : 'POST', body, token });
      changed(editor.id ? 'Task updated.' : 'Task created.');
      setEditor(null);
    } catch (error) {
      if (error.status === 401) logout('Your session has ended. Please sign in again.');
      throw error;
    }
  }
  async function updateStatus(task, status) {
    setBusy(true);
    setError('');
    try { await api(`/tasks/${task.id}/status`, { method: 'PATCH', body: { status }, token }); changed('Status updated.'); }
    catch (error) { handleError(error); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    setError('');
    try { await api(`/tasks/${deleting.id}`, { method: 'DELETE', token }); setDeleting(null); changed('Task deleted.'); }
    catch (error) { handleError(error); setDeleting(null); }
    finally { setBusy(false); }
  }
  return (
    <div className="dashboard">
      <header className="workspace-header"><a className="brand" href="#/dashboard"><span className="brand-icon" aria-hidden="true">✓</span>TaskSync.</a><div className="account-menu"><span className="account-name">{user.name}</span><button className="secondary" onClick={() => logout()}>Sign out</button></div></header>
      <main className="workspace-content">
        <div className="workspace-title"><div><p className="eyebrow">YOUR WORKSPACE</p><h1>A clear view of what’s next.</h1><p className="subtitle">Welcome, {user.name}. Let’s move things forward.</p></div><button className="primary" onClick={() => { setNotice(''); setEditor({}); }} disabled={loading || Boolean(error) || busy}><span aria-hidden="true">＋</span> Create task</button></div>
        <div className="live-updates"><span className={`connection-state connection-${connection}`} role="status"><span aria-hidden="true">●</span> {connection === 'connected' ? 'Live updates connected' : connection === 'connecting' ? 'Connecting live updates…' : 'Live updates disconnected · reconnecting'}</span><button className="text-button" onClick={() => setRefresh(value => value + 1)} disabled={loading}>Refresh tasks</button></div>
        <section className="summary-grid" aria-label="Counts across the shared workspace">{[['total', 'All tasks'], ['todo', 'To do'], ['in_progress', 'In progress'], ['done', 'Done']].map(([key, label]) => <div className={`summary-card summary-${key}`} key={key}><span>{label}</span><strong>{loading || error ? '—' : summary[key]}</strong><span className="summary-caption">Across the shared workspace</span></div>)}</section>
        <section className="task-section" aria-labelledby="tasks-heading">
          <div className="list-heading"><h2 id="tasks-heading">Workspace tasks</h2><div className="view-switch" aria-label="Task view"><button className={!filters.assignedTo ? 'active' : ''} aria-pressed={!filters.assignedTo} onClick={() => setFilters(value => ({ ...value, assignedTo: '' }))}>All tasks</button><button className={filters.assignedTo === 'me' ? 'active' : ''} aria-pressed={filters.assignedTo === 'me'} onClick={() => setFilters(value => ({ ...value, assignedTo: 'me' }))}>Assigned to me</button></div></div>
          <div className="filter-bar">
            <form className="search-form" onSubmit={event => { event.preventDefault(); setFilters(value => ({ ...value, search: search.trim() })); }}><label className="sr-only" htmlFor="task-search">Search task titles</label><input id="task-search" placeholder="Search task titles…" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} /><button type="submit" className="secondary">Search</button></form>
            <label className="sr-only" htmlFor="filter-status">Filter by status</label><select id="filter-status" value={filters.status} onChange={event => setFilters(value => ({ ...value, status: event.target.value }))}><option value="">All statuses</option>{Object.entries(statuses).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
            <label className="sr-only" htmlFor="filter-priority">Filter by priority</label><select id="filter-priority" value={filters.priority} onChange={event => setFilters(value => ({ ...value, priority: event.target.value }))}><option value="">All priorities</option>{Object.entries(priorities).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
            <label className="sr-only" htmlFor="filter-assignee">Filter by assigned user</label><select id="filter-assignee" value={filters.assignedTo} onChange={event => setFilters(value => ({ ...value, assignedTo: event.target.value }))}><option value="">All assignees</option><option value="me">Assigned to me</option>{users.map(person => <option key={person.id} value={person.id}>{person.name} (#{person.id})</option>)}</select>
            {Object.values(filters).some(Boolean) && <button className="text-button" onClick={() => { setSearch(''); setFilters({ status: '', priority: '', assignedTo: '', search: '' }); }}>Clear filters</button>}
          </div>
          {notice && <p className="notice success" role="status">{notice}</p>}
          {error && <div className="notice error" role="alert">{error} <button className="text-button" onClick={() => setRefresh(value => value + 1)}>Try again</button></div>}
          {loading ? <p className="loading-state" role="status">Loading your tasks…</p> : !error && <><p className="result-count" aria-live="polite">{tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}{Object.values(filters).some(Boolean) ? ' matching your filters' : ' in your workspace'}</p>{tasks.length ? <div className="task-grid">{tasks.map(task => <TaskCard key={task.id} task={task} userId={user.id} busy={busy} onStatus={updateStatus} onEdit={setEditor} onDelete={setDeleting} />)}</div> : <div className="empty-state"><span className="empty-icon" aria-hidden="true">✓</span><h2>{Object.values(filters).some(Boolean) ? 'Nothing matches just yet.' : 'Make your first move.'}</h2><p>{Object.values(filters).some(Boolean) ? 'Try another filter, or clear them to see all your tasks.' : 'Create a task, add a little context, and give it a home. Every project starts somewhere.'}</p>{!Object.values(filters).some(Boolean) && <button className="primary" onClick={() => setEditor({})}>Create your first task</button>}</div>}</>}
        </section>
      </main>
      {editor && <TaskForm task={editor} users={users} onSave={save} onClose={() => setEditor(null)} />}
      {deleting && <Dialog title="Delete this task?" busy={busy} onClose={() => setDeleting(null)}><p className="delete-description">“{deleting.title}” will be permanently removed. This can’t be undone.</p><div className="dialog-actions"><button className="secondary" disabled={busy} onClick={() => setDeleting(null)}>Keep task</button><button className="primary danger-button" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Delete task'}</button></div></Dialog>}
    </div>
  );
}
