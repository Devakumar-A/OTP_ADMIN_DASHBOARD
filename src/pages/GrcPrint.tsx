import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fmtDateTime, inr, dash, formatIstTimeOnly } from '../lib/format';
import { Loading, ErrorBox } from '../components/ui';
import { num } from '../lib/finance';

interface GrcStay {
  id: string;
  hotel_id: string | null;
  receptionist_id: string | null;
  grc_number: string | null;
  booking_id: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  guest_address: string | null;
  id_proof_details: string | null;
  id_proof_number: string | null;
  purpose_of_visit: string | null;
  source: string | null;
  check_in_time: string | null;
  current_check_out_time: string | null;
  number_of_nights: number | null;
  number_of_rooms: number | null;
  number_of_guests: number | null;
  room_number: string | null;
  amount: number | null;
  total_amount: number | null;
  amount_paid: number | null;
  balance_amount: number | null;
  payment_mode: string | null;
  payment_status: string | null;
  cash_amount: number | null;
  gpay_amount: number | null;
  card_amount: number | null;
  online_amount: number | null;
  // Lookups & extras
  hotel_name?: string;
  hotel_code?: string;
  receptionist_name?: string;
  extensions?: any[];
}

const GRC_COLS =
  'id,hotel_id,receptionist_id,grc_number,booking_id,guest_name,guest_phone,guest_address,id_proof_details,id_proof_number,purpose_of_visit,source,check_in_time,current_check_out_time,number_of_nights,number_of_rooms,number_of_guests,room_number,amount,total_amount,amount_paid,balance_amount,payment_mode,payment_status,cash_amount,gpay_amount,card_amount,online_amount';

