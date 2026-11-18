import { useState } from 'react';
import { useFilters } from '../state/filters';
import { FilterBar } from '../components/FilterBar';
import { PageHead, Card } from '../components/ui';
import { ExportMenu } from '../components/ExportMenu';
import { useLookups } from '../hooks/data';
import { supabase } from '../lib/supabase';
import { applyStayFilters } from '../lib/filters';
import { fetchStayFacts, fetchExtFacts, fetchVerifFacts, fetchAll } from '../lib/data';
import { computeTotals, groupBy, stayBooked, stayPaid, stayBalance, MODES, num } from '../lib/finance';
import { classifyOtp } from '../lib/classify';
import { fmtDateTime, maskPhone, formatDateRangeWords } from '../lib/format';
import { istDate } from '../lib/ist';
import { buildHotelDateMatrix } from '../lib/matrix';
import {
  exportRevenueWorkbook,
  exportRevenuePdf,
  exportUnpaidGuestsPdf,
  exportCheckInReportPdf,
  Row,
} from '../lib/export';
import { buildUnpaidGuests } from '../lib/revenueCalculations';

const STAY_COLS =
  'id,guest_name,guest_phone,hotel_id,room_number,grc_number,check_in_time,current_check_out_time,checked_out_at,number_of_nights,number_of_guests,number_of_rooms,stay_status,payment_status,payment_mode,total_amount,amount,amount_paid,balance_amount,receptionist_id,booking_id';

