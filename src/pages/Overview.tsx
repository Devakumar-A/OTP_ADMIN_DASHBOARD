import { useMemo } from 'react';
import { useFilters } from '../state/filters';
import { FilterBar } from '../components/FilterBar';
import { Kpi, PageHead, Card, Loading, ErrorBox, Notice } from '../components/ui';
import { LineTrend, Bars } from '../components/Charts';
import { useFinance } from '../hooks/finance';
import { useTodayCounts, useActiveStays, useVerifFacts, useLookups } from '../hooks/data';
import { inr, int, pct } from '../lib/format';
import { classifyOtp } from '../lib/classify';
import { groupBy } from '../lib/finance';
import { istDate } from '../lib/ist';

export function Overview() {
  const { applied } = useFilters();
  const fin = useFinance(applied);
  const today = useTodayCounts(applied.hotelId);
  const active = useActiveStays(applied.hotelId);
  const verif = useVerifFacts(applied);
  const lk = useLookups();

  const v = useMemo(() => {
    const rows = verif.data?.rows ?? [];
    let verified = 0;
    rows.forEach((r) => {
      if (classifyOtp(r.otp_status) === 'verified') verified++;
    });
    return {
      total: rows.length,
      verified,
      notVerified: rows.length - verified,
    };
  }, [verif.data]);

  const daily = useMemo(() => {
    if (!fin.data) return [];
    return groupBy(
      fin.data.stays,
      fin.data.exts,
      (s) => (s.check_in_time ? istDate(s.check_in_time) : null),
      (x) => (x.created_at ? istDate(x.created_at) : null),
    ).map((b) => ({
      name: b.key.slice(5),
      Booked: b.booked,
      Collected: b.collected,
    }));
  }, [fin.data]);

  const hotelRevenue = useMemo(() => {
    if (!fin.data) return [];
    return groupBy(
      fin.data.stays,
      fin.data.exts,
      (s) => s.hotel_id,
      (x) => x.hotel_id,
    ).map((b) => ({
      name: lk.hotelName(b.key),
      Booked: b.booked,
      Collected: b.collected,
    }));
  }, [fin.data, lk]);

  const t = fin.data?.totals;
  const unknownCount = active.data?.unknownStatusStays.length ?? 0;

  return (
    <>
      <PageHead
        title="Overview"
        sub="Executive summary for the selected hotel and period (Asia/Kolkata)."
      />

      <FilterBar />

      {fin.error ? <ErrorBox error={fin.error} /> : null}
      {fin.data?.truncated ? (
        <Notice tone="warn">Result set exceeded the safety limit; totals are partial. Narrow the range.</Notice>
      ) : null}

      {unknownCount > 0 ? (
        <Notice tone="warn">
          <strong>Notice:</strong> {unknownCount} active stays have unrecognised status values and were not
          counted as in-house. Please review their status.
        </Notice>
      ) : null}

      <div>
        <h3>Guest & Stay Statistics</h3>
        {fin.loading ? (
          <Loading rows={2} />
        ) : (
          <div className="grid kpis">
            <Kpi label="Stays in period" value={int(fin.data?.stays.length)} sub="by selected date field" />
            <Kpi label="Check-ins today" value={today.isLoading ? '…' : int(today.data?.ins)} sub="IST calendar day" />
            <Kpi
              label="Check-outs today"
              value={
                today.isLoading
                  ? '…'
                  : `${int(today.data?.expectedOuts ?? 0)} / ${int(today.data?.actualOuts ?? 0)}`
              }
              sub="expected / actual"
            />
            <Kpi
              label="In-house now"
              value={active.isLoading ? '…' : int(active.data?.inHouse.length)}
              sub="active & expected check-out >= now"
              tone="good"
            />
            <Kpi
              label="Rooms occupied"
              value={active.isLoading ? '…' : int(active.data?.roomsOccupied)}
              sub="in-house stays only"
            />
          </div>
        )}
      </div>

      <div style={{ marginTop: 20 }}>
        <h3>Verification</h3>
        {verif.error ? (
          <ErrorBox error={verif.error} />
        ) : verif.isLoading ? (
          <Loading rows={2} />
        ) : (
          <div className="grid kpis">
            <Kpi label="Verifications total" value={int(v.total)} />
            <Kpi label="Verified" value={int(v.verified)} tone="good" />
            <Kpi label="Not verified" value={int(v.notVerified)} tone={v.notVerified > 0 ? 'warn' : undefined} />
          </div>
        )}
      </div>

      <div style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Financial Performance</h3>
          {t ? (
            <span className="muted" style={{ fontSize: 13 }}>
              Extensions included: {int(t.extensions)}, {inr(t.extBooked)}
            </span>
          ) : null}
        </div>
        {fin.loading ? (
          <Loading rows={2} />
        ) : t ? (
          <div className="grid kpis">
            <Kpi label="Total revenue" value={inr(t.booked)} sub="SUM(guest_stays.total_amount)" />
            <Kpi label="Collected" value={inr(t.collected)} tone="good" sub="SUM(guest_stays.amount_paid)" />
            <Kpi
              label="Outstanding"
              value={inr(t.outstanding)}
              tone={t.outstanding > 0 ? 'warn' : undefined}
              sub="SUM(guest_stays.balance_amount)"
            />
            <Kpi label="Collection %" value={pct(t.collectionPct)} sub="Collected ÷ Total revenue" />
          </div>
        ) : null}
      </div>

      <div className="grid two" style={{ marginTop: 20 }}>
        <Card title="Daily revenue (booked vs collected)">
          {fin.loading ? (
            <Loading />
          ) : (
            <LineTrend
              data={daily}
              series={[
                { key: 'Booked', label: 'Booked' },
                { key: 'Collected', label: 'Collected' },
              ]}
            />
          )}
        </Card>
        <Card title="Hotel-wise revenue">
          {fin.loading ? (
            <Loading />
          ) : (
            <Bars
              data={hotelRevenue}
              series={[
                { key: 'Booked', label: 'Booked' },
                { key: 'Collected', label: 'Collected' },
              ]}
            />
          )}
        </Card>
      </div>
    </>
  );
}
