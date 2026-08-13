import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
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
          current_semester: true,
          departments: { select: { name: true } },
        },
      },
    },
  },
} as const;

const ROMAN_YEAR = ['I', 'II', 'III', 'IV', 'V', 'VI'];
function yearLabelForSemester(semester: number): string {
  const yearIndex = Math.ceil(semester / 2) - 1;
  return ROMAN_YEAR[yearIndex] ?? String(yearIndex + 1);
}

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
    classes: {
      section: string;
      current_semester: number | null;
      departments: { name: string };
    } | null;
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
      year_label:
        leave.students.classes?.current_semester != null
          ? yearLabelForSemester(leave.students.classes.current_semester)
          : null,
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
   * GET /me/student-leaves (Faculty only, for now) — the calling faculty's
   * mentor-review queue: every leave request from a student in a class this
   * faculty mentors, via class_mentors. A faculty who mentors no class gets
   * an empty page rather than an error.
   *
   * student.section/department_name are included because a Class Mentor
   * can mentor more than one class (class_mentors is one row per
   * class_id, not capped at one) - without this, the mobile review queue
   * would have no way to tell which section a given request belongs to
   * when the mentor covers more than one.
   */
  async findAll(query: ListStudentLeaveQueryDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const mentorClasses = await this.prisma.class_mentors.findMany({
      where: { faculty_id: faculty.id },
      select: { class_id: true },
    });
    const classIds = mentorClasses.map((m) => m.class_id);

    if (classIds.length === 0) {
      return paginate([], 0, query);
    }

    const where = {
      status: query.status,
      students: { class_id: { in: classIds } },
    };

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

  /**
   * GET /student-leaves/hod (HoD only) — the caller's own department's
   * queue, joined via students -> classes -> department_id (student_leaves
   * itself has no direct department column). Unlike the mentor's own
   * findAll above, this is not restricted to a particular class_mentors
   * mapping — an HoD reviews every student leave in their department,
   * regardless of who mentors that student's class.
   */
  async findAllForHod(query: ListStudentLeaveQueryDto, hodUserId: number) {
    const hod = await this.resolveFacultyByUserId(hodUserId);

    const where = {
      status: query.status,
      students: { classes: { department_id: hod.department_id } },
    };

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
   * identity — same pattern as Appraisal's hod_reviewed_by. Department
   * scoping added here (via students -> classes -> department_id) mirrors
   * the same guard every other HoD-gated write endpoint in this codebase
   * enforces, closing the gap noted against workflow.md's silence on it.
   */
  async hodApprove(id: number, dto: HodApproveLeaveDto, hodUserId: number) {
    const hod = await this.resolveFacultyByUserId(hodUserId);

    const leave = await this.prisma.student_leaves.findUnique({
      where: { id },
      include: {
        students: { select: { classes: { select: { department_id: true } } } },
      },
    });
    if (!leave) {
      throw new NotFoundException({
        message: 'Leave request not found',
        errorCode: 'LEAVE_REQUEST_NOT_FOUND',
      });
    }

    if (leave.students.classes?.department_id !== hod.department_id) {
      throw new ForbiddenException({
        message:
          'You may only act on leave requests within your own department',
        errorCode: 'NOT_YOUR_DEPARTMENT',
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
