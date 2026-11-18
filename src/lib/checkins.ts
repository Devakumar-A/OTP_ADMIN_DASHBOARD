import { istDate } from './ist';
import { StayFact, num } from './finance';

/**
 * Single shared definition of a Check-In:
 * A check-in = exactly one guest_stays row (distinct id) whose check_in_time
 * falls on that IST calendar day.
 * Never counts extensions, verifications, or rooms as check-ins.
 * Rooms and Nights are separate metrics.
 */

export function getStayIstDate(checkInTime?: string | null): string | null {
  if (!checkInTime) return null;
  try {
    return istDate(checkInTime);
  } catch {
    return null;
  }
}

export function isCheckInOnIstDate(checkInTime: string | null | undefined, targetYmd: string): boolean {
  if (!checkInTime) return false;
  return getStayIstDate(checkInTime) === targetYmd;
}

/**
 * Count exact check-ins across stays:
 * Enforces distinct stay id and non-null check_in_time.
 */
export function countCheckIns(stays: { id: string; check_in_time?: string | null }[]): number {
  const ids = new Set<string>();
  for (const s of stays) {
    if (s.id && s.check_in_time) {
      ids.add(s.id);
    }
  }
  return ids.size;
}

/**
 * Sum of rooms for the given stays (default 1 room per stay if null/0).
 */
export function countRooms(stays: { number_of_rooms?: number | null }[]): number {
  return stays.reduce((sum, s) => sum + (num(s.number_of_rooms) > 0 ? num(s.number_of_rooms) : 1), 0);
}

/**
 * Sum of nights for the given stays (default 1 night per stay if null/0).
 */
export function countNights(stays: { number_of_nights?: number | null }[]): number {
  return stays.reduce((sum, s) => sum + (num(s.number_of_nights) > 0 ? num(s.number_of_nights) : 1), 0);
}

export interface CheckInAuditResult {
  totalStays: number;
  distinctIds: number;
  duplicateIds: string[];
  sharedGrcCount: number;
  sharedGrcList: { grc: string; stayIds: string[] }[];
  midnightCheckInsCount: number; // Check-ins between 00:00 and 05:00 IST
  midnightSamples: { id: string; checkInTime: string; istDate: string }[];
}

/**
 * Audit check-in dataset for duplicates, shared GRC numbers, and midnight check-in handling.
 */
export function auditCheckIns(stays: StayFact[]): CheckInAuditResult {
  const idCounts = new Map<string, number>();
  const grcMap = new Map<string, string[]>();
  let midnightCount = 0;
  const midnightSamples: { id: string; checkInTime: string; istDate: string }[] = [];

  for (const s of stays) {
    if (s.id) {
      idCounts.set(s.id, (idCounts.get(s.id) ?? 0) + 1);
    }

    const grcKey = s.grc_number || s.booking_id;
    if (grcKey && grcKey.trim()) {
      const trimmed = grcKey.trim();
      const list = grcMap.get(trimmed) ?? [];
      list.push(s.id);
      grcMap.set(trimmed, list);
    }

    if (s.check_in_time) {
      try {
        const d = new Date(s.check_in_time);
        // Calculate IST hour (UTC + 5.5 hours)
        const istHour = (d.getUTCHours() + 5 + (d.getUTCMinutes() + 30 >= 60 ? 1 : 0)) % 24;
        if (istHour >= 0 && istHour < 5) {
          midnightCount++;
          if (midnightSamples.length < 5) {
            midnightSamples.push({
              id: s.id,
              checkInTime: s.check_in_time,
              istDate: istDate(s.check_in_time),
            });
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  const duplicateIds: string[] = [];
  idCounts.forEach((count, id) => {
    if (count > 1) duplicateIds.push(id);
  });

  const sharedGrcList: { grc: string; stayIds: string[] }[] = [];
  grcMap.forEach((stayIds, grc) => {
    if (stayIds.length > 1) {
      sharedGrcList.push({ grc, stayIds });
    }
  });

  return {
    totalStays: stays.length,
    distinctIds: idCounts.size,
    duplicateIds,
    sharedGrcCount: sharedGrcList.length,
    sharedGrcList,
    midnightCheckInsCount: midnightCount,
    midnightSamples,
  };
}
