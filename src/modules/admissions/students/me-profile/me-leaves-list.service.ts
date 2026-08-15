import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { GetLeavesDto } from './dto/get-leaves.dto';

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class MeLeavesListService {
  private readonly logger = new Logger(MeLeavesListService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/leaves?status=&routed_to_warden=&page=&page_size=
   *
   * Self-scoped: student_id resolved from the JWT. Lists the caller's own
   * `student_leaves`, optionally filtered by status and/or routed_to_warden,
   * most-recent-first. `approved_by_faculty`/`approved_by_hod`/
   * `approved_by_warden` are resolved display strings — faculty's
   * `first_name + last_name` (a real name column) and the HOD's/Warden's
   * `users.email` (users has no display-name column, so the spec's
   * illustrative "Dr. R. Kumar" example isn't literally reproducible; the
   * DB Operations section's own SQL selects `u.email`, which is followed
   * here, same resolution as the `posted_by` field pattern seen elsewhere
   * in this codebase).
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – authenticated user has no linked student record
   *                          (same defensive consistency check as every
   *                          other /me/* endpoint; spec marks this "not
   *                          applicable" but it never fires for a real,
   *                          correctly-provisioned student account)
   *  500 INTERNAL_ERROR    – unexpected DB failure
   */
  async getMyLeaves(userId: number, dto: GetLeavesDto) {
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

    const [total, rows] = await this.fetchLeaves(
      userId,
      student.id,
      dto,
      page,
      pageSize,
    );

    return {
      data: rows.map((row) => ({
        id: row.id,
        from_date: toDateOnly(row.from_date),
        to_date: toDateOnly(row.to_date),
        reason: row.reason,
        status: row.status,
        also_on_hostel_leave: row.also_on_hostel_leave,
        routed_to_warden: row.routed_to_warden,
        approved_by_faculty: row.faculty
          ? `${row.faculty.first_name} ${row.faculty.last_name}`
          : null,
        approved_by_hod: row.users?.email ?? null,
        approved_by_warden:
          row.users_student_leaves_approved_by_warden_user_idTousers?.email ??
          null,
        created_at: row.created_at.toISOString(),
      })),
      page,
      page_size: pageSize,
      total,
    };
  }

  private async fetchLeaves(
    userId: number,
    studentId: number,
    dto: GetLeavesDto,
    page: number,
    pageSize: number,
  ) {
    const where = {
      student_id: studentId,
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.routed_to_warden !== undefined
        ? { routed_to_warden: dto.routed_to_warden }
        : {}),
    };

    try {
      return await Promise.all([
        this.prisma.student_leaves.count({ where }),
        this.prisma.student_leaves.findMany({
          where,
          select: {
            id: true,
            from_date: true,
            to_date: true,
            reason: true,
            status: true,
            created_at: true,
            also_on_hostel_leave: true,
            routed_to_warden: true,
            faculty: { select: { first_name: true, last_name: true } },
            users: { select: { email: true } },
            users_student_leaves_approved_by_warden_user_idTousers: {
              select: { email: true },
            },
          },
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
    } catch (err) {
      this.logger.error(`Failed to fetch leaves for user ${userId}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
