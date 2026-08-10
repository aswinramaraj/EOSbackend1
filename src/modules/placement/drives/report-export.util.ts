import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

export interface ReportColumn {
  header: string;
  key: string;
  align?: 'left' | 'right';
}

export interface ReportSummaryItem {
  label: string;
  value: string;
}

export interface ReportTable {
  title: string;
  subtitle?: string;
  summary?: ReportSummaryItem[];
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
}

export async function renderExcel(table: ReportTable): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(table.title.slice(0, 31)); // Excel sheet-name limit
  sheet.columns = table.columns.map(() => ({ width: 24 }));

  sheet.addRow([table.title]).font = { bold: true, size: 14 };
  if (table.subtitle) sheet.addRow([table.subtitle]);
  sheet.addRow([]);

  for (const item of table.summary ?? []) {
    const row = sheet.addRow([item.label, item.value]);
    row.getCell(1).font = { bold: true };
  }
  if (table.summary?.length) sheet.addRow([]);

  const headerRow = sheet.addRow(table.columns.map((c) => c.header));
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' },
    };
  });

  for (const row of table.rows) {
    const values = table.columns.map((c) => (row[c.key] as string | number) ?? '');
    const excelRow = sheet.addRow(values);
    table.columns.forEach((c, i) => {
      if (c.align === 'right') excelRow.getCell(i + 1).alignment = { horizontal: 'right' };
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Simple manual-layout table — pdfkit has no built-in table widget. Draws a
 * title/subtitle header, an optional KPI summary strip, then a table with a
 * colored header row and alternating row shading for readability.
 */
export function renderPdf(table: ReportTable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageLeft = doc.page.margins.left;
    const pageRight = doc.page.width - doc.page.margins.right;
    const pageWidth = pageRight - pageLeft;

    doc.fontSize(18).font('Helvetica-Bold').fillColor('#0f172a').text(table.title);
    if (table.subtitle) {
      doc.moveDown(0.2);
      doc.fontSize(10).font('Helvetica').fillColor('#64748b').text(table.subtitle);
    }
    doc.moveDown(0.15);
    doc
      .fontSize(8)
      .fillColor('#94a3b8')
      .text(`Generated ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`);
    doc.moveDown(0.7);

    if (table.summary?.length) {
      const boxTop = doc.y;
      const boxHeight = 48;
      doc.roundedRect(pageLeft, boxTop, pageWidth, boxHeight, 6).fillAndStroke('#f8fafc', '#e2e8f0');
      const itemWidth = pageWidth / table.summary.length;
      table.summary.forEach((item, i) => {
        const x = pageLeft + i * itemWidth + 14;
        doc
          .fillColor('#0f172a')
          .font('Helvetica-Bold')
          .fontSize(13)
          .text(item.value, x, boxTop + 9, { width: itemWidth - 20 });
        doc
          .fillColor('#64748b')
          .font('Helvetica')
          .fontSize(8)
          .text(item.label, x, boxTop + 28, { width: itemWidth - 20 });
      });
      doc.y = boxTop + boxHeight + 20;
    }

    const colWidth = pageWidth / table.columns.length;
    const rowHeight = 20;
    const headerHeight = 22;

    function drawHeader(y: number): number {
      doc.rect(pageLeft, y, pageWidth, headerHeight).fill('#1d4ed8');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
      table.columns.forEach((c, i) => {
        doc.text(c.header.toUpperCase(), pageLeft + i * colWidth + 8, y + 6, {
          width: colWidth - 16,
          align: c.align === 'right' ? 'right' : 'left',
        });
      });
      return y + headerHeight;
    }

    let y = drawHeader(doc.y);

    table.rows.forEach((row, rIdx) => {
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = drawHeader(doc.page.margins.top);
      }
      if (rIdx % 2 === 1) {
        doc.rect(pageLeft, y, pageWidth, rowHeight).fill('#f8fafc');
      }
      doc.fillColor('#1e293b').font('Helvetica').fontSize(9);
      table.columns.forEach((c, i) => {
        const value = String(row[c.key] ?? '—');
        doc.text(value, pageLeft + i * colWidth + 8, y + 5, {
          width: colWidth - 16,
          align: c.align === 'right' ? 'right' : 'left',
          ellipsis: true,
        });
      });
      y += rowHeight;
    });

    doc.end();
  });
}
