import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { computeOverallStatus } from './od-status.util';
import { formatTime } from './od-time.util';

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class MeOdRequestsService {
  private readonly logger = new Logger(MeOdRequestsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/od-requests/:id
   *
   * Authorization is "any member of the request's team," not "creator
   * only" — resolved from the JWT, never trusted from the request. This is
   * the read-only counterpart to POST /me/od-teams/:id/requests, so a
   * caller who isn't on the team can't probe arbitrary od_requests ids to
   * see other teams' event plans.
   *
   * Spec vs. schema discrepancy: the spec's own §7 illustrative SQL selects
   * `s.first_name, s.last_name` for the student's display name, but
   * `students` has no such columns at all (confirmed via schema.prisma).
   * Resolved via `students.soa_application_id -> soa_applications.first_name
   * /last_name` when that FK is set (real name, for students created
   * through the Perfect Entry flow), falling back to `student_id_no` when
   * it isn't (e.g. directly-seeded accounts, where soa_application_id is
   * null) — preferring genuine data over inventing a value, and never
   * leaving the field simply null when *something* identifying exists.
   * `hod_name` uses `users.email` when `hod_user_id` is set (matching the
   * spec's own SQL, which explicitly selects `u.email AS hod_email` for
   * this field — not a substitution, just following the spec literally)
   * and stays genuinely null when no HOD has reviewed yet, since there is
   * truly no data to resolve there.
   *
   * `department_name` is an addition beyond the spec's example response
   * (which only shows a bare `department_id`) — resolved via the same join
   * needed for department_id itself, so it costs nothing extra.
   *
   * overall_status precedence: the spec's own step-6 wording checks "any
   * pending" before "any rejected," which would report `pending_hod` for a
   * request with one rejected department and another still pending — but
   * its own "Future Improvements" note explicitly recommends the opposite
   * ("any rejected short-circuits to rejected, regardless of other
   * departments' approved/pending state"). Implemented per that explicit
   * recommendation, since it represents the spec author's own stated
   * intent rather than what reads as incidental wording order: mentor gate
   * first, then any-rejected, then any-pending, then all-approved.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND  – authenticated user has no linked student
   *                           record (spec doesn't list this code, kept
   *                           for consistency with every sibling /me/*
   *                           endpoint)
   *  404 OD_REQUEST_NOT_FOUND – id doesn't match any od_requests row
   *  403 NOT_A_TEAM_MEMBER    – caller isn't on the request's team
   *  500 INTERNAL_ERROR       – unexpected DB failure
   */
  async getOdRequestStatus(userId: number, odRequestId: number) {
    const caller = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!caller) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const request = await this.prisma.od_requests.findUnique({
      where: { id: odRequestId },
      select: {
        id: true,
        team_id: true,
        from_date: true,
        to_date: true,
        from_time: true,
        to_time: true,
        reason: true,
        mentor_approval_status: true,
        faculty: { select: { first_name: true, last_name: true } },
      },
    });
    if (!request) {
      throw new NotFoundException({
        message: 'OD request not found',
        errorCode: 'OD_REQUEST_NOT_FOUND',
      });
    }

    const membership = await this.prisma.od_team_members.findUnique({
      where: {
        team_id_student_id: { team_id: request.team_id, student_id: caller.id },
      },
    });
    if (!membership) {
      throw new ForbiddenException({
        message: "You are not a member of this OD request's team",
        errorCode: 'NOT_A_TEAM_MEMBER',
      });
    }

    const approvals = await this.fetchApprovals(userId, odRequestId);

    const memberApprovals = approvals.map((a) => ({
      student_id: a.student_id,
      student_name: a.students.soa_applications
        ? `${a.students.soa_applications.first_name} ${a.students.soa_applications.last_name ?? ''}`.trim()
        : a.students.student_id_no,
      department_id: a.department_id,
      department_name: a.departments.name,
      status: a.status,
      hod_name: a.users?.email ?? null,
      reviewed_at: a.reviewed_at ? a.reviewed_at.toISOString() : null,
    }));

    return {
      id: request.id,
      team_id: request.team_id,
      from_date: toDateOnly(request.from_date),
      to_date: toDateOnly(request.to_date),
      from_time: formatTime(request.from_time),
      to_time: formatTime(request.to_time),
      reason: request.reason,
      faculty_guide_name: request.faculty
        ? `${request.faculty.first_name} ${request.faculty.last_name ?? ''}`.trim()
        : null,
      mentor_approval_status: request.mentor_approval_status,
      overall_status: computeOverallStatus(
        request.mentor_approval_status,
        approvals.map((a) => a.status),
      ),
      member_approvals: memberApprovals,
    };
  }

  private async fetchApprovals(userId: number, odRequestId: number) {
    try {
      return await this.prisma.od_request_hod_approvals.findMany({
        where: { od_request_id: odRequestId },
        select: {
          student_id: true,
          department_id: true,
          status: true,
          reviewed_at: true,
          students: {
            select: {
              student_id_no: true,
              soa_applications: {
                select: { first_name: true, last_name: true },
              },
            },
          },
          departments: { select: { name: true } },
          users: { select: { email: true } },
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to fetch OD request approvals for request ${odRequestId} (user ${userId})`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
