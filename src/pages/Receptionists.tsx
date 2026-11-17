import { useMemo } from 'react';
import { useFilters } from '../state/filters';
import { FilterBar } from '../components/FilterBar';
import { PageHead, Card, DataTable, Badge, Col, Loading, ErrorBox } from '../components/ui';
import { Bars } from '../components/Charts';
import { ExportMenu } from '../components/ExportMenu';
import { useLookups, useStayFacts, useExtFacts, useVerifFacts } from '../hooks/data';
import { buildRecPerf, RecPerf } from '../lib/recPerf';
import { inr, int, pct } from '../lib/format';
import { env } from '../config';

const statusView = (s: any) => {
  if (s === true) return <Badge tone="good">Active</Badge>;
  if (s === false) return <Badge tone="muted">Inactive</Badge>;
  const t = String(s ?? '').toLowerCase();
  return <Badge tone={['active', 'enabled'].includes(t) ? 'good' : 'muted'}>{s ?? '—'}</Badge>;
};

export function Receptionists() {
  const { applied } = useFilters();
  const lk = useLookups();
  const stays = useStayFacts(applied);
  const exts = useExtFacts(applied);
  const verifs = useVerifFacts(applied);

  const rows = useMemo(() => {
    const visible = lk.receptionists.filter((r) => (!applied.hotelId || r.hotel_id === applied.hotelId) && (!applied.receptionistId || r.id === applied.receptionistId));
    return buildRecPerf(visible, stays.data?.rows ?? [], exts.data?.rows ?? [], verifs.data?.rows ?? [], env.extIncluded)
      .sort((a, b) => b.collected - a.collected);
  }, [lk.receptionists, applied.hotelId, applied.receptionistId, stays.data, exts.data, verifs.data]);

  const loading = lk.loading || stays.isLoading || exts.isLoading || verifs.isLoading;
  const chart = rows.filter((r) => r.stays || r.verifications).slice(0, 15).map((r) => ({ name: r.name, Booked: r.booked, Collected: r.collected }));

  const cols: Col<RecPerf>[] = [
    { key: 'n', header: 'Receptionist', render: (r) => <strong>{r.name}</strong> },
    { key: 'e', header: 'Email', render: (r) => r.email },
    { key: 'h', header: 'Hotel', render: (r) => lk.hotelName(r.hotelId) },
    { key: 's', header: 'Account', render: (r) => statusView(r.status) },
    { key: 'v', header: 'Verifications', align: 'r', render: (r) => int(r.verifications) },
    { key: 'vs', header: 'Successful', align: 'r', render: (r) => `${int(r.verified)} (${pct(r.verifications ? (r.verified / r.verifications) * 100 : 0)})` },
    { key: 'st', header: 'Guest stays', align: 'r', render: (r) => int(r.stays) },
    { key: 'b', header: 'Revenue (booked)', align: 'r', render: (r) => inr(r.booked) },
    { key: 'c', header: 'Collected', align: 'r', render: (r) => inr(r.collected) },
  ];

  const getRows = () => rows.map((r) => ({
    Receptionist: r.name, Email: r.email, Hotel: lk.hotelName(r.hotelId), Account: String(r.status ?? ''), Verifications: r.verifications,
    Successful: r.verified, 'Guest stays': r.stays, 'Revenue (booked)': Math.round(r.booked), Collected: Math.round(r.collected),
  }));

  return (
    <>
      <PageHead title="Receptionists" sub="Performance for the selected period. Revenue follows the receptionist who created each stay." right={<ExportMenu name="receptionist-performance" title="Receptionist performance" getRows={getRows} disabled={loading} />} />
      <FilterBar fields={['preset', 'receptionistId']} />
      {lk.error || stays.error || verifs.error ? <ErrorBox error={lk.error || stays.error || verifs.error} /> : null}
      <Card title="Performance comparison (top 15 by collected)">{loading ? <Loading /> : <Bars horizontal data={chart} series={[{ key: 'Booked', label: 'Booked' }, { key: 'Collected', label: 'Collected' }]} />}</Card>
      <Card flush><DataTable cols={cols} rows={rows} loading={loading} rowKey={(r) => r.id} empty="No receptionists visible for these filters." /></Card>
    </>
  );
}
