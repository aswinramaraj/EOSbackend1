import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { sports_trial_status_enum } from 'generated/prisma/client';
import {
  INTERNAL_ERROR,
  resolveStudentName,
  STUDENT_DISPLAY_INCLUDE,
  yearSemLabel,
  type StudentWithDisplay,
} from '../common/sports-common';
import { CreateTrialDto } from './dto/create-trial.dto';
import { UpdateTrialDto } from './dto/update-trial.dto';
import { SelectTrialDto } from './dto/select-trial.dto';
import { SearchTrialsDto } from './dto/search-trials.dto';

const TRIAL_INCLUDE = {
  students: { include: STUDENT_DISPLAY_INCLUDE },
  sports_disciplines: { select: { id: true, name: true } },
  sports_teams: { select: { id: true, name: true } },
  sports_facilities: { select: { id: true, name: true } },
  sports_trial_scores: { orderBy: { sort_order: 'asc' } },
} satisfies Prisma.sports_trialsInclude;

type TrialWithRelations = Prisma.sports_trialsGetPayload<{
  include: typeof TRIAL_INCLUDE;
}>;

const MONTH_NAMES = [
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

/** achievement_date is a @db.Date column — read it back in UTC to avoid a local-tz off-by-one. */
function formatMonthYear(date: Date): string {
  return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

type AchievementRow = {
  event_name: string;
  venue: string | null;
  achievement_date: Date;
  level: string | null;
  result: string;
};

function toAchievementItem(achievement: AchievementRow) {
  return {
    title: achievement.event_name,
    meta: `${achievement.venue ? `${achievement.venue} · ` : ''}${formatMonthYear(achievement.achievement_date)}`,
    level: achievement.level,
    award: achievement.result,
  };
}

/** "MECH · Sem 5 · MECH-A" style personal info, expanded into discrete fields for the trial detail view. */
function toStudentPersonalInfo(student: StudentWithDisplay) {
  const dept = student.courses?.departments ?? null;
  const semester = student.classes?.current_semester ?? null;

  return {
    id: student.id,
    name: resolveStudentName(student),
    reg_no: student.register_no,
    dept: dept ? { id: dept.id, name: dept.name, code: dept.code } : null,
    // No literal "year of study" column exists; derived the same way
    // principal-students / principal-finance do (2 semesters per year).
    year: semester ? Math.ceil(semester / 2) : null,
    sem: semester,
    section: student.classes?.section ?? null,
    mobile: student.student_contacts?.student_mobile ?? null,
    email: student.student_contacts?.student_email1 ?? null,
    dob: student.date_of_birth
      ? student.date_of_birth.toISOString().slice(0, 10)
      : null,
    gender: student.gender,
  };
}

function toTrialListItem(trial: TrialWithRelations) {
  return {
    id: trial.id,
    student: {
      id: trial.students.id,
      name: resolveStudentName(trial.students),
    },
    dept_code: trial.students.courses?.departments?.code ?? null,
    year_sem: yearSemLabel(trial.students.classes?.current_semester),
    discipline: {
      id: trial.sports_disciplines.id,
      name: trial.sports_disciplines.name,
    },
    target_team: trial.sports_teams
      ? { id: trial.sports_teams.id, name: trial.sports_teams.name }
      : null,
    round_label: trial.round_label,
    trial_at: trial.trial_at.toISOString(),
    status: trial.status,
  };
}

function toTrialDetailResponse(
  trial: TrialWithRelations,
  achievements: ReturnType<typeof toAchievementItem>[],
) {
  return {
    id: trial.id,
    student: toStudentPersonalInfo(trial.students),
    discipline: {
      id: trial.sports_disciplines.id,
      name: trial.sports_disciplines.name,
    },
    target_team: trial.sports_teams
      ? { id: trial.sports_teams.id, name: trial.sports_teams.name }
      : null,
    round_label: trial.round_label,
    trial_at: trial.trial_at.toISOString(),
    facility: trial.sports_facilities
      ? { id: trial.sports_facilities.id, name: trial.sports_facilities.name }
      : null,
    panel: trial.panel,
    status: trial.status,
    recommendation: trial.recommendation,
    scores: trial.sports_trial_scores.map((score) => ({
      id: score.id,
      criterion: score.criterion,
      score: score.score,
      sort_order: score.sort_order,
    })),
    achievements,
  };
}

@Injectable()
export class TrialsService {
  private readonly logger = new Logger(TrialsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /sports-admin/trials */
  async findAll(dto: SearchTrialsDto) {
    const where: Prisma.sports_trialsWhereInput = {};
    if (dto.discipline_id) where.discipline_id = dto.discipline_id;
    if (dto.status) where.status = dto.status;
    if (dto.q) {
      where.OR = [
        { round_label: { contains: dto.q, mode: 'insensitive' } },
        { panel: { contains: dto.q, mode: 'insensitive' } },
        {
          students: { student_id_no: { contains: dto.q, mode: 'insensitive' } },
        },
        {
          students: {
            soa_applications: {
              OR: [
                { first_name: { contains: dto.q, mode: 'insensitive' } },
                { last_name: { contains: dto.q, mode: 'insensitive' } },
              ],
            },
          },
        },
      ];
    }

    try {
      const trials = await this.prisma.sports_trials.findMany({
        where,
        include: TRIAL_INCLUDE,
        orderBy: { trial_at: 'desc' },
      });
      return trials.map(toTrialListItem);
    } catch (err) {
      this.logger.error('DB error while fetching trials', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * POST /sports-admin/trials
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND    – student_id does not exist
   *  404 DISCIPLINE_NOT_FOUND – discipline_id does not exist
   *  500 INTERNAL_ERROR       – unexpected failure (DB, etc.)
   */
  async create(dto: CreateTrialDto) {
    await this.assertStudentExists(dto.student_id);
    await this.assertDisciplineExists(dto.discipline_id);

    try {
      const trial = await this.prisma.$transaction(async (tx) => {
        const created = await tx.sports_trials.create({
          data: {
            student_id: dto.student_id,
            discipline_id: dto.discipline_id,
            target_team_id: dto.target_team_id,
            round_label: dto.round_label,
            trial_at: new Date(dto.trial_at),
            facility_id: dto.facility_id,
            panel: dto.panel,
          },
        });

        if (dto.scores?.length) {
          await tx.sports_trial_scores.createMany({
            data: dto.scores.map((score, index) => ({
              trial_id: created.id,
              criterion: score.criterion,
              score: score.score,
              sort_order: score.sort_order ?? index,
            })),
          });
        }

        return tx.sports_trials.findUniqueOrThrow({
          where: { id: created.id },
          include: TRIAL_INCLUDE,
        });
      });

      const achievements = await this.fetchAchievements(trial.student_id);
      return toTrialDetailResponse(trial, achievements);
    } catch (err) {
      this.logger.error('DB error while creating trial', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * GET /sports-admin/trials/:id
   *
   * Error cases:
   *  404 TRIAL_NOT_FOUND – no trial with the given id
   */
  async findOne(id: number) {
    const trial = await this.findByIdOrThrow(id);
    const achievements = await this.fetchAchievements(trial.student_id);
    return toTrialDetailResponse(trial, achievements);
  }

  /**
   * PATCH /sports-admin/trials/:id
   *
   * Error cases:
   *  404 TRIAL_NOT_FOUND      – no trial with the given id
   *  404 STUDENT_NOT_FOUND    – student_id does not exist
   *  404 DISCIPLINE_NOT_FOUND – discipline_id does not exist
   */
  async update(id: number, dto: UpdateTrialDto) {
    await this.findByIdOrThrow(id);

    if (dto.student_id !== undefined) {
      await this.assertStudentExists(dto.student_id);
    }
    if (dto.discipline_id !== undefined) {
      await this.assertDisciplineExists(dto.discipline_id);
    }

    try {
      const trial = await this.prisma.$transaction(async (tx) => {
        await tx.sports_trials.update({
          where: { id },
          data: {
            student_id: dto.student_id,
            discipline_id: dto.discipline_id,
            target_team_id: dto.target_team_id,
            round_label: dto.round_label,
            trial_at: dto.trial_at ? new Date(dto.trial_at) : undefined,
            facility_id: dto.facility_id,
            panel: dto.panel,
          },
        });

        if (dto.scores !== undefined) {
          await tx.sports_trial_scores.deleteMany({ where: { trial_id: id } });
          if (dto.scores.length) {
            await tx.sports_trial_scores.createMany({
              data: dto.scores.map((score, index) => ({
                trial_id: id,
                criterion: score.criterion,
                score: score.score,
                sort_order: score.sort_order ?? index,
              })),
            });
          }
        }

        return tx.sports_trials.findUniqueOrThrow({
          where: { id },
          include: TRIAL_INCLUDE,
        });
      });

      const achievements = await this.fetchAchievements(trial.student_id);
      return toTrialDetailResponse(trial, achievements);
    } catch (err) {
      this.logger.error('DB error while updating trial', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * DELETE /sports-admin/trials/:id
   *
   * Error cases:
   *  404 TRIAL_NOT_FOUND – no trial with the given id
   */
  async remove(id: number) {
    await this.findByIdOrThrow(id);

    try {
      // sports_trial_scores.trial_id is ON DELETE CASCADE — no manual cleanup needed.
      await this.prisma.sports_trials.delete({ where: { id } });
      return { message: 'Trial deleted successfully' };
    } catch (err) {
      this.logger.error('DB error while deleting trial', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * POST /sports-admin/trials/:id/select
   *
   * Error cases:
   *  404 TRIAL_NOT_FOUND         – no trial with the given id
   *  409 TRIAL_ALREADY_DECIDED   – trial is not currently pending
   */
  async select(id: number, dto: SelectTrialDto) {
    const trial = await this.findByIdOrThrow(id);
    this.assertPending(trial);

    let updated: TrialWithRelations;
    try {
      updated = await this.prisma.sports_trials.update({
        where: { id },
        data: {
          status: sports_trial_status_enum.selected,
          recommendation: dto.recommendation,
        },
        include: TRIAL_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error while selecting trial', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    if (updated.target_team_id) {
      await this.addToTeamRosterBestEffort(
        updated.student_id,
        updated.target_team_id,
      );
    }

    const achievements = await this.fetchAchievements(updated.student_id);
    return toTrialDetailResponse(updated, achievements);
  }

  /**
   * POST /sports-admin/trials/:id/hold
   *
   * Error cases:
   *  404 TRIAL_NOT_FOUND       – no trial with the given id
   *  409 TRIAL_ALREADY_DECIDED – trial is not currently pending
   */
  async hold(id: number) {
    const trial = await this.findByIdOrThrow(id);
    this.assertPending(trial);

    try {
      const updated = await this.prisma.sports_trials.update({
        where: { id },
        data: { status: sports_trial_status_enum.hold },
        include: TRIAL_INCLUDE,
      });
      const achievements = await this.fetchAchievements(updated.student_id);
      return toTrialDetailResponse(updated, achievements);
    } catch (err) {
      this.logger.error('DB error while placing trial on hold', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private assertPending(trial: TrialWithRelations) {
    if (trial.status !== sports_trial_status_enum.pending) {
      throw new ConflictException({
        message: 'This trial has already been decided',
        errorCode: 'TRIAL_ALREADY_DECIDED',
      });
    }
  }

  /**
   * Best-effort roster upsert on selection. Logged and swallowed on failure —
   * the primary status update has already succeeded by the time this runs
   * and must still be returned to the caller.
   */
  private async addToTeamRosterBestEffort(studentId: number, teamId: number) {
    try {
      const existing = await this.prisma.student_sports_team_mapping.findUnique(
        {
          where: {
            student_id_team_id: { student_id: studentId, team_id: teamId },
          },
        },
      );
      if (!existing) {
        await this.prisma.student_sports_team_mapping.create({
          data: { student_id: studentId, team_id: teamId },
        });
      }
    } catch (err) {
      this.logger.error(
        `Best-effort roster upsert failed for student ${studentId} / team ${teamId}`,
        err,
      );
    }
  }

  private async fetchAchievements(studentId: number) {
    try {
      const rows = await this.prisma.sports_achievements.findMany({
        where: { athlete_student_id: studentId },
        orderBy: { achievement_date: 'desc' },
      });
      return rows.map(toAchievementItem);
    } catch (err) {
      this.logger.error('DB error while fetching student achievements', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findByIdOrThrow(id: number): Promise<TrialWithRelations> {
    let trial: TrialWithRelations | null;
    try {
      trial = await this.prisma.sports_trials.findUnique({
        where: { id },
        include: TRIAL_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error during trial lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    if (!trial) {
      throw new NotFoundException({
        message: 'Trial not found',
        errorCode: 'TRIAL_NOT_FOUND',
      });
    }
    return trial;
  }

  private async assertStudentExists(studentId: number) {
    let student: unknown;
    try {
      student = await this.prisma.students.findUnique({
        where: { id: studentId },
      });
    } catch (err) {
      this.logger.error('DB error during student lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }
  }

  private async assertDisciplineExists(disciplineId: number) {
    let discipline: unknown;
    try {
      discipline = await this.prisma.sports_disciplines.findUnique({
        where: { id: disciplineId },
      });
    } catch (err) {
      this.logger.error('DB error during discipline lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    if (!discipline) {
      throw new NotFoundException({
        message: 'Discipline not found',
        errorCode: 'DISCIPLINE_NOT_FOUND',
      });
    }
  }
}
