import { STATUS } from '../config';

const norm = (s: any) => String(s ?? '').trim().toLowerCase();
const has = (list: string[], v: any) => list.map(norm).includes(norm(v));

export type OtpClass = 'verified' | 'pending' | 'failed' | 'expired' | 'other';
export function classifyOtp(status: any): OtpClass {
  if (has(STATUS.otp.verified, status)) return 'verified';
  if (has(STATUS.otp.failed, status)) return 'failed';
  if (has(STATUS.otp.expired, status)) return 'expired';
  if (has(STATUS.otp.pending, status)) return 'pending';
  return 'other';
}

export type StayClass = 'active' | 'checked_out' | 'cancelled' | 'unknown';

/**
 * Status text classification.
 * Unknown statuses must NOT default to active: they return 'unknown'.
 */
export function classifyStay(status: any, checkedOutAt?: any): StayClass {
  if (has(STATUS.stay.cancelled, status)) return 'cancelled';
  if (has(STATUS.stay.checkedOut, status)) return 'checked_out';
  if (has(STATUS.stay.active, status)) return 'active';
  if (checkedOutAt) return 'checked_out';
  return 'unknown';
}

export type PayClass = 'paid' | 'partial' | 'unpaid';
export function classifyPayment(total: number, paid: number, balance: number): PayClass {
  if (paid <= 0) return 'unpaid';
  if (balance <= 0.5) return 'paid';
  return 'partial';
}

export type Tone = 'good' | 'warn' | 'bad' | 'muted' | 'info';
export const otpTone: Record<OtpClass, Tone> = {
  verified: 'good',
  pending: 'warn',
  failed: 'bad',
  expired: 'muted',
  other: 'info',
};
export const stayTone: Record<StayClass, Tone> = {
  active: 'info',
  checked_out: 'muted',
  cancelled: 'bad',
  unknown: 'warn',
};
export const payTone: Record<PayClass, Tone> = {
  paid: 'good',
  partial: 'warn',
  unpaid: 'bad',
};
