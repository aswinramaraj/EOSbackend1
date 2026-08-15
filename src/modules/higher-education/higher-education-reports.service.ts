import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { detectHigherEducationSchema } from './higher-education-schema.util';

interface ReportRow {
  preferred_country: string;
  admission_status: string | null;
  is_scholarship: boolean | null;
  scholarship_value: string | null;
  batch_name: string | null;
  dept_code: string | null;
}

interface StandingReturnRow {
  title: string;
  meta: string | null;
  status: string;
}

function formatBatchLabel(name: string | null): string {
  return name ? name.replace('_', '–') : 'Unassigned';
}

function isAbroad(country: string): boolean {
  return country.trim().toLowerCase() !== 'india';
}

function groupAndSummarize<T extends { admission_status: string | null; preferred_country: string; is_scholarship: boolean | null; scholarship_value: string | null }>(
  rows: T[],
  keyOf: (row: T) => string,
) {
  const byKey = new Map<string, T[]>();
  for (const r of rows) {
    const key = keyOf(r);
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
  }
  return Array.from(byKey.entries())
    .map(([key, group]) => {
      const admits = group.filter((r) => r.admission_status === 'admitted' || r.admission_status === 'enrolled').length;
      const abroad = group.filter((r) => isAbroad(r.preferred_country)).length;
      const funded = group.filter((r) => r.is_scholarship).length;
      const totalValue = group
        .filter((r) => r.is_scholarship && r.scholarship_value != null)
        .reduce((sum, r) => sum + Number(r.scholarship_value), 0);
      return {
        key,
        aspirants: group.length,
        admits,
        abroad,
        funded,
        totalValue,
        conversionPercent: group.length > 0 ? Math.round((admits / group.length) * 100) : 0,
      };
    })
    .sort((a, b) => b.aspirants - a.aspirants);
}

/**
 * "Reports & analytics" for the Higher Education Cell — the design
 * reference's "five-year cycle" comparison has no backing data (no
 * academic-year column on student_higher_education), so progression is
 * grouped by the aspirant's own batch (their real graduating cohort)
 * instead. "Standing returns" (NAAC/NBA/AISHE/management-review filings)
 * is a real coordinator-maintained register — read-only for now, matching
 * the design's own lack of an "add" affordance on this page. Export
 * buttons on the frontend generate real CSVs from this same data — no PDF/
 * XLSX generation exists, so nothing claims those formats.
 */
@Injectable()
export class HigherEducationReportsService {
  private readonly logger = new Logger(HigherEducationReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getReports() {
    try {
      const rows = await this.prisma.$queryRaw<ReportRow[]>(Prisma.sql`
        SELECT she.preferred_country, she.admission_status::text AS admission_status, she.is_scholarship, she.scholarship_value::text AS scholarship_value,
          b.name AS batch_name, d.code AS dept_code
        FROM student_higher_education she
        JOIN students s ON s.id = she.student_id
        LEFT JOIN batches b ON b.id = s.batch_id
        LEFT JOIN classes c ON c.id = s.class_id
        LEFT JOIN departments d ON d.id = c.department_id
      `);

      const progression = groupAndSummarize(rows, (r) => formatBatchLabel(r.batch_name)).map(({ key, ...p }) => ({ batch: key, ...p }));
      const departmentSummary = groupAndSummarize(rows, (r) => r.dept_code ?? 'Unassigned').map(({ key, ...p }) => ({ department: key, ...p }));
      const countryMobility = groupAndSummarize(rows, (r) => r.preferred_country).map(({ key, ...p }) => ({ country: key, ...p }));

      const totalValue = progression.reduce((sum, p) => sum + p.totalValue, 0);

      const schema = await detectHigherEducationSchema(this.prisma);
      const standingReturns = schema.standingReturns
        ? await this.prisma.$queryRaw<StandingReturnRow[]>(Prisma.sql`
            SELECT title, meta, status FROM higher_education_standing_returns ORDER BY id ASC
          `)
        : [];

      return {
        summary: { batchesTracked: progression.length, totalAspirants: rows.length, totalValue },
        progression,
        departmentSummary,
        countryMobility,
        standingReturns,
      };
    } catch (err) {
      this.logger.error('DB error building higher-education reports view', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
