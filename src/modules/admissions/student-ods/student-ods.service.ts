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
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { ListStudentOdQueryDto } from './dto/list-student-od-query.dto';
import { FacultyApproveOdDto } from './dto/faculty-approve-od.dto';
import { HodApproveOdDto } from './dto/hod-approve-od.dto';

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
      od_team_members: {
        select: {
          student_id: true,
          students: {
            select: {
              id: true,
              student_id_no: true,
              soa_applications: {
                select: { first_name: true, last_name: true },
              },
              users: { select: { id: true, email: true } },
            },
          },
        },
      },
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
    od_team_members: {
      student_id: number;
      students: {
        id: number;
        student_id_no: string;
        soa_applications: {
          first_name: string;
          last_name: string | null;
        } | null;
        users: { id: number; email: string };
      };
    }[];
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

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatTime(time: Date | null): string | null {
  return time ? time.toISOString().slice(11, 16) : null;
}

function toResponse(request: OdRequestRow, hodApprovalStatus?: string) {
  const team = request.od_teams;
  const creator = team.students;
  // od_team_members always includes the creator as one of its rows — excluded
  // here since the creator is already surfaced separately below; this array
  // is specifically "the OTHER members of the team" for display purposes
  // (was previously discarded entirely, only its length ever left this
  // function, so a card showing "+2 more" had no way to say who they were).
  const otherMembers = team.od_team_members
    .filter((m) => m.student_id !== creator.id)
    .map((m) => ({
      id: m.students.id,
      student_id_no: m.students.student_id_no,
      name: resolveStudentName(m.students),
    }));
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
    other_members: otherMembers,
    from_date: toDateOnly(request.from_date),
    to_date: toDateOnly(request.to_date),
    from_time: formatTime(request.from_time),
    to_time: formatTime(request.to_time),
    reason: request.reason,
    faculty_guide_name: request.faculty
      ? `${request.faculty.first_name} ${request.faculty.last_name ?? ''}`.trim()
      : null,
    mentor_approval_status: request.mentor_approval_status,
    // Only present when fetched via a HoD's own department queue — the
    // status of THIS HoD's own od_request_hod_approvals row (see
    // hodApprove/findAll), not any other department's.
    hod_approval_status: hodApprovalStatus ?? null,
    created_at: request.created_at,
  };
}

