import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { ListStudentOdQueryDto } from './dto/list-student-od-query.dto';
import { FacultyApproveOdDto } from './dto/faculty-approve-od.dto';

const OD_REQUEST_SELECT = {
  id: true,
  team_id: true,
  from_date: true,
  to_date: true,
  from_time: true,
  to_time: true,
  reason: true,
  mentor_approval_status: true,
  created_at: true,
  faculty: { select: { first_name: true, last_name: true } },
  od_teams: {
    select: {
      unique_code: true,
      od_team_members: { select: { student_id: true } },
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
    },
  },
} as const;

interface OdRequestRow {
  id: number;
  team_id: number;
  from_date: Date;
  to_date: Date;
  from_time: Date | null;
  to_time: Date | null;
  reason: string | null;
  mentor_approval_status: string;
  created_at: Date;
  faculty: { first_name: string; last_name: string | null } | null;
  od_teams: {
    unique_code: string;
    od_team_members: { student_id: number }[];
    students: {
      id: number;
      student_id_no: string;
      class_id: number | null;
      soa_applications: { first_name: string; last_name: string | null } | null;
      users: { id: number; email: string };
      classes: { section: string; departments: { name: string } } | null;
    };
  };
}

/** Same fallback chain as student-leaves' resolveStudentName - no generic display-name column on `students`. */
function resolveStudentName(student: OdRequestRow['od_teams']['students']): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users.email;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatTime(time: Date | null): string | null {
  return time ? time.toISOString().slice(11, 16) : null;
}

function toResponse(request: OdRequestRow) {
  const team = request.od_teams;
  const creator = team.students;
  return {
    id: request.id,
    team_id: request.team_id,
    unique_code: team.unique_code,
    member_count: team.od_team_members.length,
    creator: {
      id: creator.id,
      student_id_no: creator.student_id_no,
      name: resolveStudentName(creator),
      section: creator.classes?.section ?? null,
      department_name: creator.classes?.departments.name ?? null,
    },
    from_date: toDateOnly(request.from_date),
    to_date: toDateOnly(request.to_date),
    from_time: formatTime(request.from_time),
    to_time: formatTime(request.to_time),
    reason: request.reason,
    faculty_guide_name: request.faculty
      ? `${request.faculty.first_name} ${request.faculty.last_name ?? ''}`.trim()
      : null,
    mentor_approval_status: request.mentor_approval_status,
    created_at: request.created_at,
  };
}

@Injectable()
export class StudentOdsService {
  private readonly logger = new Logger(StudentOdsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/student-ods (Faculty only, for now) — the calling faculty's
   * mentor-review queue: every od_request created by a student in a class
   * this faculty mentors, via class_mentors. A faculty who mentors no class
   * gets an empty page rather than an error - same shape as
   * StudentLeavesService.findAll().
   */
  async findAll(query: ListStudentOdQueryDto, userId: number) {
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
      mentor_approval_status: query.status,
      od_teams: { students: { class_id: { in: classIds } } },
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.od_requests.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        select: OD_REQUEST_SELECT,
      }),
      this.prisma.od_requests.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  /**
   * PATCH /me/student-ods/:id/faculty-approve (Faculty — the mentor of the
   * requesting team's CREATOR only; other team members' own mentors have no
   * say here, since mentor_approval_status is one value per request, not
   * per member — see od_request_hod_approvals for the per-member fan-out
   * that happens at the *next* stage instead).
   *
   * approval_status_enum has a real 'approved' value (unlike student-leaves'
   * enum), so decision maps 1:1 onto the stored status - no 'faculty_approved'
   * remap needed.
   */
  async facultyApprove(id: number, dto: FacultyApproveOdDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const request = await this.prisma.od_requests.findUnique({
      where: { id },
      include: { od_teams: { include: { students: { select: { class_id: true } } } } },
    });
    if (!request) {
      throw new NotFoundException({
        message: 'OD request not found',
        errorCode: 'OD_REQUEST_NOT_FOUND',
      });
    }

    const classId = request.od_teams.students.class_id;
    const mentorMapping =
      classId !== null
        ? await this.prisma.class_mentors.findFirst({
            where: { class_id: classId, faculty_id: faculty.id },
          })
        : null;
    if (!mentorMapping) {
      throw new ForbiddenException({
        message: "You are not the mentor for this request's team creator",
        errorCode: 'NOT_THE_MENTOR',
      });
    }

    if (request.mentor_approval_status !== 'pending') {
      throw new UnprocessableEntityException({
        message: 'This OD request has already been reviewed',
        errorCode: 'ALREADY_DECIDED',
      });
    }

    const updated = await this.prisma.od_requests.update({
      where: { id },
      data: { mentor_approval_status: dto.decision },
      select: OD_REQUEST_SELECT,
    });

    this.logger.log(
      `OD request ${id} mentor-${dto.decision} by faculty=${faculty.id}`,
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
