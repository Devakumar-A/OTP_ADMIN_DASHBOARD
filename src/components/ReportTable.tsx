import React, { useState, useMemo } from 'react';
import { ExportMenu } from './ExportMenu';
import { Row } from '../lib/export';

export interface ReportCol<T> {
  key: string;
  header: string;
  align?: 'r' | 'l';
  sortable?: boolean;
  render: (row: T) => React.ReactNode;
  getRaw?: (row: T) => string | number | null | undefined;
}

export function ReportTable<T>({
  title,
  subtitle,
  cols,
  rows,
  totalRow,
  rowKey,
  exportName,
  searchPlaceholder = 'Filter rows…',
  onRowClick,
  right,
}: {
  title?: string;
  subtitle?: string;
  cols: ReportCol<T>[];
  rows: T[];
  totalRow?: Record<string, React.ReactNode>;
  rowKey: (row: T) => string;
  exportName?: string;
  searchPlaceholder?: string;
  onRowClick?: (row: T) => void;
  right?: React.ReactNode;
}) {
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  const handleSort = (colKey: string) => {
    if (sortCol === colKey) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(colKey);
      setSortAsc(false); // default numeric/money to descending first
    }
  };

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase().trim();
    return rows.filter((r) => {
      for (const c of cols) {
        const val = c.getRaw ? c.getRaw(r) : (r as any)[c.key];
        if (val !== null && val !== undefined && String(val).toLowerCase().includes(q)) {
          return true;
        }
      }
      return false;
    });
  }, [rows, search, cols]);

  const sortedRows = useMemo(() => {
    if (!sortCol) return filteredRows;
    const colDef = cols.find((c) => c.key === sortCol);
    return [...filteredRows].sort((a, b) => {
      const va = colDef?.getRaw ? colDef.getRaw(a) : (a as any)[sortCol];
      const vb = colDef?.getRaw ? colDef.getRaw(b) : (b as any)[sortCol];

      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;

      if (typeof va === 'number' && typeof vb === 'number') {
        return sortAsc ? va - vb : vb - va;
      }
      const sa = String(va).toLowerCase();
      const sb = String(vb).toLowerCase();
      return sortAsc ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
  }, [filteredRows, sortCol, sortAsc, cols]);

  const getExportRows = (): Row[] => {
    return sortedRows.map((r) => {
      const rowObj: Row = {};
      cols.forEach((c) => {
        const raw = c.getRaw ? c.getRaw(r) : (r as any)[c.key];
        rowObj[c.header] = raw !== undefined ? raw : null;
      });
      return rowObj;
    });
  };

  return (
    <div className="report-table-card" style={{ marginBottom: 24 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          padding: '12px 16px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--panel)',
          borderRadius: '12px 12px 0 0',
        }}
      >
        <div>
          {title ? (
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>{title}</h3>
          ) : null}
          {subtitle ? (
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {subtitle}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <input
            type="text"
            className="input-sm"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: '6px 12px',
              fontSize: 12.5,
              borderRadius: 6,
              border: '1px solid var(--line)',
              background: 'var(--bg)',
              color: 'var(--text)',
              minWidth: 160,
            }}
          />
          {right}
          {exportName ? (
            <ExportMenu name={exportName} title={title ?? exportName} getRows={getExportRows} />
          ) : null}
        </div>
      </div>

      <div
        className="tw"
        style={{
          maxHeight: 460,
          overflowY: 'auto',
          borderRadius: totalRow ? 0 : '0 0 12px 12px',
          border: '1px solid var(--line)',
          borderTop: 'none',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead
            style={{
              position: 'sticky',
              top: 0,
              background: 'var(--panel2)',
              zIndex: 5,
              boxShadow: '0 1px 0 var(--border)',
            }}
          >
            <tr>
              {cols.map((c) => {
                const isSorted = sortCol === c.key;
                const isSortable = c.sortable !== false;
                return (
                  <th
                    key={c.key}
                    className={c.align === 'r' ? 'r' : ''}
                    onClick={() => isSortable && handleSort(c.key)}
                    style={{
                      padding: '8px 12px',
                      cursor: isSortable ? 'pointer' : 'default',
                      userSelect: 'none',
                      whiteSpace: 'nowrap',
                      textAlign: c.align === 'r' ? 'right' : 'left',
                      fontWeight: 600,
                    }}
                  >
                    <span>{c.header}</span>
                    {isSorted ? (
                      <span style={{ marginLeft: 4, fontSize: 10 }}>{sortAsc ? '▲' : '▼'}</span>
                    ) : isSortable ? (
                      <span style={{ marginLeft: 4, opacity: 0.25, fontSize: 9 }}>↕</span>
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={cols.length}
                  style={{ textAlign: 'center', padding: '24px', color: 'var(--muted)' }}
                >
                  {search ? 'No matching rows found.' : 'No data in period.'}
                </td>
              </tr>
            ) : (
              sortedRows.map((r) => (
                <tr
                  key={rowKey(r)}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  style={onRowClick ? { cursor: 'pointer' } : undefined}
                  className="hover-row"
                >
                  {cols.map((c) => (
                    <td
                      key={c.key}
                      className={c.align === 'r' ? 'r' : ''}
                      style={{
                        padding: '7px 12px',
                        textAlign: c.align === 'r' ? 'right' : 'left',
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {totalRow ? (
            <tfoot
              style={{
                position: 'sticky',
                bottom: 0,
                background: 'var(--panel2)',
                fontWeight: 'bold',
                boxShadow: '0 -1px 0 var(--line)',
                zIndex: 4,
              }}
            >
              <tr>
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className={c.align === 'r' ? 'r' : ''}
                    style={{
                      padding: '8px 12px',
                      textAlign: c.align === 'r' ? 'right' : 'left',
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {totalRow[c.key] ?? ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
