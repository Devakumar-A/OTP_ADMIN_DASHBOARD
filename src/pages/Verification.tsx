import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilters } from '../state/filters';
import { FilterBar } from '../components/FilterBar';
import { PageHead, Card, DataTable, Badge, Col, Kpi, Notice } from '../components/ui';
import { ExportMenu } from '../components/ExportMenu';
import { useLookups, usePaged, useVerifFacts } from '../hooks/data';
import { supabase } from '../lib/supabase';
import { applyVerifFilters } from '../lib/filters';
import { fetchAll } from '../lib/data';
import { classifyOtp, otpTone } from '../lib/classify';
import { fmtDateTime, int, pct, maskPhone, dash } from '../lib/format';

// Only monitoring columns. No OTP value or hash is ever selected.
const COLS = 'id,guest_name,guest_phone,hotel_id,receptionist_id,check_in_time,otp_status,verified_at,review_status,created_at';
const LABEL = { verified: 'Verified', pending: 'Pending', failed: 'Failed', expired: 'Expired', other: '' } as const;

export function Verification() {
  const { applied } = useFilters();
  const lk = useLookups();
  const [showPhone, setShowPhone] = useState(false);
  const facts = useVerifFacts(applied);

  const p = usePaged<any>(['verif', applied], (from, to) =>
    applyVerifFilters(supabase.from('guest_verifications').select(COLS, { count: 'exact' }), applied).order('created_at', { ascending: false }).order('id').range(from, to),
  );

  // One batched query for the visible page (no N+1). Reads counts only: the otp_hash column is never requested.
  const ids = p.rows.map((r) => r.id);
  const attempts = useQuery({
    queryKey: ['otpAttempts', ids],
    enabled: ids.length > 0,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('otp_attempts').select('verification_id,attempts').in('verification_id', ids);
      if (error) throw error;
      const m = new Map<string, { sent: number; tries: number }>();
      for (const a of data ?? []) {
        const c = m.get(a.verification_id) ?? { sent: 0, tries: 0 };
        c.sent += 1;
        c.tries += Number(a.attempts) || 0;
        m.set(a.verification_id, c);
      }
      return m;
    },
  });

  const stats = useMemo(() => {
    const c = { verified: 0, pending: 0, failed: 0, expired: 0, other: 0 };
    (facts.data?.rows ?? []).forEach((r) => { c[classifyOtp(r.otp_status)]++; });
    const total = facts.data?.rows.length ?? 0;
    return { ...c, total, rate: total ? (c.verified / total) * 100 : 0 };
  }, [facts.data]);

  const att = (id: string) => (attempts.data ? attempts.data.get(id) : undefined);

  const cols: Col<any>[] = [
    { key: 'g', header: 'Guest', render: (r) => r.guest_name ?? '—' },
    { key: 'ph', header: 'Phone', render: (r) => (showPhone ? dash(r.guest_phone) : maskPhone(r.guest_phone)) },
    { key: 'h', header: 'Hotel', render: (r) => lk.hotelName(r.hotel_id) },
    { key: 'rc', header: 'Receptionist', render: (r) => lk.recName(r.receptionist_id) },
    { key: 'ci', header: 'Check-in', render: (r) => fmtDateTime(r.check_in_time) },
    { key: 'os', header: 'OTP status', render: (r) => { const c = classifyOtp(r.otp_status); return <Badge tone={otpTone[c]}>{LABEL[c] ? `${LABEL[c]} · ` : ''}{dash(r.otp_status)}</Badge>; } },
    { key: 'va', header: 'Verified at', render: (r) => fmtDateTime(r.verified_at) },
    { key: 'ca', header: 'Created at', render: (r) => fmtDateTime(r.created_at) },
    { key: 'at', header: 'OTP attempts', align: 'r', render: (r) => (attempts.isError ? '—' : att(r.id) ? `${att(r.id)!.tries} (${att(r.id)!.sent} sent)` : attempts.isLoading ? '…' : '0') },
    { key: 'rs', header: 'Review status', render: (r) => dash(r.review_status) },
  ];

  const getRows = async () => {
    const { rows } = await fetchAll<any>(() => applyVerifFilters(supabase.from('guest_verifications').select(COLS, { count: 'exact' }), applied).order('created_at', { ascending: false }).order('id'), 30000);
    return rows.map((r) => ({
      Guest: r.guest_name, Phone: maskPhone(r.guest_phone, '*'), Hotel: lk.hotelName(r.hotel_id), Receptionist: lk.recName(r.receptionist_id),
      'Check-in': fmtDateTime(r.check_in_time), 'OTP status': r.otp_status, 'Verified at': fmtDateTime(r.verified_at), 'Created at': fmtDateTime(r.created_at), 'Review status': r.review_status,
    }));
  };

  return (
    <>
      <PageHead
        title="Guest verification"
        sub="Monitoring only. OTP values and hashes are never read or shown."
        right={<span className="fact"><label className="fact"><input type="checkbox" checked={showPhone} onChange={(e) => setShowPhone(e.target.checked)} /> Show phone numbers</label><ExportMenu name="verifications" title="Guest verifications" getRows={getRows} /></span>}
      />
      <FilterBar fields={['preset', 'otpStatus', 'reviewStatus', 'receptionistId', 'guestName', 'guestPhone']} reviewTable="guest_verifications" />
      <div className="grid kpis">
        <Kpi label="Verifications" value={int(stats.total)} />
        <Kpi label="Verified" value={int(stats.verified)} tone="good" />
        <Kpi label="Pending" value={int(stats.pending)} tone="warn" />
        <Kpi label="Failed" value={int(stats.failed)} tone="bad" />
        <Kpi label="Expired" value={int(stats.expired)} />
        <Kpi label="Success rate" value={pct(stats.rate)} />
      </div>
      {stats.other > 0 ? <Notice tone="info">{int(stats.other)} verification(s) have an OTP status that is not mapped to Verified, Pending, Failed or Expired. They are shown with their raw value. Add the value to STATUS.otp in src/config.ts to classify it.</Notice> : null}
      {attempts.isError ? <Notice tone="warn">Attempt counts are unavailable: this account cannot read otp_attempts under the current RLS policies.</Notice> : null}
      <Card flush>
        <DataTable cols={cols} rows={p.rows} loading={p.loading} error={p.error} page={p.page} pageSize={p.pageSize} total={p.total} onPage={p.setPage} rowKey={(r) => r.id} />
      </Card>
    </>
  );
}
