import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';

export interface MarksheetSubjectRow {
  code: string;
  name: string;
  credits: number;
  max_marks: number;
  marks_obtained: number;
  grade_label: string;
  grade_point: number | null;
  is_pass: boolean;
}

export interface MarksheetData {
  student_name: string;
  register_no: string | null;
  date_of_birth: string | null;
  programme: string;
  department_name: string | null;
  regulation_code: string | null;
  batch_label: string | null;
  semester: number;
  academic_year: string | null;
  exam_title: string;
  photo_url: string | null;
  subjects: MarksheetSubjectRow[];
  total_credits: number;
  earned_credits: number;
  sgpa: number | null;
  overall_result: 'PASS' | 'FAIL';
}

/** Same three-candidate search as receipt-pdf.util.ts's own resolveLogoPath — duplicated rather than shared/exported since that file keeps its own helpers private, matching this codebase's per-file-utility convention. */
function resolveLogoPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'src', 'assets', 'college-logo.png'),
    path.join(__dirname, '..', '..', '..', '..', 'assets', 'college-logo.png'),
    path.join(process.cwd(), 'dist', 'assets', 'college-logo.png'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/** The student's own profile photo (students.photo_url, same Supabase-hosted image used everywhere else this student's photo appears — see PERSON_SELECT/ProfileService) is a remote URL, not a local file — fetched and embedded directly rather than skipped, since a real marksheet always carries the candidate's photo. Missing/unreachable just means the photo box renders empty, same graceful-degradation shape as resolveLogoPath. */
async function fetchImageBuffer(url: string | null): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Best-effort "NOV 2024" / "APR-MAY 2025"-style exam session label, derived
 * from the same odd/even-semester → term convention already established in
 * receipt-pdf.util.ts's sem_period ("Odd Sem"=Jul-Dec, ending in a November
 * exam; "Even Sem"=Jan-May, ending around April/May) — academic_year is
 * stored as "2024-2025" (first-second year of the odd/even pair), so an odd
 * semester's exam falls in the FIRST year, an even semester's in the SECOND.
 */
function examSessionLabel(semester: number, academicYear: string | null): string {
  if (!academicYear) return `Semester ${semester}`;
  const [startYear, endYear] = academicYear.split('-').map((y) => y.trim());
  const isOdd = semester % 2 === 1;
  const month = isOdd ? 'NOV' : 'APR-MAY';
  const year = isOdd ? startYear : (endYear ?? startYear);
  return `${month} ${year}`;
}

/** UTC getters, not local ones — date_of_birth is a plain @db.Date column
 * (no time-of-day/timezone component at all), so its ISO string's calendar
 * date is the real value regardless of what timezone this server process
 * happens to run in; reading it with local getters could shift it a day in
 * a UTC-negative server timezone. Same "trust the ISO string's own UTC
 * date" convention this codebase's many toDateOnly() helpers already rely
 * on (e.g. me-fees.service.ts's own). */
