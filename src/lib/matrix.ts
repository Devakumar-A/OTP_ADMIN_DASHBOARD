import { istDate, addDays } from './ist';
import { StayFact, stayBooked } from './finance';
import { Hotel } from '../hooks/data';

export interface MatrixColumn {
  key: string;
  label: string;
  startDate: string;
  endDate: string; // exclusive
  isWeek?: boolean;
}

export interface HotelMatrixRow {
  hotelId: string;
  hotelName: string;
  hotelCode: string;
  checkIns: Record<string, number>;
  revenue: Record<string, number>;
  totalCheckIns: number;
  totalRevenue: number;
}

export interface MatrixData {
  columns: MatrixColumn[];
  rows: HotelMatrixRow[];
  totals: {
    checkIns: Record<string, number>;
    revenue: Record<string, number>;
    totalCheckIns: number;
    totalRevenue: number;
  };
  maxCellRevenue: number;
  maxCellCheckIns: number;
  isWeekly: boolean;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatShortDate(ymd: string): string {
  const parts = ymd.split('-');
  if (parts.length < 3) return ymd;
  const d = parseInt(parts[2], 10);
  const m = parseInt(parts[1], 10) - 1;
  return `${d} ${MONTH_NAMES[m] || ''}`;
}

export function buildHotelDateMatrix(
  stays: StayFact[],
  hotels: Hotel[],
  fromIsoOrDate?: string,
  toIsoOrDate?: string,
): MatrixData {
  // Determine date bounds in IST
  let startYmd = fromIsoOrDate ? istDate(fromIsoOrDate) : '';
  let endYmd = toIsoOrDate ? istDate(toIsoOrDate) : '';

  if (!startYmd || !endYmd) {
    const dates = stays.map((s) => (s.check_in_time ? istDate(s.check_in_time) : null)).filter(Boolean) as string[];
    if (dates.length > 0) {
      dates.sort();
      if (!startYmd) startYmd = dates[0];
      if (!endYmd) endYmd = addDays(dates[dates.length - 1], 1);
    } else {
      const today = istDate(Date.now());
      startYmd = addDays(today, -6);
      endYmd = addDays(today, 1);
    }
  }

  // Generate all consecutive days
  const allDays: string[] = [];
  let curr = startYmd;
  while (curr < endYmd && allDays.length < 366) {
    allDays.push(curr);
    curr = addDays(curr, 1);
  }

  const isWeekly = allDays.length > 31;
  const columns: MatrixColumn[] = [];

  if (isWeekly) {
    // Group into 7-day chunks (weeks)
    for (let i = 0; i < allDays.length; i += 7) {
      const s = allDays[i];
      const e = i + 7 < allDays.length ? allDays[i + 7] : endYmd;
      const lastInChunk = addDays(e, -1);
      columns.push({
        key: `${s}_${e}`,
        label: `${formatShortDate(s)}–${formatShortDate(lastInChunk)}`,
        startDate: s,
        endDate: e,
        isWeek: true,
      });
    }
  } else {
    // Daily columns
    for (const d of allDays) {
      columns.push({
        key: d,
        label: formatShortDate(d),
        startDate: d,
        endDate: addDays(d, 1),
        isWeek: false,
      });
    }
  }

  // Build rows for each hotel
  const hotelMap = new Map<string, HotelMatrixRow>();

  // Initialize for all known hotels
  hotels.forEach((h) => {
    hotelMap.set(h.id, {
      hotelId: h.id,
      hotelName: h.hotel_name,
      hotelCode: h.hotel_code ?? '',
      checkIns: {},
      revenue: {},
      totalCheckIns: 0,
      totalRevenue: 0,
    });
  });

  // Populate data
  let maxCellRevenue = 0;
  let maxCellCheckIns = 0;

  for (const s of stays) {
    if (!s.check_in_time) continue;
    const stayYmd = istDate(s.check_in_time);
    const hid = s.hotel_id || 'unknown';

    let r = hotelMap.get(hid);
    if (!r) {
      r = {
        hotelId: hid,
        hotelName: hid === 'unknown' ? 'Unassigned Hotel' : 'Hotel ' + hid.slice(0, 6),
        hotelCode: '',
        checkIns: {},
        revenue: {},
        totalCheckIns: 0,
        totalRevenue: 0,
      };
      hotelMap.set(hid, r);
    }

    // Find which column this stay belongs to
    const col = columns.find((c) => stayYmd >= c.startDate && stayYmd < c.endDate);
    if (!col) continue;

    const amt = stayBooked(s);
    r.checkIns[col.key] = (r.checkIns[col.key] ?? 0) + 1;
    r.revenue[col.key] = (r.revenue[col.key] ?? 0) + amt;
    r.totalCheckIns += 1;
    r.totalRevenue += amt;

    if (r.checkIns[col.key] > maxCellCheckIns) maxCellCheckIns = r.checkIns[col.key];
    if (r.revenue[col.key] > maxCellRevenue) maxCellRevenue = r.revenue[col.key];
  }

  const rows = [...hotelMap.values()].sort((a, b) => b.totalRevenue - a.totalRevenue);

  // Compute Grand Totals
  const totals = {
    checkIns: {} as Record<string, number>,
    revenue: {} as Record<string, number>,
    totalCheckIns: 0,
    totalRevenue: 0,
  };

  for (const c of columns) {
    totals.checkIns[c.key] = rows.reduce((acc, r) => acc + (r.checkIns[c.key] ?? 0), 0);
    totals.revenue[c.key] = rows.reduce((acc, r) => acc + (r.revenue[c.key] ?? 0), 0);
  }

  totals.totalCheckIns = rows.reduce((acc, r) => acc + r.totalCheckIns, 0);
  totals.totalRevenue = rows.reduce((acc, r) => acc + r.totalRevenue, 0);

  return {
    columns,
    rows,
    totals,
    maxCellRevenue,
    maxCellCheckIns,
    isWeekly,
  };
}
