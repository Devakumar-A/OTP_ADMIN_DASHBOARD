const e = (import.meta as any).env ?? {};

export const env = {
  url: String(e.VITE_SUPABASE_URL ?? ''),
  anon: String(e.VITE_SUPABASE_ANON_KEY ?? ''),
  adminEmails: String(e.VITE_ADMIN_EMAILS ?? '')
    .split(',')
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean),
  expectedHotels: Number(e.VITE_EXPECTED_HOTELS ?? 15) || 15,
  extIncluded: String(e.VITE_EXTENSIONS_INCLUDED_IN_TOTAL ?? 'false').toLowerCase() === 'true',
};

export const configured =
  env.url.startsWith('http') && !env.url.includes('YOUR-PROJECT') && env.anon.length > 20 && !env.anon.includes('YOUR-ANON');

/**
 * Status vocabularies. Values are matched case-insensitively and exactly.
 * Anything not listed is shown with its raw database value and a neutral badge,
 * so unknown statuses are never hidden or mislabeled.
 * After running Phase 1 query 7, add any real values you have here.
 */
export const STATUS = {
  otp: {
    verified: ['verified', 'success', 'successful', 'approved', 'completed'],
    failed: ['failed', 'failure', 'rejected', 'blocked', 'locked', 'max_attempts'],
    expired: ['expired', 'timeout', 'timed_out'],
    pending: ['pending', 'sent', 'created', 'otp_sent', 'awaiting'],
  },
  stay: {
    checkedOut: ['checked_out', 'checked-out', 'checkedout', 'checked out', 'completed', 'closed', 'checkout'],
    cancelled: ['cancelled', 'canceled', 'no_show', 'no-show', 'void'],
    active: ['active', 'checked_in', 'checked-in', 'checked in', 'in_house', 'in-house', 'open', 'staying', 'extended'],
  },
};

export const PAGE_SIZE = 25;
export const IST_OFFSET_MIN = 330; // Asia/Kolkata, no DST
