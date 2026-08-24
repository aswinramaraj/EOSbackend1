import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

function yearLabel(semester: number | null): string {
  if (semester == null) return '—';
  return ['I', 'II', 'III', 'IV'][Math.ceil(semester / 2) - 1] ?? '—';
}
function currentAcademicYear(): string {
  const now = new Date();
  const calendarYear = now.getUTCFullYear();
  const academicStartYear =
    now.getUTCMonth() + 1 >= 6 ? calendarYear : calendarYear - 1;
  return `${academicStartYear}-${String((academicStartYear + 1) % 100).padStart(2, '0')}`;
}
function formatHHMM(time: Date): string {
  return time.toISOString().slice(11, 16);
}

const DAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
/** No weekly_off/holiday config table is scoped per-class in the schema — Mon-Sat matches every other timetable view in this codebase (see TimetableService's own day_of_week range). */
const TEACHING_DAYS = [1, 2, 3, 4, 5, 6];

/**
 * GET /hod/timetable, PUT/DELETE .../slot — department class timetable,
 * built on the real `timetable_slots` table (same one
 * TimetableService.findTodayForFaculty already reads, here queried
 * class-wide instead of faculty-wide). "lab" vs "class" comes from
 * `subjects.course_type` containing PRACTICAL — no separate boolean
 * exists. There's no stored "break" period anywhere in the schema, so an
 * empty period is always "free", never "break" (honest, not fabricated).
 * Every query sequential (Supabase's session-mode pool caps at 15
 * connections).
 */
