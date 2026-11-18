const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat('en-IN');

export const inr = (n: number | null | undefined) => inrFmt.format(Number(n) || 0);
export const int = (n: number | null | undefined) => numFmt.format(Number(n) || 0);
export const pct = (n: number | null | undefined) => `${(Number(n) || 0).toFixed(1)}%`;

/** Plain ascii currency representation for PDF / text exports where rupee glyph might be unsupported. */
export const inrRs = (n: number | null | undefined) => `Rs. ${numFmt.format(Math.round(Number(n) || 0))}`;

/** Short format for chart axes (e.g. ₹12.5L, ₹1.2Cr). */
export function inrShort(n: number | null | undefined): string {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)}L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}k`;
  return `${sign}₹${abs}`;
}

export function formatDateRangeWords(from?: string, to?: string): string {
  if (!from && !to) return 'All dates';
  const f = from ? fmtDate(from.includes('T') ? from : `${from}T00:00:00+05:30`) : 'Start';
  const t = to ? fmtDate(to.includes('T') ? to : `${to}T23:59:59+05:30`) : 'Now';
  return `${f} – ${t}`;
}

export function formatIstTimeOnly(dateInput: Date | number | string = Date.now()): string {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${time} IST`;
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
}

/** 9876543210 -> 98•••••210 ; short values are fully masked. */
export function maskPhone(p: string | null | undefined, ch = '•'): string {
  const s = String(p ?? '').replace(/\s+/g, '');
  if (!s) return '—';
  if (s.length <= 5) return ch.repeat(s.length);
  return `${s.slice(0, 2)}${ch.repeat(s.length - 5)}${s.slice(-3)}`;
}

export const dash = (v: any) => (v === null || v === undefined || v === '' ? '—' : String(v));

/** Escape characters that have special meaning inside a PostgREST ilike pattern value. */
export const likeEscape = (s: string) => s.trim().replace(/[%_,()]/g, ' ');
