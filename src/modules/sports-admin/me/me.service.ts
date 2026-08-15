import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { INTERNAL_ERROR } from '../common/sports-common';

/**
 * Identity for the Sports Admin shell (sidebar/topbar). A sports_admin user
 * is a faculty row that MAY also have a sports_coach_profiles row (the
 * physical director / a discipline coach) — but doesn't have to, so this
 * degrades gracefully to plain faculty fields when there's no coach profile.
 */
@Injectable()
export class SportsAdminMeService {
  private readonly logger = new Logger(SportsAdminMeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /sports-admin/me */
  async getMe(user: JwtPayload) {
    try {
      const faculty = await this.prisma.faculty.findUnique({
        where: { user_id: user.sub },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          designation: true,
          departments: { select: { id: true, name: true } },
          sports_coach_profiles: {
            select: {
              duty_status: true,
              sports_disciplines: { select: { id: true, name: true } },
            },
          },
        },
      });

      if (!faculty) {
        return {
          name: user.email,
          designation: null,
          department: null,
          discipline: null,
          duty_status: null,
        };
      }

      return {
        name: `${faculty.first_name} ${faculty.last_name}`,
        designation: faculty.sports_coach_profiles
          ? faculty.designation
          : faculty.designation,
        department: faculty.departments?.name ?? null,
        discipline: faculty.sports_coach_profiles?.sports_disciplines ?? null,
        duty_status: faculty.sports_coach_profiles?.duty_status ?? null,
      };
    } catch (err) {
      this.logger.error('DB error while fetching sports-admin identity', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * GET /sports-admin/me/nav-counts — the sidebar's per-item badge counts.
   * Master-data sections (athletes/teams/disciplines/achievements) get a
   * plain total, matching each of those pages' own "N registered" header;
   * the two decision-queue sections (trials/OD) get a pending count instead
   * of a lifetime total, since that's the number that's actually actionable
   * — same split those two pages already use for their own subtitle.
   */
  async getNavCounts() {
    try {
      const [
        athletes,
        teams,
        trialsPending,
        odPending,
        disciplines,
        achievements,
      ] = await Promise.all([
        this.prisma.sports_athlete_profiles.count(),
        this.prisma.sports_teams.count(),
        this.prisma.sports_trials.count({ where: { status: 'pending' } }),
        this.prisma.sports_od_requests.count({ where: { status: 'pending' } }),
        this.prisma.sports_disciplines.count(),
        this.prisma.sports_achievements.count(),
      ]);

      return {
        athletes,
        teams,
        trials_pending: trialsPending,
        od_pending: odPending,
        disciplines,
        achievements,
      };
    } catch (err) {
      this.logger.error('DB error while fetching sports-admin nav counts', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }
}
