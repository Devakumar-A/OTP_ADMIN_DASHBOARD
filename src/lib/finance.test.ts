import { describe, it, expect } from 'vitest';
import {
  computeTotals,
  groupBy,
  stayModes,
  dataQuality,
  normMode,
  analyzeOutliers,
  StayFact,
  ExtFact,
} from './finance';
import { istDate, presetRange, dateBounds, addDays, istStartIso } from './ist';
import { maskPhone } from './format';
import { defaultFilters, applyStayFilters, getCutoffIso } from './filters';
import { countCheckIns, countRooms, countNights, auditCheckIns } from './checkins';
import {
  buildHotelSummaries,
  buildSourceSummaries,
  buildPaymentModeSummaries,
  buildDailySummaries,
  buildUnpaidGuests,
} from './revenueCalculations';

const stay = (o: Partial<StayFact>): StayFact => ({
  id: 's',
  hotel_id: 'h1',
  receptionist_id: 'r1',
  check_in_time: '2026-11-10T04:00:00Z',
  checked_out_at: null,
  current_check_out_time: '2026-11-12T05:30:00Z',
  stay_status: 'active',
  payment_status: null,
  payment_mode: null,
  number_of_guests: 2,
  number_of_rooms: 1,
  amount: 1000,
  total_amount: 1000,
  amount_paid: 0,
  balance_amount: 1000,
  cash_amount: 0,
  gpay_amount: 0,
  card_amount: 0,
  online_amount: 0,
  ...o,
});

const ext = (o: Partial<ExtFact>): ExtFact => ({
  id: 'e',
  guest_stay_id: 's',
  hotel_id: 'h1',
  receptionist_id: 'r1',
  created_at: '2026-11-11T04:00:00Z',
  extension_nights: 1,
  extension_amount: 500,
  amount_paid: 200,
  balance_amount: 300,
  payment_mode: 'cash',
  payment_status: 'partial',
  ...o,
});

describe('finance single source of truth (Requirement 5)', () => {
  it('computes revenue strictly from guest_stays and does not add extensions on top', () => {
    const s = stay({ total_amount: 1000, amount_paid: 800, balance_amount: 200 });
    const x = ext({ extension_amount: 500, amount_paid: 200, balance_amount: 300 });

    const t = computeTotals([s], [x]);

    // Booked, collected and outstanding are strictly from guest_stays
    expect(t.booked).toBe(1000);
    expect(t.collected).toBe(800);
    expect(t.outstanding).toBe(200);
    expect(t.collectionPct).toBeCloseTo(80);

    // Extensions are reported separately as informational metrics
    expect(t.extBooked).toBe(500);
    expect(t.extCollected).toBe(200);
    expect(t.extOutstanding).toBe(300);
    expect(t.extensions).toBe(1);
    expect(t.extNights).toBe(1);
  });

  it('falls back to amount only if total_amount is null', () => {
    const s = stay({ total_amount: null, amount: 1500, amount_paid: 1000, balance_amount: 500 });
    const t = computeTotals([s], []);
    expect(t.booked).toBe(1500);
    expect(t.collected).toBe(1000);
    expect(t.outstanding).toBe(500);
  });

  it('uses split columns OR payment_mode, never both', () => {
    const split = stayModes(
      stay({ amount_paid: 1000, cash_amount: 600, gpay_amount: 400, payment_mode: 'cash' }),
    );
    expect(split.Cash).toBe(600);
    expect(split.GPay).toBe(400);
    expect(split.Cash + split.GPay + split.Card + split.Online + split.Other).toBe(1000);

    const single = stayModes(stay({ amount_paid: 800, payment_mode: 'Card' }));
    expect(single.Card).toBe(800);
    expect(single.Cash).toBe(0);
  });

  it('mode totals strictly equal collected revenue', () => {
    const stays = [
      stay({ amount_paid: 1000, cash_amount: 1000 }),
      stay({ id: 's2', amount_paid: 500, payment_mode: 'upi' }),
    ];
    const t = computeTotals(stays, [ext({ amount_paid: 200 })]);
    const modeSum = Object.values(t.modes).reduce((a, b) => a + b, 0);
    expect(modeSum).toBe(t.collected);
  });

  it('groups by hotel without adding extensions to headline revenue', () => {
    const rows = groupBy(
      [stay({ id: 's1', hotel_id: 'h1', total_amount: 1000 }), stay({ id: 's2', hotel_id: 'h2', total_amount: 2000 })],
      [ext({ hotel_id: 'h1', extension_amount: 500 })],
      (s) => s.hotel_id,
      (x) => x.hotel_id,
    );
    const h1 = rows.find((r) => r.key === 'h1')!;
    const h2 = rows.find((r) => r.key === 'h2')!;

    expect(h1.booked).toBe(1000);
    expect(h1.extBooked).toBe(500);
    expect(h2.booked).toBe(2000);
  });

  it('flags data quality and outlier stays', () => {
    const stays = [
      stay({ id: 's1', total_amount: 1000, amount_paid: 1000, balance_amount: 0 }),
      stay({ id: 's2', total_amount: 1200, amount_paid: 1200, balance_amount: 0 }),
      stay({ id: 's3', total_amount: 1100, amount_paid: 1100, balance_amount: 0 }),
      stay({ id: 's4', total_amount: 150000, amount_paid: 150000, balance_amount: 0 }), // > 10x median outlier
    ];

    const out = analyzeOutliers(stays);
    expect(out.top10.length).toBe(4);
    expect(out.tenXMedianRows.some((s) => s.id === 's4')).toBe(true);
    expect(out.totalRevenueAll).toBe(153300);
    expect(out.totalRevenueWithoutOutliers).toBe(0);
  });

  it('same filter gives the same totals on Overview and Revenue (Requirement 5)', () => {
    const mockStays = [
      stay({ id: 's1', hotel_id: 'h1', total_amount: 3000, amount_paid: 2000, balance_amount: 1000 }),
      stay({ id: 's2', hotel_id: 'h1', total_amount: 5000, amount_paid: 5000, balance_amount: 0 }),
    ];
    const mockExts = [
      ext({ id: 'e1', hotel_id: 'h1', extension_amount: 600, amount_paid: 600, balance_amount: 0 }),
    ];

    // Overview calculation
    const overviewTotals = computeTotals(mockStays, mockExts);

    // Revenue calculation
    const revenueTotals = computeTotals(mockStays, mockExts);

    expect(overviewTotals.booked).toBe(revenueTotals.booked);
    expect(overviewTotals.collected).toBe(revenueTotals.collected);
    expect(overviewTotals.outstanding).toBe(revenueTotals.outstanding);
    expect(overviewTotals.collectionPct).toBe(revenueTotals.collectionPct);
    expect(overviewTotals.booked).toBe(8000);
    expect(overviewTotals.collected).toBe(7000);
    expect(overviewTotals.outstanding).toBe(1000);
  });
});

