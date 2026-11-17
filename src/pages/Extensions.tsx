import { useMemo } from 'react';
import { useFilters } from '../state/filters';
import { FilterBar } from '../components/FilterBar';
import { PageHead, Card, DataTable, Badge, Col, Kpi, Loading } from '../components/ui';
import { Bars } from '../components/Charts';
import { ExportMenu } from '../components/ExportMenu';
import { useLookups, usePaged, useExtFacts } from '../hooks/data';
import { supabase } from '../lib/supabase';
import { applyExtFilters } from '../lib/filters';
import { fetchAll } from '../lib/data';
import { classifyPayment, payTone } from '../lib/classify';
import { num } from '../lib/finance';
import { fmtDateTime, inr, int, dash } from '../lib/format';

const COLS = 'id,guest_stay_id,hotel_id,receptionist_id,booking_id,previous_checkout_time,new_checkout_time,extension_nights,extension_reason,extension_amount,amount_paid,balance_amount,payment_mode,payment_status,created_at';

export function Extensions() {
  const { applied } = useFilters();
  const lk = useLookups();
  const facts = useExtFacts(applied);
  const p = usePaged<any>(['ext', applied], (from, to) =>
    applyExtFilters(supabase.from('stay_extensions').select(COLS, { count: 'exact' }), applied).order('created_at', { ascending: false }).order('id').range(from, to),
  );

  const kpi = useMemo(() => {
    const r = facts.data?.rows ?? [];
    return {
      n: r.length, nights: r.reduce((a, x) => a + num(x.extension_nights), 0),
      amount: r.reduce((a, x) => a + num(x.extension_amount), 0), paid: r.reduce((a, x) => a + num(x.amount_paid), 0), bal: r.reduce((a, x) => a + num(x.balance_amount), 0),
    };
  }, [facts.data]);

  const byHotel = useMemo(() => {
    const m = new Map<string, { name: string; Charged: number; Collected: number }>();
    for (const x of facts.data?.rows ?? []) {
      const k = x.hotel_id ?? 'unknown';
      const e = m.get(k) ?? { name: lk.hotelName(x.hotel_id), Charged: 0, Collected: 0 };
      e.Charged += num(x.extension_amount);
      e.Collected += num(x.amount_paid);
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.Charged - a.Charged);
  }, [facts.data, lk]);

  const cols: Col<any>[] = [
    { key: 'sid', header: 'Stay ID', render: (r) => <span title={r.guest_stay_id}>{String(r.guest_stay_id ?? '—').slice(0, 8)}</span> },
    { key: 'h', header: 'Hotel', render: (r) => lk.hotelName(r.hotel_id) },
    { key: 'rc', header: 'Receptionist', render: (r) => lk.recName(r.receptionist_id) },
    { key: 'bk', header: 'Booking ID', render: (r) => dash(r.booking_id) },
    { key: 'pc', header: 'Previous check-out', render: (r) => fmtDateTime(r.previous_checkout_time) },
    { key: 'nc', header: 'New check-out', render: (r) => fmtDateTime(r.new_checkout_time) },
    { key: 'n', header: 'Nights', align: 'r', render: (r) => int(r.extension_nights) },
    { key: 'rs', header: 'Reason', render: (r) => dash(r.extension_reason) },
    { key: 'a', header: 'Amount', align: 'r', render: (r) => inr(r.extension_amount) },
    { key: 'p', header: 'Paid', align: 'r', render: (r) => inr(r.amount_paid) },
    { key: 'b', header: 'Balance', align: 'r', render: (r) => inr(r.balance_amount) },
    { key: 'pm', header: 'Mode', render: (r) => dash(r.payment_mode) },
    { key: 'ps', header: 'Payment status', render: (r) => <Badge tone={payTone[classifyPayment(num(r.extension_amount), num(r.amount_paid), num(r.balance_amount))]}>{dash(r.payment_status)}</Badge> },
    { key: 'ca', header: 'Created', render: (r) => fmtDateTime(r.created_at) },
  ];

  const getRows = async () => {
    const { rows } = await fetchAll<any>(() => applyExtFilters(supabase.from('stay_extensions').select(COLS, { count: 'exact' }), applied).order('created_at', { ascending: false }).order('id'), 30000);
    return rows.map((r) => ({
      'Stay ID': r.guest_stay_id, Hotel: lk.hotelName(r.hotel_id), Receptionist: lk.recName(r.receptionist_id), 'Booking ID': r.booking_id,
      'Previous check-out': fmtDateTime(r.previous_checkout_time), 'New check-out': fmtDateTime(r.new_checkout_time), Nights: r.extension_nights, Reason: r.extension_reason,
      Amount: num(r.extension_amount), Paid: num(r.amount_paid), Balance: num(r.balance_amount), Mode: r.payment_mode, 'Payment status': r.payment_status, Created: fmtDateTime(r.created_at),
    }));
  };

  return (
    <>
      <PageHead title="Stay extensions" sub="Dated by extension creation (IST). Guest-level filters do not apply to extensions." right={<ExportMenu name="stay-extensions" title="Stay extensions" getRows={getRows} />} />
      <FilterBar fields={['preset', 'paymentStatus', 'receptionistId', 'bookingId']} />
      <div className="grid kpis">
        <Kpi label="Extensions" value={int(kpi.n)} sub={`${int(kpi.nights)} nights`} />
        <Kpi label="Extension amount" value={inr(kpi.amount)} />
        <Kpi label="Collected" value={inr(kpi.paid)} tone="good" />
        <Kpi label="Outstanding" value={inr(kpi.bal)} tone={kpi.bal > 0 ? 'warn' : undefined} />
      </div>
      <Card title="Hotel-wise extension revenue">{facts.isLoading ? <Loading /> : <Bars horizontal data={byHotel} series={[{ key: 'Charged', label: 'Charged' }, { key: 'Collected', label: 'Collected' }]} />}</Card>
      <Card flush>
        <DataTable cols={cols} rows={p.rows} loading={p.loading} error={p.error} page={p.page} pageSize={p.pageSize} total={p.total} onPage={p.setPage} rowKey={(r) => r.id} />
      </Card>
    </>
  );
}