export function Reports() {
  const { applied } = useFilters();
  const lk = useLookups();
  const [exporting, setExporting] = useState(false);

  const r0 = (n: number) => Math.round(n);

  const fromYmd = applied.from ? istDate(applied.from) : 'start';
  const toYmd = applied.to ? istDate(applied.to) : 'now';
  const hotelFilterName = applied.hotelId ? lk.hotelName(applied.hotelId) : 'All accessible hotels';

  const handleFullWorkbook = async () => {
    setExporting(true);
    try {
      const [s, x] = await Promise.all([fetchStayFacts(applied), fetchExtFacts(applied)]);
      const totals = computeTotals(s.rows, x.rows);
      const matrix = buildHotelDateMatrix(s.rows, lk.hotels, applied.from, applied.to);

      await exportRevenueWorkbook({
        fromYmd,
        toYmd,
        hotelFilterName,
        totals,
        matrix,
        stays: s.rows,
        exts: x.rows,
        hotelNameLookup: (id) => lk.hotelName(id),
        recNameLookup: (id) => lk.recName(id),
      });
    } catch (err) {
      console.error('Export workbook failed:', err);
      alert('Could not generate full workbook. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleFullPdf = async () => {
    setExporting(true);
    try {
      const [s, x] = await Promise.all([fetchStayFacts(applied), fetchExtFacts(applied)]);
      const totals = computeTotals(s.rows, x.rows);
      const matrix = buildHotelDateMatrix(s.rows, lk.hotels, applied.from, applied.to);

      await exportRevenuePdf({
        fromYmd,
        toYmd,
        hotelFilterName,
        totals,
        matrix,
        stays: s.rows,
        exts: x.rows,
        hotelNameLookup: (id) => lk.hotelName(id),
        recNameLookup: (id) => lk.recName(id),
      });
    } catch (err) {
      console.error('Export PDF failed:', err);
      alert('Could not generate PDF. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleUnpaidPdf = async () => {
    setExporting(true);
    try {
      const s = await fetchStayFacts(applied);
      const unpaid = buildUnpaidGuests(s.rows, lk.hotelName, lk.recName);
      await exportUnpaidGuestsPdf({
        unpaidList: unpaid.unpaidList,
        totalOutstanding: unpaid.totalOutstanding,
        checkedOutOutstanding: unpaid.checkedOutOutstanding,
        hotelFilterName,
        fromYmd,
        toYmd,
      });
    } catch (err) {
      console.error('Export Unpaid PDF failed:', err);
      alert('Could not generate Unpaid PDF.');
    } finally {
      setExporting(false);
    }
  };

  const handleCheckInPdf = async () => {
    setExporting(true);
    try {
      const s = await fetchStayFacts(applied);
      const matrix = buildHotelDateMatrix(s.rows, lk.hotels, applied.from, applied.to);
      await exportCheckInReportPdf({
        matrix,
        hotelFilterName,
        fromYmd,
        toYmd,
      });
    } catch (err) {
      console.error('Export Check-in PDF failed:', err);
      alert('Could not generate Check-in PDF.');
    } finally {
      setExporting(false);
    }
  };

  const reports: { name: string; title: string; desc: string; build: () => Promise<Row[]> }[] = [
    {
      name: 'hotel-wise-revenue',
      title: 'Hotel-wise check-ins & revenue',
      desc: 'Check-in counts, total booked, collected and outstanding per hotel.',
      build: async () => {
        const [s, x] = await Promise.all([fetchStayFacts(applied), fetchExtFacts(applied)]);
        return groupBy(s.rows, x.rows, (a) => a.hotel_id, (a) => a.hotel_id).map((b) => ({
          Hotel: lk.hotelName(b.key),
          'Check-ins': b.stays,
          Booked: r0(b.booked),
          Collected: r0(b.collected),
          Outstanding: r0(b.outstanding),
          'Extensions Count': b.extBooked > 0 ? 1 : 0,
        }));
      },
    },
    {
      name: 'consolidated-operations',
      title: 'Consolidated operations summary',
      desc: 'Key operational KPIs, revenue, collections, and stay breakdowns.',
      build: async () => {
        const [s, x] = await Promise.all([fetchStayFacts(applied), fetchExtFacts(applied)]);
        const t = computeTotals(s.rows, x.rows);
        return [
          { Metric: 'Total Check-ins (Stays)', Value: t.stays },
          { Metric: 'Gross Revenue (Booked)', Value: r0(t.booked) },
          { Metric: 'Total Collected', Value: r0(t.collected) },
          { Metric: 'Outstanding Balance', Value: r0(t.outstanding) },
          { Metric: 'Collection Rate (%)', Value: Number(t.collectionPct.toFixed(1)) },
          { Metric: 'Fully Paid Stays', Value: t.paidStays },
          { Metric: 'Partially Paid Stays', Value: t.partialStays },
          { Metric: 'Unpaid Stays', Value: t.unpaidStays },
          { Metric: 'Extensions Count', Value: t.extensions },
          { Metric: 'Extensions Amount', Value: r0(t.extBooked) },
        ];
      },
    },
    {
      name: 'guest-stays-summary',
      title: 'Filtered guest stays export',
      desc: 'All matching guest stays with masked phone numbers for privacy.',
      build: async () => {
        const { rows } = await fetchAll<any>(
          () =>
            applyStayFilters(supabase.from('guest_stays').select(STAY_COLS, { count: 'exact' }), applied)
              .order('check_in_time', { ascending: false })
              .order('id'),
          30000,
        );
        return rows.map((r) => ({
          GRC: r.grc_number || r.id.slice(0, 8),
          Guest: r.guest_name,
          Phone: maskPhone(r.guest_phone, '*'),
          Hotel: lk.hotelName(r.hotel_id),
          Room: r.room_number,
          'Check-in': fmtDateTime(r.check_in_time),
          'Expected check-out': fmtDateTime(r.current_check_out_time),
          'Actual check-out': fmtDateTime(r.checked_out_at),
          Nights: r.number_of_nights,
          'Stay status': r.stay_status,
          'Payment status': r.payment_status,
          Total: num(r.total_amount ?? r.amount),
          Paid: num(r.amount_paid),
          Balance:
            r.balance_amount != null
              ? num(r.balance_amount)
              : Math.max(0, num(r.total_amount ?? r.amount) - num(r.amount_paid)),
          Receptionist: lk.recName(r.receptionist_id),
          'Booking ID': r.booking_id,
        }));
      },
    },
    {
      name: 'payment-collections',
      title: 'Payment collection breakdown',
      desc: 'Collections by payment mode (Cash, GPay, Card, Online), with no double counting.',
      build: async () => {
        const [s, x] = await Promise.all([fetchStayFacts(applied), fetchExtFacts(applied)]);
        const t = computeTotals(s.rows, x.rows);
        const total = MODES.reduce((a, m) => a + t.modes[m], 0);
        return MODES.map((m) => ({
          'Payment mode': m,
          Collected: r0(t.modes[m]),
          'Share %': total ? Number(((t.modes[m] / total) * 100).toFixed(1)) : 0,
        }));
      },
    },
    {
      name: 'outstanding-balances',
      title: 'Outstanding balances register',
      desc: 'All stays with an outstanding balance due, sorted largest balance first.',
      build: async () => {
        const s = await fetchStayFacts(applied);
        return s.rows
          .filter((r) => stayBalance(r) > 0.5)
          .sort((a, b) => stayBalance(b) - stayBalance(a))
          .map((r) => ({
            'GRC Number': r.booking_id || r.id.slice(0, 8),
            Hotel: lk.hotelName(r.hotel_id),
            'Check-in date': r.check_in_time ? istDate(r.check_in_time) : '',
            Receptionist: lk.recName(r.receptionist_id),
            Booked: r0(stayBooked(r)),
            Paid: r0(stayPaid(r)),
            Balance: r0(stayBalance(r)),
            'Payment status': r.payment_status,
          }));
      },
    },
    {
      name: 'guest-verification-outcomes',
      title: 'Guest verification summary',
      desc: 'Aggregated verification outcomes per hotel for the filtered period.',
      build: async () => {
        const v = await fetchVerifFacts(applied);
        const m = new Map<string, any>();
        for (const r of v.rows) {
          const k = r.hotel_id ?? 'unknown';
          const e =
            m.get(k) ?? {
              Hotel: lk.hotelName(r.hotel_id),
              Total: 0,
              Verified: 0,
              Pending: 0,
              Failed: 0,
              Expired: 0,
              Other: 0,
            };
          e.Total++;
          const c = classifyOtp(r.otp_status);
          e[c === 'other' ? 'Other' : c[0].toUpperCase() + c.slice(1)]++;
          m.set(k, e);
        }
        return [...m.values()].map((e) => ({
          ...e,
          'Success %': e.Total ? Number(((e.Verified / e.Total) * 100).toFixed(1)) : 0,
        }));
      },
    },
  ];

  return (
    <>
      <PageHead
        title="Operations &amp; Financial Reports"
        sub="Standard audit, operations and compliance reports. Applies the active date range and hotel filters."
        right={
          <div className="fact" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={handleFullWorkbook} disabled={exporting}>
              📊 Full Workbook (.xlsx)
            </button>
            <button className="btn" onClick={handleFullPdf} disabled={exporting}>
              📑 Revenue Report (PDF)
            </button>
            <button className="btn" onClick={handleUnpaidPdf} disabled={exporting}>
              💰 Unpaid Guests (PDF)
            </button>
            <button className="btn" onClick={handleCheckInPdf} disabled={exporting}>
              📅 Check-Ins Matrix (PDF)
            </button>
          </div>
        }
      />

      <FilterBar />

      <div className="grid two" style={{ marginTop: 12 }}>
        {reports.map((r) => (
          <Card key={r.name} title={r.title}>
            <p className="muted" style={{ minHeight: 38, fontSize: 13 }}>
              {r.desc}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <ExportMenu name={r.name} title={r.title} getRows={r.build} />
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
