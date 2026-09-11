import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Real `faculty_subject_class_mapping.academic_year` values are split
 * between two formats in live data: "2026-2027" (960 rows — the canonical
 * one, matching batches.name) and "2026-27" (21 rows — written by
 * HodAssignFacultyService's own currentAcademicYear(), which uses the
 * 2-digit form). That mismatch means a caller filtering on only one format
 * silently misses real mappings written under the other — matching both
 * candidates here rather than picking one.
 */
function currentAcademicYearCandidates(): string[] {
  const now = new Date();
  const calendarYear = now.getUTCFullYear();
  const academicStartYear =
    now.getUTCMonth() + 1 >= 6 ? calendarYear : calendarYear - 1;
  const endYear = academicStartYear + 1;
  return [
    `${academicStartYear}-${endYear}`,
    `${academicStartYear}-${String(endYear % 100).padStart(2, '0')}`,
  ];
}

interface ClearanceRow {
  student_id: number;
  faculty_subject_class_mapping_id: number;
  internal1_cleared: boolean;
  internal2_cleared: boolean;
  project_cleared: boolean;
  assignment_cleared: boolean;
  quiz_cleared: boolean;
}

const ALL_CLEARED_FIELDS = [
  'internal1_cleared',
  'internal2_cleared',
  'project_cleared',
  'assignment_cleared',
  'quiz_cleared',
] as const;
type ClearedField = (typeof ALL_CLEARED_FIELDS)[number];

function isRowFullyCleared(row: ClearanceRow): boolean {
  return ALL_CLEARED_FIELDS.every((f) => row[f]);
}

function isMissingTableError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('42P01');
}

/**
 * Faculty-manual, per-subject academic sign-off — Internal 1 / Internal 2 /
 * Project / Assignment / Quiz, one row per (student, faculty_subject_class_
 * mapping). This is deliberately a manual checklist, not derived from
 * exam_marks/student_assignment_status — see no_due.query.md #1 for why.
 * Backed by `subject_academic_clearance`, proposed additively there; every
 * read degrades to an honest "not set up yet" empty result if the table
 * doesn't exist yet (42P01), rather than erroring, so this activates the
 * moment the migration runs with no separate deploy.
 */
