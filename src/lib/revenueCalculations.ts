import { StayFact, ExtFact, stayBooked, stayPaid, stayBalance, stayModes, MODES, PayMode, num } from './finance';
import { countCheckIns, countRooms, countNights } from './checkins';
import { istDate } from './ist';
import { classifyStay } from './classify';

export interface HotelSummary {
  hotelId: string;
  hotelName: string;
  hotelCode: string;
  checkIns: number;
  rooms: number;
  nights: number;
  booked: number;
  extAmount: number;
  cash: number;
  gpay: number;
  card: number;
  online: number;
  other: number;
  collected: number;
  outstanding: number;
  collectionPct: number;
}

export interface SourceSummary {
  source: string;
  stays: number;
  booked: number;
  collected: number;
  outstanding: number;
  cash: number;
  gpay: number;
  card: number;
  online: number;
  other: number;
}

export interface ModeSummary {
  mode: PayMode | 'Unallocated';
  staysCount: number;
  collected: number;
  sharePct: number;
}

export interface DailySummary {
  date: string;
  checkIns: number;
  booked: number;
  collected: number;
  outstanding: number;
  extAmount: number;
  cash: number;
  gpay: number;
  card: number;
  online: number;
}

export interface UnpaidGuestStay {
  stay: StayFact;
  guestName: string;
  phone: string;
  hotelId: string;
  hotelName: string;
  roomNumber: string;
  grcNumber: string;
  bookingId: string;
  source: string;
  checkInTime: string | null;
  expectedCheckOut: string | null;
  checkedOutAt: string | null;
  stayStatus: string;
  isOverdueOrCheckedOut: boolean;
  totalAmount: number;
  amountPaid: number;
  balanceAmount: number;
  daysSinceCheckIn: number;
  paymentMode: string;
  receptionistId: string | null;
  receptionistName: string;
  statusLabel: 'Unpaid' | 'Partly paid';
}

export interface EnrichedExtension {
  ext: ExtFact;
  hotelName: string;
  guestName: string;
  phone: string;
  grcNumber: string;
  roomNumber: string;
  previousCheckOut: string | null;
  newCheckOut: string | null;
  extraNights: number;
  reason: string;
  amount: number;
  paid: number;
  balance: number;
  paymentMode: string;
  source: string;
  receptionistName: string;
  createdAt: string | null;
}

/**
 * Builds Hotel summary table with All-Hotels total row
 */
export function buildHotelSummaries(
  stays: StayFact[],
  exts: ExtFact[] = [],
  hotelNameLookup: (id: string | null | undefined) => string,
): { rows: HotelSummary[]; totals: HotelSummary } {
  const map = new Map<string, HotelSummary>();

  for (const s of stays) {
    const hid = s.hotel_id || 'unknown';
    let r = map.get(hid);
    if (!r) {
      r = {
        hotelId: hid,
        hotelName: hotelNameLookup(hid),
        hotelCode: '',
        checkIns: 0,
        rooms: 0,
        nights: 0,
        booked: 0,
        extAmount: 0,
        cash: 0,
        gpay: 0,
        card: 0,
        online: 0,
        other: 0,
        collected: 0,
        outstanding: 0,
        collectionPct: 0,
      };
      map.set(hid, r);
    }

    r.checkIns += 1;
    r.rooms += num(s.number_of_rooms) > 0 ? num(s.number_of_rooms) : 1;
    r.nights += num(s.number_of_nights) > 0 ? num(s.number_of_nights) : 1;
    r.booked += stayBooked(s);
    r.collected += stayPaid(s);
    r.outstanding += stayBalance(s);

    const m = stayModes(s);
    r.cash += m.Cash;
    r.gpay += m.GPay;
    r.card += m.Card;
    r.online += m.Online;
    r.other += m.Other;
  }

  // Add extension amounts
  for (const x of exts) {
    const hid = x.hotel_id || 'unknown';
    const r = map.get(hid);
    if (r) {
      r.extAmount += num(x.extension_amount);
    }
  }

  const rows = [...map.values()].map((r) => ({
    ...r,
    collectionPct: r.booked > 0 ? (r.collected / r.booked) * 100 : 0,
  })).sort((a, b) => b.booked - a.booked);

  const totals: HotelSummary = {
    hotelId: 'all',
    hotelName: 'All hotels',
    hotelCode: '',
    checkIns: rows.reduce((acc, r) => acc + r.checkIns, 0),
    rooms: rows.reduce((acc, r) => acc + r.rooms, 0),
    nights: rows.reduce((acc, r) => acc + r.nights, 0),
    booked: rows.reduce((acc, r) => acc + r.booked, 0),
    extAmount: rows.reduce((acc, r) => acc + r.extAmount, 0),
    cash: rows.reduce((acc, r) => acc + r.cash, 0),
    gpay: rows.reduce((acc, r) => acc + r.gpay, 0),
    card: rows.reduce((acc, r) => acc + r.card, 0),
    online: rows.reduce((acc, r) => acc + r.online, 0),
    other: rows.reduce((acc, r) => acc + r.other, 0),
    collected: rows.reduce((acc, r) => acc + r.collected, 0),
    outstanding: rows.reduce((acc, r) => acc + r.outstanding, 0),
    collectionPct: 0,
  };
  totals.collectionPct = totals.booked > 0 ? (totals.collected / totals.booked) * 100 : 0;

  return { rows, totals };
}

