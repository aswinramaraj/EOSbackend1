import {
  BadRequestException,
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
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';
import { ListAttendanceQueryDto } from './dto/list-attendance-query.dto';
import { MarkClassAttendanceDto } from './dto/mark-class-attendance.dto';

function prismaErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
}

const ATTENDANCE_SELECT = {
  id: true,
  attendance_date: true,
  status: true,
  classes: {
    select: {
      id: true,
      section: true,
      departments: { select: { id: true, name: true, code: true } },
    },
  },
  subjects: { select: { id: true, name: true, subject_code: true } },
  faculty: { select: { id: true, first_name: true, last_name: true } },
  users: {
    select: {
      id: true,
      email: true,
      faculty: { select: { first_name: true, last_name: true } },
      non_teaching_staff: { select: { first_name: true, last_name: true } },
    },
  },
  students: {
    select: {
      id: true,
      student_id_no: true,
      roll_no: true,
      soa_applications: { select: { first_name: true, last_name: true } },
    },
  },
} as const;

interface AttendanceMarkerRow {
  id: number;
  email: string;
  faculty: { first_name: string; last_name: string } | null;
  non_teaching_staff: { first_name: string; last_name: string | null }[];
}

interface AttendanceRow {
  id: number;
  attendance_date: Date;
  status: string;
  classes: {
    id: number;
    section: string;
    departments: { id: number; name: string; code: string };
  };
  subjects: { id: number; name: string; subject_code: string } | null;
  faculty: { id: number; first_name: string; last_name: string } | null;
  users: AttendanceMarkerRow;
  students: {
    id: number;
    student_id_no: string;
    roll_no: string | null;
    soa_applications: { first_name: string; last_name: string | null } | null;
  };
}

/**
 * `marked_by_user_id` (generic — any role) is always present; the direct
 * `faculty` relation (via `marked_by_faculty_id`) is only set when the
 * marker is teaching staff (null for Secretary-marked rows). Mirrors
 * VenuesService.resolveBookerName's faculty-then-non_teaching_staff-then-
 * email fallback for display purposes.
 */
function resolveMarkerName(marker: AttendanceMarkerRow): string {
  if (marker.faculty) {
    return `${marker.faculty.first_name} ${marker.faculty.last_name}`;
  }
  const staff = marker.non_teaching_staff[0];
  if (staff) {
    return staff.last_name
      ? `${staff.first_name} ${staff.last_name}`
      : staff.first_name;
  }
  return marker.email;
}

