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

/** No CSV export existed anywhere yet — added here, shared, rather than duplicated per module. */
function toDisplayString(value: unknown): string {
  return value === null || value === undefined
    ? ''
    : typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value);
}

export function renderCsv(table: ReportTable): string {
  const escape = (value: unknown) => {
    const str = toDisplayString(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const header = table.columns.map((c) => escape(c.header)).join(',');
  const rows = table.rows.map((row) =>
    table.columns.map((c) => escape(row[c.key])).join(','),
  );
  return [header, ...rows].join('\n');
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
 * Simple manual-layout table — pdfkit has no built-in table widget, and
 * pulling in a heavier PDF templating library wasn't worth it for six
 * plain tabular reports. Columns are fixed-width and text is truncated to
 * fit; good enough for an exported report, not pixel-perfect typesetting.
 */
export function renderPdf(table: ReportTable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 40,
      size: 'A4',
      layout: 'landscape',
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).text(table.title, { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(9);

    const pageWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = pageWidth / table.columns.length;
    const rowHeight = 18;

    function drawRow(values: string[], y: number, bold: boolean) {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
      values.forEach((value, i) => {
        doc.text(value, doc.page.margins.left + i * colWidth, y, {
          width: colWidth - 4,
          ellipsis: true,
        });
      });
    }

    let y = doc.y;
    drawRow(
      table.columns.map((c) => c.header),
      y,
      true,
    );
    y += rowHeight;
    doc
      .moveTo(doc.page.margins.left, y - 4)
      .lineTo(doc.page.width - doc.page.margins.right, y - 4)
      .stroke();

    for (const row of table.rows) {
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      const values = table.columns.map((c) => toDisplayString(row[c.key]));
      drawRow(values, y, false);
      y += rowHeight;
    }

    doc.end();
  });
}
