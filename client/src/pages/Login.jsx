import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import AuthLayout from '../components/AuthLayout.jsx';

export default function Login({ registered }) {
  const { login, error: sessionError } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await login({ email: form.get('email'), password: form.get('password') });
      window.location.hash = '/dashboard';
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return (
    <AuthLayout>
      <p className="eyebrow">YOUR WORKSPACE AWAITS</p>
      <h2>Welcome back.</h2>
      <p className="subtitle">Sign in and pick up where you left off.</p>
      {registered && <p className="notice success" role="status">Account created. Sign in to get started.</p>}
      {(error || sessionError) && <p className="notice error" role="alert">{error || sessionError}</p>}
      <form onSubmit={submit}>
        <label htmlFor="email">Email address</label>
        <input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" maxLength={255} required disabled={busy} />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required disabled={busy} />
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<span aria-hidden="true">→</span></button>
      </form>
      <p className="switch-form">New to TaskSync? <a href="#/register">Create an account</a></p>
    </AuthLayout>
  );
}
