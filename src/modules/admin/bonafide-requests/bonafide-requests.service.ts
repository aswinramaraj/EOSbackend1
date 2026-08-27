import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { ListBonafideRequestsDto } from './dto/list-bonafide-requests.dto';
import { DecideBonafideRequestDto } from './dto/decide-bonafide-request.dto';

const LIST_SELECT = {
  id: true,
  status: true,
  requested_at: true,
  issued_at: true,
  bonafide_reasons: { select: { id: true, reason_text: true } },
  students: {
    select: {
      id: true,
      student_id_no: true,
      register_no: true,
      roll_no: true,
      admission_no: true,
      soa_applications: { select: { first_name: true, last_name: true } },
      batches: { select: { id: true, name: true } },
      classes: { select: { id: true, section: true } },
      courses: {
        select: {
          id: true,
          name: true,
          departments: { select: { id: true, name: true, code: true } },
        },
      },
    },
  },
} as const;

type ListRow = Prisma.bonafide_requestsGetPayload<{ select: typeof LIST_SELECT }>;

function toListDto(row: ListRow) {
  return {
    id: row.id,
    status: row.status,
    requested_at: row.requested_at.toISOString(),
    issued_at: row.issued_at ? row.issued_at.toISOString() : null,
    reason: row.bonafide_reasons,
    student: {
      id: row.students.id,
      student_id_no: row.students.student_id_no,
      register_no: row.students.register_no,
      roll_no: row.students.roll_no,
      admission_no: row.students.admission_no,
      first_name: row.students.soa_applications?.first_name ?? null,
      last_name: row.students.soa_applications?.last_name ?? null,
      batch: row.students.batches,
      class: row.students.classes,
      course: row.students.courses
        ? { id: row.students.courses.id, name: row.students.courses.name }
        : null,
      department: row.students.courses?.departments ?? null,
    },
  };
}

const DETAIL_SELECT = {
  ...LIST_SELECT,
  students: {
    select: {
      ...LIST_SELECT.students.select,
      gender: true,
      date_of_birth: true,
      student_family_details: { select: { father_name: true, mother_name: true } },
    },
  },
} as const;

type DetailRow = Prisma.bonafide_requestsGetPayload<{ select: typeof DETAIL_SELECT }>;

function toDetailDto(row: DetailRow) {
  return {
    ...toListDto(row),
    student: {
      ...toListDto(row).student,
      gender: row.students.gender,
      date_of_birth: row.students.date_of_birth,
      father_name: row.students.student_family_details?.father_name ?? null,
      mother_name: row.students.student_family_details?.mother_name ?? null,
    },
  };
}

@Injectable()
export class BonafideRequestsService {
  private readonly logger = new Logger(BonafideRequestsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /admin/bonafide-requests (Admin only) — paginated, filterable. */
  async findAll(query: ListBonafideRequestsDto) {
    const where: Prisma.bonafide_requestsWhereInput = {
      status: query.status,
      reason_id: query.reason_id,
    };

    if (query.from || query.to) {
      where.requested_at = {
        ...(query.from && { gte: new Date(query.from) }),
        ...(query.to && { lte: new Date(query.to) }),
      };
    }

    if (query.q) {
      where.students = {
        OR: [
          { student_id_no: { contains: query.q, mode: 'insensitive' } },
          { register_no: { contains: query.q, mode: 'insensitive' } },
          { roll_no: { contains: query.q, mode: 'insensitive' } },
          { admission_no: { contains: query.q, mode: 'insensitive' } },
          {
            soa_applications: {
              first_name: { contains: query.q, mode: 'insensitive' },
            },
          },
          {
            soa_applications: {
              last_name: { contains: query.q, mode: 'insensitive' },
            },
          },
        ],
      };
    }

    try {
      const [rows, total] = await this.prisma.$transaction(
        [
          this.prisma.bonafide_requests.findMany({
            where,
            skip: query.skip,
            take: query.limit,
            orderBy: { requested_at: 'desc' },
            select: LIST_SELECT,
          }),
          this.prisma.bonafide_requests.count({ where }),
        ],
        { timeout: 20_000, maxWait: 20_000 },
      );

      return paginate(rows.map(toListDto), total, query);
    } catch (err) {
      this.logger.error('Failed to list bonafide requests', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** GET /admin/bonafide-requests/:id (Admin only) — full detail for the certificate print template. */
  async findOne(id: number) {
    const row = await this.fetchDetailRow(id);
    return toDetailDto(row);
  }

  /**
   * PATCH /admin/bonafide-requests/:id/decision (Admin only)
   *
   * Only a pending request can be accepted or rejected — a request already
   * decided (faculty_approved/issued/rejected) doesn't have a "re-decide"
   * path, matching how the student-facing history screen is meant to show
   * one linear status progression per request.
   */
  async decide(id: number, dto: DecideBonafideRequestDto) {
    const row = await this.fetchDetailRow(id);

    if (row.status !== 'pending') {
      throw new BadRequestException({
        message: `Only a pending request can be ${dto.decision}d. This request is already ${row.status}.`,
        errorCode: 'INVALID_STATUS_TRANSITION',
      });
    }

    const nextStatus = dto.decision === 'approve' ? 'faculty_approved' : 'rejected';

    try {
      await this.prisma.bonafide_requests.update({
        where: { id },
        data: { status: nextStatus },
      });
    } catch (err) {
      this.logger.error(`Failed to ${dto.decision} bonafide request ${id}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    return this.findOne(id);
  }

  /**
   * PATCH /admin/bonafide-requests/:id/print (Admin only)
   *
   * Marks the request issued and stamps issued_at — this is the action that
   * flips the student's own Bonafide History entry away from "Pending" (the
   * student never downloads a file; the certificate is collected in
   * person, so this status flip is the only signal they get). Only allowed
   * once the request has been accepted (faculty_approved) — printing a
   * still-pending or already-rejected request isn't a valid transition.
   *
   * Idempotent once issued: a browser print dialog can be cancelled or fail
   * to render without the caller knowing, and the admin needs to be able to
   * hit Print again for the same request (same issued_at/issuer, not a new
   * stamp) rather than getting permanently stuck once status has already
   * flipped to issued.
   *
   * issued_by_hod_user_id stores the acting admin's users.id. The column
   * name predates this admin-only flow (this table's other decision column,
   * approved_by_faculty_id, is FK'd to `faculty` and left null here since
   * an admin account has no faculty row) — it's the only users-FK on this
   * table, so it's reused here rather than adding a new column for one
   * admin-attribution field.
   */
  async print(id: number, adminUserId: number) {
    const row = await this.fetchDetailRow(id);

    if (row.status === 'issued') {
      return this.findOne(id);
    }

    if (row.status !== 'faculty_approved') {
      throw new BadRequestException({
        message:
          'Only an accepted request can be printed. Accept the request first.',
        errorCode: 'INVALID_STATUS_TRANSITION',
      });
    }

    try {
      await this.prisma.bonafide_requests.update({
        where: { id },
        data: {
          status: 'issued',
          issued_at: new Date(),
          issued_by_hod_user_id: adminUserId,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to print bonafide request ${id}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    return this.findOne(id);
  }

  private async fetchDetailRow(id: number) {
    let row: DetailRow | null;
    try {
      row = await this.prisma.bonafide_requests.findUnique({
        where: { id },
        select: DETAIL_SELECT,
      });
    } catch (err) {
      this.logger.error(`Failed to fetch bonafide request ${id}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!row) {
      throw new NotFoundException({
        message: 'Bonafide request not found',
        errorCode: 'BONAFIDE_REQUEST_NOT_FOUND',
      });
    }

    return row;
  }
}
