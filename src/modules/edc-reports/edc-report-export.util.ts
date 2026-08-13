import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { ReportTable } from 'src/modules/library/reports/report-export.util';
import type { EdcReportStats } from './edc-reports.service';

// A dedicated, richer EDC-branded export — deliberately NOT sharing
// library/reports' plain renderExcel/renderPdf (those stay untouched for
// Hostel/Library). This one draws an actual cover page, KPI cards, a real
// vector bar chart for department participation, and a properly styled
// (banded, bordered, header-shaded) table, in both PDF and Excel.

const BRAND_BLUE = '#1D4ED8';
const BRAND_BLUE_RGB = [29, 78, 216] as const;
const INK = '#0F172A';
const MUTED = '#64748B';
const BAND = '#F8FAFC';

function inr(n: number): string {
  return `Rs. ${Math.round(n).toLocaleString('en-IN')}`;
}

/** Forces genuinely single-line text (pdfkit's `ellipsis` option only
 * truncates once a `height` cap is also given — passing it alone, as the
 * first version of this file did, let long labels wrap onto a second line
 * that then visually collided with the row below it, since row height was
 * fixed). `lineBreak: false` + an explicit `height` together are what
 * actually prevent wrapping — this is the fix for that exact bug. */
function fitText(doc: PDFKit.PDFDocument, text: string, x: number, y: number, width: number, height: number) {
  doc.text(text, x, y, { width, height, ellipsis: true, lineBreak: false });
}

export function buildEdcExcel(stats: EdcReportStats, ventureTable: ReportTable, periodLabel: string, preparedBy: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = preparedBy;
  workbook.created = new Date();

  // --- Summary sheet ---
  const summary = workbook.addWorksheet('Summary');
  summary.columns = [{ width: 32 }, { width: 24 }];
  summary.mergeCells('A1:B1');
  const title = summary.getCell('A1');
  title.value = 'EDC Venture & Activity Report';
  title.font = { size: 18, bold: true, color: { argb: 'FF1D4ED8' } };
  summary.getRow(1).height = 28;

  summary.mergeCells('A2:B2');
  summary.getCell('A2').value = `Period: ${periodLabel}  ·  Prepared by: ${preparedBy}  ·  Generated: ${new Date().toLocaleString('en-IN')}`;
  summary.getCell('A2').font = { size: 10.5, color: { argb: 'FF64748B' } };
  summary.addRow([]);

  const kpiHeaderRow = summary.addRow(['Metric', 'Value']);
  kpiHeaderRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
  });
  const kpiRows: [string, string | number][] = [
    ['Total ventures', stats.total_ventures],
    ['Ventures beyond idea stage', stats.ventures_beyond_idea],
    ['Ventures in incubation', stats.total_incubated],
    ['Idea → venture conversion rate', `${stats.idea_conversion_rate_pct}%`],
    ['Departments active', stats.departments_active],
    ['Monthly revenue reported', inr(stats.monthly_revenue_reported)],
  ];
  kpiRows.forEach(([k, v], i) => {
    const row = summary.addRow([k, v]);
    if (i % 2 === 1) row.eachCell((cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }));
  });

  summary.addRow([]);
  const deptHeaderRow = summary.addRow(['Department', 'Ventures registered']);
  deptHeaderRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
  });
  stats.department_breakdown.forEach((d, i) => {
    const row = summary.addRow([d.department, d.count]);
    if (i % 2 === 1) row.eachCell((cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }));
  });

  // --- Ventures sheet ---
  const sheet = workbook.addWorksheet('Ventures');
  sheet.columns = ventureTable.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 20 }));
  const headerRow = sheet.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    cell.alignment = { vertical: 'middle' };
  });
  ventureTable.rows.forEach((row, i) => {
    const r = sheet.addRow(row);
    if (i % 2 === 1) {
      r.eachCell((cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }));
    }
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ventureTable.columns.length } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  return workbook.xlsx.writeBuffer().then((buf) => Buffer.from(buf));
}

