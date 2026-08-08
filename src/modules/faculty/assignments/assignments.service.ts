import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { ListAssignmentQueryDto } from './dto/list-assignment-query.dto';

function prismaErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
}

const ASSIGNMENT_SELECT = {
  id: true,
  academic_year: true,
  semester: true,
  sequence_no: true,
  title: true,
  classes: { select: { id: true, section: true } },
  subjects: { select: { id: true, name: true, subject_code: true } },
} as const;

interface AssignmentRow {
  id: number;
  academic_year: string;
  semester: number;
  sequence_no: number;
  title: string | null;
  classes: { id: number; section: string };
  subjects: { id: number; name: string; subject_code: string };
}

function toResponse(row: AssignmentRow) {
  return {
    id: row.id,
    academic_year: row.academic_year,
    semester: row.semester,
    sequence_no: row.sequence_no,
    title: row.title,
    class: row.classes,
    subject: row.subjects,
  };
}

interface HandledClassRow {
  class_id: number;
  subject_id: number;
  academic_year: string;
  classes: {
    section: string;
    current_semester: number | null;
    departments: { name: string };
  };
  subjects: { name: string; subject_code: string };
}

/** No generic "display name" column on `students` - same fallback chain used across every other faculty-facing module in this codebase. */
function resolveStudentName(student: {
  soa_applications: { first_name: string; last_name: string | null } | null;
  users: { email: string };
}): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users.email;
}

@Injectable()
export class AssignmentsService {
  private readonly logger = new Logger(AssignmentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /assignments (Faculty only).
   * The caller must be mapped (faculty_subject_class_mapping) to teach
   * subject_id for class_id in dto.academic_year — same ownership check
   * used before every other Faculty write in this codebase.
   */
  async create(dto: CreateAssignmentDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const klass = await this.prisma.classes.findUnique({
      where: { id: dto.class_id },
    });
    if (!klass) {
      throw new NotFoundException('Class not found');
    }

    const subject = await this.prisma.subjects.findUnique({
      where: { id: dto.subject_id },
    });
    if (!subject) {
      throw new NotFoundException('Subject not found');
    }

    const mapping = await this.prisma.faculty_subject_class_mapping.findFirst({
      where: {
        faculty_id: faculty.id,
        subject_id: dto.subject_id,
        class_id: dto.class_id,
        academic_year: dto.academic_year,
      },
    });
    if (!mapping) {
      throw new ForbiddenException(
        'You are not assigned to teach this subject for this class in the given academic year',
      );
    }

    try {
      const assignment = await this.prisma.assignments.create({
        data: {
          class_id: dto.class_id,
          subject_id: dto.subject_id,
          faculty_id: faculty.id,
          academic_year: dto.academic_year,
          semester: dto.semester,
          sequence_no: dto.sequence_no,
          title: dto.title,
        },
        select: ASSIGNMENT_SELECT,
      });

      this.logger.log(
        `Assignment created: id=${assignment.id} faculty=${faculty.id} class=${dto.class_id} subject=${dto.subject_id}`,
      );
      return toResponse(assignment);
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2002') {
        throw new ConflictException(
          'An assignment with this sequence number already exists for this class, subject, academic year, and semester',
        );
      }
      throw err;
    }
  }