@Injectable()
export class StudentOdsService {
  private readonly logger = new Logger(StudentOdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * GET /me/student-ods (Faculty or HoD).
   *
   * Faculty: the calling faculty's mentor-review queue — every od_request
   * created by a student in a class this faculty mentors, via
   * class_mentors. A faculty who mentors no class gets an empty page
   * rather than an error.
   *
   * HoD: every od_request that has actually reached their department's
   * approval stage — i.e. has an od_request_hod_approvals row for the
   * HoD's own department_id (created by facultyApprove() once the mentor
   * approves, see below). `query.status` here filters on THAT department
   * row's status, not mentor_approval_status.
   */
  async findAll(query: ListStudentOdQueryDto, user: JwtPayload) {
    if (user.role === ROLES.HOD) {
      const hod = await this.resolveFacultyByUserId(user.sub);

      const where = {
        department_id: hod.department_id,
        status: query.status,
      };

      // distinct: ['od_request_id'] — a team can contribute more than one
      // member from this department, which would otherwise list the same
      // request once per member row.
      const [approvalRows, distinctRequestIds] = await this.prisma.$transaction(
        [
          this.prisma.od_request_hod_approvals.findMany({
            where,
            distinct: ['od_request_id'],
            skip: query.skip,
            take: query.limit,
            orderBy: { id: 'desc' },
            select: {
              status: true,
              od_requests: { select: OD_REQUEST_SELECT },
            },
          }),
          this.prisma.od_request_hod_approvals.findMany({
            where,
            distinct: ['od_request_id'],
            select: { od_request_id: true },
          }),
        ],
      );

      return paginate(
        approvalRows.map((row) => toResponse(row.od_requests, row.status)),
        distinctRequestIds.length,
        query,
      );
    }

    const faculty = await this.resolveFacultyByUserId(user.sub);

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

    return paginate(
      rows.map((r) => toResponse(r)),
      total,
      query,
    );
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
      include: {
        od_teams: { include: { students: { select: { class_id: true } } } },
      },
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

    await this.notifications.notify({
      user_id: updated.od_teams.students.users.id,
      title:
        dto.decision === 'approved'
          ? 'OD request approved by mentor'
          : 'OD request rejected by mentor',
      message: `Your OD request (${toDateOnly(updated.from_date)} to ${toDateOnly(updated.to_date)}) was ${dto.decision} by your mentor.`,
      type:
        dto.decision === 'approved'
          ? 'approval_request_approved'
          : 'approval_request_rejected',
      related_entity_type: 'od_request',
      related_entity_id: id,
    });

    // Once the mentor approves, fan the request out to one pending approval
    // row per TEAM MEMBER (od_request_hod_approvals — previously defined
    // in the schema but never populated anywhere), tagged with that
    // member's own department. The table's unique constraint is
    // [od_request_id, student_id], so this is naturally one row per member,
    // not one per distinct department — a HoD with several members on the
    // same team approves all of them in one action (see hodApprove, which
    // updates every matching row for its department at once). A rejection
    // short-circuits the chain, same as student-leaves - no HoD ever sees it.
    if (dto.decision === 'approved') {
      const members = await this.prisma.od_team_members.findMany({
        where: { team_id: request.team_id },
        select: {
          student_id: true,
          students: { select: { class_id: true } },
        },
      });
      const classIds = [
        ...new Set(
          members
            .map((m) => m.students.class_id)
            .filter((id): id is number => id !== null),
        ),
      ];
      const classesById = new Map(
        (
          await this.prisma.classes.findMany({
            where: { id: { in: classIds } },
            select: { id: true, department_id: true },
          })
        ).map((c) => [c.id, c.department_id]),
      );

      const rows = members
        .map((m) => {
          const departmentId = m.students.class_id
            ? classesById.get(m.students.class_id)
            : undefined;
          return departmentId !== undefined
            ? {
                od_request_id: id,
                student_id: m.student_id,
                department_id: departmentId,
              }
            : null;
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      if (rows.length > 0) {
        await this.prisma.od_request_hod_approvals.createMany({
          data: rows,
          skipDuplicates: true,
        });
      }
    }

    this.logger.log(
      `OD request ${id} mentor-${dto.decision} by faculty=${faculty.id}`,
    );
    return toResponse(updated);
  }

  /**
   * PATCH /me/student-ods/:id/hod-approve (HoD only).
   *
   * A team can contribute more than one member from the same department
   * (od_request_hod_approvals is one row per member, see facultyApprove),
   * so this resolves and updates every pending row for the HoD's own
   * department in one action — a HoD reviews their department's stake in
   * the request as a whole, not member-by-member. Those rows only exist
   * once the mentor has approved (see facultyApprove above), so their mere
   * existence is the "already mentor-approved" gate; no separate check
   * is needed here.
   */
  async hodApprove(id: number, dto: HodApproveOdDto, hodUserId: number) {
    const hod = await this.resolveFacultyByUserId(hodUserId);

    const pendingRows = await this.prisma.od_request_hod_approvals.findMany({
      where: { od_request_id: id, department_id: hod.department_id },
    });

    if (pendingRows.length === 0) {
      throw new NotFoundException({
        message: 'This OD request has not reached your department for review',
        errorCode: 'HOD_APPROVAL_NOT_FOUND',
      });
    }

    if (pendingRows.every((row) => row.status !== 'pending')) {
      throw new UnprocessableEntityException({
        message: 'This OD request has already been reviewed by your department',
        errorCode: 'ALREADY_DECIDED',
      });
    }

    await this.prisma.od_request_hod_approvals.updateMany({
      where: {
        od_request_id: id,
        department_id: hod.department_id,
        status: 'pending',
      },
      data: {
        status: dto.decision,
        hod_user_id: hodUserId,
        reviewed_at: new Date(),
      },
    });

    const request = await this.prisma.od_requests.findUniqueOrThrow({
      where: { id },
      select: OD_REQUEST_SELECT,
    });

    // Named by the department that just decided, not "your department" -
    // the request creator (who this notifies) isn't necessarily a member
    // of that department themselves; other team members might be.
    const department = await this.prisma.departments.findUnique({
      where: { id: hod.department_id },
      select: { name: true },
    });

    await this.notifications.notify({
      user_id: request.od_teams.students.users.id,
      title:
        dto.decision === 'approved'
          ? 'OD request approved by HoD'
          : 'OD request rejected by HoD',
      message: `Your OD request (${toDateOnly(request.from_date)} to ${toDateOnly(request.to_date)}) was ${dto.decision} by the HoD of ${department?.name ?? 'a department on your team'}.`,
      type:
        dto.decision === 'approved'
          ? 'approval_request_approved'
          : 'approval_request_rejected',
      related_entity_type: 'od_request',
      related_entity_id: id,
    });

    this.logger.log(
      `OD request ${id} hod-${dto.decision} by hod user=${hodUserId} (dept=${hod.department_id})`,
    );
    return toResponse(request, dto.decision);
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
