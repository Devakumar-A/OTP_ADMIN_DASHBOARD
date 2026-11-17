import { useMemo } from 'react';
import { useFilters } from '../state/filters';
import { PageHead, Card, DataTable, Badge, Col, ErrorBox } from '../components/ui';
import { ExportMenu } from '../components/ExportMenu';
import { useLookups, useStayFacts, useExtFacts, useActiveStays } from '../hooks/data';
import { defaultFilters } from '../lib/filters';
import { groupBy } from '../lib/finance';
import { classifyStay } from '../lib/classify';
import { istDate, istToday } from '../lib/ist';
import { inr, int } from '../lib/format';
import { env } from '../config';

interface Row {
  id: string; name: string; code: string; status: any; stays: number; active: number; ins: number; outs: number;
  booked: number; collected: number; outstanding: number; recs: number;
}

const statusView = (s: any) => {
  if (s === true) return <Badge tone="good">Active</Badge>;
  if (s === false) return <Badge tone="muted">Inactive</Badge>;
  const t = String(s ?? '').toLowerCase();
  return <Badge tone={['active', 'open', 'enabled', 'live'].includes(t) ? 'good' : 'muted'}>{s ?? '—'}</Badge>;
};

export function Hotels() {
  const { applied, setHotel } = useFilters();
  // The hotel overview is all-time and ignores the period/guest filters, so it is a stable reference table.
  const base = useMemo(() => ({ ...defaultFilters(), hotelId: '' }), []);
  const lk = useLookups();
  const stays = useStayFacts(base, true);
  const exts = useExtFacts(base, true);
  const active = useActiveStays('');

  const rows: Row[] = useMemo(() => {
    const today = istToday();
    const fin = groupBy(stays.data?.rows ?? [], exts.data?.rows ?? [], env.extIncluded, (s) => s.hotel_id, (x) => x.hotel_id);
    const finMap = new Map(fin.map((b) => [b.key, b]));
    const cnt = new Map<string, { ins: number; outs: number }>();
    for (const s of stays.data?.rows ?? []) {
      if (!s.hotel_id) continue;
      const c = cnt.get(s.hotel_id) ?? { ins: 0, outs: 0 };
      if (s.check_in_time && istDate(s.check_in_time) === today) c.ins++;
      if (s.checked_out_at && istDate(s.checked_out_at) === today) c.outs++;
      cnt.set(s.hotel_id, c);
    }
    const act = new Map<string, number>();
    for (const a of active.data?.active ?? []) if (a.hotel_id) act.set(a.hotel_id, (act.get(a.hotel_id) ?? 0) + 1);
    return lk.hotels.map((h) => {
      const b = finMap.get(h.id);
      return {
        id: h.id, name: h.hotel_name, code: h.hotel_code ?? '—', status: h.status,
        stays: b?.stays ?? 0, active: act.get(h.id) ?? 0, ins: cnt.get(h.id)?.ins ?? 0, outs: cnt.get(h.id)?.outs ?? 0,
        booked: b?.booked ?? 0, collected: b?.collected ?? 0, outstanding: b?.outstanding ?? 0,
        recs: lk.receptionists.filter((r) => r.hotel_id === h.id).length,
      };
    });
  }, [lk.hotels, lk.receptionists, stays.data, exts.data, active.data]);

  const cols: Col<Row>[] = [
    { key: 'name', header: 'Hotel', render: (r) => <strong>{r.name}</strong> },
    { key: 'code', header: 'Code', render: (r) => r.code },
    { key: 'status', header: 'Status', render: (r) => statusView(r.status) },
    { key: 'stays', header: 'Total stays', align: 'r', render: (r) => int(r.stays) },
    { key: 'active', header: 'Active', align: 'r', render: (r) => int(r.active) },
    { key: 'ins', header: 'Check-ins today', align: 'r', render: (r) => int(r.ins) },
    { key: 'outs', header: 'Check-outs today', align: 'r', render: (r) => int(r.outs) },
    { key: 'booked', header: 'Revenue (booked)', align: 'r', render: (r) => inr(r.booked) },
    { key: 'collected', header: 'Collected', align: 'r', render: (r) => inr(r.collected) },
    { key: 'outstanding', header: 'Outstanding', align: 'r', render: (r) => inr(r.outstanding) },
    { key: 'recs', header: 'Receptionists', align: 'r', render: (r) => int(r.recs) },
    { key: 'sel', header: '', render: (r) => <button className="btn sm" onClick={() => setHotel(r.id)} disabled={applied.hotelId === r.id}>{applied.hotelId === r.id ? 'Selected' : 'Select'}</button> },
  ];

  const loading = lk.loading || stays.isLoading || exts.isLoading;
  const exportRows = () => rows.map((r) => ({
    Hotel: r.name, Code: r.code, 'Total stays': r.stays, 'Active stays': r.active, 'Check-ins today': r.ins, 'Check-outs today': r.outs,
    'Revenue (booked)': Math.round(r.booked), Collected: Math.round(r.collected), Outstanding: Math.round(r.outstanding), Receptionists: r.recs,
  }));

  return (
    <>
      <PageHead title="Hotels" sub="All-time figures for every hotel this account can read. Select a hotel to filter the rest of the dashboard." right={<ExportMenu name="hotels" title="Hotel summary" getRows={exportRows} disabled={loading} />} />
      {stays.error || exts.error ? <ErrorBox error={stays.error || exts.error} /> : null}
      <Card flush>
        <DataTable cols={cols} rows={rows} loading={loading} rowKey={(r) => r.id} empty="No hotels are visible to this account." />
      </Card>
    </>
  );
}
