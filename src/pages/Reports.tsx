import { useFilters } from '../state/filters';
import { FilterBar } from '../components/FilterBar';
import { PageHead, Card, Notice } from '../components/ui';
import { ExportMenu } from '../components/ExportMenu';
import { useLookups } from '../hooks/data';
import { supabase } from '../lib/supabase';
import { applyStayFilters } from '../lib/filters';
import { fetchStayFacts, fetchExtFacts, fetchVerifFacts, fetchAll } from '../lib/data';
import { computeTotals, groupBy, stayBooked, stayPaid, stayBalance, MODES, num } from '../lib/finance';
import { buildRecPerf } from '../lib/recPerf';
import { classifyOtp } from '../lib/classify';
import { fmtDateTime, maskPhone } from '../lib/format';
import { istDate } from '../lib/ist';
import { env } from '../config';
import type { Row } from '../lib/export';

const STAY_COLS = 'id,guest_name,guest_phone,hotel_id,room_number,grc_number,check_in_time,current_check_out_time,checked_out_at,number_of_nights,stay_status,payment_status,total_amount,amount,amount_paid,balance_amount,receptionist_id,booking_id';
const EXT_COLS = 'id,guest_stay_id,hotel_id,receptionist_id,booking_id,previous_checkout_time,new_checkout_time,extension_nights,extension_reason,extension_amount,amount_paid,balance_amount,payment_mode,payment_status,created_at';

