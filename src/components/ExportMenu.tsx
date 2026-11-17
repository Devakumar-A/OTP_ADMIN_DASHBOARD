import { useState } from 'react';
import { Menu } from './ui';
import { exportRows, Row } from '../lib/export';

/** Exports exactly what the screen is filtered to. Rows are produced by getRows() with the same filters and masking. */
export function ExportMenu({ name, title, getRows, disabled }: { name: string; title?: string; getRows: () => Promise<Row[]> | Row[]; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fmt: 'csv' | 'xlsx' | 'pdf') => {
    setBusy(true);
    setErr(null);
    try {
      const rows = await getRows();
      if (!rows.length) throw new Error('Nothing to export for the current filters.');
      await exportRows(fmt, name, rows, title);
    } catch (e: any) {
      setErr(e?.message ?? 'Export failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="fact">
      <Menu
        label={busy ? 'Exporting…' : 'Export'}
        disabled={disabled || busy}
        items={[
          { label: 'CSV', onClick: () => run('csv') },
          { label: 'Excel (.xlsx)', onClick: () => run('xlsx') },
          { label: 'PDF', onClick: () => run('pdf') },
        ]}
      />
      {err ? <span className="muted" style={{ color: 'var(--bad)' }}>{err}</span> : null}
    </span>
  );
}
