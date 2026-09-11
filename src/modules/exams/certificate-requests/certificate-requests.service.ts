import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListCertificateRequestsQueryDto } from './dto/list-certificate-requests-query.dto';
import { CreateCertificateRequestDto } from './dto/create-certificate-request.dto';
import { UpdateCertificateStatusDto } from './dto/update-certificate-status.dto';
import { UpdateCertificateFeeDto } from './dto/update-certificate-fee.dto';

const STUDENT_SELECT = {
  id: true,
  user_id: true,
  student_id_no: true,
  roll_no: true,
  register_no: true,
  soa_applications: { select: { first_name: true, last_name: true } },
  classes: {
    select: {
      current_semester: true,
      department_id: true,
      departments: { select: { id: true, code: true, name: true } },
    },
  },
} as const;

const INCLUDE = {
  students: { select: STUDENT_SELECT },
  certificate_types: { select: { id: true, name: true } },
} as const;

function withNumericFee<T extends { fee_amount: Prisma.Decimal | null }>(
  row: T,
) {
  return {
    ...row,
    fee_amount: row.fee_amount != null ? Number(row.fee_amount) : null,
  };
}

/** Same June-cutoff academic-cycle boundary used across the rebuilt COE pages. */
function isThisCycle(date: Date, now: Date): boolean {
  const cycleStart = new Date(
    Date.UTC(
      now.getUTCMonth() >= 5 ? now.getUTCFullYear() : now.getUTCFullYear() - 1,
      5,
      1,
    ),
  );
  return date >= cycleStart;
}

