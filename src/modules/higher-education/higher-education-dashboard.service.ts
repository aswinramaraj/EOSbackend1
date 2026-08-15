import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { detectHigherEducationSchema } from './higher-education-schema.util';

interface AspirantRow {
  id: number;
  student_id: number;
  preferred_course: string;
  preferred_country: string;
  preferred_university: string | null;
  is_scholarship: boolean | null;
  scholarship_value: string | null;
  admission_status: string | null;
  offer_status: string | null;
  visa_status: string | null;
  sop_status: string | null;
  recommendation_status: string | null;
  research_output: string | null;
  internship_details: string | null;
  application_submitted_date: Date | null;
  interview_date: Date | null;
  student_name: string;
  dept_code: string | null;
}

interface TestScoreAgg {
  test_name: string;
  _count: { _all: number };
  _avg: { score: Prisma.Decimal | null };
}

const ADMISSION_STAGES = ['interested', 'applied', 'admitted', 'enrolled'] as const;

function isAbroad(country: string): boolean {
  return country.trim().toLowerCase() !== 'india';
}

/**
 * GET /me/higher-education-dashboard — Higher Education Cell coordinator.
 * `student_higher_education` predates this dashboard: it's the same table
 * that originally only held preferred_course/preferred_country/
 * preferred_university/remarks (students self-declaring interest). The
 * coordinator-tracking columns (admission_status, scholarship_value, etc.)
 * were added by hand later, so every read of them goes through $queryRaw —
 * the Prisma client's generated type only knows the original four columns.
 */
