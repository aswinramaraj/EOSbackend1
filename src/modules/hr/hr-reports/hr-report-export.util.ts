import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

/**
 * Renderers for the HR report pack.
 *
 * `src/common/utils/report-export.util.ts` renders a single flat table, which
 * is not enough here: an HR report is a letterheaded document with a KPI band
 * and several sections, and payroll figures have to line up on the decimal
 * point and carry a totals row that reconciles with the rows above it. So this
 * file adds a document model (`HrReportDocument`) and both renderers for it,
 * rather than bending the generic one out of shape.
 *
 * Money is formatted in the Indian numbering system (lakh/crore grouping) and
 * Excel cells are written as real numbers with a ₹ number format, so the
 * recipient can sum them — writing pre-formatted strings would produce a
 * spreadsheet nobody can compute with.
 */

export interface HrReportColumn {
  header: string;
  key: string;
  /** Relative width. Defaults to 1. */
  width?: number;
  align?: 'left' | 'right' | 'center';
  /** Renders as currency (Excel number format + right alignment). */
  money?: boolean;
  /** Renders as a plain number (Excel numeric cell, right aligned). */
  number?: boolean;
}

export interface HrReportSection {
  heading: string;
  /** Optional one-line explanation printed under the heading. */
  note?: string;
  columns: HrReportColumn[];
  rows: Record<string, unknown>[];
  /**
   * Totals row, keyed the same way as `rows`. Rendered bold with a rule above
   * it and excluded from zebra striping.
   */
  totals?: Record<string, unknown>;
  /** Shown in place of the table when `rows` is empty. */
  emptyMessage?: string;
}

export interface HrReportKpi {
  label: string;
  value: string;
}

/** Key/value lines printed above the sections, e.g. the employee an annual statement is for. */
export interface HrReportMetaRow {
  label: string;
  value: string;
}

export interface HrReportDocument {
  /** Used for the PDF title band, the workbook name and the download filename. */
  title: string;
  subtitle?: string;
  /** Printed in the header band, e.g. "Financial year 2026-27". */
  scope?: string;
  kpis?: HrReportKpi[];
  meta?: HrReportMetaRow[];
  sections: HrReportSection[];
  /** Printed at the end of the document, e.g. the Form 16 caveat. */
  footnote?: string;
  orientation?: 'portrait' | 'landscape';
}

const INSTITUTION = {
  name: 'Sri Eshwar College of Engineering',
  line2: '(Approved by AICTE, New Delhi & Affiliated to Anna University)',
  address: 'Kondampatti (P.O), Vadasithur (Via), Kinathukadavu, Coimbatore - 641 202.',
};

const PALETTE = {
  ink: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  subtle: '#94a3b8',
  accent: '#1d4ed8',
  headerBg: '#0f172a',
  headerText: '#ffffff',
  border: '#cbd5e1',
  hairline: '#e2e8f0',
  zebra: '#f7f9fc',
  kpiBg: '#f1f5f9',
};

