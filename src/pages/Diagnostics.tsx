import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { env } from '../config';
import { useAuth } from '../state/auth';
import { PageHead, Card, Badge, Loading } from '../components/ui';
import { inr, int } from '../lib/format';
import { dateBounds, presetRange } from '../lib/ist';
import { fetchAll } from '../lib/data';

export interface TableDiagnostic {
  table: string;
  count: number | null;
  status: number | null;
  contentRange: string | null;
  error: string | null;
}

export interface DistinctCount {
  value: string;
  count: number;
}

export interface Step1Data {
  stayStatusCounts: DistinctCount[];
  paymentStatusCounts: DistinctCount[];
  paymentModeCounts: DistinctCount[];
  otpStatusCounts: DistinctCount[];
  reviewStatusCounts: DistinctCount[];
  checkedOutNullCount: number;
  checkedOutSetCount: number;
  currentCheckOutInPastCount: number;
  top20Stays: any[];
  totalDiffAmountCount: number;
  balanceMismatchCount: number;
  totalStaysCount: number;
  // Step 5 verification
  thisMonthBookedSum: number;
  thisMonthStayCount: number;
}

const TABLES = [
  'hotels',
  'guest_stays',
  'guest_verifications',
  'otp_attempts',
  'receptionists',
  'review_followups',
  'stay_extensions',
] as const;

