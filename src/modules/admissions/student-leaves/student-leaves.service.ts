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
import { CreateStudentLeafDto } from './dto/create-student-leaf.dto';
import { UpdateStudentLeafDto } from './dto/update-student-leaf.dto';
import { ListStudentLeaveQueryDto } from './dto/list-student-leave-query.dto';
import { FacultyApproveLeaveDto } from './dto/faculty-approve-leave.dto';
import { HodApproveLeaveDto } from './dto/hod-approve-leave.dto';

const STUDENT_LEAVE_SELECT = {
  id: true,
  student_id: true,
  from_date: true,
  to_date: true,
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

interface StudentLeaveRow {
  id: number;
  student_id: number;
  from_date: Date;
  to_date: Date;
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

/**
 * No generic "display name" column on `students` — a student's name lives on
 * the admission application it originated from (soa_applications), linked
 * via students.soa_application_id, which is optional. Falls back to the
 * linked user's email for students without one (e.g. manually created rows).
 */
function resolveStudentName(student: StudentLeaveRow['students']): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users.email;
}

function toResponse(leave: StudentLeaveRow) {
  return {
    id: leave.id,
    student_id: leave.student_id,
    student: {
      id: leave.students.id,
      student_id_no: leave.students.student_id_no,
      name: resolveStudentName(leave.students),
      section: leave.students.classes?.section ?? null,
      department_name: leave.students.classes?.departments.name ?? null,
    },
    from_date: leave.from_date,
    to_date: leave.to_date,
    reason: leave.reason,
    status: leave.status,
    approved_by_faculty_id: leave.approved_by_faculty_id,
    approved_by_hod_user_id: leave.approved_by_hod_user_id,
    created_at: leave.created_at,
  };
}

@Injectable()
export class StudentLeavesService {
  private readonly logger = new Logger(StudentLeavesService.name);

  constructor(private readonly prisma: PrismaService) {}

  create(createStudentLeafDto: CreateStudentLeafDto) {
    void createStudentLeafDto;
    return 'This action adds a new studentLeaf';
  }

  /**
   * GET /me/student-leaves (Faculty or HoD).
   *
   * Faculty: the calling faculty's mentor-review queue — every leave
   * request from a student in a class this faculty mentors, via
   * class_mentors. A faculty who mentors no class gets an empty page
   * rather than an error.
   *
   * HoD: every leave request from a student in the HoD's own department,
   * EXCLUDING status='pending' — those haven't even reached the mentor
   * faculty yet, so they're not relevant to the HoD's queue at all (matches
   * the two-stage chain: mentor first, HoD only once status='faculty_approved').
   * If the caller doesn't filter by status, 'pending' is excluded by default
   * for a HoD; an explicit status=pending request from a HoD still returns
   * nothing (there's genuinely nothing there for them).
   *
   * student.section/department_name are included because a Class Mentor
   * can mentor more than one class (class_mentors is one row per
   * class_id, not capped at one) - without this, the mobile review queue
   * would have no way to tell which section a given request belongs to
   * when the mentor covers more than one.
   */
  async findAll(query: ListStudentLeaveQueryDto, user: JwtPayload) {
    let where: Record<string, unknown>;

    if (user.role === ROLES.HOD) {
      const hod = await this.resolveFacultyByUserId(user.sub);
      where = {
        status: query.status ?? { not: 'pending' },
        routed_to_warden: false,
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
        routed_to_warden: false,
        students: { class_id: { in: classIds } },
      };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.student_leaves.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        select: STUDENT_LEAVE_SELECT,
      }),
      this.prisma.student_leaves.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  findOne(id: number) {
    return `This action returns a #${id} studentLeaf`;
  }

  update(id: number, updateStudentLeafDto: UpdateStudentLeafDto) {
    void updateStudentLeafDto;
    return `This action updates a #${id} studentLeaf`;
  }

  remove(id: number) {
    return `This action removes a #${id} studentLeaf`;
  }

  /**
   * PATCH /student-leaves/:id/faculty-approve (Faculty — the student's
   * assigned mentor only, via class_mentors; not just any faculty who
   * teaches the student a subject).
   *
   * schema.prisma: student_leave_status_enum is
   * pending | faculty_approved | hod_approved | rejected — there is no bare
   * 'approved' value. So on decision='approved', status becomes
   * 'faculty_approved' (awaiting HoD's separate hod-approve action), NOT
   * left at 'pending' as an earlier draft of this doc assumed. On
   * decision='rejected', status becomes 'rejected' directly — the chain
   * short-circuits and HoD never reviews it.
   */
  async facultyApprove(
    id: number,
    dto: FacultyApproveLeaveDto,
    userId: number,
  ) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const leave = await this.prisma.student_leaves.findUnique({
      where: { id },
      include: { students: { select: { class_id: true } } },
    });
    if (!leave) {
      throw new NotFoundException({
        message: 'Leave request not found',
        errorCode: 'LEAVE_REQUEST_NOT_FOUND',
      });
    }

    if (leave.routed_to_warden) {
      throw new UnprocessableEntityException({
        message:
          'This leave is routed to the Warden and cannot be approved here',
        errorCode: 'ROUTED_TO_WARDEN',
      });
    }

    const classId = leave.students.class_id;
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

    if (leave.status !== 'pending') {
      throw new UnprocessableEntityException({
        message: 'This leave request has already been reviewed',
        errorCode: 'ALREADY_DECIDED',
      });
    }

    const updated = await this.prisma.student_leaves.update({
      where: { id },
      data:
        dto.decision === 'rejected'
          ? { status: 'rejected' }
          : { status: 'faculty_approved', approved_by_faculty_id: faculty.id },
      select: STUDENT_LEAVE_SELECT,
    });

    this.logger.log(
      `Student leave ${id} ${dto.decision === 'rejected' ? 'rejected' : 'faculty-approved'} by faculty=${faculty.id}`,
    );
    return toResponse(updated);
  }

  /**
   * PATCH /student-leaves/:id/hod-approve (HoD only).
   *
   * Second and final stage of the two-stage chain, per worflow.md: "hod
   * must approve students leave that is approved from faculty mapped to
   * the student" — only valid once status is already 'faculty_approved'.
   * approved_by_hod_user_id is a direct FK to `users` (not `faculty`), so
   * unlike Class Mentors this needs no faculty-row lookup for the HoD's own
   * identity — same pattern as Appraisal's hod_reviewed_by. No department
   * scoping either: workflow.md states none for this action, and it isn't
   * the dominant convention across this codebase's other HoD-gated write
   * endpoints (only Class Mentors requires it, per its own explicit spec).
   */
  async hodApprove(id: number, dto: HodApproveLeaveDto, hodUserId: number) {
    const leave = await this.prisma.student_leaves.findUnique({
      where: { id },
    });
    if (!leave) {
      throw new NotFoundException({
        message: 'Leave request not found',
        errorCode: 'LEAVE_REQUEST_NOT_FOUND',
      });
    }

    if (leave.routed_to_warden) {
      throw new UnprocessableEntityException({
        message:
          'This leave is routed to the Warden and cannot be approved here',
        errorCode: 'ROUTED_TO_WARDEN',
      });
    }

    if (leave.status === 'pending') {
      throw new UnprocessableEntityException({
        message:
          'This leave request has not been approved by the mentor faculty yet',
        errorCode: 'NOT_FACULTY_APPROVED_YET',
      });
    }

    if (leave.status !== 'faculty_approved') {
      throw new UnprocessableEntityException({
        message: 'This leave request has already been reviewed by HoD',
        errorCode: 'ALREADY_DECIDED',
      });
    }

    const updated = await this.prisma.student_leaves.update({
      where: { id },
      data:
        dto.decision === 'rejected'
          ? { status: 'rejected' }
          : { status: 'hod_approved', approved_by_hod_user_id: hodUserId },
      select: STUDENT_LEAVE_SELECT,
    });

    this.logger.log(
      `Student leave ${id} ${dto.decision === 'rejected' ? 'rejected' : 'hod-approved'} by hod user=${hodUserId}`,
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
