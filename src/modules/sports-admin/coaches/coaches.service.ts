import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import {
  FACULTY_DISPLAY_SELECT,
  INTERNAL_ERROR,
  resolveFacultyName,
} from '../common/sports-common';
import { CreateCoachProfileDto } from './dto/create-coach-profile.dto';
import { UpdateCoachProfileDto } from './dto/update-coach-profile.dto';
import { SearchCoachesDto } from './dto/search-coaches.dto';

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "MMM yyyy" — e.g. "Mar 2025". Used on achievement cards. */
function formatMonthYear(date: Date): string {
  return `${MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// ── List / summary shape ──────────────────────────────────────────────────────
// A coach row for GET /sports-admin/coaches — faculty core fields + the
// sports_coach_profiles fields needed for the roster table.

const COACH_LIST_INCLUDE = {
  faculty: { select: FACULTY_DISPLAY_SELECT },
  sports_disciplines: { select: { id: true, name: true } },
} satisfies Prisma.sports_coach_profilesInclude;

type CoachProfileWithFaculty = Prisma.sports_coach_profilesGetPayload<{
  include: typeof COACH_LIST_INCLUDE;
}>;

function toCoachListResponse(profile: CoachProfileWithFaculty) {
  return {
    id: profile.id,
    faculty_id: profile.faculty_id,
    name: resolveFacultyName(profile.faculty),
    designation: profile.faculty.designation,
    discipline: profile.sports_disciplines
      ? {
          id: profile.sports_disciplines.id,
          name: profile.sports_disciplines.name,
        }
      : null,
    phone: profile.faculty.users?.phone ?? null,
    duty_status: profile.duty_status,
  };
}

// ── Detail shape ──────────────────────────────────────────────────────────────
// GET /sports-admin/coaches/:id — full merged staff record, plus this coach's
// teams and the achievements of those teams.

const COACH_DETAIL_FACULTY_SELECT = {
  ...FACULTY_DISPLAY_SELECT,
  departments: { select: { id: true, name: true, code: true } },
} satisfies Prisma.facultySelect;

const COACH_DETAIL_INCLUDE = {
  faculty: { select: COACH_DETAIL_FACULTY_SELECT },
  sports_disciplines: { select: { id: true, name: true } },
} satisfies Prisma.sports_coach_profilesInclude;

type CoachProfileDetail = Prisma.sports_coach_profilesGetPayload<{
  include: typeof COACH_DETAIL_INCLUDE;
}>;

type CoachTeam = { id: number; name: string };
type CoachAchievement = Prisma.sports_achievementsGetPayload<
  Record<string, never>
>;

function toCoachDetailResponse(
  profile: CoachProfileDetail,
  teams: CoachTeam[],
  achievements: CoachAchievement[],
) {
  const faculty = profile.faculty;

  return {
    id: profile.id,
    faculty_id: profile.faculty_id,
    name: resolveFacultyName(faculty),
    designation: faculty.designation,
    gender: faculty.gender,
    date_of_birth: faculty.date_of_birth
      ? toDateOnly(faculty.date_of_birth)
      : null,
    mobile: faculty.users?.phone ?? null,
    email: faculty.users?.email ?? null,
    department: faculty.departments
      ? {
          id: faculty.departments.id,
          name: faculty.departments.name,
          code: faculty.departments.code,
        }
      : null,
    qualification: faculty.qualification,
    specialization: faculty.specialization,
    joined: faculty.date_of_joining
      ? toDateOnly(faculty.date_of_joining)
      : null,
    coaching_experience_years: profile.coaching_experience_years,
    total_experience_years: faculty.previous_experience_years,
    discipline: profile.sports_disciplines
      ? {
          id: profile.sports_disciplines.id,
          name: profile.sports_disciplines.name,
        }
      : null,
    duty_status: profile.duty_status,
    status: faculty.status,
    certifications: profile.certifications,
    responsibilities: profile.responsibilities,
    teams: teams.map((team) => ({ id: team.id, name: team.name })),
    achievements: achievements.map((achievement) => ({
      title: achievement.event_name,
      meta:
        (achievement.venue ? `${achievement.venue} · ` : '') +
        formatMonthYear(achievement.achievement_date),
      level: achievement.level,
      award: achievement.result,
    })),
  };
}

@Injectable()
export class CoachesService {
  private readonly logger = new Logger(CoachesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /sports-admin/coaches?discipline_id=&duty_status=&q= */
  async findAll(dto: SearchCoachesDto) {
    const { discipline_id, duty_status, q } = dto;

    const where: Prisma.sports_coach_profilesWhereInput = {};
    if (discipline_id) where.discipline_id = discipline_id;
    if (duty_status) where.duty_status = duty_status;
    if (q) {
      where.faculty = {
        OR: [
          { first_name: { contains: q, mode: 'insensitive' } },
          { last_name: { contains: q, mode: 'insensitive' } },
          { designation: { contains: q, mode: 'insensitive' } },
        ],
      };
    }

    try {
      const profiles = await this.prisma.sports_coach_profiles.findMany({
        where,
        include: COACH_LIST_INCLUDE,
        orderBy: { faculty: { first_name: 'asc' } },
      });
      return profiles.map(toCoachListResponse);
    } catch (err) {
      this.logger.error('DB error while fetching coaches', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /** GET /sports-admin/coaches/discipline-summary — "coaches on duty" KPI. */
  async disciplineSummary() {
    try {
      const [total, on_duty, on_leave] = await this.prisma.$transaction([
        this.prisma.sports_coach_profiles.count(),
        this.prisma.sports_coach_profiles.count({
          where: { duty_status: 'on_duty' },
        }),
        this.prisma.sports_coach_profiles.count({
          where: { duty_status: 'on_leave' },
        }),
      ]);
      return { total, on_duty, on_leave };
    } catch (err) {
      this.logger.error('DB error while summarizing coach duty status', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * POST /sports-admin/coaches
   *
   * Error cases:
   *  404 FACULTY_NOT_FOUND     – faculty_id does not exist
   *  409 COACH_PROFILE_EXISTS  – that faculty already has a coach profile
   */
  async create(dto: CreateCoachProfileDto) {
    const faculty = await this.findFacultyById(dto.faculty_id);
    if (!faculty) {
      throw new NotFoundException({
        message: 'Faculty member not found',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }

    const existing = await this.findProfileByFacultyId(dto.faculty_id);
    if (existing) {
      throw new ConflictException({
        message: 'This faculty member already has a coach profile',
        errorCode: 'COACH_PROFILE_EXISTS',
      });
    }

    try {
      const profile = await this.prisma.sports_coach_profiles.create({
        data: {
          faculty_id: dto.faculty_id,
          discipline_id: dto.discipline_id,
          coaching_experience_years: dto.coaching_experience_years,
          duty_status: dto.duty_status,
          certifications: dto.certifications ?? [],
          responsibilities: dto.responsibilities ?? [],
        },
        include: COACH_LIST_INCLUDE,
      });
      return toCoachListResponse(profile);
    } catch (err) {
      this.logger.error('DB error while creating coach profile', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * GET /sports-admin/coaches/:id
   *
   * Error cases:
   *  404 COACH_NOT_FOUND – no coach profile with this id
   */
  async findOne(id: number) {
    let profile: CoachProfileDetail | null;
    try {
      profile = await this.prisma.sports_coach_profiles.findUnique({
        where: { id },
        include: COACH_DETAIL_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error during coach detail lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    if (!profile) {
      throw new NotFoundException({
        message: 'Coach profile not found',
        errorCode: 'COACH_NOT_FOUND',
      });
    }

    try {
      const teams = await this.prisma.sports_teams.findMany({
        where: { coach_faculty_id: profile.faculty_id },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });

      const teamIds = teams.map((team) => team.id);
      const achievements = teamIds.length
        ? await this.prisma.sports_achievements.findMany({
            where: { team_id: { in: teamIds } },
            orderBy: { achievement_date: 'desc' },
          })
        : [];

      return toCoachDetailResponse(profile, teams, achievements);
    } catch (err) {
      this.logger.error('DB error while assembling coach detail', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * PATCH /sports-admin/coaches/:id
   *
   * Error cases:
   *  404 COACH_NOT_FOUND – no coach profile with this id
   */
  async update(id: number, dto: UpdateCoachProfileDto) {
    const existing = await this.findProfileById(id);
    if (!existing) {
      throw new NotFoundException({
        message: 'Coach profile not found',
        errorCode: 'COACH_NOT_FOUND',
      });
    }

    try {
      const updated = await this.prisma.sports_coach_profiles.update({
        where: { id },
        data: {
          discipline_id: dto.discipline_id,
          coaching_experience_years: dto.coaching_experience_years,
          duty_status: dto.duty_status,
          certifications: dto.certifications,
          responsibilities: dto.responsibilities,
        },
        include: COACH_LIST_INCLUDE,
      });
      return toCoachListResponse(updated);
    } catch (err) {
      this.logger.error('DB error while updating coach profile', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * DELETE /sports-admin/coaches/:id — removes only the sports_coach_profiles
   * row; the underlying faculty record is never touched.
   *
   * Error cases:
   *  404 COACH_NOT_FOUND – no coach profile with this id
   */
  async remove(id: number) {
    const existing = await this.findProfileById(id);
    if (!existing) {
      throw new NotFoundException({
        message: 'Coach profile not found',
        errorCode: 'COACH_NOT_FOUND',
      });
    }

    try {
      await this.prisma.sports_coach_profiles.delete({ where: { id } });
      return { message: 'Coach profile deleted successfully' };
    } catch (err) {
      this.logger.error('DB error while deleting coach profile', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findFacultyById(id: number) {
    try {
      return await this.prisma.faculty.findUnique({ where: { id } });
    } catch (err) {
      this.logger.error('DB error during faculty lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findProfileByFacultyId(facultyId: number) {
    try {
      return await this.prisma.sports_coach_profiles.findUnique({
        where: { faculty_id: facultyId },
      });
    } catch (err) {
      this.logger.error('DB error during coach profile duplicate check', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findProfileById(id: number) {
    try {
      return await this.prisma.sports_coach_profiles.findUnique({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error during coach profile lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }
}