export function Diagnostics() {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<TableDiagnostic[]>([]);
  const [step1, setStep1] = useState<Step1Data | null>(null);
  const [hotelsMap, setHotelsMap] = useState<Map<string, string>>(new Map());
  const [lastRun, setLastRun] = useState<string>('');

  const runDiagnostics = async () => {
    setLoading(true);
    const diagList: TableDiagnostic[] = [];

    // 1. Table-level HEAD counts
    for (const table of TABLES) {
      let count: number | null = null;
      let status: number | null = null;
      let contentRange: string | null = null;
      let errorMsg: string | null = null;

      try {
        const res = await supabase.from(table).select('id', { count: 'exact', head: true });
        count = res.count;
        status = res.status;
        if (res.error) errorMsg = res.error.message;

        const headRes = await fetch(`${env.url}/rest/v1/${table}?select=id`, {
          method: 'HEAD',
          headers: {
            apikey: env.anon,
            Authorization: `Bearer ${session?.access_token ?? env.anon}`,
            Prefer: 'count=exact',
          },
        });
        contentRange = headRes.headers.get('content-range');
        if (!status) status = headRes.status;
      } catch (err: any) {
        errorMsg = err?.message ?? String(err);
      }

      diagList.push({ table, count, status, contentRange, error: errorMsg });
    }

    setResults(diagList);

    // 2. Fetch hotels for lookup
    const hMap = new Map<string, string>();
    try {
      const { data: hData } = await supabase.from('hotels').select('id,hotel_name');
      (hData ?? []).forEach((h: any) => hMap.set(h.id, h.hotel_name));
      setHotelsMap(hMap);
    } catch {
      /* ignore */
    }

    // 3. Step 1 Detailed Inspection
    try {
      // a, b, c, d from guest_stays
      const STAY_COLS =
        'id,hotel_id,check_in_time,checked_out_at,current_check_out_time,stay_status,payment_status,payment_mode,number_of_nights,number_of_rooms,amount,total_amount,amount_paid,balance_amount';

      const staysRes = await fetchAll<any>(() =>
        supabase.from('guest_stays').select(STAY_COLS, { count: 'exact' }).order('id'),
      );
      const stays = staysRes.rows;

      // Group counts
      const countMap = (key: string) => {
        const m = new Map<string, number>();
        stays.forEach((s) => {
          const v = s[key] === null || s[key] === undefined || String(s[key]).trim() === '' ? '(NULL/empty)' : String(s[key]);
          m.set(v, (m.get(v) ?? 0) + 1);
        });
        return [...m.entries()]
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count);
      };

      const stayStatusCounts = countMap('stay_status');
      const paymentStatusCounts = countMap('payment_status');
      const paymentModeCounts = countMap('payment_mode');

      // b) checked_out_at NULL vs set, current_check_out_time in past
      const nowTs = Date.now();
      let checkedOutNullCount = 0;
      let checkedOutSetCount = 0;
      let currentCheckOutInPastCount = 0;

      // d) total_amount <> amount, total_amount - amount_paid <> balance_amount
      let totalDiffAmountCount = 0;
      let balanceMismatchCount = 0;

      stays.forEach((s) => {
        if (s.checked_out_at == null) checkedOutNullCount++;
        else checkedOutSetCount++;

        if (s.current_check_out_time && new Date(s.current_check_out_time).getTime() < nowTs) {
          currentCheckOutInPastCount++;
        }

        const tot = s.total_amount != null ? Number(s.total_amount) : Number(s.amount ?? 0);
        const amt = Number(s.amount ?? 0);
        const paid = Number(s.amount_paid ?? 0);
        const bal = Number(s.balance_amount ?? 0);

        if (s.total_amount != null && s.amount != null && Number(s.total_amount) !== Number(s.amount)) {
          totalDiffAmountCount++;
        }

        if (Math.abs(tot - paid - bal) > 1) {
          balanceMismatchCount++;
        }
      });

      // c) top 20 by total_amount
      const top20Stays = [...stays]
        .sort((a, b) => {
          const bTot = b.total_amount != null ? Number(b.total_amount) : Number(b.amount ?? 0);
          const aTot = a.total_amount != null ? Number(a.total_amount) : Number(a.amount ?? 0);
          return bTot - aTot;
        })
        .slice(0, 20);

      // Verifications otp_status
      let otpStatusCounts: DistinctCount[] = [];
      try {
        const verifRes = await fetchAll<any>(() =>
          supabase.from('guest_verifications').select('id,otp_status', { count: 'exact' }).order('id'),
        );
        const m = new Map<string, number>();
        verifRes.rows.forEach((r) => {
          const v = r.otp_status == null ? '(NULL/empty)' : String(r.otp_status);
          m.set(v, (m.get(v) ?? 0) + 1);
        });
        otpStatusCounts = [...m.entries()]
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count);
      } catch {
        /* ignore */
      }

      // Review followups review_status
      let reviewStatusCounts: DistinctCount[] = [];
      try {
        const followRes = await fetchAll<any>(() =>
          supabase.from('review_followups').select('id,review_status', { count: 'exact' }).order('id'),
        );
        const m = new Map<string, number>();
        followRes.rows.forEach((r) => {
          const v = r.review_status == null ? '(NULL/empty)' : String(r.review_status);
          m.set(v, (m.get(v) ?? 0) + 1);
        });
        reviewStatusCounts = [...m.entries()]
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count);
      } catch {
        /* ignore */
      }

      // Step 5: "This month" verification check
      const tmRange = presetRange('thisMonth');
      const { start: tmStart, end: tmEnd } = dateBounds(tmRange.from, tmRange.to);
      const thisMonthStays = stays.filter((s) => {
        if (!s.check_in_time) return false;
        const t = new Date(s.check_in_time).toISOString();
        return (!tmStart || t >= tmStart) && (!tmEnd || t < tmEnd);
      });
      const thisMonthBookedSum = thisMonthStays.reduce(
        (sum, s) => sum + (s.total_amount != null ? Number(s.total_amount) : Number(s.amount ?? 0)),
        0,
      );

      setStep1({
        stayStatusCounts,
        paymentStatusCounts,
        paymentModeCounts,
        otpStatusCounts,
        reviewStatusCounts,
        checkedOutNullCount,
        checkedOutSetCount,
        currentCheckOutInPastCount,
        top20Stays,
        totalDiffAmountCount,
        balanceMismatchCount,
        totalStaysCount: stays.length,
        thisMonthBookedSum,
        thisMonthStayCount: thisMonthStays.length,
      });
    } catch (err) {
      console.error('Error running Step 1 inspection:', err);
    }

    setLastRun(new Date().toLocaleTimeString());
    setLoading(false);
  };

  useEffect(() => {
    runDiagnostics();
  }, [session]);

  const guestStaysDiag = results.find((r) => r.table === 'guest_stays');

  return (
    <>
      <PageHead
        title="Diagnostics & Real Data Inspection"
        sub="Read-only diagnostic checks, schema analysis, and Step 1 data inspection."
        right={
          <button className="btn sm" onClick={runDiagnostics} disabled={loading}>
            {loading ? 'Inspecting…' : 'Re-run inspection'}
          </button>
        }
      />

      {guestStaysDiag ? (
        <Card title="/rest/v1/guest_stays Request Inspection">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            <div>
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>HTTP Status Code</span>
              <strong style={{ fontSize: 18 }}>{guestStaysDiag.status ?? '—'}</strong>
            </div>
            <div>
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>Content-Range Header</span>
              <strong style={{ fontSize: 18 }}>{guestStaysDiag.contentRange ?? 'null'}</strong>
            </div>
            <div>
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>Exact Row Count</span>
              <strong style={{ fontSize: 18 }}>{guestStaysDiag.count !== null ? guestStaysDiag.count : '—'}</strong>
            </div>
            <div>
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>Error</span>
              <strong style={{ fontSize: 14 }}>{guestStaysDiag.error ?? 'None'}</strong>
            </div>
          </div>
        </Card>
      ) : null}

      <div style={{ marginTop: 20 }}>
        <Card title={`Table Diagnostics ${lastRun ? `(Last checked: ${lastRun})` : ''}`}>
          {loading ? (
            <Loading rows={7} />
          ) : (
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Table</th>
                    <th>Row Count</th>
                    <th>Status Code</th>
                    <th>Content-Range</th>
                    <th>Error</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.table}>
                      <td>
                        <strong>{r.table}</strong>
                      </td>
                      <td>{r.count !== null ? r.count : '—'}</td>
                      <td>{r.status ?? '—'}</td>
                      <td>
                        <code>{r.contentRange ?? '—'}</code>
                      </td>
                      <td>
                        {r.error ? <span style={{ color: 'var(--bad, #dc2626)' }}>{r.error}</span> : <span className="muted">None</span>}
                      </td>
                      <td>
                        {r.error ? (
                          <Badge tone="bad">Error</Badge>
                        ) : r.count === 0 ? (
                          <Badge tone="warn">0 rows</Badge>
                        ) : (
                          <Badge tone="good">{r.count} rows</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {step1 ? (
        <>
          <div style={{ marginTop: 24 }}>
            <h2>Step 1 (a) - Distinct Values & Counts</h2>
            <div className="grid two" style={{ marginTop: 12 }}>
              <Card title="guest_stays.stay_status">
                <table style={{ width: '100%' }}>
                  <thead>
                    <tr><th>Status Value</th><th>Count</th></tr>
                  </thead>
                  <tbody>
                    {step1.stayStatusCounts.map((c) => (
                      <tr key={c.value}><td><code>{c.value}</code></td><td>{int(c.count)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              <Card title="guest_stays.payment_status">
                <table style={{ width: '100%' }}>
                  <thead>
                    <tr><th>Payment Status</th><th>Count</th></tr>
                  </thead>
                  <tbody>
                    {step1.paymentStatusCounts.map((c) => (
                      <tr key={c.value}><td><code>{c.value}</code></td><td>{int(c.count)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              <Card title="guest_stays.payment_mode">
                <table style={{ width: '100%' }}>
                  <thead>
                    <tr><th>Payment Mode</th><th>Count</th></tr>
                  </thead>
                  <tbody>
                    {step1.paymentModeCounts.map((c) => (
                      <tr key={c.value}><td><code>{c.value}</code></td><td>{int(c.count)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              <Card title="guest_verifications.otp_status & review_status">
                <h4>OTP Status</h4>
                <table style={{ width: '100%', marginBottom: 16 }}>
                  <thead>
                    <tr><th>OTP Status</th><th>Count</th></tr>
                  </thead>
                  <tbody>
                    {step1.otpStatusCounts.map((c) => (
                      <tr key={c.value}><td><code>{c.value}</code></td><td>{int(c.count)}</td></tr>
                    ))}
                  </tbody>
                </table>

                <h4>Review Follow-ups Status</h4>
                <table style={{ width: '100%' }}>
                  <thead>
                    <tr><th>Review Status</th><th>Count</th></tr>
                  </thead>
                  <tbody>
                    {step1.reviewStatusCounts.map((c) => (
                      <tr key={c.value}><td><code>{c.value}</code></td><td>{int(c.count)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          </div>

          <div style={{ marginTop: 24 }}>
            <h2>Step 1 (b) & (d) - Stays Checkout and Financial Discrepancies</h2>
            <div className="grid two" style={{ marginTop: 12 }}>
              <Card title="1 (b) Checkout Timestamp Distribution">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <span className="muted" style={{ display: 'block', fontSize: 12 }}>checked_out_at IS NULL</span>
                    <strong style={{ fontSize: 20 }}>{int(step1.checkedOutNullCount)}</strong>
                  </div>
                  <div>
                    <span className="muted" style={{ display: 'block', fontSize: 12 }}>checked_out_at IS SET</span>
                    <strong style={{ fontSize: 20 }}>{int(step1.checkedOutSetCount)}</strong>
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <span className="muted" style={{ display: 'block', fontSize: 12 }}>current_check_out_time in PAST (&lt; now)</span>
                    <strong style={{ fontSize: 20, color: 'var(--warn, #f59e0b)' }}>
                      {int(step1.currentCheckOutInPastCount)}
                    </strong>
                  </div>
                </div>
              </Card>

              <Card title="1 (d) Total vs Amount & Balance Discrepancies">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <span className="muted" style={{ display: 'block', fontSize: 12 }}>total_amount &lt;&gt; amount</span>
                    <strong style={{ fontSize: 20 }}>{int(step1.totalDiffAmountCount)}</strong>
                    <span className="muted" style={{ display: 'block', fontSize: 11 }}>
                      out of {int(step1.totalStaysCount)} stays
                    </span>
                  </div>
                  <div>
                    <span className="muted" style={{ display: 'block', fontSize: 12 }}>total - paid &lt;&gt; balance</span>
                    <strong style={{ fontSize: 20 }}>{int(step1.balanceMismatchCount)}</strong>
                    <span className="muted" style={{ display: 'block', fontSize: 11 }}>
                      discrepancy &gt; ₹1
                    </span>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <div style={{ marginTop: 24 }}>
            <h2>Step 1 (c) - Top 20 Stays by Total Amount (Outlier Inspection)</h2>
            <Card title="Highest Value Stays">
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Hotel</th>
                      <th>Check-in</th>
                      <th>Nights</th>
                      <th>Rooms</th>
                      <th>Amount</th>
                      <th>Total Amount</th>
                      <th>Amount Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {step1.top20Stays.map((s) => (
                      <tr key={s.id}>
                        <td><code>{s.id.slice(0, 8)}</code></td>
                        <td>{hotelsMap.get(s.hotel_id) ?? s.hotel_id ?? '—'}</td>
                        <td>{s.check_in_time ? s.check_in_time.slice(0, 16).replace('T', ' ') : '—'}</td>
                        <td>{s.number_of_nights ?? '—'}</td>
                        <td>{s.number_of_rooms ?? 1}</td>
                        <td>{inr(s.amount)}</td>
                        <td><strong>{inr(s.total_amount)}</strong></td>
                        <td>{inr(s.amount_paid)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <div style={{ marginTop: 24 }}>
            <h2>Step 5 - Direct Verification for This Month</h2>
            <Card title="This Month Formula Verification">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                <div>
                  <span className="muted" style={{ display: 'block', fontSize: 12 }}>Stays in This Month</span>
                  <strong style={{ fontSize: 20 }}>{int(step1.thisMonthStayCount)}</strong>
                </div>
                <div>
                  <span className="muted" style={{ display: 'block', fontSize: 12 }}>Direct SUM(total_amount)</span>
                  <strong style={{ fontSize: 20, color: 'var(--good, #10b981)' }}>{inr(step1.thisMonthBookedSum)}</strong>
                </div>
              </div>
            </Card>
          </div>
        </>
      ) : null}
    </>
  );
}
