import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { CreateInvigilationDto } from './dto/create-invigilation.dto';
import { UpdateInvigilationDto } from './dto/update-invigilation.dto';
import { FindInvigilationQueryDto } from './dto/find-invigilation-query.dto';
import { VenuesOverviewQueryDto } from './dto/venues-overview-query.dto';
import { AvailableFacultyQueryDto } from './dto/available-faculty-query.dto';

const FACULTY_SELECT = {
  id: true,
  prefix: true,
  first_name: true,
  last_name: true,
  designation: true,
  user_id: true,
  departments: { select: { id: true, code: true, name: true } },
} as const;

function facultyName(f: { prefix?: string | null; first_name: string; last_name: string }): string {
  return [f.prefix, f.first_name, f.last_name].filter(Boolean).join(' ');
}

function hms(d: Date): string {
  return d.toISOString().slice(11, 16);
}

// The institution's standard exam session windows — used as the fallback
// when the caller doesn't know the real per-hall timetable start/end yet
// (e.g. a hall with no seating/papers assigned so venues-overview has no
// real times for it). Real times, when known, always take priority.
const SESSION_WINDOW: Record<'FN' | 'AN', { start: string; end: string }> = {
  FN: { start: '09:30', end: '12:30' },
  AN: { start: '14:00', end: '17:00' },
};

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}

const HALL_PLAN_SELECT = {
  id: true,
  exam_id: true,
  exam_date: true,
  capacity: true,
  venues: { select: { id: true, name: true, location: true, capacity: true } },
};

