import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { paginate } from 'src/common/dto/pagination.dto';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { CreatePayslipRequestDto } from './dto/create-payslip-request.dto';
import { UpdatePayslipRequestDto } from './dto/update-payslip-request.dto';
import { ListPayslipRequestQueryDto } from './dto/list-payslip-request-query.dto';

const PAYSLIP_SELECT = {
  id: true,
  month: true,
  year: true,
  status: true,
  file_url: true,
  requested_at: true,
  purpose: true,
  staff_user_id: true,
  faculty: {
    select: { id: true, first_name: true, last_name: true, designation: true },
  },
} as const;

interface PayslipRequestRow {
  id: number;
  month: number;
  year: number;
  status: string;
  file_url: string | null;
  requested_at: Date;
  purpose: string | null;
  staff_user_id: number | null;
  // Nullable only because the underlying faculty_id column was relaxed to
  // support a different, unrelated Secretary-facing feature (see the
  // Secretary module completion migration) — every row THIS module ever
  // creates or reads still always has faculty_id set (create() below is
  // still Faculty-only), so this stays a compile-time nullability fix,
  // not a real behavior change.
  faculty: {
    id: number;
    first_name: string;
    last_name: string;
    designation: string;
  } | null;
}

function parseMonthString(month: string): { year: number; month: number } {
  const [yearStr, monthStr] = month.split('-');
  return { year: Number(yearStr), month: Number(monthStr) };
}

