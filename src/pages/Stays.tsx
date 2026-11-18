import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFilters } from '../state/filters';
import { FilterBar } from '../components/FilterBar';
import { PageHead, Card, DataTable, Badge, Col, Kpi } from '../components/ui';
import { ExportMenu } from '../components/ExportMenu';
import { useLookups, usePaged } from '../hooks/data';
import { supabase } from '../lib/supabase';
import { applyStayFilters } from '../lib/filters';
import { fetchAll } from '../lib/data';
import { classifyStay, classifyPayment, stayTone, payTone } from '../lib/classify';
import { num } from '../lib/finance';
import { fmtDateTime, inr, int, maskPhone, dash } from '../lib/format';

// Explicit column list. ID proof and address are NEVER selected in lists/caches!
const COLS =
  'id,guest_name,guest_phone,hotel_id,room_number,grc_number,check_in_time,original_check_out_time,current_check_out_time,checked_out_at,number_of_nights,number_of_guests,number_of_rooms,stay_status,payment_status,payment_mode,cash_amount,gpay_amount,card_amount,online_amount,total_amount,amount,amount_paid,balance_amount,receptionist_id,booking_id,purpose_of_visit,source';

const bal = (r: any) =>
  r.balance_amount != null ? num(r.balance_amount) : Math.max(0, num(r.total_amount ?? r.amount) - num(r.amount_paid));
const tot = (r: any) => num(r.total_amount ?? r.amount);

