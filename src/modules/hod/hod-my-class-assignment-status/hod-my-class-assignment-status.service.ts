import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AssignmentsService } from 'src/modules/faculty/assignments/assignments.service';
import { StudentAssignmentStatusService } from 'src/modules/faculty/student-assignment-status/student-assignment-status.service';

const ROMAN_YEAR = ['I', 'II', 'III', 'IV', 'V', 'VI'];
function yearLabelForSemester(semester: number | null): string | null {
  if (semester == null) return null;
  const yearIndex = Math.ceil(semester / 2) - 1;
  return ROMAN_YEAR[yearIndex] ?? String(yearIndex + 1);
}

@Injectable()
export class HodMyClassAssignmentStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assignmentsService: AssignmentsService,
    private readonly studentAssignmentStatusService: StudentAssignmentStatusService,
  ) {}

  /**
   * GET /hod/my-class/assignment-status?class_id=&subject_id=&assignment_id=
   * The HoD is also a `faculty` row, so this reuses AssignmentsService's own
   * self-service methods directly (userId, not a role-branching JwtPayload —
   * those methods never branch on role, only on the caller's own faculty_id)
   * rather than duplicating the ownership/lookup logic.
   */
  async getOverview(
    userId: number,
    classId?: number,
    subjectId?: number,
    assignmentId?: number,
  ) {
    const handledRaw = await this.assignmentsService.getHandledClasses(userId);

    // getHandledClasses() returns one row per (class, subject, academic_year)
    // mapping and is already ordered most-recent-academic_year-first — dedupe
    // to one row per (class, subject) so a re-mapped-every-year subject
    // doesn't appear as duplicate dropdown options.
    const seen = new Set<string>();
    const handledClasses = handledRaw.filter((h) => {
      const key = `${h.class_id}-${h.subject_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (handledClasses.length === 0) {
      return {
        handled_classes: [],
        assignments: [],
        assignment: null,
        students: [],
      };
    }

    const selectedClass =
      (classId != null && subjectId != null
        ? handledClasses.find(
            (h) => h.class_id === classId && h.subject_id === subjectId,
          )
        : undefined) ?? handledClasses[0];

    const assignmentsPage = await this.assignmentsService.findAll(
      {
        class_id: selectedClass.class_id,
        subject_id: selectedClass.subject_id,
        page: 1,
        limit: 100,
        skip: 0,
      },
      userId,
    );
    const assignments = assignmentsPage.data;

    if (assignments.length === 0) {
      return {
        handled_classes: handledClasses,
        selected_class: selectedClass,
        assignments: [],
        assignment: null,
        students: [],
      };
    }

    const selectedAssignment =
      (assignmentId != null
        ? assignments.find((a) => a.id === assignmentId)
        : undefined) ?? assignments[0];

    // AssignmentsService's own ASSIGNMENT_SELECT/toResponse doesn't include
    // due_date/max_marks — every other consumer of that shape only needs the
    // fields it already returns — so those two are fetched separately here
    // rather than widening a shape shared with the Faculty-facing endpoints.
    const [details, students] = await Promise.all([
      this.prisma.assignments.findUnique({
        where: { id: selectedAssignment.id },
        select: { due_date: true, max_marks: true },
      }),
      this.assignmentsService.getAssignmentStudents(
        selectedAssignment.id,
        userId,
      ),
    ]);

    // getAssignmentStudents() doesn't return email (only used internally as
    // a name fallback) — fetched separately for display, same reasoning.
    const studentIds = students.map((s) => s.student_id);
    const emailRows = studentIds.length
      ? await this.prisma.students.findMany({
          where: { id: { in: studentIds } },
          select: { id: true, users: { select: { email: true } } },
        })
      : [];
    const emailById = new Map(emailRows.map((r) => [r.id, r.users.email]));

    return {
      handled_classes: handledClasses,
      selected_class: {
        ...selectedClass,
        year_label: yearLabelForSemester(selectedClass.semester),
      },
      assignments,
      assignment: {
        ...selectedAssignment,
        due_date: details?.due_date ?? null,
        max_marks: details?.max_marks ?? null,
      },
      students: students.map((s) => ({
        ...s,
        email: emailById.get(s.student_id) ?? null,
      })),
    };
  }

  /** PATCH /hod/my-class/assignment-status/mark */
  async mark(
    userId: number,
    assignmentId: number,
    studentId: number,
    statusId: number | undefined,
    isSubmitted: boolean,
  ) {
    if (statusId == null) {
      return this.studentAssignmentStatusService.create(
        {
          assignment_id: assignmentId,
          student_id: studentId,
          is_submitted: isSubmitted,
        },
        userId,
      );
    }
    return this.studentAssignmentStatusService.update(
      statusId,
      { is_submitted: isSubmitted },
      userId,
    );
  }
}
