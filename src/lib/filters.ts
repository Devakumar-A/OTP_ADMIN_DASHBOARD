import { Preset, presetRange, dateBounds, istStartIso } from './ist';
import { likeEscape } from './format';
import { env } from '../config';

export type DateField = 'check_in_time' | 'current_check_out_time' | 'checked_out_at' | 'created_at';

export const DATE_FIELD_LABELS: Record<DateField, string> = {
  check_in_time: 'Check-in',
  current_check_out_time: 'Expected check-out',
  checked_out_at: 'Actual check-out',
  created_at: 'Created',
};

export interface Filters {
  hotelId: string;
  preset: Preset;
  from: string;
  to: string;
  dateField: DateField;
  guestName: string;
  guestPhone: string;
  receptionistId: string;
  source: string;
  stayStatus: string;
  paymentStatus: string;
  paymentMode: string;
  bookingId: string;
  grc: string;
  roomNumber: string;
  otpStatus?: string;
  reviewStatus?: string;
}

export function defaultFilters(): Filters {
  const p: Preset = 'last7';
  return {
    hotelId: '',
    preset: p,
    ...presetRange(p),
    dateField: 'check_in_time',
    guestName: '',
    guestPhone: '',
    receptionistId: '',
    source: '',
    stayStatus: '',
    paymentStatus: '',
    paymentMode: '',
    bookingId: '',
    grc: '',
    roomNumber: '',
  };
}

export const FILTER_LABELS: Record<keyof Filters, string> = {
  hotelId: 'Hotel',
  preset: 'Period',
  from: 'From (IST)',
  to: 'To (IST)',
  dateField: 'Date field',
  guestName: 'Guest name',
  guestPhone: 'Phone',
  receptionistId: 'Receptionist',
  source: 'Source',
  stayStatus: 'Stay status',
  paymentStatus: 'Payment status',
  paymentMode: 'Payment mode',
  bookingId: 'Booking ID',
  grc: 'GRC number',
  roomNumber: 'Room',
  otpStatus: 'OTP status',
  reviewStatus: 'Review status',
};

const MODE_COLUMN: Record<string, string> = {
  Cash: 'cash_amount',
  GPay: 'gpay_amount',
  Card: 'card_amount',
  Online: 'online_amount',
};

/** Get the hard data cutoff ISO timestamp in UTC (IST start of day). */
export function getCutoffIso(): string {
  return istStartIso(env.dataStart || '2026-10-18');
}

/**
 * Intersect user's date range [start, end) with the hard cutoff [cutoffIso, infinity).
 * Returns the effective start and end ISO strings.
 */
export function intersectWithCutoff(start?: string, end?: string): { start: string; end?: string; emptyRange: boolean } {
  const cutoffIso = getCutoffIso();
  let effectiveStart = cutoffIso;

  if (start && start > cutoffIso) {
    effectiveStart = start;
  }

  // If user specified an end date that is <= cutoff, the entire range is before cutoff
  if (end && end <= cutoffIso) {
    return { start: cutoffIso, end: cutoffIso, emptyRange: true };
  }

  return { start: effectiveStart, end, emptyRange: false };
}

/**
 * Apply filters that are meaningful on guest_stays.
 * Always enforces check_in_time >= cutoffIso, regardless of user date selection or skipDate.
 */
export function applyStayFilters(q: any, f: Filters, opts: { skipDate?: boolean } = {}) {
  const cutoffIso = getCutoffIso();

  // 1. Mandatory cutoff: check_in_time must ALWAYS be >= cutoff
  q = q.gte('check_in_time', cutoffIso);

  // 2. Hotel filter (single or comma-separated multi-select)
  const hotelList = f.hotelId ? f.hotelId.split(',').map((x) => x.trim()).filter(Boolean) : [];
  if (hotelList.length === 1) {
    q = q.eq('hotel_id', hotelList[0]);
  } else if (hotelList.length > 1) {
    q = q.in('hotel_id', hotelList);
  }

  // 3. User date range (intersected with cutoff)
  if (!opts.skipDate) {
    const { start: rawStart, end: rawEnd } = dateBounds(f.from, f.to);
    const dateCol = f.dateField || 'check_in_time';

    if (dateCol === 'check_in_time') {
      const { start, end, emptyRange } = intersectWithCutoff(rawStart, rawEnd);
      if (emptyRange) {
        q = q.lt('check_in_time', cutoffIso); // impossible range -> 0 rows
      } else {
        if (start > cutoffIso) q = q.gte('check_in_time', start);
        if (end) q = q.lt('check_in_time', end);
      }
    } else {
      // If filtering on another date column (expected_checkout, actual_checkout, created_at)
      if (rawStart) q = q.gte(dateCol, rawStart);
      if (rawEnd) q = q.lt(dateCol, rawEnd);
    }
  }

  // 4. Text & dimension filters
  if (f.guestName?.trim()) q = q.ilike('guest_name', `%${likeEscape(f.guestName)}%`);
  if (f.guestPhone?.trim()) q = q.ilike('guest_phone', `%${likeEscape(f.guestPhone)}%`);
  if (f.receptionistId) q = q.eq('receptionist_id', f.receptionistId);
  if (f.source) {
    if (f.source === 'Not set' || f.source === '(Not set)' || f.source === 'null') {
      q = q.is('source', null);
    } else {
      q = q.eq('source', f.source);
    }
  }
  if (f.stayStatus) q = q.eq('stay_status', f.stayStatus);
  if (f.paymentStatus) q = q.eq('payment_status', f.paymentStatus);

  if (f.paymentMode) {
    if (MODE_COLUMN[f.paymentMode]) {
      q = q.gt(MODE_COLUMN[f.paymentMode], 0);
    } else {
      q = q.ilike('payment_mode', `%${likeEscape(f.paymentMode)}%`);
    }
  }

  if (f.bookingId?.trim()) q = q.ilike('booking_id', `%${likeEscape(f.bookingId)}%`);
  if (f.grc?.trim()) q = q.ilike('grc_number', `%${likeEscape(f.grc)}%`);
  if (f.roomNumber?.trim()) q = q.ilike('room_number', `%${likeEscape(f.roomNumber)}%`);

  return q;
}