function toResponse(record: AttendanceRow) {
  return {
    id: record.id,
    date: record.attendance_date,
    status: record.status,
    class: {
      id: record.classes.id,
      section: record.classes.section,
      department: record.classes.departments,
    },
    subject: record.subjects,
    faculty: record.faculty,
    marked_by: {
      id: record.users.id,
      name: resolveMarkerName(record.users),
    },
    student: {
      id: record.students.id,
      student_id_no: record.students.student_id_no,
      roll_no: record.students.roll_no,
      first_name: record.students.soa_applications?.first_name ?? null,
      last_name: record.students.soa_applications?.last_name ?? null,
    },
  };
}

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /attendance (Faculty / Secretary).
   *
   * Marks attendance for every student in dto.records for one class session
   * (class + optional subject + date), all inside a single transaction —
   * either every row is inserted or none are. `marked_by_user_id` is always
   * set from the caller's own id; `marked_by_faculty_id` is only populated
   * when the caller actually has a faculty profile (Secretary doesn't).
   */
  async create(dto: CreateAttendanceDto, currentUser: JwtPayload) {
    const userId = currentUser.sub;
    const faculty =
      currentUser.role === ROLES.FACULTY
        ? await this.resolveFacultyByUserId(userId)
        : null;

    const klass = await this.prisma.classes.findUnique({
      where: { id: dto.class_id },
      select: {
        id: true,
        section: true,
        departments: { select: { id: true, name: true, code: true } },
      },
    });
    if (!klass) {
      throw new NotFoundException('Class not found');
    }

    let subject: { id: number; name: string; subject_code: string } | null =
      null;
    if (dto.subject_id !== undefined) {
      subject = await this.prisma.subjects.findUnique({
        where: { id: dto.subject_id },
        select: { id: true, name: true, subject_code: true },
      });
      if (!subject) {
        throw new NotFoundException('Subject not found');
      }
    }

    const studentIds = dto.records.map((r) => r.student_id);
    if (new Set(studentIds).size !== studentIds.length) {
      throw new BadRequestException('Duplicate student_id values in records');
    }

    const students = await this.prisma.students.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, class_id: true },
    });

    const foundIds = new Set(students.map((s) => s.id));
    const missingIds = studentIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      throw new NotFoundException(
        `Student(s) not found: ${missingIds.join(', ')}`,
      );
    }

    const notInClassIds = students
      .filter((s) => s.class_id !== dto.class_id)
      .map((s) => s.id);
    if (notInClassIds.length > 0) {
      throw new BadRequestException(
        `Student(s) do not belong to class ${dto.class_id}: ${notInClassIds.join(', ')}`,
      );
    }

    const attendanceDate = new Date(dto.date);
    const subjectFilterValue = dto.subject_id ?? null;

    let created: Array<{ id: number; student_id: number; status: string }>;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        // Postgres treats NULL <> NULL in unique indexes, so
        // @@unique([student_id, class_id, subject_id, attendance_date])
        // does NOT actually block two concurrent creates for the same
        // student/class/date when subject_id is null (the common case here,
        // since it's optional) — two requests could both pass the
        // check-then-write below with no DB-level backstop. An advisory
        // lock scoped to this exact (class, subject, date) combination
        // serializes concurrent create() calls for it, so the second
        // request's own check below correctly sees what the first one just
        // inserted, rather than racing past it.
        const lockKey = `attendance:${dto.class_id}:${subjectFilterValue ?? 'null'}:${dto.date}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

        const alreadyMarked = await tx.attendance_records.findMany({
          where: {
            class_id: dto.class_id,
            subject_id: subjectFilterValue,
            attendance_date: attendanceDate,
            student_id: { in: studentIds },
          },
          select: { student_id: true },
        });
        if (alreadyMarked.length > 0) {
          throw new ConflictException(
            `Attendance already marked for student(s): ${alreadyMarked.map((r) => r.student_id).join(', ')}`,
          );
        }

        return Promise.all(
          dto.records.map((r) =>
            tx.attendance_records.create({
              data: {
                student_id: r.student_id,
                class_id: dto.class_id,
                subject_id: dto.subject_id,
                attendance_date: attendanceDate,
                status: r.status,
                marked_by_faculty_id: faculty?.id,
                marked_by_user_id: userId,
              },
              select: { id: true, student_id: true, status: true },
            }),
          ),
        );
      });
    } catch (err: unknown) {
      if (err instanceof ConflictException) {
        throw err;
      }
      if (prismaErrorCode(err) === 'P2002') {
        throw new ConflictException(
          'Attendance already marked for one or more students',
        );
      }
      this.logger.error('Attendance creation transaction failed', err);
      throw err;
    }

    this.logger.log(
      `Attendance marked: class=${dto.class_id} date=${dto.date} records=${created.length}`,
    );

    return {
      class: {
        id: klass.id,
        section: klass.section,
        department: klass.departments,
      },
      subject,
      faculty: faculty
        ? {
            id: faculty.id,
            first_name: faculty.first_name,
            last_name: faculty.last_name,
          }
        : null,
      date: dto.date,
      total_present: created.filter((r) => r.status === 'present').length,
      total_absent: created.filter((r) => r.status === 'absent').length,
      total_on_duty: created.filter((r) => r.status === 'on_duty').length,
      records: created,
    };
  }

  /**
   * POST /me/classes/:class_id/attendance (Faculty only).
   *
   * Distinct from POST /attendance above: this route requires subject_id
   * (not optional) and additionally verifies the caller is actually mapped
   * (faculty_subject_class_mapping) to teach that subject for this class —
   * a check the older endpoint doesn't perform. The mapping check is scoped
   * by academic_year when provided, so a mapping that lapsed in a prior year
   * doesn't keep authorizing attendance today (same convention as Lesson
   * Plans/LMS Notes/Timetable's equivalent checks). Duplicate detection here
   * is whole-combination (any existing row for class+subject+date blocks the
   * entire batch with one 409), matching this endpoint's documented
   * contract, rather than the older endpoint's per-student duplicate list.
   */
  async markForClass(
    classId: number,
    dto: MarkClassAttendanceDto,
    userId: number,
  ) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const klass = await this.prisma.classes.findUnique({
      where: { id: classId },
    });
    if (!klass) {
      throw new NotFoundException({
        message: 'Class not found',
        errorCode: 'CLASS_NOT_FOUND',
      });
    }

    const subject = await this.prisma.subjects.findUnique({
      where: { id: dto.subject_id },
    });
    if (!subject) {
      throw new NotFoundException({
        message: 'Subject not found',
        errorCode: 'SUBJECT_NOT_FOUND',
      });
    }

    const mapping = await this.prisma.faculty_subject_class_mapping.findFirst({
      where: {
        faculty_id: faculty.id,
        subject_id: dto.subject_id,
        class_id: classId,
        ...(dto.academic_year !== undefined && {
          academic_year: dto.academic_year,
        }),
      },
    });
    if (!mapping) {
      throw new ForbiddenException({
        message: 'You are not assigned to teach this subject for this class',
        errorCode: 'NOT_MAPPED_TO_TEACH',
      });
    }

    const attendanceDate = new Date(dto.attendance_date);
    const today = new Date(new Date().toISOString().slice(0, 10));
    if (attendanceDate > today) {
      throw new BadRequestException(
        'attendance_date must not be in the future',
      );
    }

    const studentIds = dto.records.map((r) => r.student_id);
    if (new Set(studentIds).size !== studentIds.length) {
      throw new BadRequestException('Duplicate student_id values in records');
    }

    const students = await this.prisma.students.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, class_id: true },
    });

    const foundIds = new Set(students.map((s) => s.id));
    const missingIds = studentIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      throw new NotFoundException(
        `Student(s) not found: ${missingIds.join(', ')}`,
      );
    }

    const notInClassIds = students
      .filter((s) => s.class_id !== classId)
      .map((s) => s.id);
    if (notInClassIds.length > 0) {
      throw new UnprocessableEntityException({
        message: 'One or more students do not belong to this class',
        errorCode: 'STUDENT_NOT_IN_CLASS',
      });
    }

    const existing = await this.prisma.attendance_records.findFirst({
      where: {
        class_id: classId,
        subject_id: dto.subject_id,
        attendance_date: attendanceDate,
      },
    });
    if (existing) {
      throw new ConflictException({
        message:
          'Attendance has already been marked for this class, subject, and date',
        errorCode: 'ATTENDANCE_ALREADY_MARKED',
      });
    }

    let created: Array<{ id: number }>;
    try {
      created = await this.prisma.$transaction(
        dto.records.map((r) =>
          this.prisma.attendance_records.create({
            data: {
              student_id: r.student_id,
              class_id: classId,
              subject_id: dto.subject_id,
              attendance_date: attendanceDate,
              status: r.status,
              marked_by_faculty_id: faculty.id,
              marked_by_user_id: userId,
            },
            select: { id: true },
          }),
        ),
      );
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2002') {
        throw new ConflictException({
          message:
            'Attendance has already been marked for this class, subject, and date',
          errorCode: 'ATTENDANCE_ALREADY_MARKED',
        });
      }
      this.logger.error('Bulk class attendance transaction failed', err);
      throw err;
    }

    this.logger.log(
      `Class attendance marked: class=${classId} subject=${dto.subject_id} date=${dto.attendance_date} marked=${created.length}`,
    );

    return {
      class_id: classId,
      attendance_date: dto.attendance_date,
      marked: created.length,
    };
  }

  /** GET /attendance (Admin/HoD/Faculty/Student/Parent) — filtered, paginated, role-scoped. */
  async findAll(query: ListAttendanceQueryDto, currentUser: JwtPayload) {
    const where: Record<string, unknown> = {
      class_id: query.class_id,
      student_id: query.student_id,
    };

    if (query.date) {
      where.attendance_date = new Date(query.date);
    } else if (query.from_date ?? query.to_date) {
      where.attendance_date = {
        ...(query.from_date && { gte: new Date(query.from_date) }),
        ...(query.to_date && { lte: new Date(query.to_date) }),
      };
    }

    await this.applyRoleScoping(where, currentUser, query.student_id);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.attendance_records.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { attendance_date: 'desc' },
        select: ATTENDANCE_SELECT,
      }),
      this.prisma.attendance_records.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  /** GET /attendance/:id (Admin/HoD/Faculty/Student/Parent) — role-scoped. */
  async findOne(id: number, currentUser: JwtPayload) {
    const record = await this.prisma.attendance_records.findUnique({
      where: { id },
      select: ATTENDANCE_SELECT,
    });

    if (!record) {
      throw new NotFoundException('Attendance record not found');
    }

    await this.assertCanViewStudent(record.students.id, currentUser);

    return toResponse(record);
  }

  /**
   * PATCH /attendance/:id (Faculty / Secretary — only the one who marked it).
   * `status` is the only editable field. Ownership is checked against the
   * generic `marked_by_user_id` rather than the faculty-only column, so it
   * works the same way regardless of which role created the record.
   */
  async update(id: number, dto: UpdateAttendanceDto, userId: number) {
    const record = await this.prisma.attendance_records.findUnique({
      where: { id },
    });
    if (!record) {
      throw new NotFoundException('Attendance record not found');
    }

    if (record.marked_by_user_id !== userId) {
      throw new ForbiddenException(
        'You may only edit attendance records you marked yourself',
      );
    }

    const updated = await this.prisma.attendance_records.update({
      where: { id },
      data: { status: dto.status },
      select: ATTENDANCE_SELECT,
    });

    return toResponse(updated);
  }

  /**
   * GET /me/classes/:class_id/roster (Faculty / Secretary).
   *
   * The roster a "mark attendance" screen needs before it can render one row
   * per student — admissions/students has no working list endpoint of its
   * own to serve this, so it lives here instead, scoped to exactly what
   * attendance-marking needs (id, roll number, name), not a general-purpose
   * student listing. Only active students are included; a student who has
   * left doesn't need attendance marked against them.
   */
  async getClassRoster(classId: number) {
    const klass = await this.prisma.classes.findUnique({
      where: { id: classId },
    });
    if (!klass) {
      throw new NotFoundException({
        message: 'Class not found',
        errorCode: 'CLASS_NOT_FOUND',
      });
    }

    const students = await this.prisma.students.findMany({
      where: { class_id: classId, status: 'active' },
      select: {
        id: true,
        student_id_no: true,
        roll_no: true,
        soa_applications: { select: { first_name: true, last_name: true } },
        users: { select: { email: true } },
      },
      orderBy: { roll_no: 'asc' },
    });

    return students.map((s) => ({
      id: s.id,
      student_id_no: s.student_id_no,
      roll_no: s.roll_no,
      first_name: s.soa_applications?.first_name ?? null,
      last_name: s.soa_applications?.last_name ?? null,
      // soa_applications is nullable — students without a linked
      // application have no first_name/last_name, so callers should fall
      // back to this rather than student_id_no (same convention used
      // throughout the rest of the app for this exact gap).
      email: s.users.email,
    }));
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

  /**
   * STUDENT and PARENT are restricted to their own (or their children's) records —
   * workflow.md scopes both roles to "their own"/"their son/daughter" explicitly.
   * ADMIN, HOD, FACULTY and SECRETARY are unrestricted (staff-tier access,
   * matching how the Faculty and Faculty Mapping modules treat those roles
   * elsewhere).
   */
  private async applyRoleScoping(
    where: Record<string, unknown>,
    user: JwtPayload,
    requestedStudentId?: number,
  ) {
    if (user.role === ROLES.STUDENT) {
      const student = await this.prisma.students.findUnique({
        where: { user_id: user.sub },
      });
      if (!student) {
        throw new NotFoundException(
          'Student profile not found for the authenticated user',
        );
      }
      if (
        requestedStudentId !== undefined &&
        requestedStudentId !== student.id
      ) {
        throw new ForbiddenException(
          'You may only view your own attendance records',
        );
      }
      where.student_id = student.id;
    } else if (user.role === ROLES.PARENT) {
      const mappings = await this.prisma.parent_student_mapping.findMany({
        where: { parent_user_id: user.sub },
        select: { student_id: true },
      });
      const childIds = mappings.map((m) => m.student_id);

      if (requestedStudentId !== undefined) {
        if (!childIds.includes(requestedStudentId)) {
          throw new ForbiddenException(
            'You may only view attendance records of your own children',
          );
        }
        where.student_id = requestedStudentId;
      } else {
        where.student_id = { in: childIds };
      }
    }
  }

  private async assertCanViewStudent(studentId: number, user: JwtPayload) {
    if (user.role === ROLES.STUDENT) {
      const student = await this.prisma.students.findUnique({
        where: { user_id: user.sub },
      });
      if (!student || student.id !== studentId) {
        throw new ForbiddenException(
          'You may only view your own attendance records',
        );
      }
    } else if (user.role === ROLES.PARENT) {
      const mapping = await this.prisma.parent_student_mapping.findFirst({
        where: { parent_user_id: user.sub, student_id: studentId },
      });
      if (!mapping) {
        throw new ForbiddenException(
          'You may only view attendance records of your own children',
        );
      }
    }
  }
}
