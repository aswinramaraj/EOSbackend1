import ExcelJS from 'exceljs';

/**
 * Flattens every non-empty cell across every row/column into a flat list of
 * trimmed identifier strings — good enough for a single-column roll-number/
 * student-ID list regardless of which column it's in, or whether there's a
 * header row (a header like "Roll No" just won't match any real student and
 * gets reported back as not-found, which is fine).
 */
export async function parseIdentifiersFromFile(
  file: Express.Multer.File,
): Promise<string[]> {
  const isCsv =
    file.mimetype.includes('csv') ||
    file.originalname.toLowerCase().endsWith('.csv');

  const values: string[] = [];

  if (isCsv) {
    const text = file.buffer.toString('utf-8');
    for (const line of text.split(/\r?\n/)) {
      for (const cell of line.split(',')) {
        values.push(cell);
      }
    }
  } else {
    const workbook = new ExcelJS.Workbook();
    // exceljs's bundled @types/node resolves to a different (non-generic)
    // Buffer declaration than the project's own, so even a same-named
    // Buffer cast can't bridge them structurally — eslint-disable is
    // narrowly scoped to this one call, not a broad type-safety opt-out.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(Buffer.from(file.buffer) as any);
    const sheet = workbook.worksheets[0];
    sheet?.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.value != null) values.push(String(cell.value));
      });
    });
  }

  return Array.from(
    new Set(
      values.map((v) => v.replace(/["']/g, '').trim()).filter((v) => v.length > 0),
    ),
  );
}
