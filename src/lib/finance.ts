import { classifyPayment } from './classify';

export const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface StayFact {
  id: string;
  hotel_id: string | null;
  receptionist_id: string | null;
  check_in_time: string | null;
  checked_out_at: string | null;
  current_check_out_time?: string | null;
  stay_status: string | null;
  payment_status: string | null;
  payment_mode: string | null;
  number_of_guests: number | null;
  number_of_rooms: number | null;
  amount: number | null;
  total_amount: number | null;
  amount_paid: number | null;
  balance_amount: number | null;
  cash_amount: number | null;
  gpay_amount: number | null;
  card_amount: number | null;
  online_amount: number | null;
  guest_name?: string | null;
  guest_phone?: string | null;
  booking_id?: string | null;
  room_number?: string | null;
}

export interface ExtFact {
  id: string;
  guest_stay_id: string | null;
  hotel_id: string | null;
  receptionist_id: string | null;
  created_at: string | null;
  extension_nights: number | null;
  extension_amount: number | null;
  amount_paid: number | null;
  balance_amount: number | null;
  payment_mode: string | null;
  payment_status: string | null;
}

export const MODES = ['Cash', 'GPay', 'Card', 'Online', 'Other'] as const;
export type PayMode = (typeof MODES)[number];

export function normMode(m: any): PayMode {
  const s = String(m ?? '').toLowerCase();
  if (s.includes('cash')) return 'Cash';
  if (/gpay|google|upi|phonepe|paytm/.test(s)) return 'GPay';
  if (s.includes('card')) return 'Card';
  if (/online|bank|neft|imps|net|transfer|razorpay/.test(s)) return 'Online';
  return 'Other';
}

/**
 * Single source of truth for stay financial metrics:
 * Total revenue (booked) = total_amount (fallback to amount only if total_amount is NULL)
 * Collected = amount_paid
 * Outstanding = balance_amount
 */
export const stayBooked = (s: StayFact): number =>
  s.total_amount != null ? num(s.total_amount) : num(s.amount);

export const stayPaid = (s: StayFact): number => num(s.amount_paid);

export const stayBalance = (s: StayFact): number =>
  s.balance_amount != null ? num(s.balance_amount) : Math.max(0, stayBooked(s) - stayPaid(s));

export const stayClassPay = (s: StayFact) => classifyPayment(stayBooked(s), stayPaid(s), stayBalance(s));

/**
 * Payment-mode split for ONE stay (Step 2.5):
 * Use cash/gpay/card/online columns when any is > 0, otherwise amount_paid goes to payment_mode.
 * Never both, so payments are never double counted.
 */
export function stayModes(s: StayFact): Record<PayMode, number> {
  const out: Record<PayMode, number> = { Cash: 0, GPay: 0, Card: 0, Online: 0, Other: 0 };
  const hasSplit =
    num(s.cash_amount) > 0 ||
    num(s.gpay_amount) > 0 ||
    num(s.card_amount) > 0 ||
    num(s.online_amount) > 0;

  if (hasSplit) {
    out.Cash = num(s.cash_amount);
    out.GPay = num(s.gpay_amount);
    out.Card = num(s.card_amount);
    out.Online = num(s.online_amount);
    const splitTotal = out.Cash + out.GPay + out.Card + out.Online;
    const diff = stayPaid(s) - splitTotal;
    if (diff > 0.5) out.Other += diff;
  } else if (stayPaid(s) > 0) {
    out[normMode(s.payment_mode)] += stayPaid(s);
  }
  return out;
}

export interface Totals {
  stayBooked: number;
  extBooked: number; // Informational line: "Extensions included: N, ₹X"
  booked: number; // Headline revenue: SUM(guest_stays.total_amount)
  stayCollected: number;
  extCollected: number;
  collected: number; // Headline collected: SUM(guest_stays.amount_paid)
  stayOutstanding: number;
  extOutstanding: number;
  outstanding: number; // Headline outstanding: SUM(guest_stays.balance_amount)
  collectionPct: number; // Collected / Total revenue * 100
  paidStays: number;
  partialStays: number;
  unpaidStays: number;
  stays: number;
  extensions: number;
  extNights: number;
  modes: Record<PayMode, number>;
}

