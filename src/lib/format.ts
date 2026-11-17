const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat('en-IN');

export const inr = (n: number | null | undefined) => inrFmt.format(Number(n) || 0);
export const int = (n: number | null | undefined) => numFmt.format(Number(n) || 0);
export const pct = (n: number | null | undefined) => `${(Number(n) || 0).toFixed(1)}%`;

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