export function Reports() {
  const { applied } = useFilters();
  const lk = useLookups();
  const r0 = (n: number) => Math.round(n);

  const reports: { name: string; title: string; desc: string; build: () => Promise<Row[]> }[] = [
    {
      name: 'hotel-wise-revenue', title: 'Hotel-wise revenue', desc: 'Booked, collected and outstanding per hotel.',
      build: async () => {
        const [s, x] = await Promise.all([fetchStayFacts(applied), fetchExtFacts(applied)]);
        return groupBy(s.rows, x.rows, env.extIncluded, (a) => a.hotel_id, (a) => a.hotel_id).map((b) => ({
          Hotel: lk.hotelName(b.key), Stays: b.stays, 'Booked': r0(b.booked), 'Collected': r0(b.collected), 'Outstanding': r0(b.outstanding),
          'Extension booked': r0(b.extBooked), 'Extension collected': r0(b.extCollected),
        }));
      },
    },
    {
      name: 'consolidated-revenue', title: 'Consolidated revenue', desc: 'One summary of the selected hotels and period.',
      build: async () => {
        const [s, x] = await Promise.all([fetchStayFacts(applied), fetchExtFacts(applied)]);
        const t = computeTotals(s.rows, x.rows, env.extIncluded);
        return [
          { Metric: 'Stays', Value: t.stays }, { Metric: 'Stay revenue (booked)', Value: r0(t.stayBooked) }, { Metric: 'Extension revenue (booked)', Value: r0(t.extBooked) },
          { Metric: 'Gross revenue (booked)', Value: r0(t.booked) }, { Metric: 'Collected', Value: r0(t.collected) }, { Metric: 'Outstanding', Value: r0(t.outstanding) },
          { Metric: 'Collection %', Value: Number(t.collectionPct.toFixed(1)) }, { Metric: 'Fully paid stays', Value: t.paidStays },
          { Metric: 'Partially paid stays', Value: t.partialStays }, { Metric: 'Unpaid stays', Value: t.unpaidStays },
        ];
      },
    },
    {
      name: 'guest-stays', title: 'Guest stays', desc: 'Filtered stays with masked phone numbers.',
      build: async () => {
        const { rows } = await fetchAll<any>(() => applyStayFilters(supabase.from('guest_stays').select(STAY_COLS, { count: 'exact' }), applied).order('check_in_time', { ascending: false }).order('id'), 30000);
        return rows.map((r) => ({
          Guest: r.guest_name, Phone: maskPhone(r.guest_phone, '*'), Hotel: lk.hotelName(r.hotel_id), Room: r.room_number, GRC: r.grc_number,
          'Check-in': fmtDateTime(r.check_in_time), 'Current check-out': fmtDateTime(r.current_check_out_time), 'Actual check-out': fmtDateTime(r.checked_out_at),
          Nights: r.number_of_nights, 'Stay status': r.stay_status, 'Payment status': r.payment_status,
          Total: num(r.total_amount ?? r.amount), Paid: num(r.amount_paid), Balance: r.balance_amount != null ? num(r.balance_amount) : Math.max(0, num(r.total_amount ?? r.amount) - num(r.amount_paid)),
          Receptionist: lk.recName(r.receptionist_id), 'Booking ID': r.booking_id,
        }));
      },
    },
    {
      name: 'otp-verification-statistics', title: 'OTP verification statistics', desc: 'Verification outcomes per hotel.',
      build: async () => {
        const v = await fetchVerifFacts(applied);
        const m = new Map<string, any>();
        for (const r of v.rows) {
          const k = r.hotel_id ?? 'unknown';
          const e = m.get(k) ?? { Hotel: lk.hotelName(r.hotel_id), Total: 0, Verified: 0, Pending: 0, Failed: 0, Expired: 0, Other: 0 };
          e.Total++;
          const c = classifyOtp(r.otp_status);
          e[c === 'other' ? 'Other' : c[0].toUpperCase() + c.slice(1)]++;
          m.set(k, e);
        }
        return [...m.values()].map((e) => ({ ...e, 'Success %': e.Total ? Number(((e.Verified / e.Total) * 100).toFixed(1)) : 0 }));
      },
    },
    {
      name: 'payment-collections', title: 'Payment collections', desc: 'Collections by payment mode, with no double counting.',
      build: async () => {
        const [s, x] = await Promise.all([fetchStayFacts(applied), fetchExtFacts(applied)]);
        const t = computeTotals(s.rows, x.rows, env.extIncluded);
        const total = MODES.reduce((a, m) => a + t.modes[m], 0);
        return MODES.map((m) => ({ 'Payment mode': m, Collected: r0(t.modes[m]), 'Share %': total ? Number(((t.modes[m] / total) * 100).toFixed(1)) : 0 }));
      },
    },
    {
      name: 'outstanding-balances', title: 'Outstanding balances', desc: 'Stays with a balance due, largest first.',
      build: async () => {
        const s = await fetchStayFacts(applied);
        return s.rows.filter((r) => stayBalance(r) > 0.5).sort((a, b) => stayBalance(b) - stayBalance(a)).map((r) => ({
          'Stay ID': r.id, Hotel: lk.hotelName(r.hotel_id), 'Check-in date': r.check_in_time ? istDate(r.check_in_time) : '', Receptionist: lk.recName(r.receptionist_id),
          Booked: r0(stayBooked(r)), Paid: r0(stayPaid(r)), Balance: r0(stayBalance(r)), 'Payment status': r.payment_status,
        }));
      },
    },
    {
      name: 'stay-extensions', title: 'Stay extensions', desc: 'Filtered extension records.',
      build: async () => {
        const x = await fetchExtFacts(applied);
        return x.rows.map((r) => ({
          'Stay ID': r.guest_stay_id, Hotel: lk.hotelName(r.hotel_id), Receptionist: lk.recName(r.receptionist_id), Created: fmtDateTime(r.created_at),
          Nights: r.extension_nights, Amount: num(r.extension_amount), Paid: num(r.amount_paid), Balance: num(r.balance_amount), Mode: r.payment_mode, 'Payment status': r.payment_status,
        }));
      },
    },
    {
      name: 'receptionist-performance', title: 'Receptionist performance', desc: 'Verifications, stays and revenue per receptionist.',
      build: async () => {
        const [s, x, v] = await Promise.all([fetchStayFacts(applied), fetchExtFacts(applied), fetchVerifFacts(applied)]);
        const recs = lk.receptionists.filter((r) => (!applied.hotelId || r.hotel_id === applied.hotelId) && (!applied.receptionistId || r.id === applied.receptionistId));
        return buildRecPerf(recs, s.rows, x.rows, v.rows, env.extIncluded).map((r) => ({
          Receptionist: r.name, Email: r.email, Hotel: lk.hotelName(r.hotelId), Verifications: r.verifications, Successful: r.verified,
          'Guest stays': r.stays, 'Revenue (booked)': r0(r.booked), Collected: r0(r.collected),
        }));
      },
    },
  ];

  return (
    <>
      <PageHead title="Reports" sub="Every export uses the filters below and the same access rules and masking as the screens. OTP hashes and ID-proof details are never exported." />
      <FilterBar fields={['preset', 'paymentStatus', 'paymentMode', 'receptionistId', 'stayStatus']} />
      <Notice tone="info">Exports run the same server-side queries as the dashboard, limited to the hotels this account is allowed to read.</Notice>
      <div className="grid two">
        {reports.map((r) => (
          <Card key={r.name} title={r.title} right={<ExportMenu name={r.name} title={r.title} getRows={r.build} />}>
            <span className="muted">{r.desc}</span>
          </Card>
        ))}
      </div>
    </>
  );
}
