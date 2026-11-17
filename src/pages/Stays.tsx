import { useState, useMemo } from 'react';
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

// Explicit column list. id_proof_*, guest_address and every OTP field are deliberately not selected.
const COLS =
  'id,guest_name,guest_phone,hotel_id,room_number,grc_number,check_in_time,original_check_out_time,current_check_out_time,checked_out_at,number_of_nights,number_of_guests,number_of_rooms,stay_status,payment_status,total_amount,amount,amount_paid,balance_amount,receptionist_id,booking_id';

const bal = (r: any) =>
  r.balance_amount != null ? num(r.balance_amount) : Math.max(0, num(r.total_amount ?? r.amount) - num(r.amount_paid));
const tot = (r: any) => num(r.total_amount ?? r.amount);

export function Stays() {
  const { applied } = useFilters();
  const lk = useLookups();
  const [showAllColumns, setShowAllColumns] = useState(false);

  const p = usePaged<any>(['stays', applied], (from, to) =>
    applyStayFilters(supabase.from('guest_stays').select(COLS, { count: 'exact' }), applied)
      .order('check_in_time', { ascending: false })
      .order('id')
      .range(from, to),
  );

  // Default 10 columns as requested by Step 4:
  // Guest, Phone (masked), Hotel, Room, Check-in, Current check-out, Status, Total, Paid, Balance
  const defaultCols: Col<any>[] = useMemo(
    () => [
      { key: 'guest', header: 'Guest', render: (r) => r.guest_name ?? '—' },
      { key: 'phone', header: 'Phone', render: (r) => maskPhone(r.guest_phone) },
      { key: 'hotel', header: 'Hotel', render: (r) => lk.hotelName(r.hotel_id) },
      { key: 'room', header: 'Room', render: (r) => dash(r.room_number) },
      { key: 'in', header: 'Check-in', render: (r) => fmtDateTime(r.check_in_time) },
      { key: 'cout', header: 'Current check-out', render: (r) => fmtDateTime(r.current_check_out_time) },
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
    ],
    [lk],
  );

  // Additional columns revealed when toggle is enabled
  const additionalCols: Col<any>[] = useMemo(
    () => [
      { key: 'grc', header: 'GRC', render: (r) => dash(r.grc_number) },
      { key: 'oout', header: 'Orig. check-out', render: (r) => fmtDateTime(r.original_check_out_time) },
      { key: 'aout', header: 'Actual check-out', render: (r) => fmtDateTime(r.checked_out_at) },
      { key: 'n', header: 'Nights', align: 'r', render: (r) => int(r.number_of_nights) },
      { key: 'g', header: 'Guests', align: 'r', render: (r) => int(r.number_of_guests) },
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
      { key: 'rec', header: 'Receptionist', render: (r) => lk.recName(r.receptionist_id) },
      { key: 'bk', header: 'Booking ID', render: (r) => dash(r.booking_id) },
    ],
    [lk],
  );

  const activeCols = useMemo(
    () => (showAllColumns ? [...defaultCols, ...additionalCols] : defaultCols),
    [showAllColumns, defaultCols, additionalCols],
  );

  // Export reads the same filters server-side; phone numbers stay masked in files.
  const getRows = async () => {
    const { rows } = await fetchAll<any>(
      () =>
        applyStayFilters(supabase.from('guest_stays').select(COLS, { count: 'exact' }), applied)
          .order('check_in_time', { ascending: false })
          .order('id'),
      30000,
    );
    return rows.map((r) => ({
      Guest: r.guest_name,
      Phone: maskPhone(r.guest_phone, '*'),
      Hotel: lk.hotelName(r.hotel_id),
      Room: r.room_number,
      GRC: r.grc_number,
      'Check-in': fmtDateTime(r.check_in_time),
      'Original check-out': fmtDateTime(r.original_check_out_time),
      'Current check-out': fmtDateTime(r.current_check_out_time),
      'Actual check-out': fmtDateTime(r.checked_out_at),
      Nights: r.number_of_nights,
      Guests: r.number_of_guests,
      Rooms: r.number_of_rooms,
      'Stay status': r.stay_status,
      'Payment status': r.payment_status,
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
        title="Guest stays"
        sub="Server-side filtered and paginated. Filtered by selected date field (IST)."
        right={
          <span className="fact" style={{ gap: 12 }}>
            <button
              className={`btn sm ${showAllColumns ? 'primary' : ''}`}
              onClick={() => setShowAllColumns((v) => !v)}
            >
              {showAllColumns ? 'Default columns' : 'Columns toggle (+9)'}
            </button>
            <ExportMenu name="guest-stays" title="Guest stays" getRows={getRows} />
          </span>
        }
      />

      <FilterBar />

      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <Kpi label="Matching stays" value={int(p.total)} />
      </div>

      <Card flush>
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
        />
      </Card>
    </>
  );
}
