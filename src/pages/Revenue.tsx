import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFilters } from '../state/filters';
import { FilterBar, REVENUE_FIELDS } from '../components/FilterBar';
import { PageHead, Card, Kpi, Loading, ErrorBox, Badge, InfoTooltip } from '../components/ui';
import { Bars, Donut } from '../components/Charts';
import { ReportTable, ReportCol } from '../components/ReportTable';
import { useFinance } from '../hooks/finance';
import { useLookups } from '../hooks/data';
import { supabase } from '../lib/supabase';
import {
  MODES,
  analyzeOutliers,
  stayBooked,
  stayPaid,
  stayBalance,
  num,
  StayFact,
} from '../lib/finance';
import { countCheckIns, countRooms, countNights } from '../lib/checkins';
import {
  buildHotelSummaries,
  buildSourceSummaries,
  buildPaymentModeSummaries,
  buildDailySummaries,
  buildUnpaidGuests,
  enrichExtensions,
  HotelSummary,
  SourceSummary,
  ModeSummary,
  DailySummary,
  UnpaidGuestStay,
  EnrichedExtension,
} from '../lib/revenueCalculations';
import { istDate } from '../lib/ist';
import { inr, int, pct, fmtDateTime, inrShort, formatDateRangeWords, formatIstTimeOnly, dash } from '../lib/format';
import { buildHotelDateMatrix } from '../lib/matrix';
import {
  exportRevenueWorkbook,
  exportRevenuePdf,
  exportUnpaidGuestsPdf,
} from '../lib/export';

