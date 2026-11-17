import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './state/auth';
import { configured } from './config';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { Hotels } from './pages/Hotels';
import { Stays } from './pages/Stays';
import { Verification } from './pages/Verification';
import { Revenue } from './pages/Revenue';
import { Extensions } from './pages/Extensions';
import { Receptionists } from './pages/Receptionists';
import { Reviews } from './pages/Reviews';
import { Reports } from './pages/Reports';
import { Diagnostics } from './pages/Diagnostics';

export function App() {
  const { session, loading, denied, signOut } = useAuth();

  if (!configured) {
    return (
      <div className="login">
        <div className="card" style={{ padding: 24, maxWidth: 520 }}>
          <h1>Supabase is not configured</h1>
          <p className="muted">
            Open the <code>.env</code> file in the project root and set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to your existing project values (anon key only),
            then restart the dev server.
          </p>
        </div>
      </div>
    );
  }
  if (loading) return <Loading />;
  if (!session) return <Login />;
  if (denied) {
    return (
      <div className="login">
        <div className="card" style={{ padding: 24, maxWidth: 480 }}>
          <h1>Access denied</h1>
          <p className="muted">{denied}</p>
          <button className="btn" onClick={signOut}>Sign out</button>
        </div>
      </div>
    );
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="hotels" element={<Hotels />} />
        <Route path="stays" element={<Stays />} />
        <Route path="verification" element={<Verification />} />
        <Route path="revenue" element={<Revenue />} />
        <Route path="extensions" element={<Extensions />} />
        <Route path="receptionists" element={<Receptionists />} />
        <Route path="reviews" element={<Reviews />} />
        <Route path="reports" element={<Reports />} />
        <Route path="diagnostics" element={<Diagnostics />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
