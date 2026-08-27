import { ForbiddenException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';

interface SeasonRow {
  current_applicants: bigint;
  current_placed: bigint;
  previous_applicants: bigint;
  previous_placed: bigint;
}
interface CompaniesRow {
  companies: bigint;
}
interface OffersRow {
  offers: bigint;
  highest_package: string | null;
  average_package: string | null;
}
interface JobRoleRow {
  job_role: string | null;
}
interface DeptRow {
  department_id: number;
  applicants: bigint;
  placed: bigint;
}

/**
 * Principal-only Placements season overview - sits above the existing
 * "pick a department, see upcoming drives / history" flow (PrincipalPlacementsBody),
 * not a replacement for it. "Season" = the current calendar year's drives
 * (placement_drives.scheduled_date) - there's no separate season/academic
 * year column on that table. There's no "internship" concept anywhere in
 * the schema (no drive_type/offer_type column), so unlike the reference
 * design's "Internships" card, this shows real students-placed instead of
 * inventing an internship/conversion figure.
 */
@Injectable()
export class PrincipalPlacementsService {
  private readonly logger = new Logger(PrincipalPlacementsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Secretary is always forced to her own department; Principal/Admin stay institution-wide (undefined = unscoped). */
  private async resolveEffectiveDepartmentId(user: JwtPayload): Promise<number | undefined> {
    if (user.role !== ROLES.SECRETARY) return undefined;
    const staff = await this.prisma.non_teaching_staff.findFirst({
      where: { user_id: user.sub },
      select: { department_id: true },
    });
    if (!staff?.department_id) {
      throw new ForbiddenException({
        message: 'No department is assigned to this secretary account',
        errorCode: 'SECRETARY_NO_DEPARTMENT',
      });
    }
    return staff.department_id;
  }

  async getOverview(user: JwtPayload) {
    const departmentId = await this.resolveEffectiveDepartmentId(user);
    const studentDeptJoin =
      departmentId !== undefined ? Prisma.sql`JOIN students st ON st.id = sda.student_id JOIN classes cl ON cl.id = st.class_id` : Prisma.empty;
    const studentDeptFilter = departmentId !== undefined ? Prisma.sql`AND cl.department_id = ${departmentId}` : Prisma.empty;
    try {
      // Sequential, not Promise.all - see principal-faculty/principal-departments
      // services for why (Supabase session-mode pool is small and shared).
      const seasonRows = await this.prisma.$queryRaw<SeasonRow[]>(Prisma.sql`
        SELECT
          COUNT(DISTINCT sda.student_id) FILTER (WHERE EXTRACT(YEAR FROM pd.scheduled_date) = EXTRACT(YEAR FROM CURRENT_DATE))::bigint AS current_applicants,
          COUNT(DISTINCT sda.student_id) FILTER (WHERE EXTRACT(YEAR FROM pd.scheduled_date) = EXTRACT(YEAR FROM CURRENT_DATE) AND sda.status = 'placed')::bigint AS current_placed,
          COUNT(DISTINCT sda.student_id) FILTER (WHERE EXTRACT(YEAR FROM pd.scheduled_date) = EXTRACT(YEAR FROM CURRENT_DATE) - 1)::bigint AS previous_applicants,
          COUNT(DISTINCT sda.student_id) FILTER (WHERE EXTRACT(YEAR FROM pd.scheduled_date) = EXTRACT(YEAR FROM CURRENT_DATE) - 1 AND sda.status = 'placed')::bigint AS previous_placed
        FROM student_drive_applications sda
        JOIN placement_drives pd ON pd.id = sda.drive_id
        ${studentDeptJoin}
        WHERE EXTRACT(YEAR FROM pd.scheduled_date) IN (EXTRACT(YEAR FROM CURRENT_DATE), EXTRACT(YEAR FROM CURRENT_DATE) - 1)
        ${studentDeptFilter}
      `);

      // Genuinely institution-wide/common — "how many companies visited campus
      // this year" isn't a per-department concept, so this stays unscoped
      // even for Secretary.
      const companiesRows = await this.prisma.$queryRaw<CompaniesRow[]>(Prisma.sql`
        SELECT COUNT(DISTINCT company_id)::bigint AS companies
        FROM placement_drives
        WHERE EXTRACT(YEAR FROM scheduled_date) = EXTRACT(YEAR FROM CURRENT_DATE)
      `);

      const offersRows = await this.prisma.$queryRaw<OffersRow[]>(Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE sda.status = 'placed')::bigint AS offers,
          MAX(sda.offered_package) FILTER (WHERE sda.status = 'placed')::text AS highest_package,
          AVG(sda.offered_package) FILTER (WHERE sda.status = 'placed')::text AS average_package
        FROM student_drive_applications sda
        JOIN placement_drives pd ON pd.id = sda.drive_id
        ${studentDeptJoin}
        WHERE EXTRACT(YEAR FROM pd.scheduled_date) = EXTRACT(YEAR FROM CURRENT_DATE)
        ${studentDeptFilter}
      `);

      const jobRoleRows = await this.prisma.$queryRaw<JobRoleRow[]>(Prisma.sql`
        SELECT pd.job_role
        FROM student_drive_applications sda
        JOIN placement_drives pd ON pd.id = sda.drive_id
        ${studentDeptJoin}
        WHERE sda.status = 'placed' AND EXTRACT(YEAR FROM pd.scheduled_date) = EXTRACT(YEAR FROM CURRENT_DATE)
        ${studentDeptFilter}
        ORDER BY sda.offered_package DESC NULLS LAST
        LIMIT 1
      `);

      const deptRows = await this.prisma.$queryRaw<DeptRow[]>(Prisma.sql`
        WITH dept_students AS (
          SELECT st.id AS student_id, cl.department_id
          FROM students st
          JOIN classes cl ON cl.id = st.class_id
        )
        SELECT ds.department_id,
          COUNT(DISTINCT sda.student_id)::bigint AS applicants,
          COUNT(DISTINCT sda.student_id) FILTER (WHERE sda.status = 'placed')::bigint AS placed
        FROM student_drive_applications sda
        JOIN placement_drives pd ON pd.id = sda.drive_id
        JOIN dept_students ds ON ds.student_id = sda.student_id
        WHERE EXTRACT(YEAR FROM pd.scheduled_date) = EXTRACT(YEAR FROM CURRENT_DATE)
        ${departmentId !== undefined ? Prisma.sql`AND ds.department_id = ${departmentId}` : Prisma.empty}
        GROUP BY ds.department_id
      `);

      const departments = await this.prisma.departments.findMany({
        where: departmentId !== undefined ? { id: departmentId } : undefined,
        orderBy: { name: 'asc' },
      });

      const season = seasonRows[0];
      const companies = Number(companiesRows[0]?.companies ?? 0);
      const offers = offersRows[0];

      const currentApplicants = Number(season?.current_applicants ?? 0);
      const currentPlaced = Number(season?.current_placed ?? 0);
      const previousApplicants = Number(season?.previous_applicants ?? 0);
      const previousPlaced = Number(season?.previous_placed ?? 0);

      const currentPct = currentApplicants > 0 ? Math.round((currentPlaced / currentApplicants) * 1000) / 10 : null;
      const previousPct = previousApplicants > 0 ? Math.round((previousPlaced / previousApplicants) * 1000) / 10 : null;

      const deptMap = new Map(
        deptRows.map((row) => [
          row.department_id,
          Number(row.applicants) > 0 ? Math.round((Number(row.placed) / Number(row.applicants)) * 1000) / 10 : null,
        ]),
      );

      return {
        season_year: new Date().getFullYear(),
        companies,
        offers_released: Number(offers?.offers ?? 0),
        placement_pct: currentPct,
        placement_pct_delta: currentPct !== null && previousPct !== null ? Math.round((currentPct - previousPct) * 10) / 10 : null,
        highest_package: offers?.highest_package !== null && offers?.highest_package !== undefined ? Number(offers.highest_package) : null,
        highest_package_role: jobRoleRows[0]?.job_role ?? null,
        average_package: offers?.average_package !== null && offers?.average_package !== undefined ? Math.round(Number(offers.average_package) * 100) / 100 : null,
        students_placed: currentPlaced,
        applicants: currentApplicants,
        departments: departments.map((dept) => ({
          code: dept.code,
          name: dept.name,
          placement_pct: deptMap.get(dept.id) ?? null,
        })),
      };
    } catch (err) {
      this.logger.error('DB error computing principal placements overview', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
