import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { CreateSchemeDto } from './dto/create-scheme.dto';

interface ScholarshipRow {
  is_scholarship: boolean | null;
  scholarship_value: string | null;
}

interface SchemeRow {
  id: number;
  name: string;
  scheme_type: string | null;
  applied_count: number;
  awarded_count: number;
  total_value: string;
}

interface LoanRow {
  id: number;
  bank_name: string;
  amount: string;
  status: string;
  reapplied: boolean;
  collateral_free: boolean;
}

/** "2026-27" style label, matching the header's academic-year convention — July onward starts the new academic year. */
function currentAcademicYear(): string {
  const now = new Date();
  const startYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

/**
 * "Scholarships & funding" for the Higher Education Cell.
 *
 * Funded-count/total-value KPIs come from student_higher_education's flat
 * is_scholarship/scholarship_value columns (per-aspirant facts). The
 * "Scheme-wise position" register and "Funding mix" come from
 * scholarship_schemes — a real, previously-unused Prisma model extended
 * with scheme_type/applied_count/awarded_count/total_value columns (hand
 * SQL, not in schema.prisma) so it's an actual coordinator-maintained
 * register, matching how the design's own "Add scheme" form treats
 * applied/awarded/value as typed-in numbers, not derived ones.
 * "Education loans" comes from higher_education_loans, a new table — banks/
 * sanction status/collateral have no other home in the schema.
 * "Full waivers" has no backing data anywhere (no waiver-percentage
 * concept exists) and is reported as not tracked rather than fabricated.
 */
@Injectable()
export class HigherEducationScholarshipsService {
  private readonly logger = new Logger(HigherEducationScholarshipsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getScholarships() {
    try {
      const aspirantRows = await this.prisma.$queryRaw<ScholarshipRow[]>(Prisma.sql`
        SELECT is_scholarship, scholarship_value::text AS scholarship_value FROM student_higher_education
      `);
      const funded = aspirantRows.filter((r) => r.is_scholarship);
      const valuedFunded = funded.filter((r) => r.scholarship_value != null);
      const totalValue = valuedFunded.reduce((sum, r) => sum + Number(r.scholarship_value), 0);

      const schemeRows = await this.prisma.$queryRaw<SchemeRow[]>(Prisma.sql`
        SELECT id, name, scheme_type, applied_count, awarded_count, total_value::text AS total_value
        FROM scholarship_schemes
        ORDER BY awarded_count DESC, id ASC
      `);
      const schemes = schemeRows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.scheme_type,
        applied: r.applied_count,
        awarded: r.awarded_count,
        value: Number(r.total_value),
      }));

      const fundingMixMap = new Map<string, number>();
      for (const s of schemes) {
        const key = s.type && s.type.trim() !== '' ? s.type : 'Unspecified';
        fundingMixMap.set(key, (fundingMixMap.get(key) ?? 0) + s.awarded);
      }
      const fundingMix = Array.from(fundingMixMap.entries())
        .map(([type, awarded]) => ({ type, awarded }))
        .sort((a, b) => b.awarded - a.awarded);

      const loanRows = await this.prisma.$queryRaw<LoanRow[]>(Prisma.sql`
        SELECT id, bank_name, amount::text AS amount, status, reapplied, collateral_free FROM higher_education_loans
      `);
      const sanctioned = loanRows.filter((r) => r.status === 'sanctioned');
      const underProcess = loanRows.filter((r) => r.status === 'under_process');
      const rejected = loanRows.filter((r) => r.status === 'rejected');
      const loans = {
        sanctionedFiles: sanctioned.length,
        sanctionedValue: sanctioned.reduce((sum, r) => sum + Number(r.amount), 0),
        underProcessFiles: underProcess.length,
        underProcessValue: underProcess.reduce((sum, r) => sum + Number(r.amount), 0),
        rejectedCount: rejected.length,
        reappliedCount: rejected.filter((r) => r.reapplied).length,
        partnerBanks: Array.from(new Set(loanRows.map((r) => r.bank_name))),
        collateralFreePercent:
          loanRows.length > 0 ? Math.round((loanRows.filter((r) => r.collateral_free).length / loanRows.length) * 100) : null,
      };

      return {
        summary: {
          fundedCount: funded.length,
          fundedPercent: aspirantRows.length > 0 ? Math.round((funded.length / aspirantRows.length) * 100) : 0,
          totalValue,
          meanValuePerFunded: valuedFunded.length > 0 ? Math.round(totalValue / valuedFunded.length) : null,
        },
        schemes,
        fundingMix,
        loans,
      };
    } catch (err) {
      this.logger.error('DB error building higher-education scholarships view', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async createScheme(dto: CreateSchemeDto) {
    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        INSERT INTO scholarship_schemes (name, academic_year, scheme_type, applied_count, awarded_count, total_value)
        VALUES (
          ${dto.name},
          ${currentAcademicYear()},
          ${dto.scheme_type ?? null},
          ${dto.applied_count ?? 0},
          ${dto.awarded_count ?? 0},
          ${dto.total_value ?? 0}
        )
        RETURNING id
      `);
      return { id: rows[0].id };
    } catch (err) {
      this.logger.error('DB error creating scholarship scheme', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
