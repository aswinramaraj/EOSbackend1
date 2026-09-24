import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

async function run() {
  const client = await pool.connect();
  try {
    const log = (label: string, rows: any[]) => {
      console.log(`\n=== ${label} (${rows.length}) ===`);
      console.table(rows);
    };

    // 1. table existence / names for faculty-facing features
    log(
      'tables matching faculty/venue/payslip/appraisal/hr',
      (
        await client.query(`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema='public' AND (
            table_name LIKE '%faculty%' OR table_name LIKE '%venue%' OR table_name LIKE '%payslip%'
            OR table_name LIKE '%appraisal%' OR table_name LIKE '%hr_%' OR table_name LIKE '%payroll%'
          )
          ORDER BY table_name
        `)
      ).rows,
    );

    // 2. existing data counts for both people
    for (const [label, facultyId, userId] of [
      ['uday', 3539, 38548],
      ['hodcse', 3503, 38512],
    ] as const) {
      log(
        `existing counts for ${label} (faculty_id ${facultyId}, user_id ${userId})`,
        (
          await client.query(`
            SELECT
              (SELECT count(*) FROM faculty_leaves WHERE faculty_id=$1) AS faculty_leaves,
              (SELECT count(*) FROM faculty_od_requests WHERE faculty_id=$1) AS faculty_od_requests,
              (SELECT count(*) FROM venue_bookings WHERE requested_by_faculty_id=$1) AS venue_bookings,
              (SELECT count(*) FROM payslip_requests WHERE faculty_id=$1) AS payslip_requests,
              (SELECT count(*) FROM appraisal_requests WHERE faculty_id=$1) AS appraisal_requests,
              (SELECT count(*) FROM hr_payroll_requests WHERE faculty_id=$1) AS hr_payroll_requests,
              (SELECT count(*) FROM book_borrow_records WHERE faculty_id=$1) AS library,
              (SELECT count(*) FROM faculty_subject_class_mapping WHERE faculty_id=$1) AS teaching_mappings,
              (SELECT count(*) FROM lesson_plans WHERE faculty_id=$1) AS lesson_plans,
              (SELECT count(*) FROM assignments WHERE faculty_id=$1) AS assignments,
              (SELECT count(*) FROM faculty_daily_attendance WHERE faculty_id=$1) AS faculty_daily_attendance,
              (SELECT count(*) FROM medical_appointments WHERE faculty_id=$1) AS medical,
              (SELECT count(*) FROM wallets WHERE user_id=$2) AS wallet
          `, [facultyId, userId])
        ).rows,
      );
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
