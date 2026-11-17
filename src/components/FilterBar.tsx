import React, { useMemo } from 'react';
import { useFilters } from '../state/filters';
import { Filters, FILTER_LABELS, DateField, DATE_FIELD_LABELS } from '../lib/filters';
import { PRESET_LABELS, Preset } from '../lib/ist';
import { useDistinct, useLookups } from '../hooks/data';

type Field = keyof Filters;

function DistinctSelect({
  label,
  value,
  onChange,
  table,
  column,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  table: string;
  column: string;
}) {
  const q = useDistinct(table, column);
  return (
    <label className="f">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {(q.data ?? []).map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
        {value && !(q.data ?? []).includes(value) ? <option value={value}>{value}</option> : null}
      </select>
    </label>
  );
}

const ALL_FIELDS: Field[] = [
  'preset',
  'dateField',
  'from',
  'to',
  'receptionistId',
  'stayStatus',
  'paymentStatus',
  'paymentMode',
  'guestName',
  'guestPhone',
  'roomNumber',
  'grc',
  'bookingId',
];

export function FilterBar({
  fields = ALL_FIELDS,
  reviewTable = 'review_followups',
}: {
  fields?: Field[];
  reviewTable?: string;
}) {
  const { draft, applied, setDraft, setPreset, setDateField, apply, clear, remove } = useFilters();
  const lk = useLookups();

  const recs = useMemo(
    () => lk.receptionists.filter((r) => !draft.hotelId || r.hotel_id === draft.hotelId),
    [lk.receptionists, draft.hotelId],
  );

  const has = (f: Field) => fields.includes(f);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') apply();
  };

  // Build active filter chips
  const chips: { k: Field; text: string }[] = [];
  if (has('preset')) {
    const text =
      applied.preset === 'custom'
        ? `${applied.from ? applied.from.replace('T', ' ') : '…'} → ${
            applied.to ? applied.to.replace('T', ' ') : '…'
          }`
        : PRESET_LABELS[applied.preset];
    chips.push({ k: 'preset', text: `Period: ${text}` });
  }

  if (has('dateField') && applied.dateField !== 'check_in_time') {
    chips.push({ k: 'dateField', text: `Date: ${DATE_FIELD_LABELS[applied.dateField]}` });
  }

  for (const f of fields) {
    if (f === 'preset' || f === 'from' || f === 'to' || f === 'hotelId' || f === 'dateField') continue;
    const v = applied[f];
    if (!v) continue;
    const shown = f === 'receptionistId' ? lk.recName(v) : v;
    chips.push({ k: f, text: `${FILTER_LABELS[f]}: ${shown}` });
  }

  return (
    <section className="card filters" onKeyDown={onKey} style={{ marginBottom: 20 }}>
      <div className="frow" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        {has('preset') ? (
          <label className="f">
            Period
            <select value={draft.preset} onChange={(e) => setPreset(e.target.value as Preset)}>
              {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
                <option key={p} value={p}>
                  {PRESET_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {has('dateField') ? (
          <label className="f">
            Date field
            <select
              value={draft.dateField}
              onChange={(e) => setDateField(e.target.value as DateField)}
            >
              {(Object.keys(DATE_FIELD_LABELS) as DateField[]).map((df) => (
                <option key={df} value={df}>
                  {DATE_FIELD_LABELS[df]}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {has('from') && (draft.preset === 'custom' || has('from')) ? (
          <label className="f">
            From (IST)
            <input
              type="datetime-local"
              value={draft.from}
              onChange={(e) => setDraft({ from: e.target.value, preset: 'custom' })}
            />
          </label>
        ) : null}

        {has('to') && (draft.preset === 'custom' || has('to')) ? (
          <label className="f">
            To (IST)
            <input
              type="datetime-local"
              value={draft.to}
              onChange={(e) => setDraft({ to: e.target.value, preset: 'custom' })}
            />
          </label>
        ) : null}

        {has('receptionistId') ? (
          <label className="f">
            Receptionist
            <select
              value={draft.receptionistId}
              onChange={(e) => setDraft({ receptionistId: e.target.value })}
            >
              <option value="">All</option>
              {recs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name ?? r.email ?? r.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {has('stayStatus') ? (
          <DistinctSelect
            label="Stay status"
            value={draft.stayStatus}
            onChange={(v) => setDraft({ stayStatus: v })}
            table="guest_stays"
            column="stay_status"
          />
        ) : null}

        {has('paymentStatus') ? (
          <DistinctSelect
            label="Payment status"
            value={draft.paymentStatus}
            onChange={(v) => setDraft({ paymentStatus: v })}
            table="guest_stays"
            column="payment_status"
          />
        ) : null}

        {has('paymentMode') ? (
          <label className="f">
            Payment mode
            <select
              value={draft.paymentMode}
              onChange={(e) => setDraft({ paymentMode: e.target.value })}
            >
              <option value="">All</option>
              {['Cash', 'GPay', 'Card', 'Online'].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {has('otpStatus') ? (
          <DistinctSelect
            label="OTP status"
            value={draft.otpStatus}
            onChange={(v) => setDraft({ otpStatus: v })}
            table="guest_verifications"
            column="otp_status"
          />
        ) : null}

        {has('reviewStatus') ? (
          <DistinctSelect
            label="Review status"
            value={draft.reviewStatus}
            onChange={(v) => setDraft({ reviewStatus: v })}
            table={reviewTable}
            column="review_status"
          />
        ) : null}

        {has('guestName') ? (
          <label className="f">
            Guest name
            <input
              value={draft.guestName}
              onChange={(e) => setDraft({ guestName: e.target.value })}
              placeholder="Search name…"
            />
          </label>
        ) : null}

        {has('guestPhone') ? (
          <label className="f">
            Phone
            <input
              value={draft.guestPhone}
              onChange={(e) => setDraft({ guestPhone: e.target.value })}
              placeholder="Search phone…"
            />
          </label>
        ) : null}

        {has('roomNumber') ? (
          <label className="f">
            Room
            <input
              value={draft.roomNumber}
              onChange={(e) => setDraft({ roomNumber: e.target.value })}
              placeholder="Room #"
            />
          </label>
        ) : null}

        {has('grc') ? (
          <label className="f">
            GRC
            <input
              value={draft.grc}
              onChange={(e) => setDraft({ grc: e.target.value })}
              placeholder="GRC #"
            />
          </label>
        ) : null}

        {has('bookingId') ? (
          <label className="f">
            Booking ID
            <input
              value={draft.bookingId}
              onChange={(e) => setDraft({ bookingId: e.target.value })}
              placeholder="Booking ID…"
            />
          </label>
        ) : null}
      </div>

      <div
        className="fact"
        style={{
          marginTop: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div className="chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {chips.map((c) => (
            <span className="chip" key={c.k}>
              {c.text}
              <button aria-label={`Remove ${FILTER_LABELS[c.k]} filter`} onClick={() => remove(c.k)}>
                ×
              </button>
            </span>
          ))}
        </div>
        <span className="fact" style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={clear}>
            Clear filters
          </button>
          <button className="btn primary" onClick={apply}>
            Apply filters
          </button>
        </span>
      </div>
    </section>
  );
}
