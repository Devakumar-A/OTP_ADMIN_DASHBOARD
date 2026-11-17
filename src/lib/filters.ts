import { Preset, presetRange, dateBounds } from './ist';
import { likeEscape } from './format';

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
  stayStatus: string;
  paymentStatus: string;
  paymentMode: string;
  bookingId: string;
  grc: string;
  roomNumber: string;
  otpStatus: string;
  reviewStatus: string;
  checkoutFrom?: string;
  checkoutTo?: string;
}

export function defaultFilters(): Filters {
  const p: Preset = 'thisMonth';
  return {
    hotelId: '',
    preset: p,
    ...presetRange(p),
    dateField: 'check_in_time',
    guestName: '',
    guestPhone: '',
    receptionistId: '',
    stayStatus: '',
    paymentStatus: '',
    paymentMode: '',
    bookingId: '',
    grc: '',
    roomNumber: '',
    otpStatus: '',
    reviewStatus: '',
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
  stayStatus: 'Stay status',
  paymentStatus: 'Payment status',
  paymentMode: 'Payment mode',
  bookingId: 'Booking ID',
  grc: 'GRC number',
  roomNumber: 'Room',
  otpStatus: 'OTP status',
  reviewStatus: 'Review status',
  checkoutFrom: 'Check-out from',
  checkoutTo: 'Check-out to',
};

const MODE_COLUMN: Record<string, string> = {
  Cash: 'cash_amount',
  GPay: 'gpay_amount',
  Card: 'card_amount',
  Online: 'online_amount',
};

/**
 * Apply filters that are meaningful on guest_stays.
 * From is inclusive (>= start), To is exclusive (< end).
 */
export function applyStayFilters(q: any, f: Filters, opts: { skipDate?: boolean } = {}) {
  if (f.hotelId) q = q.eq('hotel_id', f.hotelId);

  if (!opts.skipDate) {
    const { start, end } = dateBounds(f.from, f.to);
    const dateCol = f.dateField || 'check_in_time';
    if (start) q = q.gte(dateCol, start);
    if (end) q = q.lt(dateCol, end);
  }

  if (f.guestName?.trim()) q = q.ilike('guest_name', `%${likeEscape(f.guestName)}%`);
  if (f.guestPhone?.trim()) q = q.ilike('guest_phone', `%${likeEscape(f.guestPhone)}%`);
  if (f.receptionistId) q = q.eq('receptionist_id', f.receptionistId);
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

/** Extensions are dated by created_at. */
export function applyExtFilters(q: any, f: Filters, opts: { skipDate?: boolean } = {}) {
  if (f.hotelId) q = q.eq('hotel_id', f.hotelId);
  if (!opts.skipDate) {
    const { start, end } = dateBounds(f.from, f.to);
    if (start) q = q.gte('created_at', start);
    if (end) q = q.lt('created_at', end);
  }
  if (f.receptionistId) q = q.eq('receptionist_id', f.receptionistId);
  if (f.paymentStatus) q = q.eq('payment_status', f.paymentStatus);
  if (f.paymentMode) q = q.ilike('payment_mode', `%${likeEscape(f.paymentMode)}%`);
  if (f.bookingId?.trim()) q = q.ilike('booking_id', `%${likeEscape(f.bookingId)}%`);
  return q;
}

export function applyVerifFilters(q: any, f: Filters, opts: { skipDate?: boolean } = {}) {
  if (f.hotelId) q = q.eq('hotel_id', f.hotelId);
  if (!opts.skipDate) {
    const { start, end } = dateBounds(f.from, f.to);
    if (start) q = q.gte('created_at', start);
    if (end) q = q.lt('created_at', end);
  }
  if (f.guestName?.trim()) q = q.ilike('guest_name', `%${likeEscape(f.guestName)}%`);
  if (f.guestPhone?.trim()) q = q.ilike('guest_phone', `%${likeEscape(f.guestPhone)}%`);
  if (f.receptionistId) q = q.eq('receptionist_id', f.receptionistId);
  if (f.otpStatus) q = q.eq('otp_status', f.otpStatus);
  if (f.reviewStatus) q = q.eq('review_status', f.reviewStatus);
  return q;
}

export function applyFollowFilters(q: any, f: Filters, opts: { skipDate?: boolean } = {}) {
  if (f.hotelId) q = q.eq('hotel_id', f.hotelId);
  if (!opts.skipDate) {
    const { start, end } = dateBounds(f.from, f.to);
    if (start) q = q.gte('created_at', start);
    if (end) q = q.lt('created_at', end);
  }
  if (f.reviewStatus) q = q.eq('review_status', f.reviewStatus);
  return q;
}