@Injectable()
export class CertificateRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListCertificateRequestsQueryDto) {
    const where: Prisma.certificate_requestsWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.certificate_type_id)
      where.certificate_type_id = query.certificate_type_id;

    const studentsWhere: Prisma.studentsWhereInput = {};
    if (query.department_id)
      studentsWhere.classes = { department_id: query.department_id };
    if (query.search) {
      studentsWhere.OR = [
        { student_id_no: { contains: query.search, mode: 'insensitive' } },
        { register_no: { contains: query.search, mode: 'insensitive' } },
        { roll_no: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (Object.keys(studentsWhere).length > 0) where.students = studentsWhere;

    const rows = await this.prisma.certificate_requests.findMany({
      where,
      include: INCLUDE,
      orderBy: { requested_at: 'desc' },
    });
    return rows.map(withNumericFee);
  }

  /** Real KPI tiles for the Certificate Management page header. */
  async getStats() {
    const [total, issued, awaitingSignature, allRows, issuedWithDates] =
      await Promise.all([
        this.prisma.certificate_requests.count(),
        this.prisma.certificate_requests.count({ where: { status: 'issued' } }),
        this.prisma.certificate_requests.count({
          where: { signatory_status: 'awaiting' },
        }),
        this.prisma.certificate_requests.findMany({
          select: {
            id: true,
            student_id: true,
            certificate_type_id: true,
            fee_amount: true,
            requested_at: true,
          },
        }),
        this.prisma.certificate_requests.findMany({
          where: { status: 'issued', issued_at: { not: null } },
          select: { requested_at: true, issued_at: true },
        }),
      ]);

    // "Duplicate" = a real repeat request for the same (student, certificate type) — every request beyond the first, chronologically, for that pair.
    const byPair = new Map<string, (typeof allRows)[number][]>();
    for (const r of allRows) {
      const key = `${r.student_id}|${r.certificate_type_id}`;
      const list = byPair.get(key) ?? [];
      list.push(r);
      byPair.set(key, list);
    }
    let duplicateCount = 0;
    let duplicateFeeSum = 0;
    let duplicateFeeCount = 0;
    for (const list of byPair.values()) {
      if (list.length <= 1) continue;
      const sorted = [...list].sort(
        (a, b) => a.requested_at.getTime() - b.requested_at.getTime(),
      );
      for (const extra of sorted.slice(1)) {
        duplicateCount += 1;
        if (extra.fee_amount != null) {
          duplicateFeeSum += Number(extra.fee_amount);
          duplicateFeeCount += 1;
        }
      }
    }
    const avgDuplicateFee =
      duplicateFeeCount > 0
        ? Math.round(duplicateFeeSum / duplicateFeeCount)
        : null;

    const now = new Date();
    const avgDays = (
      rows: { requested_at: Date; issued_at: Date | null }[],
    ) => {
      if (rows.length === 0) return null;
      const sum = rows.reduce(
        (s, r) =>
          s + (r.issued_at!.getTime() - r.requested_at.getTime()) / 86_400_000,
        0,
      );
      return sum / rows.length;
    };
    const thisCycleTurnaround = avgDays(
      issuedWithDates.filter((r) => isThisCycle(r.requested_at, now)),
    );
    const previousCycleTurnaround = avgDays(
      issuedWithDates.filter((r) => !isThisCycle(r.requested_at, now)),
    );
    const turnaroundDelta =
      thisCycleTurnaround != null && previousCycleTurnaround != null
        ? Math.round((thisCycleTurnaround - previousCycleTurnaround) * 10) / 10
        : null;

    return {
      total,
      issued,
      issued_pct_of_requests:
        total > 0 ? Math.round((issued / total) * 1000) / 10 : null,
      awaiting_signature: awaitingSignature,
      duplicate_requests: duplicateCount,
      duplicate_avg_fee: avgDuplicateFee,
      avg_turnaround_days:
        thisCycleTurnaround != null
          ? Math.round(thisCycleTurnaround * 10) / 10
          : null,
      avg_turnaround_delta_days: turnaroundDelta,
    };
  }

  async listCertificateTypes() {
    return this.prisma.certificate_types.findMany({ orderBy: { name: 'asc' } });
  }

  /**
   * A certificate type with no real fee (fee_amount null/0) is treated as a
   * self-service, auto-issued document (matches the only real "auto"
   * signatory row already in this database — Transfer Certificate, fee 0,
   * issued with no pending stage); anything with a real fee goes through
   * the normal pending → signature → print → issue path.
   */
  async create(dto: CreateCertificateRequestDto) {
    const student = await this.prisma.students.findUnique({
      where: { id: dto.student_id },
    });
    if (!student)
      throw new NotFoundException({
        message: 'Student not found.',
        errorCode: 'STUDENT_NOT_FOUND',
      });

    const certificateType = await this.prisma.certificate_types.findUnique({
      where: { id: dto.certificate_type_id },
    });
    if (!certificateType)
      throw new NotFoundException({
        message: 'Certificate type not found.',
        errorCode: 'CERTIFICATE_TYPE_NOT_FOUND',
      });

    const copies = dto.copies ?? 1;
    const totalFee =
      dto.fee_amount != null ? dto.fee_amount * copies : undefined;
    const requiresFee = totalFee != null && totalFee > 0;

    const created = await this.prisma.certificate_requests.create({
      data: {
        student_id: dto.student_id,
        certificate_type_id: dto.certificate_type_id,
        fee_amount: totalFee,
        status: requiresFee ? 'pending' : 'ready_to_print',
        signatory_status: requiresFee ? 'awaiting' : 'auto',
        copies,
        delivery_mode: dto.delivery_mode,
        reason: dto.reason,
      },
      include: INCLUDE,
    });
    return withNumericFee(created);
  }

  /** Printing a signature-pending certificate is what actually records the sign-off — there's no separate "sign" step in the real workflow. */
  async updateStatus(id: number, dto: UpdateCertificateStatusDto) {
    const existing = await this.prisma.certificate_requests.findUnique({
      where: { id },
    });
    if (!existing)
      throw new NotFoundException({
        message: 'Certificate request not found.',
        errorCode: 'CERTIFICATE_REQUEST_NOT_FOUND',
      });

    const updated = await this.prisma.certificate_requests.update({
      where: { id },
      data: {
        status: dto.status,
        issued_at: dto.status === 'issued' ? new Date() : existing.issued_at,
        signatory_status:
          dto.status === 'printed' && existing.signatory_status === 'awaiting'
            ? 'signed'
            : existing.signatory_status,
      },
      include: INCLUDE,
    });
    return withNumericFee(updated);
  }

  /** Paying the real due amount is the "verification against dues" gate — clearing it while still pending opens up printing immediately, same as the modal's own copy promises. */
  async updateFee(id: number, dto: UpdateCertificateFeeDto) {
    const existing = await this.prisma.certificate_requests.findUnique({
      where: { id },
    });
    if (!existing)
      throw new NotFoundException({
        message: 'Certificate request not found.',
        errorCode: 'CERTIFICATE_REQUEST_NOT_FOUND',
      });

    const updated = await this.prisma.certificate_requests.update({
      where: { id },
      data: {
        fee_paid: dto.fee_paid,
        status:
          dto.fee_paid && existing.status === 'pending'
            ? 'ready_to_print'
            : existing.status,
      },
      include: INCLUDE,
    });
    return withNumericFee(updated);
  }

  /** POST /certificate-requests/:id/remind — a real in-app notification about the pending fee, same dispatch pattern used elsewhere (revaluation/question-papers/malpractice remind()). Only meaningful while genuinely stuck in "pending". */
  async remind(id: number) {
    const request = await this.prisma.certificate_requests.findUnique({
      where: { id },
      include: {
        students: { select: { user_id: true } },
        certificate_types: { select: { name: true } },
      },
    });
    if (!request)
      throw new NotFoundException({
        message: 'Certificate request not found.',
        errorCode: 'CERTIFICATE_REQUEST_NOT_FOUND',
      });
    if (request.status !== 'pending') {
      throw new ConflictException({
        message: 'This request is no longer pending — nothing to remind about.',
        errorCode: 'NOT_PENDING',
      });
    }

    return this.prisma.notifications.create({
      data: {
        user_id: request.students.user_id,
        title: `${request.certificate_types.name} request pending`,
        message: `Your ${request.certificate_types.name} request is on hold${request.fee_paid ? '' : ' until the fee is paid'}.`,
        related_entity_type: 'certificate_requests',
        related_entity_id: request.id,
      },
    });
  }
}