/**
 * Builds Source summary table (MMT, Agoda, Direct, Walk-in, Not set, etc.)
 */
export function buildSourceSummaries(stays: StayFact[]): { rows: SourceSummary[]; totals: SourceSummary } {
  const map = new Map<string, SourceSummary>();

  for (const s of stays) {
    const rawSrc = s.source ? s.source.trim() : '';
    const src = rawSrc || 'Not set';

    let r = map.get(src);
    if (!r) {
      r = {
        source: src,
        stays: 0,
        booked: 0,
        collected: 0,
        outstanding: 0,
        cash: 0,
        gpay: 0,
        card: 0,
        online: 0,
        other: 0,
      };
      map.set(src, r);
    }

    r.stays += 1;
    r.booked += stayBooked(s);
    r.collected += stayPaid(s);
    r.outstanding += stayBalance(s);

    const m = stayModes(s);
    r.cash += m.Cash;
    r.gpay += m.GPay;
    r.card += m.Card;
    r.online += m.Online;
    r.other += m.Other;
  }

  const rows = [...map.values()].sort((a, b) => b.booked - a.booked);

  const totals: SourceSummary = {
    source: 'Total',
    stays: rows.reduce((acc, r) => acc + r.stays, 0),
    booked: rows.reduce((acc, r) => acc + r.booked, 0),
    collected: rows.reduce((acc, r) => acc + r.collected, 0),
    outstanding: rows.reduce((acc, r) => acc + r.outstanding, 0),
    cash: rows.reduce((acc, r) => acc + r.cash, 0),
    gpay: rows.reduce((acc, r) => acc + r.gpay, 0),
    card: rows.reduce((acc, r) => acc + r.card, 0),
    online: rows.reduce((acc, r) => acc + r.online, 0),
    other: rows.reduce((acc, r) => acc + r.other, 0),
  };

  return { rows, totals };
}

/**
 * Builds Payment mode summary table with share %
 */
