import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

export interface ReportColumn {
  header: string;
  key: string;
  width?: number;
}

export interface ReportTable {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
}

export async function renderExcel(table: ReportTable): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(table.title.slice(0, 31)); // Excel sheet-name limit

  sheet.columns = table.columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? 20,
  }));
  sheet.getRow(1).font = { bold: true };

  for (const row of table.rows) {
    sheet.addRow(row);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Multi-sheet variant for the IQAC report bundle download - one workbook,
 * one sheet per table, same column/row rendering as renderExcel.
 */
export async function renderExcelWorkbook(tables: ReportTable[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  for (const table of tables) {
    const sheet = workbook.addWorksheet(table.title.slice(0, 31));
    sheet.columns = table.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width ?? 20,
    }));
    sheet.getRow(1).font = { bold: true };
    for (const row of table.rows) {
      sheet.addRow(row);
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

const PDF_PALETTE = {
  title: '#0f172a',
  subtitle: '#64748b',
  accent: '#2563eb',
  headerBg: '#1e293b',
  headerText: '#ffffff',
  border: '#cbd5e1',
  zebra: '#f8fafc',
  bodyText: '#334155',
  emptyText: '#94a3b8',
};

const PDF_ROW_HEIGHT = 20;
const PDF_HEADER_ROW_HEIGHT = 22;
const PDF_CELL_PADDING = 5;

/**
 * pdfkit has no built-in table widget, so the report layout — title band,
 * bordered/zebra-striped table with a header row that repeats on every
 * page, footer page numbers — is drawn by hand below. Columns are
 * fixed-width and text is truncated with an ellipsis to fit; good enough
 * for an exported report, not pixel-perfect typesetting.
 */
export function renderPdf(table: ReportTable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 40,
      size: 'A4',
      layout: 'landscape',
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    writeReportHeader(doc, table.title);
    writePdfTable(doc, table);
    addPageFooters(doc);
    doc.end();
  });
}

/** Concatenates multiple tables into one PDF, each starting on a fresh page - the IQAC report bundle's PDF branch. */
export function renderPdfBundle(tables: ReportTable[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 40,
      size: 'A4',
      layout: 'landscape',
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    tables.forEach((table, i) => {
      if (i > 0) doc.addPage();
      writeReportHeader(doc, table.title);
      writePdfTable(doc, table);
    });
    addPageFooters(doc);
    doc.end();
  });
}

/** Title + generated-on timestamp + accent rule, leaving doc.y positioned for the table that follows. */
function writeReportHeader(doc: PDFKit.PDFDocument, title: string): void {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.font('Helvetica-Bold').fontSize(17).fillColor(PDF_PALETTE.title).text(title, left, doc.y);
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(PDF_PALETTE.subtitle)
    .text(
      `Generated on ${new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`,
      left,
      doc.y + 2,
    );

  doc.moveDown(0.7);
  doc.rect(left, doc.y, width, 2.5).fill(PDF_PALETTE.accent);
  doc.moveDown(0.9);
}

function addPageFooters(doc: PDFKit.PDFDocument): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom margin trips pdfkit's own "past the content
    // area" check, which silently calls addPage() instead of drawing here -
    // relaxing the margin for this one write keeps it on the current page.
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(PDF_PALETTE.subtitle)
      .text(`Page ${i + 1} of ${range.count}`, doc.page.margins.left, doc.page.height - 25, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: 'center',
      });
    doc.page.margins.bottom = bottomMargin;
  }
}

function writePdfTable(doc: PDFKit.PDFDocument, table: ReportTable): void {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const tableWidth = right - left;
  const colWidth = tableWidth / table.columns.length;
  const pageBottom = doc.page.height - doc.page.margins.bottom;

  function drawHeaderRow(top: number): number {
    doc.rect(left, top, tableWidth, PDF_HEADER_ROW_HEIGHT).fill(PDF_PALETTE.headerBg);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_PALETTE.headerText);
    const cellHeight = doc.currentLineHeight(true) * 1.5;
    table.columns.forEach((c, i) => {
      doc.text(c.header, left + i * colWidth + PDF_CELL_PADDING, top + 6, {
        width: colWidth - PDF_CELL_PADDING * 2,
        height: cellHeight,
        ellipsis: true,
      });
    });
    return top + PDF_HEADER_ROW_HEIGHT;
  }

  function drawColumnDividers(top: number, bottom: number): void {
    doc.lineWidth(0.5).strokeColor(PDF_PALETTE.border);
    for (let i = 0; i <= table.columns.length; i++) {
      const x = left + i * colWidth;
      doc.moveTo(x, top).lineTo(x, bottom).stroke();
    }
  }

  let pageTop = doc.y;
  let y = drawHeaderRow(pageTop);

  if (table.rows.length === 0) {
    doc
      .font('Helvetica-Oblique')
      .fontSize(9)
      .fillColor(PDF_PALETTE.emptyText)
      .text('No records found for the selected filters.', left + PDF_CELL_PADDING, y + 8);
    drawColumnDividers(pageTop, y);
    return;
  }

  table.rows.forEach((row, i) => {
    if (y + PDF_ROW_HEIGHT > pageBottom) {
      drawColumnDividers(pageTop, y);
      doc.addPage();
      pageTop = doc.page.margins.top;
      y = drawHeaderRow(pageTop);
    }

    if (i % 2 === 1) {
      doc.rect(left, y, tableWidth, PDF_ROW_HEIGHT).fill(PDF_PALETTE.zebra);
    }

    doc.font('Helvetica').fontSize(8.5).fillColor(PDF_PALETTE.bodyText);
    const cellHeight = doc.currentLineHeight(true) * 1.5;
    table.columns.forEach((c, ci) => {
      const value = String(row[c.key] ?? '');
      doc.text(value, left + ci * colWidth + PDF_CELL_PADDING, y + 5, {
        width: colWidth - PDF_CELL_PADDING * 2,
        height: cellHeight,
        ellipsis: true,
      });
    });

    doc
      .lineWidth(0.5)
      .strokeColor(PDF_PALETTE.border)
      .moveTo(left, y + PDF_ROW_HEIGHT)
      .lineTo(right, y + PDF_ROW_HEIGHT)
      .stroke();

    y += PDF_ROW_HEIGHT;
  });

  drawColumnDividers(pageTop, y);
}
