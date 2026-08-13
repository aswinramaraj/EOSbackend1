import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AttendanceService } from 'src/modules/faculty/attendance/attendance.service';
import type { HodClassAttendanceRecordItemDto } from './dto/mark-hod-class-attendance.dto';

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}
function formatHHMM(value: Date): string {
  return `${pad2(value.getUTCHours())}:${pad2(value.getUTCMinutes())}`;
}

interface HandledClass {
  class_id: number;
  subject_id: number;
  section: string;
  subject_name: string;
  subject_code: string;
  academic_year: string;
}

@Injectable()
export class HodMyClassAttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attendanceService: AttendanceService,
  ) {}

  private async resolveFaculty(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }

  private async getHandledClasses(facultyId: number): Promise<HandledClass[]> {
    const mappings = await this.prisma.faculty_subject_class_mapping.findMany({
      where: { faculty_id: facultyId },
      select: {
        class_id: true,
        subject_id: true,
        academic_year: true,
        classes: { select: { section: true } },
        subjects: { select: { name: true, subject_code: true } },
      },
      orderBy: [
        { academic_year: 'desc' },
        { class_id: 'asc' },
        { subject_id: 'asc' },
      ],
    });

    const seen = new Set<string>();
    return mappings
      .filter((m) => {
        const key = `${m.class_id}-${m.subject_id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((m) => ({
        class_id: m.class_id,
        subject_id: m.subject_id,
        section: m.classes.section,
        subject_name: m.subjects.name,
        subject_code: m.subjects.subject_code,
        academic_year: m.academic_year,
      }));
  }

  /**
   * GET /hod/my-class/attendance?class_id=&subject_id= — always for today.
   * Reuses AttendanceService.getClassRoster() (Faculty/Secretary-facing, no
   * per-call ownership check of its own) — safe here because `selected` is
   * always resolved from the caller's own faculty_subject_class_mapping
   * rows first, never a client-supplied class_id taken at face value.
   */
  async getOverview(userId: number, classId?: number, subjectId?: number) {
    const faculty = await this.resolveFaculty(userId);
    const handled = await this.getHandledClasses(faculty.id);

    if (handled.length === 0) {
      return {
        handled_classes: [],
        selected_class: null,
        date: null,
        periods: [],
        already_saved: false,
        students: [],
      };
    }

    const selected =
      (classId != null && subjectId != null
        ? handled.find(
            (h) => h.class_id === classId && h.subject_id === subjectId,
          )
        : undefined) ?? handled[0];

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const attendanceDate = new Date(`${dateStr}T00:00:00.000Z`);
    const dayOfWeek = now.getDay();

    const [roster, slots, existing] = await Promise.all([
      this.attendanceService.getClassRoster(selected.class_id),
      this.prisma.timetable_slots.findMany({
        where: {
          faculty_id: faculty.id,
          class_id: selected.class_id,
          subject_id: selected.subject_id,
          day_of_week: dayOfWeek,
        },
        orderBy: { period_number: 'asc' },
        select: { period_number: true, start_time: true, end_time: true },
      }),
      this.prisma.attendance_records.findMany({
        where: {
          class_id: selected.class_id,
          subject_id: selected.subject_id,
          attendance_date: attendanceDate,
        },
        select: { student_id: true, status: true },
      }),
    ]);

    const statusByStudent = new Map(
      existing.map((e) => [e.student_id, e.status]),
    );

    return {
      handled_classes: handled,
      selected_class: selected,
      date: dateStr,
      periods: slots.map((s) => ({
        period_number: s.period_number,
        start_time: formatHHMM(s.start_time),
        end_time: formatHHMM(s.end_time),
      })),
      already_saved: existing.length > 0,
      students: roster.map((s) => ({
        student_id: s.id,
        student_id_no: s.student_id_no,
        name: [s.first_name, s.last_name].filter(Boolean).join(' ') || s.email,
        status: statusByStudent.get(s.id) ?? null,
      })),
    };
  }

  /**
   * POST /hod/my-class/attendance/mark — always for today.
   *
   * Passes the SAME academic_year the matching faculty_subject_class_mapping
   * row actually has (looked up here, same as getOverview()'s own
   * getHandledClasses()) rather than recomputing "today's" academic year
   * from the wall clock — those two can disagree (e.g. the institution's
   * active academic calendar is still "2024-25" while the server's clock has
   * already rolled into "2026-27"), which was causing every mark attempt to
   * 403 with "You are not assigned to teach this subject for this class"
   * even for a subject genuinely shown as handled on the same page.
   */
  async mark(
    userId: number,
    classId: number,
    subjectId: number,
    records: HodClassAttendanceRecordItemDto[],
  ) {
    const faculty = await this.resolveFaculty(userId);
    const handled = await this.getHandledClasses(faculty.id);
    const match = handled.find(
      (h) => h.class_id === classId && h.subject_id === subjectId,
    );

    const dateStr = new Date().toISOString().slice(0, 10);
    return this.attendanceService.markForClass(
      classId,
      {
        subject_id: subjectId,
        attendance_date: dateStr,
        academic_year: match?.academic_year,
        records,
      },
      userId,
    );
  }
}