@Injectable()
export class InvigilationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Throws if `facultyId` is on approved leave covering `dutyDate`, or has a class-timetable slot overlapping `window` on that day — the two checks behind "Conflicts with class timetable are checked on save." Duplicate-duty conflicts are handled separately (see create()/update()) since they need a more specific message. */
  private async assertFacultyAvailableForSession(
    facultyId: number,
    dutyDate: Date,
    window: { start: string; end: string },
  ) {
    const [leave, teachingSlots] = await Promise.all([
      this.prisma.faculty_leaves.findFirst({
        where: {
          faculty_id: facultyId,
          from_date: { lte: dutyDate },
          to_date: { gte: dutyDate },
          hod_approval_status: 'approved',
          hr_approval_status: 'approved',
        },
      }),
      this.prisma.timetable_slots.findMany({
        where: { faculty_id: facultyId, day_of_week: dutyDate.getUTCDay() },
        select: { start_time: true, end_time: true },
      }),
    ]);

    if (leave) {
      throw new ConflictException({ message: 'This faculty member is on approved leave on this date.', errorCode: 'FACULTY_ON_LEAVE' });
    }
    if (teachingSlots.some((t) => rangesOverlap(hms(t.start_time), hms(t.end_time), window.start, window.end))) {
      throw new ConflictException({ message: 'This faculty member has a class timetable clash at this date and session.', errorCode: 'FACULTY_TIMETABLE_CONFLICT' });
    }
  }

  /** Bulk version of the same two checks, plus existing-duty conflicts — everything that makes a faculty member unavailable for a (date, session), for listing/auto-pick use (getAvailableFaculty, autoAssign). */
  private async getIneligibleFacultyIds(dutyDate: Date, session: 'FN' | 'AN', window: { start: string; end: string }): Promise<Set<number>> {
    const [busy, onLeave, teaching] = await Promise.all([
      this.prisma.invigilation_duties.findMany({ where: { duty_date: dutyDate, session }, select: { faculty_id: true } }),
      this.prisma.faculty_leaves.findMany({
        where: { from_date: { lte: dutyDate }, to_date: { gte: dutyDate }, hod_approval_status: 'approved', hr_approval_status: 'approved' },
        select: { faculty_id: true },
      }),
      this.prisma.timetable_slots.findMany({ where: { day_of_week: dutyDate.getUTCDay() }, select: { faculty_id: true, start_time: true, end_time: true } }),
    ]);

    const ineligible = new Set<number>();
    for (const d of busy) ineligible.add(d.faculty_id);
    for (const l of onLeave) if (l.faculty_id != null) ineligible.add(l.faculty_id);
    for (const t of teaching) if (rangesOverlap(hms(t.start_time), hms(t.end_time), window.start, window.end)) ineligible.add(t.faculty_id);
    return ineligible;
  }

  /** GET /invigilation/available-faculty — faculty eligible for a (date, session), for the Assign duty faculty search: active, not already on a duty that slot, not on approved leave, and no class-timetable clash. Real hall times (start_time/end_time) are passed in when known; otherwise falls back to the standard FN/AN window. */
  async getAvailableFaculty(query: AvailableFacultyQueryDto) {
    const dutyDate = new Date(query.date);
    const window = {
      start: query.start_time ?? SESSION_WINDOW[query.session].start,
      end: query.end_time ?? SESSION_WINDOW[query.session].end,
    };
    const ineligible = await this.getIneligibleFacultyIds(dutyDate, query.session, window);

    const candidates = await this.prisma.faculty.findMany({
      where: {
        status: 'active',
        OR: query.search
          ? [
              { first_name: { contains: query.search, mode: 'insensitive' } },
              { last_name: { contains: query.search, mode: 'insensitive' } },
              { staff_code: { contains: query.search, mode: 'insensitive' } },
            ]
          : undefined,
      },
      select: { id: true, prefix: true, first_name: true, last_name: true, designation: true, staff_code: true, departments: { select: { code: true } } },
      orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
      take: 30,
    });

    return candidates
      .filter((f) => !ineligible.has(f.id))
      .map((f) => ({
        id: f.id,
        name: facultyName(f),
        staff_code: f.staff_code,
        designation: f.designation,
        department_code: f.departments?.code ?? null,
      }));
  }

  async create(dto: CreateInvigilationDto) {
    const exam = await this.prisma.exams.findUnique({
      where: { id: dto.exam_id },
    });
    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    const hallPlan = await this.prisma.hall_plans.findUnique({
      where: { id: dto.hall_plan_id },
    });
    if (!hallPlan) {
      throw new NotFoundException({
        message: 'Hall plan not found',
        errorCode: 'HALL_PLAN_NOT_FOUND',
      });
    }

    if (hallPlan.exam_id !== dto.exam_id) {
      throw new UnprocessableEntityException({
        message: 'The specified hall plan does not belong to this exam',
        errorCode: 'HALL_PLAN_NOT_IN_EXAM',
      });
    }

    const faculty = await this.prisma.faculty.findUnique({
      where: { id: dto.faculty_id },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'Faculty not found',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }

    const dutyDate = new Date(dto.duty_date);

    await this.assertFacultyAvailableForSession(dto.faculty_id, dutyDate, SESSION_WINDOW[dto.session]);

    return this.prisma.$transaction(async (tx) => {
      const existingDuty = await tx.invigilation_duties.findFirst({
        where: {
          faculty_id: dto.faculty_id,
          duty_date: dutyDate,
          session: dto.session,
        },
      });

      if (existingDuty) {
        if (existingDuty.hall_plan_id === dto.hall_plan_id) {
          throw new ConflictException({
            message:
              'This faculty member is already assigned invigilation duty for this hall plan, date, and session',
            errorCode: 'DUPLICATE_INVIGILATION_ASSIGNMENT',
          });
        }
        throw new ConflictException({
          message:
            'This faculty member is already assigned invigilation duty in another hall for this date and session',
          errorCode: 'FACULTY_ALREADY_ASSIGNED',
        });
      }

      return tx.invigilation_duties.create({
        data: {
          exam_id: dto.exam_id,
          faculty_id: dto.faculty_id,
          hall_plan_id: dto.hall_plan_id,
          duty_date: dutyDate,
          session: dto.session,
          role: dto.role,
          duty_type: dto.duty_type ?? 'regular',
        },
        include: {
          faculty: { select: FACULTY_SELECT },
          hall_plans: { select: HALL_PLAN_SELECT },
        },
      });
    });
  }

  async findAll(query: FindInvigilationQueryDto) {
    const where: Prisma.invigilation_dutiesWhereInput = {};
    if (query.exam_id !== undefined) where.exam_id = query.exam_id;
    if (query.hall_plan_id !== undefined)
      where.hall_plan_id = query.hall_plan_id;
    if (query.faculty_id !== undefined) where.faculty_id = query.faculty_id;
    if (query.duty_date !== undefined)
      where.duty_date = new Date(query.duty_date);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.invigilation_duties.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: [{ duty_date: 'asc' }, { id: 'asc' }],
        include: {
          faculty: { select: FACULTY_SELECT },
          hall_plans: { select: HALL_PLAN_SELECT },
        },
      }),
      this.prisma.invigilation_duties.count({ where }),
    ]);

    return paginate(data, total, query);
  }

  async findOne(id: number) {
    const duty = await this.prisma.invigilation_duties.findUnique({
      where: { id },
      include: {
        faculty: { select: FACULTY_SELECT },
        hall_plans: { select: HALL_PLAN_SELECT },
        exams: {
          select: {
            id: true,
            academic_year: true,
            semester: true,
            status: true,
          },
        },
      },
    });

    if (!duty) {
      throw new NotFoundException({
        message: 'Invigilation duty not found',
        errorCode: 'INVIGILATION_DUTY_NOT_FOUND',
      });
    }

    return duty;
  }

  async update(id: number, dto: UpdateInvigilationDto) {
    const existing = await this.prisma.invigilation_duties.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Invigilation duty not found',
        errorCode: 'INVIGILATION_DUTY_NOT_FOUND',
      });
    }

    if (dto.exam_id !== undefined) {
      const exam = await this.prisma.exams.findUnique({
        where: { id: dto.exam_id },
      });
      if (!exam) {
        throw new NotFoundException({
          message: 'Exam not found',
          errorCode: 'EXAM_NOT_FOUND',
        });
      }
    }

    const examId = dto.exam_id ?? existing.exam_id;

    let hallPlan: { id: number; exam_id: number } | null = null;
    if (dto.hall_plan_id !== undefined) {
      hallPlan = await this.prisma.hall_plans.findUnique({
        where: { id: dto.hall_plan_id },
      });
      if (!hallPlan) {
        throw new NotFoundException({
          message: 'Hall plan not found',
          errorCode: 'HALL_PLAN_NOT_FOUND',
        });
      }
    } else if (dto.exam_id !== undefined) {
      hallPlan = await this.prisma.hall_plans.findUnique({
        where: { id: existing.hall_plan_id },
      });
    }

    if (hallPlan && hallPlan.exam_id !== examId) {
      throw new UnprocessableEntityException({
        message: 'The specified hall plan does not belong to this exam',
        errorCode: 'HALL_PLAN_NOT_IN_EXAM',
      });
    }

    if (dto.faculty_id !== undefined) {
      const faculty = await this.prisma.faculty.findUnique({
        where: { id: dto.faculty_id },
      });
      if (!faculty) {
        throw new NotFoundException({
          message: 'Faculty not found',
          errorCode: 'FACULTY_NOT_FOUND',
        });
      }
    }

    const facultyId = dto.faculty_id ?? existing.faculty_id;
    const hallPlanId = dto.hall_plan_id ?? existing.hall_plan_id;
    const dutyDate =
      dto.duty_date !== undefined
        ? new Date(dto.duty_date)
        : existing.duty_date;
    const session = dto.session !== undefined ? dto.session : existing.session;

    return this.prisma.$transaction(async (tx) => {
      const conflictRow = await tx.invigilation_duties.findFirst({
        where: {
          faculty_id: facultyId,
          duty_date: dutyDate,
          session,
          NOT: { id },
        },
      });

      if (conflictRow) {
        if (conflictRow.hall_plan_id === hallPlanId) {
          throw new ConflictException({
            message:
              'This faculty member is already assigned invigilation duty for this hall plan, date, and session',
            errorCode: 'DUPLICATE_INVIGILATION_ASSIGNMENT',
          });
        }
        throw new ConflictException({
          message:
            'This faculty member is already assigned invigilation duty in another hall for this date and session',
          errorCode: 'FACULTY_ALREADY_ASSIGNED',
        });
      }

      const data: Record<string, unknown> = {};
      if (dto.exam_id !== undefined) data.exam_id = dto.exam_id;
      if (dto.hall_plan_id !== undefined) data.hall_plan_id = dto.hall_plan_id;
      if (dto.faculty_id !== undefined) data.faculty_id = dto.faculty_id;
      if (dto.duty_date !== undefined) data.duty_date = dutyDate;
      if (dto.session !== undefined) data.session = dto.session;
      if (dto.role !== undefined) data.role = dto.role;

      return tx.invigilation_duties.update({
        where: { id },
        data,
        include: {
          faculty: { select: FACULTY_SELECT },
          hall_plans: { select: HALL_PLAN_SELECT },
        },
      });
    });
  }

  async remove(id: number) {
    const existing = await this.prisma.invigilation_duties.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Invigilation duty not found',
        errorCode: 'INVIGILATION_DUTY_NOT_FOUND',
      });
    }

    await this.prisma.invigilation_duties.delete({ where: { id } });

    return { id };
  }

  async acknowledge(id: number) {
    const existing = await this.prisma.invigilation_duties.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Invigilation duty not found', errorCode: 'INVIGILATION_DUTY_NOT_FOUND' });
    }

    return this.prisma.invigilation_duties.update({
      where: { id },
      data: { acknowledged_at: new Date() },
      include: { faculty: { select: FACULTY_SELECT }, hall_plans: { select: HALL_PLAN_SELECT } },
    });
  }

  /**
   * GET /invigilation/venues-overview — one card per (venue, exam date,
   * session) that has at least one scheduled paper, with real chief/relief
   * assignments, real "timetable published" status, and real papers/
   * department/semester — everything the Invigilators page needs, built
   * from tables that already existed (hall_plans, exam_timetable,
   * exam_subject_mapping, invigilation_duties, invigilation_allocation_batches).
   */
  async getVenuesOverview(query: VenuesOverviewQueryDto) {
    const EMPTY = {
      exam_types: [] as { id: number; name: string; count: number }[],
      venues: [] as any[],
      stats: { total_venues: 0, published_venues: 0, faculty_on_duty: 0 },
    };

    const examWhere: Prisma.examsWhereInput = {};
    if (query.academic_year !== undefined)
      examWhere.academic_year = query.academic_year;
    if (query.semester !== undefined) examWhere.semester = query.semester;
    if (query.exam_type_id !== undefined)
      examWhere.exam_type_id = query.exam_type_id;

    const exams = await this.prisma.exams.findMany({
      where: examWhere,
      select: {
        id: true,
        academic_year: true,
        semester: true,
        exam_type_id: true,
        exam_types: { select: { id: true, name: true } },
      },
    });
    if (exams.length === 0) return EMPTY;

    const examIds = exams.map((e) => e.id);
    const examById = new Map(exams.map((e) => [e.id, e]));

    const hallPlans = await this.prisma.hall_plans.findMany({
      where: { exam_id: { in: examIds } },
      include: {
        venues: {
          select: { id: true, name: true, location: true, capacity: true },
        },
      },
      orderBy: [{ exam_date: 'asc' }, { id: 'asc' }],
    });
    if (hallPlans.length === 0) return EMPTY;

    const hallPlanIds = hallPlans.map((hp) => hp.id);

    // exam_timetable.venue_id is never set by the timetable-builder flow
    // (CreateExamTimetableDto has no venue_id field at all), so a hall
    // can't be matched to its papers through that column. seating_arrangements
    // is what actually ties a hall_plan to real students, and from there to
    // their class — the only real path from "this hall" to "these papers".
    const seatRows = await this.prisma.seating_arrangements.findMany({
      where: { hall_plan_id: { in: hallPlanIds } },
      select: { hall_plan_id: true, students: { select: { class_id: true } } },
    });
    const classIdsByHallPlan = new Map<number, Set<number>>();
    for (const s of seatRows) {
      if (s.students.class_id == null) continue;
      const set = classIdsByHallPlan.get(s.hall_plan_id) ?? new Set<number>();
      set.add(s.students.class_id);
      classIdsByHallPlan.set(s.hall_plan_id, set);
    }

    const timetableRows = await this.prisma.exam_timetable.findMany({
      where: { exam_subject_mapping: { exam_id: { in: examIds } } },
      select: {
        exam_date: true,
        session: true,
        start_time: true,
        end_time: true,
        exam_subject_mapping: {
          select: {
            id: true,
            is_published: true,
            exam_id: true,
            subjects: { select: { id: true, name: true, subject_code: true } },
            classes: {
              select: {
                id: true,
                current_semester: true,
                departments: { select: { code: true, name: true } },
              },
            },
          },
        },
      },
    });
    const rowsByExamDateClass = new Map<string, typeof timetableRows>();
    for (const row of timetableRows) {
      const k = `${row.exam_subject_mapping.exam_id}|${row.exam_date.toISOString().slice(0, 10)}|${row.exam_subject_mapping.classes.id}`;
      const list = rowsByExamDateClass.get(k) ?? [];
      list.push(row);
      rowsByExamDateClass.set(k, list);
    }

    const duties = await this.prisma.invigilation_duties.findMany({
      where: { hall_plan_id: { in: hallPlanIds } },
      include: { faculty: { select: FACULTY_SELECT } },
    });
    const dutiesByKey = new Map<string, typeof duties>();
    for (const d of duties) {
      const k = `${d.hall_plan_id}|${d.duty_date.toISOString().slice(0, 10)}|${d.session}`;
      const list = dutiesByKey.get(k) ?? [];
      list.push(d);
      dutiesByKey.set(k, list);
    }

    const batches = await this.prisma.invigilation_allocation_batches.findMany(
      { where: { exam_id: { in: examIds } } },
    );
    const batchByKey = new Map<string, (typeof batches)[number]>();
    for (const b of batches) {
      batchByKey.set(
        `${b.exam_id}|${b.exam_date.toISOString().slice(0, 10)}|${b.session}`,
        b,
      );
    }

    const venueCards: any[] = [];
    for (const hp of hallPlans) {
      const exam = examById.get(hp.exam_id);
      if (!exam) continue;
      const dateStr = hp.exam_date.toISOString().slice(0, 10);

      const classIds = [...(classIdsByHallPlan.get(hp.id) ?? [])];
      const rowsForHall = classIds.flatMap(
        (classId) => rowsByExamDateClass.get(`${hp.exam_id}|${dateStr}|${classId}`) ?? [],
      );
      // No seating (or seating but no scheduled paper) yet — still surface the
      // booked venue itself under both real sessions so it can be pre-assigned.
      const sessionsPresent = rowsForHall.length > 0 ? [...new Set(rowsForHall.map((r) => r.session))] : (['FN', 'AN'] as const);

      for (const session of sessionsPresent) {
        const rows = rowsForHall.filter((r) => r.session === session);

        const papers = rows.map((r) => ({
          exam_subject_mapping_id: r.exam_subject_mapping.id,
          subject_code: r.exam_subject_mapping.subjects.subject_code,
          subject_name: r.exam_subject_mapping.subjects.name,
        }));
        const isPublished = rows.length > 0 && rows.every((r) => r.exam_subject_mapping.is_published);
        const deptCodes = [...new Set(rows.map((r) => r.exam_subject_mapping.classes.departments.code))];
        const semesters = [...new Set(rows.map((r) => r.exam_subject_mapping.classes.current_semester).filter((s) => s != null))];
        const startTime = rows.length ? rows.map((r) => hms(r.start_time)).sort()[0] : null;
        const endTime = rows.length ? rows.map((r) => hms(r.end_time)).sort().slice(-1)[0] : null;

        const dutyKey = `${hp.id}|${dateStr}|${session}`;
        const hallDuties = dutiesByKey.get(dutyKey) ?? [];
        const chiefDuty = hallDuties.find((d) => d.role === 'chief') ?? null;
        const reliefDuty = hallDuties.find((d) => d.role === 'relief') ?? null;

        const batch = batchByKey.get(`${hp.exam_id}|${dateStr}|${session}`) ?? null;

        venueCards.push({
          key: dutyKey,
          hall_plan_id: hp.id,
          exam_id: hp.exam_id,
          exam_type_id: exam.exam_type_id,
          exam_type_name: exam.exam_types.name,
          academic_year: exam.academic_year,
          semester: exam.semester,
          exam_date: dateStr,
          session,
          start_time: startTime,
          end_time: endTime,
          venue: {
            id: hp.venues.id,
            name: hp.venues.name,
            location: hp.venues.location,
            capacity: hp.capacity ?? hp.venues.capacity,
          },
          department_code: deptCodes.length ? deptCodes.join('/') : null,
          class_semester: semesters.length === 1 ? semesters[0] : null,
          papers_count: papers.length,
          papers,
          is_published: isPublished,
          chief: chiefDuty
            ? { duty_id: chiefDuty.id, faculty_id: chiefDuty.faculty_id, name: facultyName(chiefDuty.faculty) }
            : null,
          relief: reliefDuty
            ? { duty_id: reliefDuty.id, faculty_id: reliefDuty.faculty_id, name: facultyName(reliefDuty.faculty) }
            : null,
          release_status: batch?.status ?? null,
        });
      }
    }

    const examTypeCounts = new Map<number, { id: number; name: string; count: number }>();
    for (const card of venueCards) {
      const existing = examTypeCounts.get(card.exam_type_id);
      if (existing) existing.count += 1;
      else
        examTypeCounts.set(card.exam_type_id, {
          id: card.exam_type_id,
          name: card.exam_type_name,
          count: 1,
        });
    }

    const facultyOnDuty = new Set<number>();
    for (const card of venueCards) {
      if (card.chief) facultyOnDuty.add(card.chief.faculty_id);
      if (card.relief) facultyOnDuty.add(card.relief.faculty_id);
    }

    return {
      exam_types: [...examTypeCounts.values()],
      venues: venueCards,
      stats: {
        total_venues: venueCards.length,
        published_venues: venueCards.filter((v) => v.is_published).length,
        faculty_on_duty: facultyOnDuty.size,
      },
    };
  }

  /** Real (hall, date, session) slots with zero invigilators assigned yet — derived the same way getVenuesOverview resolves real sessions per hall, just filtered to the unfilled ones. */
  async getUnfilledSlots(query: VenuesOverviewQueryDto = {}) {
    const overview = await this.getVenuesOverview(query);
    return overview.venues.filter((v: any) => !v.chief && !v.relief);
  }

  /** GET /invigilation/stats — the four real KPI tiles on the Invigilation page header. */
  async getStats() {
    const [total, acknowledged, reliefFaculty, unfilled] = await Promise.all([
      this.prisma.invigilation_duties.count(),
      this.prisma.invigilation_duties.count({ where: { acknowledged_at: { not: null } } }),
      this.prisma.invigilation_duties.findMany({ where: { role: 'relief' }, select: { faculty_id: true }, distinct: ['faculty_id'] }),
      this.getUnfilledSlots({}),
    ]);

    return {
      assigned: total,
      required: total + unfilled.length,
      unfilled_slots: unfilled.length,
      next_unfilled_date: unfilled[0]?.exam_date ?? null,
      next_unfilled_session: unfilled[0]?.session ?? null,
      acknowledged,
      acknowledged_pct: total > 0 ? Math.round((acknowledged / total) * 1000) / 10 : 0,
      relief_invigilators: reliefFaculty.length,
    };
  }

  /** POST /invigilation/:id/remind — a real in-app notification to the assigned faculty's own user account (the only real dispatch channel that exists in the schema). */
  async remind(id: number) {
    const duty = await this.prisma.invigilation_duties.findUnique({
      where: { id },
      include: { faculty: { select: { user_id: true } }, hall_plans: { include: { venues: { select: { name: true } } } } },
    });
    if (!duty) throw new NotFoundException({ message: 'Invigilation duty not found', errorCode: 'INVIGILATION_DUTY_NOT_FOUND' });
    if (!duty.faculty.user_id) {
      throw new UnprocessableEntityException({ message: 'This faculty member has no linked user account to notify.', errorCode: 'NO_USER_ACCOUNT' });
    }

    return this.prisma.notifications.create({
      data: {
        user_id: duty.faculty.user_id,
        title: 'Invigilation duty reminder',
        message: `Reminder: you have an invigilation duty at ${duty.hall_plans.venues.name} on ${duty.duty_date.toISOString().slice(0, 10)} (${duty.session}). Please acknowledge it.`,
        related_entity_type: 'invigilation_duties',
        related_entity_id: duty.id,
      },
    });
  }

  /** POST /invigilation/auto-assign — fills one unfilled (hall, date, session) slot with whichever active faculty currently has the fewest invigilation duties overall (real, fair least-loaded pick, not random). */
  async autoAssign(dto: { exam_id: number; hall_plan_id: number; duty_date: string; session: 'FN' | 'AN' }) {
    const dutyCounts = await this.prisma.invigilation_duties.groupBy({ by: ['faculty_id'], _count: { _all: true } });
    const countByFaculty = new Map(dutyCounts.map((d) => [d.faculty_id, d._count._all]));

    const activeFaculty = await this.prisma.faculty.findMany({ where: { status: 'active' }, select: { id: true } });
    if (activeFaculty.length === 0) {
      throw new UnprocessableEntityException({ message: 'No active faculty available to assign.', errorCode: 'NO_FACULTY_AVAILABLE' });
    }

    const dutyDate = new Date(dto.duty_date);
    const ineligible = await this.getIneligibleFacultyIds(dutyDate, dto.session, SESSION_WINDOW[dto.session]);

    const candidate = activeFaculty
      .filter((f) => !ineligible.has(f.id))
      .map((f) => ({ id: f.id, count: countByFaculty.get(f.id) ?? 0 }))
      .sort((a, b) => a.count - b.count)[0];

    if (!candidate) {
      throw new UnprocessableEntityException({
        message: 'No active faculty is free for this date and session — everyone is already on duty, on approved leave, or has a class then.',
        errorCode: 'NO_FACULTY_AVAILABLE',
      });
    }

    return this.create({
      exam_id: dto.exam_id,
      hall_plan_id: dto.hall_plan_id,
      faculty_id: candidate.id,
      duty_date: dto.duty_date,
      session: dto.session,
      duty_type: 'regular',
    });
  }
}
