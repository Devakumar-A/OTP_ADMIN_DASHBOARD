import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFilters } from '../state/filters';
import { FilterBar } from '../components/FilterBar';
import { Kpi, PageHead, Card, Loading, ErrorBox, Notice } from '../components/ui';
import { Bars } from '../components/Charts';
import { useFinance } from '../hooks/finance';
import { useTodayCounts, useActiveStays, useVerifFacts, useLookups } from '../hooks/data';
import { inr, int, pct, formatDateRangeWords, formatIstTimeOnly } from '../lib/format';
import { classifyOtp } from '../lib/classify';
import { buildHotelDateMatrix } from '../lib/matrix';
import { countCheckIns, countRooms } from '../lib/checkins';
import { exportCheckInReportPdf } from '../lib/export';
import { istDate } from '../lib/ist';

export function Overview() {
  const { applied, setHotel } = useFilters();
  const navigate = useNavigate();

  const lk = useLookups();
  const fin = useFinance(applied);
  const today = useTodayCounts(applied.hotelId);
  const active = useActiveStays(applied.hotelId);
  const verif = useVerifFacts(applied);

  // Verification small metric line
  const vStats = useMemo(() => {
    const rows = verif.data?.rows ?? [];
    let verified = 0;
    rows.forEach((r) => {
      if (classifyOtp(r.otp_status) === 'verified') verified++;
    });
    return { total: rows.length, verified };
  }, [verif.data]);

  const t = fin.data?.totals;

  // Build matrix for both tables
  const matrix = useMemo(() => {
    return buildHotelDateMatrix(
      fin.data?.stays ?? [],
      lk.hotels,
      applied.from,
      applied.to,
    );
  }, [fin.data?.stays, lk.hotels, applied.from, applied.to]);

  // Chart 1: Stacked Bar "Daily check-ins" (x = date, top 8 hotels + Others)
  const dailyStackedChart = useMemo(() => {
    const stays = fin.data?.stays ?? [];
    if (!stays.length) return { data: [], series: [] };

    // Find top 8 hotels by check-in count
    const hotelCounts = new Map<string, number>();
    stays.forEach((s) => {
      const hid = s.hotel_id || 'unknown';
      hotelCounts.set(hid, (hotelCounts.get(hid) ?? 0) + 1);
    });

    const sortedHotels = [...hotelCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);

    const top8Set = new Set(sortedHotels.slice(0, 8));
    const hasOthers = sortedHotels.length > 8;

    // Series definitions
    const series = sortedHotels.slice(0, 8).map((hid) => ({
      key: hid,
      label: lk.hotelName(hid),
    }));

    if (hasOthers) {
      series.push({ key: 'others', label: 'Other Hotels' });
    }

    // Build data per column/date
    const data = matrix.columns.map((c) => {
      const pt: Record<string, any> = { name: c.label };
      series.forEach((s) => (pt[s.key] = 0));

      stays.forEach((s) => {
        if (!s.check_in_time) return;
        const stayYmd = istDate(s.check_in_time);
        if (stayYmd >= c.startDate && stayYmd < c.endDate) {
          const hid = s.hotel_id || 'unknown';
          if (top8Set.has(hid)) {
            pt[hid] = (pt[hid] ?? 0) + 1;
          } else {
            pt['others'] = (pt['others'] ?? 0) + 1;
          }
        }
      });

      return pt;
    });

    return { data, series };
  }, [fin.data?.stays, lk, matrix.columns]);

  // Chart 2: Horizontal Bar "Revenue by hotel" sorted high to low with rupee labels
  const revenueByHotelChart = useMemo(() => {
    return matrix.rows
      .filter((r) => r.totalRevenue > 0)
      .slice(0, 15) // top 15 hotels
      .map((r) => ({
        name: r.hotelName,
        Revenue: r.totalRevenue,
      }));
  }, [matrix.rows]);

  const onCellClick = (hotelId: string, startDate: string, endDate: string) => {
    navigate(
      `/stays?hotelId=${encodeURIComponent(hotelId)}&from=${encodeURIComponent(
        `${startDate}T00:00`,
      )}&to=${encodeURIComponent(`${endDate}T00:00`)}&dateField=check_in_time`,
    );
  };

  const checkInExact = useMemo(() => countCheckIns(fin.data?.stays ?? []), [fin.data?.stays]);
  const roomsExact = useMemo(() => countRooms(fin.data?.stays ?? []), [fin.data?.stays]);

  return (
    <>
      <PageHead
        title="Operations Overview"
        sub={`Daily check-in volume, occupancy, and revenue across hotels. Scope: ${
          applied.hotelId ? lk.hotelName(applied.hotelId) : 'All hotels'
        } | ${formatDateRangeWords(applied.from, applied.to)}`}
        right={
          <div className="fact" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn sm" onClick={() => fin.refetch()} title="Refresh live data">
              ↻ Refresh
            </button>
            <button
              className="btn sm primary"
              onClick={() =>
                exportCheckInReportPdf({
                  matrix,
                  hotelFilterName: applied.hotelId ? lk.hotelName(applied.hotelId) : 'All accessible hotels',
                  fromYmd: applied.from ? istDate(applied.from) : 'start',
                  toYmd: applied.to ? istDate(applied.to) : 'now',
                })
              }
            >
              📄 Check-in Report (PDF)
            </button>
          </div>
        }
      />

      <FilterBar />

      {fin.error ? <ErrorBox error={fin.error} /> : null}
      {fin.data?.truncated ? (
        <Notice tone="warn">Result set exceeded the safety limit; figures are partial. Narrow the period.</Notice>
      ) : null}

      {/* KPI Row Only */}
      <div style={{ marginBottom: 20 }}>
        {fin.loading ? (
          <Loading rows={2} />
        ) : t ? (
          <>
            <div className="grid kpis">
              <Kpi
                label="Check-ins in period"
                value={int(checkInExact)}
                sub={`${int(roomsExact)} rooms`}
                info="Exact distinct stay IDs whose check_in_time falls in this period"
              />
              <Kpi
                label="In-house now"
                value={active.isLoading ? '…' : int(active.data?.inHouse.length)}
                tone="good"
                sub="active & unexpired"
                info="Active stays with checked_out_at IS NULL and current_check_out_time >= now()"
              />
              <Kpi
                label="Rooms occupied"
                value={active.isLoading ? '…' : int(active.data?.roomsOccupied)}
                sub="in-house stays only"
                info="SUM(number_of_rooms) of currently in-house stays only"
              />
              <Kpi
                label="Total revenue"
                value={inr(t.booked)}
                sub="SUM(guest_stays.total_amount)"
                info="Total booked revenue = SUM(guest_stays.total_amount)"
              />
              <Kpi
                label="Collected"
                value={inr(t.collected)}
                tone="good"
                sub="SUM(amount_paid)"
                info="Collected = SUM(guest_stays.amount_paid)"
              />
              <Kpi
                label="Outstanding"
                value={inr(t.outstanding)}
                tone={t.outstanding > 0 ? 'warn' : undefined}
                sub="SUM(balance_amount)"
                info="Outstanding = SUM(guest_stays.balance_amount)"
              />
              <Kpi
                label="Collection %"
                value={pct(t.collectionPct)}
                sub="Collected ÷ Booked"
                info="Collected revenue ÷ Total booked revenue * 100"
              />
            </div>
            <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--muted)' }}>
              Guest verification status: <strong>{int(vStats.verified)}</strong> verified out of{' '}
              <strong>{int(vStats.total)}</strong> completed in this period.
            </div>
          </>
        ) : null}
      </div>

      {/* Main Table: Check-ins by hotel and date */}
      <Card
        title={`Check-ins by Hotel and ${matrix.isWeekly ? 'Week' : 'Date'}`}
        right={
          <span className="muted" style={{ fontSize: 12 }}>
            Click hotel to filter dashboard · Click cell to view stays
          </span>
        }
      >
        <div className="tw">
          <table className="matrix-table">
            <thead>
              <tr>
                <th>Hotel</th>
                {matrix.columns.map((c) => (
                  <th key={c.key} className="r">
                    {c.label}
                  </th>
                ))}
                <th className="r" style={{ borderLeft: '1px solid var(--line)', background: 'var(--panel2)' }}>
                  Total Check-ins
                </th>
                <th className="r" style={{ background: 'var(--panel2)' }}>
                  Total Revenue
                </th>
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((r) => (
                <tr key={r.hotelId}>
                  <td>
                    <button
                      className="cell-link"
                      style={{ background: 'transparent', border: 0, padding: 0, font: 'inherit', textAlign: 'left', fontWeight: 600 }}
                      onClick={() => setHotel(r.hotelId)}
                      title={`Filter dashboard to ${r.hotelName}`}
                    >
                      {r.hotelName} {r.hotelCode ? `(${r.hotelCode})` : ''}
                    </button>
                  </td>
                  {matrix.columns.map((c) => {
                    const cnt = r.checkIns[c.key] ?? 0;
                    return (
                      <td key={c.key} className="r">
                        {cnt > 0 ? (
                          <span
                            className="cell-link"
                            onClick={() => onCellClick(r.hotelId, c.startDate, c.endDate)}
                            title={`View ${cnt} stay(s) at ${r.hotelName} on ${c.label}`}
                          >
                            {int(cnt)}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="r" style={{ borderLeft: '1px solid var(--line)', fontWeight: 700 }}>
                    {int(r.totalCheckIns)}
                  </td>
                  <td className="r" style={{ fontWeight: 700 }}>
                    {inr(r.totalRevenue)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>All Hotels (Total)</td>
                {matrix.columns.map((c) => (
                  <td key={c.key} className="r">
                    <strong>{int(matrix.totals.checkIns[c.key] ?? 0)}</strong>
                  </td>
                ))}
                <td className="r" style={{ borderLeft: '1px solid var(--line)' }}>
                  <strong>{int(matrix.totals.totalCheckIns)}</strong>
                </td>
                <td className="r">
                  <strong>{inr(matrix.totals.totalRevenue)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* Second Table: Revenue by hotel and date */}
      <div style={{ marginTop: 20 }}>
        <Card
          title={`Revenue by Hotel and ${matrix.isWeekly ? 'Week' : 'Date'} (₹)`}
          right={
            <span className="muted" style={{ fontSize: 12 }}>
              Amounts in Rupees (Indian numbering)
            </span>
          }
        >
          <div className="tw">
            <table className="matrix-table">
              <thead>
                <tr>
                  <th>Hotel</th>
                  {matrix.columns.map((c) => (
                    <th key={c.key} className="r">
                      {c.label}
                    </th>
                  ))}
                  <th className="r" style={{ borderLeft: '1px solid var(--line)', background: 'var(--panel2)' }}>
                    Total Revenue
                  </th>
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((r) => (
                  <tr key={r.hotelId}>
                    <td>
                      <button
                        className="cell-link"
                        style={{ background: 'transparent', border: 0, padding: 0, font: 'inherit', textAlign: 'left', fontWeight: 600 }}
                        onClick={() => setHotel(r.hotelId)}
                        title={`Filter dashboard to ${r.hotelName}`}
                      >
                        {r.hotelName}
                      </button>
                    </td>
                    {matrix.columns.map((c) => {
                      const rev = r.revenue[c.key] ?? 0;
                      return (
                        <td key={c.key} className="r">
                          {rev > 0 ? (
                            <span
                              className="cell-link"
                              onClick={() => onCellClick(r.hotelId, c.startDate, c.endDate)}
                              title={`View stays at ${r.hotelName} on ${c.label}`}
                            >
                              {inr(rev)}
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="r" style={{ borderLeft: '1px solid var(--line)', fontWeight: 700 }}>
                      {inr(r.totalRevenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>All Hotels (Total)</td>
                  {matrix.columns.map((c) => (
                    <td key={c.key} className="r">
                      <strong>{inr(matrix.totals.revenue[c.key] ?? 0)}</strong>
                    </td>
                  ))}
                  <td className="r" style={{ borderLeft: '1px solid var(--line)' }}>
                    <strong>{inr(matrix.totals.totalRevenue)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid two" style={{ marginTop: 20 }}>
        <Card title="Daily Check-ins (by Hotel)">
          {fin.loading ? (
            <Loading />
          ) : (
            <Bars
              data={dailyStackedChart.data}
              series={dailyStackedChart.series}
              money={false}
              stacked={true}
              xAxisTitle="Check-in Date"
              yAxisTitle="Check-in Count"
            />
          )}
        </Card>

        <Card title="Revenue by Hotel (Highest to Lowest)">
          {fin.loading ? (
            <Loading />
          ) : (
            <Bars
              horizontal
              data={revenueByHotelChart}
              series={[{ key: 'Revenue', label: 'Revenue (₹)' }]}
              money={true}
              showValueLabels={true}
              xAxisTitle="Revenue (₹)"
            />
          )}
        </Card>
      </div>
    </>
  );
}
