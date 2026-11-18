import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../state/auth';
import { useFilters } from '../state/filters';
import { useLookups } from '../hooks/data';
import { env } from '../config';
import { Notice } from './ui';

const NAV = [
  ['/', 'Overview'],
  ['/stays', 'Guest stays'],
  ['/revenue', 'Revenue'],
  ['/reports', 'Reports'],
] as const;

type Theme = 'system' | 'light' | 'dark';

export function Layout() {
  const { session, signOut } = useAuth();
  const { applied, setHotel } = useFilters();
  const lk = useLookups();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('theme') as Theme) || 'system';
    } catch {
      return 'system';
    }
  });

  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  // With a single accessible hotel there is no "All hotels" option: select it.
  useEffect(() => {
    if (lk.hotels.length === 1 && applied.hotelId !== lk.hotels[0].id) setHotel(lk.hotels[0].id);
  }, [lk.hotels, applied.hotelId, setHotel]);

  const n = lk.hotels.length;
  const nextTheme: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };

  return (
    <div className="shell">
      <aside className={`side ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="logo">★</span> Starlight Admin
        </div>
        <nav className="nav">
          {NAV.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              <span className="dot" /> {label}
            </NavLink>
          ))}
        </nav>
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }} className="muted">
          <div
            style={{
              padding: '6px 10px',
              fontSize: 11.5,
              background: 'var(--panel2)',
              borderRadius: 6,
              color: 'var(--brand)',
              fontWeight: 500,
            }}
          >
            📅 Showing data from 18 Oct 2026 onwards
          </div>
          <div style={{ padding: '0 10px', fontSize: 11.5 }}>Read-only operations</div>
        </div>
      </aside>

      <div className="main">
        <header className="top">
          <div className="top-left">
            <button
              className="btn menu-btn"
              onClick={() => setOpen((o) => !o)}
              aria-label="Menu"
            >
              ☰
            </button>
            <label className="top-hotel-picker">
              <span className="top-label">Hotel:</span>
              <select
                value={applied.hotelId}
                onChange={(e) => setHotel(e.target.value)}
                disabled={lk.loading || n === 0}
              >
                {n > 1 ? (
                  <option value="">
                    {n >= env.expectedHotels ? 'All hotels' : `All accessible hotels (${n})`}
                  </option>
                ) : null}
                {lk.hotels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.hotel_name}
                    {h.hotel_code ? ` (${h.hotel_code})` : ''}
                  </option>
                ))}
              </select>
            </label>

            <span
              className="badge info"
              style={{ fontSize: 11, whiteSpace: 'nowrap' }}
              title="Data prior to 18 Oct 2026 is excluded"
            >
              From 18 Oct 2026 onwards
            </span>
          </div>

          <div className="top-right">
            <button className="btn sm" onClick={() => setTheme(nextTheme[theme])} title="Switch theme">
              Theme: {theme}
            </button>
            <span className="user-email-chip" title={session?.user.email}>
              <span className="user-dot" />
              <span className="user-email-text">{session?.user.email}</span>
            </span>
            <button className="btn sm" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>

        <main className="content">
          {!lk.loading && n === 0 ? (
            <Notice tone="bad">
              <strong>No hotels are visible to this account.</strong> Row Level Security is not
              granting this user read access to the hotels table. The dashboard will not bypass RLS.
            </Notice>
          ) : null}
          {!lk.loading && n > 0 && n < env.expectedHotels ? (
            <Notice tone="warn">
              <strong>Limited scope:</strong> this account can see {n} of the {env.expectedHotels}{' '}
              expected hotels. All figures cover only those hotels.
            </Notice>
          ) : null}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
