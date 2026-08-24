import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import type { HodAttendanceStatus } from './dto/hod-attendance-status.enum';

function resolveStudentName(s: {
  soa_applications: { first_name: string; last_name: string | null } | null;
  users: { email: string };
}): string {
  if (s.soa_applications) {
    return s.soa_applications.last_name
      ? `${s.soa_applications.first_name} ${s.soa_applications.last_name}`
      : s.soa_applications.first_name;
  }
  return s.users.email;
}

// Same Anna University absolute grading bands already used by
// class-mentors.service.ts / subject-records.service.ts — no stored
// letter-grade column anywhere, re-derived from marks_obtained/max_marks.
const GRADE_BANDS: { min: number; grade: string }[] = [
  { min: 91, grade: 'O' },
  { min: 81, grade: 'A+' },
  { min: 71, grade: 'A' },
  { min: 61, grade: 'B+' },
  { min: 50, grade: 'B' },
  { min: 0, grade: 'RA' },
];
function gradeForPercentage(pct: number): string {
  return GRADE_BANDS.find((b) => pct >= b.min)?.grade ?? 'RA';
}

/**
 * GET/POST /hod/my-class/* — "My Class" is for a HOD who also personally
 * teaches (faculty_subject_class_mapping), same concept as a regular
 * faculty member's own teaching load, exposed under the HOD's own portal.
 * Every field reads a real table; every multi-query method runs
 * sequentially (Supabase's session-mode pool caps at 15 connections — see
 * hod.service.ts's own comments for why Promise.all across raw/multiple DB
 * calls is unsafe here).
 */
@Injectable()
export class HodMyClassService {
  private readonly logger = new Logger(HodMyClassService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async resolveFaculty(user: JwtPayload) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: { id: true },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'No faculty record found for this account.',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    return faculty;
  }

  /** Every (subject, class) this HOD is mapped to teach, for their latest academic_year — real empty array if they teach nothing. */
  private async getHandledClasses(facultyId: number) {
    const latest = await this.prisma.faculty_subject_class_mapping.findFirst({
      where: { faculty_id: facultyId },
      orderBy: { academic_year: 'desc' },
      select: { academic_year: true },
    });
    if (!latest)
      return {
        academicYear: null as string | null,
        mappings: [] as {
          class_id: number;
          subject_id: number;
          academic_year: string;
          section: string;
          semester: number | null;
          department_name: string;
          subject_name: string;
          subject_code: string;
        }[],
      };

    const rows = await this.prisma.faculty_subject_class_mapping.findMany({
      where: { faculty_id: facultyId, academic_year: latest.academic_year },
      select: {
        class_id: true,
        subject_id: true,
        academic_year: true,
        classes: {
          select: {
            section: true,
            current_semester: true,
            departments: { select: { name: true } },
          },
        },
        subjects: { select: { name: true, subject_code: true } },
      },
      orderBy: [{ class_id: 'asc' }, { subject_id: 'asc' }],
    });

    return {
      academicYear: latest.academic_year,
      mappings: rows.map((r) => ({
        class_id: r.class_id,
        subject_id: r.subject_id,
        academic_year: r.academic_year,
        section: r.classes.section,
        semester: r.classes.current_semester,
        department_name: r.classes.departments.name,
        subject_name: r.subjects.name,
        subject_code: r.subjects.subject_code,
      })),
    };
  }

