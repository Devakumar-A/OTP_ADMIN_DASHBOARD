import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './state/auth';
import { configured } from './config';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { Stays } from './pages/Stays';
import { GrcPrint } from './pages/GrcPrint';
import { Revenue } from './pages/Revenue';
import { Reports } from './pages/Reports';

export function App() {
  const { session, loading, denied, signOut } = useAuth();

  if (!configured) {
    return (
      <div className="login">
        <div className="card" style={{ padding: 24, maxWidth: 520 }}>
          <h1>Supabase is not configured</h1>
          <p className="muted">
            Open the <code>.env</code> file in the project root and set <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> to your existing project values (anon key only), then restart the dev server.
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
      {/* Standalone print route without app chrome */}
      <Route path="stays/print" element={<GrcPrint />} />
      <Route path="stays/print/:id" element={<GrcPrint />} />

      {/* Main app layout */}
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="stays" element={<Stays />} />
        <Route path="revenue" element={<Revenue />} />
        <Route path="reports" element={<Reports />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