@Injectable()
export class HigherEducationDashboardService {
  private readonly logger = new Logger(HigherEducationDashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getDashboard() {
    try {
      const schema = await detectHigherEducationSchema(this.prisma);
      const finalYearEligible = await this.getFinalYearEligible();

      if (!schema.extended) {
        return this.buildMinimalResponse(finalYearEligible);
      }

      const rows = await this.prisma.$queryRaw<AspirantRow[]>(Prisma.sql`
        SELECT
          she.id, she.student_id, she.preferred_course, she.preferred_country, she.preferred_university,
          she.is_scholarship, she.scholarship_value::text AS scholarship_value,
          she.admission_status::text AS admission_status, she.offer_status::text AS offer_status, she.visa_status::text AS visa_status,
          she.sop_status, she.recommendation_status, she.research_output, she.internship_details,
          she.application_submitted_date, she.interview_date,
          COALESCE(NULLIF(TRIM(CONCAT(sa.first_name, ' ', COALESCE(sa.last_name, ''))), ''), u.email) AS student_name,
          d.code AS dept_code
        FROM student_higher_education she
        JOIN students s ON s.id = she.student_id
        JOIN users u ON u.id = s.user_id
        LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
        LEFT JOIN classes c ON c.id = s.class_id
        LEFT JOIN departments d ON d.id = c.department_id
        ORDER BY she.created_at DESC
      `);

      const testScores = await this.prisma.student_test_scores.groupBy({
        by: ['test_name'],
        _count: { _all: true },
        _avg: { score: true },
      });

      return this.buildFullResponse(rows, testScores, finalYearEligible);
    } catch (err) {
      this.logger.error('DB error building higher-education dashboard', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async getFinalYearEligible(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT count(*) AS count
      FROM students s
      JOIN classes c ON c.id = s.class_id
      JOIN courses co ON co.id = s.course_id
      WHERE c.current_semester >= (co.duration_years * 2 - 1)
    `);
    return Number(rows[0]?.count ?? 0);
  }

  private buildMinimalResponse(finalYearEligible: number) {
    return {
      extended: false,
      finalYearEligible,
      kpis: { aspirants: { total: 0, withinIndia: 0, abroad: 0 }, applicationsFiled: null, admits: null, scholarship: null },
      commandCenter: {
        finalYearEligible,
        universitiesInPlay: 0,
        highestScholarship: null,
        averageScholarship: null,
        admissionsConfirmed: 0,
        admissionsTotal: 0,
      },
      needsAttention: [],
      progressionPipeline: null,
      destinations: [],
      interviewsUpcoming: [],
      departmentRows: [],
      testReadiness: [],
      applicationReadiness: null,
    };
  }

  private buildFullResponse(rows: AspirantRow[], testScores: TestScoreAgg[], finalYearEligible: number) {
    const total = rows.length;
    const abroadRows = rows.filter((r) => isAbroad(r.preferred_country));
    const withinIndiaCount = total - abroadRows.length;

    const admittedRows = rows.filter((r) => r.admission_status === 'admitted' || r.admission_status === 'enrolled');
    const admittedAbroad = admittedRows.filter((r) => isAbroad(r.preferred_country)).length;

    const scholarshipRows = rows.filter((r) => r.is_scholarship && r.scholarship_value != null);
    const scholarshipValues = scholarshipRows.map((r) => Number(r.scholarship_value));
    const totalScholarshipValue = scholarshipValues.reduce((sum, v) => sum + v, 0);
    const highestScholarship = scholarshipValues.length > 0 ? Math.max(...scholarshipValues) : null;
    const averageScholarship = scholarshipValues.length > 0 ? totalScholarshipValue / scholarshipValues.length : null;

    const universitiesInPlay = new Set(rows.map((r) => r.preferred_university).filter((u): u is string => !!u)).size;
    const applicationsFiled = rows.filter((r) => r.application_submitted_date != null).length;

    const stageCounts = new Map<string, number>();
    for (const stage of ADMISSION_STAGES) stageCounts.set(stage, 0);
    for (const r of rows) {
      if (r.admission_status && stageCounts.has(r.admission_status)) {
        stageCounts.set(r.admission_status, (stageCounts.get(r.admission_status) ?? 0) + 1);
      }
    }
    const progressionPipeline = ADMISSION_STAGES.map((stage) => ({
      label: stage.charAt(0).toUpperCase() + stage.slice(1),
      count: stageCounts.get(stage) ?? 0,
      percent: total > 0 ? Math.round(((stageCounts.get(stage) ?? 0) / total) * 100) : 0,
    }));

    const destinationCounts = new Map<string, number>();
    for (const r of rows) {
      destinationCounts.set(r.preferred_country, (destinationCounts.get(r.preferred_country) ?? 0) + 1);
    }
    const destinations = Array.from(destinationCounts.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);

    const fortnightFromNow = new Date();
    fortnightFromNow.setDate(fortnightFromNow.getDate() + 14);
    const interviewsUpcoming = rows
      .filter((r) => r.interview_date != null && r.interview_date <= fortnightFromNow && r.interview_date >= new Date())
      .sort((a, b) => a.interview_date!.getTime() - b.interview_date!.getTime())
      .map((r) => ({
        date: r.interview_date!.toISOString().slice(0, 10),
        studentName: r.student_name,
        university: r.preferred_university,
      }));

    const deptMap = new Map<string, { aspirants: number; admits: number; abroad: number }>();
    for (const r of rows) {
      const key = r.dept_code ?? 'Unassigned';
      const entry = deptMap.get(key) ?? { aspirants: 0, admits: 0, abroad: 0 };
      entry.aspirants += 1;
      if (r.admission_status === 'admitted' || r.admission_status === 'enrolled') entry.admits += 1;
      if (isAbroad(r.preferred_country)) entry.abroad += 1;
      deptMap.set(key, entry);
    }
    const departmentRows = Array.from(deptMap.entries())
      .map(([dept, v]) => ({
        dept,
        aspirants: v.aspirants,
        admits: v.admits,
        abroad: v.abroad,
        conversion: v.aspirants > 0 ? `${((v.admits / v.aspirants) * 100).toFixed(1)}%` : '—',
      }))
      .sort((a, b) => b.aspirants - a.aspirants);

    const needsAttention: { title: string; description: string }[] = [];
    const sopPending = rows.filter((r) => r.sop_status != null && r.sop_status !== 'finalized').length;
    if (sopPending > 0) needsAttention.push({ title: `${sopPending} SOP${sopPending === 1 ? '' : 's'} not finalized`, description: 'Statement of purpose still in progress' });
    const recPending = rows.filter((r) => r.recommendation_status != null && r.recommendation_status !== 'issued').length;
    if (recPending > 0) needsAttention.push({ title: `${recPending} recommendation letter${recPending === 1 ? '' : 's'} awaiting faculty`, description: 'Requested but not yet issued' });
    const visaPending = admittedRows.filter((r) => isAbroad(r.preferred_country) && r.visa_status != null && r.visa_status !== 'approved').length;
    if (visaPending > 0) needsAttention.push({ title: `Visa not yet approved for ${visaPending} admitted aspirant${visaPending === 1 ? '' : 's'}`, description: 'Admitted with an overseas destination' });

    const applicationReadiness = {
      sopFinalized: rows.filter((r) => r.sop_status === 'finalized').length,
      recommendationIssued: rows.filter((r) => r.recommendation_status === 'issued').length,
      researchRecorded: rows.filter((r) => r.research_output != null && r.research_output.trim() !== '').length,
      internshipRecorded: rows.filter((r) => r.internship_details != null && r.internship_details.trim() !== '').length,
      total,
    };

    const testReadiness = testScores.map((t) => ({
      testName: t.test_name,
      enrolled: t._count._all,
      meanScore: t._avg.score != null ? Math.round(Number(t._avg.score) * 10) / 10 : 0,
    }));

    return {
      extended: true,
      finalYearEligible,
      kpis: {
        aspirants: { total, withinIndia: withinIndiaCount, abroad: abroadRows.length },
        applicationsFiled,
        admits: { total: admittedRows.length, abroad: admittedAbroad, withinIndia: admittedRows.length - admittedAbroad },
        scholarship: { totalValue: totalScholarshipValue, fundedCount: scholarshipRows.length, meanValue: averageScholarship },
      },
      commandCenter: {
        finalYearEligible,
        universitiesInPlay,
        highestScholarship,
        averageScholarship,
        admissionsConfirmed: admittedRows.length,
        admissionsTotal: total,
      },
      needsAttention,
      progressionPipeline,
      destinations,
      interviewsUpcoming,
      departmentRows,
      testReadiness,
      applicationReadiness,
    };
  }
}