const emptyModes = (): Record<PayMode, number> => ({ Cash: 0, GPay: 0, Card: 0, Online: 0, Other: 0 });

/**
 * Compute revenue totals across stays and extensions.
 * Single source of truth (Step 2.3):
 * - Booked = SUM(guest_stays.total_amount) (fallback to amount)
 * - Collected = SUM(guest_stays.amount_paid)
 * - Outstanding = SUM(guest_stays.balance_amount)
 * - Collection % = Collected / Booked * 100
 * Extensions are NOT added on top of stays. They are tracked as an informational metric.
 */
export function computeTotals(stays: StayFact[], exts: ExtFact[] = [], _extIncludedLegacy?: boolean): Totals {
  const t: Totals = {
    stayBooked: 0,
    extBooked: 0,
    booked: 0,
    stayCollected: 0,
    extCollected: 0,
    collected: 0,
    stayOutstanding: 0,
    extOutstanding: 0,
    outstanding: 0,
    collectionPct: 0,
    paidStays: 0,
    partialStays: 0,
    unpaidStays: 0,
    stays: stays.length,
    extensions: exts.length,
    extNights: 0,
    modes: emptyModes(),
  };

  for (const s of stays) {
    t.stayBooked += stayBooked(s);
    t.stayCollected += stayPaid(s);
    t.stayOutstanding += stayBalance(s);

    const c = stayClassPay(s);
    if (c === 'paid') t.paidStays++;
    else if (c === 'partial') t.partialStays++;
    else t.unpaidStays++;

    const m = stayModes(s);
    for (const k of MODES) t.modes[k] += m[k];
  }

  for (const x of exts) {
    t.extBooked += num(x.extension_amount);
    t.extCollected += num(x.amount_paid);
    t.extOutstanding += num(x.balance_amount);
    t.extNights += num(x.extension_nights);
  }

  // Single source of truth: strictly stays
  t.booked = t.stayBooked;
  t.collected = t.stayCollected;
  t.outstanding = t.stayOutstanding;
  t.collectionPct = t.booked > 0 ? (t.collected / t.booked) * 100 : 0;

  return t;
}

export interface Bucket {
  key: string;
  booked: number;
  collected: number;
  outstanding: number;
  extBooked: number;
  extCollected: number;
  stays: number;
}

/**
 * Group stays (and extensions for informational totals) by key (e.g. hotel, day).
 * Revenue definition is identical: extensions are not added to booked/collected/outstanding.
 */
