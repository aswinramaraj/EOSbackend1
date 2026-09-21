import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

/** Same parsed-leading-year comparator as TimetableService.getCurrentSemesterForFaculty's own fix — robust to "2026-27" vs "2026-2027" format mismatches a plain string sort gets wrong. */
function leadingYear(academicYear: string): number {
  return Number.parseInt(academicYear.slice(0, 4), 10) || 0;
}

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
 * Every field reads a real table. The actual runtime constraint is the
 * app's own PrismaService.POOL_SIZE (20, transaction-mode pooler) — not a
 * 15-connection session-mode limit some older comments in this codebase
 * mistakenly cited (see docs/production/DATABASE_AUDIT.md §3). Batched,
 * independent Promise.all calls (as used below and in the sibling
 * TimetableService method this mirrors) are safe under that constraint.
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

  /**
   * Every (subject, class) this HOD is currently mapped to teach — real
   * empty array if they teach nothing.
   *
   * A faculty member can teach several class/section combos AT ONCE across
   * different batches (e.g. a Semester 1 class mapped this admission cycle
   * alongside a Semester 7 class mapped back when that batch started), and
   * those combos routinely carry different `academic_year` strings
   * (confirmed live: "2026-27" on one mapping, "2026-2027" on another, for
   * two subjects taught in the exact same real term). Picking a single
   * "latest" academic_year via `orderBy: desc` on that string column and
   * filtering everything down to just that value — this method's old
   * behavior — is a plain lexicographic string sort, which silently DROPS
   * every mapping whose year happens to sort lower as text even though
   * it's a currently-taught subject ("2026-27" sorts after "2026-2007" as
   * a string). Same bug TimetableService.getCurrentSemesterForFaculty had
   * and fixed; ported here the same way: never pick one global "latest
   * year," dedupe to one row per (subject_id, class_id) combo instead,
   * keeping each combo's own most recent row by parsed leading year.
   */
  private async getHandledClasses(facultyId: number) {
    const rows = await this.prisma.faculty_subject_class_mapping.findMany({
      where: { faculty_id: facultyId },
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

    if (rows.length === 0) {
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
    }

    const latestByCombo = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = `${row.subject_id}:${row.class_id}`;
      const current = latestByCombo.get(key);
      if (
        !current ||
        leadingYear(row.academic_year) > leadingYear(current.academic_year)
      ) {
        latestByCombo.set(key, row);
      }
    }
    const currentMappings = Array.from(latestByCombo.values());
    const academicYear = currentMappings.reduce(
      (latest, m) =>
        leadingYear(m.academic_year) > leadingYear(latest)
          ? m.academic_year
          : latest,
      currentMappings[0].academic_year,
    );

    return {
      academicYear,
      mappings: currentMappings.map((r) => ({
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

  // getCurrentSemester (GET /hod/my-class/current-semester) removed — GET
  // /me/current-semester (TimetableService.getCurrentSemesterForFaculty,
  // @Roles(FACULTY, HOD)) is the exact same data and already has the
  // year-parsing fix below ported into it; this duplicate never received
  // that fix and was silently dropping mappings for it.

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

  // getAssignmentStatus/markAssignmentStatus (GET/PATCH
  // /hod/my-class/assignment-status*) removed — confirmed zero frontend
  // consumers anywhere (the only reference to either endpoint was the hook
  // module itself, src/modules/hod/api/myClassAssignmentStatus.ts, which
  // had zero importers in turn). Dead scaffolding, not a shipped feature;
  // deleted while this file was already being touched rather than left in
  // place, per this repo's dead-code convention.
}