  /** GET /assignments (Faculty only — own records). */
  async findAll(query: ListAssignmentQueryDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const where = {
      faculty_id: faculty.id,
      class_id: query.class_id,
      subject_id: query.subject_id,
      academic_year: query.academic_year,
      semester: query.semester,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.assignments.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: [{ id: 'desc' }],
        select: ASSIGNMENT_SELECT,
      }),
      this.prisma.assignments.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  /**
   * GET /me/handled-classes (Faculty only) — every (class, subject) the
   * caller is mapped to teach, via faculty_subject_class_mapping. One row
   * per mapping, not deduped by class alone - a faculty teaching two
   * subjects to the same class sees it twice, once per subject, since the
   * next step (picking which assignment to mark) is itself subject-scoped.
   * Feeds the "select the class you're handling" step of the No-Due tile's
   * assignment-submission flow, ahead of GET /me/assignments?class_id=&
   * subject_id= and GET /me/assignments/:id/students.
   */
  async getHandledClasses(userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const mappings = await this.prisma.faculty_subject_class_mapping.findMany({
      where: { faculty_id: faculty.id },
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
      // Most recent academic_year first - a faculty who has taught the same
      // subject to five successive batches (confirmed live: one real
      // faculty had 60 mapping rows spanning 2022-2026 through 2026-2030,
      // all sharing the same department/section/subject label) almost
      // always wants the currently-running batch surfaced first, not
      // whichever one happens to sort first by id.
      orderBy: [{ academic_year: 'desc' }, { class_id: 'asc' }, { subject_id: 'asc' }],
    });

    return mappings.map((m: HandledClassRow) => ({
      class_id: m.class_id,
      subject_id: m.subject_id,
      academic_year: m.academic_year,
      section: m.classes.section,
      semester: m.classes.current_semester,
      department_name: m.classes.departments.name,
      subject_name: m.subjects.name,
      subject_code: m.subjects.subject_code,
    }));
  }

  /**
   * GET /me/assignments/:id/students (Faculty only — owner of the
   * assignment). Every student in the assignment's class, left-joined
   * against their own student_assignment_status row for THIS assignment -
   * `status_id: null` and `is_submitted: false` for a student nobody has
   * marked yet, rather than omitting them (the whole point is to show
   * every mapped student, marked or not). The mobile client uses
   * `status_id` to decide POST vs PATCH against
   * /student-assignment-status when marking - no new write endpoint needed,
   * the existing CRUD on that resource already covers both cases.
   */
  async getAssignmentStudents(assignmentId: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const assignment = await this.prisma.assignments.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }
    if (assignment.faculty_id !== faculty.id) {
      throw new ForbiddenException(
        'You may only view students for your own assignments',
      );
    }

    const students = await this.prisma.students.findMany({
      where: { class_id: assignment.class_id },
      select: {
        id: true,
        student_id_no: true,
        soa_applications: { select: { first_name: true, last_name: true } },
        users: { select: { email: true } },
        student_assignment_status: {
          where: { assignment_id: assignmentId },
          select: { id: true, is_submitted: true, marked_at: true },
        },
      },
      orderBy: { student_id_no: 'asc' },
    });

    return students.map((s) => {
      const status = s.student_assignment_status[0] ?? null;
      return {
        student_id: s.id,
        student_id_no: s.student_id_no,
        name: resolveStudentName(s),
        status_id: status?.id ?? null,
        is_submitted: status?.is_submitted ?? false,
        marked_at: status?.marked_at ?? null,
      };
    });
  }

  /** GET /assignments/:id (Faculty only — own record). */
  async findOne(id: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const assignment = await this.prisma.assignments.findUnique({
      where: { id },
      select: { ...ASSIGNMENT_SELECT, faculty_id: true },
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }
    if (assignment.faculty_id !== faculty.id) {
      throw new ForbiddenException('You may only view your own assignments');
    }

    return toResponse(assignment);
  }

  /** PATCH /assignments/:id (Faculty only — own record). Only `title` is editable. */
  async update(id: number, dto: UpdateAssignmentDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const existing = await this.prisma.assignments.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Assignment not found');
    }
    if (existing.faculty_id !== faculty.id) {
      throw new ForbiddenException('You may only edit your own assignments');
    }

    const assignment = await this.prisma.assignments.update({
      where: { id },
      data: { title: dto.title },
      select: ASSIGNMENT_SELECT,
    });

    return toResponse(assignment);
  }

  /**
   * DELETE /assignments/:id (Faculty only — own record).
   * student_assignment_status rows cascade on delete (schema:
   * onDelete: Cascade), so this also clears any submission ticks recorded
   * against this assignment.
   */
  async remove(id: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const existing = await this.prisma.assignments.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Assignment not found');
    }
    if (existing.faculty_id !== faculty.id) {
      throw new ForbiddenException('You may only delete your own assignments');
    }

    await this.prisma.assignments.delete({ where: { id } });

    this.logger.log(`Assignment deleted: id=${id}`);
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
}