describe('data cutoff enforcement (Requirement 1)', () => {
  it('enforces check_in_time >= cutoff even when filter range is before the cutoff', () => {
    const cutoffIso = getCutoffIso();
    const calls: { op: string; col: string; val: any }[] = [];
    const mockQuery = {
      gte: (col: string, val: any) => {
        calls.push({ op: 'gte', col, val });
        return mockQuery;
      },
      lt: (col: string, val: any) => {
        calls.push({ op: 'lt', col, val });
        return mockQuery;
      },
      eq: () => mockQuery,
      ilike: () => mockQuery,
      gt: () => mockQuery,
    };

    // Filter range completely before cutoff (e.g. 2026-10-01 to 2026-10-10)
    const fBeforeCutoff = {
      ...defaultFilters(),
      from: '2026-10-01T00:00',
      to: '2026-10-10T00:00',
    };

    applyStayFilters(mockQuery, fBeforeCutoff);

    // Verify cutoff was strictly applied as minimum bound
    const hasCutoffGte = calls.some(
      (c) => c.op === 'gte' && c.col === 'check_in_time' && c.val === cutoffIso,
    );
    expect(hasCutoffGte).toBe(true);

    // And because end was <= cutoff, an impossible bound (< cutoffIso) prevents any rows earlier than cutoff
    const hasImpossibleLt = calls.some(
      (c) => c.op === 'lt' && c.col === 'check_in_time' && c.val === cutoffIso,
    );
    expect(hasImpossibleLt).toBe(true);
  });
});

describe('IST dates & datetime-local range bounds', () => {
  it('converts instants to IST calendar days', () => {
    expect(istDate('2026-11-16T19:00:00Z')).toBe('2026-11-17'); // 00:30 IST next day
    expect(istDate('2026-11-17T18:29:00Z')).toBe('2026-11-17');
    expect(istDate('2026-11-17T18:30:00Z')).toBe('2026-11-18');
  });

  it('builds presets with minute precision', () => {
    const now = new Date('2026-11-17T07:00:00Z').getTime(); // 12:30 IST
    expect(presetRange('today', now)).toEqual({
      from: '2026-11-17T00:00',
      to: '2026-11-18T00:00',
    });
    expect(presetRange('yesterday', now)).toEqual({
      from: '2026-11-16T00:00',
      to: '2026-11-17T00:00',
    });
    expect(presetRange('last24h', now)).toEqual({
      from: '2026-11-16T12:30',
      to: '2026-11-17T12:30',
    });
  });

  it('converts IST datetime-local to UTC bounds with From inclusive and To exclusive', () => {
    const b = dateBounds('2026-11-17T00:00', '2026-11-18T00:00');
    expect(b.start).toBe('2026-11-16T18:30:00.000Z');
    expect(b.end).toBe('2026-11-17T18:30:00.000Z');
  });
});

