import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Filters, defaultFilters, DateField } from '../lib/filters';
import { Preset, presetRange } from '../lib/ist';

interface FilterCtx {
  applied: Filters;
  draft: Filters;
  setDraft: (patch: Partial<Filters>) => void;
  setFilterInstant: (patch: Partial<Filters>) => void;
  setPreset: (p: Preset) => void;
  setDateField: (df: DateField) => void;
  apply: () => void;
  clear: () => void;
  setHotel: (id: string) => void;
  remove: (k: keyof Filters) => void;
}

const Ctx = createContext<FilterCtx>(null as any);
export const useFilters = () => useContext(Ctx);

/** Convert search params to Filters object */
function parseParams(params: URLSearchParams): Filters {
  const def = defaultFilters();
  const preset = (params.get('preset') as Preset) || def.preset;
  const pRange = preset !== 'custom' ? presetRange(preset) : { from: '', to: '' };

  return {
    hotelId: params.get('hotelId') ?? def.hotelId,
    preset,
    from: params.get('from') || pRange.from,
    to: params.get('to') || pRange.to,
    dateField: (params.get('dateField') as DateField) ?? def.dateField,
    guestName: params.get('guestName') ?? def.guestName,
    guestPhone: params.get('guestPhone') ?? def.guestPhone,
    receptionistId: params.get('receptionistId') ?? def.receptionistId,
    source: params.get('source') ?? def.source,
    stayStatus: params.get('stayStatus') ?? def.stayStatus,
    paymentStatus: params.get('paymentStatus') ?? def.paymentStatus,
    paymentMode: params.get('paymentMode') ?? def.paymentMode,
    bookingId: params.get('bookingId') ?? def.bookingId,
    grc: params.get('grc') ?? def.grc,
    roomNumber: params.get('roomNumber') ?? def.roomNumber,
    otpStatus: params.get('otpStatus') ?? def.otpStatus,
    reviewStatus: params.get('reviewStatus') ?? def.reviewStatus,
  };
}

/** Serialize active filters to search params (omitting empty defaults) */
function serializeFilters(f: Filters): Record<string, string> {
  const def = defaultFilters();
  const out: Record<string, string> = {};

  if (f.hotelId) out.hotelId = f.hotelId;
  if (f.preset !== def.preset) out.preset = f.preset;
  if (f.from) out.from = f.from;
  if (f.to) out.to = f.to;
  if (f.dateField !== def.dateField) out.dateField = f.dateField;
  if (f.guestName) out.guestName = f.guestName;
  if (f.guestPhone) out.guestPhone = f.guestPhone;
  if (f.receptionistId) out.receptionistId = f.receptionistId;
  if (f.source) out.source = f.source;
  if (f.stayStatus) out.stayStatus = f.stayStatus;
  if (f.paymentStatus) out.paymentStatus = f.paymentStatus;
  if (f.paymentMode) out.paymentMode = f.paymentMode;
  if (f.bookingId) out.bookingId = f.bookingId;
  if (f.grc) out.grc = f.grc;
  if (f.roomNumber) out.roomNumber = f.roomNumber;
  if (f.otpStatus) out.otpStatus = f.otpStatus;
  if (f.reviewStatus) out.reviewStatus = f.reviewStatus;

  return out;
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const [applied, setApplied] = useState<Filters>(() => parseParams(searchParams));
  const [draft, setDraftState] = useState<Filters>(() => parseParams(searchParams));
  const lastSearchRef = useRef(searchParams.toString());

  // Sync state if URL changes externally (e.g. browser back/forward)
  useEffect(() => {
    const current = searchParams.toString();
    if (current !== lastSearchRef.current) {
      lastSearchRef.current = current;
      const fromUrl = parseParams(searchParams);
      setApplied(fromUrl);
      setDraftState(fromUrl);
    }
  }, [searchParams]);

  const updateUrl = useCallback(
    (next: Filters) => {
      const s = serializeFilters(next);
      lastSearchRef.current = new URLSearchParams(s).toString();
      setSearchParams(s, { replace: true });
    },
    [setSearchParams],
  );

  const setDraft = useCallback((patch: Partial<Filters>) => {
    setDraftState((d) => ({ ...d, ...patch }));
  }, []);

  // Update both draft and applied simultaneously
  const setFilterInstant = useCallback(
    (patch: Partial<Filters>) => {
      setDraftState((d) => {
        const next = { ...d, ...patch };
        setApplied(next);
        updateUrl(next);
        return next;
      });
    },
    [updateUrl],
  );

  // Preset applies instantly
  const setPreset = useCallback(
    (p: Preset) => {
      const dates = p === 'custom' ? {} : presetRange(p);
      setFilterInstant({ preset: p, ...dates });
    },
    [setFilterInstant],
  );

  // Date field applies instantly
  const setDateField = useCallback(
    (df: DateField) => {
      setFilterInstant({ dateField: df });
    },
    [setFilterInstant],
  );

  // Hotel applies instantly
  const setHotel = useCallback(
    (id: string) => {
      setFilterInstant({ hotelId: id });
    },
    [setFilterInstant],
  );

  // Text inputs & form apply on Enter or Apply button
  const apply = useCallback(() => {
    setDraftState((d) => {
      const dates = d.preset === 'custom' ? {} : presetRange(d.preset);
      const next = { ...d, ...dates };
      setApplied(next);
      updateUrl(next);
      return next;
    });
  }, [updateUrl]);

  const clear = useCallback(() => {
    const reset: Filters = {
      ...defaultFilters(),
      hotelId: applied.hotelId, // retain hotel context
    };
    setDraftState(reset);
    setApplied(reset);
    updateUrl(reset);
  }, [applied.hotelId, updateUrl]);

  const remove = useCallback(
    (k: keyof Filters) => {
      const def = defaultFilters();
      const patch: Partial<Filters> = { [k]: def[k] };
      if (k === 'preset') {
        Object.assign(patch, { preset: 'custom' as Preset, from: '', to: '' });
      }
      if (k === 'from' || k === 'to') {
        Object.assign(patch, { preset: 'custom' as Preset, [k]: '' });
      }
      setDraftState((prev) => {
        const next: Filters = { ...prev, ...patch };
        setApplied(next);
        updateUrl(next);
        return next;
      });
    },
    [updateUrl],
  );

  const value = useMemo(
    () => ({ applied, draft, setDraft, setFilterInstant, setPreset, setDateField, apply, clear, setHotel, remove }),
    [applied, draft, setDraft, setFilterInstant, setPreset, setDateField, apply, clear, setHotel, remove],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
