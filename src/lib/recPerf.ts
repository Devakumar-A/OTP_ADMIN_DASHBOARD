import type { StayFact, ExtFact } from './finance';
import { stayBooked, stayPaid } from './finance';
import { classifyOtp } from './classify';
import type { Recep } from '../hooks/data';

export interface RecPerf {
  id: string;
  name: string;
  email: string;
  hotelId: string | null;
  status: any;
  verifications: number;
  verified: number;
  stays: number;
  booked: number;
  collected: number;
}

/**
 * Revenue is attributed to the receptionist who created the stay.
 * Single source of truth (Step 2.3): extensions are not added to booked/collected.
 */
export function buildRecPerf(
  recs: Recep[],
  stays: StayFact[],
  _exts: ExtFact[],
  verifs: any[],
  _extIncluded?: boolean,
): RecPerf[] {
  const map = new Map<string, RecPerf>();
  for (const r of recs) {
    map.set(r.id, {
      id: r.id,
      name: r.name ?? '—',
      email: r.email ?? '—',
      hotelId: r.hotel_id,
      status: r.status,
      verifications: 0,
      verified: 0,
      stays: 0,
      booked: 0,
      collected: 0,
    });
  }

  for (const s of stays) {
    const p = s.receptionist_id ? map.get(s.receptionist_id) : undefined;
    if (!p) continue;
    p.stays++;
    p.booked += stayBooked(s);
    p.collected += stayPaid(s);
  }

  for (const v of verifs) {
    const p = v.receptionist_id ? map.get(v.receptionist_id) : undefined;
    if (!p) continue;
    p.verifications++;
    if (classifyOtp(v.otp_status) === 'verified') p.verified++;
  }

  return [...map.values()];
}
