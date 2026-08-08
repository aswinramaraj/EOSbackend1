import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { CreateTimetableDto } from './dto/create-timetable.dto';
import { UpdateTimetableDto } from './dto/update-timetable.dto';
import { ListTimetableQueryDto } from './dto/list-timetable-query.dto';
import { GetMyTimetableQueryDto } from './dto/get-my-timetable-query.dto';

function prismaErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
}

/**
 * Structural type covering both the main PrismaService and the `tx` client
 * Prisma hands into an interactive $transaction callback — the conflict
 * checks below run under either, depending on whether they're called inside
 * the advisory-lock-guarded transaction.
 */
type TimetableConflictClient = {
  timetable_slots: {
    findFirst: PrismaService['timetable_slots']['findFirst'];
  };
};

function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function timeStringToDate(time: string): Date {
  const normalized = time.length === 5 ? `${time}:00` : time;
  return new Date(`1970-01-01T${normalized}.000Z`);
}

const TIMETABLE_SELECT = {
  id: true,
  day_of_week: true,
  period_number: true,
  start_time: true,
  end_time: true,
  academic_year: true,
  semester: true,
  classes: {
    select: {
      id: true,
      section: true,
      departments: { select: { id: true, name: true, code: true } },
    },
  },
  subjects: { select: { id: true, name: true, subject_code: true } },
  faculty: {
    select: { id: true, first_name: true, last_name: true, designation: true },
  },
} as const;

interface TimetableRow {
  id: number;
  day_of_week: number;
  period_number: number;
  start_time: Date;
  end_time: Date;
  academic_year: string;
  semester: number;
  classes: {
    id: number;
    section: string;
    departments: { id: number; name: string; code: string };
  };
  subjects: { id: number; name: string; subject_code: string };
  faculty: {
    id: number;
    first_name: string;
    last_name: string;
    designation: string;
  };
}

const MY_TIMETABLE_SLOT_SELECT = {
  day_of_week: true,
  period_number: true,
  start_time: true,
  end_time: true,
  subjects: { select: { id: true, name: true, subject_code: true } },
  faculty: { select: { id: true, first_name: true, last_name: true } },
} as const;

interface MyTimetableSlotRow {
  day_of_week: number;
  period_number: number;
  start_time: Date;
  end_time: Date;
  subjects: { id: number; name: string; subject_code: string };
  faculty: { id: number; first_name: string; last_name: string };
}

const FACULTY_ROSTER_SLOT_SELECT = {
  day_of_week: true,
  period_number: true,
  start_time: true,
  end_time: true,
  academic_year: true,
  semester: true,
  subjects: { select: { id: true, name: true, subject_code: true } },
  classes: {
    select: {
      id: true,
      section: true,
      departments: { select: { id: true, name: true, code: true } },
    },
  },
} as const;

interface FacultyRosterSlotRow {
  day_of_week: number;
  period_number: number;
  start_time: Date;
  end_time: Date;
  academic_year: string;
  semester: number;
  subjects: { id: number; name: string; subject_code: string };
  classes: {
    id: number;
    section: string;
    departments: { id: number; name: string; code: string };
  };
}

interface PeriodTemplateEntry {
  day_of_week: number;
  period_number: number;
  start_time: Date;
  end_time: Date;
}

function toRosterSlotResponse(slot: FacultyRosterSlotRow) {
  return {
    period_number: slot.period_number,
    start_time: formatHHMM(slot.start_time),
    end_time: formatHHMM(slot.end_time),
    kind: 'class' as const,
    subject: slot.subjects,
    class: {
      id: slot.classes.id,
      section: slot.classes.section,
      department: slot.classes.departments,
    },
  };
}

