import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class MeOdTeamsListService {
  private readonly logger = new Logger(MeOdTeamsListService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/od-teams
   *
   * Self-scoped: lists every od_team the caller currently belongs to (as
   * creator or plain member), most-recently-created first. Not paginated -
   * a student's own OD team memberships are a small, bounded set, unlike
   * the institution-wide lists the other GET /me/* endpoints paginate.
   *
   * `has_request`/`od_request_id` let the client tell "team is still
   * gathering members" (unlocked, no request yet - the Apply tab's
   * "share this code" state) apart from "request already submitted"
   * (locked, od_request_id set - Apply tab should point at
   * GET /me/od-requests/:id instead of re-showing the submit form)
   * without a second round trip.
   *
   * `members` resolves each name the same way MeOdRequestsService does for
   * its member_approvals (real name via soa_applications when the FK is
   * set, falling back to student_id_no when it isn't) - so the creator can
   * actually see who has joined, not just a bare count.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND - authenticated user has no linked student record
   *  500 INTERNAL_ERROR    - unexpected DB failure
   */
  async getMyOdTeams(userId: number) {
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

    const memberships = await this.fetchMemberships(userId, student.id);

    return {
      data: memberships.map((membership) => {
        const team = membership.od_teams;
        const request = team.od_requests[0] ?? null;
        return {
          id: team.id,
          unique_code: team.unique_code,
          is_locked: team.is_locked,
          is_creator: team.created_by_student_id === student.id,
          member_count: team.od_team_members.length,
          members: team.od_team_members.map((member) => ({
            student_id: member.student_id,
            name: member.students.soa_applications
              ? `${member.students.soa_applications.first_name} ${member.students.soa_applications.last_name ?? ''}`.trim()
              : member.students.student_id_no,
            is_creator: member.student_id === team.created_by_student_id,
            joined_at: member.joined_at.toISOString(),
          })),
          joined_at: membership.joined_at.toISOString(),
          created_at: team.created_at.toISOString(),
          has_request: request !== null,
          od_request_id: request?.id ?? null,
        };
      }),
    };
  }

  private async fetchMemberships(userId: number, studentId: number) {
    try {
      return await this.prisma.od_team_members.findMany({
        where: { student_id: studentId },
        select: {
          joined_at: true,
          od_teams: {
            select: {
              id: true,
              unique_code: true,
              is_locked: true,
              created_by_student_id: true,
              created_at: true,
              od_team_members: {
                select: {
                  student_id: true,
                  joined_at: true,
                  students: {
                    select: {
                      student_id_no: true,
                      soa_applications: {
                        select: { first_name: true, last_name: true },
                      },
                    },
                  },
                },
                orderBy: { joined_at: 'asc' },
              },
              od_requests: {
                select: { id: true },
                orderBy: { created_at: 'asc' },
                take: 1,
              },
            },
          },
        },
        orderBy: { od_teams: { created_at: 'desc' } },
      });
    } catch (err) {
      this.logger.error(`Failed to fetch OD teams for user ${userId}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