export function buildEdcPdf(stats: EdcReportStats, ventureTable: ReportTable, periodLabel: string, preparedBy: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width;
    const marginX = 46;
    const contentW = pageW - marginX * 2;

    function footer(pageLabel: string) {
      doc
        .fontSize(8)
        .fillColor(MUTED)
        .text(`EDC Portal · ${pageLabel} · generated ${new Date().toLocaleDateString('en-IN')}`, marginX, doc.page.height - 34, { width: contentW, align: 'center' });
    }

    // ---------- Cover / Summary (page 1) ----------
    doc.rect(0, 0, pageW, 150).fill(BRAND_BLUE);
    doc.fillColor('#FFFFFF').fontSize(24).font('Helvetica-Bold').text('EDC Venture & Activity Report', marginX, 44, { width: contentW, lineBreak: false });
    doc.fontSize(11).font('Helvetica').fillColor('#DBEAFE');
    fitText(doc, `Period: ${periodLabel}`, marginX, 84, contentW, 16);
    fitText(
      doc,
      `Prepared by ${preparedBy}  ·  Generated ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      marginX,
      102,
      contentW,
      16,
    );

    let y = 180;
    doc.fillColor(INK).fontSize(14).font('Helvetica-Bold').text('Summary', marginX, y);
    y += 26;

    const kpis: [string, string][] = [
      ['Total ventures', String(stats.total_ventures)],
      ['Beyond idea stage', String(stats.ventures_beyond_idea)],
      ['In incubation', String(stats.total_incubated)],
      ['Idea to venture conversion', `${stats.idea_conversion_rate_pct}%`],
    ];
    const cardGap = 12;
    const cardW = (contentW - 3 * cardGap) / 4;
    const cardH = 74;
    kpis.forEach(([label, value], i) => {
      const x = marginX + i * (cardW + cardGap);
      doc.roundedRect(x, y, cardW, cardH, 8).fillAndStroke('#EFF6FF', '#CFE0F7');
      doc.fillColor(MUTED).fontSize(8.5).font('Helvetica');
      fitText(doc, label, x + 10, y + 10, cardW - 20, 24);
      doc.fillColor(BRAND_BLUE).fontSize(20).font('Helvetica-Bold');
      fitText(doc, value, x + 10, y + 38, cardW - 20, 26);
    });
    y += cardH + 24;

    doc.fillColor(INK).fontSize(12).font('Helvetica-Bold').text('Other figures', marginX, y);
    y += 22;
    const otherRows: [string, string][] = [
      ['Departments active', String(stats.departments_active)],
      ['Monthly revenue reported', inr(stats.monthly_revenue_reported)],
    ];
    otherRows.forEach(([k, v]) => {
      doc.fillColor(MUTED).fontSize(10).font('Helvetica');
      fitText(doc, k, marginX, y, 240, 16);
      doc.fillColor(INK).font('Helvetica-Bold');
      fitText(doc, v, marginX + 260, y, contentW - 260, 16);
      y += 20;
    });

    footer('Summary');

    // ---------- Department participation (bar chart) ----------
    doc.addPage({ margin: 0 });
    doc.fillColor(INK).fontSize(15).font('Helvetica-Bold').text('Department participation', marginX, 40);
    doc.fillColor(MUTED).fontSize(10).font('Helvetica').text('Real ventures registered per department.', marginX, 62);

    let chartY = 96;
    const labelW = 170;
    const barGap = 16;
    const barMaxW = contentW - labelW - barGap - 40;
    const rowH = 28;
    if (stats.department_breakdown.length === 0) {
      doc.fillColor(MUTED).fontSize(11).text('No ventures registered yet.', marginX, chartY);
    }
    const maxCount = Math.max(1, ...stats.department_breakdown.map((d) => d.count));
    stats.department_breakdown.forEach((d) => {
      const barW = Math.max(4, (d.count / maxCount) * barMaxW);
      doc.fillColor(INK).fontSize(9.5).font('Helvetica');
      fitText(doc, d.department, marginX, chartY + 4, labelW, 14);
      doc.roundedRect(marginX + labelW + barGap, chartY, barMaxW, 16, 4).fill('#E9EEF6');
      doc.roundedRect(marginX + labelW + barGap, chartY, barW, 16, 4).fill(BRAND_BLUE);
      doc.fillColor(INK).fontSize(9.5).font('Helvetica-Bold');
      fitText(doc, String(d.count), marginX + labelW + barGap + barMaxW + 8, chartY + 3, 30, 14);
      chartY += rowH;
    });
    footer('Department participation');

    // ---------- Venture table ----------
    doc.addPage({ margin: 0 });
    doc.fillColor(INK).fontSize(15).font('Helvetica-Bold').text(ventureTable.title, marginX, 40);
    doc.fillColor(MUTED).fontSize(10).font('Helvetica').text(`${ventureTable.rows.length} ventures`, marginX, 62);

    const tableTop = 88;
    const rawWidths = ventureTable.columns.map((c) => c.width ?? 20);
    const totalRaw = rawWidths.reduce((a, b) => a + b, 0);
    const scaledWidths = rawWidths.map((w) => (w / totalRaw) * contentW);
    const headerH = 24;
    const dataRowH = 22;

    function drawHeader(atY: number) {
      doc.rect(marginX, atY, contentW, headerH).fill(BRAND_BLUE);
      let hx = marginX;
      ventureTable.columns.forEach((c, ci) => {
        doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold');
        fitText(doc, c.header, hx + 8, atY + 7, scaledWidths[ci] - 14, 14);
        hx += scaledWidths[ci];
      });
    }

    let rowY = tableTop;
    drawHeader(rowY);
    rowY += headerH;

    ventureTable.rows.forEach((row, i) => {
      if (rowY + dataRowH > doc.page.height - 50) {
        doc.addPage({ margin: 0 });
        footer(ventureTable.title);
        rowY = 40;
        drawHeader(rowY);
        rowY += headerH;
      }
      if (i % 2 === 1) doc.rect(marginX, rowY, contentW, dataRowH).fill(BAND);
      let cx = marginX;
      ventureTable.columns.forEach((c, ci) => {
        const val = String(row[c.key] ?? '');
        doc.fillColor(INK).fontSize(8.5).font('Helvetica');
        fitText(doc, val, cx + 8, rowY + 6, scaledWidths[ci] - 14, 14);
        cx += scaledWidths[ci];
      });
      doc
        .moveTo(marginX, rowY + dataRowH)
        .lineTo(marginX + contentW, rowY + dataRowH)
        .lineWidth(0.4)
        .strokeColor('#EEF2F7')
        .stroke();
      rowY += dataRowH;
    });
    doc
      .rect(marginX, tableTop, contentW, rowY - tableTop)
      .lineWidth(0.5)
      .strokeColor('#E2E8F0')
      .stroke();
    footer(ventureTable.title);

    doc.end();
  });
}
