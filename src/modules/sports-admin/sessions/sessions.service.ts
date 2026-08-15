import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import {
  INTERNAL_ERROR,
  STUDENT_DISPLAY_INCLUDE,
  formatHHMM,
  resolveFacultyName,
  resolveStudentName,
  studentAcademicMeta,
} from '../common/sports-common';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { ListSessionsQueryDto } from './dto/list-sessions-query.dto';
import {
  MarkAttendanceDto,
  MarkAttendanceEntryDto,
} from './dto/mark-attendance.dto';
import { AttendanceSummaryQueryDto } from './dto/attendance-summary-query.dto';

/** "1970-01-01T14:30:00.000Z" style Date, same convention as timetable_slots' timeStringToDate. */
function timeStringToDate(time: string): Date {
  const normalized = time.length === 5 ? `${time}:00` : time;
  return new Date(`1970-01-01T${normalized}.000Z`);
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateOnlyToDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function todayDateOnly(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

const SESSION_INCLUDE = {
  sports_disciplines: { select: { id: true, name: true } },
  sports_facilities: { select: { id: true, name: true } },
  faculty: { select: { id: true, first_name: true, last_name: true } },
} satisfies Prisma.sports_training_sessionsInclude;

type SessionWithRelations = Prisma.sports_training_sessionsGetPayload<{
  include: typeof SESSION_INCLUDE;
}>;

function toSessionResponse(
  session: SessionWithRelations,
  athleteCount: number,
) {
  return {
    id: session.id,
    discipline: {
      id: session.sports_disciplines.id,
      name: session.sports_disciplines.name,
    },
    facility: session.sports_facilities
      ? {
          id: session.sports_facilities.id,
          name: session.sports_facilities.name,
        }
      : null,
    coach: session.faculty
      ? { id: session.faculty.id, name: resolveFacultyName(session.faculty) }
      : null,
    session_date: toDateOnly(session.session_date),
    start_time: formatHHMM(session.start_time),
    end_time: formatHHMM(session.end_time),
    status: session.status,
    athlete_count: athleteCount,
  };
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /sports-admin/sessions?date=YYYY-MM-DD — defaults to today. */
  async findAll(dto: ListSessionsQueryDto) {
    const filterDate = dto.date ? dateOnlyToDate(dto.date) : todayDateOnly();

    try {
      const sessions = await this.prisma.sports_training_sessions.findMany({
        where: { session_date: filterDate },
        include: SESSION_INCLUDE,
        orderBy: [{ start_time: 'asc' }, { id: 'asc' }],
      });

      const disciplineIds = [...new Set(sessions.map((s) => s.discipline_id))];
      const counts = disciplineIds.length
        ? await this.prisma.sports_athlete_profiles.groupBy({
            by: ['primary_discipline_id'],
            where: { primary_discipline_id: { in: disciplineIds } },
            _count: { _all: true },
          })
        : [];
      const countMap = new Map(
        counts.map((c) => [c.primary_discipline_id, c._count._all]),
      );

      return sessions.map((s) =>
        toSessionResponse(s, countMap.get(s.discipline_id) ?? 0),
      );
    } catch (err) {
      this.logger.error('DB error while fetching sports sessions', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * POST /sports-admin/sessions
   *
   * Error cases:
   *  404 DISCIPLINE_NOT_FOUND – discipline_id does not exist
   */
  async create(dto: CreateSessionDto) {
    await this.assertDisciplineExists(dto.discipline_id);

    try {
      const session = await this.prisma.sports_training_sessions.create({
        data: {
          discipline_id: dto.discipline_id,
          facility_id: dto.facility_id,
          coach_faculty_id: dto.coach_faculty_id,
          session_date: dateOnlyToDate(dto.session_date),
          start_time: dto.start_time
            ? timeStringToDate(dto.start_time)
            : undefined,
          end_time: dto.end_time ? timeStringToDate(dto.end_time) : undefined,
        },
        include: SESSION_INCLUDE,
      });
      const athleteCount = await this.countAthletes(session.discipline_id);
      return toSessionResponse(session, athleteCount);
    } catch (err) {
      this.logger.error('DB error while creating sports session', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * GET /sports-admin/sessions/:id
   *
   * Error cases:
   *  404 SESSION_NOT_FOUND – no session with the given id
   */
  async findOne(id: number) {
    const session = await this.findSessionById(id);
    return this.toDetailResponse(session);
  }

  /**
   * PATCH /sports-admin/sessions/:id
   *
   * Error cases:
   *  404 SESSION_NOT_FOUND – no session with the given id
   */
  async update(id: number, dto: UpdateSessionDto) {
    await this.findSessionById(id);

    try {
      const updated = await this.prisma.sports_training_sessions.update({
        where: { id },
        data: {
          facility_id: dto.facility_id,
          coach_faculty_id: dto.coach_faculty_id,
          session_date: dto.session_date
            ? dateOnlyToDate(dto.session_date)
            : undefined,
          start_time: dto.start_time
            ? timeStringToDate(dto.start_time)
            : undefined,
          end_time: dto.end_time ? timeStringToDate(dto.end_time) : undefined,
          status: dto.status,
        },
        include: SESSION_INCLUDE,
      });
      const athleteCount = await this.countAthletes(updated.discipline_id);
      return toSessionResponse(updated, athleteCount);
    } catch (err) {
      this.logger.error('DB error while updating sports session', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * DELETE /sports-admin/sessions/:id
   *
   * Error cases:
   *  404 SESSION_NOT_FOUND – no session with the given id
   *
   * sports_session_attendance.session_id cascades on delete (schema.prisma),
   * so no manual cleanup of attendance rows is needed here.
   */
  async remove(id: number) {
    await this.findSessionById(id);

    try {
      await this.prisma.sports_training_sessions.delete({ where: { id } });
      return { message: 'Session deleted successfully' };
    } catch (err) {
      this.logger.error('DB error while deleting sports session', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * PUT /sports-admin/sessions/:id/attendance
   *
   * Error cases:
   *  404 SESSION_NOT_FOUND – no session with the given id
   */
  async markAttendance(id: number, dto: MarkAttendanceDto, userId: number) {
    await this.findSessionById(id);
    await this.upsertAttendance(id, dto.marks, userId);

    const refreshed = await this.findSessionById(id);
    return this.toDetailResponse(refreshed);
  }

  /**
   * POST /sports-admin/sessions/:id/mark-all-present
   *
   * Shortcut that marks every athlete in the session's discipline present,
   * reusing the same upsert + status='done' logic as markAttendance.
   *
   * Error cases:
   *  404 SESSION_NOT_FOUND – no session with the given id
   */
  async markAllPresent(id: number, userId: number) {
    const session = await this.findSessionById(id);

    let athletes: { student_id: number }[];
    try {
      athletes = await this.prisma.sports_athlete_profiles.findMany({
        where: { primary_discipline_id: session.discipline_id },
        select: { student_id: true },
      });
    } catch (err) {
      this.logger.error(
        'DB error while fetching athletes for mark-all-present',
        err,
      );
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    const marks: MarkAttendanceEntryDto[] = athletes.map((a) => ({
      student_id: a.student_id,
      status: 'present',
    }));

    await this.upsertAttendance(id, marks, userId);

    const refreshed = await this.findSessionById(id);
    return this.toDetailResponse(refreshed);
  }

  /**
   * GET /sports-admin/sessions/attendance-summary?discipline_id=
   *
   * One row per discipline (optionally filtered to a single discipline_id):
   * sessions_this_week (trailing 7 days inclusive of today), athlete_count,
   * and attendance_pct over that same trailing-7-day window.
   */
  async attendanceSummary(dto: AttendanceSummaryQueryDto) {
    const today = todayDateOnly();
    const weekStart = new Date(today);
    weekStart.setUTCDate(weekStart.getUTCDate() - 6);

    const disciplineWhere: Prisma.sports_disciplinesWhereInput = {};
    if (dto.discipline_id) disciplineWhere.id = dto.discipline_id;

    try {
      const disciplines = await this.prisma.sports_disciplines.findMany({
        where: disciplineWhere,
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });

      if (disciplines.length === 0) return [];

      const disciplineIds = disciplines.map((d) => d.id);

      // Read-only aggregations with no cross-consistency requirement — Promise.all
      // (rather than $transaction) also avoids a Prisma/TS tuple-inference quirk
      // where groupBy()'s _count shape gets widened when passed inside a
      // $transaction([...]) array literal.
      const [sessionCounts, athleteCounts, attendanceRows] = await Promise.all([
        this.prisma.sports_training_sessions.groupBy({
          by: ['discipline_id'],
          where: {
            discipline_id: { in: disciplineIds },
            session_date: { gte: weekStart, lte: today },
          },
          _count: { _all: true },
        }),
        this.prisma.sports_athlete_profiles.groupBy({
          by: ['primary_discipline_id'],
          where: { primary_discipline_id: { in: disciplineIds } },
          _count: { _all: true },
        }),
        this.prisma.sports_session_attendance.findMany({
          where: {
            sports_training_sessions: {
              discipline_id: { in: disciplineIds },
              session_date: { gte: weekStart, lte: today },
            },
          },
          select: {
            status: true,
            sports_training_sessions: { select: { discipline_id: true } },
          },
        }),
      ]);

      const sessionCountMap = new Map(
        sessionCounts.map((s) => [s.discipline_id, s._count._all]),
      );
      const athleteCountMap = new Map(
        athleteCounts.map((a) => [a.primary_discipline_id, a._count._all]),
      );

      const attendanceStatsMap = new Map<
        number,
        { present: number; total: number }
      >();
      for (const row of attendanceRows) {
        const disciplineId = row.sports_training_sessions.discipline_id;
        const stats = attendanceStatsMap.get(disciplineId) ?? {
          present: 0,
          total: 0,
        };
        stats.total += 1;
        if (row.status === 'present') stats.present += 1;
        attendanceStatsMap.set(disciplineId, stats);
      }

      return disciplines.map((d) => {
        const stats = attendanceStatsMap.get(d.id);
        return {
          discipline: { id: d.id, name: d.name },
          sessions_this_week: sessionCountMap.get(d.id) ?? 0,
          athlete_count: athleteCountMap.get(d.id) ?? 0,
          attendance_pct:
            stats && stats.total > 0
              ? Math.round((stats.present / stats.total) * 100)
              : 0,
        };
      });
    } catch (err) {
      this.logger.error(
        'DB error while building sports attendance summary',
        err,
      );
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /** Upserts every mark into sports_session_attendance, then flips the session to 'done' — all in one transaction. */
  private async upsertAttendance(
    sessionId: number,
    marks: MarkAttendanceEntryDto[],
    userId: number,
  ) {
    try {
      await this.prisma.$transaction([
        ...marks.map((mark) =>
          this.prisma.sports_session_attendance.upsert({
            where: {
              session_id_student_id: {
                session_id: sessionId,
                student_id: mark.student_id,
              },
            },
            create: {
              session_id: sessionId,
              student_id: mark.student_id,
              status: mark.status,
              marked_by_user_id: userId,
            },
            update: {
              status: mark.status,
              marked_by_user_id: userId,
            },
          }),
        ),
        this.prisma.sports_training_sessions.update({
          where: { id: sessionId },
          data: { status: 'done' },
        }),
      ]);
    } catch (err) {
      this.logger.error(
        'DB error while marking sports session attendance',
        err,
      );
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /** Builds the list-shape fields plus the discipline roster (left-joined against attendance for this session). */
  private async toDetailResponse(session: SessionWithRelations) {
    try {
      const [athletes, attendance] = await this.prisma.$transaction([
        this.prisma.sports_athlete_profiles.findMany({
          where: { primary_discipline_id: session.discipline_id },
          select: { students: { include: STUDENT_DISPLAY_INCLUDE } },
        }),
        this.prisma.sports_session_attendance.findMany({
          where: { session_id: session.id },
          select: { student_id: true, status: true },
        }),
      ]);

      const statusMap = new Map(
        attendance.map((a) => [a.student_id, a.status]),
      );
      const roster = athletes.map(({ students: student }) => ({
        student_id: student.id,
        name: resolveStudentName(student),
        meta: studentAcademicMeta(student),
        status: statusMap.get(student.id) ?? null,
      }));

      return { ...toSessionResponse(session, athletes.length), roster };
    } catch (err) {
      this.logger.error('DB error while building sports session detail', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async countAthletes(disciplineId: number): Promise<number> {
    try {
      return await this.prisma.sports_athlete_profiles.count({
        where: { primary_discipline_id: disciplineId },
      });
    } catch (err) {
      this.logger.error('DB error while counting athletes', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async assertDisciplineExists(id: number) {
    let discipline: { id: number } | null;
    try {
      discipline = await this.prisma.sports_disciplines.findUnique({
        where: { id },
        select: { id: true },
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

  private async findSessionById(id: number): Promise<SessionWithRelations> {
    let session: SessionWithRelations | null;
    try {
      session = await this.prisma.sports_training_sessions.findUnique({
        where: { id },
        include: SESSION_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error during sports session lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    if (!session) {
      throw new NotFoundException({
        message: 'Session not found',
        errorCode: 'SESSION_NOT_FOUND',
      });
    }
    return session;
  }
}
