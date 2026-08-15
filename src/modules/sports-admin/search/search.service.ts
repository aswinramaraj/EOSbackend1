import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { INTERNAL_ERROR, resolveStudentName } from '../common/sports-common';

export interface SearchResult {
  section: string;
  title: string;
  sub: string;
  route: string;
}

const RESULT_LIMIT_PER_SECTION = 5;

/**
 * Cross-entity search for the topbar — same idea as the design reference's
 * search page, but returned as a small ranked list rather than a full page
 * (the shell renders it as a dropdown). Each section is capped and queried
 * independently so one slow/huge table can't crowd out the others.
 */
@Injectable()
export class SportsSearchService {
  private readonly logger = new Logger(SportsSearchService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /sports-admin/search?q= */
  async search(q: string): Promise<SearchResult[]> {
    const term = q.trim();
    if (term.length < 2) return [];

    try {
      const [athletes, teams, coaches, disciplines, facilities, fixtures] =
        await Promise.all([
          this.prisma.sports_athlete_profiles.findMany({
            where: {
              students: {
                OR: [
                  { student_id_no: { contains: term, mode: 'insensitive' } },
                  { roll_no: { contains: term, mode: 'insensitive' } },
                  { register_no: { contains: term, mode: 'insensitive' } },
                  {
                    soa_applications: {
                      OR: [
                        { first_name: { contains: term, mode: 'insensitive' } },
                        { last_name: { contains: term, mode: 'insensitive' } },
                      ],
                    },
                  },
                ],
              },
            },
            take: RESULT_LIMIT_PER_SECTION,
            select: {
              id: true,
              students: {
                select: {
                  soa_applications: {
                    select: { first_name: true, last_name: true },
                  },
                  users: { select: { email: true } },
                  student_id_no: true,
                },
              },
              sports_disciplines: { select: { name: true } },
            },
          }),
          this.prisma.sports_teams.findMany({
            where: { name: { contains: term, mode: 'insensitive' } },
            take: RESULT_LIMIT_PER_SECTION,
            select: {
              id: true,
              name: true,
              sports_disciplines: { select: { name: true } },
            },
          }),
          this.prisma.sports_coach_profiles.findMany({
            where: {
              faculty: {
                OR: [
                  { first_name: { contains: term, mode: 'insensitive' } },
                  { last_name: { contains: term, mode: 'insensitive' } },
                ],
              },
            },
            take: RESULT_LIMIT_PER_SECTION,
            select: {
              id: true,
              faculty: {
                select: {
                  first_name: true,
                  last_name: true,
                  designation: true,
                },
              },
            },
          }),
          this.prisma.sports_disciplines.findMany({
            where: { name: { contains: term, mode: 'insensitive' } },
            take: RESULT_LIMIT_PER_SECTION,
            select: { id: true, name: true },
          }),
          this.prisma.sports_facilities.findMany({
            where: { name: { contains: term, mode: 'insensitive' } },
            take: RESULT_LIMIT_PER_SECTION,
            select: { id: true, name: true, location: true },
          }),
          this.prisma.sports_fixtures.findMany({
            where: {
              OR: [
                { title: { contains: term, mode: 'insensitive' } },
                { opponent: { contains: term, mode: 'insensitive' } },
              ],
            },
            take: RESULT_LIMIT_PER_SECTION,
            select: { id: true, title: true, opponent: true },
          }),
        ]);

      const results: SearchResult[] = [];

      for (const a of athletes) {
        results.push({
          section: 'Athletes',
          title: resolveStudentName(a.students),
          sub: [a.students.student_id_no, a.sports_disciplines?.name]
            .filter(Boolean)
            .join(' · '),
          route: `/sports-admin/athletes/${a.id}`,
        });
      }
      for (const t of teams) {
        results.push({
          section: 'Teams',
          title: t.name,
          sub: t.sports_disciplines?.name ?? '',
          route: `/sports-admin/teams/${t.id}`,
        });
      }
      for (const c of coaches) {
        results.push({
          section: 'Coaches',
          title: `${c.faculty.first_name} ${c.faculty.last_name}`,
          sub: c.faculty.designation,
          route: `/sports-admin/coaches/${c.id}`,
        });
      }
      for (const disc of disciplines) {
        results.push({
          section: 'Disciplines',
          title: disc.name,
          sub: '',
          route: `/sports-admin/disciplines`,
        });
      }
      for (const f of facilities) {
        results.push({
          section: 'Facilities',
          title: f.name,
          sub: f.location ?? '',
          route: `/sports-admin/facilities`,
        });
      }
      for (const fx of fixtures) {
        results.push({
          section: 'Fixtures',
          title: fx.title,
          sub: fx.opponent ?? '',
          route: `/sports-admin/fixtures`,
        });
      }

      return results;
    } catch (err) {
      this.logger.error('DB error while running sports-admin search', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }
}
