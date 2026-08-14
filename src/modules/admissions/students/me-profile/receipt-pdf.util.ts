import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';

export interface FeeReceiptItem {
  sl: number;
  particular: string;
  amount: number;
}

export interface FeeReceiptData {
  receipt_no: string;
  payment_date: string;
  student_name: string;
  register_no: string | null;
  class_name: string | null;
  roll_no: string | null;
  fee_structure_name: string;
  academic_year: string;
  semester: number | null;
  /** e.g. "Odd Sem 2022-23" — same odd/even convention already used on the frontend (lib/utils/date.ts, StudentShell.tsx). */
  sem_period: string;
  amount_paid: number;
  payment_mode: string | null;
  is_partial: boolean;
  /**
   * The line items this specific payment covers — the full breakdown of
   * the demand's fee_structure_items when this was a whole-demand payment
   * (fee_structure_item_id was null, so the payment settles every item at
   * once), or just the one item paid when it targeted a single line.
   */
  items: FeeReceiptItem[];
  amount_in_words: string;
}

// ---------------------------------------------------------------------------
// Amount-in-words (Indian numbering: crore/lakh/thousand), matching the
// "Fifty Nine Thousand Seven Hundred and Fifty only" convention used on the
// college's own paper receipts. Paise are not represented — every fee amount
// in this schema is a whole-rupee figure in practice, so the value is
// rounded to the nearest rupee before conversion.
// ---------------------------------------------------------------------------

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

function twoDigitsToWords(n: number): string {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones ? `${TENS[tens]} ${ONES[ones]}` : TENS[tens];
}

function threeDigitsToWords(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return twoDigitsToWords(rest);
  if (rest === 0) return `${ONES[hundreds]} Hundred`;
  return `${ONES[hundreds]} Hundred and ${twoDigitsToWords(rest)}`;
}