@Injectable()
export class HodTimetableService {
  private readonly logger = new Logger(HodTimetableService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async resolveDepartmentId(user: JwtPayload): Promise<number> {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: { department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'No faculty record found for this account.',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    return faculty.department_id;
  }

  private async assertClassInDepartment(classId: number, departmentId: number) {
    const cls = await this.prisma.classes.findUnique({
      where: { id: classId },
      select: { department_id: true },
    });
    if (!cls || cls.department_id !== departmentId) {
      throw new NotFoundException({
        message: 'Class not found in your department.',
        errorCode: 'CLASS_NOT_FOUND',
      });
    }
  }

  async getOverview(user: JwtPayload, classId?: number) {
    const departmentId = await this.resolveDepartmentId(user);
    try {
      const classes = await this.prisma.classes.findMany({
        where: { department_id: departmentId },
        select: { id: true, section: true, current_semester: true },
        orderBy: [{ current_semester: 'asc' }, { section: 'asc' }],
      });
      const facultyOptions = await this.prisma.faculty.findMany({
        where: { department_id: departmentId, status: 'active' },
        select: { id: true, first_name: true, last_name: true },
        orderBy: { first_name: 'asc' },
      });

      const selectedClassId = classId ?? classes[0]?.id ?? null;
      let selectedClassLabel: string | null = null;
      let subjects: {
        subject_id: number;
        name: string;
        code: string;
        faculty_ids: number[];
      }[] = [];
      let columns: {
        period_number: number;
        start_time: string;
        end_time: string;
      }[] = [];
      let rows: {
        day_of_week: number;
        day_label: string;
        cells: unknown[];
      }[] = [];

      if (selectedClassId != null) {
        const selectedClass = classes.find((c) => c.id === selectedClassId);
        selectedClassLabel = selectedClass
          ? `${yearLabel(selectedClass.current_semester)}-${selectedClass.section}`
          : null;

        const curriculum = await this.prisma.class_subjects.findMany({
          where: { class_id: selectedClassId },
          select: {
            subjects: { select: { id: true, name: true, subject_code: true } },
          },
          orderBy: { subjects: { name: 'asc' } },
        });
        const mappings =
          await this.prisma.faculty_subject_class_mapping.findMany({
            where: {
              class_id: selectedClassId,
              academic_year: currentAcademicYear(),
            },
            select: { subject_id: true, faculty_id: true },
          });
        const facultyIdsBySubject = new Map<number, number[]>();
        for (const m of mappings) {
          const list = facultyIdsBySubject.get(m.subject_id) ?? [];
          list.push(m.faculty_id);
          facultyIdsBySubject.set(m.subject_id, list);
        }
        subjects = curriculum.map((c) => ({
          subject_id: c.subjects.id,
          name: c.subjects.name,
          code: c.subjects.subject_code,
          faculty_ids: facultyIdsBySubject.get(c.subjects.id) ?? [],
        }));

        const slots = await this.prisma.timetable_slots.findMany({
          where: { class_id: selectedClassId },
          orderBy: [{ day_of_week: 'asc' }, { period_number: 'asc' }],
          select: {
            id: true,
            day_of_week: true,
            period_number: true,
            start_time: true,
            end_time: true,
            subjects: {
              select: {
                id: true,
                name: true,
                subject_code: true,
                course_type: true,
              },
            },
            faculty: {
              select: { id: true, first_name: true, last_name: true },
            },
            venues: { select: { name: true } },
          },
        });

        const columnMap = new Map<
          number,
          { start_time: string; end_time: string }
        >();
        for (const s of slots) {
          if (!columnMap.has(s.period_number)) {
            columnMap.set(s.period_number, {
              start_time: formatHHMM(s.start_time),
              end_time: formatHHMM(s.end_time),
            });
          }
        }
        columns = [...columnMap.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([period_number, times]) => ({ period_number, ...times }));

        const slotsByDay = new Map<number, typeof slots>();
        for (const s of slots) {
          const list = slotsByDay.get(s.day_of_week) ?? [];
          list.push(s);
          slotsByDay.set(s.day_of_week, list);
        }

        rows = TEACHING_DAYS.map((day) => {
          const daySlots = slotsByDay.get(day) ?? [];
          const byPeriod = new Map(daySlots.map((s) => [s.period_number, s]));
          const cells = columns.map((col) => {
            const s = byPeriod.get(col.period_number);
            if (!s)
              return {
                period_number: col.period_number,
                type: 'free' as const,
              };
            return {
              period_number: col.period_number,
              type: s.subjects.course_type?.includes('PRACTICAL')
                ? ('lab' as const)
                : ('class' as const),
              slot_id: s.id,
              subject_id: s.subjects.id,
              subject_name: s.subjects.name,
              subject_code: s.subjects.subject_code,
              faculty_id: s.faculty.id,
              faculty_name:
                `${s.faculty.first_name} ${s.faculty.last_name}`.trim(),
              venue_name: s.venues?.name ?? null,
            };
          });
          return { day_of_week: day, day_label: DAY_LABELS[day], cells };
        });
      }

      return {
        classes: classes.map((c) => ({
          class_id: c.id,
          short_label: `${yearLabel(c.current_semester)}-${c.section}`,
          label: `${yearLabel(c.current_semester)} Year - ${c.section}`,
        })),
        selected_class_id: selectedClassId,
        selected_class_label: selectedClassLabel,
        subjects,
        faculty_options: facultyOptions.map((f) => ({
          faculty_id: f.id,
          name: `${f.first_name} ${f.last_name}`.trim(),
        })),
        columns,
        rows,
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD timetable overview', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async setSlot(
    user: JwtPayload,
    classId: number,
    dayOfWeek: number,
    periodNumber: number,
    subjectId: number,
    facultyId: number,
  ) {
    const departmentId = await this.resolveDepartmentId(user);
    const cls = await this.prisma.classes.findUnique({
      where: { id: classId },
      select: { department_id: true, current_semester: true },
    });
    if (!cls || cls.department_id !== departmentId) {
      throw new NotFoundException({
        message: 'Class not found in your department.',
        errorCode: 'CLASS_NOT_FOUND',
      });
    }
    const faculty = await this.prisma.faculty.findUnique({
      where: { id: facultyId },
      select: { department_id: true },
    });
    if (!faculty || faculty.department_id !== departmentId) {
      throw new BadRequestException({
        message: 'That faculty member is not in your department.',
        errorCode: 'FACULTY_OUT_OF_DEPARTMENT',
      });
    }
    // Reuse this class's own existing period timing if one already exists
    // for this period_number (any day) — there's no separate "period master"
    // schedule table; start/end time is only ever recorded per slot.
    const existingPeriod = await this.prisma.timetable_slots.findFirst({
      where: { class_id: classId, period_number: periodNumber },
      select: { start_time: true, end_time: true },
    });
    if (!existingPeriod) {
      throw new BadRequestException({
        message:
          'No existing period timing found for this period number in this class — set an initial slot for this period on another day first.',
        errorCode: 'NO_PERIOD_TIMING',
      });
    }
    try {
      // A faculty member is one person and cannot teach two classes at the
      // same day+period, regardless of year/section — checked across every
      // class in the college (not just this department), since a slot for
      // this faculty anywhere else at this exact time is a real conflict.
      const conflictingSlot = await this.prisma.timetable_slots.findFirst({
        where: {
          faculty_id: facultyId,
          day_of_week: dayOfWeek,
          period_number: periodNumber,
          class_id: { not: classId },
        },
        select: {
          classes: { select: { section: true, current_semester: true } },
          subjects: { select: { name: true, subject_code: true } },
        },
      });
      if (conflictingSlot) {
        const conflictClassLabel = `${yearLabel(conflictingSlot.classes.current_semester)}-${conflictingSlot.classes.section}`;
        throw new ConflictException({
          message: `This faculty is already assigned to ${conflictingSlot.subjects.subject_code} · ${conflictClassLabel} at this time.`,
          errorCode: 'FACULTY_TIME_CONFLICT',
        });
      }

      const existingSlot = await this.prisma.timetable_slots.findFirst({
        where: {
          class_id: classId,
          day_of_week: dayOfWeek,
          period_number: periodNumber,
        },
        select: { id: true },
      });
      if (existingSlot) {
        await this.prisma.timetable_slots.update({
          where: { id: existingSlot.id },
          data: { subject_id: subjectId, faculty_id: facultyId },
        });
      } else {
        await this.prisma.timetable_slots.create({
          data: {
            class_id: classId,
            day_of_week: dayOfWeek,
            period_number: periodNumber,
            subject_id: subjectId,
            faculty_id: facultyId,
            start_time: existingPeriod.start_time,
            end_time: existingPeriod.end_time,
            academic_year: currentAcademicYear(),
            semester: cls.current_semester ?? 0,
          },
        });
      }
      return { success: true };
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      this.logger.error('DB error setting HoD timetable slot', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async clearSlot(user: JwtPayload, slotId: number) {
    const departmentId = await this.resolveDepartmentId(user);
    const slot = await this.prisma.timetable_slots.findUnique({
      where: { id: slotId },
      select: { classes: { select: { department_id: true } } },
    });
    if (!slot || slot.classes.department_id !== departmentId) {
      throw new NotFoundException({
        message: 'Timetable slot not found in your department.',
        errorCode: 'SLOT_NOT_FOUND',
      });
    }
    try {
      await this.prisma.timetable_slots.delete({ where: { id: slotId } });
      return { success: true };
    } catch (err) {
      this.logger.error('DB error clearing HoD timetable slot', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
