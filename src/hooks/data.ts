import { useMemo, useState, useEffect } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Filters, applyStayFilters } from '../lib/filters';
import {
  fetchStayFacts, fetchExtFacts, fetchVerifFacts, fetchFollowFacts, fetchDistinct, countRows, fetchAll,
} from '../lib/data';
import { dateBounds, istToday } from '../lib/ist';
import { classifyStay } from '../lib/classify';
import { PAGE_SIZE } from '../config';

const FIVE_MIN = 5 * 60 * 1000;

export interface Hotel { id: string; hotel_name: string; hotel_code: string | null; status: any }
export interface Recep { id: string; name: string | null; email: string | null; hotel_id: string | null; status: any }

export function useHotels() {
  return useQuery({
    queryKey: ['hotels'],
    staleTime: FIVE_MIN,
    queryFn: async () => {
      const { data, error } = await supabase.from('hotels').select('id,hotel_name,hotel_code,status').order('hotel_name');
      if (error) throw error;
      return data as Hotel[];
    },
  });
}

export function useReceptionists() {
  return useQuery({
    queryKey: ['receptionists'],
    staleTime: FIVE_MIN,
    queryFn: async () => {
      const { data, error } = await supabase.from('receptionists').select('id,name,email,hotel_id,status').order('name');
      if (error) throw error;
      return data as Recep[];
    },
  });
}

/** id -> display name lookups built once from the two small reference tables. */
export function useLookups() {
  const hotels = useHotels();
  const recs = useReceptionists();
  return useMemo(() => {
    const h = new Map<string, Hotel>((hotels.data ?? []).map((x) => [x.id, x]));
    const r = new Map<string, Recep>((recs.data ?? []).map((x) => [x.id, x]));
    return {
      hotels: hotels.data ?? [],
      receptionists: recs.data ?? [],
      hotelName: (id: any) => (id ? h.get(id)?.hotel_name ?? 'Unknown hotel' : '—'),
      recName: (id: any) => (id ? r.get(id)?.name ?? 'Unknown' : '—'),
      loading: hotels.isLoading || recs.isLoading,
      error: hotels.error || recs.error,
    };
  }, [hotels.data, recs.data, hotels.isLoading, recs.isLoading, hotels.error, recs.error]);
}

export const useStayFacts = (f: Filters, skipDate = false) =>
  useQuery({ queryKey: ['stayFacts', f, skipDate], staleTime: FIVE_MIN, queryFn: () => fetchStayFacts(f, skipDate) });
export const useExtFacts = (f: Filters, skipDate = false) =>
  useQuery({ queryKey: ['extFacts', f, skipDate], staleTime: FIVE_MIN, queryFn: () => fetchExtFacts(f, skipDate) });
export const useVerifFacts = (f: Filters, skipDate = false) =>
  useQuery({ queryKey: ['verifFacts', f, skipDate], staleTime: FIVE_MIN, queryFn: () => fetchVerifFacts(f, skipDate) });
export const useFollowFacts = (f: Filters, skipDate = false) =>
  useQuery({ queryKey: ['followFacts', f, skipDate], staleTime: FIVE_MIN, queryFn: () => fetchFollowFacts(f, skipDate) });

/** Distinct values for filter dropdowns, cached for 30 minutes. */
export const useDistinct = (table: string, column: string, enabled = true) =>
  useQuery({ queryKey: ['distinct', table, column], staleTime: 30 * 60 * 1000, enabled, queryFn: () => fetchDistinct(table, column) });

/** Today's check-ins and check-outs as head-only COUNT queries (IST day). */
export function useTodayCounts(hotelId: string) {
  return useQuery({
    queryKey: ['todayCounts', hotelId, istToday()],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const t = istToday();
      const { start, end } = dateBounds(t, t);
      const hotel = (q: any) => (hotelId ? q.eq('hotel_id', hotelId) : q);
      const [ins, expectedOuts, actualOuts] = await Promise.all([
        countRows('guest_stays', (q) => hotel(q).gte('check_in_time', start!).lt('check_in_time', end!)),
        countRows('guest_stays', (q) => hotel(q).gte('current_check_out_time', start!).lt('current_check_out_time', end!)),
        countRows('guest_stays', (q) => hotel(q).gte('checked_out_at', start!).lt('checked_out_at', end!)),
      ]);
      return { ins, expectedOuts, actualOuts, outs: actualOuts };
    },
  });
}

/**
 * In-house now:
 * stay_status maps to "active" AND checked_out_at IS NULL AND current_check_out_time >= now.
 * Unknown statuses must NOT default to active: counted separately.
 * Rooms occupied now = SUM(number_of_rooms) of in-house stays only.
 */
export function useActiveStays(hotelId: string) {
  return useQuery({
    queryKey: ['activeStays', hotelId],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { rows, truncated } = await fetchAll<any>(() => {
        let q = supabase
          .from('guest_stays')
          .select('id,hotel_id,stay_status,number_of_rooms,number_of_guests,checked_out_at,current_check_out_time', { count: 'exact' })
          .is('checked_out_at', null);
        if (hotelId) q = q.eq('hotel_id', hotelId);
        return q.order('id');
      });

      const now = Date.now();
      const inHouse: any[] = [];
      const unknownStatusStays: any[] = [];
      const overdueActive: any[] = [];

      for (const r of rows) {
        const cls = classifyStay(r.stay_status, r.checked_out_at);
        if (cls === 'unknown') {
          unknownStatusStays.push(r);
        } else if (cls === 'active') {
          const expTime = r.current_check_out_time ? new Date(r.current_check_out_time).getTime() : null;
          if (expTime === null || expTime >= now) {
            inHouse.push(r);
          } else {
            overdueActive.push(r);
          }
        }
      }

      const roomsOccupied = inHouse.reduce((sum, s) => sum + (Number(s.number_of_rooms) || 1), 0);

      return {
        rows,
        active: inHouse, // for backward-compatibility with any components expecting .active
        inHouse,
        unknownStatusStays,
        overdueActive,
        roomsOccupied,
        truncated,
      };
    },
  });
}

/** Generic server-side paginated query. Page resets whenever the key changes. */
export function usePaged<T>(key: any[], build: (from: number, to: number) => any, pageSize = PAGE_SIZE) {
  const sig = JSON.stringify(key);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [sig]);
  const q = useQuery({
    queryKey: [...key, page, pageSize],
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, count, error } = await build(page * pageSize, page * pageSize + pageSize - 1);
      if (error) throw error;
      return { rows: (data ?? []) as T[], total: count ?? 0 };
    },
  });
  return {
    rows: q.data?.rows ?? [],
    total: q.data?.total ?? 0,
    page,
    setPage,
    pageSize,
    loading: q.isLoading,
    fetching: q.isFetching,
    error: q.error as Error | null,
  };
}

export { applyStayFilters };
