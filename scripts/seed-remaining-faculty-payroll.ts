/**
 * HR Payroll ("Salary Records") only had real salary_payments rows for 50
 * of 500 active faculty — a partial seed from earlier session work that
 * covered roughly the first faculty_id per department. Every other
 * faculty's HR Payroll screen (e.g. om.o.cs3@sece.ac.in, faculty_id 3538)
 * shows "No payroll records yet" even though the table/columns are fully
 * real and already wired end-to-end (hr-payroll.service.ts,
 * faculty/payroll/page.tsx) — this is a pure data-seeding gap, not a
 * missing feature, so no query.md/schema change is involved.
 *
 * Pay scale is not invented — it's read directly off the 150 existing rows
 * (grouped by designation, confirmed a single flat rate per designation,
 * deductions always exactly 8% of gross):
 *   Assistant Professor            50,000 / 4,000 / 46,000
 *   Associate Professor            70,000 / 5,600 / 64,400
 *   Professor                      90,000 / 7,200 / 82,800
 *   Any "& Head" / "& HOD" title   95,000 / 7,600 / 87,400 (flat)
 * Two designations among the missing 450 have no existing row to copy
 * ("Professor of Practice" ×3, "Assistant Professor of Practice" ×1) —
 * these fall through the same rank-substring match as their non-"of
 * Practice" counterpart (Professor / Assistant Professor respectively),
 * consistent with the real scale's own rank-based logic rather than a
 * separately invented number.
 *
 * Same 3-month window and status pattern as the existing 150 rows:
 * 2026-06 and 2026-07 processed (paid_at = 27th of that month),
 * 2026-08 pending (paid_at/processed_by null — not yet processed).
 * processed_by_user_id on processed rows is the real hrpayroll@sece.ac.in
 * user (id 38497), matching every existing processed row exactly.
 *
 * Idempotent — scoped to exactly the faculty_ids confirmed (via a live
 * DB count) to have zero salary_payments rows, plus an ON CONFLICT DO
 * NOTHING against the table's own (faculty_id, year, month) unique
 * constraint as a second safety net.
 * Run from EOSbackend1: node -r @swc-node/register scripts/seed-remaining-faculty-payroll.ts
 */
import 'dotenv/config';
import { Pool } from 'pg';

const HR_USER_ID = 38497;

const PERIODS = [
  { month: 6, year: 2026, status: 'processed', paidAt: '2026-06-27T18:30:00.000Z', processedBy: HR_USER_ID },
  { month: 7, year: 2026, status: 'processed', paidAt: '2026-07-27T18:30:00.000Z', processedBy: HR_USER_ID },
  { month: 8, year: 2026, status: 'pending', paidAt: null as string | null, processedBy: null as number | null },
] as const;

function payFor(title: string): { gross: number; ded: number; net: number } {
  const t = title.toLowerCase();
  if (t.includes('head') || t.includes('hod')) return { gross: 95000, ded: 7600, net: 87400 };
  if (t.includes('assistant professor')) return { gross: 50000, ded: 4000, net: 46000 };
  if (t.includes('associate professor')) return { gross: 70000, ded: 5600, net: 64400 };
  return { gross: 90000, ded: 7200, net: 82800 }; // Professor, Professor of Practice
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    idleTimeoutMillis: 0,
    connectionTimeoutMillis: 20000,
  });
  console.log('Connected.');

  const missing = await pool.query<{ id: number; title: string }>(`
    SELECT f.id, d.title
    FROM faculty f
    JOIN designations d ON d.id = f.designation_id
    LEFT JOIN salary_payments sp ON sp.faculty_id = f.id
    WHERE f.status = 'active' AND sp.id IS NULL
    GROUP BY f.id, d.title
    ORDER BY f.id
  `);
  console.log(`Faculty missing payroll: ${missing.rows.length}`);

  let inserted = 0;
  let skipped = 0;
  for (const f of missing.rows) {
    const pay = payFor(f.title);
    for (const p of PERIODS) {
      const result = await pool.query(
        `INSERT INTO salary_payments
           (payee_type, faculty_id, month, year, gross_amount, net_amount, deductions_amount, status, paid_at, processed_by_user_id)
         VALUES ('faculty', $1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT ON CONSTRAINT salary_payments_faculty_period_unique DO NOTHING`,
        [f.id, p.month, p.year, pay.gross, pay.net, pay.ded, p.status, p.paidAt, p.processedBy],
      );
      if (result.rowCount) inserted++;
      else skipped++;
    }
  }
  console.log(`Inserted ${inserted} salary_payments rows, skipped ${skipped} already-existing.`);

  const coverage = await pool.query(`
    SELECT COUNT(DISTINCT f.id) AS total_active_faculty,
           COUNT(DISTINCT sp.faculty_id) AS faculty_with_payroll
    FROM faculty f
    LEFT JOIN salary_payments sp ON sp.faculty_id = f.id
    WHERE f.status = 'active'
  `);
  console.log('Coverage after seeding:', coverage.rows[0]);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