function formatHHMM(time: Date): string {
  return time.toISOString().slice(11, 16);
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toMySlotResponse(slot: MyTimetableSlotRow) {
  return {
    period_number: slot.period_number,
    start_time: formatHHMM(slot.start_time),
    end_time: formatHHMM(slot.end_time),
    subject: slot.subjects,
    faculty: {
      id: slot.faculty.id,
      name: `${slot.faculty.first_name} ${slot.faculty.last_name}`,
    },
  };
}

const TODAY_SLOT_SELECT = {
  id: true,
  period_number: true,
  start_time: true,
  end_time: true,
  subject_id: true,
  class_id: true,
  subjects: { select: { name: true } },
  classes: {
    select: { section: true, departments: { select: { name: true } } },
  },
} as const;

interface TodaySlotRow {
  id: number;
  period_number: number;
  start_time: Date;
  end_time: Date;
  subject_id: number;
  class_id: number;
  subjects: { name: string };
  classes: { section: string; departments: { name: string } };
}

function toTodaySlotResponse(slot: TodaySlotRow) {
  return {
    id: slot.id,
    period_number: slot.period_number,
    start_time: formatHHMM(slot.start_time),
    end_time: formatHHMM(slot.end_time),
    subject_id: slot.subject_id,
    subject_name: slot.subjects.name,
    class_id: slot.class_id,
    class_section: slot.classes.section,
    department_name: slot.classes.departments.name,
  };
}

function toResponse(slot: TimetableRow) {
  return {
    id: slot.id,
    day_of_week: slot.day_of_week,
    period_number: slot.period_number,
    start_time: slot.start_time,
    end_time: slot.end_time,
    academic_year: slot.academic_year,
    semester: slot.semester,
    class: {
      id: slot.classes.id,
      section: slot.classes.section,
      department: slot.classes.departments,
    },
    subject: slot.subjects,
    faculty: slot.faculty,
  };
}

@Injectable()
export class TimetableService {
  private readonly logger = new Logger(TimetableService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** POST /timetable (HoD only). */
  async create(dto: CreateTimetableDto) {
    this.assertTimeOrder(dto.start_time, dto.end_time);

    await this.assertForeignKeysExist(
      dto.faculty_id,
      dto.subject_id,
      dto.class_id,
    );
    await this.assertFacultyMapped(
      dto.faculty_id,
      dto.subject_id,
      dto.class_id,
      dto.academic_year,
    );

    const slot = await this.prisma.$transaction(async (tx) => {
      // timetable_slots has no @@unique constraint at all, so nothing at the
      // DB level stops two concurrent requests from both passing the
      // conflict checks below and both inserting — a class double-booking,
      // a faculty double-booking, or both. An advisory lock scoped to this
      // exact (day_of_week, period_number, academic_year) scheduling slot
      // serializes every create/update touching it, so the second request's
      // own checks correctly see what the first one just committed.
      const lockKey = `timetable:${dto.day_of_week}:${dto.period_number}:${dto.academic_year}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      await this.assertNoClassConflict(
        tx,
        dto.class_id,
        dto.day_of_week,
        dto.period_number,
        dto.academic_year,
        dto.semester,
      );
      await this.assertNoFacultyConflict(
        tx,
        dto.faculty_id,
        dto.day_of_week,
        dto.period_number,
        dto.academic_year,
      );

      return tx.timetable_slots.create({
        data: {
          class_id: dto.class_id,
          subject_id: dto.subject_id,
          faculty_id: dto.faculty_id,
          day_of_week: dto.day_of_week,
          period_number: dto.period_number,
          start_time: timeStringToDate(dto.start_time),
          end_time: timeStringToDate(dto.end_time),
          academic_year: dto.academic_year,
          semester: dto.semester,
        },
        select: TIMETABLE_SELECT,
      });
    });

    this.logger.log(`Timetable slot created: id=${slot.id}`);
    return toResponse(slot);
  }

  /** GET /timetable (Admin/HoD/Faculty/Student) — filtered, paginated. */
  async findAll(query: ListTimetableQueryDto) {
    const where = {
      class_id: query.class_id,
      faculty_id: query.faculty_id,
      subject_id: query.subject_id,
      semester: query.semester,
      academic_year: query.academic_year,
      day_of_week: query.day_of_week,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.timetable_slots.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: [{ day_of_week: 'asc' }, { period_number: 'asc' }],
        select: TIMETABLE_SELECT,
      }),
      this.prisma.timetable_slots.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  /** GET /timetable/:id (Admin/HoD/Faculty/Student). */
  async findOne(id: number) {
    const slot = await this.prisma.timetable_slots.findUnique({
      where: { id },
      select: TIMETABLE_SELECT,
    });

    if (!slot) {
      throw new NotFoundException('Timetable entry not found');
    }

    return toResponse(slot);
  }

  /** PATCH /timetable/:id (HoD only). */
  async update(id: number, dto: UpdateTimetableDto) {
    if (!dto || Object.keys(dto).length === 0) {
      throw new BadRequestException('No fields provided to update');
    }

    const existing = await this.prisma.timetable_slots.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Timetable entry not found');
    }

    const effective = {
      class_id: dto.class_id ?? existing.class_id,
      subject_id: dto.subject_id ?? existing.subject_id,
      faculty_id: dto.faculty_id ?? existing.faculty_id,
      day_of_week: dto.day_of_week ?? existing.day_of_week,
      period_number: dto.period_number ?? existing.period_number,
      academic_year: dto.academic_year ?? existing.academic_year,
      semester: dto.semester ?? existing.semester,
    };

    const startTime =
      dto.start_time ?? this.dateToTimeString(existing.start_time);
    const endTime = dto.end_time ?? this.dateToTimeString(existing.end_time);
    this.assertTimeOrder(startTime, endTime);

    await this.assertForeignKeysExist(
      effective.faculty_id,
      effective.subject_id,
      effective.class_id,
    );
    await this.assertFacultyMapped(
      effective.faculty_id,
      effective.subject_id,
      effective.class_id,
      effective.academic_year,
    );

    try {
      const slot = await this.prisma.$transaction(async (tx) => {
        // Same race as create() — see there for why this lock exists.
        // Scoped to the EFFECTIVE (post-merge) slot only: the row being
        // vacated (if day/period/year is changing) doesn't need protection,
        // since this same update is what's vacating it.
        const lockKey = `timetable:${effective.day_of_week}:${effective.period_number}:${effective.academic_year}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

        await this.assertNoClassConflict(
          tx,
          effective.class_id,
          effective.day_of_week,
          effective.period_number,
          effective.academic_year,
          effective.semester,
          id,
        );
        await this.assertNoFacultyConflict(
          tx,
          effective.faculty_id,
          effective.day_of_week,
          effective.period_number,
          effective.academic_year,
          id,
        );

        return tx.timetable_slots.update({
          where: { id },
          data: {
            ...effective,
            start_time: timeStringToDate(startTime),
            end_time: timeStringToDate(endTime),
          },
          select: TIMETABLE_SELECT,
        });
      });

      return toResponse(slot);
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2025') {
        throw new NotFoundException('Timetable entry not found');
      }
      throw err;
    }
  }

  /**
   * GET /me/timetable (Student only).
   *
   * Resolves the caller's own class_id from the JWT — never client-supplied,
   * so a student cannot request another student's or another class's
   * timetable. Scoped to the class's current_semester when set (classes has
   * no separate "current academic_year" column, so academic_year is not
   * filtered here — every academic_year's rows for that semester/class are
   * returned, since the schema has no flag marking which year is "current").
   * `query.week` is accepted but unused — see GetMyTimetableQueryDto.
   */
  async findForStudent(userId: number, query: GetMyTimetableQueryDto) {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
    });
    if (!student) {
      throw new NotFoundException(
        'Student profile not found for the authenticated user',
      );
    }

    return this.computeTimetableForStudent(student.class_id, query);
  }

  /**
   * Same computation as findForStudent, but for a student chosen by id
   * rather than resolved from the caller's own JWT - used by ParentsService
   * once it has verified (via parent_student_mapping) that the caller is
   * actually this student's parent.
   */
  async getTimetableForStudentId(
    studentId: number,
    query: GetMyTimetableQueryDto,
  ) {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
    });
    if (!student) {
      throw new NotFoundException('Student not found');
    }

    return this.computeTimetableForStudent(student.class_id, query);
  }

  private async computeTimetableForStudent(
    classId: number | null,
    query: GetMyTimetableQueryDto,
  ) {
    if (classId === null) {
      throw new UnprocessableEntityException({
        message: 'You have not been assigned to a class yet',
        errorCode: 'CLASS_NOT_ASSIGNED',
      });
    }

    const klass = await this.prisma.classes.findUnique({
      where: { id: classId },
    });

    const rows = await this.prisma.timetable_slots.findMany({
      where: {
        class_id: classId,
        ...(klass?.current_semester != null && {
          semester: klass.current_semester,
        }),
        ...(query.day !== undefined && { day_of_week: query.day }),
      },
      orderBy: [{ day_of_week: 'asc' }, { period_number: 'asc' }],
      select: MY_TIMETABLE_SLOT_SELECT,
    });

    if (query.day !== undefined) {
      return {
        day_of_week: query.day,
        slots: rows.map(toMySlotResponse),
      };
    }

    const days = new Map<number, ReturnType<typeof toMySlotResponse>[]>();
    for (const row of rows) {
      const daySlots = days.get(row.day_of_week) ?? [];
      daySlots.push(toMySlotResponse(row));
      days.set(row.day_of_week, daySlots);
    }

    return {
      days: Array.from(days.entries()).map(([day_of_week, slots]) => ({
        day_of_week,
        slots,
      })),
    };
  }

  /**
   * GET /me/classes/today (Faculty only).
   *
   * Resolves the caller's own faculty_id from the JWT — never client-supplied.
   * "Today" is resolved server-side via JS Date.getDay() (0=Sunday..6=Saturday),
   * which lines up with this module's day_of_week convention (1=Monday..6=
   * Saturday) for every value that convention actually stores — a Sunday (0)
   * simply matches no rows, since no timetable_slots row can have
   * day_of_week 0. Not scoped to academic_year/semester — the doc doesn't
   * specify how "currently active" is resolved for a class the caller
   * teaches (unlike the student view, which has classes.current_semester to
   * anchor on), so every matching row for today is returned regardless of year.
   */
  async findTodayForFaculty(userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    const dayOfWeek = new Date().getDay();

    const rows = await this.prisma.timetable_slots.findMany({
      where: { faculty_id: faculty.id, day_of_week: dayOfWeek },
      orderBy: { period_number: 'asc' },
      select: TODAY_SLOT_SELECT,
    });

    return rows.map(toTodaySlotResponse);
  }

  /**
   * GET /me/current-semester (Faculty/HoD).
   *
   * faculty_subject_class_mapping has no semester column of its own (only
   * academic_year) and a faculty member can teach several class/section
   * combos at once, unlike the single-section student view this mirrors -
   * so this returns one row per (subject, class) combo for the faculty's
   * most recent academic_year, each annotated with that class's own
   * classes.current_semester, plus real per-combo counts (hours/week from
   * timetable_slots, tasks from assignments, materials from lms_notes).
   */
  async getCurrentSemesterForFaculty(userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const latest = await this.prisma.faculty_subject_class_mapping.findFirst({
      where: { faculty_id: faculty.id },
      orderBy: { academic_year: 'desc' },
      select: { academic_year: true },
    });
    if (!latest) {
      return { academic_year: null, subjects: [] };
    }
    const academicYear = latest.academic_year;

    const mappings = await this.prisma.faculty_subject_class_mapping.findMany({
      where: { faculty_id: faculty.id, academic_year: academicYear },
      select: {
        subject_id: true,
        class_id: true,
        subjects: { select: { name: true, subject_code: true } },
        classes: { select: { section: true, current_semester: true } },
      },
      orderBy: [{ class_id: 'asc' }, { subject_id: 'asc' }],
    });

    const subjects = await Promise.all(
      mappings.map(async (mapping) => {
        const [hoursPerWeek, tasks, materials] = await Promise.all([
          this.prisma.timetable_slots.count({
            where: {
              faculty_id: faculty.id,
              subject_id: mapping.subject_id,
              class_id: mapping.class_id,
              academic_year: academicYear,
            },
          }),
          this.prisma.assignments.count({
            where: {
              faculty_id: faculty.id,
              subject_id: mapping.subject_id,
              class_id: mapping.class_id,
              academic_year: academicYear,
            },
          }),
          this.prisma.lms_notes.count({
            where: {
              faculty_id: faculty.id,
              subject_id: mapping.subject_id,
              class_id: mapping.class_id,
            },
          }),
        ]);

        return {
          subject_id: mapping.subject_id,
          subject_code: mapping.subjects.subject_code,
          subject_name: mapping.subjects.name,
          class_id: mapping.class_id,
          section: mapping.classes.section,
          semester: mapping.classes.current_semester,
          hours_per_week: hoursPerWeek,
          tasks,
          materials,
        };
      }),
    );

    return { academic_year: academicYear, subjects };
  }

  /**
   * GET /me/faculty-timetable (Faculty/HoD).
   *
   * The full-week counterpart to findForStudent(), scoped by faculty_id
   * instead of class_id, reusing the same MY_TIMETABLE_SLOT_SELECT/
   * toMySlotResponse shape so the response is drop-in compatible with what
   * the shared TimetableScreen already renders for students. Not scoped by
   * academic_year/semester - same reasoning as findTodayForFaculty (a
   * faculty member can teach several classes/semesters at once, unlike a
   * student anchored on one classes.current_semester).
   */
  async findFullWeekForFaculty(userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const rows = await this.prisma.timetable_slots.findMany({
      where: { faculty_id: faculty.id },
      orderBy: [{ day_of_week: 'asc' }, { period_number: 'asc' }],
      select: MY_TIMETABLE_SLOT_SELECT,
    });

    const days = new Map<number, ReturnType<typeof toMySlotResponse>[]>();
    for (const row of rows) {
      const daySlots = days.get(row.day_of_week) ?? [];
      daySlots.push(toMySlotResponse(row));
      days.set(row.day_of_week, daySlots);
    }

    return {
      days: Array.from(days.entries()).map(([day_of_week, slots]) => ({
        day_of_week,
        slots,
      })),
    };
  }

  /**
   * GET /me/faculty-academic-calendar (Faculty/HoD).
   *
   * The student version (me-academic-calendar.service.ts) anchors on one
   * class -> one (batch_id, semester) -> one academic_calendars row
   * (unique). A faculty member has no single class, and can teach into
   * several distinct (batch_id, semester) pairs at once - so this resolves
   * every distinct pair from the faculty's latest-academic_year mapping
   * rows (same "latest academic_year" tiebreak as
   * getCurrentSemesterForFaculty), fetches each pair's academic_calendars
   * row, and merges their calendar_events into one deduped list (by
   * event_date+title, since the same institution-wide holiday can appear on
   * more than one batch's calendar). `semester` is only a single number
   * when every resolved calendar shares the same one - otherwise null,
   * which the existing frontend header already renders as a plain "Academic
   * calendar" (no fabricated single-semester label when several are real).
   * start_date/end_date become the union range (earliest start, latest end)
   * across every resolved calendar.
   */
  async getMergedAcademicCalendarForFaculty(userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    const empty = { semester: null, start_date: null, end_date: null, events: [] };

    const latest = await this.prisma.faculty_subject_class_mapping.findFirst({
      where: { faculty_id: faculty.id },
      orderBy: { academic_year: 'desc' },
      select: { academic_year: true },
    });
    if (!latest) {
      return empty;
    }

    const mappings = await this.prisma.faculty_subject_class_mapping.findMany({
      where: { faculty_id: faculty.id, academic_year: latest.academic_year },
      select: {
        classes: { select: { batch_id: true, current_semester: true } },
      },
    });

    const pairs = new Map<string, { batch_id: number; semester: number }>();
    for (const mapping of mappings) {
      if (mapping.classes.current_semester === null) continue;
      const key = `${mapping.classes.batch_id}:${mapping.classes.current_semester}`;
      pairs.set(key, {
        batch_id: mapping.classes.batch_id,
        semester: mapping.classes.current_semester,
      });
    }
    if (pairs.size === 0) {
      return empty;
    }

    const calendars = await Promise.all(
      Array.from(pairs.values()).map((pair) =>
        this.prisma.academic_calendars.findUnique({
          where: {
            batch_id_semester: { batch_id: pair.batch_id, semester: pair.semester },
          },
          select: {
            semester: true,
            start_date: true,
            end_date: true,
            calendar_events: {
              orderBy: { event_date: 'asc' },
              select: {
                id: true,
                event_date: true,
                event_type: true,
                title: true,
                description: true,
              },
            },
          },
        }),
      ),
    );

    const found = calendars.filter(
      (calendar): calendar is NonNullable<typeof calendar> => calendar !== null,
    );
    if (found.length === 0) {
      return empty;
    }

    const distinctSemesters = new Set(found.map((c) => c.semester));
    const semester = distinctSemesters.size === 1 ? found[0].semester : null;

    const startDates = found.map((c) => c.start_date.getTime());
    const endDates = found.map((c) => c.end_date.getTime());

    const eventsByKey = new Map<
      string,
      { id: number; event_date: string; event_type: string; title: string; description: string | null }
    >();
    for (const calendar of found) {
      for (const event of calendar.calendar_events) {
        const eventDate = toDateOnly(event.event_date);
        const key = `${eventDate}:${event.title}`;
        if (!eventsByKey.has(key)) {
          eventsByKey.set(key, {
            id: event.id,
            event_date: eventDate,
            event_type: event.event_type,
            title: event.title,
            description: event.description,
          });
        }
      }
    }

    return {
      semester,
      start_date: toDateOnly(new Date(Math.min(...startDates))),
      end_date: toDateOnly(new Date(Math.max(...endDates))),
      events: Array.from(eventsByKey.values()).sort((a, b) =>
        a.event_date.localeCompare(b.event_date),
      ),
    };
  }

  /**
   * GET /me/academic-calendar-institution (HoD/HR Payroll).
   *
   * HR Payroll (and HoD, browsing outside their own department) has no
   * single "own" batch/semester to scope a calendar to, so - unlike
   * getMergedAcademicCalendarForFaculty(), which merges only the calendars
   * the caller personally teaches into - this merges every
   * academic_calendars row institution-wide into one deduped events list.
   * Same {semester, start_date, end_date, events} shape, so it's a drop-in
   * for the shared AcademicCalendarScreen. `semester` is realistically
   * always null here (more than one semester's calendar exists at once
   * across a whole institution), same "null when not uniform" convention as
   * the faculty merge.
   */
  async getInstitutionAcademicCalendar() {
    const empty = { semester: null, start_date: null, end_date: null, events: [] };

    const calendars = await this.prisma.academic_calendars.findMany({
      select: {
        semester: true,
        start_date: true,
        end_date: true,
        calendar_events: {
          orderBy: { event_date: 'asc' },
          select: {
            id: true,
            event_date: true,
            event_type: true,
            title: true,
            description: true,
          },
        },
      },
    });
    if (calendars.length === 0) {
      return empty;
    }

    const distinctSemesters = new Set(calendars.map((c) => c.semester));
    const semester = distinctSemesters.size === 1 ? calendars[0].semester : null;

    const startDates = calendars.map((c) => c.start_date.getTime());
    const endDates = calendars.map((c) => c.end_date.getTime());

    const eventsByKey = new Map<
      string,
      { id: number; event_date: string; event_type: string; title: string; description: string | null }
    >();
    for (const calendar of calendars) {
      for (const event of calendar.calendar_events) {
        const eventDate = toDateOnly(event.event_date);
        const key = `${eventDate}:${event.title}`;
        if (!eventsByKey.has(key)) {
          eventsByKey.set(key, {
            id: event.id,
            event_date: eventDate,
            event_type: event.event_type,
            title: event.title,
            description: event.description,
          });
        }
      }
    }

    return {
      semester,
      start_date: toDateOnly(new Date(Math.min(...startDates))),
      end_date: toDateOnly(new Date(Math.max(...endDates))),
      events: Array.from(eventsByKey.values()).sort((a, b) =>
        a.event_date.localeCompare(b.event_date),
      ),
    };
  }

  /**
   * GET /me/timetable-departments (HoD/HR Payroll).
   *
   * One row per department, with its classes nested - backs the department
   * picker for the HR "faculty timetable" roster screen (which then picks a
   * faculty member - see getFullWeekForFacultyId()). classes has no "year"
   * label of its own (only current_semester), so each class is returned as
   * section + current_semester rather than a fabricated roman-numeral year
   * (same convention as the class-label helpers already used elsewhere in
   * the app for real, non-mock data).
   */
  async listDepartmentsWithClasses() {
    return this.prisma.departments.findMany({
      select: {
        id: true,
        name: true,
        code: true,
        classes: {
          select: { id: true, section: true, current_semester: true },
          orderBy: { section: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * GET /me/timetable-departments/:departmentId/faculty (HoD/HR Payroll).
   *
   * "Every faculty in the department" - resolved from the faculty's own
   * home department_id (not from which classes they happen to teach, since
   * a faculty can teach outside their own department per
   * faculty_subject_class_mapping and the ask is about department
   * membership, not teaching assignment).
   */
  async listFacultyInDepartment(departmentId: number) {
    const department = await this.prisma.departments.findUnique({
      where: { id: departmentId },
    });
    if (!department) {
      throw new NotFoundException('Department not found');
    }

    return this.prisma.faculty.findMany({
      where: { department_id: departmentId, status: 'active' },
      select: { id: true, first_name: true, last_name: true, designation: true },
      orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
    });
  }

  /**
   * GET /me/faculty-timetable-roster/:facultyId (HoD/HR Payroll).
   *
   * Full week for a faculty member chosen by id (not the caller) - the
   * multi-faculty counterpart to findFullWeekForFaculty(). Each day's
   * periods are built from the institution-wide period template (the
   * distinct (day_of_week, period_number, start_time, end_time) combos that
   * exist anywhere in timetable_slots - verified consistent per period
   * number across every class), so a period this faculty has no row for on
   * a day that otherwise runs classes is reported as a real, derived "free"
   * period rather than simply omitted - not fabricated, since it's absence
   * relative to a real institution-wide schedule, not an invented slot.
   * Each real period also carries its class (section + department), since
   * unlike the self-view a faculty being looked up here can teach several
   * different classes across the week.
   */
  async getFullWeekForFacultyId(facultyId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { id: facultyId },
      select: { id: true, first_name: true, last_name: true, designation: true },
    });
    if (!faculty) {
      throw new NotFoundException('Faculty not found');
    }

    const [slots, template] = await Promise.all([
      this.prisma.timetable_slots.findMany({
        where: { faculty_id: facultyId },
        orderBy: [{ day_of_week: 'asc' }, { period_number: 'asc' }],
        select: FACULTY_ROSTER_SLOT_SELECT,
      }),
      this.getPeriodTemplate(),
    ]);

    const slotsByDayPeriod = new Map<string, FacultyRosterSlotRow>();
    for (const slot of slots) {
      slotsByDayPeriod.set(`${slot.day_of_week}-${slot.period_number}`, slot);
    }

    const templateByDay = new Map<number, PeriodTemplateEntry[]>();
    for (const entry of template) {
      const list = templateByDay.get(entry.day_of_week) ?? [];
      list.push(entry);
      templateByDay.set(entry.day_of_week, list);
    }

    const days = [1, 2, 3, 4, 5, 6].map((dayOfWeek) => {
      const dayTemplate = templateByDay.get(dayOfWeek) ?? [];
      const periods = dayTemplate.map((entry) => {
        const real = slotsByDayPeriod.get(`${dayOfWeek}-${entry.period_number}`);
        if (real) return toRosterSlotResponse(real);
        return {
          period_number: entry.period_number,
          start_time: formatHHMM(entry.start_time),
          end_time: formatHHMM(entry.end_time),
          kind: 'free' as const,
        };
      });
      return { day_of_week: dayOfWeek, periods };
    });

    const distinctTerms = new Set(
      slots.map((slot) => `${slot.academic_year}:${slot.semester}`),
    );
    const uniformTerm =
      distinctTerms.size === 1 ? slots[0] : undefined;

    return {
      faculty,
      total_periods_per_week: slots.length,
      semester: uniformTerm?.semester ?? null,
      academic_year: uniformTerm?.academic_year ?? null,
      days,
    };
  }

  /**
   * The institution-wide "master schedule" of periods: every distinct
   * (day_of_week, period_number) combo that exists in timetable_slots
   * anywhere, with its start/end time. Used to derive "free" periods for
   * getFullWeekForFacultyId() - period start/end times are consistent for a
   * given period_number across every class, so any one row sharing that
   * combo is representative.
   */
  private async getPeriodTemplate() {
    return this.prisma.timetable_slots.findMany({
      distinct: ['day_of_week', 'period_number'],
      orderBy: [{ day_of_week: 'asc' }, { period_number: 'asc' }],
      select: {
        day_of_week: true,
        period_number: true,
        start_time: true,
        end_time: true,
      },
    });
  }

  /**
   * DELETE /timetable/:id (HoD only).
   * The schema has no soft-delete flag on this table, so this is a hard delete.
   */
  async remove(id: number) {
    try {
      await this.prisma.timetable_slots.delete({ where: { id } });
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2025') {
        throw new NotFoundException('Timetable entry not found');
      }
      throw err;
    }

    this.logger.log(`Timetable slot deleted: id=${id}`);
    return { id, deleted: true };
  }

  private async resolveFacultyByUserId(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }

  private dateToTimeString(time: Date): string {
    return time.toISOString().slice(11, 19);
  }

  private assertTimeOrder(startTime: string, endTime: string) {
    if (parseTimeToMinutes(endTime) <= parseTimeToMinutes(startTime)) {
      throw new BadRequestException('end_time must be after start_time');
    }
  }

  private async assertForeignKeysExist(
    facultyId: number,
    subjectId: number,
    classId: number,
  ) {
    const [faculty, subject, klass] = await Promise.all([
      this.prisma.faculty.findUnique({ where: { id: facultyId } }),
      this.prisma.subjects.findUnique({ where: { id: subjectId } }),
      this.prisma.classes.findUnique({ where: { id: classId } }),
    ]);

    if (!faculty) {
      throw new NotFoundException('Faculty not found');
    }
    if (!subject) {
      throw new NotFoundException('Subject not found');
    }
    if (!klass) {
      throw new NotFoundException('Class not found');
    }
  }

  /**
   * workflow.md: "HoD ... maps the faculty to the class who was assigned to
   * the subject" — a faculty must already be mapped (faculty_subject_class_mapping)
   * to a subject+class for a given academic_year before they can be scheduled.
   */
  private async assertFacultyMapped(
    facultyId: number,
    subjectId: number,
    classId: number,
    academicYear: string,
  ) {
    const mapping = await this.prisma.faculty_subject_class_mapping.findFirst({
      where: {
        faculty_id: facultyId,
        subject_id: subjectId,
        class_id: classId,
        academic_year: academicYear,
      },
    });

    if (!mapping) {
      throw new BadRequestException(
        'Faculty is not mapped to this subject and class for the given academic year',
      );
    }
  }

  /**
   * timetable_slots has NO @@unique constraint at all — this is an
   * application-level rule: a class cannot have two different subjects/faculty
   * in the same period on the same day within the same academic year+semester.
   * `client` is either the main PrismaService or the `tx` from the
   * advisory-lock-guarded transaction in create()/update() — see there for why.
   */
  private async assertNoClassConflict(
    client: TimetableConflictClient,
    classId: number,
    dayOfWeek: number,
    periodNumber: number,
    academicYear: string,
    semester: number,
    excludeId?: number,
  ) {
    const conflict = await client.timetable_slots.findFirst({
      where: {
        class_id: classId,
        day_of_week: dayOfWeek,
        period_number: periodNumber,
        academic_year: academicYear,
        semester,
        ...(excludeId !== undefined && { id: { not: excludeId } }),
      },
    });

    if (conflict) {
      throw new ConflictException(
        `Class already has a timetable entry for day ${dayOfWeek}, period ${periodNumber} (${academicYear}, semester ${semester})`,
      );
    }
  }

  /**
   * Not explicitly requested, but a faculty cannot teach two classes in the
   * same period — this prevents that impossible schedule.
   *
   * Deliberately NOT scoped by semester, unlike assertNoClassConflict: a
   * faculty is one physical person, and workflow.md itself says they "can be
   * assigned to multiple class of different batches" — which routinely means
   * different semester numbers within the same academic_year (e.g. teaching
   * a semester-7 class and a semester-3 class simultaneously). Filtering this
   * check by semester would let those two rows coexist even when they land
   * on the exact same day+period, producing an impossible schedule for that
   * one faculty. class_id conflicts don't have this problem since class_id
   * alone already pins one specific class.
   */
  private async assertNoFacultyConflict(
    client: TimetableConflictClient,
    facultyId: number,
    dayOfWeek: number,
    periodNumber: number,
    academicYear: string,
    excludeId?: number,
  ) {
    const conflict = await client.timetable_slots.findFirst({
      where: {
        faculty_id: facultyId,
        day_of_week: dayOfWeek,
        period_number: periodNumber,
        academic_year: academicYear,
        ...(excludeId !== undefined && { id: { not: excludeId } }),
      },
    });

    if (conflict) {
      throw new ConflictException(
        `Faculty already has another class scheduled for day ${dayOfWeek}, period ${periodNumber} (${academicYear})`,
      );
    }
  }
}
