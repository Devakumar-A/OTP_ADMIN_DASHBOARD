import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useFilters } from '../state/filters';
import { FilterBar } from '../components/FilterBar';
import { PageHead, Card, Kpi, Loading, ErrorBox, Notice, DataTable, Col } from '../components/ui';
import { LineTrend, Bars, Donut } from '../components/Charts';
import { useFinance } from '../hooks/finance';
import { useLookups } from '../hooks/data';
import { groupBy, MODES, analyzeOutliers, ExtFact } from '../lib/finance';
import { istDate } from '../lib/ist';
import { inr, int, pct } from '../lib/format';

export function Revenue() {
  const { applied } = useFilters();
  const lk = useLookups();
  const fin = useFinance(applied);
  const d = fin.data;
  const t = d?.totals;

  const daily = useMemo(
    () =>
      d
        ? groupBy(
            d.stays,
            d.exts,
            (s) => (s.check_in_time ? istDate(s.check_in_time) : null),
            (x) => (x.created_at ? istDate(x.created_at) : null),
          ).map((b) => ({
            name: b.key.slice(5),
            Booked: b.booked,
            Collected: b.collected,
          }))
        : [],
    [d],
  );

  const byHotel = useMemo(
    () =>
      d
        ? groupBy(
            d.stays,
            d.exts,
            (s) => s.hotel_id,
            (x) => x.hotel_id,
          ).map((b) => ({
            name: lk.hotelName(b.key),
            Booked: b.booked,
            Collected: b.collected,
            Outstanding: b.outstanding,
          }))
        : [],
    [d, lk],
  );

  const modes = t ? MODES.map((m) => ({ name: m, value: Math.round(t.modes[m]) })) : [];

  const outliers = useMemo(() => (d ? analyzeOutliers(d.stays) : null), [d]);

  const extCols: Col<ExtFact>[] = [
    { key: 'id', header: 'ID', render: (x) => <code>{x.id.slice(0, 8)}</code> },
    { key: 'h', header: 'Hotel', render: (x) => lk.hotelName(x.hotel_id) },
    { key: 'd', header: 'Date', render: (x) => (x.created_at ? istDate(x.created_at) : '—') },
    { key: 'n', header: 'Nights', render: (x) => x.extension_nights ?? 1, align: 'r' },
    { key: 'a', header: 'Amount', render: (x) => inr(x.extension_amount), align: 'r' },
    { key: 'p', header: 'Paid', render: (x) => inr(x.amount_paid), align: 'r' },
    { key: 'b', header: 'Balance', render: (x) => inr(x.balance_amount), align: 'r' },
    { key: 'm', header: 'Mode', render: (x) => x.payment_mode ?? '—' },
  ];

  return (
    <>
      <PageHead
        title="Revenue Analytics"
        sub="Booked, collected and outstanding revenue. Stays only — single source of truth."
      />

      <FilterBar />

      {fin.error ? <ErrorBox error={fin.error} /> : null}
      {d?.truncated ? (
        <Notice tone="warn">Result set exceeded the safety limit; figures are partial. Narrow the filter range.</Notice>
      ) : null}

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Key Financial Metrics</h3>
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
            <Kpi label="Total revenue (booked)" value={inr(t.booked)} sub="SUM(guest_stays.total_amount)" />
            <Kpi label="Collected" value={inr(t.collected)} tone="good" sub="SUM(guest_stays.amount_paid)" />
            <Kpi
              label="Outstanding"
              value={inr(t.outstanding)}
              tone={t.outstanding > 0 ? 'warn' : undefined}
              sub="SUM(guest_stays.balance_amount)"
            />
            <Kpi label="Collection %" value={pct(t.collectionPct)} sub="Collected ÷ Booked" />
            <Kpi label="Fully paid stays" value={int(t.paidStays)} tone="good" />
            <Kpi label="Partially paid stays" value={int(t.partialStays)} tone="warn" />
            <Kpi label="Unpaid stays" value={int(t.unpaidStays)} tone="bad" />
            <Kpi label="Total stays" value={int(t.stays)} />
          </div>
        ) : null}
      </div>

      {outliers && outliers.allFlagged.length > 0 ? (
        <div style={{ marginTop: 24 }}>
          <Card title="Data Quality & Outliers Panel">
            <p className="muted" style={{ marginBottom: 16 }}>
              Showing top 10 stays by total amount and stays exceeding 10× median ({inr(outliers.median)}).
              Rows are never hidden: revenue is shown below both with and without outliers.
            </p>

            <div className="grid two" style={{ marginBottom: 20 }}>
              <div className="card kpi">
                <div className="l">Total Revenue (With All Stays)</div>
                <div className="v">{inr(outliers.totalRevenueAll)}</div>
                <div className="s">{int(d?.stays.length)} stays</div>
              </div>
              <div className="card kpi good">
                <div className="l">Total Revenue (Without Outliers)</div>
                <div className="v">{inr(outliers.totalRevenueWithoutOutliers)}</div>
                <div className="s">
                  Excludes {int(outliers.allFlagged.length)} flagged stays (Impact: {inr(outliers.totalRevenueAll - outliers.totalRevenueWithoutOutliers)})
                </div>
              </div>
            </div>

            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Stay ID / Link</th>
                    <th>Hotel</th>
                    <th>Check-in</th>
                    <th>Total Amount</th>
                    <th>Amount Paid</th>
                    <th>Balance</th>
                    <th>Flag Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {outliers.allFlagged.map((s) => {
                    const isTop10 = outliers.top10.some((x) => x.id === s.id);
                    const isTenX = outliers.tenXMedianRows.some((x) => x.id === s.id);
                    const reason = isTop10 && isTenX ? 'Top 10 & >10× Median' : isTop10 ? 'Top 10' : '>10× Median';

                    return (
                      <tr key={s.id}>
                        <td>
                          <Link to={`/stays?bookingId=${encodeURIComponent(s.booking_id || s.id)}`}>
                            <code>{s.booking_id || s.id.slice(0, 8)}</code>
                          </Link>
                        </td>
                        <td>{lk.hotelName(s.hotel_id)}</td>
                        <td>{s.check_in_time ? istDate(s.check_in_time) : '—'}</td>
                        <td><strong>{inr(s.total_amount ?? s.amount)}</strong></td>
                        <td>{inr(s.amount_paid)}</td>
                        <td>{inr(s.balance_amount)}</td>
                        <td>
                          <span className="badge warn">{reason}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      <div className="grid two" style={{ marginTop: 24 }}>
        <Card title="1. Daily trend">
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
        <Card title="2. Hotel-wise comparison">
          {fin.loading ? (
            <Loading />
          ) : (
            <Bars
              horizontal
              data={byHotel}
              series={[
                { key: 'Booked', label: 'Booked' },
                { key: 'Collected', label: 'Collected' },
                { key: 'Outstanding', label: 'Outstanding' },
              ]}
            />
          )}
        </Card>
        <Card title="3. Payment mode">
          {fin.loading ? <Loading /> : <Donut data={modes} />}
        </Card>
        <Card title="4. Collected vs Outstanding">
          {fin.loading ? (
            <Loading />
          ) : t ? (
            <Donut
              data={[
                { name: 'Collected', value: Math.round(t.collected) },
                { name: 'Outstanding', value: Math.round(t.outstanding) },
              ]}
            />
          ) : null}
        </Card>
      </div>

      <div style={{ marginTop: 24 }}>
        <Card title="Stay Extensions (Informational)">
          <DataTable
            cols={extCols}
            rows={(d?.exts ?? []).slice(0, 20)}
            loading={fin.loading}
            rowKey={(r) => r.id}
            empty="No stay extensions recorded in this period."
          />
        </Card>
      </div>
    </>
  );
}
