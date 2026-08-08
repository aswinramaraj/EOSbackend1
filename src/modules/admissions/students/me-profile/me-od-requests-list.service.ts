import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { computeOverallStatus } from './od-status.util';
import { formatTime } from './od-time.util';
import { GetOdRequestsDto } from './dto/get-od-requests.dto';

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class MeOdRequestsListService {
  private readonly logger = new Logger(MeOdRequestsListService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/od-requests?page=&page_size=
   *
   * Self-scoped: lists every od_request for a team the caller is (or was) a
   * member of - not creator-only, matching the single-request GET's own
   * "any team member" authorization. This is the History tab's data
   * source; the full per-student approval breakdown stays on
   * GET /me/od-requests/:id (kept light here on purpose - a per-row
   * approved/pending/rejected count, not the full member list, since a
   * list view has no use for every teammate's name).
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND - authenticated user has no linked student record
   *  500 INTERNAL_ERROR    - unexpected DB failure
   */
  async getMyOdRequests(userId: number, dto: GetOdRequestsDto) {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const page = dto.page ?? 1;
    const pageSize = dto.page_size ?? 20;

    const [total, rows] = await this.fetchRequests(
      userId,
      student.id,
      page,
      pageSize,
    );

    return {
      data: rows.map((row) => {
        const approvalStatuses = row.od_request_hod_approvals.map(
          (a) => a.status,
        );
        return {
          id: row.id,
          team_id: row.team_id,
          unique_code: row.od_teams.unique_code,
          from_date: toDateOnly(row.from_date),
          to_date: toDateOnly(row.to_date),
          from_time: formatTime(row.from_time),
          to_time: formatTime(row.to_time),
          reason: row.reason,
          faculty_guide_name: row.faculty
            ? `${row.faculty.first_name} ${row.faculty.last_name ?? ''}`.trim()
            : null,
          mentor_approval_status: row.mentor_approval_status,
          overall_status: computeOverallStatus(
            row.mentor_approval_status,
            approvalStatuses,
          ),
          member_count: approvalStatuses.length,
          approved_count: approvalStatuses.filter((s) => s === 'approved')
            .length,
          rejected_count: approvalStatuses.filter((s) => s === 'rejected')
            .length,
          pending_count: approvalStatuses.filter((s) => s === 'pending')
            .length,
          created_at: row.created_at.toISOString(),
        };
      }),
      page,
      page_size: pageSize,
      total,
    };
  }

  private async fetchRequests(
    userId: number,
    studentId: number,
    page: number,
    pageSize: number,
  ) {
    const where = {
      od_teams: { od_team_members: { some: { student_id: studentId } } },
    };

    try {
      return await Promise.all([
        this.prisma.od_requests.count({ where }),
        this.prisma.od_requests.findMany({
          where,
          select: {
            id: true,
            team_id: true,
            from_date: true,
            to_date: true,
            from_time: true,
            to_time: true,
            reason: true,
            faculty: { select: { first_name: true, last_name: true } },
            mentor_approval_status: true,
            created_at: true,
            od_teams: { select: { unique_code: true } },
            od_request_hod_approvals: { select: { status: true } },
          },
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
    } catch (err) {
      this.logger.error(`Failed to fetch OD requests for user ${userId}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