export function groupBy(
  stays: StayFact[],
  exts: ExtFact[] = [],
  _extIncludedLegacy?: boolean | ((s: StayFact) => string | null),
  stayKeyArg?: ((s: StayFact) => string | null) | ((x: ExtFact) => string | null),
  extKeyArg?: (x: ExtFact) => string | null,
): Bucket[] {
  // Support both legacy 5-argument signature and modern 4-argument signature
  let stayKey: (s: StayFact) => string | null;
  let extKey: ((x: ExtFact) => string | null) | undefined;

  if (typeof _extIncludedLegacy === 'function') {
    stayKey = _extIncludedLegacy;
    extKey = typeof stayKeyArg === 'function' ? (stayKeyArg as any) : undefined;
  } else {
    stayKey = typeof stayKeyArg === 'function' ? (stayKeyArg as any) : () => null;
    extKey = extKeyArg;
  }

  const map = new Map<string, Bucket>();
  const get = (k: string) => {
    let b = map.get(k);
    if (!b) map.set(k, (b = { key: k, booked: 0, collected: 0, outstanding: 0, extBooked: 0, extCollected: 0, stays: 0 }));
    return b;
  };

  for (const s of stays) {
    const k = stayKey(s);
    if (!k) continue;
    const b = get(k);
    b.stays++;
    b.booked += stayBooked(s);
    b.collected += stayPaid(s);
    b.outstanding += stayBalance(s);
  }

  if (extKey) {
    for (const x of exts) {
      const k = extKey(x);
      if (!k) continue;
      const b = get(k);
      b.extBooked += num(x.extension_amount);
      b.extCollected += num(x.amount_paid);
    }
  }

  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export interface Quality {
  stays: number;
  balanceMismatch: number;
  splitMismatch: number;
  noTotal: number;
  paidOverTotal: number;
}

export function dataQuality(stays: StayFact[]): Quality {
  const q: Quality = { stays: stays.length, balanceMismatch: 0, splitMismatch: 0, noTotal: 0, paidOverTotal: 0 };
  for (const s of stays) {
    if (s.total_amount == null) q.noTotal++;
    if (s.balance_amount != null && Math.abs(stayBooked(s) - stayPaid(s) - num(s.balance_amount)) > 1) {
      q.balanceMismatch++;
    }
    const split = num(s.cash_amount) + num(s.gpay_amount) + num(s.card_amount) + num(s.online_amount);
    if (split > 0 && Math.abs(split - stayPaid(s)) > 1) q.splitMismatch++;
    if (stayPaid(s) - stayBooked(s) > 1) q.paidOverTotal++;
  }
  return q;
}

export interface OutlierAnalysis {
  top10: StayFact[];
  tenXMedianRows: StayFact[];
  allFlagged: StayFact[];
  median: number;
  totalRevenueAll: number;
  totalRevenueWithoutOutliers: number;
  collectedAll: number;
  collectedWithoutOutliers: number;
}

/**
 * Step 2.4: Outlier analysis
 * Top 10 stays by total_amount, plus stays where total_amount > 10x median.
 * Calculates revenue with and without flagged rows.
 */
export function analyzeOutliers(stays: StayFact[]): OutlierAnalysis {
  if (stays.length === 0) {
    return {
      top10: [],
      tenXMedianRows: [],
      allFlagged: [],
      median: 0,
      totalRevenueAll: 0,
      totalRevenueWithoutOutliers: 0,
      collectedAll: 0,
      collectedWithoutOutliers: 0,
    };
  }

  const sortedDesc = [...stays].sort((a, b) => stayBooked(b) - stayBooked(a));
  const top10 = sortedDesc.slice(0, 10);

  const amountsAsc = [...stays].map(stayBooked).sort((a, b) => a - b);
  const mid = Math.floor(amountsAsc.length / 2);
  const median = amountsAsc.length % 2 === 0 ? (amountsAsc[mid - 1] + amountsAsc[mid]) / 2 : amountsAsc[mid];
  const threshold = median > 0 ? median * 10 : Infinity;

  const tenXMedianRows = stays.filter((s) => stayBooked(s) > threshold);

  const flaggedMap = new Map<string, StayFact>();
  top10.forEach((s) => flaggedMap.set(s.id, s));
  tenXMedianRows.forEach((s) => flaggedMap.set(s.id, s));
  const allFlagged = [...flaggedMap.values()].sort((a, b) => stayBooked(b) - stayBooked(a));

  let totalRevenueAll = 0;
  let totalRevenueWithoutOutliers = 0;
  let collectedAll = 0;
  let collectedWithoutOutliers = 0;

  for (const s of stays) {
    const b = stayBooked(s);
    const p = stayPaid(s);
    totalRevenueAll += b;
    collectedAll += p;
    if (!flaggedMap.has(s.id)) {
      totalRevenueWithoutOutliers += b;
      collectedWithoutOutliers += p;
    }
  }

  return {
    top10,
    tenXMedianRows,
    allFlagged,
    median,
    totalRevenueAll,
    totalRevenueWithoutOutliers,
    collectedAll,
    collectedWithoutOutliers,
  };
}
