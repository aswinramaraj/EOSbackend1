import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateBonafideRequestDto } from './dto/create-bonafide-request.dto';
import { GetBonafideRequestsDto } from './dto/get-bonafide-requests.dto';

@Injectable()
export class MeBonafideRequestsService {
  private readonly logger = new Logger(MeBonafideRequestsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /me/bonafide-requests
   *
   * Self-scoped: student_id resolved from the JWT, never accepted from the
   * request.
   *
   * Duplicate-pending check: NOT implemented, deliberately. Unlike
   * POST /me/hostel-outings's hosteller check (which the spec's own
   * Processing Workflow explicitly lists as a numbered step, with a
   * matching error entry), this spec's §3 workflow has NO step for
   * checking an existing pending request — the §5 429
   * DUPLICATE_PENDING_REQUEST entry only shows what such a check *would*
   * look like if built, not that it's already required. §12's own Edge
   * Cases section argues the other way: "a student might legitimately
   * need two bonafide certificates for the same stated reason at
   * different times, e.g. reapplying for a loan after a rejection," and
   * explicitly calls the block/warn/allow decision "an open question."
   * Given the workflow itself never performs this check and the spec's
   * own reasoning argues against blocking, this implementation allows
   * multiple pending requests for the same reason.
   *
   * Response includes `reason_text` — an addition beyond the spec's
   * example response (which only shows a bare `reason_id`). The
   * existence check already has to read `bonafide_reasons`, so surfacing
   * the actual reason wording costs nothing extra, rather than leaving
   * the client to look it up separately against a cached reasons list.
   *
   * Int4-overflow found during a recheck: a reason_id between Postgres's
   * int4 max and Number.MAX_SAFE_INTEGER passed @IsInt/@IsPositive (both
   * are satisfied by any positive JS integer) but overflowed at the DB
   * layer, and the existence-check query wasn't wrapped in a try/catch —
   * surfaced as an unhandled 500 instead of a clean validation error.
   * Closed at the DTO level (@Max(2147483647)) for a proper 400, with the
   * existence check now also wrapped in its own try/catch as
   * defense-in-depth against any other unexpected DB failure on this
   * read. This exact gap is systemic (confirmed live: the same thing
   * happens on GET /me/od-requests/:id, and would on any other
   * ParseIntPipe-validated numeric id in this project) but only closed
   * here, for this endpoint's own input surface.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – authenticated user has no linked student
   *                          record (spec doesn't list this code, kept
   *                          for consistency with every sibling /me/*
   *                          endpoint)
   *  404 REASON_NOT_FOUND  – reason_id doesn't reference an existing
   *                          bonafide_reasons row
   *  500 INTERNAL_ERROR    – unexpected DB failure
   */
  async createBonafideRequest(userId: number, dto: CreateBonafideRequestDto) {
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

    const reason = await this.fetchReason(userId, dto.reason_id);
    if (!reason) {
      throw new NotFoundException({
        message: 'Bonafide reason not found',
        errorCode: 'REASON_NOT_FOUND',
      });
    }

    const request = await this.insertRequest(userId, student.id, reason.id);

    return {
      id: request.id,
      student_id: request.student_id,
      reason_id: request.reason_id,
      reason_text: reason.reason_text,
      status: request.status,
      requested_at: request.requested_at.toISOString(),
      issued_at: request.issued_at ? request.issued_at.toISOString() : null,
      file_url: request.file_url,
    };
  }

  /**
   * GET /me/bonafide-requests?status=&page=&page_size=
   *
   * Self-scoped: student_id resolved from the JWT. No gating rule to
   * consider on the read side (unlike GET /me/hostel-outings's asymmetry
   * with its POST sibling) — every row already belongs to the caller by
   * construction, since POST /me/bonafide-requests has no equivalent of a
   * hosteller-only restriction.
   *
   * Joins to bonafide_reasons with an INNER join, not a LEFT join —
   * reason_id is a required (non-nullable) column on bonafide_requests,
   * unlike hostel_outings.approved_by_warden_user_id, so there's no
   * "missing reason" case to handle.
   *
   * Error cases:
   *  400 VALIDATION_ERROR  – status isn't a real enum value
   *  404 STUDENT_NOT_FOUND – authenticated user has no linked student
   *                          record (spec doesn't list this code, kept
   *                          for consistency with every sibling /me/*
   *                          endpoint)
   *  500 INTERNAL_ERROR    – unexpected DB failure
   */
  async getMyBonafideRequests(userId: number, dto: GetBonafideRequestsDto) {
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

    return this.computeBonafideRequests(student.id, dto);
  }

  /**
   * Same computation as getMyBonafideRequests, but for a student chosen by
   * id rather than resolved from the caller's own JWT - used by
   * ParentsService. Read-only: no createBonafideRequestForStudentId, a
   * parent never files this on a child's behalf.
   */
  async getBonafideRequestsForStudentId(
    studentId: number,
    dto: GetBonafideRequestsDto,
  ) {
    return this.computeBonafideRequests(studentId, dto);
  }

  private async computeBonafideRequests(
    studentId: number,
    dto: GetBonafideRequestsDto,
  ) {
    const page = dto.page ?? 1;
    const pageSize = dto.page_size ?? 20;

    const [total, rows] = await this.fetchRequests(
      studentId,
      dto.status,
      page,
      pageSize,
    );

    return {
      data: rows.map((row) => ({
        id: row.id,
        reason_id: row.reason_id,
        reason_text: row.bonafide_reasons.reason_text,
        status: row.status,
        requested_at: row.requested_at.toISOString(),
        issued_at: row.issued_at ? row.issued_at.toISOString() : null,
        file_url: row.file_url,
      })),
      page,
      page_size: pageSize,
      total,
    };
  }

  private async fetchRequests(
    studentId: number,
    status: GetBonafideRequestsDto['status'],
    page: number,
    pageSize: number,
  ) {
    const where = {
      student_id: studentId,
      ...(status !== undefined ? { status } : {}),
    };

    try {
      return await Promise.all([
        this.prisma.bonafide_requests.count({ where }),
        this.prisma.bonafide_requests.findMany({
          where,
          select: {
            id: true,
            reason_id: true,
            status: true,
            requested_at: true,
            issued_at: true,
            file_url: true,
            bonafide_reasons: { select: { reason_text: true } },
          },
          orderBy: { requested_at: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
    } catch (err) {
      this.logger.error(
        `Failed to fetch bonafide requests for student ${studentId}`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async fetchReason(userId: number, reasonId: number) {
    try {
      return await this.prisma.bonafide_reasons.findUnique({
        where: { id: reasonId },
        select: { id: true, reason_text: true },
      });
    } catch (err) {
      this.logger.error(
        `Failed to look up bonafide reason ${reasonId} for user ${userId}`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async insertRequest(
    userId: number,
    studentId: number,
    reasonId: number,
  ) {
    try {
      return await this.prisma.bonafide_requests.create({
        data: {
          student_id: studentId,
          reason_id: reasonId,
          status: 'pending',
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to create bonafide request for user ${userId}`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