/** Same lookup the fee-receipt renderer uses, so both find the logo in dev and in dist. */
function resolveLogoPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'src', 'assets', 'college-logo.png'),
    path.join(__dirname, '..', '..', '..', 'assets', 'college-logo.png'),
    path.join(process.cwd(), 'dist', 'assets', 'college-logo.png'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

/** en-IN grouping (1,23,456) — what a payroll reader in India expects. */
export function formatMoney(value: unknown): string {
  if (isBlank(value)) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function cellText(col: HrReportColumn, row: Record<string, unknown>): string {
  const raw = row[col.key];
  if (col.money) return formatMoney(raw);
  if (isBlank(raw)) return '—';
  if (col.number) {
    const n = Number(raw);
    return Number.isFinite(n) ? n.toLocaleString('en-IN') : String(raw);
  }
  return String(raw);
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Filename (without extension) for a rendered report. */
export function reportFilename(doc: HrReportDocument): string {
  return slug(doc.scope ? `${doc.title}-${doc.scope}` : doc.title);
}

// ──────────────────────────────────────────────────────────────────────────────
// Excel
// ──────────────────────────────────────────────────────────────────────────────

const MONEY_FORMAT = '₹#,##,##0.00';
const NUMBER_FORMAT = '#,##,##0';

/**
 * One worksheet per section, each with a letterhead block, the KPI band and a
 * frozen, auto-filtered header row. Numeric cells are written as numbers with a
 * currency format rather than as strings, so totals and pivots still work in
 * the recipient's copy.
 */
export async function renderHrReportExcel(report: HrReportDocument): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = INSTITUTION.name;
  workbook.created = new Date();

  report.sections.forEach((section, index) => {
    // Excel caps sheet names at 31 chars and rejects : \ / ? * [ ].
    const rawName = section.heading || `Sheet ${index + 1}`;
    const sheetName = rawName.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || `Sheet ${index + 1}`;
    const sheet = workbook.addWorksheet(sheetName, {
      views: [{ state: 'frozen', ySplit: 0 }],
    });

    const colCount = Math.max(1, section.columns.length);
    const lastCol = (n: number) => sheet.getRow(n).getCell(colCount);

    function titleLine(text: string, opts: { size: number; bold?: boolean; color?: string }) {
      const row = sheet.addRow([text]);
      sheet.mergeCells(row.number, 1, row.number, colCount);
      row.getCell(1).font = {
        size: opts.size,
        bold: opts.bold ?? false,
        color: { argb: (opts.color ?? PALETTE.ink).replace('#', 'FF') },
      };
      row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      return row;
    }

    titleLine(INSTITUTION.name, { size: 14, bold: true });
    titleLine(INSTITUTION.address, { size: 9, color: PALETTE.muted });
    titleLine(report.title, { size: 12, bold: true, color: PALETTE.accent });
    if (report.subtitle) titleLine(report.subtitle, { size: 9.5, color: PALETTE.muted });
    if (report.scope) titleLine(report.scope, { size: 9.5, color: PALETTE.muted });
    titleLine(
      `Generated ${new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · Confidential — HR use`,
      { size: 8.5, color: PALETTE.subtle },
    );
    sheet.addRow([]);

    for (const m of report.meta ?? []) {
      const row = sheet.addRow([m.label, m.value]);
      row.getCell(1).font = { bold: true, size: 9.5 };
      row.getCell(2).font = { size: 9.5 };
    }
    if ((report.meta ?? []).length > 0) sheet.addRow([]);

    if ((report.kpis ?? []).length > 0) {
      const labels = sheet.addRow((report.kpis ?? []).map((k) => k.label));
      labels.eachCell((c) => {
        c.font = { size: 9, color: { argb: 'FF64748B' } };
      });
      const values = sheet.addRow((report.kpis ?? []).map((k) => k.value));
      values.eachCell((c) => {
        c.font = { size: 12, bold: true };
      });
      sheet.addRow([]);
    }

    if (section.note) {
      const row = titleLine(section.note, { size: 9, color: PALETTE.muted });
      row.getCell(1).alignment = { horizontal: 'left', wrapText: true };
      sheet.addRow([]);
    }

    const headerRow = sheet.addRow(section.columns.map((c) => c.header));
    headerRow.eachCell((cell, i) => {
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      cell.alignment = {
        horizontal: section.columns[i - 1]?.money || section.columns[i - 1]?.number ? 'right' : 'left',
        vertical: 'middle',
      };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
    });
    headerRow.height = 20;

    const firstDataRow = headerRow.number + 1;

    for (const row of section.rows) {
      const values = section.columns.map((c) => {
        const raw = row[c.key];
        if (c.money || c.number) {
          const n = Number(raw);
          return isBlank(raw) || !Number.isFinite(n) ? null : n;
        }
        return isBlank(raw) ? '' : String(raw);
      });
      const excelRow = sheet.addRow(values);
      excelRow.eachCell((cell, i) => {
        const col = section.columns[i - 1];
        if (!col) return;
        if (col.money) cell.numFmt = MONEY_FORMAT;
        else if (col.number) cell.numFmt = NUMBER_FORMAT;
        cell.alignment = {
          horizontal: col.align ?? (col.money || col.number ? 'right' : 'left'),
        };
        cell.font = { size: 10 };
      });
    }

    if (section.rows.length === 0) {
      const row = sheet.addRow([section.emptyMessage ?? 'No records for the selected filters.']);
      sheet.mergeCells(row.number, 1, row.number, colCount);
      row.getCell(1).font = { italic: true, size: 9.5, color: { argb: 'FF94A3B8' } };
    }

    if (section.totals) {
      const values = section.columns.map((c, i) => {
        const raw = section.totals?.[c.key];
        if (isBlank(raw)) return i === 0 ? 'Total' : null;
        if (c.money || c.number) {
          const n = Number(raw);
          return Number.isFinite(n) ? n : String(raw);
        }
        return String(raw);
      });
      const totalRow = sheet.addRow(values);
      totalRow.eachCell((cell, i) => {
        const col = section.columns[i - 1];
        cell.font = { bold: true, size: 10 };
        cell.border = { top: { style: 'medium', color: { argb: 'FF0F172A' } } };
        if (col?.money) cell.numFmt = MONEY_FORMAT;
        else if (col?.number) cell.numFmt = NUMBER_FORMAT;
        cell.alignment = {
          horizontal: col?.align ?? (col?.money || col?.number ? 'right' : 'left'),
        };
      });
    }

    // A filter over a single header row only makes sense when there is data
    // under it; ExcelJS writes the ref regardless, and Excel warns on an empty
    // range.
    if (section.rows.length > 0) {
      sheet.autoFilter = {
        from: { row: headerRow.number, column: 1 },
        to: { row: headerRow.number + section.rows.length, column: colCount },
      };
      sheet.views = [{ state: 'frozen', ySplit: headerRow.number }];
    }

    section.columns.forEach((c, i) => {
      const header = c.header.length;
      const widest = section.rows.reduce((max, row) => {
        const text = cellText(c, row);
        return Math.max(max, text.length);
      }, header);
      sheet.getColumn(i + 1).width = Math.min(46, Math.max(12, widest + 3));
    });

    if (report.footnote) {
      sheet.addRow([]);
      const row = sheet.addRow([report.footnote]);
      sheet.mergeCells(row.number, 1, row.number, colCount);
      row.getCell(1).font = { italic: true, size: 8.5, color: { argb: 'FF64748B' } };
      row.getCell(1).alignment = { wrapText: true };
    }

    // Silences the unused-helper warning while keeping the accessor available
    // for future per-sheet tweaks.
    void lastCol;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ──────────────────────────────────────────────────────────────────────────────
// PDF
// ──────────────────────────────────────────────────────────────────────────────

const ROW_H = 19;
const HEADER_H = 22;
const PAD = 5;

interface PdfLayout {
  left: number;
  right: number;
  width: number;
}

/**
 * Letterheaded, sectioned PDF: logo + institution block, a rule, the report
 * title, a KPI band, then each section as a bordered table whose header row
 * repeats on every page. Footers carry the page number and a confidentiality
 * line.
 *
 * pdfkit has no table widget, so the table is drawn by hand. Column widths are
 * proportional to each column's declared `width`, and text is clipped with an
 * ellipsis rather than wrapped, which keeps every row exactly one line high and
 * the page-break arithmetic honest.
 */
export function renderHrReportPdf(report: HrReportDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 38,
      size: 'A4',
      layout: report.orientation ?? 'landscape',
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const layout: PdfLayout = {
      left: doc.page.margins.left,
      right: doc.page.width - doc.page.margins.right,
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    };

    drawLetterhead(doc, layout, report);
    if (report.meta && report.meta.length > 0) drawMeta(doc, layout, report.meta);
    if (report.kpis && report.kpis.length > 0) drawKpiBand(doc, layout, report.kpis);

    report.sections.forEach((section, i) => {
      if (i > 0) doc.moveDown(1.1);
      drawSection(doc, layout, section);
    });

    if (report.footnote) {
      doc.moveDown(0.9);
      doc
        .font('Helvetica-Oblique')
        .fontSize(8)
        .fillColor(PALETTE.muted)
        .text(report.footnote, layout.left, doc.y, { width: layout.width });
    }

    drawFooters(doc);
    doc.end();
  });
}

function drawLetterhead(doc: PDFKit.PDFDocument, l: PdfLayout, report: HrReportDocument): void {
  const top = doc.y;
  const logo = resolveLogoPath();
  const textX = logo ? l.left + 58 : l.left;
  const textW = l.width - (logo ? 58 : 0) - 150;

  if (logo) {
    doc.save();
    doc.circle(l.left + 22, top + 22, 22).clip();
    doc.image(logo, l.left, top, { width: 44, height: 44 });
    doc.restore();
  }

  doc.font('Helvetica-Bold').fontSize(13.5).fillColor(PALETTE.ink).text(INSTITUTION.name, textX, top, { width: textW });
  doc.font('Helvetica').fontSize(7.5).fillColor(PALETTE.muted).text(INSTITUTION.line2, textX, doc.y + 0.5, { width: textW });
  doc.font('Helvetica').fontSize(7.5).fillColor(PALETTE.muted).text(INSTITUTION.address, textX, doc.y + 0.5, { width: textW });

  // Right-hand stamp: who this is for and when it was produced.
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(PALETTE.accent)
    .text('CONFIDENTIAL · HR', l.right - 150, top + 2, { width: 150, align: 'right' });
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(PALETTE.muted)
    .text(
      new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
      l.right - 150,
      top + 14,
      { width: 150, align: 'right' },
    );

  const bandY = Math.max(doc.y, top + 46) + 6;
  doc.rect(l.left, bandY, l.width, 2).fill(PALETTE.accent);

  doc.font('Helvetica-Bold').fontSize(15).fillColor(PALETTE.ink).text(report.title, l.left, bandY + 9, { width: l.width });
  if (report.subtitle) {
    doc.font('Helvetica').fontSize(9).fillColor(PALETTE.muted).text(report.subtitle, l.left, doc.y + 1, { width: l.width });
  }
  if (report.scope) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(PALETTE.body).text(report.scope, l.left, doc.y + 2, { width: l.width });
  }
  doc.moveDown(0.7);
}

function drawMeta(doc: PDFKit.PDFDocument, l: PdfLayout, meta: HrReportMetaRow[]): void {
  const colW = l.width / 2;
  let y = doc.y;
  meta.forEach((m, i) => {
    const x = l.left + (i % 2) * colW;
    if (i % 2 === 0 && i > 0) y += 13;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PALETTE.muted).text(`${m.label}: `, x, y, {
      continued: true,
      width: colW - 8,
    });
    doc.font('Helvetica').fillColor(PALETTE.ink).text(m.value, { width: colW - 8 });
  });
  doc.y = y + 20;
}

function drawKpiBand(doc: PDFKit.PDFDocument, l: PdfLayout, kpis: HrReportKpi[]): void {
  const gap = 8;
  const cardW = (l.width - gap * (kpis.length - 1)) / kpis.length;
  const top = doc.y;
  const h = 42;

  kpis.forEach((k, i) => {
    const x = l.left + i * (cardW + gap);
    doc.roundedRect(x, top, cardW, h, 5).fill(PALETTE.kpiBg);
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(PALETTE.muted)
      .text(k.label.toUpperCase(), x + 8, top + 7, { width: cardW - 16, height: 10, ellipsis: true });
    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor(PALETTE.ink)
      .text(k.value, x + 8, top + 20, { width: cardW - 16, height: 16, ellipsis: true });
  });

  doc.y = top + h + 14;
}

function drawSection(doc: PDFKit.PDFDocument, l: PdfLayout, section: HrReportSection): void {
  const weights = section.columns.map((c) => c.width ?? 1);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / weightSum) * l.width);
  const offsets = widths.reduce<number[]>((acc, w, i) => {
    acc.push(i === 0 ? l.left : acc[i - 1] + widths[i - 1]);
    return acc;
  }, []);

  // A heading alone at the foot of a page reads as an orphan, so keep it with
  // its header row and at least one data row.
  const pageBottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + 26 + HEADER_H + ROW_H > pageBottom) doc.addPage();

  doc.font('Helvetica-Bold').fontSize(11).fillColor(PALETTE.ink).text(section.heading, l.left, doc.y, { width: l.width });
  if (section.note) {
    doc.font('Helvetica').fontSize(8).fillColor(PALETTE.muted).text(section.note, l.left, doc.y + 1, { width: l.width });
  }
  doc.moveDown(0.45);

  function drawHeaderRow(top: number): number {
    doc.rect(l.left, top, l.width, HEADER_H).fill(PALETTE.headerBg);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PALETTE.headerText);
    section.columns.forEach((c, i) => {
      doc.text(c.header, offsets[i] + PAD, top + 7, {
        width: widths[i] - PAD * 2,
        height: 11,
        ellipsis: true,
        align: c.align ?? (c.money || c.number ? 'right' : 'left'),
      });
    });
    return top + HEADER_H;
  }

  function drawVerticals(top: number, bottom: number): void {
    doc.lineWidth(0.4).strokeColor(PALETTE.border);
    for (let i = 0; i <= section.columns.length; i++) {
      const x = i === section.columns.length ? l.right : offsets[i];
      doc.moveTo(x, top).lineTo(x, bottom).stroke();
    }
    doc.moveTo(l.left, bottom).lineTo(l.right, bottom).stroke();
  }

  let bandTop = doc.y;
  let y = drawHeaderRow(bandTop);

  if (section.rows.length === 0) {
    doc
      .font('Helvetica-Oblique')
      .fontSize(8.5)
      .fillColor(PALETTE.subtle)
      .text(section.emptyMessage ?? 'No records for the selected filters.', l.left + PAD, y + 6, {
        width: l.width - PAD * 2,
      });
    drawVerticals(bandTop, y + ROW_H);
    doc.y = y + ROW_H + 4;
    return;
  }

  section.rows.forEach((row, i) => {
    if (y + ROW_H > pageBottom) {
      drawVerticals(bandTop, y);
      doc.addPage();
      bandTop = doc.page.margins.top;
      y = drawHeaderRow(bandTop);
    }

    if (i % 2 === 1) doc.rect(l.left, y, l.width, ROW_H).fill(PALETTE.zebra);

    doc.font('Helvetica').fontSize(8.5).fillColor(PALETTE.body);
    section.columns.forEach((c, ci) => {
      doc.text(cellText(c, row), offsets[ci] + PAD, y + 5.5, {
        width: widths[ci] - PAD * 2,
        height: 11,
        ellipsis: true,
        align: c.align ?? (c.money || c.number ? 'right' : 'left'),
      });
    });

    doc
      .lineWidth(0.4)
      .strokeColor(PALETTE.hairline)
      .moveTo(l.left, y + ROW_H)
      .lineTo(l.right, y + ROW_H)
      .stroke();

    y += ROW_H;
  });

  if (section.totals) {
    if (y + ROW_H > pageBottom) {
      drawVerticals(bandTop, y);
      doc.addPage();
      bandTop = doc.page.margins.top;
      y = drawHeaderRow(bandTop);
    }
    doc.lineWidth(1).strokeColor(PALETTE.ink).moveTo(l.left, y).lineTo(l.right, y).stroke();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PALETTE.ink);
    section.columns.forEach((c, ci) => {
      const totals = section.totals ?? {};
      const raw = totals[c.key];
      const text = isBlank(raw) ? (ci === 0 ? 'Total' : '') : cellText(c, totals);
      doc.text(text, offsets[ci] + PAD, y + 5.5, {
        width: widths[ci] - PAD * 2,
        height: 11,
        ellipsis: true,
        align: c.align ?? (c.money || c.number ? 'right' : 'left'),
      });
    });
    y += ROW_H;
  }

  drawVerticals(bandTop, y);
  doc.y = y + 4;
}

function drawFooters(doc: PDFKit.PDFDocument): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom margin trips pdfkit's own "past the content
    // area" check, which silently calls addPage() instead of drawing here —
    // relaxing the margin for this one write keeps it on the current page.
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    doc
      .lineWidth(0.4)
      .strokeColor(PALETTE.hairline)
      .moveTo(left, doc.page.height - 30)
      .lineTo(left + width, doc.page.height - 30)
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(PALETTE.subtle)
      .text(`${INSTITUTION.name} · Generated from EOS payroll records`, left, doc.page.height - 24, {
        width: width / 2,
      });
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(PALETTE.subtle)
      .text(`Page ${i + 1} of ${range.count}`, left + width / 2, doc.page.height - 24, {
        width: width / 2,
        align: 'right',
      });
    doc.page.margins.bottom = saved;
  }
}