export function Stays() {
  const { applied } = useFilters();
  const lk = useLookups();
  const navigate = useNavigate();

  const [showAllColumns, setShowAllColumns] = useState(false);
  const [includePhonesInExport, setIncludePhonesInExport] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drawerStay, setDrawerStay] = useState<any | null>(null);
  const [drawerExtensions, setDrawerExtensions] = useState<any[]>([]);
  const [loadingExts, setLoadingExts] = useState(false);

  const p = usePaged<any>(['stays', applied], (from, to) =>
    applyStayFilters(supabase.from('guest_stays').select(COLS, { count: 'exact' }), applied)
      .order('check_in_time', { ascending: false })
      .order('id')
      .range(from, to),
  );

  // Load extensions for drawer stay
  useEffect(() => {
    if (!drawerStay?.id) {
      setDrawerExtensions([]);
      return;
    }
    let cancelled = false;
    setLoadingExts(true);
    supabase
      .from('stay_extensions')
      .select('id,extension_nights,extension_amount,amount_paid,balance_amount,payment_mode,payment_status,created_at')
      .eq('guest_stay_id', drawerStay.id)
      .then(({ data }) => {
        if (!cancelled) {
          setDrawerExtensions(data ?? []);
          setLoadingExts(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [drawerStay?.id]);

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      if (prev.has(id)) {
        const next = new Set(prev);
        // remove item without calling .delete() to satisfy check:readonly
        const filtered = Array.from(prev).filter((x) => x !== id);
        return new Set(filtered);
      }
      if (prev.size >= 25) {
        alert('Maximum 25 stays can be selected for batch printing.');
        return prev;
      }
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const selectAllPage = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const next = new Set<string>();
      for (const r of p.rows) {
        if (next.size >= 25) break;
        next.add(r.id);
      }
      setSelectedIds(next);
    } else {
      setSelectedIds(new Set());
    }
  };

  const printSelected = () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds).join(',');
    navigate(`/stays/print?ids=${encodeURIComponent(ids)}`);
  };

  // Default columns: GRC, Guest, Phone, Hotel, Room, Check-in, Expected check-out, Nights, Guests, Status, Total, Paid, Balance
  const defaultCols: Col<any>[] = useMemo(
    () => [
      {
        key: 'sel',
        header: '',
        render: (r) => (
          <input
            type="checkbox"
            checked={selectedIds.has(r.id)}
            onClick={(e) => toggleSelect(r.id, e)}
            onChange={() => {}}
            aria-label={`Select stay ${r.id}`}
          />
        ),
      },
      {
        key: 'grc',
        header: 'GRC',
        render: (r) => (
          <span style={{ fontWeight: 600 }}>{dash(r.grc_number || r.id.slice(0, 8))}</span>
        ),
      },
      { key: 'guest', header: 'Guest', render: (r) => <strong>{r.guest_name ?? '—'}</strong> },
      { key: 'phone', header: 'Phone', render: (r) => r.guest_phone || '—' },
      { key: 'hotel', header: 'Hotel', render: (r) => lk.hotelName(r.hotel_id) },
      { key: 'room', header: 'Room', render: (r) => dash(r.room_number) },
      { key: 'in', header: 'Check-in', render: (r) => fmtDateTime(r.check_in_time) },
      {
        key: 'cout',
        header: 'Expected check-out',
        render: (r) => fmtDateTime(r.current_check_out_time),
      },
      { key: 'n', header: 'Nights', align: 'r', render: (r) => int(r.number_of_nights) },
      { key: 'g', header: 'Guests', align: 'r', render: (r) => int(r.number_of_guests) },
      {
        key: 'st',
        header: 'Status',
        render: (r) => (
          <Badge tone={stayTone[classifyStay(r.stay_status, r.checked_out_at)]}>
            {dash(r.stay_status)}
          </Badge>
        ),
      },
      { key: 'tot', header: 'Total', align: 'r', render: (r) => inr(tot(r)) },
      { key: 'paid', header: 'Paid', align: 'r', render: (r) => inr(r.amount_paid) },
      { key: 'bal', header: 'Balance', align: 'r', render: (r) => inr(bal(r)) },
      {
        key: 'act',
        header: 'Actions',
        render: (r) => (
          <button
            className="btn sm"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/stays/print/${r.id}`);
            }}
            title="Print Guest Registration Card"
          >
            🖨️ GRC
          </button>
        ),
      },
    ],
    [lk, selectedIds, navigate],
  );

  const additionalCols: Col<any>[] = useMemo(
    () => [
      { key: 'bk', header: 'Booking ID', render: (r) => dash(r.booking_id) },
      { key: 'src', header: 'Source', render: (r) => dash(r.source) },
      { key: 'oout', header: 'Orig. check-out', render: (r) => fmtDateTime(r.original_check_out_time) },
      { key: 'aout', header: 'Actual check-out', render: (r) => fmtDateTime(r.checked_out_at) },
      { key: 'rm', header: 'Rooms', align: 'r', render: (r) => int(r.number_of_rooms) },
      {
        key: 'ps',
        header: 'Payment status',
        render: (r) => (
          <Badge tone={payTone[classifyPayment(tot(r), num(r.amount_paid), bal(r))]}>
            {dash(r.payment_status)}
          </Badge>
        ),
      },
      { key: 'pm', header: 'Payment mode', render: (r) => dash(r.payment_mode) },
      { key: 'rec', header: 'Receptionist', render: (r) => lk.recName(r.receptionist_id) },
    ],
    [lk],
  );

  const activeCols = useMemo(() => {
    if (!showAllColumns) return defaultCols;
    // Insert additional columns before actions column
    const defaultWithoutAct = defaultCols.slice(0, defaultCols.length - 1);
    const actCol = defaultCols[defaultCols.length - 1];
    return [...defaultWithoutAct, ...additionalCols, actCol];
  }, [showAllColumns, defaultCols, additionalCols]);

  // Export stays
  const getRows = async () => {
    const { rows } = await fetchAll<any>(
      () =>
        applyStayFilters(supabase.from('guest_stays').select(COLS, { count: 'exact' }), applied)
          .order('check_in_time', { ascending: false })
          .order('id'),
      30000,
    );
    return rows.map((r) => ({
      GRC: r.grc_number || r.id.slice(0, 8),
      Guest: r.guest_name,
      Phone: includePhonesInExport ? r.guest_phone : maskPhone(r.guest_phone, '*'),
      Hotel: lk.hotelName(r.hotel_id),
      Room: r.room_number,
      'Check-in': fmtDateTime(r.check_in_time),
      'Expected check-out': fmtDateTime(r.current_check_out_time),
      'Actual check-out': fmtDateTime(r.checked_out_at),
      Nights: r.number_of_nights,
      Guests: r.number_of_guests,
      Rooms: r.number_of_rooms,
      Status: r.stay_status,
      'Payment status': r.payment_status,
      'Payment mode': r.payment_mode,
      Total: tot(r),
      Paid: num(r.amount_paid),
      Balance: bal(r),
      Receptionist: lk.recName(r.receptionist_id),
      'Booking ID': r.booking_id,
    }));
  };

  return (
    <>
      <PageHead
        title="Guest Stays"
        sub="Complete guest check-in records and registration cards. Click any row for details."
        right={
          <div className="fact" style={{ gap: 10 }}>
            {selectedIds.size > 0 ? (
              <button className="btn primary" onClick={printSelected}>
                🖨️ Print Selected ({selectedIds.size})
              </button>
            ) : null}
            <button
              className={`btn sm ${showAllColumns ? 'primary' : ''}`}
              onClick={() => setShowAllColumns((v) => !v)}
            >
              {showAllColumns ? 'Default columns' : 'Columns toggle (+8)'}
            </button>
            <label className="fact" style={{ fontSize: 12.5, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includePhonesInExport}
                onChange={(e) => setIncludePhonesInExport(e.target.checked)}
              />
              Include phone numbers in export
            </label>
            <ExportMenu name="guest-stays" title="Guest stays" getRows={getRows} />
          </div>
        }
      />

      <FilterBar />

      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <Kpi label="Matching stays" value={int(p.total)} sub="in selected period" />
      </div>

      <Card flush>
        <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--line)', background: 'var(--panel2)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={p.rows.length > 0 && selectedIds.size === Math.min(25, p.rows.length)}
            onChange={selectAllPage}
            aria-label="Select all on this page"
          />
          <span className="muted">Select up to 25 stays to print GRCs in batch. Click any row to view full details.</span>
        </div>
        <DataTable
          cols={activeCols}
          rows={p.rows}
          loading={p.loading}
          error={p.error}
          page={p.page}
          pageSize={p.pageSize}
          total={p.total}
          onPage={p.setPage}
          rowKey={(r) => r.id}
          onRowClick={(r) => setDrawerStay(r)}
        />
      </Card>

      {/* Guest Detail Drawer */}
      {drawerStay ? (
        <div className="drawer-backdrop" onClick={() => setDrawerStay(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h2>{drawerStay.guest_name || 'Guest Details'}</h2>
                <span className="muted" style={{ fontSize: 12 }}>
                  GRC: {drawerStay.grc_number || drawerStay.id.slice(0, 8)} · Room {drawerStay.room_number || '—'}
                </span>
              </div>
              <button className="btn sm" onClick={() => setDrawerStay(null)}>✕</button>
            </div>

            <div className="drawer-body">
              {/* Quick Actions */}
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className="btn primary"
                  style={{ flex: 1 }}
                  onClick={() => navigate(`/stays/print/${drawerStay.id}`)}
                >
                  🖨️ Print GRC
                </button>
              </div>

              {/* Guest Information */}
              <Card title="Guest Information">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                  <div><span className="muted" style={{ display: 'block', fontSize: 11 }}>Guest Name</span><strong>{drawerStay.guest_name || '—'}</strong></div>
                  <div><span className="muted" style={{ display: 'block', fontSize: 11 }}>Phone Number</span><strong>{drawerStay.guest_phone || '—'}</strong></div>
                  <div><span className="muted" style={{ display: 'block', fontSize: 11 }}>Booking ID</span>{dash(drawerStay.booking_id)}</div>
                  <div><span className="muted" style={{ display: 'block', fontSize: 11 }}>Source</span>{dash(drawerStay.source)}</div>
                  <div style={{ gridColumn: 'span 2' }}><span className="muted" style={{ display: 'block', fontSize: 11 }}>Purpose of Visit</span>{dash(drawerStay.purpose_of_visit)}</div>
                </div>
              </Card>

              {/* Stay & Room Details */}
              <Card title="Stay & Room Details">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                  <div><span className="muted" style={{ display: 'block', fontSize: 11 }}>Hotel</span><strong>{lk.hotelName(drawerStay.hotel_id)}</strong></div>
                  <div><span className="muted" style={{ display: 'block', fontSize: 11 }}>Room Number</span><strong>{dash(drawerStay.room_number)}</strong></div>
                  <div><span className="muted" style={{ display: 'block', fontSize: 11 }}>Check-in</span>{fmtDateTime(drawerStay.check_in_time)}</div>
                  <div><span className="muted" style={{ display: 'block', fontSize: 11 }}>Expected Check-out</span>{fmtDateTime(drawerStay.current_check_out_time)}</div>
                  {drawerStay.checked_out_at ? <div><span className="muted" style={{ display: 'block', fontSize: 11 }}>Actual Check-out</span>{fmtDateTime(drawerStay.checked_out_at)}</div> : null}
                  <div><span className="muted" style={{ display: 'block', fontSize: 11 }}>Nights / Rooms</span>{drawerStay.number_of_nights ?? 1} nights · {drawerStay.number_of_rooms ?? 1} room(s)</div>
                  <div><span className="muted" style={{ display: 'block', fontSize: 11 }}>Guests</span>{drawerStay.number_of_guests ?? 1} guest(s)</div>
                  <div><span className="muted" style={{ display: 'block', fontSize: 11 }}>Attending Receptionist</span>{lk.recName(drawerStay.receptionist_id)}</div>
                </div>
              </Card>

              {/* Billing & Payment Split */}
              <Card title="Billing & Payment Split">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13, marginBottom: 12 }}>
                  <div><span className="muted" style={{ display: 'block', fontSize: 11 }}>Total Amount</span><strong>{inr(tot(drawerStay))}</strong></div>
                  <div><span className="muted" style={{ display: 'block', fontSize: 11 }}>Amount Paid</span><strong style={{ color: 'var(--good)' }}>{inr(drawerStay.amount_paid)}</strong></div>
                  <div><span className="muted" style={{ display: 'block', fontSize: 11 }}>Balance Amount</span><strong style={{ color: Number(drawerStay.balance_amount) > 0 ? 'var(--warn)' : 'inherit' }}>{inr(drawerStay.balance_amount)}</strong></div>
                  <div><span className="muted" style={{ display: 'block', fontSize: 11 }}>Primary Mode</span>{dash(drawerStay.payment_mode)}</div>
                </div>

                <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, textAlign: 'center', fontSize: 12 }}>
                  <div style={{ background: 'var(--panel2)', padding: 6, borderRadius: 6 }}>
                    <div className="muted" style={{ fontSize: 10 }}>Cash</div>
                    <strong>{inr(drawerStay.cash_amount)}</strong>
                  </div>
                  <div style={{ background: 'var(--panel2)', padding: 6, borderRadius: 6 }}>
                    <div className="muted" style={{ fontSize: 10 }}>GPay</div>
                    <strong>{inr(drawerStay.gpay_amount)}</strong>
                  </div>
                  <div style={{ background: 'var(--panel2)', padding: 6, borderRadius: 6 }}>
                    <div className="muted" style={{ fontSize: 10 }}>Card</div>
                    <strong>{inr(drawerStay.card_amount)}</strong>
                  </div>
                  <div style={{ background: 'var(--panel2)', padding: 6, borderRadius: 6 }}>
                    <div className="muted" style={{ fontSize: 10 }}>Online</div>
                    <strong>{inr(drawerStay.online_amount)}</strong>
                  </div>
                </div>
              </Card>

              {/* Stay Extensions */}
              <Card title="Extensions for this Stay">
                {loadingExts ? (
                  <div style={{ padding: 12, textAlign: 'center' }} className="muted">Loading extensions…</div>
                ) : drawerExtensions.length === 0 ? (
                  <div className="muted" style={{ fontSize: 12.5, padding: '6px 0' }}>No extensions recorded for this stay.</div>
                ) : (
                  <div className="tw">
                    <table style={{ fontSize: 12 }}>
                      <thead>
                        <tr><th>Date</th><th>Nights</th><th>Amount</th><th>Paid</th><th>Mode</th></tr>
                      </thead>
                      <tbody>
                        {drawerExtensions.map((x) => (
                          <tr key={x.id}>
                            <td>{fmtDateTime(x.created_at)}</td>
                            <td>{x.extension_nights}</td>
                            <td>{inr(x.extension_amount)}</td>
                            <td>{inr(x.amount_paid)}</td>
                            <td>{dash(x.payment_mode)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700, textAlign: 'right' }}>
                      Total after extensions:{' '}
                      {inr(
                        num(drawerStay.total_amount ?? drawerStay.amount) +
                          drawerExtensions.reduce((a, b) => a + num(b.extension_amount), 0),
                      )}
                    </div>
                  </div>
                )}
              </Card>
            </div>

            <div className="drawer-footer">
              <button
                className="btn primary"
                onClick={() => window.open(`/stays/print/${drawerStay.id}`, '_blank')}
              >
                🖨️ Print GRC
              </button>
              <button className="btn" onClick={() => setDrawerStay(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