export function GrcPrint() {
  const { id } = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [stays, setStays] = useState<GrcStay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);
  const [alsoPrintGuestCopy, setAlsoPrintGuestCopy] = useState(false);
  const [printTimestamp] = useState(() => {
    const d = new Date();
    return `${d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })} ${formatIstTimeOnly(d)}`;
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const idsParam = searchParams.get('ids');
        const idList: string[] = id ? [id] : idsParam ? idsParam.split(',').filter(Boolean).slice(0, 25) : [];

        if (idList.length === 0) {
          throw new Error('No stay ID specified for GRC print.');
        }

        let loadedStays: GrcStay[] = [];

        if (idList.length === 1) {
          const { data, error: fetchErr } = await supabase
            .from('guest_stays')
            .select(GRC_COLS)
            .eq('id', idList[0])
            .single();

          if (fetchErr) throw fetchErr;
          if (data) loadedStays = [data as GrcStay];
        } else {
          const { data, error: fetchErr } = await supabase
            .from('guest_stays')
            .select(GRC_COLS)
            .in('id', idList);

          if (fetchErr) throw fetchErr;
          if (data) loadedStays = data as GrcStay[];
        }

        // Fetch hotel, receptionist lookups, and extensions
        const [hotelsRes, recsRes, extsRes] = await Promise.all([
          supabase.from('hotels').select('id,hotel_name,hotel_code'),
          supabase.from('receptionists').select('id,name'),
          supabase
            .from('stay_extensions')
            .select('id,guest_stay_id,extension_nights,extension_amount,amount_paid,balance_amount,payment_mode,created_at')
            .in('guest_stay_id', idList),
        ]);

        const hotelMap = new Map((hotelsRes.data ?? []).map((h: any) => [h.id, h]));
        const recMap = new Map((recsRes.data ?? []).map((r: any) => [r.id, r.name]));

        const extMap = new Map<string, any[]>();
        for (const x of extsRes.data ?? []) {
          if (x.guest_stay_id) {
            const list = extMap.get(x.guest_stay_id) ?? [];
            list.push(x);
            extMap.set(x.guest_stay_id, list);
          }
        }

        const enriched = loadedStays.map((s) => {
          const h = s.hotel_id ? hotelMap.get(s.hotel_id) : undefined;
          return {
            ...s,
            hotel_name: h?.hotel_name ?? 'Hotel',
            hotel_code: h?.hotel_code ?? '',
            receptionist_name: s.receptionist_id ? recMap.get(s.receptionist_id) ?? 'Front Desk' : 'Front Desk',
            extensions: extMap.get(s.id) ?? [],
          };
        });

        if (!cancelled) {
          setStays(enriched);
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, searchParams]);

  if (loading) {
    return (
      <div style={{ padding: 40 }}>
        <Loading rows={6} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40 }}>
        <ErrorBox error={error} />
        <button className="btn" onClick={() => navigate(-1)} style={{ marginTop: 16 }}>
          ← Go Back
        </button>
      </div>
    );
  }

  if (!stays.length) {
    return (
      <div style={{ padding: 40 }}>
        No stay records found.
        <button className="btn" onClick={() => navigate(-1)} style={{ marginLeft: 16 }}>
          ← Go Back
        </button>
      </div>
    );
  }

  // Render cards: each stay produces an OFFICE COPY, and optionally a GUEST COPY
  const renderCards: { stay: GrcStay; copyType: 'OFFICE COPY' | 'GUEST COPY' }[] = [];
  for (const s of stays) {
    renderCards.push({ stay: s, copyType: 'OFFICE COPY' });
    if (alsoPrintGuestCopy) {
      renderCards.push({ stay: s, copyType: 'GUEST COPY' });
    }
  }

  return (
    <div className="grc-print-container">
      {/* Action header bar (hidden when printing) */}
      <div
        className="grc-actions no-print"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          padding: '14px 24px',
          background: 'var(--panel)',
          borderBottom: '1px solid var(--border)',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn" onClick={() => navigate(-1)}>
            ← Back
          </button>
          <button className="btn primary" onClick={() => window.print()} style={{ fontWeight: 600 }}>
            🖨️ Print GRC ({renderCards.length} {renderCards.length === 1 ? 'page' : 'pages'})
          </button>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              cursor: 'pointer',
              marginLeft: 12,
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={alsoPrintGuestCopy}
              onChange={(e) => setAlsoPrintGuestCopy(e.target.checked)}
            />
            Also print Guest copy (badged "GUEST COPY")
          </label>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          Fits A4 single page. In print dialog: Paper = A4, Margins = Default/Minimum, Background graphics = ON.
        </span>
      </div>

      <div className="grc-pages-wrapper">
        {renderCards.map(({ stay: s, copyType }, idx) => {
          const bookedAmt = s.total_amount != null ? num(s.total_amount) : num(s.amount);
          const paidAmt = num(s.amount_paid);
          const balAmt = s.balance_amount != null ? num(s.balance_amount) : Math.max(0, bookedAmt - paidAmt);

          // Payment split string
          const splits: string[] = [];
          if (num(s.cash_amount) > 0) splits.push(`Cash: ₹${num(s.cash_amount)}`);
          if (num(s.gpay_amount) > 0) splits.push(`GPay: ₹${num(s.gpay_amount)}`);
          if (num(s.card_amount) > 0) splits.push(`Card: ₹${num(s.card_amount)}`);
          if (num(s.online_amount) > 0) splits.push(`Online: ₹${num(s.online_amount)}`);

          const extList = s.extensions ?? [];
          const totalExtAmt = extList.reduce((acc, x) => acc + num(x.extension_amount), 0);

          return (
            <div
              key={`${s.id}-${copyType}-${idx}`}
              className="grc-sheet-page"
              style={{
                pageBreakAfter: idx < renderCards.length - 1 ? 'always' : 'auto',
              }}
            >
              <div className="grc-card-a4">
                {/* Diagonal Watermark */}
                <div className="grc-watermark" aria-hidden="true">
                  {copyType}
                </div>

                {/* Top Letterhead Band */}
                <div className="grc-letterhead-band">
                  <div className="grc-logo-wrap">
                    <span className="grc-star-logo">★</span>
                    <div>
                      <div className="grc-brand-title">STARLIGHT HOTELS</div>
                      <div className="grc-hotel-sub">
                        {s.hotel_name} {s.hotel_code ? `· CODE: ${s.hotel_code}` : ''}
                      </div>
                    </div>
                  </div>

                  <div className="grc-title-center">
                    <div className="grc-doc-title">GUEST REGISTRATION CARD (GRC)</div>
                  </div>

                  <div className="grc-top-right">
                    <div className={`grc-copy-badge ${copyType === 'GUEST COPY' ? 'guest' : 'office'}`}>
                      {copyType}
                    </div>
                    <div className="grc-num-box">
                      <span className="grc-num-label">GRC NO.</span>
                      <strong className="grc-num-val">{s.grc_number || s.booking_id || s.id.slice(0, 8)}</strong>
                    </div>
                  </div>
                </div>

                {/* Section 1: Guest Details */}
                <div className="grc-box-section">
                  <div className="grc-sec-tag">GUEST DETAILS</div>
                  <div className="grc-grid-3">
                    <div className="grc-cell grc-span-2">
                      <span className="grc-lbl">GUEST FULL NAME</span>
                      <span className="grc-val-main">{s.guest_name || '—'}</span>
                    </div>
                    <div className="grc-cell">
                      <span className="grc-lbl">CONTACT PHONE</span>
                      <span className="grc-val-main">{s.guest_phone || '—'}</span>
                    </div>
                    <div className="grc-cell grc-span-2">
                      <span className="grc-lbl">RESIDENTIAL ADDRESS</span>
                      <span className="grc-val">{s.guest_address || '—'}</span>
                    </div>
                    <div className="grc-cell">
                      <span className="grc-lbl">PURPOSE OF VISIT</span>
                      <span className="grc-val">{s.purpose_of_visit || 'Personal / Leisure'}</span>
                    </div>
                  </div>
                </div>

                {/* Section 2: Identity Proof */}
                <div className="grc-box-section">
                  <div className="grc-sec-tag">IDENTITY PROOF</div>
                  <div className="grc-grid-2">
                    <div className="grc-cell">
                      <span className="grc-lbl">ID PROOF TYPE</span>
                      <span className="grc-val-main">{s.id_proof_details || 'Govt. Issued Photo ID'}</span>
                    </div>
                    <div className="grc-cell">
                      <span className="grc-lbl">ID PROOF NUMBER</span>
                      <span className="grc-val-main mono">{s.id_proof_number || '—'}</span>
                    </div>
                  </div>
                </div>

                {/* Section 3: Stay Details */}
                <div className="grc-box-section">
                  <div className="grc-sec-tag">STAY &amp; OCCUPANCY DETAILS</div>
                  <div className="grc-grid-4">
                    <div className="grc-cell">
                      <span className="grc-lbl">ROOM NUMBER</span>
                      <span className="grc-val-lg">{s.room_number || '—'}</span>
                    </div>
                    <div className="grc-cell">
                      <span className="grc-lbl">CHECK-IN TIME</span>
                      <span className="grc-val">{fmtDateTime(s.check_in_time)}</span>
                    </div>
                    <div className="grc-cell">
                      <span className="grc-lbl">EXPECTED CHECK-OUT</span>
                      <span className="grc-val">{fmtDateTime(s.current_check_out_time)}</span>
                    </div>
                    <div className="grc-cell">
                      <span className="grc-lbl">NIGHTS / ROOMS</span>
                      <span className="grc-val">
                        {s.number_of_nights ?? 1} Night(s) · {s.number_of_rooms ?? 1} Room(s)
                      </span>
                    </div>
                    <div className="grc-cell">
                      <span className="grc-lbl">NUMBER OF GUESTS</span>
                      <span className="grc-val">{s.number_of_guests ?? 1} Person(s)</span>
                    </div>
                    <div className="grc-cell">
                      <span className="grc-lbl">BOOKING ID</span>
                      <span className="grc-val mono">{s.booking_id || '—'}</span>
                    </div>
                    <div className="grc-cell">
                      <span className="grc-lbl">BOOKING SOURCE</span>
                      <span className="grc-val">{s.source || 'Direct / Walk-in'}</span>
                    </div>
                    <div className="grc-cell">
                      <span className="grc-lbl">ATTENDING RECEPTIONIST</span>
                      <span className="grc-val">{s.receptionist_name}</span>
                    </div>
                  </div>
                </div>

                {/* Section 4: Payment Details */}
                <div className="grc-box-section">
                  <div className="grc-sec-tag">PAYMENT DETAILS</div>
                  <div className="grc-grid-4">
                    <div className="grc-cell">
                      <span className="grc-lbl">TOTAL AMOUNT</span>
                      <span className="grc-val-main">{inr(bookedAmt)}</span>
                    </div>
                    <div className="grc-cell">
                      <span className="grc-lbl">AMOUNT PAID</span>
                      <span className="grc-val-main paid-green">{inr(paidAmt)}</span>
                    </div>
                    <div className="grc-cell">
                      <span className="grc-lbl">BALANCE PAYABLE</span>
                      <span className={`grc-val-main ${balAmt > 0 ? 'bal-warn' : ''}`}>{inr(balAmt)}</span>
                    </div>
                    <div className="grc-cell">
                      <span className="grc-lbl">PAYMENT MODE / STATUS</span>
                      <span className="grc-val">
                        {dash(s.payment_mode)} ({dash(s.payment_status)})
                      </span>
                    </div>
                  </div>

                  {/* Payment Splits & Extensions if any */}
                  <div className="grc-pay-split-bar">
                    {splits.length > 0 ? (
                      <span className="grc-split-item">
                        <strong>Split:</strong> {splits.join(' | ')}
                      </span>
                    ) : null}
                    {extList.length > 0 ? (
                      <span className="grc-split-item" style={{ marginLeft: splits.length > 0 ? 16 : 0 }}>
                        <strong>Stay Extensions:</strong> {extList.length} extension(s) ({inr(totalExtAmt)})
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Declaration Line */}
                <div className="grc-declaration-box">
                  <strong>Guest Declaration:</strong> I have read and agree to the hotel rules. The details given are
                  correct. I undertake full financial responsibility for all charges incurred during this stay.
                </div>

                {/* Signature Boxes & Footer */}
                <div className="grc-signatures-row">
                  <div className="grc-sig-box">
                    <div className="grc-sig-space" />
                    <div className="grc-sig-line-bar" />
                    <div className="grc-sig-title">Guest Signature</div>
                    <div className="grc-sig-date">Date: ____________________</div>
                  </div>

                  <div className="grc-sig-box">
                    <div className="grc-sig-space" />
                    <div className="grc-sig-line-bar" />
                    <div className="grc-sig-title">Front Desk / Authorized Signatory</div>
                    <div className="grc-sig-date">Date: ____________________</div>
                  </div>
                </div>

                {/* Printed Timestamp Footer */}
                <div className="grc-footer-note">
                  <span>STARLIGHT HOTELS · ALL RIGHTS RESERVED</span>
                  <span>Printed on {printTimestamp}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
