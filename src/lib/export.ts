export type Row = Record<string, string | number | null>;

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (v: any) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: Row[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  return [cols.map(csvCell).join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n');
}

export async function exportRows(format: 'csv' | 'xlsx' | 'pdf', name: string, rows: Row[], title?: string) {
  const stamp = new Date().toISOString().slice(0, 10);
  const file = `${name}-${stamp}`;
  if (format === 'csv') {
    download(new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }), `${file}.csv`);
  } else if (format === 'xlsx') {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31) || 'Report');
    XLSX.writeFile(wb, `${file}.xlsx`);
  } else {
    const { default: jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    doc.setFontSize(13);
    doc.text(title ?? name, 28, 30);
    doc.setFontSize(8);
    doc.text(`Generated ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`, 28, 44);
    const cols = rows.length ? Object.keys(rows[0]) : [];
    autoTable(doc, {
      startY: 54,
      head: [cols],
      body: rows.map((r) => cols.map((c) => (r[c] === null || r[c] === undefined ? '' : String(r[c])))),
      styles: { fontSize: 7, cellPadding: 3 },
      headStyles: { fillColor: [79, 70, 229] },
    });
    doc.save(`${file}.pdf`);
  }
}
