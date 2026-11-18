import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useFilters } from '../state/filters';
import { Filters, FILTER_LABELS, DateField, DATE_FIELD_LABELS } from '../lib/filters';
import { PRESET_LABELS, Preset } from '../lib/ist';
import { useDistinct, useLookups } from '../hooks/data';
import { env } from '../config';

type Field = keyof Filters;

function DistinctSelect({
  label,
  value,
  onChange,
  table,
  column,
  extraOptions = [],
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  table: string;
  column: string;
  extraOptions?: string[];
}) {
  const q = useDistinct(table, column);
  const allOpts = useMemo(() => {
    const list = Array.from(new Set([...(q.data ?? []), ...extraOptions]));
    return list.filter(Boolean);
  }, [q.data, extraOptions]);

  return (
    <label className="f">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {allOpts.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
        {value && !allOpts.includes(value) ? <option value={value}>{value}</option> : null}
      </select>
    </label>
  );
}

function HotelMultiSelect({
  value,
  onChange,
  hotels,
}: {
  value: string;
  onChange: (v: string) => void;
  hotels: { id: string; hotel_name: string; hotel_code: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => (value ? value.split(',').map((x) => x.trim()).filter(Boolean) : []), [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const toggle = (id: string) => {
    let next: string[];
    if (selected.includes(id)) {
      next = selected.filter((x) => x !== id);
    } else {
      next = [...selected, id];
    }
    onChange(next.join(','));
  };

  const selectAll = () => onChange('');

  const label = useMemo(() => {
    if (selected.length === 0) return 'All hotels';
    if (selected.length === 1) {
      const h = hotels.find((x) => x.id === selected[0]);
      return h ? h.hotel_name : '1 hotel';
    }
    return `${selected.length} hotels selected`;
  }, [selected, hotels]);

  return (
    <div className="f" ref={ref} style={{ position: 'relative' }}>
      <label>Hotels</label>
      <button
        type="button"
        className="btn"
        style={{
          textAlign: 'left',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          minWidth: 160,
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          fontWeight: 400,
          height: 36,
          borderRadius: 8,
          padding: '0 10px',
        }}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
          {label}
        </span>
        <span style={{ fontSize: 10, marginLeft: 6, color: 'var(--muted)' }}>▼</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 6,
            width: 280,
            maxHeight: 280,
            overflowY: 'auto',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.1)',
            zIndex: 100,
            padding: 8,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '4px 6px',
              borderBottom: '1px solid var(--line)',
              marginBottom: 6,
            }}
          >
            <button type="button" className="btn sm" onClick={selectAll} style={{ fontSize: 11 }}>
              Select All (Reset)
            </button>
            <button type="button" className="btn sm primary" onClick={() => setOpen(false)} style={{ fontSize: 11 }}>
              Done
            </button>
          </div>
          {hotels.map((h) => {
            const isChecked = selected.includes(h.id);
            return (
              <label
                key={h.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 6px',
                  cursor: 'pointer',
                  fontSize: 12.5,
                  borderRadius: 4,
                  userSelect: 'none',
                }}
              >
                <input type="checkbox" checked={isChecked} onChange={() => toggle(h.id)} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {h.hotel_name} {h.hotel_code ? `(${h.hotel_code})` : ''}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const SHARED_FIELDS: Field[] = [
  'preset',
  'dateField',
  'from',
  'to',
  'paymentStatus',
  'guestName',
  'guestPhone',
  'roomNumber',
  'grc',
  'bookingId',
];

export const REVENUE_FIELDS: Field[] = [
  'hotelId',
  'source',
  'paymentMode',
  'paymentStatus',
  'dateField',
  'preset',
  'from',
  'to',
  'receptionistId',
];

export function FilterBar({
  fields = SHARED_FIELDS,
  sticky = false,
}: {
  fields?: Field[];
  sticky?: boolean;
}) {
  const { draft, applied, setDraft, setFilterInstant, setPreset, setDateField, setHotel, apply, clear, remove } = useFilters();
  const lk = useLookups();
  const minDate = `${env.dataStart || '2026-10-18'}T00:00`;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const has = (f: Field) => fields.includes(f);

  // Debounced auto-apply for text inputs
  const handleTextChange = (patch: Partial<Filters>) => {
    setDraft(patch);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      apply();
    }, 350);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      apply();
    }
  };

  const handleApplyClick = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    apply();
  };

  // Build active filter chips
  const chips: { k: Field; text: string }[] = [];

  if (has('hotelId') && applied.hotelId) {
    const list = applied.hotelId.split(',').filter(Boolean);
    if (list.length === 1) {
      chips.push({ k: 'hotelId', text: `Hotel: ${lk.hotelName(list[0])}` });
    } else {
      chips.push({ k: 'hotelId', text: `Hotels: ${list.length} selected` });
    }
  }

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
    chips.push({ k: f, text: `${FILTER_LABELS[f]}: ${v}` });
  }

  return (
    <section
      className="card filters"
      onKeyDown={onKey}
      style={{
        marginBottom: 18,
        ...(sticky
          ? {
              position: 'sticky',
              top: 0,
              zIndex: 15,
              background: 'var(--panel)',
              borderBottom: '1px solid var(--line)',
            }
          : {}),
      }}
    >
      <div className="frow" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: 12, alignItems: 'end' }}>
        {has('hotelId') ? (
          <HotelMultiSelect
            value={draft.hotelId}
            onChange={(v) => {
              setFilterInstant({ hotelId: v });
            }}
            hotels={lk.hotels}
          />
        ) : null}

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
            <select value={draft.dateField} onChange={(e) => setDateField(e.target.value as DateField)}>
              {(Object.keys(DATE_FIELD_LABELS) as DateField[]).map((df) => (
                <option key={df} value={df}>
                  {DATE_FIELD_LABELS[df]}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {has('from') && (draft.preset === 'custom' || has('from')) ? (
          <label className="f" style={{ minWidth: 195 }}>
            From (IST)
            <input
              type="datetime-local"
              min={minDate}
              value={draft.from}
              onChange={(e) => {
                const val = e.target.value;
                setDraft({ from: val, preset: 'custom' });
                if (debounceRef.current) clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => {
                  apply();
                }, 500);
              }}
            />
          </label>
        ) : null}

        {has('to') && (draft.preset === 'custom' || has('to')) ? (
          <label className="f" style={{ minWidth: 195 }}>
            To (IST)
            <input
              type="datetime-local"
              min={minDate}
              value={draft.to}
              onChange={(e) => {
                const val = e.target.value;
                setDraft({ to: val, preset: 'custom' });
                if (debounceRef.current) clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => {
                  apply();
                }, 500);
              }}
            />
          </label>
        ) : null}

        {has('source') ? (
          <DistinctSelect
            label="Source"
            value={draft.source}
            onChange={(v) => setFilterInstant({ source: v })}
            table="guest_stays"
            column="source"
            extraOptions={['Direct', 'Walk-in', 'MMT', 'Agoda', 'Booking.com', 'Not set']}
          />
        ) : null}

        {has('paymentMode') ? (
          <DistinctSelect
            label="Payment mode"
            value={draft.paymentMode}
            onChange={(v) => setFilterInstant({ paymentMode: v })}
            table="guest_stays"
            column="payment_mode"
            extraOptions={['Cash', 'GPay', 'Card', 'Online']}
          />
        ) : null}

        {has('paymentStatus') ? (
          <DistinctSelect
            label="Payment status"
            value={draft.paymentStatus}
            onChange={(v) => setFilterInstant({ paymentStatus: v })}
            table="guest_stays"
            column="payment_status"
          />
        ) : null}

        {has('receptionistId') ? (
          <label className="f">
            Receptionist
            <select value={draft.receptionistId} onChange={(e) => setFilterInstant({ receptionistId: e.target.value })}>
              <option value="">All</option>
              {lk.receptionists.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || 'Unknown'}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {has('guestName') ? (
          <label className="f">
            Guest name
            <input
              value={draft.guestName}
              onChange={(e) => handleTextChange({ guestName: e.target.value })}
              placeholder="Search name…"
            />
          </label>
        ) : null}

        {has('guestPhone') ? (
          <label className="f">
            Phone
            <input
              value={draft.guestPhone}
              onChange={(e) => handleTextChange({ guestPhone: e.target.value })}
              placeholder="Search phone…"
            />
          </label>
        ) : null}

        {has('roomNumber') ? (
          <label className="f">
            Room
            <input
              value={draft.roomNumber}
              onChange={(e) => handleTextChange({ roomNumber: e.target.value })}
              placeholder="Room #"
            />
          </label>
        ) : null}

        {has('grc') ? (
          <label className="f">
            GRC
            <input
              value={draft.grc}
              onChange={(e) => handleTextChange({ grc: e.target.value })}
              placeholder="GRC #"
            />
          </label>
        ) : null}

        {has('bookingId') ? (
          <label className="f">
            Booking ID
            <input
              value={draft.bookingId}
              onChange={(e) => handleTextChange({ bookingId: e.target.value })}
              placeholder="Booking ID…"
            />
          </label>
        ) : null}
      </div>

      <div
        className="fact"
        style={{
          marginTop: 12,
          paddingTop: 8,
          borderTop: '1px solid var(--line)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div className="chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {chips.length > 0 ? (
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginRight: 4 }}>
              Active Filters ({chips.length}):
            </span>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
              No custom filters active (showing default period)
            </span>
          )}
          {chips.map((c) => (
            <span className="chip" key={c.k}>
              {c.text}
              <button aria-label={`Remove ${FILTER_LABELS[c.k]} filter`} onClick={() => remove(c.k)}>
                ×
              </button>
            </span>
          ))}
        </div>
        <span className="fact" style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="btn sm" onClick={clear} title="Reset all filters to defaults">
            Clear filters
          </button>
          <button className="btn sm primary" onClick={handleApplyClick} title="Apply text filters immediately">
            Apply filters
          </button>
        </span>
      </div>
    </section>
  );
}