export function Revenue() {
  const { applied, setHotel } = useFilters();
  const lk = useLookups();
  const fin = useFinance(applied);
  const navigate = useNavigate();

  const [excludeSuspects, setExcludeSuspects] = useState(false);
  const [showDataQuality, setShowDataQuality] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'unpaid' | 'extensions'>('all');
  const [exporting, setExporting] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string>(() => formatIstTimeOnly());

  // Stay drawer state for row clicks
  const [drawerStay, setDrawerStay] = useState<StayFact | null>(null);
  const [drawerExtensions, setDrawerExtensions] = useState<any[]>([]);
  const [loadingExts, setLoadingExts] = useState(false);

  const d = fin.data;
  const rawStays = d?.stays ?? [];
  const rawExts = d?.exts ?? [];

  // Outlier and suspect amounts analysis
  const outliers = useMemo(() => (rawStays.length ? analyzeOutliers(rawStays) : null), [rawStays]);
  const suspectStays = useMemo(() => outliers?.allFlagged ?? [], [outliers]);

  // Effective stays dataset (respecting the "Exclude suspect amounts" toggle)
  const stays = useMemo(() => {
    if (!excludeSuspects || !outliers) return rawStays;
    const suspectSet = new Set(outliers.allFlagged.map((s) => s.id));
    return rawStays.filter((s) => !suspectSet.has(s.id));
  }, [rawStays, excludeSuspects, outliers]);

  // Single source of truth financial metrics
  const bookedRevenue = useMemo(() => stays.reduce((sum, s) => sum + stayBooked(s), 0), [stays]);
  const collectedRevenue = useMemo(() => stays.reduce((sum, s) => sum + stayPaid(s), 0), [stays]);
  const outstandingRevenue = useMemo(() => stays.reduce((sum, s) => sum + stayBalance(s), 0), [stays]);
  const collectionPercentage = bookedRevenue > 0 ? (collectedRevenue / bookedRevenue) * 100 : 0;
  const checkInCount = useMemo(() => countCheckIns(stays), [stays]);
  const roomsCount = useMemo(() => countRooms(stays), [stays]);
  const nightsCount = useMemo(() => countNights(stays), [stays]);

  // Extension revenue (informational line, dated by created_at)
  const extensionRevenue = useMemo(() => rawExts.reduce((sum, x) => sum + num(x.extension_amount), 0), [rawExts]);

  // Summaries
  const hotelData = useMemo(() => buildHotelSummaries(stays, rawExts, lk.hotelName), [stays, rawExts, lk]);
  const sourceData = useMemo(() => buildSourceSummaries(stays), [stays]);
  const modeData = useMemo(() => buildPaymentModeSummaries(stays), [stays]);
  const dailyData = useMemo(() => buildDailySummaries(stays, rawExts), [stays, rawExts]);
  const unpaidData = useMemo(() => buildUnpaidGuests(stays, lk.hotelName, lk.recName), [stays, lk]);
  const enrichedExts = useMemo(() => enrichExtensions(rawExts, rawStays, lk.hotelName, lk.recName), [rawExts, rawStays, lk]);

  // Hotel x date heatmap matrix
  const matrix = useMemo(() => {
    return buildHotelDateMatrix(stays, lk.hotels, applied.from, applied.to);
  }, [stays, lk.hotels, applied.from, applied.to]);

  // Collection split-up calculation (guaranteeing exact reconciliation)
  const splitUp = useMemo(() => {
    const cash = stays.reduce((sum, s) => sum + (s.cash_amount ? num(s.cash_amount) : s.payment_mode === 'Cash' ? stayPaid(s) : 0), 0);
    const gpay = stays.reduce((sum, s) => sum + (s.gpay_amount ? num(s.gpay_amount) : /gpay|upi/i.test(s.payment_mode || '') ? stayPaid(s) : 0), 0);
    const card = stays.reduce((sum, s) => sum + (s.card_amount ? num(s.card_amount) : /card/i.test(s.payment_mode || '') ? stayPaid(s) : 0), 0);
    const online = stays.reduce((sum, s) => sum + (s.online_amount ? num(s.online_amount) : /online|net/i.test(s.payment_mode || '') ? stayPaid(s) : 0), 0);
    const allocated = cash + gpay + card + online;
    const unallocated = Math.max(0, collectedRevenue - allocated);

    return {
      cash,
      gpay,
      card,
      online,
      unallocated,
      cashPct: collectedRevenue > 0 ? (cash / collectedRevenue) * 100 : 0,
      gpayPct: collectedRevenue > 0 ? (gpay / collectedRevenue) * 100 : 0,
      cardPct: collectedRevenue > 0 ? (card / collectedRevenue) * 100 : 0,
      onlinePct: collectedRevenue > 0 ? (online / collectedRevenue) * 100 : 0,
      unallocatedPct: collectedRevenue > 0 ? (unallocated / collectedRevenue) * 100 : 0,
    };
  }, [stays, collectedRevenue]);

  // Charts
  // 1. Revenue per day (stacked Collected + Outstanding)
  const chartDaily = useMemo(() => {
    return dailyData.rows.slice(0, 31).map((d) => ({
      name: d.date.slice(5),
      date: d.date,
      Collected: d.collected,
      Outstanding: d.outstanding,
    })).reverse();
  }, [dailyData]);

  // 2. Revenue by hotel (sorted horizontal bars with printed values)
  const chartHotel = useMemo(() => {
    return hotelData.rows.slice(0, 15).map((h) => ({
      name: h.hotelName,
      Revenue: h.booked,
    }));
  }, [hotelData]);

  // 3. Collected by payment mode (donut with % and rupees)
  const chartModes = useMemo(() => {
    return modeData.rows.map((m) => ({
      name: m.mode,
      value: Math.round(m.collected),
    }));
  }, [modeData]);

  // 4. Revenue by source (sorted horizontal bars)
  const chartSources = useMemo(() => {
    return sourceData.rows.map((s) => ({
      name: s.source,
      Revenue: s.booked,
    }));
  }, [sourceData]);

  // Handle stay drawer extensions fetch
  const openStayDrawer = async (s: StayFact) => {
    setDrawerStay(s);
    setLoadingExts(true);
    try {
      const { data } = await supabase
        .from('stay_extensions')
        .select('id,extension_nights,extension_amount,amount_paid,balance_amount,payment_mode,payment_status,created_at')
        .eq('guest_stay_id', s.id);
      setDrawerExtensions(data ?? []);
    } catch {
      setDrawerExtensions([]);
    } finally {
      setLoadingExts(false);
    }
  };

  const fromYmd = applied.from ? istDate(applied.from) : 'start';
  const toYmd = applied.to ? istDate(applied.to) : 'now';
  const hotelFilterName = applied.hotelId
    ? applied.hotelId.includes(',')
      ? `${applied.hotelId.split(',').length} hotels selected`
      : lk.hotelName(applied.hotelId)
    : 'All accessible hotels';

  const handleRefresh = async () => {
    await fin.refetch();
    setLastRefreshed(formatIstTimeOnly());
  };

  const handleExportExcel = async () => {
    if (!d) return;
    setExporting(true);
    try {
      await exportRevenueWorkbook({
        fromYmd,
        toYmd,
        hotelFilterName,
        sourceFilter: applied.source || 'All sources',
        modeFilter: applied.paymentMode || 'All modes',
        totals: {
          stayBooked: bookedRevenue,
          extBooked: extensionRevenue,
          booked: bookedRevenue,
          stayCollected: collectedRevenue,
          extCollected: rawExts.reduce((sum, x) => sum + num(x.amount_paid), 0),
          collected: collectedRevenue,
          stayOutstanding: outstandingRevenue,
          extOutstanding: rawExts.reduce((sum, x) => sum + num(x.balance_amount), 0),
          outstanding: outstandingRevenue,
          collectionPct: collectionPercentage,
          paidStays: stays.filter((s) => stayPaid(s) >= stayBooked(s)).length,
          partialStays: stays.filter((s) => stayPaid(s) > 0 && stayPaid(s) < stayBooked(s)).length,
          unpaidStays: stays.filter((s) => stayPaid(s) === 0).length,
          stays: stays.length,
          extensions: rawExts.length,
          extNights: rawExts.reduce((sum, x) => sum + num(x.extension_nights), 0),
          modes: { Cash: splitUp.cash, GPay: splitUp.gpay, Card: splitUp.card, Online: splitUp.online, Other: splitUp.unallocated },
        },
        matrix,
        stays,
        exts: rawExts,
        suspectStays: suspectStays,
        suspectsExcluded: excludeSuspects,
        hotelNameLookup: lk.hotelName,
        recNameLookup: lk.recName,
      });
    } catch (err) {
      console.error('Export Excel failed:', err);
      alert('Could not generate Excel workbook. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    if (!d) return;
    setExporting(true);
    try {
      await exportRevenuePdf({
        fromYmd,
        toYmd,
        hotelFilterName,
        totals: {
          stayBooked: bookedRevenue,
          extBooked: extensionRevenue,
          booked: bookedRevenue,
          stayCollected: collectedRevenue,
          extCollected: rawExts.reduce((sum, x) => sum + num(x.amount_paid), 0),
          collected: collectedRevenue,
          stayOutstanding: outstandingRevenue,
          extOutstanding: rawExts.reduce((sum, x) => sum + num(x.balance_amount), 0),
          outstanding: outstandingRevenue,
          collectionPct: collectionPercentage,
          paidStays: stays.filter((s) => stayPaid(s) >= stayBooked(s)).length,
          partialStays: stays.filter((s) => stayPaid(s) > 0 && stayPaid(s) < stayBooked(s)).length,
          unpaidStays: stays.filter((s) => stayPaid(s) === 0).length,
          stays: stays.length,
          extensions: rawExts.length,
          extNights: rawExts.reduce((sum, x) => sum + num(x.extension_nights), 0),
          modes: { Cash: splitUp.cash, GPay: splitUp.gpay, Card: splitUp.card, Online: splitUp.online, Other: splitUp.unallocated },
        },
        matrix,
        stays,
        exts: rawExts,
        hotelNameLookup: lk.hotelName,
        recNameLookup: lk.recName,
      });
    } catch (err) {
      console.error('Export PDF failed:', err);
      alert('Could not generate PDF. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleExportUnpaidPdf = async () => {
    try {
      await exportUnpaidGuestsPdf({
        unpaidList: unpaidData.unpaidList,
        totalOutstanding: unpaidData.totalOutstanding,
        checkedOutOutstanding: unpaidData.checkedOutOutstanding,
        hotelFilterName,
        fromYmd,
        toYmd,
      });
    } catch (err) {
      console.error('Export Unpaid PDF failed:', err);
      alert('Could not export Unpaid PDF. Please try again.');
    }
  };

  // Define Columns for ReportTable
  // Hotel Table Columns
  const hotelCols: ReportCol<HotelSummary>[] = [
    { key: 'hotelName', header: 'Hotel', render: (r) => <strong>{r.hotelName}</strong> },
    { key: 'checkIns', header: 'Check-ins', align: 'r', render: (r) => int(r.checkIns), getRaw: (r) => r.checkIns },
    { key: 'rooms', header: 'Rooms', align: 'r', render: (r) => int(r.rooms), getRaw: (r) => r.rooms },
    { key: 'nights', header: 'Nights', align: 'r', render: (r) => int(r.nights), getRaw: (r) => r.nights },
    { key: 'booked', header: 'Total Revenue', align: 'r', render: (r) => <strong>{inr(r.booked)}</strong>, getRaw: (r) => r.booked },
    { key: 'extAmount', header: 'Extension', align: 'r', render: (r) => inr(r.extAmount), getRaw: (r) => r.extAmount },
    { key: 'cash', header: 'Cash', align: 'r', render: (r) => inr(r.cash), getRaw: (r) => r.cash },
    { key: 'gpay', header: 'GPay', align: 'r', render: (r) => inr(r.gpay), getRaw: (r) => r.gpay },
    { key: 'card', header: 'Card', align: 'r', render: (r) => inr(r.card), getRaw: (r) => r.card },
    { key: 'online', header: 'Online', align: 'r', render: (r) => inr(r.online), getRaw: (r) => r.online },
    { key: 'collected', header: 'Collected', align: 'r', render: (r) => <span style={{ color: 'var(--good)' }}>{inr(r.collected)}</span>, getRaw: (r) => r.collected },
    { key: 'outstanding', header: 'Outstanding', align: 'r', render: (r) => <span style={{ color: r.outstanding > 0 ? 'var(--warn)' : 'inherit' }}>{inr(r.outstanding)}</span>, getRaw: (r) => r.outstanding },
    { key: 'collectionPct', header: 'Col %', align: 'r', render: (r) => pct(r.collectionPct), getRaw: (r) => r.collectionPct },
  ];

  const hotelTotalRow = {
    hotelName: <strong>All hotels (Total)</strong>,
    checkIns: int(hotelData.totals.checkIns),
    rooms: int(hotelData.totals.rooms),
    nights: int(hotelData.totals.nights),
    booked: inr(hotelData.totals.booked),
    extAmount: inr(hotelData.totals.extAmount),
    cash: inr(hotelData.totals.cash),
    gpay: inr(hotelData.totals.gpay),
    card: inr(hotelData.totals.card),
    online: inr(hotelData.totals.online),
    collected: inr(hotelData.totals.collected),
    outstanding: inr(hotelData.totals.outstanding),
    collectionPct: pct(hotelData.totals.collectionPct),
  };

  // Source Table Columns
  const sourceCols: ReportCol<SourceSummary>[] = [
    { key: 'source', header: 'Source', render: (r) => <strong>{r.source}</strong> },
    { key: 'stays', header: 'Stays', align: 'r', render: (r) => int(r.stays), getRaw: (r) => r.stays },
    { key: 'booked', header: 'Total Revenue', align: 'r', render: (r) => inr(r.booked), getRaw: (r) => r.booked },
    { key: 'collected', header: 'Collected', align: 'r', render: (r) => <span style={{ color: 'var(--good)' }}>{inr(r.collected)}</span>, getRaw: (r) => r.collected },
    { key: 'outstanding', header: 'Outstanding', align: 'r', render: (r) => inr(r.outstanding), getRaw: (r) => r.outstanding },
    { key: 'cash', header: 'Cash', align: 'r', render: (r) => inr(r.cash), getRaw: (r) => r.cash },
    { key: 'gpay', header: 'GPay', align: 'r', render: (r) => inr(r.gpay), getRaw: (r) => r.gpay },
    { key: 'card', header: 'Card', align: 'r', render: (r) => inr(r.card), getRaw: (r) => r.card },
    { key: 'online', header: 'Online', align: 'r', render: (r) => inr(r.online), getRaw: (r) => r.online },
  ];

  const sourceTotalRow = {
    source: <strong>Total</strong>,
    stays: int(sourceData.totals.stays),
    booked: inr(sourceData.totals.booked),
    collected: inr(sourceData.totals.collected),
    outstanding: inr(sourceData.totals.outstanding),
    cash: inr(sourceData.totals.cash),
    gpay: inr(sourceData.totals.gpay),
    card: inr(sourceData.totals.card),
    online: inr(sourceData.totals.online),
  };

  // Payment Mode Table Columns
  const modeCols: ReportCol<ModeSummary>[] = [
    { key: 'mode', header: 'Payment Mode', render: (r) => <strong>{r.mode}</strong> },
    { key: 'staysCount', header: 'Stays Count', align: 'r', render: (r) => int(r.staysCount), getRaw: (r) => r.staysCount },
    { key: 'collected', header: 'Collected Amount', align: 'r', render: (r) => inr(r.collected), getRaw: (r) => r.collected },
    { key: 'sharePct', header: 'Share %', align: 'r', render: (r) => pct(r.sharePct), getRaw: (r) => r.sharePct },
  ];

  const modeTotalRow = {
    mode: <strong>Total</strong>,
    staysCount: int(modeData.totals.staysCount),
    collected: inr(modeData.totals.collected),
    sharePct: '100.0%',
  };

  // Daily Table Columns
  const dailyCols: ReportCol<DailySummary>[] = [
    { key: 'date', header: 'Date (IST)', render: (r) => <strong>{r.date}</strong> },
    { key: 'checkIns', header: 'Check-ins', align: 'r', render: (r) => int(r.checkIns), getRaw: (r) => r.checkIns },
    { key: 'booked', header: 'Total Revenue', align: 'r', render: (r) => inr(r.booked), getRaw: (r) => r.booked },
    { key: 'collected', header: 'Collected', align: 'r', render: (r) => <span style={{ color: 'var(--good)' }}>{inr(r.collected)}</span>, getRaw: (r) => r.collected },
    { key: 'outstanding', header: 'Outstanding', align: 'r', render: (r) => inr(r.outstanding), getRaw: (r) => r.outstanding },
    { key: 'extAmount', header: 'Extension', align: 'r', render: (r) => inr(r.extAmount), getRaw: (r) => r.extAmount },
    { key: 'cash', header: 'Cash', align: 'r', render: (r) => inr(r.cash), getRaw: (r) => r.cash },
    { key: 'gpay', header: 'GPay', align: 'r', render: (r) => inr(r.gpay), getRaw: (r) => r.gpay },
    { key: 'card', header: 'Card', align: 'r', render: (r) => inr(r.card), getRaw: (r) => r.card },
    { key: 'online', header: 'Online', align: 'r', render: (r) => inr(r.online), getRaw: (r) => r.online },
  ];

  const dailyTotalRow = {
    date: <strong>Total</strong>,
    checkIns: int(dailyData.totals.checkIns),
    booked: inr(dailyData.totals.booked),
    collected: inr(dailyData.totals.collected),
    outstanding: inr(dailyData.totals.outstanding),
    extAmount: inr(dailyData.totals.extAmount),
    cash: inr(dailyData.totals.cash),
    gpay: inr(dailyData.totals.gpay),
    card: inr(dailyData.totals.card),
    online: inr(dailyData.totals.online),
  };

  // Unpaid Guests Columns
  const unpaidCols: ReportCol<UnpaidGuestStay>[] = [
    { key: 'guestName', header: 'Guest', render: (r) => <strong>{r.guestName}</strong> },
    { key: 'phone', header: 'Phone', render: (r) => r.phone },
    { key: 'hotelName', header: 'Hotel', render: (r) => r.hotelName },
    { key: 'roomNumber', header: 'Room', render: (r) => r.roomNumber },
    { key: 'grcNumber', header: 'GRC', render: (r) => <code>{r.grcNumber}</code> },
    { key: 'source', header: 'Source', render: (r) => r.source },
    { key: 'checkInTime', header: 'Check-in', render: (r) => fmtDateTime(r.checkInTime) },
    { key: 'expectedCheckOut', header: 'Expected Out', render: (r) => fmtDateTime(r.expectedCheckOut) },
    {
      key: 'stayStatus',
      header: 'Stay Status',
      render: (r) => (
        <Badge tone={r.isOverdueOrCheckedOut ? 'warn' : 'muted'}>{r.stayStatus}</Badge>
      ),
    },
    { key: 'totalAmount', header: 'Total', align: 'r', render: (r) => inr(r.totalAmount), getRaw: (r) => r.totalAmount },
    { key: 'amountPaid', header: 'Paid', align: 'r', render: (r) => inr(r.amountPaid), getRaw: (r) => r.amountPaid },
    {
      key: 'balanceAmount',
      header: 'Balance',
      align: 'r',
      render: (r) => <strong style={{ color: 'var(--warn)' }}>{inr(r.balanceAmount)}</strong>,
      getRaw: (r) => r.balanceAmount,
    },
    { key: 'daysSinceCheckIn', header: 'Days', align: 'r', render: (r) => `${r.daysSinceCheckIn}d`, getRaw: (r) => r.daysSinceCheckIn },
    { key: 'paymentMode', header: 'Mode', render: (r) => dash(r.paymentMode) },
    { key: 'receptionistName', header: 'Receptionist', render: (r) => r.receptionistName },
  ];

  // Extensions Table Columns
  const extCols: ReportCol<EnrichedExtension>[] = [
    { key: 'hotelName', header: 'Hotel', render: (r) => r.hotelName },
    { key: 'guestName', header: 'Guest', render: (r) => <strong>{r.guestName}</strong> },
    { key: 'phone', header: 'Phone', render: (r) => r.phone },
    { key: 'grcNumber', header: 'GRC', render: (r) => <code>{r.grcNumber}</code> },
    { key: 'roomNumber', header: 'Room', render: (r) => r.roomNumber },
    { key: 'previousCheckOut', header: 'Previous Check-out', render: (r) => fmtDateTime(r.previousCheckOut) },
    { key: 'newCheckOut', header: 'New Check-out', render: (r) => fmtDateTime(r.newCheckOut) },
    { key: 'extraNights', header: 'Extra Nights', align: 'r', render: (r) => int(r.extraNights), getRaw: (r) => r.extraNights },
    { key: 'reason', header: 'Reason', render: (r) => dash(r.reason) },
    { key: 'amount', header: 'Amount', align: 'r', render: (r) => inr(r.amount), getRaw: (r) => r.amount },
    { key: 'paid', header: 'Paid', align: 'r', render: (r) => inr(r.paid), getRaw: (r) => r.paid },
    { key: 'balance', header: 'Balance', align: 'r', render: (r) => inr(r.balance), getRaw: (r) => r.balance },
    { key: 'paymentMode', header: 'Mode', render: (r) => dash(r.paymentMode) },
    { key: 'source', header: 'Source', render: (r) => r.source },
    { key: 'receptionistName', header: 'Receptionist', render: (r) => r.receptionistName },
    { key: 'createdAt', header: 'Created', render: (r) => fmtDateTime(r.createdAt) },
  ];

  return (
    <>
      {/* 1. Page Header with Refresh & Exports */}
      <PageHead
        title="Revenue & Financial Operations"
        sub={`Booked, collected and outstanding revenue. Scope: ${hotelFilterName} | ${formatDateRangeWords(applied.from, applied.to)}`}
        right={
          <div className="fact" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 12 }}>
              Last refreshed {lastRefreshed}
            </span>
            <button className="btn sm" onClick={handleRefresh} title="Refetch live data">
              ↻ Refresh
            </button>
            <button
              className="btn primary sm"
              onClick={handleExportExcel}
              disabled={exporting || fin.loading}
            >
              📥 Excel (.xlsx)
            </button>
            <button
              className="btn sm"
              onClick={handleExportPdf}
              disabled={exporting || fin.loading}
            >
              📄 PDF Report
            </button>
          </div>
        }
      />

      {/* 2. Sticky Filter Bar */}
      <FilterBar fields={REVENUE_FIELDS} sticky />

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, borderBottom: '1px solid var(--line)', paddingBottom: 6 }}>
        <button
          className={`btn sm ${activeTab === 'all' ? 'primary' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          Overview &amp; Summaries
        </button>
        <button
          className={`btn sm ${activeTab === 'unpaid' ? 'primary' : ''}`}
          onClick={() => setActiveTab('unpaid')}
        >
          Unpaid Guests ({unpaidData.unpaidList.length})
        </button>
        <button
          className={`btn sm ${activeTab === 'extensions' ? 'primary' : ''}`}
          onClick={() => setActiveTab('extensions')}
        >
          Extended Stays ({rawExts.length})
        </button>
      </div>

      {fin.loading ? <Loading rows={5} /> : null}
      {fin.error ? <ErrorBox error={fin.error} onRetry={handleRefresh} /> : null}

      {!fin.loading && !fin.error && (
        <>
          {/* 3. Primary KPI Row */}
          <div className="grid kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
            <Kpi
              label="Total Revenue"
              value={inr(bookedRevenue)}
              info="Booked revenue = SUM(guest_stays.total_amount). Single source of truth."
            />
            <Kpi
              label="Collected"
              value={inr(collectedRevenue)}
              tone="good"
              info="Amount collected = SUM(guest_stays.amount_paid)"
            />
            <Kpi
              label="Outstanding"
              value={inr(outstandingRevenue)}
              tone={outstandingRevenue > 0 ? 'warn' : undefined}
              info="Outstanding balance = SUM(guest_stays.balance_amount)"
            />
            <Kpi
              label="Collection %"
              value={pct(collectionPercentage)}
              tone={collectionPercentage >= 85 ? 'good' : 'warn'}
              info="Collected revenue / Total booked revenue * 100"
            />
            <Kpi
              label="Check-ins"
              value={int(checkInCount)}
              sub={`${int(roomsCount)} rooms · ${int(nightsCount)} nights`}
              info="Exact count of distinct stay IDs with check_in_time in this period"
            />
            <Kpi
              label="Extension Revenue"
              value={inr(extensionRevenue)}
              sub={`${rawExts.length} extensions`}
              info="Informational: stay_extensions charges dated by created_at in IST"
            />
            <div className="card kpi" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div className="l" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Suspect Outliers</span>
                <InfoTooltip text="Stays with total_amount > 10x median or top 10 outliers" />
              </div>
              <div className="v" style={{ fontSize: 20, color: suspectStays.length > 0 ? 'var(--warn)' : 'inherit', marginTop: 4 }}>
                {suspectStays.length} stays
              </div>
              <div className="s" style={{ marginTop: 4 }}>
                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
                  <input
                    type="checkbox"
                    checked={excludeSuspects}
                    onChange={(e) => setExcludeSuspects(e.target.checked)}
                  />
                  Exclude from totals
                </label>
              </div>
            </div>
          </div>

          {/* 4. Collection Split-up Cards (Cash, GPay, Card, Online, Unallocated) */}
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 650, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Collection Split-up (Reconciles 100% of Amount Paid)
            </div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div className="card" style={{ padding: '10px 14px', borderLeft: '4px solid #10b981' }}>
                <div className="muted" style={{ fontSize: 11.5 }}>Cash</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{inr(splitUp.cash)}</div>
                <div className="muted" style={{ fontSize: 11 }}>{pct(splitUp.cashPct)} of collected</div>
              </div>
              <div className="card" style={{ padding: '10px 14px', borderLeft: '4px solid #06b6d4' }}>
                <div className="muted" style={{ fontSize: 11.5 }}>GPay / UPI</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{inr(splitUp.gpay)}</div>
                <div className="muted" style={{ fontSize: 11 }}>{pct(splitUp.gpayPct)} of collected</div>
              </div>
              <div className="card" style={{ padding: '10px 14px', borderLeft: '4px solid #8b5cf6' }}>
                <div className="muted" style={{ fontSize: 11.5 }}>Card</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{inr(splitUp.card)}</div>
                <div className="muted" style={{ fontSize: 11 }}>{pct(splitUp.cardPct)} of collected</div>
              </div>
              <div className="card" style={{ padding: '10px 14px', borderLeft: '4px solid #4f46e5' }}>
                <div className="muted" style={{ fontSize: 11.5 }}>Online / NetBanking</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{inr(splitUp.online)}</div>
                <div className="muted" style={{ fontSize: 11 }}>{pct(splitUp.onlinePct)} of collected</div>
              </div>
              {splitUp.unallocated > 0.5 ? (
                <div className="card" style={{ padding: '10px 14px', borderLeft: '4px solid #f59e0b' }}>
                  <div className="muted" style={{ fontSize: 11.5 }}>Unallocated Balance</div>
                  <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--warn)' }}>
                    {inr(splitUp.unallocated)}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>{pct(splitUp.unallocatedPct)} (amount_paid - splits)</div>
                </div>
              ) : null}
            </div>
          </div>

          {/* TAB 1: OVERVIEW & SUMMARIES */}
          {activeTab === 'all' && (
            <>
              {/* 4 Primary Charts */}
              <div className="grid two" style={{ marginTop: 20 }}>
                <Card title="Revenue per day (Stacked: Collected + Outstanding)">
                  <Bars
                    data={chartDaily}
                    stacked
                    xAxisTitle="Date (IST)"
                    yAxisTitle="Revenue (₹)"
                    series={[
                      { key: 'Collected', label: 'Collected', color: '#10b981' },
                      { key: 'Outstanding', label: 'Outstanding', color: '#f59e0b' },
                    ]}
                  />
                </Card>

                <Card title="Revenue by hotel (Sorted High to Low)">
                  <Bars
                    horizontal
                    data={chartHotel}
                    showValueLabels
                    xAxisTitle="Revenue (₹)"
                    series={[{ key: 'Revenue', label: 'Booked Revenue', color: '#4f46e5' }]}
                  />
                </Card>

                <Card title="Collected by payment mode">
                  <Donut data={chartModes} />
                </Card>

                <Card title="Revenue by source">
                  <Bars
                    horizontal
                    data={chartSources}
                    showValueLabels
                    xAxisTitle="Revenue (₹)"
                    series={[{ key: 'Revenue', label: 'Revenue by Booking Source', color: '#06b6d4' }]}
                  />
                </Card>
              </div>

              {/* Hotel Summary Table */}
              <div style={{ marginTop: 24 }}>
                <ReportTable
                  title="Hotel Financial Summary"
                  subtitle="Check-ins, occupancy, booked revenue, extension revenue, mode split, and collection percentage"
                  cols={hotelCols}
                  rows={hotelData.rows}
                  totalRow={hotelTotalRow}
                  rowKey={(r) => r.hotelId}
                  exportName="hotel-summary"
                  onRowClick={(r) => setHotel(r.hotelId)}
                />
              </div>

              {/* Source & Payment Mode Summary Tables */}
              <div className="grid two" style={{ marginTop: 12 }}>
                <ReportTable
                  title="Source Summary"
                  subtitle="Stays, booked revenue and payment collection by booking channel"
                  cols={sourceCols}
                  rows={sourceData.rows}
                  totalRow={sourceTotalRow}
                  rowKey={(r) => r.source}
                  exportName="source-summary"
                />

                <ReportTable
                  title="Payment Mode Summary"
                  subtitle="Collected amounts and percentage share by mode"
                  cols={modeCols}
                  rows={modeData.rows}
                  totalRow={modeTotalRow}
                  rowKey={(r) => r.mode}
                  exportName="payment-modes"
                />
              </div>

              {/* Daily Operations Table */}
              <div style={{ marginTop: 12 }}>
                <ReportTable
                  title="Daily Operations &amp; Revenue Breakdown"
                  subtitle="Check-in volume, total revenue, collected, outstanding, and payment split by calendar day (IST)"
                  cols={dailyCols}
                  rows={dailyData.rows}
                  totalRow={dailyTotalRow}
                  rowKey={(r) => r.date}
                  exportName="daily-summary"
                />
              </div>

              {/* Hotel x Date Revenue Matrix Table */}
              <div style={{ marginTop: 12 }}>
                <Card
                  title={`Revenue by Hotel and ${matrix.isWeekly ? 'Week' : 'Date'} (₹)`}
                  right={
                    <span className="muted" style={{ fontSize: 12 }}>
                      Click cell to view stays · Color intensity reflects daily revenue
                    </span>
                  }
                  flush
                >
                  <div className="tw" style={{ maxHeight: 420 }}>
                    <table className="matrix-table">
                      <thead>
                        <tr>
                          <th>Hotel</th>
                          {matrix.columns.map((c) => (
                            <th key={c.key} className="r">
                              {c.label}
                            </th>
                          ))}
                          <th className="r">Total Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matrix.rows.map((r) => (
                          <tr key={r.hotelId}>
                            <td>
                              <span
                                className="cell-link"
                                onClick={() => setHotel(r.hotelId)}
                                title="Filter dashboard to this hotel"
                              >
                                {r.hotelName}
                              </span>
                            </td>
                            {matrix.columns.map((c) => {
                              const rev = r.revenue[c.key] ?? 0;
                              const intensity = matrix.maxCellRevenue > 0 ? rev / matrix.maxCellRevenue : 0;
                              const alpha = Math.min(0.7, intensity * 0.7);
                              return (
                                <td
                                  key={c.key}
                                  className="r"
                                  style={
                                    rev > 0
                                      ? { backgroundColor: `rgba(79, 70, 229, ${alpha})`, color: alpha > 0.45 ? '#fff' : 'inherit' }
                                      : undefined
                                  }
                                >
                                  {rev > 0 ? (
                                    <span
                                      className="cell-link"
                                      onClick={() => navigate(`/stays?hotelId=${r.hotelId}&from=${c.startDate}&to=${c.endDate}`)}
                                      title="Open matching stays"
                                    >
                                      {inrShort(rev)}
                                    </span>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                              );
                            })}
                            <td className="r">
                              <strong>{inr(r.totalRevenue)}</strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>All hotels (Total)</td>
                          {matrix.columns.map((c) => (
                            <td key={c.key} className="r">
                              {inrShort(matrix.totals.revenue[c.key] ?? 0)}
                            </td>
                          ))}
                          <td className="r">
                            <strong>{inr(matrix.totals.totalRevenue)}</strong>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </Card>
              </div>
            </>
          )}

          {/* TAB 2: UNPAID GUESTS */}
          {activeTab === 'unpaid' && (
            <div style={{ marginTop: 16 }}>
              {/* Summary Banner */}
              <div
                className="card"
                style={{
                  padding: '16px 20px',
                  marginBottom: 16,
                  background: 'var(--panel)',
                  borderLeft: '4px solid var(--warn)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 16,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--warn)', textTransform: 'uppercase' }}>
                    Outstanding Receivables &amp; High Risk Collection
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>
                    {inr(unpaidData.totalOutstanding)}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    Across <strong>{unpaidData.unpaidList.length}</strong> guests with balance payable ({unpaidData.unpaidCount} fully unpaid, {unpaidData.partlyPaidCount} partly paid)
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ padding: '8px 12px', background: 'var(--bad-bg)', borderRadius: 8, color: 'var(--bad)' }}>
                    <div style={{ fontSize: 11, fontWeight: 600 }}>Checked-Out / Overdue (Highest Risk)</div>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>{inr(unpaidData.checkedOutOutstanding)}</div>
                    <div style={{ fontSize: 11 }}>{unpaidData.highestRiskCount} departed guests</div>
                  </div>
                  <button className="btn primary" onClick={handleExportUnpaidPdf}>
                    🖨️ Print Accounts Collection List (PDF)
                  </button>
                </div>
              </div>

              <ReportTable
                title="Unpaid &amp; Partly Paid Guests"
                subtitle="Click any row to open the stay detail drawer. Phone numbers shown in full for accounts follow-up."
                cols={unpaidCols}
                rows={unpaidData.unpaidList}
                rowKey={(r) => r.stay.id}
                exportName="unpaid-guests"
                onRowClick={(r) => openStayDrawer(r.stay)}
              />
            </div>
          )}

          {/* TAB 3: EXTENSIONS */}
          {activeTab === 'extensions' && (
            <div style={{ marginTop: 16 }}>
              <div className="grid kpis" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                <Kpi label="Total Extensions" value={int(rawExts.length)} />
                <Kpi label="Extension Nights" value={int(rawExts.reduce((a, x) => a + num(x.extension_nights), 0))} />
                <Kpi label="Extension Amount" value={inr(extensionRevenue)} />
                <Kpi label="Extension Collected" value={inr(rawExts.reduce((a, x) => a + num(x.amount_paid), 0))} tone="good" />
                <Kpi label="Extension Balance" value={inr(rawExts.reduce((a, x) => a + num(x.balance_amount), 0))} tone="warn" />
              </div>

              <ReportTable
                title="Stay Extensions"
                subtitle="Dated by extension creation (IST). Parent stay details enriched in a single query."
                cols={extCols}
                rows={enrichedExts}
                rowKey={(r) => r.ext.id}
                exportName="stay-extensions"
              />
            </div>
          )}

          {/* Data Quality & Outliers Collapsible Box */}
          <div style={{ marginTop: 24 }}>
            <Card
              title={
                <span
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                  onClick={() => setShowDataQuality((s) => !s)}
                >
                  <span>{showDataQuality ? '▼' : '►'}</span>
                  <span>Data Quality &amp; Outliers Inspection ({suspectStays.length} flagged)</span>
                </span>
              }
              right={
                <span className="muted" style={{ fontSize: 12 }}>
                  Revenue with outliers: {inr(outliers?.totalRevenueAll)} · Without: {inr(outliers?.totalRevenueWithoutOutliers)}
                </span>
              }
            >
              {showDataQuality ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                    Outlier criteria: Stays in the top 10 by total amount, or exceeding 10x the median stay amount (Median = {inr(outliers?.median)}). No rows are ever silently hidden.
                  </div>

                  <div className="tw" style={{ maxHeight: 320 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Stay ID</th>
                          <th>Guest Name</th>
                          <th>Hotel</th>
                          <th>Check-in</th>
                          <th className="r">Amount</th>
                          <th className="r">Total Amount</th>
                          <th className="r">Paid</th>
                          <th className="r">Balance</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {suspectStays.map((s) => (
                          <tr key={s.id} className="hover-row">
                            <td><code>{s.id.slice(0, 8)}</code></td>
                            <td><strong>{s.guest_name || '—'}</strong></td>
                            <td>{lk.hotelName(s.hotel_id)}</td>
                            <td>{fmtDateTime(s.check_in_time)}</td>
                            <td className="r">{inr(s.amount)}</td>
                            <td className="r"><strong>{inr(stayBooked(s))}</strong></td>
                            <td className="r">{inr(stayPaid(s))}</td>
                            <td className="r">{inr(stayBalance(s))}</td>
                            <td>
                              <button className="btn sm" onClick={() => openStayDrawer(s)}>
                                View Stay
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </Card>
          </div>
        </>
      )}

      {/* Stay Detail Drawer */}
      {drawerStay ? (
        <div className="drawer-backdrop" onClick={() => setDrawerStay(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h2 style={{ margin: 0, fontSize: 18 }}>Stay Details</h2>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  GRC: <strong>{drawerStay.grc_number || drawerStay.booking_id || drawerStay.id.slice(0, 8)}</strong> · ID: {drawerStay.id.slice(0, 8)}
                </div>
              </div>
              <button className="btn sm" onClick={() => setDrawerStay(null)}>
                ✕
              </button>
            </div>

            <div className="drawer-body">
              {/* Guest Card */}
              <div className="card" style={{ padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase' }}>
                  Guest Information
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                  <div>
                    <span className="muted" style={{ fontSize: 11, display: 'block' }}>Guest Name</span>
                    <strong>{drawerStay.guest_name || '—'}</strong>
                  </div>
                  <div>
                    <span className="muted" style={{ fontSize: 11, display: 'block' }}>Phone</span>
                    <span>{drawerStay.guest_phone || '—'}</span>
                  </div>
                  <div>
                    <span className="muted" style={{ fontSize: 11, display: 'block' }}>Hotel</span>
                    <span>{lk.hotelName(drawerStay.hotel_id)}</span>
                  </div>
                  <div>
                    <span className="muted" style={{ fontSize: 11, display: 'block' }}>Room</span>
                    <strong>{drawerStay.room_number || '—'}</strong>
                  </div>
                </div>
              </div>

              {/* Stay & Booking */}
              <div className="card" style={{ padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase' }}>
                  Stay &amp; Reservation
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                  <div>
                    <span className="muted" style={{ fontSize: 11, display: 'block' }}>Check-in</span>
                    <span>{fmtDateTime(drawerStay.check_in_time)}</span>
                  </div>
                  <div>
                    <span className="muted" style={{ fontSize: 11, display: 'block' }}>Expected Check-out</span>
                    <span>{fmtDateTime(drawerStay.current_check_out_time)}</span>
                  </div>
                  <div>
                    <span className="muted" style={{ fontSize: 11, display: 'block' }}>Nights / Rooms</span>
                    <span>{num(drawerStay.number_of_nights) || 1} Night(s) · {num(drawerStay.number_of_rooms) || 1} Room(s)</span>
                  </div>
                  <div>
                    <span className="muted" style={{ fontSize: 11, display: 'block' }}>Booking Source</span>
                    <span>{drawerStay.source || 'Direct'}</span>
                  </div>
                  <div>
                    <span className="muted" style={{ fontSize: 11, display: 'block' }}>Booking ID</span>
                    <code>{drawerStay.booking_id || '—'}</code>
                  </div>
                  <div>
                    <span className="muted" style={{ fontSize: 11, display: 'block' }}>Receptionist</span>
                    <span>{lk.recName(drawerStay.receptionist_id)}</span>
                  </div>
                </div>
              </div>

              {/* Financials & Splits */}
              <div className="card" style={{ padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase' }}>
                  Billing &amp; Payment Splits
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
                  <div>
                    <span className="muted" style={{ fontSize: 11, display: 'block' }}>Total Booked</span>
                    <strong style={{ fontSize: 16 }}>{inr(stayBooked(drawerStay))}</strong>
                  </div>
                  <div>
                    <span className="muted" style={{ fontSize: 11, display: 'block' }}>Amount Paid</span>
                    <strong style={{ fontSize: 16, color: 'var(--good)' }}>{inr(stayPaid(drawerStay))}</strong>
                  </div>
                  <div>
                    <span className="muted" style={{ fontSize: 11, display: 'block' }}>Balance Due</span>
                    <strong style={{ fontSize: 16, color: stayBalance(drawerStay) > 0 ? 'var(--warn)' : 'inherit' }}>
                      {inr(stayBalance(drawerStay))}
                    </strong>
                  </div>
                </div>

                <div style={{ fontSize: 12, color: 'var(--muted)', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <strong>Payment Split:</strong> Cash: ₹{num(drawerStay.cash_amount)} | GPay: ₹{num(drawerStay.gpay_amount)} | Card: ₹{num(drawerStay.card_amount)} | Online: ₹{num(drawerStay.online_amount)}
                </div>
              </div>

              {/* Extensions */}
              <div className="card" style={{ padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase' }}>
                  Stay Extensions ({drawerExtensions.length})
                </div>
                {loadingExts ? (
                  <Loading rows={2} />
                ) : drawerExtensions.length === 0 ? (
                  <div className="muted" style={{ fontSize: 12 }}>No extensions recorded for this stay.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {drawerExtensions.map((x) => (
                      <div key={x.id} style={{ padding: 8, background: 'var(--panel2)', borderRadius: 6, fontSize: 12 }}>
                        <div><strong>+{x.extension_nights} Night(s)</strong> — {inr(x.extension_amount)} (Paid: {inr(x.amount_paid)}, Bal: {inr(x.balance_amount)})</div>
                        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Created: {fmtDateTime(x.created_at)} · Mode: {dash(x.payment_mode)}</div>
                      </div>
                    ))}
                    <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4, textAlign: 'right' }}>
                      Total after extensions: {inr(stayBooked(drawerStay) + drawerExtensions.reduce((a, b) => a + num(b.extension_amount), 0))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="drawer-footer">
              <button
                className="btn primary"
                onClick={() => {
                  window.open(`/stays/print/${drawerStay.id}`, '_blank');
                }}
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
