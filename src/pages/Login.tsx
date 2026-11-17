import { FormEvent, useState } from 'react';
import { useAuth } from '../state/auth';

export function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const m = await signIn(email.trim(), password);
    if (m) setErr(m);
    setBusy(false);
  };

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}><span className="logo">★</span> Starlight Hotels Admin</div>
        <div className="muted">Sign in with your administrator account. Access is read-only.</div>
        <label className="f">Email<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="f">Password<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {err ? <div className="notice bad" role="alert">{err}</div> : null}
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
