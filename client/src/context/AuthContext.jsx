import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api/api.js';

const AuthContext = createContext(null);
const tokenKey = 'tasksync.token';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenKey));
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  function logout(message = '') {
    sessionStorage.removeItem(tokenKey);
    setToken(null);
    setUser(null);
    setLoading(false);
    setError(message);
  }

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api('/auth/me', { token, signal: controller.signal })
      .then(data => setUser(data.user))
      .catch(error => {
        if (error.name === 'AbortError') return;
        if (error.status === 401) logout('Your session has ended. Please sign in again.');
        else setError(error.message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, attempt]);

  useEffect(() => {
    if (!token) return;
    // This only schedules the UI timeout. The backend verifies the JWT.
    try {
      const { exp } = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      const timer = setTimeout(() => logout('Your session has expired. Please sign in again.'), Math.max(0, exp * 1000 - Date.now()));
      return () => clearTimeout(timer);
    } catch { logout('Please sign in again.'); }
  }, [token]);

  async function login(credentials) {
    const data = await api('/auth/login', { method: 'POST', body: credentials });
    sessionStorage.setItem(tokenKey, data.token);
    setUser(data.user);
    setError('');
    setLoading(true);
    setToken(data.token);
  }

  return <AuthContext.Provider value={{ user, token, loading, error, login, logout, retry: () => setAttempt(value => value + 1) }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
