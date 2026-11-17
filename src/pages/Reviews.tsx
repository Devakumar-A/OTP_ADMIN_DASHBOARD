import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilters } from '../state/filters';
import { FilterBar } from '../components/FilterBar';
import { PageHead, Card, DataTable, Col, Kpi, Loading, Notice } from '../components/ui';
import { Bars, Donut } from '../components/Charts';
import { ExportMenu } from '../components/ExportMenu';
import { useLookups, usePaged, useFollowFacts } from '../hooks/data';
import { supabase } from '../lib/supabase';
import { applyFollowFilters } from '../lib/filters';
import { fetchAll } from '../lib/data';
import { fmtDateTime, int, dash, likeEscape } from '../lib/format';

const COLS = 'id,guest_stay_id,hotel_id,review_status,contacted_at,notes,created_at';

/** Guest names come from guest_stays via guest_stay_id, fetched once per page (no N+1). */
async function stayNames(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const { data, error } = await supabase.from('guest_stays').select('id,guest_name,room_number').in('id', ids);
  if (error) throw error;
  return new Map<string, string>((data ?? []).map((s: any) => [s.id, `${s.guest_name ?? '—'}${s.room_number ? ` · Room ${s.room_number}` : ''}`]));
}

export function Reviews() {
  const { applied } = useFilters();
  const lk = useLookups();
  const facts = useFollowFacts(applied);

  // Guest-name filter: resolve matching stay ids first, then filter follow-ups by them.
  const nameIds = useQuery({
    queryKey: ['reviewNameIds', applied.guestName],
    enabled: !!applied.guestName.trim(),
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('guest_stays').select('id').ilike('guest_name', `%${likeEscape(applied.guestName)}%`).limit(1000);
      if (error) throw error;
      return (data ?? []).map((r: any) => r.id as string);
    },
  });
  const nameFilter = applied.guestName.trim() ? (nameIds.data ?? []) : null;
  const nameReady = !applied.guestName.trim() || nameIds.isSuccess;

  const p = usePaged<any>(['reviews', applied, nameFilter], (from, to) => {
    let q = applyFollowFilters(supabase.from('review_followups').select(COLS, { count: 'exact' }), applied);
    if (nameFilter) q = nameFilter.length ? q.in('guest_stay_id', nameFilter) : q.eq('guest_stay_id', '00000000-0000-0000-0000-000000000000');
    return q.order('created_at', { ascending: false }).order('id').range(from, to);
  });
  const ids = p.rows.map((r) => r.guest_stay_id).filter(Boolean);
  const names = useQuery({ queryKey: ['reviewStayNames', ids], enabled: ids.length > 0, staleTime: 60 * 1000, queryFn: () => stayNames(ids) });

  const stats = useMemo(() => {
    const byStatus = new Map<string, number>();
    const byHotel = new Map<string, number>();
    for (const r of facts.data?.rows ?? []) {
      const s = String(r.review_status ?? 'unknown');
      byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
      const h = lk.hotelName(r.hotel_id);
      byHotel.set(h, (byHotel.get(h) ?? 0) + 1);
    }
    return {
      total: facts.data?.rows.length ?? 0,
      status: [...byStatus].map(([name, value]) => ({ name, value })),
      hotel: [...byHotel].map(([name, Follow_ups]) => ({ name, Follow_ups })).sort((a, b) => b.Follow_ups - a.Follow_ups),
    };
  }, [facts.data, lk]);

  const cols: Col<any>[] = [
    { key: 'g', header: 'Guest', render: (r) => (names.data?.get(r.guest_stay_id) ?? (names.isLoading ? '…' : '—')) },
    { key: 'h', header: 'Hotel', render: (r) => lk.hotelName(r.hotel_id) },
    { key: 's', header: 'Guest stay', render: (r) => <span title={r.guest_stay_id}>{String(r.guest_stay_id ?? '—').slice(0, 8)}</span> },
    { key: 'rs', header: 'Review status', render: (r) => dash(r.review_status) },
    { key: 'c', header: 'Contacted at', render: (r) => fmtDateTime(r.contacted_at) },
    { key: 'n', header: 'Notes', render: (r) => <span style={{ whiteSpace: 'normal', display: 'inline-block', maxWidth: 360 }}>{dash(r.notes)}</span> },
    { key: 'ca', header: 'Created', render: (r) => fmtDateTime(r.created_at) },
  ];

  const getRows = async () => {
    let make = () => {
      let q = applyFollowFilters(supabase.from('review_followups').select(COLS, { count: 'exact' }), applied);
      if (nameFilter) q = nameFilter.length ? q.in('guest_stay_id', nameFilter) : q.eq('guest_stay_id', '00000000-0000-0000-0000-000000000000');
      return q.order('created_at', { ascending: false }).order('id');
    };
    const { rows } = await fetchAll<any>(make, 30000);
    const nm = await stayNames([...new Set(rows.map((r) => r.guest_stay_id).filter(Boolean))].slice(0, 1000));
    return rows.map((r) => ({
      Guest: nm.get(r.guest_stay_id) ?? '', Hotel: lk.hotelName(r.hotel_id), 'Guest stay': r.guest_stay_id, 'Review status': r.review_status,
      'Contacted at': fmtDateTime(r.contacted_at), Notes: r.notes, Created: fmtDateTime(r.created_at),
    }));
  };

  return (
    <>
      <PageHead title="Review follow-ups" sub="Read-only monitoring of follow-up records." right={<ExportMenu name="review-followups" title="Review follow-ups" getRows={getRows} />} />
      <FilterBar fields={['preset', 'reviewStatus', 'guestName']} />
      <div className="grid kpis"><Kpi label="Follow-ups in view" value={int(stats.total)} /></div>
      <div className="grid two">
        <Card title="By review status">{facts.isLoading ? <Loading /> : <Donut money={false} data={stats.status} />}</Card>
        <Card title="Hotel-wise comparison">{facts.isLoading ? <Loading /> : <Bars money={false} horizontal data={stats.hotel} series={[{ key: 'Follow_ups', label: 'Follow-ups' }]} />}</Card>
      </div>
      {nameIds.isError ? <Notice tone="warn">Guest-name search is unavailable: this account cannot read guest stays.</Notice> : null}
      <Card flush>
        <DataTable cols={cols} rows={p.rows} loading={p.loading || !nameReady} error={p.error} page={p.page} pageSize={p.pageSize} total={p.total} onPage={p.setPage} rowKey={(r) => r.id} />
      </Card>
    </>
  );
}