/** Extensions are dated by created_at. Always enforces created_at >= cutoff. */
export function applyExtFilters(q: any, f: Filters, opts: { skipDate?: boolean } = {}) {
  const cutoffIso = getCutoffIso();
  q = q.gte('created_at', cutoffIso);

  const hotelList = f.hotelId ? f.hotelId.split(',').map((x) => x.trim()).filter(Boolean) : [];
  if (hotelList.length === 1) {
    q = q.eq('hotel_id', hotelList[0]);
  } else if (hotelList.length > 1) {
    q = q.in('hotel_id', hotelList);
  }

  if (!opts.skipDate) {
    const { start: rawStart, end: rawEnd } = dateBounds(f.from, f.to);
    const { start, end, emptyRange } = intersectWithCutoff(rawStart, rawEnd);
    if (emptyRange) {
      q = q.lt('created_at', cutoffIso);
    } else {
      if (start > cutoffIso) q = q.gte('created_at', start);
      if (end) q = q.lt('created_at', end);
    }
  }

  if (f.receptionistId) q = q.eq('receptionist_id', f.receptionistId);
  if (f.source) {
    if (f.source === 'Not set' || f.source === '(Not set)' || f.source === 'null') {
      q = q.is('source', null);
    } else {
      q = q.eq('source', f.source);
    }
  }
  if (f.paymentStatus) q = q.eq('payment_status', f.paymentStatus);
  if (f.paymentMode) q = q.ilike('payment_mode', `%${likeEscape(f.paymentMode)}%`);
  if (f.bookingId?.trim()) q = q.ilike('booking_id', `%${likeEscape(f.bookingId)}%`);
  return q;
}

export function applyVerifFilters(q: any, f: Filters, opts: { skipDate?: boolean } = {}) {
  const cutoffIso = getCutoffIso();
  q = q.gte('created_at', cutoffIso);

  const hotelList = f.hotelId ? f.hotelId.split(',').map((x) => x.trim()).filter(Boolean) : [];
  if (hotelList.length === 1) {
    q = q.eq('hotel_id', hotelList[0]);
  } else if (hotelList.length > 1) {
    q = q.in('hotel_id', hotelList);
  }

  if (!opts.skipDate) {
    const { start: rawStart, end: rawEnd } = dateBounds(f.from, f.to);
    const { start, end, emptyRange } = intersectWithCutoff(rawStart, rawEnd);
    if (emptyRange) {
      q = q.lt('created_at', cutoffIso);
    } else {
      if (start > cutoffIso) q = q.gte('created_at', start);
      if (end) q = q.lt('created_at', end);
    }
  }

  if (f.guestName?.trim()) q = q.ilike('guest_name', `%${likeEscape(f.guestName)}%`);
  if (f.guestPhone?.trim()) q = q.ilike('guest_phone', `%${likeEscape(f.guestPhone)}%`);
  if (f.receptionistId) q = q.eq('receptionist_id', f.receptionistId);
  if (f.source) {
    if (f.source === 'Not set' || f.source === '(Not set)' || f.source === 'null') {
      q = q.is('source', null);
    } else {
      q = q.eq('source', f.source);
    }
  }
  if (f.otpStatus) q = q.eq('otp_status', f.otpStatus);
  if (f.reviewStatus) q = q.eq('review_status', f.reviewStatus);
  return q;
}

export function applyFollowFilters(q: any, f: Filters, opts: { skipDate?: boolean } = {}) {
  const cutoffIso = getCutoffIso();
  q = q.gte('created_at', cutoffIso);

  const hotelList = f.hotelId ? f.hotelId.split(',').map((x) => x.trim()).filter(Boolean) : [];
  if (hotelList.length === 1) {
    q = q.eq('hotel_id', hotelList[0]);
  } else if (hotelList.length > 1) {
    q = q.in('hotel_id', hotelList);
  }

  if (!opts.skipDate) {
    const { start: rawStart, end: rawEnd } = dateBounds(f.from, f.to);
    const { start, end, emptyRange } = intersectWithCutoff(rawStart, rawEnd);
    if (emptyRange) {
      q = q.lt('created_at', cutoffIso);
    } else {
      if (start > cutoffIso) q = q.gte('created_at', start);
      if (end) q = q.lt('created_at', end);
    }
  }

  if (f.reviewStatus) q = q.eq('review_status', f.reviewStatus);
  return q;
}
