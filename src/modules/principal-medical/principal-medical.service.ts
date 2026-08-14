import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

interface TotalsRow {
  students_visited: bigint;
  faculty_visited: bigint;
}
interface ReasonRow {
  reason: string;
  visit_count: bigint;
}

/** Principal-only Medical center overview (this month's visits, by reason). */
@Injectable()
export class PrincipalMedicalService {
  private readonly logger = new Logger(PrincipalMedicalService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    try {
      // Sequential, not Promise.all - see principal-faculty/principal-departments
      // services for why (Supabase session-mode pool is small and shared).
      const totalsRows = await this.prisma.$queryRaw<TotalsRow[]>(Prisma.sql`
        SELECT
          COUNT(DISTINCT student_id) FILTER (WHERE visitor_type = 'student')::bigint AS students_visited,
          COUNT(DISTINCT faculty_id) FILTER (WHERE visitor_type = 'faculty')::bigint AS faculty_visited
        FROM medical_visits
        WHERE EXTRACT(MONTH FROM visit_date) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM visit_date) = EXTRACT(YEAR FROM CURRENT_DATE)
      `);

      const reasonRows = await this.prisma.$queryRaw<ReasonRow[]>(Prisma.sql`
        SELECT COALESCE(NULLIF(TRIM(reason), ''), 'Not specified') AS reason,
          COUNT(*)::bigint AS visit_count
        FROM medical_visits
        WHERE EXTRACT(MONTH FROM visit_date) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM visit_date) = EXTRACT(YEAR FROM CURRENT_DATE)
        GROUP BY COALESCE(NULLIF(TRIM(reason), ''), 'Not specified')
        ORDER BY visit_count DESC
        LIMIT 10
      `);

      const totals = totalsRows[0];

      return {
        students_visited: Number(totals?.students_visited ?? 0),
        faculty_visited: Number(totals?.faculty_visited ?? 0),
        reasons: reasonRows.map((row) => ({
          reason: row.reason,
          visit_count: Number(row.visit_count),
        })),
      };
    } catch (err) {
      this.logger.error('DB error computing principal medical overview', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