  // ------------------------------------------------------------------
  // GET /hod/my-class/attendance?class_id=&subject_id=
  // ------------------------------------------------------------------
  async getAttendanceOverview(
    user: JwtPayload,
    classId?: number,
    subjectId?: number,
  ) {
    const faculty = await this.resolveFaculty(user);
    try {
      const { mappings } = await this.getHandledClasses(faculty.id);
      const handledClasses = mappings.map((m) => ({
        class_id: m.class_id,
        subject_id: m.subject_id,
        section: m.section,
        subject_name: m.subject_name,
        subject_code: m.subject_code,
      }));

      const selected =
        (classId != null && subjectId != null
          ? handledClasses.find(
              (m) => m.class_id === classId && m.subject_id === subjectId,
            )
          : handledClasses[0]) ?? null;

      if (!selected) {
        return {
          handled_classes: handledClasses,
          selected_class: null,
          date: null,
          periods: [],
          already_saved: false,
          students: [],
        };
      }

      const today = new Date(new Date().toISOString().slice(0, 10));
      const dayOfWeek = new Date().getDay();

      const periodRows = await this.prisma.timetable_slots.findMany({
        where: {
          faculty_id: faculty.id,
          class_id: selected.class_id,
          subject_id: selected.subject_id,
          day_of_week: dayOfWeek,
        },
        orderBy: { period_number: 'asc' },
        select: { period_number: true, start_time: true, end_time: true },
      });
      const periods = periodRows.map((p) => ({
        period_number: p.period_number,
        start_time: p.start_time.toISOString().slice(11, 16),
        end_time: p.end_time.toISOString().slice(11, 16),
      }));

      const existing = await this.prisma.attendance_records.findMany({
        where: {
          class_id: selected.class_id,
          subject_id: selected.subject_id,
          attendance_date: today,
        },
        select: { student_id: true, status: true },
      });
      const statusByStudent = new Map(
        existing.map((r) => [r.student_id, r.status]),
      );

      const roster = await this.prisma.students.findMany({
        where: { class_id: selected.class_id, status: 'active' },
        orderBy: { roll_no: 'asc' },
        select: {
          id: true,
          student_id_no: true,
          soa_applications: { select: { first_name: true, last_name: true } },
          users: { select: { email: true } },
        },
      });

      return {
        handled_classes: handledClasses,
        selected_class: selected,
        date: today.toISOString().slice(0, 10),
        periods,
        already_saved: existing.length > 0,
        students: roster.map((s) => ({
          student_id: s.id,
          student_id_no: s.student_id_no,
          name: resolveStudentName(s),
          status: statusByStudent.get(s.id) ?? null,
        })),
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD my-class attendance', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  // ------------------------------------------------------------------
  // POST /hod/my-class/attendance/mark
  // ------------------------------------------------------------------
  async markAttendance(
    user: JwtPayload,
    dto: {
      class_id: number;
      subject_id: number;
      records: { student_id: number; status: HodAttendanceStatus }[];
    },
  ) {
    const faculty = await this.resolveFaculty(user);
    try {
      const mapping = await this.prisma.faculty_subject_class_mapping.findFirst(
        {
          where: {
            faculty_id: faculty.id,
            subject_id: dto.subject_id,
            class_id: dto.class_id,
          },
        },
      );
      if (!mapping) {
        throw new NotFoundException({
          message: 'You are not assigned to teach this subject for this class.',
          errorCode: 'NOT_MAPPED_TO_TEACH',
        });
      }

      const today = new Date(new Date().toISOString().slice(0, 10));
      let saved = 0;
      // Sequential upserts — same pool-safety discipline as every other
      // hod service; this action-endpoint is not on a hot read path.
      for (const record of dto.records) {
        await this.prisma.attendance_records.upsert({
          where: {
            student_id_class_id_subject_id_attendance_date: {
              student_id: record.student_id,
              class_id: dto.class_id,
              subject_id: dto.subject_id,
              attendance_date: today,
            },
          },
          create: {
            student_id: record.student_id,
            class_id: dto.class_id,
            subject_id: dto.subject_id,
            attendance_date: today,
            status: record.status,
            marked_by_faculty_id: faculty.id,
            marked_by_user_id: user.sub,
          },
          update: {
            status: record.status,
            marked_by_faculty_id: faculty.id,
            marked_by_user_id: user.sub,
            updated_at: new Date(),
          },
        });
        saved += 1;
      }

      return {
        class_id: dto.class_id,
        subject_id: dto.subject_id,
        date: today.toISOString().slice(0, 10),
        saved,
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error marking HoD my-class attendance', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  // ------------------------------------------------------------------
  // GET /hod/my-class/current-semester
  // Same real per-mapping counts as TimetableService.getCurrentSemesterForFaculty
  // (hours/week from timetable_slots, tasks from assignments, materials from
  // lms_notes) — re-derived here (not delegated) only to add the frontend's
  // `initials`/`percent_covered` fields honestly (initials from the HOD's own
  // name; percent_covered has no real source anywhere, returned as null).
  // ------------------------------------------------------------------
  async getCurrentSemester(user: JwtPayload) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: { id: true, first_name: true, last_name: true },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'No faculty record found for this account.',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    try {
      const { academicYear, mappings } = await this.getHandledClasses(
        faculty.id,
      );
      if (!academicYear) {
        return { academic_year: null, subjects: [] };
      }
      const initials =
        `${faculty.first_name[0] ?? ''}${faculty.last_name[0] ?? ''}`.toUpperCase();

      // Sequential per mapping — same pool-safety discipline as every other
      // hod service (the shared TimetableService method this mirrors uses
      // Promise.all internally, a pre-existing risk out of scope to fix here).
      const subjects: {
        class_id: number;
        subject_id: number;
        subject_name: string;
        subject_code: string;
        section: string;
        semester: number | null;
        initials: string;
        hours_per_week: number;
        materials_count: number;
        tasks_count: number;
        percent_covered: null;
      }[] = [];
      for (const m of mappings) {
        const hoursPerWeek = await this.prisma.timetable_slots.count({
          where: {
            faculty_id: faculty.id,
            subject_id: m.subject_id,
            class_id: m.class_id,
            academic_year: academicYear,
          },
        });
        const tasksCount = await this.prisma.assignments.count({
          where: {
            faculty_id: faculty.id,
            subject_id: m.subject_id,
            class_id: m.class_id,
            academic_year: academicYear,
          },
        });
        const materialsCount = await this.prisma.lms_notes.count({
          where: {
            faculty_id: faculty.id,
            subject_id: m.subject_id,
            class_id: m.class_id,
          },
        });
        subjects.push({
          class_id: m.class_id,
          subject_id: m.subject_id,
          subject_name: m.subject_name,
          subject_code: m.subject_code,
          section: m.section,
          semester: m.semester,
          initials,
          hours_per_week: hoursPerWeek,
          materials_count: materialsCount,
          tasks_count: tasksCount,
          percent_covered: null,
        });
      }

      return { academic_year: academicYear, subjects };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD current semester', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  // ------------------------------------------------------------------
  // GET /hod/my-class/subject-records?class_id=&subject_id=&semester=
  // A per-student x per-exam marks grid for one (class, subject) the HOD
  // teaches — every exam_subject_mapping row for that pair is a column.
  // ------------------------------------------------------------------
  async getSubjectRecords(
    user: JwtPayload,
    classId?: number,
    subjectId?: number,
    semester?: number,
  ) {
    const faculty = await this.resolveFaculty(user);
    try {
      const { mappings } = await this.getHandledClasses(faculty.id);
      const handledClasses = mappings.map((m) => ({
        class_id: m.class_id,
        subject_id: m.subject_id,
        section: m.section,
        semester: m.semester,
        subject_name: m.subject_name,
        subject_code: m.subject_code,
      }));

      const selected =
        (classId != null && subjectId != null
          ? handledClasses.find(
              (m) => m.class_id === classId && m.subject_id === subjectId,
            )
          : handledClasses[0]) ?? null;

      if (!selected) {
        return {
          handled_classes: handledClasses,
          selected_class: null,
          semesters: [],
          selected_semester: null,
          columns: [],
          students: [],
          student_count: 0,
        };
      }

      const examMappings = await this.prisma.exam_subject_mapping.findMany({
        where: { class_id: selected.class_id, subject_id: selected.subject_id },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          exams: {
            select: { semester: true, exam_types: { select: { name: true } } },
          },
        },
      });
      const semesters = [
        ...new Set(examMappings.map((m) => m.exams.semester)),
      ].sort((a, b) => a - b);
      const selectedSemester =
        semester ?? semesters[semesters.length - 1] ?? null;
      const columnMappings = examMappings.filter(
        (m) =>
          selectedSemester == null || m.exams.semester === selectedSemester,
      );

      const marks = columnMappings.length
        ? await this.prisma.exam_marks.findMany({
            where: {
              exam_subject_mapping_id: { in: columnMappings.map((m) => m.id) },
            },
            select: {
              student_id: true,
              exam_subject_mapping_id: true,
              marks_obtained: true,
              max_marks: true,
              is_absent: true,
            },
          })
        : [];

      const marksByCell = new Map<
        string,
        { marks_obtained: number | null; is_absent: boolean }
      >();
      for (const m of marks) {
        marksByCell.set(`${m.student_id}-${m.exam_subject_mapping_id}`, {
          marks_obtained:
            m.marks_obtained != null ? Number(m.marks_obtained) : null,
          is_absent: m.is_absent,
        });
      }

      const columnAverages = columnMappings.map((cm) => {
        const cellsForColumn = marks.filter(
          (m) =>
            m.exam_subject_mapping_id === cm.id &&
            !m.is_absent &&
            m.marks_obtained != null,
        );
        const avg =
          cellsForColumn.length > 0
            ? Math.round(
                (cellsForColumn.reduce(
                  (s, c) => s + Number(c.marks_obtained),
                  0,
                ) /
                  cellsForColumn.length) *
                  10,
              ) / 10
            : null;
        const maxMarks = cellsForColumn[0]
          ? Number(
              marks.find((m) => m.exam_subject_mapping_id === cm.id)
                ?.max_marks ?? 0,
            )
          : null;
        return {
          mapping_id: cm.id,
          label: cm.exams.exam_types.name,
          max_marks: maxMarks,
          average: avg,
        };
      });

      const roster = await this.prisma.students.findMany({
        where: { class_id: selected.class_id, status: 'active' },
        orderBy: { roll_no: 'asc' },
        select: {
          id: true,
          student_id_no: true,
          soa_applications: { select: { first_name: true, last_name: true } },
          users: { select: { email: true } },
        },
      });

      const students = roster.map((s) => {
        const cells = columnMappings.map((cm) => {
          const cell = marksByCell.get(`${s.id}-${cm.id}`);
          return {
            mapping_id: cm.id,
            marks_obtained: cell?.marks_obtained ?? null,
            is_absent: cell?.is_absent ?? false,
          };
        });
        const scored = cells.filter(
          (c) => !c.is_absent && c.marks_obtained != null,
        );
        const columnWithMax = columnAverages.find(
          (c) => c.mapping_id === scored[scored.length - 1]?.mapping_id,
        );
        const overallPct =
          scored.length > 0 && columnWithMax?.max_marks
            ? (scored.reduce((a, c) => a + (c.marks_obtained ?? 0), 0) /
                scored.length /
                columnWithMax.max_marks) *
              100
            : null;
        return {
          student_id: s.id,
          student_id_no: s.student_id_no,
          name: resolveStudentName(s),
          email: s.users.email,
          cells,
          grade: overallPct != null ? gradeForPercentage(overallPct) : null,
        };
      });

      return {
        handled_classes: handledClasses,
        selected_class: selected,
        semesters,
        selected_semester: selectedSemester,
        columns: columnAverages,
        students,
        student_count: roster.length,
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD subject records', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  // ------------------------------------------------------------------
  // GET /hod/my-class/assignment-status?class_id=&subject_id=&assignment_id=
  // ------------------------------------------------------------------
  async getAssignmentStatus(
    user: JwtPayload,
    classId?: number,
    subjectId?: number,
    assignmentId?: number,
  ) {
    const faculty = await this.resolveFaculty(user);
    try {
      const { mappings } = await this.getHandledClasses(faculty.id);
      const handledClasses = mappings.map((m) => ({
        class_id: m.class_id,
        subject_id: m.subject_id,
        academic_year: m.academic_year,
        section: m.section,
        semester: m.semester,
        department_name: m.department_name,
        subject_name: m.subject_name,
        subject_code: m.subject_code,
      }));

      const selected =
        (classId != null && subjectId != null
          ? handledClasses.find(
              (m) => m.class_id === classId && m.subject_id === subjectId,
            )
          : handledClasses[0]) ?? null;

      if (!selected) {
        return {
          handled_classes: handledClasses,
          assignments: [],
          assignment: null,
          students: [],
        };
      }

      const assignmentRows = await this.prisma.assignments.findMany({
        where: {
          faculty_id: faculty.id,
          class_id: selected.class_id,
          subject_id: selected.subject_id,
        },
        orderBy: { sequence_no: 'asc' },
        select: {
          id: true,
          academic_year: true,
          semester: true,
          sequence_no: true,
          title: true,
          due_date: true,
          max_marks: true,
          classes: { select: { id: true, section: true } },
          subjects: { select: { id: true, name: true, subject_code: true } },
        },
      });
      const assignments = assignmentRows.map((a) => ({
        id: a.id,
        academic_year: a.academic_year,
        semester: a.semester,
        sequence_no: a.sequence_no,
        title: a.title,
        class: { id: a.classes.id, section: a.classes.section },
        subject: {
          id: a.subjects.id,
          name: a.subjects.name,
          subject_code: a.subjects.subject_code,
        },
      }));

      const selectedAssignmentRow =
        (assignmentId != null
          ? assignmentRows.find((a) => a.id === assignmentId)
          : assignmentRows[0]) ?? null;

      if (!selectedAssignmentRow) {
        return {
          handled_classes: handledClasses,
          assignments,
          assignment: null,
          students: [],
        };
      }

      const statuses = await this.prisma.student_assignment_status.findMany({
        where: { assignment_id: selectedAssignmentRow.id },
        select: {
          id: true,
          student_id: true,
          is_submitted: true,
          marked_at: true,
        },
      });
      const statusByStudent = new Map(statuses.map((s) => [s.student_id, s]));

      const roster = await this.prisma.students.findMany({
        where: { class_id: selectedAssignmentRow.classes.id, status: 'active' },
        orderBy: { roll_no: 'asc' },
        select: {
          id: true,
          student_id_no: true,
          soa_applications: { select: { first_name: true, last_name: true } },
          users: { select: { email: true } },
        },
      });

      return {
        handled_classes: handledClasses,
        assignments,
        assignment: {
          id: selectedAssignmentRow.id,
          academic_year: selectedAssignmentRow.academic_year,
          semester: selectedAssignmentRow.semester,
          sequence_no: selectedAssignmentRow.sequence_no,
          title: selectedAssignmentRow.title,
          class: {
            id: selectedAssignmentRow.classes.id,
            section: selectedAssignmentRow.classes.section,
          },
          subject: {
            id: selectedAssignmentRow.subjects.id,
            name: selectedAssignmentRow.subjects.name,
            subject_code: selectedAssignmentRow.subjects.subject_code,
          },
          due_date: selectedAssignmentRow.due_date?.toISOString() ?? null,
          max_marks: selectedAssignmentRow.max_marks,
        },
        students: roster.map((s) => {
          const status = statusByStudent.get(s.id);
          return {
            student_id: s.id,
            student_id_no: s.student_id_no,
            name: resolveStudentName(s),
            email: s.users.email,
            status_id: status?.id ?? null,
            is_submitted: status?.is_submitted ?? false,
            marked_at: status?.marked_at?.toISOString() ?? null,
          };
        }),
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD assignment status', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  // ------------------------------------------------------------------
  // PATCH /hod/my-class/assignment-status/mark
  // ------------------------------------------------------------------
  async markAssignmentStatus(
    user: JwtPayload,
    dto: {
      assignment_id: number;
      student_id: number;
      status_id: number | null;
      is_submitted: boolean;
    },
  ) {
    const faculty = await this.resolveFaculty(user);
    try {
      const assignment = await this.prisma.assignments.findUnique({
        where: { id: dto.assignment_id },
        select: { faculty_id: true },
      });
      if (!assignment || assignment.faculty_id !== faculty.id) {
        throw new NotFoundException({
          message: 'Assignment not found for this account.',
          errorCode: 'ASSIGNMENT_NOT_FOUND',
        });
      }

      const now = new Date();
      const result = dto.status_id
        ? await this.prisma.student_assignment_status.update({
            where: { id: dto.status_id },
            data: {
              is_submitted: dto.is_submitted,
              marked_by_faculty_id: faculty.id,
              marked_at: now,
            },
          })
        : await this.prisma.student_assignment_status.upsert({
            where: {
              assignment_id_student_id: {
                assignment_id: dto.assignment_id,
                student_id: dto.student_id,
              },
            },
            create: {
              assignment_id: dto.assignment_id,
              student_id: dto.student_id,
              is_submitted: dto.is_submitted,
              marked_by_faculty_id: faculty.id,
              marked_at: now,
            },
            update: {
              is_submitted: dto.is_submitted,
              marked_by_faculty_id: faculty.id,
              marked_at: now,
            },
          });

      return {
        id: result.id,
        is_submitted: result.is_submitted,
        marked_at: result.marked_at?.toISOString() ?? null,
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error marking HoD assignment status', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
