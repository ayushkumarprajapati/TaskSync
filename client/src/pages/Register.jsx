import { useState } from 'react';
import { api } from '../api/api.js';
import AuthLayout from '../components/AuthLayout.jsx';

export default function Register() {
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setError('');
    setFields({});
    const form = new FormData(event.currentTarget);
    const password = form.get('password');
    if (new TextEncoder().encode(password).length > 72) {
      setFields({ password: 'Use at most 72 UTF-8 bytes. Emoji can use more than one byte.' });
      return;
    }
    setBusy(true);
    try {
      await api('/auth/register', { method: 'POST', body: { name: form.get('name'), email: form.get('email'), password } });
      window.location.hash = '/login?registered=1';
    } catch (error) { setError(error.message); setFields(error.fields || {}); }
    finally { setBusy(false); }
  }
  return (
    <AuthLayout>
      <p className="eyebrow">START SOMETHING TOGETHER</p>
      <h2>Make room for progress.</h2>
      <p className="subtitle">Create your account. Find your focus.</p>
      {error && <p className="notice error" role="alert">{error}</p>}
      <form onSubmit={submit}>
        <label htmlFor="name">Your name</label>
        <input id="name" name="name" autoComplete="name" placeholder="Your full name" maxLength={100} required disabled={busy} aria-invalid={Boolean(fields.name)} aria-describedby={fields.name ? 'name-error' : undefined} />
        {fields.name && <p className="field-error" id="name-error" role="alert">{fields.name}</p>}
        <label htmlFor="email">Email address</label>
        <input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" maxLength={255} required disabled={busy} aria-invalid={Boolean(fields.email)} aria-describedby={fields.email ? 'email-error' : undefined} />
        {fields.email && <p className="field-error" id="email-error" role="alert">{fields.email}</p>}
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" placeholder="Create a password" minLength={8} required disabled={busy} aria-invalid={Boolean(fields.password)} aria-describedby="password-help password-error" />
        <p className="input-hint" id="password-help">At least 8 characters, up to 72 UTF-8 bytes.</p>
        <p className="field-error" id="password-error" role={fields.password ? 'alert' : undefined}>{fields.password}</p>
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}<span aria-hidden="true">→</span></button>
      </form>
      <p className="switch-form">Already have an account? <a href="#/login">Sign in</a></p>
    </AuthLayout>
  );
}