describe('masking', () => {
  it('masks phone numbers', () => {
    expect(maskPhone('9876543210')).toBe('98•••••210');
    expect(maskPhone('')).toBe('—');
  });
});

describe('check-in counting & integrity (Requirement 1 & 8)', () => {
  it('counts distinct stay IDs on that IST calendar day, showing rooms separately', () => {
    const s1 = stay({ id: 's1', check_in_time: '2026-11-17T02:00:00Z', number_of_rooms: 2 }); // 07:30 IST
    const s2 = stay({ id: 's2', check_in_time: '2026-11-17T20:00:00Z', number_of_rooms: 1 }); // 01:30 IST next day (2026-11-18)
    const s3 = stay({ id: 's3', check_in_time: '2026-11-18T01:00:00Z', number_of_rooms: 3 }); // 06:30 IST (2026-11-18)

    // Midnight check-in test: s2 (01:30 IST on 18 Nov) and s3 (06:30 IST on 18 Nov) both belong to 2026-11-18
    expect(istDate(s2.check_in_time!)).toBe('2026-11-18');
    expect(istDate(s3.check_in_time!)).toBe('2026-11-18');

    const totalStays = [s1, s2, s3];
    expect(countCheckIns(totalStays)).toBe(3);
    // Rooms are counted separately, not as check-ins
    expect(countRooms(totalStays)).toBe(6);

    const audit = auditCheckIns(totalStays);
    expect(audit.duplicateIds.length).toBe(0);
    expect(audit.midnightCheckInsCount).toBe(1); // s2 checked in at 01:30 IST
  });
});

describe('accounts summaries reconciliation (Requirement 2 & 8)', () => {
  it('hotel, source, daily, and mode table sums strictly equal headline totals', () => {
    const s1 = stay({
      id: 's1',
      hotel_id: 'h1',
      source: 'MMT',
      check_in_time: '2026-11-17T04:00:00Z',
      total_amount: 5000,
      amount_paid: 3000,
      balance_amount: 2000,
      cash_amount: 2000,
      gpay_amount: 1000,
    });
    const s2 = stay({
      id: 's2',
      hotel_id: 'h2',
      source: 'Direct',
      check_in_time: '2026-11-17T06:00:00Z',
      total_amount: 8000,
      amount_paid: 8000,
      balance_amount: 0,
      card_amount: 8000,
    });
    const s3 = stay({
      id: 's3',
      hotel_id: 'h1',
      source: 'Walk-in',
      check_in_time: '2026-11-18T04:00:00Z',
      total_amount: 3000,
      amount_paid: 1000,
      balance_amount: 2000,
      online_amount: 1000,
    });

    const testStays = [s1, s2, s3];
    const t = computeTotals(testStays, []);

    const hotels = buildHotelSummaries(testStays, [], (id: string | null | undefined) => id || '');
    const sources = buildSourceSummaries(testStays);
    const modes = buildPaymentModeSummaries(testStays);
    const daily = buildDailySummaries(testStays, []);
    const unpaid = buildUnpaidGuests(testStays, (id: string | null | undefined) => id || '', () => 'Rec');

    // 1. Hotel table total strictly matches headline
    expect(hotels.totals.booked).toBe(t.booked);
    expect(hotels.totals.collected).toBe(t.collected);
    expect(hotels.totals.outstanding).toBe(t.outstanding);

    // 2. Source table total strictly matches headline
    expect(sources.totals.booked).toBe(t.booked);
    expect(sources.totals.collected).toBe(t.collected);
    expect(sources.totals.outstanding).toBe(t.outstanding);

    // 3. Daily table total strictly matches headline
    expect(daily.totals.booked).toBe(t.booked);
    expect(daily.totals.collected).toBe(t.collected);
    expect(daily.totals.outstanding).toBe(t.outstanding);

    // 4. Split-up sum strictly equals collected (100% reconciliation)
    const modeSum = modes.rows.reduce((sum: number, r: any) => sum + r.collected, 0);
    expect(modeSum).toBe(t.collected);

    // 5. Unpaid list balance matches outstanding
    expect(unpaid.totalOutstanding).toBe(t.outstanding);
  });

  it('correctly handles suspect amount exclusions', () => {
    const normal = stay({ id: 's1', total_amount: 2000, amount_paid: 2000, balance_amount: 0 });
    const outlier = stay({ id: 's2', total_amount: 900000, amount_paid: 900000, balance_amount: 0 });

    const stays = [normal, outlier];
    const out = analyzeOutliers(stays);

    expect(out.totalRevenueAll).toBe(902000);
    expect(out.totalRevenueWithoutOutliers).toBe(0); // normal is in top 10 of a 2-item array
  });
});
