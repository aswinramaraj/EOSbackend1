import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { attendance_status_enum } from 'generated/prisma/client';
import {
  INTERNAL_ERROR,
  STUDENT_DISPLAY_INCLUDE,
  resolveStudentName,
  romanYear,
  yearSemLabel,
} from '../common/sports-common';
import { CreateAthleteDto } from './dto/create-athlete.dto';
import { UpdateAthleteDto } from './dto/update-athlete.dto';
import { SearchAthletesDto } from './dto/search-athletes.dto';

const ATHLETE_INCLUDE = {
  students: { include: STUDENT_DISPLAY_INCLUDE },
  sports_disciplines: { select: { id: true, name: true } },
} satisfies Prisma.sports_athlete_profilesInclude;

type AthleteWithRelations = Prisma.sports_athlete_profilesGetPayload<{
  include: typeof ATHLETE_INCLUDE;
}>;

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

/** Formats a @db.Date value as "MMM yyyy", e.g. "Jan 2026". */
function formatMonthYear(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toAthleteListResponse(
  athlete: AthleteWithRelations,
  attendancePct: number,
) {
  const student = athlete.students;
  return {
    id: athlete.id,
    student_id: athlete.student_id,
    name: resolveStudentName(student),
    reg_no: student.register_no,
    dept_code: student.courses?.departments?.code ?? null,
    dept_name: student.courses?.departments?.name ?? null,
    year_sem: yearSemLabel(student.classes?.current_semester),
    discipline: athlete.sports_disciplines
      ? {
          id: athlete.sports_disciplines.id,
          name: athlete.sports_disciplines.name,
        }
      : null,
    status: athlete.status,
    attendance_pct: attendancePct,
    mobile: student.student_contacts?.student_mobile ?? null,
    email: student.student_contacts?.student_email1 ?? null,
  };
}

function toAchievementItem(achievement: {
  event_name: string;
  venue: string | null;
  achievement_date: Date;
  level: string | null;
  result: string;
}) {
  return {
    title: achievement.event_name,
    meta: `${achievement.venue ? `${achievement.venue} · ` : ''}${formatMonthYear(achievement.achievement_date)}`,
    level: achievement.level,
    award: achievement.result,
  };
}

function toAthleteDetailResponse(
  athlete: AthleteWithRelations,
  attendancePct: number,
  teams: {
    id: number;
    name: string;
    squad_role: string | null;
    jersey_no: string | null;
  }[],
  achievements: ReturnType<typeof toAchievementItem>[],
) {
  const student = athlete.students;
  const semester = student.classes?.current_semester;

  return {
    id: athlete.id,
    student_id: athlete.student_id,
    name: resolveStudentName(student),
    photo_url: student.photo_url,
    reg_no: student.register_no,
    roll_no: student.roll_no,
    dob: student.date_of_birth ? toDateOnly(student.date_of_birth) : null,
    gender: student.gender,
    department: student.courses?.departments
      ? {
          id: student.courses.departments.id,
          name: student.courses.departments.name,
          code: student.courses.departments.code,
        }
      : null,
    course: student.courses
      ? { name: student.courses.name, code: student.courses.code }
      : null,
    year: romanYear(semester) ? `${romanYear(semester)} year` : null,
    section: student.classes?.section ?? null,
    mobile: student.student_contacts?.student_mobile ?? null,
    email: student.student_contacts?.student_email1 ?? null,
    discipline: athlete.sports_disciplines
      ? {
          id: athlete.sports_disciplines.id,
          name: athlete.sports_disciplines.name,
        }
      : null,
    status: athlete.status,
    registered_academic_year: athlete.registered_academic_year,
    attendance_pct: attendancePct,
    teams,
    achievements,
  };
}

@Injectable()
export class AthletesService {
  private readonly logger = new Logger(AthletesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /sports-admin/athletes?discipline_id=&status=&q= */
  async findAll(dto: SearchAthletesDto) {
    const where: Prisma.sports_athlete_profilesWhereInput = {};
    if (dto.discipline_id) where.primary_discipline_id = dto.discipline_id;
    if (dto.status) where.status = dto.status;

    let athletes: AthleteWithRelations[];
    try {
      athletes = await this.prisma.sports_athlete_profiles.findMany({
        where,
        include: ATHLETE_INCLUDE,
        orderBy: { id: 'asc' },
      });
    } catch (err) {
      this.logger.error('DB error while fetching athletes', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    const attendanceMap = await this.computeAttendancePctBatch(
      athletes.map((a) => a.student_id),
    );

    let list = athletes.map((athlete) =>
      toAthleteListResponse(
        athlete,
        attendanceMap.get(athlete.student_id) ?? 0,
      ),
    );

    if (dto.q) {
      const q = dto.q.trim().toLowerCase();
      list = list.filter((item) => item.name.toLowerCase().includes(q));
    }

    return list;
  }

  /**
   * POST /sports-admin/athletes
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – student_id does not exist
   *  409 ATHLETE_ALREADY_REGISTERED – an athlete profile already exists for this student
   */
  async create(dto: CreateAthleteDto) {
    const student = await this.findStudentById(dto.student_id);
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const existing = await this.findProfileByStudentId(dto.student_id);
    if (existing) {
      throw new ConflictException({
        message: 'This student is already registered as an athlete',
        errorCode: 'ATHLETE_ALREADY_REGISTERED',
      });
    }

    try {
      const created = await this.prisma.sports_athlete_profiles.create({
        data: {
          student_id: dto.student_id,
          primary_discipline_id: dto.primary_discipline_id,
          status: dto.status,
          registered_academic_year: dto.registered_academic_year,
        },
        include: ATHLETE_INCLUDE,
      });
      const attendancePct = await this.computeAttendancePct(created.student_id);
      return toAthleteListResponse(created, attendancePct);
    } catch (err) {
      this.logger.error('DB error while creating athlete profile', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * GET /sports-admin/athletes/:id
   *
   * Error cases:
   *  404 ATHLETE_NOT_FOUND – no athlete profile with this id
   */
  async findOne(id: number) {
    const athlete = await this.findById(id);
    if (!athlete) {
      throw new NotFoundException({
        message: 'Athlete not found',
        errorCode: 'ATHLETE_NOT_FOUND',
      });
    }

    const [attendancePct, teams, achievements] = await Promise.all([
      this.computeAttendancePct(athlete.student_id),
      this.findTeamMemberships(athlete.student_id),
      this.findAchievements(athlete.student_id),
    ]);

    return toAthleteDetailResponse(athlete, attendancePct, teams, achievements);
  }

  /**
   * PATCH /sports-admin/athletes/:id
   *
   * Error cases:
   *  404 ATHLETE_NOT_FOUND – no athlete profile with this id
   */
  async update(id: number, dto: UpdateAthleteDto) {
    const athlete = await this.findById(id);
    if (!athlete) {
      throw new NotFoundException({
        message: 'Athlete not found',
        errorCode: 'ATHLETE_NOT_FOUND',
      });
    }

    try {
      const updated = await this.prisma.sports_athlete_profiles.update({
        where: { id },
        data: {
          primary_discipline_id: dto.primary_discipline_id,
          status: dto.status,
          registered_academic_year: dto.registered_academic_year,
        },
        include: ATHLETE_INCLUDE,
      });
      const attendancePct = await this.computeAttendancePct(updated.student_id);
      return toAthleteListResponse(updated, attendancePct);
    } catch (err) {
      this.logger.error('DB error while updating athlete profile', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * DELETE /sports-admin/athletes/:id — removes the athlete profile only, never the student.
   *
   * Error cases:
   *  404 ATHLETE_NOT_FOUND – no athlete profile with this id
   */
  async remove(id: number) {
    const athlete = await this.findById(id);
    if (!athlete) {
      throw new NotFoundException({
        message: 'Athlete not found',
        errorCode: 'ATHLETE_NOT_FOUND',
      });
    }

    try {
      await this.prisma.sports_athlete_profiles.delete({ where: { id } });
      return { message: 'Athlete profile deleted successfully' };
    } catch (err) {
      this.logger.error('DB error while deleting athlete profile', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findById(id: number): Promise<AthleteWithRelations | null> {
    try {
      return await this.prisma.sports_athlete_profiles.findUnique({
        where: { id },
        include: ATHLETE_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error during athlete lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findStudentById(id: number) {
    try {
      return await this.prisma.students.findUnique({ where: { id } });
    } catch (err) {
      this.logger.error('DB error during student lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findProfileByStudentId(studentId: number) {
    try {
      return await this.prisma.sports_athlete_profiles.findUnique({
        where: { student_id: studentId },
      });
    } catch (err) {
      this.logger.error('DB error during athlete profile duplicate check', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findTeamMemberships(studentId: number) {
    try {
      const rows = await this.prisma.student_sports_team_mapping.findMany({
        where: { student_id: studentId },
        include: { sports_teams: { select: { id: true, name: true } } },
      });
      return rows.map((row) => ({
        id: row.sports_teams.id,
        name: row.sports_teams.name,
        squad_role: row.squad_role,
        jersey_no: row.jersey_no,
      }));
    } catch (err) {
      this.logger.error('DB error while fetching team memberships', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async findAchievements(studentId: number) {
    try {
      const rows = await this.prisma.sports_achievements.findMany({
        where: { athlete_student_id: studentId },
        orderBy: { achievement_date: 'desc' },
      });
      return rows.map(toAchievementItem);
    } catch (err) {
      this.logger.error('DB error while fetching athlete achievements', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /** present-count / total-marked-count * 100, rounded, 0 if nothing has ever been marked. */
  private async computeAttendancePct(studentId: number): Promise<number> {
    const map = await this.computeAttendancePctBatch([studentId]);
    return map.get(studentId) ?? 0;
  }

  private async computeAttendancePctBatch(
    studentIds: number[],
  ): Promise<Map<number, number>> {
    const uniqueIds = [...new Set(studentIds)];
    const result = new Map<number, number>();
    if (uniqueIds.length === 0) return result;

    try {
      const rows = await this.prisma.sports_session_attendance.groupBy({
        by: ['student_id', 'status'],
        where: { student_id: { in: uniqueIds } },
        _count: { _all: true },
      });

      const totals = new Map<number, number>();
      const presents = new Map<number, number>();
      for (const row of rows) {
        totals.set(
          row.student_id,
          (totals.get(row.student_id) ?? 0) + row._count._all,
        );
        if (row.status === attendance_status_enum.present) {
          presents.set(
            row.student_id,
            (presents.get(row.student_id) ?? 0) + row._count._all,
          );
        }
      }

      for (const id of uniqueIds) {
        const total = totals.get(id) ?? 0;
        const present = presents.get(id) ?? 0;
        result.set(id, total > 0 ? Math.round((present / total) * 100) : 0);
      }
      return result;
    } catch (err) {
      this.logger.error('DB error while computing attendance percentage', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }
}
