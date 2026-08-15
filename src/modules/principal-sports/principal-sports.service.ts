import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

interface TotalsRow {
  students_in_sports: bigint;
  equipment_issued: bigint;
}
interface TeamRow {
  id: number;
  name: string;
  coach_name: string | null;
  department_code: string | null;
  member_count: bigint;
}

/** Principal-only Sports overview (participation + equipment, team-wise breakdown). */
@Injectable()
export class PrincipalSportsService {
  private readonly logger = new Logger(PrincipalSportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    try {
      // Sequential, not Promise.all - see principal-faculty/principal-departments
      // services for why (Supabase session-mode pool is small and shared).
      const totalsRows = await this.prisma.$queryRaw<TotalsRow[]>(Prisma.sql`
        SELECT
          (SELECT COUNT(DISTINCT student_id) FROM student_sports_team_mapping)::bigint AS students_in_sports,
          (SELECT COUNT(*) FROM sports_equipment_issues WHERE status IN ('borrowed', 'overdue'))::bigint AS equipment_issued
      `);

      const teamRows = await this.prisma.$queryRaw<TeamRow[]>(Prisma.sql`
        SELECT st.id, st.name, st.coach_name, d.code AS department_code,
          (SELECT COUNT(*) FROM student_sports_team_mapping sstm WHERE sstm.team_id = st.id)::bigint AS member_count
        FROM sports_teams st
        LEFT JOIN departments d ON d.id = st.department_id
        ORDER BY st.name ASC
      `);

      const totals = totalsRows[0];

      return {
        students_in_sports: Number(totals?.students_in_sports ?? 0),
        equipment_issued: Number(totals?.equipment_issued ?? 0),
        teams: teamRows.map((row) => ({
          id: row.id,
          name: row.name,
          coach_name: row.coach_name,
          department_code: row.department_code,
          member_count: Number(row.member_count),
        })),
      };
    } catch (err) {
      this.logger.error('DB error computing principal sports overview', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
