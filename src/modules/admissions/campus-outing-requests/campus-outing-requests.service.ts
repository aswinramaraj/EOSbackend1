import {
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
import { ListCampusOutingRequestsQueryDto } from './dto/list-campus-outing-requests-query.dto';
import { FacultyApproveOutingRequestDto } from './dto/faculty-approve-outing-request.dto';
import { HodApproveOutingRequestDto } from './dto/hod-approve-outing-request.dto';

const OUTING_REQUEST_SELECT = {
  id: true,
  student_id: true,
  from_date: true,
  to_date: true,
  start_time: true,
  return_time: true,
  reason: true,
  status: true,
  approved_by_faculty_id: true,
  approved_by_hod_user_id: true,
  created_at: true,
  students: {
    select: {
      id: true,
      student_id_no: true,
      class_id: true,
      soa_applications: { select: { first_name: true, last_name: true } },
      users: { select: { id: true, email: true } },
      classes: {
        select: {
          section: true,
          departments: { select: { name: true } },
        },
      },
    },
  },
} as const;

interface OutingRequestRow {
  id: number;
  student_id: number;
  from_date: Date;
  to_date: Date;
  start_time: Date;
  return_time: Date | null;
  reason: string | null;
  status: string;
  approved_by_faculty_id: number | null;
  approved_by_hod_user_id: number | null;
  created_at: Date;
  students: {
    id: number;
    student_id_no: string;
    class_id: number | null;
    soa_applications: { first_name: string; last_name: string | null } | null;
    users: { id: number; email: string };
    classes: { section: string; departments: { name: string } } | null;
  };
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toTimeOnly(date: Date): string {
  return date.toISOString().slice(11, 16);
}

/** Same name-resolution rationale as StudentLeavesService.resolveStudentName. */
function resolveStudentName(student: OutingRequestRow['students']): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users.email;
}

function toResponse(request: OutingRequestRow) {
  return {
    id: request.id,
    student_id: request.student_id,
    student: {
      id: request.students.id,
      student_id_no: request.students.student_id_no,
      name: resolveStudentName(request.students),
      section: request.students.classes?.section ?? null,
      department_name: request.students.classes?.departments.name ?? null,
    },
    from_date: toDateOnly(request.from_date),
    to_date: toDateOnly(request.to_date),
    start_time: toTimeOnly(request.start_time),
    return_time: request.return_time ? toTimeOnly(request.return_time) : null,
    reason: request.reason,
    status: request.status,
    approved_by_faculty_id: request.approved_by_faculty_id,
    approved_by_hod_user_id: request.approved_by_hod_user_id,
    created_at: request.created_at,
  };
}

/**
 * Faculty/HoD-facing review of campus_outing_requests — deliberately
 * mirrors StudentLeavesService's findAll/facultyApprove/hodApprove
 * near-exactly, on its own table. See prisma/README.md for why this is a
 * separate table from student_leaves rather than a routing flag on it.
 */
@Injectable()
export class CampusOutingRequestsService {
  private readonly logger = new Logger(CampusOutingRequestsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/campus-outing-requests (Faculty or HoD).
   *
   * Same scoping as StudentLeavesService.findAll: Faculty gets their own
   * mentor-review queue via class_mentors; HoD gets their own department's
   * queue, excluding status='pending' by default (hasn't reached the
   * mentor yet).
   */
  async findAll(query: ListCampusOutingRequestsQueryDto, user: JwtPayload) {
    let where: Record<string, unknown>;

    if (user.role === ROLES.HOD) {
      const hod = await this.resolveFacultyByUserId(user.sub);
      where = {
        status: query.status ?? { not: 'pending' },
        students: { classes: { department_id: hod.department_id } },
      };
    } else {
      const faculty = await this.resolveFacultyByUserId(user.sub);

      const mentorClasses = await this.prisma.class_mentors.findMany({
        where: { faculty_id: faculty.id },
        select: { class_id: true },
      });
      const classIds = mentorClasses.map((m) => m.class_id);

      if (classIds.length === 0) {
        return paginate([], 0, query);
      }

      where = {
        status: query.status,
        students: { class_id: { in: classIds } },
      };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.campus_outing_requests.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        select: OUTING_REQUEST_SELECT,
      }),
      this.prisma.campus_outing_requests.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  /** PATCH /me/campus-outing-requests/:id/faculty-approve — Faculty only (the student's assigned mentor). */
  async facultyApprove(
    id: number,
    dto: FacultyApproveOutingRequestDto,
    userId: number,
  ) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const request = await this.prisma.campus_outing_requests.findUnique({
      where: { id },
      include: { students: { select: { class_id: true } } },
    });
    if (!request) {
      throw new NotFoundException({
        message: 'Outing request not found',
        errorCode: 'OUTING_REQUEST_NOT_FOUND',
      });
    }

    const classId = request.students.class_id;
    const mentorMapping =
      classId !== null
        ? await this.prisma.class_mentors.findFirst({
            where: { class_id: classId, faculty_id: faculty.id },
          })
        : null;
    if (!mentorMapping) {
      throw new ForbiddenException({
        message: "You are not the mentor for this student's class",
        errorCode: 'NOT_THE_MENTOR',
      });
    }

    if (request.status !== 'pending') {
      throw new UnprocessableEntityException({
        message: 'This outing request has already been reviewed',
        errorCode: 'ALREADY_DECIDED',
      });
    }

    const updated = await this.prisma.campus_outing_requests.update({
      where: { id },
      data:
        dto.decision === 'rejected'
          ? { status: 'rejected' }
          : { status: 'faculty_approved', approved_by_faculty_id: faculty.id },
      select: OUTING_REQUEST_SELECT,
    });

    this.logger.log(
      `Campus outing request ${id} ${dto.decision === 'rejected' ? 'rejected' : 'faculty-approved'} by faculty=${faculty.id}`,
    );
    return toResponse(updated);
  }

  /** PATCH /me/campus-outing-requests/:id/hod-approve (HoD only). */
  async hodApprove(
    id: number,
    dto: HodApproveOutingRequestDto,
    hodUserId: number,
  ) {
    const request = await this.prisma.campus_outing_requests.findUnique({
      where: { id },
    });
    if (!request) {
      throw new NotFoundException({
        message: 'Outing request not found',
        errorCode: 'OUTING_REQUEST_NOT_FOUND',
      });
    }

    if (request.status === 'pending') {
      throw new UnprocessableEntityException({
        message:
          'This outing request has not been approved by the mentor faculty yet',
        errorCode: 'NOT_FACULTY_APPROVED_YET',
      });
    }

    if (request.status !== 'faculty_approved') {
      throw new UnprocessableEntityException({
        message: 'This outing request has already been reviewed by HoD',
        errorCode: 'ALREADY_DECIDED',
      });
    }

    const updated = await this.prisma.campus_outing_requests.update({
      where: { id },
      data:
        dto.decision === 'rejected'
          ? { status: 'rejected' }
          : { status: 'hod_approved', approved_by_hod_user_id: hodUserId },
      select: OUTING_REQUEST_SELECT,
    });

    this.logger.log(
      `Campus outing request ${id} ${dto.decision === 'rejected' ? 'rejected' : 'hod-approved'} by hod user=${hodUserId}`,
    );
    return toResponse(updated);
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