@Injectable()
export class SubjectNoDueService {
  private readonly logger = new Logger(SubjectNoDueService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async resolveFacultyByUserId(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'No faculty record found for this account.',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    return faculty;
  }

  /** GET /me/subject-no-due/mappings — this faculty's own subjects (as handler or substitute) for the current academic year, for the class/subject picker. */
  async getMappings(userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const mappings = await this.prisma.faculty_subject_class_mapping.findMany({
      where: {
        academic_year: { in: currentAcademicYearCandidates() },
        OR: [{ faculty_id: faculty.id }, { substitute_faculty_id: faculty.id }],
      },
      select: {
        id: true,
        subjects: { select: { id: true, name: true, subject_code: true } },
        classes: {
          select: {
            id: true,
            section: true,
            current_semester: true,
            batches: { select: { name: true } },
            departments: { select: { code: true } },
          },
        },
      },
      orderBy: { subjects: { name: 'asc' } },
    });

    return mappings.map((m) => ({
      mapping_id: m.id,
      subject: {
        id: m.subjects.id,
        name: m.subjects.name,
        code: m.subjects.subject_code,
      },
      class: {
        id: m.classes.id,
        section: m.classes.section,
        semester: m.classes.current_semester,
        batch_label: m.classes.batches?.name ?? '—',
        department_code: m.classes.departments?.code ?? '—',
      },
    }));
  }

  /** Verifies the calling faculty actually owns (or substitutes for) this mapping before any read/write against it. */
  private async assertOwnsMapping(userId: number, mappingId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    const mapping = await this.prisma.faculty_subject_class_mapping.findUnique({
      where: { id: mappingId },
      select: {
        id: true,
        faculty_id: true,
        substitute_faculty_id: true,
        class_id: true,
      },
    });
    if (!mapping) {
      throw new NotFoundException({
        message: 'Subject assignment not found.',
        errorCode: 'MAPPING_NOT_FOUND',
      });
    }
    if (
      mapping.faculty_id !== faculty.id &&
      mapping.substitute_faculty_id !== faculty.id
    ) {
      throw new ForbiddenException({
        message: 'You do not handle this subject.',
        errorCode: 'MAPPING_NOT_OWNED',
      });
    }
    return { faculty, mapping };
  }

  private async fetchClearanceRows(
    mappingId: number,
    studentIds?: number[],
  ): Promise<ClearanceRow[]> {
    try {
      if (studentIds && studentIds.length === 0) return [];
      return await this.prisma.$queryRaw<ClearanceRow[]>(
        studentIds
          ? Prisma.sql`
              SELECT student_id, faculty_subject_class_mapping_id,
                     internal1_cleared, internal2_cleared, project_cleared,
                     assignment_cleared, quiz_cleared
              FROM subject_academic_clearance
              WHERE faculty_subject_class_mapping_id = ${mappingId}
                AND student_id IN (${Prisma.join(studentIds)})
            `
          : Prisma.sql`
              SELECT student_id, faculty_subject_class_mapping_id,
                     internal1_cleared, internal2_cleared, project_cleared,
                     assignment_cleared, quiz_cleared
              FROM subject_academic_clearance
              WHERE faculty_subject_class_mapping_id = ${mappingId}
            `,
      );
    } catch (err) {
      if (isMissingTableError(err)) return [];
      this.logger.error('DB error reading subject_academic_clearance', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** GET /me/subject-no-due/students?mapping_id= — every student in that class, with their current sign-off state for this subject (all false until first marked). */
  async getStudents(userId: number, mappingId: number) {
    const { mapping } = await this.assertOwnsMapping(userId, mappingId);

    const students = await this.prisma.students.findMany({
      where: { class_id: mapping.class_id, status: 'active' },
      select: {
        id: true,
        register_no: true,
        student_id_no: true,
        soa_applications: { select: { first_name: true, last_name: true } },
      },
      orderBy: { register_no: 'asc' },
    });

    const rows = await this.fetchClearanceRows(
      mappingId,
      students.map((s) => s.id),
    );
    const rowByStudent = new Map(rows.map((r) => [r.student_id, r]));

    return students.map((s) => {
      const r = rowByStudent.get(s.id);
      return {
        student_id: s.id,
        register_no: s.register_no ?? s.student_id_no,
        name: s.soa_applications
          ? `${s.soa_applications.first_name} ${s.soa_applications.last_name ?? ''}`.trim()
          : s.student_id_no,
        internal1_cleared: r?.internal1_cleared ?? false,
        internal2_cleared: r?.internal2_cleared ?? false,
        project_cleared: r?.project_cleared ?? false,
        assignment_cleared: r?.assignment_cleared ?? false,
        quiz_cleared: r?.quiz_cleared ?? false,
      };
    });
  }

  /** PATCH /me/subject-no-due/students/:studentId — upserts this faculty's own sign-off row for one student in one subject. */
  async updateStudent(
    userId: number,
    mappingId: number,
    studentId: number,
    patch: Partial<Record<ClearedField, boolean>>,
  ) {
    const { faculty, mapping } = await this.assertOwnsMapping(
      userId,
      mappingId,
    );

    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: { class_id: true },
    });
    if (!student || student.class_id !== mapping.class_id) {
      throw new NotFoundException({
        message: 'Student not found in this class.',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const next: Record<ClearedField, boolean> = {
      internal1_cleared: patch.internal1_cleared ?? false,
      internal2_cleared: patch.internal2_cleared ?? false,
      project_cleared: patch.project_cleared ?? false,
      assignment_cleared: patch.assignment_cleared ?? false,
      quiz_cleared: patch.quiz_cleared ?? false,
    };
    const existing = (await this.fetchClearanceRows(mappingId, [studentId]))[0];
    if (existing) {
      // Only overwrite fields the caller actually sent — everything else keeps its current value.
      for (const f of ALL_CLEARED_FIELDS) {
        if (patch[f] === undefined) next[f] = existing[f];
      }
    }

    try {
      await this.prisma.$executeRaw`
        INSERT INTO subject_academic_clearance
          (student_id, faculty_subject_class_mapping_id, internal1_cleared,
           internal2_cleared, project_cleared, assignment_cleared,
           quiz_cleared, updated_by_faculty_id, updated_at)
        VALUES
          (${studentId}, ${mappingId}, ${next.internal1_cleared},
           ${next.internal2_cleared}, ${next.project_cleared},
           ${next.assignment_cleared}, ${next.quiz_cleared}, ${faculty.id}, now())
        ON CONFLICT (student_id, faculty_subject_class_mapping_id)
        DO UPDATE SET
          internal1_cleared = EXCLUDED.internal1_cleared,
          internal2_cleared = EXCLUDED.internal2_cleared,
          project_cleared = EXCLUDED.project_cleared,
          assignment_cleared = EXCLUDED.assignment_cleared,
          quiz_cleared = EXCLUDED.quiz_cleared,
          updated_by_faculty_id = EXCLUDED.updated_by_faculty_id,
          updated_at = now()
      `;
    } catch (err) {
      if (isMissingTableError(err)) {
        throw new NotFoundException({
          message:
            'Academic no-due is not set up yet — see no_due.query.md for the migration to run.',
          errorCode: 'TABLE_NOT_READY',
        });
      }
      this.logger.error('DB error writing subject_academic_clearance', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    return { student_id: studentId, ...next };
  }

  /**
   * Bulk "Academics cleared" per student, for HoD's No-Due list. A student
   * is cleared only if EVERY subject they're currently taking has a fully
   * ticked sign-off from its handling faculty — an unassigned subject (no
   * faculty_subject_class_mapping yet) can never be cleared, unlike the
   * fee-category-keyword categories elsewhere on this page, which default to
   * cleared when nothing applies. Academics has an actual owner for every
   * subject in a healthy curriculum, so "no one assigned" is a real gap, not
   * a genuine absence of due.
   */
  async getAcademicsClearedMap(
    classId: number,
    studentIds: number[],
  ): Promise<Map<number, boolean>> {
    const result = new Map<number, boolean>(studentIds.map((id) => [id, true]));
    if (studentIds.length === 0) return result;

    const cls = await this.prisma.classes.findUnique({
      where: { id: classId },
      select: { current_semester: true },
    });

    const subjects = await this.prisma.class_subjects.findMany({
      where: {
        class_id: classId,
        semester: cls?.current_semester ?? undefined,
      },
      select: { subject_id: true },
    });
    if (subjects.length === 0) return result; // nothing to clear — vacuously cleared

    const mappings = await this.prisma.faculty_subject_class_mapping.findMany({
      where: {
        class_id: classId,
        academic_year: { in: currentAcademicYearCandidates() },
        subject_id: { in: subjects.map((s) => s.subject_id) },
      },
      select: { id: true },
    });

    // Any subject with nobody assigned to teach it can never be cleared.
    if (mappings.length < subjects.length) {
      for (const id of studentIds) result.set(id, false);
      return result;
    }

    const mappingIds = mappings.map((m) => m.id);
    let rows: ClearanceRow[] = [];
    try {
      rows = await this.prisma.$queryRaw<ClearanceRow[]>`
        SELECT student_id, faculty_subject_class_mapping_id,
               internal1_cleared, internal2_cleared, project_cleared,
               assignment_cleared, quiz_cleared
        FROM subject_academic_clearance
        WHERE faculty_subject_class_mapping_id IN (${Prisma.join(mappingIds)})
          AND student_id IN (${Prisma.join(studentIds)})
      `;
    } catch (err) {
      if (!isMissingTableError(err)) {
        this.logger.error('DB error reading subject_academic_clearance', err);
      }
      for (const id of studentIds) result.set(id, false);
      return result;
    }

    const clearedMappingsByStudent = new Map<number, Set<number>>();
    for (const r of rows) {
      if (!isRowFullyCleared(r)) continue;
      const set =
        clearedMappingsByStudent.get(r.student_id) ?? new Set<number>();
      set.add(r.faculty_subject_class_mapping_id);
      clearedMappingsByStudent.set(r.student_id, set);
    }

    for (const id of studentIds) {
      const cleared = clearedMappingsByStudent.get(id) ?? new Set<number>();
      result.set(
        id,
        mappingIds.every((mid) => cleared.has(mid)),
      );
    }
    return result;
  }
}
