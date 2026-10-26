import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';

function Pages() {
  const [route, setRoute] = useState(window.location.hash);
  const { token, user, loading, error, retry, logout } = useAuth();
  useEffect(() => {
    const updateRoute = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', updateRoute);
    return () => window.removeEventListener('hashchange', updateRoute);
  }, []);
  useEffect(() => {
    if (loading) return;
    if (user && !error && route !== '#/dashboard') window.location.hash = '/dashboard';
    if (!token && route !== '#/register' && !route.startsWith('#/login')) window.location.hash = '/login';
  }, [user, token, loading, route, error]);
  if (loading) return <main className="connection-screen" role="status"><span className="brand-icon" aria-hidden="true">✓</span><h1>Opening your workspace…</h1></main>;
  if (token && error) return <main className="connection-screen"><h1>Let’s reconnect.</h1><p className="notice error" role="alert">{error}</p><div className="actions"><button className="primary" onClick={retry}>Try again</button><button className="secondary" onClick={() => logout()}>Back to sign in</button></div></main>;
  if (user) return <Dashboard />;
  if (route === '#/register') return <Register />;
  return <Login registered={route === '#/login?registered=1'} />;
}

export default function App() { return <AuthProvider><Pages /></AuthProvider>; }