function formatDate(iso: string | null): string {
  if (!iso) return 'NA';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'NA';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/**
 * Modelled directly on a real Sri Eshwar College "Provisional Result Copy"
 * (Office of the Controller of Examinations letterhead, two-column student
 * info block with photo, SEM/CODE/TITLE/CREDIT/GRADE/POINT/RESULT table) —
 * not the fee-receipt layout this file used to mirror.
 */
export async function renderMarksheetPdf(sheet: MarksheetData): Promise<Buffer> {
  const photoBuffer = await fetchImageBuffer(sheet.photo_url);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const contentWidth = right - left;

    // ---- Header: logo, college name/address, office/exam titles ----
    const logoPath = resolveLogoPath();
    const headerTop = doc.y;
    if (logoPath) {
      doc.save();
      doc.circle(left + 30, headerTop + 30, 30).clip();
      doc.image(logoPath, left, headerTop, { width: 60, height: 60 });
      doc.restore();
    }

    const headerTextX = left + 80;
    const headerTextWidth = contentWidth - 80;
    doc
      .font('Helvetica-Bold')
      .fontSize(17)
      .fillColor('#000000')
      .text('Sri Eshwar College of Engineering', headerTextX, headerTop + 2, {
        width: headerTextWidth,
        align: 'center',
      });
    doc
      .font('Helvetica')
      .fontSize(9)
      .text('(An Autonomous Institution)', headerTextX, doc.y + 1, {
        width: headerTextWidth,
        align: 'center',
      });
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(
        'Approved by AICTE, New Delhi and Affiliated to Anna University, Chennai',
        headerTextX,
        doc.y + 1,
        { width: headerTextWidth, align: 'center' },
      );
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(
        'Kondampatti (Post), Kinathukadavu (Tk), Coimbatore - 641 202',
        headerTextX,
        doc.y + 1,
        { width: headerTextWidth, align: 'center' },
      );

    doc.y = Math.max(doc.y, headerTop + 62) + 10;
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#000000').stroke();
    doc.moveDown(0.5);

    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .text('OFFICE OF THE CONTROLLER OF EXAMINATIONS', left, doc.y, {
        width: contentWidth,
        align: 'center',
      });
    doc.moveDown(0.4);
    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .text(
        `Autonomous Semester End Examinations - ${examSessionLabel(sheet.semester, sheet.academic_year)} :: Provisional Result Copy`,
        left,
        doc.y,
        { width: contentWidth, align: 'center' },
      );
    doc.moveDown(0.6);
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#000000').stroke();
    doc.moveDown(0.5);

    // ---- Two-column student info block, photo top-right ----
    const infoTop = doc.y;
    const photoW = 78;
    const photoH = 96;
    const photoX = right - photoW;
    if (photoBuffer) {
      try {
        doc.rect(photoX, infoTop, photoW, photoH).strokeColor('#9CA3AF').stroke();
        doc.image(photoBuffer, photoX + 2, infoTop + 2, { width: photoW - 4, height: photoH - 4 });
      } catch {
        // Not a decodable image (unexpected content-type etc.) - leave the
        // box outline only rather than fail the whole marksheet over a photo.
      }
    } else {
      doc.rect(photoX, infoTop, photoW, photoH).strokeColor('#9CA3AF').stroke();
    }

    const labelColWidth = 105;
    const leftColX = left;
    const leftValueX = left + labelColWidth;
    const leftColWidth = photoX - 16 - leftValueX;
    const rightColX = left + contentWidth * 0.58;
    const rightLabelWidth = 78;
    const rightValueX = rightColX + rightLabelWidth;
    const rightColWidth = photoX - 16 - rightValueX;

    const infoField = (
      x: number,
      valueX: number,
      valueWidth: number,
      y: number,
      label: string,
      value: string,
    ) => {
      doc.font('Helvetica').fontSize(10).text(label, x, y, { width: valueX - x - 4 });
      doc.font('Helvetica-Bold').fontSize(10).text(value, valueX, y, { width: valueWidth });
    };

    let leftY = infoTop;
    infoField(leftColX, leftValueX, leftColWidth, leftY, 'Register Number', sheet.register_no ?? 'NA');
    leftY += 18;
    infoField(leftColX, leftValueX, leftColWidth, leftY, 'Name of the Student', sheet.student_name);
    leftY += 18;
    infoField(leftColX, leftValueX, leftColWidth, leftY, 'Date of Birth', formatDate(sheet.date_of_birth));
    leftY += 18;
    infoField(leftColX, leftValueX, leftColWidth, leftY, 'Program', sheet.programme);
    leftY += 18;
    infoField(leftColX, leftValueX, leftColWidth, leftY, 'Branch', (sheet.department_name ?? 'NA').toUpperCase());

    let rightY = infoTop;
    infoField(rightColX, rightValueX, rightColWidth, rightY, 'Regulation', sheet.regulation_code ?? 'NA');
    rightY += 18;
    infoField(rightColX, rightValueX, rightColWidth, rightY, 'Batch', sheet.batch_label ?? 'NA');
    rightY += 18;
    infoField(rightColX, rightValueX, rightColWidth, rightY, 'Medium', 'English');
    rightY += 18;
    infoField(rightColX, rightValueX, rightColWidth, rightY, 'Semester', String(sheet.semester));

    doc.y = Math.max(leftY + 18, infoTop + photoH) + 10;
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#000000').stroke();
    doc.moveDown(0.5);

    // ---- SEM / CODE / TITLE / CREDIT / GRADE / POINT / RESULT table ----
    const semX = left;
    const codeX = left + 30;
    const titleX = left + 95;
    const creditX = right - 195;
    const gradeX = right - 145;
    const pointX = right - 95;
    const resultX = right - 55;

    const headerY = doc.y;
    doc.font('Helvetica-Bold').fontSize(8.5);
    doc.text('SEM', semX, headerY, { width: codeX - semX - 4 });
    doc.text('CODE', codeX, headerY, { width: titleX - codeX - 4 });
    doc.text('COURSE TITLE', titleX, headerY, { width: creditX - titleX - 6 });
    doc.text('CREDIT', creditX, headerY, { width: gradeX - creditX - 4, align: 'center' });
    doc.text('GRADE', gradeX, headerY, { width: pointX - gradeX - 4, align: 'center' });
    doc.text('POINT', pointX, headerY, { width: resultX - pointX - 4, align: 'center' });
    doc.text('RESULT', resultX, headerY, { width: right - resultX, align: 'center' });
    doc.y = headerY + doc.currentLineHeight() + 4;
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#000000').stroke();
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(9.5);
    sheet.subjects.forEach((subject) => {
      const y = doc.y;
      const rowHeight = Math.max(
        doc.heightOfString(subject.name, { width: creditX - titleX - 6 }),
        14,
      );
      doc.text(String(sheet.semester), semX, y, { width: codeX - semX - 4 });
      doc.text(subject.code, codeX, y, { width: titleX - codeX - 4 });
      doc.text(subject.name, titleX, y, { width: creditX - titleX - 6 });
      doc.text(subject.credits > 0 ? String(subject.credits) : 'NC', creditX, y, {
        width: gradeX - creditX - 4,
        align: 'center',
      });
      doc
        .font('Helvetica-Bold')
        .text(subject.grade_label, gradeX, y, { width: pointX - gradeX - 4, align: 'center' })
        .font('Helvetica');
      doc.text(subject.grade_point !== null ? String(subject.grade_point) : '-', pointX, y, {
        width: resultX - pointX - 4,
        align: 'center',
      });
      doc
        .fillColor(subject.is_pass ? '#16A34A' : '#DC2626')
        .text(subject.is_pass ? 'PASS' : 'FAIL', resultX, y, { width: right - resultX, align: 'center' })
        .fillColor('#000000');
      doc.y = y + rowHeight + 6;
    });

    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#000000').stroke();
    doc.moveDown(0.5);

    // ---- Totals / SGPA / overall result ----
    const footerY = doc.y;
    doc
      .font('Helvetica')
      .fontSize(9.5)
      .text(
        `Total Credits: ${sheet.total_credits}   Earned Credits: ${sheet.earned_credits}`,
        left,
        footerY,
        { width: gradeX - left },
      );
    doc.font('Helvetica-Bold').fontSize(10.5).text('SGPA', gradeX, footerY, { width: pointX - gradeX - 4, align: 'center' });
    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .text(sheet.sgpa !== null ? sheet.sgpa.toFixed(2) : 'NA', pointX, footerY, {
        width: resultX - pointX - 4,
        align: 'center',
      });
    doc
      .fillColor(sheet.overall_result === 'PASS' ? '#16A34A' : '#DC2626')
      .font('Helvetica-Bold')
      .text(sheet.overall_result, resultX, footerY, { width: right - resultX, align: 'center' })
      .fillColor('#000000');

    doc.y = Math.max(doc.y, footerY + 18);
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#000000').stroke();

    // ---- Signature block ----
    doc.moveDown(2.5);
    doc
      .font('Helvetica-Oblique')
      .fontSize(10)
      .text('This is a computer-generated provisional result copy.', left, doc.y, { width: contentWidth });
    doc.moveDown(2);
    doc
      .font('Helvetica')
      .fontSize(10)
      .text('Controller of Examinations', left, doc.y, { width: contentWidth, align: 'right' });

    doc.end();
  });
}
