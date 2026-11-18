import { Totals, StayFact, ExtFact, MODES, stayBooked, stayPaid, stayBalance, num } from './finance';
import { MatrixData } from './matrix';
import { fmtDateTime, inrRs, int, maskPhone, formatDateRangeWords, formatIstTimeOnly } from './format';
import {
  buildHotelSummaries,
  buildSourceSummaries,
  buildPaymentModeSummaries,
  buildDailySummaries,
  buildUnpaidGuests,
  enrichExtensions,
} from './revenueCalculations';
import { env } from '../config';

export type Row = Record<string, string | number | null>;

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (v: any) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: Row[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  return [cols.map(csvCell).join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n');
}

/** Generic single-table export (CSV, XLSX, PDF) */
export async function exportRows(
  format: 'csv' | 'xlsx' | 'pdf',
  name: string,
  rows: Row[],
  title?: string,
) {
  const stamp = new Date().toISOString().slice(0, 10);
  const file = `${name}-${stamp}`;
  if (format === 'csv') {
    download(new Blob(['\ufeff' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }), `${file}.csv`);
  } else if (format === 'xlsx') {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31) || 'Report');
    XLSX.writeFile(wb, `${file}.xlsx`);
  } else {
    const { default: jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    doc.setFontSize(14);
    doc.text(`Starlight Hotels — ${title ?? name}`, 36, 36);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`, 36, 50);

    const cols = rows.length ? Object.keys(rows[0]) : [];
    autoTable(doc, {
      startY: 60,
      head: [cols],
      body: rows.map((r) =>
        cols.map((c) => {
          const v = r[c];
          if (v === null || v === undefined) return '';
          if (typeof v === 'number') {
            return String(c).toLowerCase().includes('amount') || String(c).toLowerCase().includes('revenue') || String(c).toLowerCase().includes('paid') || String(c).toLowerCase().includes('balance')
              ? inrRs(v)
              : String(v);
          }
          return String(v);
        }),
      ),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
      margin: { left: 36, right: 36 },
    });
    doc.save(`${file}.pdf`);
  }
}

/**
 * Requirement 6: Full multi-sheet Excel (.xlsx) workbook for Revenue & Operations.
 * 11 Sheets:
 * 1. Summary
 * 2. Hotel summary
 * 3. Source summary
 * 4. Payment modes
 * 5. Daily
 * 6. Hotel x Date check-ins
 * 7. Hotel x Date revenue
 * 8. Extensions
 * 9. Unpaid guests
 * 10. Stays
 * 11. Suspect amounts (if any)
 */
export async function exportRevenueWorkbook({
  fromYmd,
  toYmd,
  hotelFilterName,
  sourceFilter = 'All sources',
  modeFilter = 'All modes',
  totals,
  matrix,
  stays,
  exts = [],
  suspectStays = [],
  suspectsExcluded = false,
  includePhoneNumbers = false,
  hotelNameLookup,
  recNameLookup = (id) => (id ? String(id).slice(0, 8) : '—'),
}: {
  fromYmd: string;
  toYmd: string;
  hotelFilterName: string;
  sourceFilter?: string;
  modeFilter?: string;
  totals: Totals;
  matrix: MatrixData;
  stays: StayFact[];
  exts?: ExtFact[];
  suspectStays?: StayFact[];
  suspectsExcluded?: boolean;
  includePhoneNumbers?: boolean;
  hotelNameLookup: (id: string | null | undefined) => string;
  recNameLookup?: (id: string | null | undefined) => string;
}) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const istNow = `${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} ${formatIstTimeOnly()}`;

  // 1. Summary Sheet
  const summaryAoa: any[][] = [
    ['STARLIGHT HOTELS — OPERATIONS & REVENUE REPORT'],
    ['Generated (IST):', istNow],
    ['Scope (Hotels):', hotelFilterName],
    ['Source Filter:', sourceFilter],
    ['Payment Mode Filter:', modeFilter],
    ['Period:', formatDateRangeWords(fromYmd, toYmd)],
    ['Data Cutoff:', `Showing data from ${env.dataStart || '2026-10-18'} onwards (IST)`],
    ['Suspect Amounts:', suspectsExcluded ? 'EXCLUDED from totals' : 'INCLUDED in totals'],
    [],
    ['KEY PERFORMANCE INDICATORS', 'VALUE (₹ / COUNT)'],
    ['Total Revenue (Booked)', Math.round(totals.booked)],
    ['Amount Collected', Math.round(totals.collected)],
    ['Outstanding Balance', Math.round(totals.outstanding)],
    ['Collection Percentage', `${totals.collectionPct.toFixed(1)}%`],
    ['Total Check-ins', totals.stays],
    ['Paid Stays', totals.paidStays],
    ['Partly Paid Stays', totals.partialStays],
    ['Unpaid Stays', totals.unpaidStays],
    ['Extensions Count', totals.extensions],
    ['Extension Revenue', Math.round(totals.extBooked)],
    ['Suspect Amounts Excluded', suspectStays.length],
    [],
    ['INTEGRITY RECONCILIATION CHECK:', 'Booked = Collected + Outstanding'],
    ['Calculated Difference (Booked - Collected - Outstanding):', Math.round(totals.booked - totals.collected - totals.outstanding)],
    ['Reconciliation Status:', Math.abs(totals.booked - totals.collected - totals.outstanding) <= 1 ? 'BALANCED' : 'MISMATCH'],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoa);
  wsSummary['!cols'] = [{ wch: 38 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // 2. Hotel Summary Sheet
  const hotelSummaries = buildHotelSummaries(stays, exts, hotelNameLookup);
  const hotelExportRows = hotelSummaries.rows.map((h) => ({
    Hotel: h.hotelName,
    'Check-ins': h.checkIns,
    Rooms: h.rooms,
    Nights: h.nights,
    'Total Revenue (₹)': Math.round(h.booked),
    'Extension (₹)': Math.round(h.extAmount),
    'Cash (₹)': Math.round(h.cash),
    'GPay (₹)': Math.round(h.gpay),
    'Card (₹)': Math.round(h.card),
    'Online (₹)': Math.round(h.online),
    'Collected (₹)': Math.round(h.collected),
    'Outstanding (₹)': Math.round(h.outstanding),
    'Collection %': `${h.collectionPct.toFixed(1)}%`,
  }));
  hotelExportRows.push({
    Hotel: 'All hotels (Total)',
    'Check-ins': hotelSummaries.totals.checkIns,
    Rooms: hotelSummaries.totals.rooms,
    Nights: hotelSummaries.totals.nights,
    'Total Revenue (₹)': Math.round(hotelSummaries.totals.booked),
    'Extension (₹)': Math.round(hotelSummaries.totals.extAmount),
    'Cash (₹)': Math.round(hotelSummaries.totals.cash),
    'GPay (₹)': Math.round(hotelSummaries.totals.gpay),
    'Card (₹)': Math.round(hotelSummaries.totals.card),
    'Online (₹)': Math.round(hotelSummaries.totals.online),
    'Collected (₹)': Math.round(hotelSummaries.totals.collected),
    'Outstanding (₹)': Math.round(hotelSummaries.totals.outstanding),
    'Collection %': `${hotelSummaries.totals.collectionPct.toFixed(1)}%`,
  });
  const wsHotel = XLSX.utils.json_to_sheet(hotelExportRows);
  wsHotel['!cols'] = [{ wch: 26 }, { wch: 11 }, { wch: 9 }, { wch: 9 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
  (wsHotel as any)['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsHotel, 'Hotel summary');

  // 3. Source Summary Sheet
  const sourceSummaries = buildSourceSummaries(stays);
  const sourceExportRows = sourceSummaries.rows.map((s) => ({
    Source: s.source,
    Stays: s.stays,
    'Total Revenue (₹)': Math.round(s.booked),
    'Collected (₹)': Math.round(s.collected),
    'Outstanding (₹)': Math.round(s.outstanding),
    'Cash (₹)': Math.round(s.cash),
    'GPay (₹)': Math.round(s.gpay),
    'Card (₹)': Math.round(s.card),
    'Online (₹)': Math.round(s.online),
  }));
  sourceExportRows.push({
    Source: 'Total',
    Stays: sourceSummaries.totals.stays,
    'Total Revenue (₹)': Math.round(sourceSummaries.totals.booked),
    'Collected (₹)': Math.round(sourceSummaries.totals.collected),
    'Outstanding (₹)': Math.round(sourceSummaries.totals.outstanding),
    'Cash (₹)': Math.round(sourceSummaries.totals.cash),
    'GPay (₹)': Math.round(sourceSummaries.totals.gpay),
    'Card (₹)': Math.round(sourceSummaries.totals.card),
    'Online (₹)': Math.round(sourceSummaries.totals.online),
  });
  const wsSource = XLSX.utils.json_to_sheet(sourceExportRows);
  wsSource['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
  (wsSource as any)['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsSource, 'Source summary');

  // 4. Payment Modes Sheet
  const modeSummaries = buildPaymentModeSummaries(stays);
  const modeExportRows: Record<string, any>[] = modeSummaries.rows.map((m) => ({
    'Payment Mode': String(m.mode),
    'Stays Count': m.staysCount,
    'Collected (₹)': Math.round(m.collected),
    'Share %': `${m.sharePct.toFixed(1)}%`,
  }));
  modeExportRows.push({
    'Payment Mode': 'Total Collected',
    'Stays Count': modeSummaries.totals.staysCount,
    'Collected (₹)': Math.round(modeSummaries.totals.collected),
    'Share %': '100.0%',
  });
  const wsModes = XLSX.utils.json_to_sheet(modeExportRows);
  wsModes['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 12 }];
  (wsModes as any)['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsModes, 'Payment modes');

  // 5. Daily Summary Sheet
  const dailySummaries = buildDailySummaries(stays, exts);
  const dailyExportRows = dailySummaries.rows.map((d) => ({
    'Date (IST)': d.date,
    'Check-ins': d.checkIns,
    'Total Revenue (₹)': Math.round(d.booked),
    'Collected (₹)': Math.round(d.collected),
    'Outstanding (₹)': Math.round(d.outstanding),
    'Extension (₹)': Math.round(d.extAmount),
    'Cash (₹)': Math.round(d.cash),
    'GPay (₹)': Math.round(d.gpay),
    'Card (₹)': Math.round(d.card),
    'Online (₹)': Math.round(d.online),
  }));
  dailyExportRows.push({
    'Date (IST)': 'Total',
    'Check-ins': dailySummaries.totals.checkIns,
    'Total Revenue (₹)': Math.round(dailySummaries.totals.booked),
    'Collected (₹)': Math.round(dailySummaries.totals.collected),
    'Outstanding (₹)': Math.round(dailySummaries.totals.outstanding),
    'Extension (₹)': Math.round(dailySummaries.totals.extAmount),
    'Cash (₹)': Math.round(dailySummaries.totals.cash),
    'GPay (₹)': Math.round(dailySummaries.totals.gpay),
    'Card (₹)': Math.round(dailySummaries.totals.card),
    'Online (₹)': Math.round(dailySummaries.totals.online),
  });
  const wsDaily = XLSX.utils.json_to_sheet(dailyExportRows);
  wsDaily['!cols'] = [{ wch: 14 }, { wch: 11 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
  (wsDaily as any)['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsDaily, 'Daily');

  // 6. Hotel x Date Check-ins Matrix Sheet
  const ciRows = matrix.rows.map((r) => {
    const o: Record<string, any> = { Hotel: r.hotelName };
    matrix.columns.forEach((c) => {
      o[c.label] = r.checkIns[c.key] ?? 0;
    });
    o['Total Check-ins'] = r.totalCheckIns;
    return o;
  });
  const ciTotalRow: Record<string, any> = { Hotel: 'All hotels (Total)' };
  matrix.columns.forEach((c) => {
    ciTotalRow[c.label] = matrix.totals.checkIns[c.key] ?? 0;
  });
  ciTotalRow['Total Check-ins'] = matrix.totals.totalCheckIns;
  ciRows.push(ciTotalRow);
  const wsCi = XLSX.utils.json_to_sheet(ciRows);
  (wsCi as any)['!freeze'] = { xSplit: 1, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsCi, 'Hotel x Date check-ins');

  // 7. Hotel x Date Revenue Matrix Sheet
  const revRows = matrix.rows.map((r) => {
    const o: Record<string, any> = { Hotel: r.hotelName };
    matrix.columns.forEach((c) => {
      o[c.label] = Math.round(r.revenue[c.key] ?? 0);
    });
    o['Total Revenue (₹)'] = Math.round(r.totalRevenue);
    return o;
  });
  const revTotalRow: Record<string, any> = { Hotel: 'All hotels (Total)' };
  matrix.columns.forEach((c) => {
    revTotalRow[c.label] = Math.round(matrix.totals.revenue[c.key] ?? 0);
  });
  revTotalRow['Total Revenue (₹)'] = Math.round(matrix.totals.totalRevenue);
  revRows.push(revTotalRow);
  const wsRev = XLSX.utils.json_to_sheet(revRows);
  (wsRev as any)['!freeze'] = { xSplit: 1, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsRev, 'Hotel x Date revenue');

  // 8. Extensions Sheet
  const enrichedExts = enrichExtensions(exts, stays, hotelNameLookup, recNameLookup);
  const extExportRows = enrichedExts.map((x) => ({
    Hotel: x.hotelName,
    Guest: x.guestName,
    Phone: includePhoneNumbers ? x.phone : maskPhone(x.phone, '*'),
    GRC: x.grcNumber,
    Room: x.roomNumber,
    'Previous Check-out': fmtDateTime(x.previousCheckOut),
    'New Check-out': fmtDateTime(x.newCheckOut),
    'Extra Nights': x.extraNights,
    Reason: x.reason,
    'Amount (₹)': x.amount,
    'Paid (₹)': x.paid,
    'Balance (₹)': x.balance,
    Mode: x.paymentMode,
    Source: x.source,
    Receptionist: x.receptionistName,
    'Created (IST)': fmtDateTime(x.createdAt),
  }));
  const wsExts = XLSX.utils.json_to_sheet(extExportRows);
  wsExts['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 18 }];
  (wsExts as any)['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsExts, 'Extensions');

  // 9. Unpaid Guests Sheet
  const unpaidAnalysis = buildUnpaidGuests(stays, hotelNameLookup, recNameLookup);
  const unpaidExportRows = unpaidAnalysis.unpaidList.map((u) => ({
    Guest: u.guestName,
    Phone: includePhoneNumbers ? u.phone : maskPhone(u.phone, '*'),
    Hotel: u.hotelName,
    Room: u.roomNumber,
    GRC: u.grcNumber,
    'Booking ID': u.bookingId,
    Source: u.source,
    'Check-in': fmtDateTime(u.checkInTime),
    'Expected Check-out': fmtDateTime(u.expectedCheckOut),
    'Stay Status': u.stayStatus,
    'Total (₹)': u.totalAmount,
    'Paid (₹)': u.amountPaid,
    'Balance (₹)': u.balanceAmount,
    'Days Since Check-in': u.daysSinceCheckIn,
    'Payment Mode': u.paymentMode,
    Receptionist: u.receptionistName,
    Classification: u.statusLabel,
  }));
  const wsUnpaid = XLSX.utils.json_to_sheet(unpaidExportRows);
  wsUnpaid['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 22 }, { wch: 8 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 12 }];
  (wsUnpaid as any)['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsUnpaid, 'Unpaid guests');

  // 10. Stays Sheet (All stays in range)
  const staysExportRows = stays.map((s) => ({
    'GRC Number': s.grc_number || s.booking_id || s.id.slice(0, 8),
    Guest: s.guest_name || '—',
    Phone: includePhoneNumbers ? s.guest_phone || '—' : maskPhone(s.guest_phone, '*'),
    Hotel: hotelNameLookup(s.hotel_id),
    Room: s.room_number || '—',
    Source: s.source || '—',
    'Check-in Time': fmtDateTime(s.check_in_time),
    'Expected Check-out': fmtDateTime(s.current_check_out_time),
    'Actual Check-out': fmtDateTime(s.checked_out_at),
    Nights: num(s.number_of_nights) || 1,
    Guests: num(s.number_of_guests) || 1,
    Rooms: num(s.number_of_rooms) || 1,
    'Stay Status': s.stay_status || '—',
    'Payment Status': s.payment_status || '—',
    'Total Amount (₹)': stayBooked(s),
    'Amount Paid (₹)': stayPaid(s),
    'Balance Amount (₹)': stayBalance(s),
    'Payment Mode': s.payment_mode || '—',
    Receptionist: recNameLookup(s.receptionist_id),
  }));
  const wsStays = XLSX.utils.json_to_sheet(staysExportRows);
  wsStays['!cols'] = [{ wch: 14 }, { wch: 20 }, { wch: 14 }, { wch: 22 }, { wch: 8 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
  (wsStays as any)['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsStays, 'Stays');

  // 11. Suspect Amounts Sheet (if any)
  if (suspectStays.length > 0) {
    const suspectRows = suspectStays.map((s) => ({
      ID: s.id,
      GRC: s.grc_number || s.booking_id || s.id.slice(0, 8),
      Guest: s.guest_name || '—',
      Hotel: hotelNameLookup(s.hotel_id),
      'Check-in': fmtDateTime(s.check_in_time),
      'Total Amount (₹)': stayBooked(s),
      'Amount Paid (₹)': stayPaid(s),
      'Balance (₹)': stayBalance(s),
      Reason: stayBooked(s) > 50000 ? 'Extreme amount outlier (> ₹50,000)' : 'Flagged data-quality outlier',
    }));
    const wsSuspect = XLSX.utils.json_to_sheet(suspectRows);
    wsSuspect['!cols'] = [{ wch: 24 }, { wch: 14 }, { wch: 20 }, { wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 32 }];
    (wsSuspect as any)['!freeze'] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(wb, wsSuspect, 'Suspect amounts');
  }

  const cleanFrom = fromYmd.replace(/[^0-9-]/g, '') || 'start';
  const cleanTo = toYmd.replace(/[^0-9-]/g, '') || 'now';
  XLSX.writeFile(wb, `starlight-revenue_${cleanFrom}_${cleanTo}.xlsx`);
}

/**
 * Requirement 6: Professional A4 Landscape PDF for Revenue & Operations.
 * Uses "Rs." consistently so no square boxes or corrupted characters appear.
 */
export async function exportRevenuePdf({
  fromYmd,
  toYmd,
  hotelFilterName,
  totals,
  matrix,
  stays,
  exts = [],
  hotelNameLookup,
  recNameLookup = (id) => (id ? String(id).slice(0, 8) : '—'),
}: {
  fromYmd: string;
  toYmd: string;
  hotelFilterName: string;
  totals: Totals;
  matrix: MatrixData;
  stays: StayFact[];
  exts?: ExtFact[];
  hotelNameLookup: (id: string | null | undefined) => string;
  recNameLookup?: (id: string | null | undefined) => string;
}) {
  const { default: jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const istNow = `${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} ${formatIstTimeOnly()}`;

  // Header banner on first page
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('STARLIGHT HOTELS — REVENUE & OPERATIONS REPORT', 36, 38);

  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Scope: ${hotelFilterName}  |  Period: ${formatDateRangeWords(fromYmd, toYmd)} (IST)`, 36, 52);
  doc.text(`Generated: ${istNow}  |  Cutoff: 18 Oct 2026 onwards`, 36, 65);

  // Section 1: KPI Highlights Table
  const kpiHighlights = [
    [
      `Total Revenue: ${inrRs(totals.booked)}`,
      `Collected: ${inrRs(totals.collected)} (${totals.collectionPct.toFixed(1)}%)`,
      `Outstanding: ${inrRs(totals.outstanding)}`,
      `Check-ins: ${int(totals.stays)}`,
      `Extensions: ${int(totals.extensions)} (${inrRs(totals.extBooked)})`,
    ],
  ];

  autoTable(doc, {
    startY: 74,
    head: [['Financial & Operational Highlights (Booked = Collected + Outstanding)', '', '', '', '']],
    body: kpiHighlights,
    theme: 'grid',
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 8.5, fontStyle: 'bold', textColor: [15, 23, 42] },
    margin: { left: 36, right: 36 },
  });

  // Section 2: Hotel Summary Table
  let currentY = (doc as any).lastAutoTable.finalY + 18;
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('1. Hotel Summary', 36, currentY);

  const hotelSummaries = buildHotelSummaries(stays, exts, hotelNameLookup);
  const hotelHead = ['Hotel', 'Check-ins', 'Rooms', 'Total Revenue', 'Extension', 'Cash', 'GPay', 'Card', 'Online', 'Collected', 'Outstanding', 'Col %'];
  const hotelBody = hotelSummaries.rows.map((h) => [
    h.hotelName,
    int(h.checkIns),
    int(h.rooms),
    inrRs(h.booked),
    inrRs(h.extAmount),
    inrRs(h.cash),
    inrRs(h.gpay),
    inrRs(h.card),
    inrRs(h.online),
    inrRs(h.collected),
    inrRs(h.outstanding),
    `${h.collectionPct.toFixed(1)}%`,
  ]);
  hotelBody.push([
    'All hotels (Total)',
    int(hotelSummaries.totals.checkIns),
    int(hotelSummaries.totals.rooms),
    inrRs(hotelSummaries.totals.booked),
    inrRs(hotelSummaries.totals.extAmount),
    inrRs(hotelSummaries.totals.cash),
    inrRs(hotelSummaries.totals.gpay),
    inrRs(hotelSummaries.totals.card),
    inrRs(hotelSummaries.totals.online),
    inrRs(hotelSummaries.totals.collected),
    inrRs(hotelSummaries.totals.outstanding),
    `${hotelSummaries.totals.collectionPct.toFixed(1)}%`,
  ]);

  autoTable(doc, {
    startY: currentY + 6,
    head: [hotelHead],
    body: hotelBody,
    theme: 'striped',
    headStyles: { fillColor: [51, 65, 85], fontSize: 8 },
    bodyStyles: { fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 120 },
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
      8: { halign: 'right' },
      9: { halign: 'right' },
      10: { halign: 'right' },
      11: { halign: 'right' },
    },
    margin: { left: 36, right: 36 },
  });

  // Section 3: Daily Summary Table (Starts on new page or continues)
  doc.addPage();
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text('2. Daily Operations & Revenue Trend', 36, 38);

  const dailySummaries = buildDailySummaries(stays, exts);
  const dailyHead = ['Date (IST)', 'Check-ins', 'Booked Revenue', 'Collected', 'Outstanding', 'Extension', 'Cash', 'GPay', 'Card', 'Online'];
  const dailyBody = dailySummaries.rows.map((d) => [
    d.date,
    int(d.checkIns),
    inrRs(d.booked),
    inrRs(d.collected),
    inrRs(d.outstanding),
    inrRs(d.extAmount),
    inrRs(d.cash),
    inrRs(d.gpay),
    inrRs(d.card),
    inrRs(d.online),
  ]);
  dailyBody.push([
    'Total',
    int(dailySummaries.totals.checkIns),
    inrRs(dailySummaries.totals.booked),
    inrRs(dailySummaries.totals.collected),
    inrRs(dailySummaries.totals.outstanding),
    inrRs(dailySummaries.totals.extAmount),
    inrRs(dailySummaries.totals.cash),
    inrRs(dailySummaries.totals.gpay),
    inrRs(dailySummaries.totals.card),
    inrRs(dailySummaries.totals.online),
  ]);

  autoTable(doc, {
    startY: 48,
    head: [dailyHead],
    body: dailyBody,
    theme: 'striped',
    headStyles: { fillColor: [51, 65, 85], fontSize: 8 },
    bodyStyles: { fontSize: 7.5 },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
      8: { halign: 'right' },
      9: { halign: 'right' },
    },
    margin: { left: 36, right: 36 },
  });

  // Section 4: Source & Payment Mode Summary
  currentY = (doc as any).lastAutoTable.finalY + 18;
  if (currentY > 440) {
    doc.addPage();
    currentY = 38;
  }
  doc.setFontSize(11);
  doc.text('3. Source & Payment Mode Summary', 36, currentY);

  const sourceSummaries = buildSourceSummaries(stays);
  const sourceHead = ['Booking Source', 'Stays', 'Booked Revenue', 'Collected', 'Outstanding'];
  const sourceBody = sourceSummaries.rows.map((s) => [s.source, int(s.stays), inrRs(s.booked), inrRs(s.collected), inrRs(s.outstanding)]);
  sourceBody.push(['Total', int(sourceSummaries.totals.stays), inrRs(sourceSummaries.totals.booked), inrRs(sourceSummaries.totals.collected), inrRs(sourceSummaries.totals.outstanding)]);

  autoTable(doc, {
    startY: currentY + 6,
    head: [sourceHead],
    body: sourceBody,
    theme: 'striped',
    headStyles: { fillColor: [51, 65, 85], fontSize: 8 },
    bodyStyles: { fontSize: 7.5 },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
    },
    margin: { left: 36, right: 36 },
  });

  // Section 5: Unpaid Guests Table
  const unpaidAnalysis = buildUnpaidGuests(stays, hotelNameLookup, recNameLookup);
  if (unpaidAnalysis.unpaidList.length > 0) {
    doc.addPage();
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text('4. Unpaid & Partly Paid Guests (Outstanding Balances)', 36, 38);

    doc.setFontSize(9);
    doc.setTextColor(180, 83, 9);
    doc.text(
      `Total Outstanding: ${inrRs(unpaidAnalysis.totalOutstanding)} across ${unpaidAnalysis.unpaidList.length} guests (${unpaidAnalysis.highestRiskCount} checked out / overdue)`,
      36,
      50,
    );

    const unpaidHead = ['Guest Name', 'Phone', 'Hotel', 'Room', 'GRC', 'Check-in', 'Expected Out', 'Status', 'Total', 'Paid', 'Balance', 'Risk'];
    const unpaidBody = unpaidAnalysis.unpaidList.slice(0, 50).map((u) => [
      u.guestName,
      u.phone,
      u.hotelName,
      u.roomNumber,
      u.grcNumber,
      fmtDateTime(u.checkInTime),
      fmtDateTime(u.expectedCheckOut),
      u.stayStatus,
      inrRs(u.totalAmount),
      inrRs(u.amountPaid),
      inrRs(u.balanceAmount),
      u.isOverdueOrCheckedOut ? 'HIGH (Departed)' : 'In-House',
    ]);

    autoTable(doc, {
      startY: 58,
      head: [unpaidHead],
      body: unpaidBody,
      theme: 'striped',
      headStyles: { fillColor: [180, 83, 9], fontSize: 7.5 },
      bodyStyles: { fontSize: 7 },
      columnStyles: {
        8: { halign: 'right' },
        9: { halign: 'right' },
        10: { halign: 'right' },
      },
      margin: { left: 36, right: 36 },
    });
  }

  // Header & Footer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    // Running header on page 2+
    if (i > 1) {
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text('Starlight Hotels — Revenue & Operations Report', 36, 22);
      doc.text(`Scope: ${hotelFilterName}  |  Period: ${formatDateRangeWords(fromYmd, toYmd)}`, doc.internal.pageSize.getWidth() - 36, 22, { align: 'right' });
    }
    // Running footer on all pages
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Starlight Operations Report · Generated ${istNow} · Page ${i} of ${totalPages} · Confidential`,
      doc.internal.pageSize.getWidth() / 2,
      doc.internal.pageSize.getHeight() - 18,
      { align: 'center' },
    );
  }

  const cleanFrom = fromYmd.replace(/[^0-9-]/g, '') || 'start';
  const cleanTo = toYmd.replace(/[^0-9-]/g, '') || 'now';
  doc.save(`starlight-revenue_${cleanFrom}_${cleanTo}.pdf`);
}

/**
 * Separate PDF: Unpaid Guests List for Accounts Collection & Front Desk
 */
export async function exportUnpaidGuestsPdf({
  unpaidList,
  totalOutstanding,
  checkedOutOutstanding,
  hotelFilterName,
  fromYmd,
  toYmd,
}: {
  unpaidList: any[];
  totalOutstanding: number;
  checkedOutOutstanding: number;
  hotelFilterName: string;
  fromYmd: string;
  toYmd: string;
}) {
  const { default: jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const istNow = `${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} ${formatIstTimeOnly()}`;

  doc.setFontSize(16);
  doc.setTextColor(180, 83, 9);
  doc.text('STARLIGHT HOTELS — OUTSTANDING BALANCES / UNPAID GUESTS', 36, 38);

  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Scope: ${hotelFilterName}  |  Period: ${formatDateRangeWords(fromYmd, toYmd)} (IST)  |  Generated: ${istNow}`, 36, 52);

  // Top metric bar
  const metricHead = [['Total Outstanding Balance', 'Checked-Out / Overdue (High Risk)', 'Unpaid Guest Records']];
  const metricBody = [[inrRs(totalOutstanding), inrRs(checkedOutOutstanding), `${unpaidList.length} guests`]];

  autoTable(doc, {
    startY: 60,
    head: metricHead,
    body: metricBody,
    theme: 'grid',
    headStyles: { fillColor: [180, 83, 9], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
    bodyStyles: { fontSize: 8.5, fontStyle: 'bold' },
    margin: { left: 36, right: 36 },
  });

  const head = ['Guest Name', 'Phone', 'Hotel', 'Room', 'GRC', 'Booking ID', 'Source', 'Check-in', 'Expected Out', 'Status', 'Total', 'Paid', 'Balance', 'Receptionist'];
  const body = unpaidList.map((u) => [
    u.guestName,
    u.phone,
    u.hotelName,
    u.roomNumber,
    u.grcNumber,
    u.bookingId,
    u.source,
    fmtDateTime(u.checkInTime),
    fmtDateTime(u.expectedCheckOut),
    u.stayStatus,
    inrRs(u.totalAmount),
    inrRs(u.amountPaid),
    inrRs(u.balanceAmount),
    u.receptionistName,
  ]);

  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 12,
    head: [head],
    body: body,
    theme: 'striped',
    headStyles: { fillColor: [51, 65, 85], fontSize: 7.5 },
    bodyStyles: { fontSize: 7 },
    columnStyles: {
      10: { halign: 'right' },
      11: { halign: 'right' },
      12: { halign: 'right', fontStyle: 'bold', textColor: [180, 83, 9] },
    },
    margin: { left: 36, right: 36 },
  });

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Starlight Hotels · Unpaid Guests Report · Page ${i} of ${totalPages} · Confidential`,
      doc.internal.pageSize.getWidth() / 2,
      doc.internal.pageSize.getHeight() - 18,
      { align: 'center' },
    );
  }

  doc.save(`starlight-unpaid-guests_${new Date().toISOString().slice(0, 10)}.pdf`);
}

/**
 * Separate PDF: Check-In Report (Hotel x Date matrix)
 */
export async function exportCheckInReportPdf({
  matrix,
  hotelFilterName,
  fromYmd,
  toYmd,
}: {
  matrix: MatrixData;
  hotelFilterName: string;
  fromYmd: string;
  toYmd: string;
}) {
  const { default: jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const istNow = `${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} ${formatIstTimeOnly()}`;

  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('STARLIGHT HOTELS — CHECK-IN MATRIX REPORT', 36, 38);

  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Scope: ${hotelFilterName}  |  Period: ${formatDateRangeWords(fromYmd, toYmd)} (IST)  |  Generated: ${istNow}`, 36, 52);

  const head = ['Hotel', ...matrix.columns.map((c) => c.label), 'Total Check-ins'];
  const body = matrix.rows.map((r) => [
    r.hotelName,
    ...matrix.columns.map((c) => int(r.checkIns[c.key] ?? 0)),
    int(r.totalCheckIns),
  ]);
  body.push([
    'All hotels (Total)',
    ...matrix.columns.map((c) => int(matrix.totals.checkIns[c.key] ?? 0)),
    int(matrix.totals.totalCheckIns),
  ]);

  autoTable(doc, {
    startY: 60,
    head: [head],
    body: body,
    theme: 'striped',
    headStyles: { fillColor: [79, 70, 229], fontSize: 7.5 },
    bodyStyles: { fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 100 },
    },
    margin: { left: 36, right: 36 },
  });

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Starlight Hotels · Check-in Matrix Report · Page ${i} of ${totalPages}`,
      doc.internal.pageSize.getWidth() / 2,
      doc.internal.pageSize.getHeight() - 18,
      { align: 'center' },
    );
  }

  doc.save(`starlight-checkins_${new Date().toISOString().slice(0, 10)}.pdf`);
}
