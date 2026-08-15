import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import {
  STUDENT_DISPLAY_INCLUDE,
  resolveStudentName,
  studentAcademicMeta,
  INTERNAL_ERROR,
} from 'src/modules/sports-admin/common/sports-common';
import { CreateAchievementDto } from './dto/create-achievement.dto';
import { UpdateAchievementDto } from './dto/update-achievement.dto';
import { SearchAchievementsDto } from './dto/search-achievements.dto';

const MONTHS = [
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

/** "Aug 2026" style month/year label used for the achievement card's `meta`. */
function formatMonthYear(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

const ACHIEVEMENT_INCLUDE = {
  students: { include: STUDENT_DISPLAY_INCLUDE },
  sports_teams: { select: { id: true, name: true } },
} satisfies Prisma.sports_achievementsInclude;

type AchievementWithRelations = Prisma.sports_achievementsGetPayload<{
  include: typeof ACHIEVEMENT_INCLUDE;
}>;

/**
 * An achievement row is EITHER a team result (team_id set) OR an individual
 * result (athlete_student_id set) — never both, never neither (enforced by
 * ACHIEVEMENT_SUBJECT_REQUIRED on create).
 */
function toAchievementResponse(achievement: AchievementWithRelations) {
  const sub = achievement.students
    ? `${resolveStudentName(achievement.students)} · ${studentAcademicMeta(achievement.students)}`
    : (achievement.sports_teams?.name ?? '');

  return {
    id: achievement.id,
    title: achievement.event_name,
    sub,
    meta: formatMonthYear(achievement.achievement_date),
    badge: achievement.result,
    level: achievement.level,
    // Raw, editable fields — the four above are display-only derived
    // strings (composed subject name, formatted month/year) that an edit
    // form can't reconstruct the original values from.
    event_name: achievement.event_name,
    result: achievement.result,
    achievement_date: achievement.achievement_date.toISOString().slice(0, 10),
    venue: achievement.venue,
    certificate_url: achievement.certificate_url,
    team_id: achievement.team_id,
    athlete_student_id: achievement.athlete_student_id,
  };
}

@Injectable()
export class AchievementsService {
  private readonly logger = new Logger(AchievementsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /sports-admin/achievements
   *
   * Error cases:
   *  400 ACHIEVEMENT_SUBJECT_REQUIRED – neither team_id nor athlete_student_id given
   *  500 INTERNAL_ERROR – unexpected failure (DB, etc.)
   */
  async create(dto: CreateAchievementDto) {
    if (!dto.team_id && !dto.athlete_student_id) {
      throw new BadRequestException({
        message: 'Either team_id or athlete_student_id is required',
        errorCode: 'ACHIEVEMENT_SUBJECT_REQUIRED',
      });
    }

    try {
      const achievement = await this.prisma.sports_achievements.create({
        data: {
          event_name: dto.event_name,
          result: dto.result,
          achievement_date: new Date(dto.achievement_date),
          level: dto.level,
          venue: dto.venue,
          certificate_url: dto.certificate_url,
          team_id: dto.team_id,
          athlete_student_id: dto.athlete_student_id,
        },
        include: ACHIEVEMENT_INCLUDE,
      });
      return toAchievementResponse(achievement);
    } catch (err) {
      this.logger.error('DB error while creating achievement', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /** GET /sports-admin/achievements?level=&q= */
  async findAll(dto: SearchAchievementsDto) {
    const where: Prisma.sports_achievementsWhereInput = {};
    if (dto.level) where.level = dto.level;
    if (dto.q) {
      where.OR = [
        { event_name: { contains: dto.q, mode: 'insensitive' } },
        { participant_name: { contains: dto.q, mode: 'insensitive' } },
        { sports_teams: { name: { contains: dto.q, mode: 'insensitive' } } },
      ];
    }

    try {
      const achievements = await this.prisma.sports_achievements.findMany({
        where,
        include: ACHIEVEMENT_INCLUDE,
        orderBy: { achievement_date: 'desc' },
      });
      return achievements.map(toAchievementResponse);
    } catch (err) {
      this.logger.error('DB error while fetching achievements', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * GET /sports-admin/achievements/:id
   *
   * Error cases:
   *  404 ACHIEVEMENT_NOT_FOUND – no achievement with the given id
   */
  async findOne(id: number) {
    const achievement = await this.findById(id);
    if (!achievement) {
      throw new NotFoundException({
        message: 'Achievement not found',
        errorCode: 'ACHIEVEMENT_NOT_FOUND',
      });
    }
    return toAchievementResponse(achievement);
  }

  /**
   * PATCH /sports-admin/achievements/:id
   *
   * Error cases:
   *  404 ACHIEVEMENT_NOT_FOUND – no achievement with the given id
   */
  async update(id: number, dto: UpdateAchievementDto) {
    const achievement = await this.findById(id);
    if (!achievement) {
      throw new NotFoundException({
        message: 'Achievement not found',
        errorCode: 'ACHIEVEMENT_NOT_FOUND',
      });
    }

    try {
      const updated = await this.prisma.sports_achievements.update({
        where: { id },
        data: {
          event_name: dto.event_name,
          result: dto.result,
          achievement_date: dto.achievement_date
            ? new Date(dto.achievement_date)
            : undefined,
          level: dto.level,
          venue: dto.venue,
          certificate_url: dto.certificate_url,
          team_id: dto.team_id,
          athlete_student_id: dto.athlete_student_id,
        },
        include: ACHIEVEMENT_INCLUDE,
      });
      return toAchievementResponse(updated);
    } catch (err) {
      this.logger.error('DB error while updating achievement', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * DELETE /sports-admin/achievements/:id
   *
   * Error cases:
   *  404 ACHIEVEMENT_NOT_FOUND – no achievement with the given id
   */
  async remove(id: number) {
    const achievement = await this.findById(id);
    if (!achievement) {
      throw new NotFoundException({
        message: 'Achievement not found',
        errorCode: 'ACHIEVEMENT_NOT_FOUND',
      });
    }

    try {
      await this.prisma.sports_achievements.delete({ where: { id } });
      return { message: 'Achievement deleted successfully' };
    } catch (err) {
      this.logger.error('DB error while deleting achievement', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.sports_achievements.findUnique({
        where: { id },
        include: ACHIEVEMENT_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error during achievement lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }
}
