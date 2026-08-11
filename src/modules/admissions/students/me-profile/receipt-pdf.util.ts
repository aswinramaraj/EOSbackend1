import PDFDocument from 'pdfkit';

export interface FeeReceiptData {
  receipt_no: string;
  payment_date: string;
  student_name: string;
  register_no: string | null;
  fee_structure_name: string;
  academic_year: string;
  semester: number | null;
  amount_paid: number;
  payment_mode: string | null;
  is_partial: boolean;
}

/** Bespoke single-payment receipt layout — report-export.util.ts's renderPdf is a generic tabular exporter, not shaped for this. */
export function renderFeeReceiptPdf(receipt: FeeReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).font('Helvetica-Bold').text('Sri Eshwar College of Engineering', { align: 'center' });
    doc.fontSize(11).font('Helvetica').fillColor('#64748b').text('Fee Payment Receipt', { align: 'center' });
    doc.fillColor('#000000');
    doc.moveDown(1.5);

    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .strokeColor('#e6e9f2')
      .stroke();
    doc.moveDown(1);

    const row = (label: string, value: string) => {
      const y = doc.y;
      doc.fontSize(10).font('Helvetica').fillColor('#64748b').text(label, doc.page.margins.left, y, { width: 160 });
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000').text(value, doc.page.margins.left + 160, y);
      doc.moveDown(0.9);
    };

    row('Receipt No', receipt.receipt_no);
    row('Payment Date', receipt.payment_date);
    row('Student Name', receipt.student_name);
    row('Register No', receipt.register_no ?? 'NA');
    row('Particulars', receipt.fee_structure_name);
    row('Academic Year', `${receipt.academic_year}${receipt.semester ? ` · Semester ${receipt.semester}` : ''}`);
    row('Payment Mode', receipt.payment_mode ?? 'NA');
    row('Payment Type', receipt.is_partial ? 'Partial payment' : 'Full settlement');

    doc.moveDown(0.5);
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .strokeColor('#e6e9f2')
      .stroke();
    doc.moveDown(1);

    doc.fontSize(12).font('Helvetica').fillColor('#64748b').text('Amount Paid', doc.page.margins.left, doc.y);
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#1d4ed8').text(`Rs. ${receipt.amount_paid.toLocaleString('en-IN')}`, doc.page.margins.left, doc.y + 4);
    doc.fillColor('#000000');

    doc.moveDown(3);
    doc.fontSize(9).font('Helvetica').fillColor('#94a3b8').text('This is a system-generated receipt and does not require a signature.', { align: 'center' });

    doc.end();
  });
}
