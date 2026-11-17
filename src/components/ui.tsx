import { ReactNode, useState, useRef, useEffect } from 'react';
import type { Tone } from '../lib/classify';
import { int } from '../lib/format';

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className={`card kpi ${tone ?? ''}`}>
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      {sub ? <div className="s">{sub}</div> : null}
    </div>
  );
}

export const Badge = ({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) => <span className={`badge ${tone}`}>{children}</span>;

export function Card({ title, right, children, flush }: { title?: ReactNode; right?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="card">
      {title ? (
        <div className="card-h">
          <h2>{title}</h2>
          {right}
        </div>
      ) : null}
      <div className={flush ? '' : 'card-b'}>{children}</div>
    </section>
  );
}

export const PageHead = ({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) => (
  <div className="page-head">
    <div>
      <h1>{title}</h1>
      {sub ? <p>{sub}</p> : null}
    </div>
    {right}
  </div>
);

export const Loading = ({ rows = 4 }: { rows?: number }) => (
  <div className="loading" aria-busy="true">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="skeleton" style={{ margin: '10px auto', width: `${90 - i * 10}%` }} />
    ))}
  </div>
);

export const Empty = ({ text = 'No records match the current filters.' }: { text?: string }) => <div className="empty">{text}</div>;

export function ErrorBox({ error }: { error: any }) {
  const msg = error?.message ?? String(error);
  return (
    <div className="notice bad" role="alert">
      <strong>Could not load data.</strong> {msg}
      <div style={{ marginTop: 4, opacity: 0.85 }}>
        If this says permission denied or returns nothing, Row Level Security is limiting what this account may read. The dashboard never bypasses RLS.
      </div>
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'bad'; children: ReactNode }) {
  return <div className={`notice ${tone}`}>{children}</div>;
}

export interface Col<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'r';
}

export function DataTable<T>({
  cols, rows, loading, error, page, pageSize, total, onPage, rowKey, empty,
}: {
  cols: Col<T>[]; rows: T[]; loading?: boolean; error?: any; page?: number; pageSize?: number; total?: number;
  onPage?: (p: number) => void; rowKey: (r: T) => string; empty?: string;
}) {
  if (error) return <ErrorBox error={error} />;
  if (loading) return <Loading />;
  if (!rows.length) return <Empty text={empty} />;
  const paged = onPage && pageSize && total !== undefined && page !== undefined;
  const last = paged ? Math.max(0, Math.ceil(total! / pageSize!) - 1) : 0;
  return (
    <>
      <div className="tw">
        <table>
          <thead>
            <tr>{cols.map((c) => <th key={c.key} className={c.align}>{c.header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)}>{cols.map((c) => <td key={c.key} className={c.align}>{c.render(r)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {paged ? (
        <div className="pager">
          <span>
            {int(page! * pageSize! + 1)}–{int(Math.min(total!, page! * pageSize! + rows.length))} of {int(total!)}
          </span>
          <span className="fact">
            <button className="btn sm" disabled={page === 0} onClick={() => onPage!(0)}>«</button>
            <button className="btn sm" disabled={page === 0} onClick={() => onPage!(page! - 1)}>Prev</button>
            <span>Page {page! + 1} of {last + 1}</span>
            <button className="btn sm" disabled={page! >= last} onClick={() => onPage!(page! + 1)}>Next</button>
            <button className="btn sm" disabled={page! >= last} onClick={() => onPage!(last)}>»</button>
          </span>
        </div>
      ) : null}
    </>
  );
}

export function Menu({ label, items, disabled }: { label: string; items: { label: string; onClick: () => void }[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div className="menu" ref={ref}>
      <button className="btn" disabled={disabled} onClick={() => setOpen((o) => !o)}>{label} ▾</button>
      {open ? (
        <div className="menu-list">
          {items.map((i) => (
            <button key={i.label} onClick={() => { setOpen(false); i.onClick(); }}>{i.label}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
