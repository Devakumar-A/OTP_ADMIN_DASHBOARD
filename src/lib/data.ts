import { supabase } from './supabase';
import type { StayFact, ExtFact } from './finance';
import { Filters, applyStayFilters, applyExtFilters, applyVerifFilters, applyFollowFilters } from './filters';

export const PAGE = 1000; // PostgREST default max rows per request
const MAX_ROWS = 60000;

export interface Fetched<T> {
  rows: T[];
  total: number;
  truncated: boolean;
}

/**
 * Reads every matching row in 1,000-row pages (first page tells us the total, the rest run 4 at a time).
 * `make` must return a fresh SELECT builder with explicit columns, filters and a stable order.
 * This is only used for aggregates over a few narrow columns, never for guest list screens.
 */
export async function fetchAll<T = any>(make: () => any, max = MAX_ROWS): Promise<Fetched<T>> {
  const first = await make().range(0, PAGE - 1);
  if (first.error) throw first.error;
  const total: number = first.count ?? first.data.length;
  const rows: T[] = [...first.data];
  const starts: number[] = [];
  for (let s = PAGE; s < Math.min(total, max); s += PAGE) starts.push(s);
  for (let i = 0; i < starts.length; i += 4) {
    const batch = await Promise.all(starts.slice(i, i + 4).map((s) => make().range(s, s + PAGE - 1)));
    for (const r of batch) {
      if (r.error) throw r.error;
      rows.push(...r.data);
    }
  }
  return { rows, total, truncated: total > max };
}

export const STAY_FACT_COLS =
  'id,hotel_id,receptionist_id,check_in_time,checked_out_at,current_check_out_time,stay_status,payment_status,payment_mode,number_of_guests,number_of_rooms,amount,total_amount,amount_paid,balance_amount,cash_amount,gpay_amount,card_amount,online_amount,guest_name,guest_phone,booking_id,room_number';
export const EXT_FACT_COLS =
  'id,guest_stay_id,hotel_id,receptionist_id,created_at,extension_nights,extension_amount,amount_paid,balance_amount,payment_mode,payment_status';
export const VERIF_FACT_COLS = 'id,hotel_id,receptionist_id,otp_status,review_status,created_at';
export const FOLLOW_FACT_COLS = 'id,hotel_id,review_status,created_at';

export const fetchStayFacts = (f: Filters, skipDate = false) =>
  fetchAll<StayFact>(() => applyStayFilters(supabase.from('guest_stays').select(STAY_FACT_COLS, { count: 'exact' }), f, { skipDate }).order('id'));

export const fetchExtFacts = (f: Filters, skipDate = false) =>
  fetchAll<ExtFact>(() => applyExtFilters(supabase.from('stay_extensions').select(EXT_FACT_COLS, { count: 'exact' }), f, { skipDate }).order('id'));

export const fetchVerifFacts = (f: Filters, skipDate = false) =>
  fetchAll<any>(() => applyVerifFilters(supabase.from('guest_verifications').select(VERIF_FACT_COLS, { count: 'exact' }), f, { skipDate }).order('id'));

export const fetchFollowFacts = (f: Filters, skipDate = false) =>
  fetchAll<any>(() => applyFollowFilters(supabase.from('review_followups').select(FOLLOW_FACT_COLS, { count: 'exact' }), f, { skipDate }).order('id'));

/** Distinct values of one column (for filter dropdowns). Reads one narrow column only. */
export async function fetchDistinct(table: string, column: string): Promise<string[]> {
  const { rows } = await fetchAll<any>(() => supabase.from(table).select(column, { count: 'exact' }).order('id'));
  const set = new Set<string>();
  for (const r of rows) {
    const v = r[column];
    if (v !== null && v !== undefined && String(v).trim() !== '') set.add(String(v));
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Head-only counts: no rows are transferred. */
export async function countRows(table: string, build: (q: any) => any): Promise<number> {
  const { count, error } = await build(supabase.from(table).select('id', { count: 'exact', head: true }));
  if (error) throw error;
  return count ?? 0;
}