export function amountInWords(amount: number): string {
  const rupees = Math.round(amount);
  if (rupees === 0) return 'Zero only';

  const crore = Math.floor(rupees / 1e7);
  const lakh = Math.floor((rupees % 1e7) / 1e5);
  const thousand = Math.floor((rupees % 1e5) / 1e3);
  const hundred = rupees % 1e3;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigitsToWords(crore)} Crore`);
  if (lakh) parts.push(`${threeDigitsToWords(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigitsToWords(thousand)} Thousand`);
  if (hundred) parts.push(threeDigitsToWords(hundred));

  return `${parts.join(' ')} only`;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Tried at both the dev (ts-node, src/ only) and built (dist/, assets
 * copied alongside via nest-cli.json's `assets` glob) locations — whichever
 * exists first wins. Missing entirely just means the logo is skipped rather
 * than crashing receipt generation over a decorative image.
 */
function resolveLogoPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'src', 'assets', 'college-logo.png'),
    path.join(__dirname, '..', '..', '..', '..', 'assets', 'college-logo.png'),
    path.join(process.cwd(), 'dist', 'assets', 'college-logo.png'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function formatMoney(amount: number): string {
  return amount.toLocaleString('en-IN');
}

/** Bespoke single-payment receipt layout — report-export.util.ts's renderPdf is a generic tabular exporter, not shaped for this. */
export function renderFeeReceiptPdf(receipt: FeeReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const contentWidth = right - left;

    // ---- Header: logo, college name/address, ORIGINAL stamp ----
    const logoPath = resolveLogoPath();
    const headerTop = doc.y;
    if (logoPath) {
      doc.save();
      doc.circle(left + 34, headerTop + 34, 34).clip();
      doc.image(logoPath, left, headerTop, { width: 68, height: 68 });
      doc.restore();
    }

    const headerTextX = left + 90;
    const headerTextWidth = contentWidth - 90 - 90; // leave room for the ORIGINAL stamp on the right
    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .fillColor('#000000')
      .text('Sri Eshwar College of Engineering', headerTextX, headerTop + 2, {
        width: headerTextWidth,
        align: 'center',
      });
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(
        '(Approved by AICTE, New Delhi & Affiliated to Anna University)',
        headerTextX,
        doc.y,
        { width: headerTextWidth, align: 'center' },
      );
    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .text(
        'Kondampatti(P.O), Vadasithur(Via), Kinathukadavu, Coimbatore-641 202.',
        headerTextX,
        doc.y + 2,
        {
          width: headerTextWidth,
          align: 'center',
        },
      );
    doc
      .font('Helvetica')
      .fontSize(9)
      .text('Ph :04259 200300 - Cell:7373617171', headerTextX, doc.y + 1, {
        width: headerTextWidth,
        align: 'center',
      });

    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .text('ORIGINAL', right - 80, headerTop + 4, {
        width: 80,
        align: 'right',
      });

    doc.y = Math.max(doc.y, headerTop + 68) + 12;

    // ---- Outer box ----
    const boxTop = doc.y;
    doc
      .moveTo(left, boxTop)
      .lineTo(right, boxTop)
      .strokeColor('#000000')
      .stroke();
    doc.y = boxTop + 10;

    const infoRow = (
      labelLeft: string,
      valueLeft: string,
      labelRight: string,
      valueRight: string,
    ) => {
      const y = doc.y;
      const rightColX = left + contentWidth * 0.58;
      doc
        .font('Helvetica')
        .fontSize(10.5)
        .text(labelLeft, left + 8, y, { continued: true })
        .font('Helvetica-Bold')
        .text(` ${valueLeft}`);
      doc
        .font('Helvetica')
        .fontSize(10.5)
        .text(labelRight, rightColX, y, { continued: true })
        .font('Helvetica-Bold')
        .text(` ${valueRight}`);
      doc.y = Math.max(doc.y, y + 16);
    };

    infoRow('Receipt No:', receipt.receipt_no, 'Date:', receipt.payment_date);
    infoRow(
      'Name:',
      receipt.student_name,
      'Class:',
      receipt.class_name ?? 'NA',
    );
    infoRow(
      'Roll no:',
      receipt.roll_no ?? receipt.register_no ?? 'NA',
      'Sem period:',
      receipt.sem_period,
    );

    doc.moveDown(0.3);
    const tableTop = doc.y;
    doc
      .moveTo(left, tableTop)
      .lineTo(right, tableTop)
      .strokeColor('#000000')
      .stroke();
    doc.y = tableTop + 6;

    // ---- Sl. / Particulars / Amount table ----
    const slX = left + 8;
    const particularX = left + 50;
    const amountX = right - 110;
    const amountWidth = 100;

    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Sl.', slX, doc.y, { width: 34 });
    doc.text('Particulars', particularX, doc.y - doc.currentLineHeight(), {
      width: amountX - particularX - 10,
    });
    doc.text('Amount', amountX, doc.y - doc.currentLineHeight(), {
      width: amountWidth,
      align: 'right',
    });
    doc.moveDown(0.3);
    doc
      .moveTo(left, doc.y)
      .lineTo(right, doc.y)
      .strokeColor('#000000')
      .stroke();
    doc.moveDown(0.4);

    doc.font('Helvetica').fontSize(10.5);
    receipt.items.forEach((item, i) => {
      const y = doc.y;
      doc.text(String(item.sl), slX, y, { width: 34 });
      doc.text(item.particular, particularX, y, {
        width: amountX - particularX - 10,
      });
      doc.text(formatMoney(item.amount), amountX, y, {
        width: amountWidth,
        align: 'right',
      });
      doc.moveDown(0.5);
      if (i < receipt.items.length - 1) {
        doc
          .save()
          .dash(1.5, { space: 1.5 })
          .moveTo(left, doc.y)
          .lineTo(right, doc.y)
          .strokeColor('#94a3b8')
          .stroke()
          .undash()
          .restore();
        doc.moveDown(0.3);
      }
    });

    doc.moveDown(0.2);
    doc
      .moveTo(left, doc.y)
      .lineTo(right, doc.y)
      .strokeColor('#000000')
      .stroke();
    doc.moveDown(0.4);

    // ---- Cash / Bank / Adj / Fine + Total ----
    const isCash = receipt.payment_mode === 'cash';
    const cashAmount = isCash ? receipt.amount_paid : 0;
    const bankAmount = isCash ? 0 : receipt.amount_paid;

    const footerY = doc.y;
    doc
      .font('Helvetica')
      .fontSize(9.5)
      .text(
        `Cheque / DD subjected to realization.   Cash ${formatMoney(cashAmount)}   Bank ${formatMoney(bankAmount)}   Adj.: 0   Fine 0`,
        left + 8,
        footerY,
        { width: amountX - left - 18 },
      );
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('Total', amountX - 60, footerY, { width: 60 });
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(formatMoney(receipt.amount_paid), amountX, footerY, {
        width: amountWidth,
        align: 'right',
      });

    doc.y = Math.max(doc.y, footerY + 18);
    doc
      .moveTo(left, doc.y)
      .lineTo(right, doc.y)
      .strokeColor('#000000')
      .stroke();
    doc.moveDown(0.4);

    doc
      .font('Helvetica')
      .fontSize(10)
      .text(receipt.amount_in_words, left + 8, doc.y, {
        width: contentWidth - 16,
      });
    doc.moveDown(0.6);

    doc
      .moveTo(left, doc.y)
      .lineTo(right, doc.y)
      .strokeColor('#000000')
      .stroke();

    // ---- Signature block ----
    doc.moveDown(1.5);
    doc
      .font('Helvetica-Oblique')
      .fontSize(10.5)
      .text('For Sri Eshwar College of Engineering', left, doc.y, {
        width: contentWidth,
        align: 'right',
      });
    doc.moveDown(2.5);
    doc
      .font('Helvetica')
      .fontSize(10)
      .text('Authorized Signatory', left, doc.y, {
        width: contentWidth,
        align: 'right',
      });

    doc.end();
  });
}