export function buildPaymentModeSummaries(stays: StayFact[]): { rows: ModeSummary[]; totals: ModeSummary } {
  const modeTotals: Record<PayMode, { stays: number; collected: number }> = {
    Cash: { stays: 0, collected: 0 },
    GPay: { stays: 0, collected: 0 },
    Card: { stays: 0, collected: 0 },
    Online: { stays: 0, collected: 0 },
    Other: { stays: 0, collected: 0 },
  };

  let unallocatedAmount = 0;
  let unallocatedStays = 0;

  for (const s of stays) {
    const paid = stayPaid(s);
    if (paid <= 0) continue;

    const m = stayModes(s);
    let splitSum = 0;

    for (const mode of MODES) {
      if (m[mode] > 0) {
        modeTotals[mode].stays += 1;
        modeTotals[mode].collected += m[mode];
        splitSum += m[mode];
      }
    }

    if (paid > splitSum + 0.5) {
      unallocatedAmount += paid - splitSum;
      unallocatedStays += 1;
    }
  }

  const totalCollected = stays.reduce((sum, s) => sum + stayPaid(s), 0);

  const rows: ModeSummary[] = (MODES as readonly PayMode[]).map((mode) => ({
    mode,
    staysCount: modeTotals[mode].stays,
    collected: modeTotals[mode].collected,
    sharePct: totalCollected > 0 ? (modeTotals[mode].collected / totalCollected) * 100 : 0,
  }));

  if (unallocatedAmount > 0.5) {
    rows.push({
      mode: 'Unallocated',
      staysCount: unallocatedStays,
      collected: unallocatedAmount,
      sharePct: totalCollected > 0 ? (unallocatedAmount / totalCollected) * 100 : 0,
    });
  }

  const totals: ModeSummary = {
    mode: 'Other',
    staysCount: stays.filter((s) => stayPaid(s) > 0).length,
    collected: totalCollected,
    sharePct: 100,
  };

  return { rows, totals };
}

/**
 * Builds Daily summary table
 */
export function buildDailySummaries(
  stays: StayFact[],
  exts: ExtFact[] = [],
): { rows: DailySummary[]; totals: DailySummary } {
  const map = new Map<string, DailySummary>();

  for (const s of stays) {
    if (!s.check_in_time) continue;
    const ymd = istDate(s.check_in_time);

    let r = map.get(ymd);
    if (!r) {
      r = {
        date: ymd,
        checkIns: 0,
        booked: 0,
        collected: 0,
        outstanding: 0,
        extAmount: 0,
        cash: 0,
        gpay: 0,
        card: 0,
        online: 0,
      };
      map.set(ymd, r);
    }

    r.checkIns += 1;
    r.booked += stayBooked(s);
    r.collected += stayPaid(s);
    r.outstanding += stayBalance(s);

    const m = stayModes(s);
    r.cash += m.Cash;
    r.gpay += m.GPay;
    r.card += m.Card;
    r.online += m.Online;
  }

  // Extensions dated by created_at (IST)
  for (const x of exts) {
    if (!x.created_at) continue;
    const ymd = istDate(x.created_at);
    let r = map.get(ymd);
    if (!r) {
      r = {
        date: ymd,
        checkIns: 0,
        booked: 0,
        collected: 0,
        outstanding: 0,
        extAmount: 0,
        cash: 0,
        gpay: 0,
        card: 0,
        online: 0,
      };
      map.set(ymd, r);
    }
    r.extAmount += num(x.extension_amount);
  }

  const rows = [...map.values()].sort((a, b) => b.date.localeCompare(a.date));

  const totals: DailySummary = {
    date: 'Total',
    checkIns: rows.reduce((acc, r) => acc + r.checkIns, 0),
    booked: rows.reduce((acc, r) => acc + r.booked, 0),
    collected: rows.reduce((acc, r) => acc + r.collected, 0),
    outstanding: rows.reduce((acc, r) => acc + r.outstanding, 0),
    extAmount: rows.reduce((acc, r) => acc + r.extAmount, 0),
    cash: rows.reduce((acc, r) => acc + r.cash, 0),
    gpay: rows.reduce((acc, r) => acc + r.gpay, 0),
    card: rows.reduce((acc, r) => acc + r.card, 0),
    online: rows.reduce((acc, r) => acc + r.online, 0),
  };

  return { rows, totals };
}

/**
 * Builds Unpaid / Outstanding guest list with risk analysis
 */
