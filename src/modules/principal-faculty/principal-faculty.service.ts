import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

/**
 * Principal-only, institution-wide faculty & staff overview. Everything is
 * computed live from real attendance/appraisal/payroll records - no stored
 * "staff summary" table exists, and student data has no part in this
 * module (kept fully separate from the Students directory).
 */
@Injectable()
export class PrincipalFacultyService {
  private readonly logger = new Logger(PrincipalFacultyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    try {
      // Run sequentially rather than via Promise.all - Supabase's session-mode
      // pooler caps concurrent connections quite low (pool_size: 15, shared
      // with all other app traffic), and firing 6 queries at once for a
      // single dashboard load risks tipping it over under any concurrent
      // load. This endpoint isn't latency-critical enough to be worth that
      // fragility.
      const teachingCount = await this.prisma.faculty.count({ where: { status: 'active' } });
      const nonTeachingCount = await this.prisma.non_teaching_staff.count({ where: { status: 'active' } });
      const dutyRows = await this.prisma.$queryRaw<{ present: bigint; on_duty: bigint; on_leave: bigint }[]>(Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE fda.status IN ('full_day', 'half_day'))::bigint AS present,
          COUNT(*) FILTER (WHERE fda.status = 'on_duty')::bigint AS on_duty,
          COUNT(*) FILTER (WHERE fda.status = 'on_leave')::bigint AS on_leave
        FROM faculty_daily_attendance fda
        JOIN faculty f ON f.id = fda.faculty_id AND f.status = 'active'
        WHERE fda.attendance_date = CURRENT_DATE
      `);
      const appraisalRows = await this.prisma.$queryRaw<{ academic_year: string | null; closed: bigint }[]>(Prisma.sql`
        SELECT
          (SELECT MAX(academic_year) FROM appraisal_requests) AS academic_year,
          COUNT(*) FILTER (WHERE ar.status = 'management_approved')::bigint AS closed
        FROM appraisal_requests ar
        JOIN faculty f ON f.id = ar.faculty_id AND f.status = 'active'
        WHERE ar.academic_year = (SELECT MAX(academic_year) FROM appraisal_requests)
      `);
      const payrollRows = await this.prisma.$queryRaw<{ total: string; latest_paid_at: Date | null }[]>(Prisma.sql`
        SELECT
          COALESCE(SUM(net_amount), 0)::text AS total,
          MAX(paid_at) AS latest_paid_at
        FROM salary_payments
        WHERE month = EXTRACT(MONTH FROM CURRENT_DATE)::int
          AND year = EXTRACT(YEAR FROM CURRENT_DATE)::int
      `);
      const deptRows = await this.prisma.$queryRaw<
        { code: string; name: string; teaching: bigint; support: bigint; attended: bigint }[]
      >(Prisma.sql`
        SELECT d.code, d.name,
          COUNT(DISTINCT f.id)::bigint AS teaching,
          COUNT(DISTINCT nts.id)::bigint AS support,
          COUNT(DISTINCT fda.faculty_id) FILTER (WHERE fda.status IN ('full_day', 'half_day', 'on_duty'))::bigint AS attended
        FROM departments d
        LEFT JOIN faculty f ON f.department_id = d.id AND f.status = 'active'
        LEFT JOIN non_teaching_staff nts ON nts.department_id = d.id AND nts.status = 'active'
        LEFT JOIN faculty_daily_attendance fda ON fda.faculty_id = f.id AND fda.attendance_date = CURRENT_DATE
        GROUP BY d.id, d.code, d.name
        HAVING COUNT(DISTINCT f.id) > 0 OR COUNT(DISTINCT nts.id) > 0
        ORDER BY d.name ASC
      `);

      const now = new Date();

      return {
        total_employees: teachingCount + nonTeachingCount,
        teaching_count: teachingCount,
        non_teaching_count: nonTeachingCount,
        present_today: Number(dutyRows[0]?.present ?? 0),
        on_duty_today: Number(dutyRows[0]?.on_duty ?? 0),
        on_leave_today: Number(dutyRows[0]?.on_leave ?? 0),
        appraisals_closed: Number(appraisalRows[0]?.closed ?? 0),
        appraisals_total: teachingCount,
        appraisal_academic_year: appraisalRows[0]?.academic_year ?? null,
        payroll_amount: Number(payrollRows[0]?.total ?? 0),
        payroll_month: now.getMonth() + 1,
        payroll_year: now.getFullYear(),
        payroll_disbursed_at: payrollRows[0]?.latest_paid_at ?? null,
        departments: deptRows.map((row) => ({
          code: row.code,
          name: row.name,
          teaching: Number(row.teaching),
          support: Number(row.support),
          attendance_pct:
            Number(row.teaching) > 0 ? Math.round((Number(row.attended) / Number(row.teaching)) * 1000) / 10 : null,
        })),
      };
    } catch (err) {
      this.logger.error('DB error computing principal faculty & staff overview', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
