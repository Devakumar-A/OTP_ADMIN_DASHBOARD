// All dates in this app are Asia/Kolkata (UTC+05:30, no daylight saving).
const OFFSET_MS = 330 * 60 * 1000;

export type Preset =
  | 'last24h'
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'prevMonth'
  | 'custom'
  | 'all';

export const PRESET_LABELS: Record<Preset, string> = {
  last24h: 'Last 24 hours',
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Last 7 days',
  last30: 'Last 30 days',
  thisMonth: 'This month',
  prevMonth: 'Previous month',
  custom: 'Custom',
  all: 'All time',
};

/** yyyy-mm-dd for the given instant, as seen in IST. */
export function istDate(d: Date | string | number): string {
  const t = new Date(d).getTime();
  return new Date(t + OFFSET_MS).toISOString().slice(0, 10);
}

export function istToday(now: number = Date.now()): string {
  return istDate(now);
}

export function istMonth(d: Date | string | number): string {
  return istDate(d).slice(0, 7);
}

/** Format instant as yyyy-mm-ddTHH:mm in IST (minute precision for datetime-local). */
export function formatIstDateTime(d: Date | string | number): string {
  const t = new Date(d).getTime();
  return new Date(t + OFFSET_MS).toISOString().slice(0, 16);
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Convert IST date or datetime string (with +05:30) to UTC ISO string. */
export function istToUtcIso(dt: string): string {
  if (!dt) return '';
  const clean = dt.trim();
  const withTime = clean.includes('T') ? clean : `${clean}T00:00:00`;
  const withSec = withTime.length === 16 ? `${withTime}:00` : withTime;
  return new Date(`${withSec}+05:30`).toISOString();
}

/** UTC ISO instant for IST midnight at the start of the given yyyy-mm-dd. */
export function istStartIso(ymd: string): string {
  return istToUtcIso(ymd.slice(0, 10));
}

export function presetRange(p: Preset, now: number = Date.now()): { from: string; to: string } {
  const today = istToday(now);
  switch (p) {
    case 'last24h': {
      const from = formatIstDateTime(now - 24 * 60 * 60 * 1000);
      const to = formatIstDateTime(now);
      return { from, to };
    }
    case 'today': {
      return {
        from: `${today}T00:00`,
        to: `${addDays(today, 1)}T00:00`,
      };
    }
    case 'yesterday': {
      const y = addDays(today, -1);
      return {
        from: `${y}T00:00`,
        to: `${today}T00:00`,
      };
    }
    case 'last7': {
      return {
        from: `${addDays(today, -6)}T00:00`,
        to: `${addDays(today, 1)}T00:00`,
      };
    }
    case 'last30': {
      return {
        from: `${addDays(today, -29)}T00:00`,
        to: `${addDays(today, 1)}T00:00`,
      };
    }
    case 'thisMonth': {
      return {
        from: `${today.slice(0, 7)}-01T00:00`,
        to: `${addDays(today, 1)}T00:00`,
      };
    }
    case 'prevMonth': {
      const first = `${today.slice(0, 7)}-01`;
      const lastPrev = addDays(first, -1);
      const firstPrev = `${lastPrev.slice(0, 7)}-01`;
      return {
        from: `${firstPrev}T00:00`,
        to: `${first}T00:00`,
      };
    }
    default:
      return { from: '', to: '' };
  }
}

/**
 * Inclusive `from` -> startIso in UTC (>=).
 * Exclusive `to` -> endIso in UTC (<).
 * If `to` was provided as a pure date (YYYY-MM-DD), advance it to the next day for exclusive bound.
 */
export function dateBounds(from: string, to: string): { start?: string; end?: string } {
  let start: string | undefined;
  let end: string | undefined;

  if (from) {
    start = istToUtcIso(from);
  }
  if (to) {
    // If it has no 'T', it's a legacy date-only string: add a day to make it exclusive end bound
    if (!to.includes('T')) {
      end = istToUtcIso(addDays(to, 1));
    } else {
      end = istToUtcIso(to);
    }
  }

  return { start, end };
}