function formatMonthString(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function toResponse(row: PayslipRequestRow) {
  return {
    id: row.id,
    month: formatMonthString(row.year, row.month),
    status: row.status,
    file_url: row.file_url,
    requested_at: row.requested_at,
    purpose: row.purpose,
    faculty: row.faculty,
    staff_user_id: row.staff_user_id,
  };
}

@Injectable()
export class PayslipRequestsService {
  private readonly logger = new Logger(PayslipRequestsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /payslip-requests (Faculty only).
   *
   * A prior request for the same month blocks a new one only while it's
   * still 'pending' or already 'processed' — a 'rejected' one (e.g. wrong
   * month, salary not finalized yet) can be re-requested.
   */
  async create(dto: CreatePayslipRequestDto, userId: number, role?: string) {
    const { year, month } = parseMonthString(dto.month);

    // Secretary (or any non-Faculty staff account) — no faculty row exists;
    // keyed by staff_user_id instead. Same one-active-request-per-month
    // rule applies.
    if (role === ROLES.SECRETARY) {
      const existing = await this.prisma.payslip_requests.findFirst({
        where: { staff_user_id: userId, year, month, status: { not: 'rejected' } },
      });
      if (existing) {
        throw new ConflictException(
          `A payslip request already exists for ${dto.month}`,
        );
      }
      const request = await this.prisma.payslip_requests.create({
        data: { staff_user_id: userId, year, month, purpose: dto.purpose },
        select: PAYSLIP_SELECT,
      });
      this.logger.log(`Staff payslip request created: id=${request.id}`);
      return toResponse(request);
    }

    const faculty = await this.resolveFacultyByUserId(userId);

    const existing = await this.prisma.payslip_requests.findFirst({
      where: {
        faculty_id: faculty.id,
        year,
        month,
        status: { not: 'rejected' },
      },
    });
    if (existing) {
      throw new ConflictException(
        `A payslip request already exists for ${dto.month}`,
      );
    }

    const request = await this.prisma.payslip_requests.create({
      data: { faculty_id: faculty.id, year, month, purpose: dto.purpose },
      select: PAYSLIP_SELECT,
    });

    this.logger.log(
      `Payslip request created: id=${request.id} faculty=${faculty.id} month=${dto.month}`,
    );
    return toResponse(request);
  }

  /** GET /payslip-requests (HR Payroll all / Faculty own only). */
  async findAll(query: ListPayslipRequestQueryDto, currentUser: JwtPayload) {
    const where: Record<string, unknown> = {
      faculty_id: query.faculty_id,
      status: query.status,
    };

    if (query.month) {
      const { year, month } = parseMonthString(query.month);
      where.year = year;
      where.month = month;
    }

    if (currentUser.role === ROLES.FACULTY || currentUser.role === ROLES.HOD) {
      const faculty = await this.resolveFacultyByUserId(currentUser.sub);
      where.faculty_id = faculty.id;
    } else if (currentUser.role === ROLES.SECRETARY) {
      delete where.faculty_id;
      where.staff_user_id = currentUser.sub;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payslip_requests.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        select: PAYSLIP_SELECT,
      }),
      this.prisma.payslip_requests.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  /** GET /payslip-requests/:id (HR Payroll all / Faculty own only). */
  async findOne(id: number, currentUser: JwtPayload) {
    const request = await this.prisma.payslip_requests.findUnique({
      where: { id },
      select: PAYSLIP_SELECT,
    });
    if (!request) {
      throw new NotFoundException('Payslip request not found');
    }

    if (currentUser.role === ROLES.FACULTY || currentUser.role === ROLES.HOD) {
      const faculty = await this.resolveFacultyByUserId(currentUser.sub);
      if (request.faculty?.id !== faculty.id) {
        throw new ForbiddenException(
          'You may only view your own payslip requests',
        );
      }
    } else if (currentUser.role === ROLES.SECRETARY) {
      if (request.staff_user_id !== currentUser.sub) {
        throw new ForbiddenException(
          'You may only view your own payslip requests',
        );
      }
    }

    return toResponse(request);
  }

  /**
   * PATCH /payslip-requests/:id (HR Payroll only). Marks the request
   * 'processed' or 'rejected' directly - no file is required to approve.
   * file_url stays whatever it already was (null unless set through some
   * other means) - this endpoint never fabricates one.
   */
  async update(id: number, dto: UpdatePayslipRequestDto) {
    const existing = await this.prisma.payslip_requests.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Payslip request not found');
    }

    if (existing.status !== 'pending') {
      throw new ConflictException(
        'This payslip request has already been processed',
      );
    }

    const updated = await this.prisma.payslip_requests.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.file_url !== undefined && { file_url: dto.file_url }),
      },
      select: PAYSLIP_SELECT,
    });

    this.logger.log(`Payslip request ${id} updated to status=${dto.status}`);
    return toResponse(updated);
  }

  /**
   * PATCH /me/my-payslip-requests/:id — self-edit of the requester's OWN
   * still-'pending' payslip request (purpose only — month/year are
   * immutable once created, since a new month is just a new request).
   */
  async updateOwnPurpose(id: number, userId: number, role: string | undefined, purpose: string) {
    const existing = await this.prisma.payslip_requests.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Payslip request not found');
    }

    if (role === ROLES.SECRETARY) {
      if (existing.staff_user_id !== userId) {
        throw new ForbiddenException('You may only edit your own payslip requests');
      }
    } else {
      const faculty = await this.resolveFacultyByUserId(userId);
      if (existing.faculty_id !== faculty.id) {
        throw new ForbiddenException('You may only edit your own payslip requests');
      }
    }

    if (existing.status !== 'pending') {
      throw new ConflictException(
        'This request has already been processed and can no longer be edited',
      );
    }

    const updated = await this.prisma.payslip_requests.update({
      where: { id },
      data: { purpose },
      select: PAYSLIP_SELECT,
    });
    return toResponse(updated);
  }

  /** DELETE /payslip-requests/:id (Faculty only — own request, only while still 'pending'). */
  async remove(id: number, userId: number, role?: string) {
    const existing = await this.prisma.payslip_requests.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Payslip request not found');
    }

    if (role === ROLES.SECRETARY) {
      if (existing.staff_user_id !== userId) {
        throw new ForbiddenException(
          'You may only withdraw your own payslip requests',
        );
      }
    } else {
      const faculty = await this.resolveFacultyByUserId(userId);
      if (existing.faculty_id !== faculty.id) {
        throw new ForbiddenException(
          'You may only withdraw your own payslip requests',
        );
      }
    }

    if (existing.status !== 'pending') {
      throw new ConflictException(
        'Only a request still pending can be withdrawn',
      );
    }

    await this.prisma.payslip_requests.delete({ where: { id } });

    this.logger.log(`Payslip request deleted: id=${id}`);
    return { id, deleted: true };
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
