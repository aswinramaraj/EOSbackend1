import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

interface FeeTotalsRow {
  total_demand: string | null;
  total_collected: string | null;
  total_outstanding: string | null;
  students_with_dues: bigint;
}
interface ScholarshipRow {
  total_scholarship: string | null;
  beneficiaries: bigint;
}
interface ExpenseCategoryRow {
  category: string;
  total: string;
}
interface YearCollectionRow {
  year: number;
  demand: string | null;
  collected: string | null;
}

/**
 * Principal-only Finance & Fees oversight - aggregate figures only.
 * Transaction-level accounting (individual payments/receipts) stays with
 * the Finance office's own module; this is read-only rollups. There is no
 * "budget" table anywhere in the schema (only real expenses/expense
 * categories), so "Budget utilised" from the reference design isn't
 * something this data can honestly show - it's replaced with real total
 * expenditure for the year instead of inventing a budget figure.
 */
@Injectable()
export class PrincipalFinanceService {
  private readonly logger = new Logger(PrincipalFinanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    try {
      // Sequential, not Promise.all - see principal-faculty/principal-departments
      // services for why (Supabase session-mode pool is small and shared).
      const feeTotalsRows = await this.prisma.$queryRaw<FeeTotalsRow[]>(Prisma.sql`
        WITH student_fees AS (
          SELECT sfdm.student_id,
            SUM(sfdm.total_amount) AS demand,
            COALESCE(SUM(fp.amount_paid), 0) AS paid
          FROM student_fee_demand_mapping sfdm
          LEFT JOIN fee_payments fp ON fp.student_fee_demand_mapping_id = sfdm.id
          GROUP BY sfdm.student_id
        )
        SELECT
          SUM(demand)::text AS total_demand,
          SUM(paid)::text AS total_collected,
          SUM(GREATEST(demand - paid, 0))::text AS total_outstanding,
          COUNT(*) FILTER (WHERE demand - paid > 0)::bigint AS students_with_dues
        FROM student_fees
      `);

      const scholarshipRows = await this.prisma.$queryRaw<ScholarshipRow[]>(Prisma.sql`
        SELECT
          COALESCE(SUM(fc.concession_amount), 0)::text AS total_scholarship,
          COUNT(DISTINCT sfdm.student_id)::bigint AS beneficiaries
        FROM fee_concessions fc
        JOIN student_fee_demand_mapping sfdm ON sfdm.fee_structure_id = fc.fee_structure_id
      `);

      const expenseRows = await this.prisma.$queryRaw<ExpenseCategoryRow[]>(Prisma.sql`
        SELECT ec.name AS category, SUM(e.amount)::text AS total
        FROM expenses e
        JOIN expense_categories ec ON ec.id = e.category_id
        WHERE EXTRACT(YEAR FROM e.expense_date) = EXTRACT(YEAR FROM CURRENT_DATE)
        GROUP BY ec.id, ec.name
        ORDER BY SUM(e.amount) DESC
      `);

      const yearRows = await this.prisma.$queryRaw<YearCollectionRow[]>(Prisma.sql`
        WITH student_year AS (
          SELECT st.id AS student_id, CEIL(cl.current_semester / 2.0)::int AS year
          FROM students st
          JOIN classes cl ON cl.id = st.class_id
          WHERE cl.current_semester IS NOT NULL
        ),
        student_fees AS (
          SELECT sfdm.student_id,
            SUM(sfdm.total_amount) AS demand,
            COALESCE(SUM(fp.amount_paid), 0) AS paid
          FROM student_fee_demand_mapping sfdm
          LEFT JOIN fee_payments fp ON fp.student_fee_demand_mapping_id = sfdm.id
          GROUP BY sfdm.student_id
        )
        SELECT sy.year,
          SUM(sf.demand)::text AS demand,
          SUM(sf.paid)::text AS collected
        FROM student_year sy
        JOIN student_fees sf ON sf.student_id = sy.student_id
        GROUP BY sy.year
        ORDER BY sy.year ASC
      `);

      const feeTotals = feeTotalsRows[0];
      const scholarship = scholarshipRows[0];

      const totalDemand = Number(feeTotals?.total_demand ?? 0);
      const totalCollected = Number(feeTotals?.total_collected ?? 0);
      const totalExpenditure = expenseRows.reduce((sum, row) => sum + Number(row.total), 0);

      const YEAR_LABELS = ['First year', 'Second year', 'Third year', 'Fourth year'];

      return {
        total_collected: totalCollected,
        collected_pct_of_demand: totalDemand > 0 ? Math.round((totalCollected / totalDemand) * 1000) / 10 : null,
        outstanding_dues: Number(feeTotals?.total_outstanding ?? 0),
        students_with_dues: Number(feeTotals?.students_with_dues ?? 0),
        scholarship_total: Number(scholarship?.total_scholarship ?? 0),
        scholarship_beneficiaries: Number(scholarship?.beneficiaries ?? 0),
        total_expenditure: totalExpenditure,
        expenditure_category_count: expenseRows.length,
        collection_by_year: yearRows
          .filter((row) => row.year >= 1 && row.year <= 4)
          .map((row) => {
            const demand = Number(row.demand ?? 0);
            const collected = Number(row.collected ?? 0);
            return {
              year: row.year,
              label: YEAR_LABELS[row.year - 1] ?? `Year ${row.year}`,
              demand,
              collected,
              pending: Math.max(demand - collected, 0),
            };
          }),
      };
    } catch (err) {
      this.logger.error('DB error computing principal finance & fees overview', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
