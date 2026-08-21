import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

interface CoachExtraRow {
  id: number;
  coach_phone: string | null;
  coach_role: string | null;
}

interface AchievementRow {
  id: number;
  team_id: number | null;
  event_name: string;
  participant_name: string | null;
  result: string;
  achievement_date: string;
}

/**
 * `sports_teams.coach_phone`/`coach_role` and `sports_achievements` don't
 * exist yet (query.md #11) — `sports_teams.coach_name` is the only real
 * coach field, and no achievements/results table has ever existed. Both
 * read via `$queryRaw` with a try/catch fallback so this module upgrades
 * automatically the moment that SQL runs.
 */
@Injectable()
export class PrincipalSportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async tryLoadCoachExtras(): Promise<Map<number, CoachExtraRow>> {
    try {
      const rows = await this.prisma.$queryRaw<CoachExtraRow[]>`
        SELECT id, coach_phone, coach_role FROM sports_teams
      `;
      return new Map(rows.map((r) => [r.id, r]));
    } catch {
      return new Map();
    }
  }

  private async tryLoadAchievements(): Promise<AchievementRow[]> {
    try {
      return await this.prisma.$queryRaw<AchievementRow[]>`
        SELECT id, team_id, event_name, participant_name, result, achievement_date
        FROM sports_achievements ORDER BY achievement_date DESC
      `;
    } catch {
      return [];
    }
  }

  /** GET /me/principal/facilities/sports/summary */
  async summary() {
    const [teams, distinctStudents, equipment, achievements] =
      await Promise.all([
        this.prisma.sports_teams.findMany({
          select: { id: true, coach_name: true },
        }),
        this.prisma.student_sports_team_mapping.findMany({
          select: { student_id: true },
          distinct: ['student_id'],
        }),
        this.prisma.sports_equipment.findMany({
          select: { total_quantity: true },
        }),
        this.tryLoadAchievements(),
      ]);

    return {
      sports_students: distinctStudents.length,
      disciplines_count: teams.length,
      sports_faculty_count: teams.filter((t) => t.coach_name).length,
      achievements_this_semester: achievements.length,
      equipment_types: equipment.length,
      equipment_total_quantity: equipment.reduce(
        (sum, e) => sum + e.total_quantity,
        0,
      ),
    };
  }

  /** GET /me/principal/facilities/sports/faculty */
  async faculty() {
    const [teams, extras] = await Promise.all([
      this.prisma.sports_teams.findMany({
        where: { coach_name: { not: null } },
        select: { id: true, name: true, coach_name: true },
        orderBy: { name: 'asc' },
      }),
      this.tryLoadCoachExtras(),
    ]);

    return teams.map((t) => {
      const extra = extras.get(t.id);
      return {
        team_id: t.id,
        discipline: t.name,
        coach_name: t.coach_name,
        coach_role: extra?.coach_role ?? null,
        coach_phone: extra?.coach_phone ?? null,
      };
    });
  }

  /** GET /me/principal/facilities/sports/achievements */
  async achievements() {
    const [rows, teams] = await Promise.all([
      this.tryLoadAchievements(),
      this.prisma.sports_teams.findMany({ select: { id: true, name: true } }),
    ]);
    const teamNameById = new Map(teams.map((t) => [t.id, t.name]));

    return rows.map((r) => ({
      id: r.id,
      event_name: r.event_name,
      discipline:
        r.team_id != null ? (teamNameById.get(r.team_id) ?? null) : null,
      participant_name: r.participant_name,
      result: r.result,
      achievement_date: r.achievement_date,
    }));
  }
}