export function buildUnpaidGuests(
  stays: StayFact[],
  hotelNameLookup: (id: string | null | undefined) => string,
  recNameLookup: (id: string | null | undefined) => string,
): {
  unpaidList: UnpaidGuestStay[];
  totalOutstanding: number;
  checkedOutOutstanding: number;
  unpaidCount: number;
  partlyPaidCount: number;
  highestRiskCount: number;
} {
  const now = Date.now();
  const unpaidList: UnpaidGuestStay[] = [];
  let totalOutstanding = 0;
  let checkedOutOutstanding = 0;
  let unpaidCount = 0;
  let partlyPaidCount = 0;
  let highestRiskCount = 0;

  for (const s of stays) {
    const bal = stayBalance(s);
    if (bal <= 0) continue;

    const paid = stayPaid(s);
    const cls = classifyStay(s.stay_status, s.checked_out_at);
    const isCheckedOut = cls === 'checked_out' || !!s.checked_out_at;
    const isOverdue =
      !isCheckedOut && s.current_check_out_time ? new Date(s.current_check_out_time).getTime() < now : false;

    const isHighRisk = isCheckedOut || isOverdue;

    let daysSince = 0;
    if (s.check_in_time) {
      daysSince = Math.max(0, Math.floor((now - new Date(s.check_in_time).getTime()) / (1000 * 60 * 60 * 24)));
    }

    const item: UnpaidGuestStay = {
      stay: s,
      guestName: s.guest_name || '—',
      phone: s.guest_phone || '—',
      hotelId: s.hotel_id || '',
      hotelName: hotelNameLookup(s.hotel_id),
      roomNumber: s.room_number || '—',
      grcNumber: s.grc_number || s.booking_id || s.id.slice(0, 8),
      bookingId: s.booking_id || '—',
      source: s.source || '—',
      checkInTime: s.check_in_time,
      expectedCheckOut: s.current_check_out_time ?? null,
      checkedOutAt: s.checked_out_at,
      stayStatus: isCheckedOut ? 'Checked out' : isOverdue ? 'Overdue active' : 'In-house',
      isOverdueOrCheckedOut: isHighRisk,
      totalAmount: stayBooked(s),
      amountPaid: paid,
      balanceAmount: bal,
      daysSinceCheckIn: daysSince,
      paymentMode: s.payment_mode || '—',
      receptionistId: s.receptionist_id,
      receptionistName: recNameLookup(s.receptionist_id),
      statusLabel: paid === 0 ? 'Unpaid' : 'Partly paid',
    };

    unpaidList.push(item);
    totalOutstanding += bal;
    if (isHighRisk) {
      checkedOutOutstanding += bal;
      highestRiskCount += 1;
    }
    if (paid === 0) unpaidCount++;
    else partlyPaidCount++;
  }

  // Sort by balance descending (highest outstanding first)
  unpaidList.sort((a, b) => b.balanceAmount - a.balanceAmount);

  return {
    unpaidList,
    totalOutstanding,
    checkedOutOutstanding,
    unpaidCount,
    partlyPaidCount,
    highestRiskCount,
  };
}

/**
 * Enriches extensions with parent stay details in a single pass (no N+1)
 */
export function enrichExtensions(
  exts: ExtFact[],
  stays: StayFact[],
  hotelNameLookup: (id: string | null | undefined) => string,
  recNameLookup: (id: string | null | undefined) => string,
): EnrichedExtension[] {
  const stayMap = new Map<string, StayFact>();
  for (const s of stays) {
    if (s.id) stayMap.set(s.id, s);
  }

  return exts.map((x) => {
    const parent = x.guest_stay_id ? stayMap.get(x.guest_stay_id) : undefined;
    return {
      ext: x,
      hotelName: hotelNameLookup(x.hotel_id || parent?.hotel_id),
      guestName: parent?.guest_name || '—',
      phone: parent?.guest_phone || '—',
      grcNumber: parent?.grc_number || parent?.booking_id || x.booking_id || (x.guest_stay_id ? x.guest_stay_id.slice(0, 8) : '—'),
      roomNumber: parent?.room_number || '—',
      previousCheckOut: x.previous_checkout_time ?? null,
      newCheckOut: x.new_checkout_time ?? null,
      extraNights: num(x.extension_nights),
      reason: x.extension_reason || '—',
      amount: num(x.extension_amount),
      paid: num(x.amount_paid),
      balance: num(x.balance_amount),
      paymentMode: x.payment_mode || '—',
      source: x.source || parent?.source || '—',
      receptionistName: recNameLookup(x.receptionist_id || parent?.receptionist_id),
      createdAt: x.created_at,
    };
  }).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
