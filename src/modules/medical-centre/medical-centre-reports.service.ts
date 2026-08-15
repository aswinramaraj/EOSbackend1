import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

interface VisitDeptRow {
  dept: string | null;
  reason: string | null;
  visit_date: Date;
}

/**
 * Reports & analytics — every figure derived live from real medical_visits
 * rows for the selected academic year (no separate report/aggregate table).
 * There's no complaint-category column on medical_visits, so "top
 * complaints" is a real frequency tally over the free-text `reason` field
 * rather than a fabricated category breakdown.
 */
@Injectable()
export class MedicalCentreReportsService {
  private readonly logger = new Logger(MedicalCentreReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getReports(year?: number) {
    const targetYear = year ?? new Date().getFullYear();
    const yearStart = new Date(targetYear, 0, 1);
    const yearEnd = new Date(targetYear, 11, 31, 23, 59, 59);

    try {
      const rows = await this.prisma.$queryRaw<VisitDeptRow[]>(Prisma.sql`
        SELECT
          COALESCE(d.code, fd.code, 'Faculty & staff') AS dept,
          mv.reason,
          mv.visit_date
        FROM medical_visits mv
        LEFT JOIN students s ON s.id = mv.student_id
        LEFT JOIN classes c ON c.id = s.class_id
        LEFT JOIN departments d ON d.id = c.department_id
        LEFT JOIN faculty f ON f.id = mv.faculty_id
        LEFT JOIN departments fd ON fd.id = f.department_id
        WHERE mv.visit_date BETWEEN ${yearStart} AND ${yearEnd}
      `);

      const deptCounts = new Map<string, number>();
      for (const r of rows) {
        const dept = r.dept ?? 'Unknown';
        deptCounts.set(dept, (deptCounts.get(dept) ?? 0) + 1);
      }
      const deptVisits = [...deptCounts.entries()]
        .map(([dept, v]) => ({ dept, v }))
        .sort((a, b) => b.v - a.v);

      const reasonCounts = new Map<string, number>();
      let reasonedTotal = 0;
      for (const r of rows) {
        if (r.reason) {
          reasonCounts.set(r.reason, (reasonCounts.get(r.reason) ?? 0) + 1);
          reasonedTotal++;
        }
      }
      const topComplaints = [...reasonCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, count]) => ({ name, pct: reasonedTotal > 0 ? Math.round((count / reasonedTotal) * 100) : 0 }));

      const monthCounts = new Array(12).fill(0);
      for (const r of rows) {
        monthCounts[r.visit_date.getMonth()]++;
      }
      const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthlyVisits = MONTH_LABELS.map((label, i) => ({ label, v: monthCounts[i] }));

      return {
        year: targetYear,
        totalVisits: rows.length,
        deptVisits,
        topComplaints,
        monthlyVisits,
      };
    } catch (err) {
      this.logger.error('DB error building medical-centre reports', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
