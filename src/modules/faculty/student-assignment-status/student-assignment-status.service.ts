import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { paginate } from 'src/common/dto/pagination.dto';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { CreateStudentAssignmentStatusDto } from './dto/create-student-assignment-status.dto';
import { UpdateStudentAssignmentStatusDto } from './dto/update-student-assignment-status.dto';
import { ListStudentAssignmentStatusQueryDto } from './dto/list-student-assignment-status-query.dto';

function prismaErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
}

const STATUS_SELECT = {
  id: true,
  is_submitted: true,
  marked_at: true,
  assignments: {
    select: {
      id: true,
      sequence_no: true,
      title: true,
      academic_year: true,
      semester: true,
      classes: { select: { id: true, section: true } },
      subjects: { select: { id: true, name: true, subject_code: true } },
    },
  },
  students: {
    select: {
      id: true,
      student_id_no: true,
      soa_applications: { select: { first_name: true, last_name: true } },
      users: { select: { email: true } },
    },
  },
  faculty: {
    select: { id: true, first_name: true, last_name: true },
  },
} as const;

interface StatusRow {
  id: number;
  is_submitted: boolean;
  marked_at: Date | null;
  assignments: {
    id: number;
    sequence_no: number;
    title: string | null;
    academic_year: string;
    semester: number;
    classes: { id: number; section: string };
    subjects: { id: number; name: string; subject_code: string };
  };
  students: {
    id: number;
    student_id_no: string;
    soa_applications: { first_name: string; last_name: string | null } | null;
    users: { email: string };
  };
  faculty: { id: number; first_name: string; last_name: string } | null;
}

function resolveStudentName(student: StatusRow['students']): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users.email;
}

function toResponse(row: StatusRow) {
  return {
    id: row.id,
    is_submitted: row.is_submitted,
    marked_at: row.marked_at,
    assignment: {
      id: row.assignments.id,
      sequence_no: row.assignments.sequence_no,
      title: row.assignments.title,
      academic_year: row.assignments.academic_year,
      semester: row.assignments.semester,
      class: row.assignments.classes,
      subject: row.assignments.subjects,
    },
    student: {
      id: row.students.id,
      student_id_no: row.students.student_id_no,
      name: resolveStudentName(row.students),
    },
    marked_by_faculty: row.faculty,
  };
}

@Injectable()
export class StudentAssignmentStatusService {
  private readonly logger = new Logger(StudentAssignmentStatusService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /student-assignment-status (Faculty only).
   * The caller must own assignment_id (assignments.faculty_id); student_id
   * must belong to that assignment's class.
   */
  async create(dto: CreateStudentAssignmentStatusDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const assignment = await this.prisma.assignments.findUnique({
      where: { id: dto.assignment_id },
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }
    if (assignment.faculty_id !== faculty.id) {
      throw new ForbiddenException('You may only mark assignments you created');
    }

    const student = await this.prisma.students.findUnique({
      where: { id: dto.student_id },
    });
    if (!student) {
      throw new NotFoundException('Student not found');
    }
    if (student.class_id !== assignment.class_id) {
      throw new UnprocessableEntityException(
        "This student does not belong to the assignment's class",
      );
    }

    try {
      const status = await this.prisma.student_assignment_status.create({
        data: {
          assignment_id: dto.assignment_id,
          student_id: dto.student_id,
          is_submitted: dto.is_submitted ?? false,
          marked_by_faculty_id: faculty.id,
          marked_at: new Date(),
        },
        select: STATUS_SELECT,
      });

      this.logger.log(
        `Student assignment status created: id=${status.id} assignment=${dto.assignment_id} student=${dto.student_id}`,
      );
      return toResponse(status);
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2002') {
        throw new ConflictException(
          'A status record already exists for this assignment and student — use PATCH to update it',
        );
      }
      throw err;
    }
  }

  /** GET /student-assignment-status — Faculty (own assignments) / Student (own records only). */
  async findAll(
    query: ListStudentAssignmentStatusQueryDto,
    currentUser: JwtPayload,
  ) {
    const where: Record<string, unknown> = {
      assignment_id: query.assignment_id,
      student_id: query.student_id,
      is_submitted: query.is_submitted,
    };

    if (currentUser.role === ROLES.FACULTY || currentUser.role === ROLES.HOD) {
      const faculty = await this.resolveFacultyByUserId(currentUser.sub);
      where.assignments = { faculty_id: faculty.id };
    } else if (currentUser.role === ROLES.STUDENT) {
      const student = await this.prisma.students.findUnique({
        where: { user_id: currentUser.sub },
      });
      if (!student) {
        throw new NotFoundException(
          'Student profile not found for the authenticated user',
        );
      }
      where.student_id = student.id;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.student_assignment_status.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { id: 'desc' },
        select: STATUS_SELECT,
      }),
      this.prisma.student_assignment_status.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  /** GET /student-assignment-status/:id — Faculty (own assignments) / Student (own record). */
  async findOne(id: number, currentUser: JwtPayload) {
    const status = await this.prisma.student_assignment_status.findUnique({
      where: { id },
      select: STATUS_SELECT,
    });
    if (!status) {
      throw new NotFoundException('Status record not found');
    }

    if (currentUser.role === ROLES.FACULTY || currentUser.role === ROLES.HOD) {
      const faculty = await this.resolveFacultyByUserId(currentUser.sub);
      const assignment = await this.prisma.assignments.findUnique({
        where: { id: status.assignments.id },
      });
      if (assignment?.faculty_id !== faculty.id) {
        throw new ForbiddenException(
          'You may only view status records for assignments you created',
        );
      }
    } else if (currentUser.role === ROLES.STUDENT) {
      const student = await this.prisma.students.findUnique({
        where: { user_id: currentUser.sub },
      });
      if (!student || status.students.id !== student.id) {
        throw new ForbiddenException(
          'You may only view your own status records',
        );
      }
    }

    return toResponse(status);
  }

  /** PATCH /student-assignment-status/:id (Faculty only — owner of the assignment). */
  async update(
    id: number,
    dto: UpdateStudentAssignmentStatusDto,
    userId: number,
  ) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const existing = await this.prisma.student_assignment_status.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Status record not found');
    }

    const assignment = await this.prisma.assignments.findUnique({
      where: { id: existing.assignment_id },
    });
    if (assignment?.faculty_id !== faculty.id) {
      throw new ForbiddenException(
        'You may only edit status records for assignments you created',
      );
    }

    const status = await this.prisma.student_assignment_status.update({
      where: { id },
      data: {
        is_submitted: dto.is_submitted,
        marked_by_faculty_id: faculty.id,
        marked_at: new Date(),
      },
      select: STATUS_SELECT,
    });

    return toResponse(status);
  }

  /** DELETE /student-assignment-status/:id (Faculty only — owner of the assignment). */
  async remove(id: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const existing = await this.prisma.student_assignment_status.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Status record not found');
    }

    const assignment = await this.prisma.assignments.findUnique({
      where: { id: existing.assignment_id },
    });
    if (assignment?.faculty_id !== faculty.id) {
      throw new ForbiddenException(
        'You may only delete status records for assignments you created',
      );
    }

    await this.prisma.student_assignment_status.delete({ where: { id } });

    this.logger.log(`Student assignment status deleted: id=${id}`);
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
