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
import { CreateServiceRequestDto } from './dto/create-service-request.dto';
import { ListServiceRequestsQueryDto } from './dto/list-service-requests-query.dto';
import { HodReviewServiceRequestDto } from './dto/hod-review-service-request.dto';
import { FinanceReviewServiceRequestDto } from './dto/finance-review-service-request.dto';

/**
 * Self-service layer over the existing service_indents /
 * service_order_proposals / service_orders tables - mirrors
 * PurchaseRequestsService exactly (see its own doc comment for the full
 * rationale: why this is a separate layer from the pre-existing Admin-only
 * CRUD, why vendor_id is left null, and why status is derived rather than
 * stored directly).
 */

const PROPOSAL_INCLUDE = {
  service_indents: {
    include: {
      departments: { select: { id: true, name: true } },
      users: { select: { id: true, email: true } },
    },
  },
  users_service_order_proposals_hod_reviewed_byTousers: {
    select: { id: true, email: true },
  },
  users_service_order_proposals_finance_reviewed_byTousers: {
    select: { id: true, email: true },
  },
  service_orders: true,
} as const;

type ProposalRow = {
  id: number;
  vendor_id: number | null;
  status: string;
  hod_reviewed_by: number | null;
  hod_reviewed_at: Date | null;
  hod_remarks: string | null;
  finance_reviewed_by: number | null;
  finance_reviewed_at: Date | null;
  finance_remarks: string | null;
  service_indents: {
    id: number;
    title: string | null;
    service_description: string;
    quantity: string | null;
    location: string | null;
    needed_by: Date | null;
    department_id: number;
    created_at: Date;
    departments: { id: number; name: string };
    users: { id: number; email: string };
  };
  users_service_order_proposals_hod_reviewed_byTousers: { id: number; email: string } | null;
  users_service_order_proposals_finance_reviewed_byTousers: { id: number; email: string } | null;
  service_orders: { so_number: string; created_at: Date } | null;
};

function deriveStatus(row: ProposalRow): string {
  if (row.service_orders) return 'converted';
  if (row.status === 'rejected') {
    return row.finance_reviewed_by ? 'rejected_by_finance' : 'rejected_by_hod';
  }
  if (row.status === 'pending') return 'pending_hod';
  if (row.status === 'hod_approved') return 'pending_finance';
  return 'approved'; // finance_approved
}

function toResponse(row: ProposalRow) {
  const indent = row.service_indents;
  return {
    id: row.id,
    title: indent.title,
    department: indent.departments,
    raised_by: indent.users,
    service_description: indent.service_description,
    quantity: indent.quantity,
    location: indent.location,
    needed_by: indent.needed_by,
    status: deriveStatus(row),
    hod_reviewer: row.users_service_order_proposals_hod_reviewed_byTousers,
    hod_reviewed_at: row.hod_reviewed_at,
    hod_remarks: row.hod_remarks,
    finance_reviewer: row.users_service_order_proposals_finance_reviewed_byTousers,
    finance_reviewed_at: row.finance_reviewed_at,
    finance_remarks: row.finance_remarks,
    order_number: row.service_orders?.so_number ?? null,
    converted_at: row.service_orders?.created_at ?? null,
    created_at: indent.created_at,
  };
}

@Injectable()
export class ServiceRequestsService {
  private readonly logger = new Logger(ServiceRequestsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** POST /me/service-requests (Secretary only). */
  async create(dto: CreateServiceRequestDto, userId: number) {
    const department = await this.prisma.departments.findUnique({
      where: { id: dto.department_id },
    });
    if (!department) {
      throw new NotFoundException({
        message: 'Department not found',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }

    const indent = await this.prisma.service_indents.create({
      data: {
        requested_by_user_id: userId,
        department_id: dto.department_id,
        title: dto.title,
        service_description: dto.service_description,
        quantity: dto.quantity,
        location: dto.location,
        needed_by: dto.needed_by ? new Date(dto.needed_by) : undefined,
      },
    });

    const proposal = await this.prisma.service_order_proposals.create({
      data: { indent_id: indent.id },
      include: PROPOSAL_INCLUDE,
    });

    this.logger.log(
      `Service request created: proposal=${proposal.id} indent=${indent.id} by user=${userId} dept=${dto.department_id}`,
    );
    return toResponse(proposal as unknown as ProposalRow);
  }

  /** GET /me/service-requests — same per-role scoping as PurchaseRequestsService.findAll. */
  async findAll(query: ListServiceRequestsQueryDto, currentUser: JwtPayload) {
    const where: Record<string, unknown> = {};

    if (currentUser.role === ROLES.SECRETARY) {
      where.service_indents = { requested_by_user_id: currentUser.sub };
    } else if (currentUser.role === ROLES.HOD) {
      const hod = await this.resolveFacultyByUserId(currentUser.sub);
      where.service_indents = { department_id: hod.department_id };
    }

    const rows = (await this.prisma.service_order_proposals.findMany({
      where,
      include: PROPOSAL_INCLUDE,
      orderBy: { id: 'desc' },
      take: 500,
    })) as unknown as ProposalRow[];

    let responses = rows.map(toResponse);
    if (query.status) {
      responses = responses.filter((r) => r.status === query.status);
    }

    const total = responses.length;
    const start = query.skip;
    const page = responses.slice(start, start + query.limit!);

    return paginate(page, total, query);
  }

  /** GET /me/service-requests/:id — same per-role scoping as findAll, enforced as a 403 rather than a silent filter. */
  async findOne(id: number, currentUser: JwtPayload) {
    const row = (await this.prisma.service_order_proposals.findUnique({
      where: { id },
      include: PROPOSAL_INCLUDE,
    })) as unknown as ProposalRow | null;
    if (!row) {
      throw new NotFoundException({
        message: 'Service request not found',
        errorCode: 'SERVICE_REQUEST_NOT_FOUND',
      });
    }

    if (
      currentUser.role === ROLES.SECRETARY &&
      row.service_indents.users.id !== currentUser.sub
    ) {
      throw new ForbiddenException({
        message: 'You may only view your own requests',
        errorCode: 'NOT_THE_REQUESTER',
      });
    }
    if (currentUser.role === ROLES.HOD) {
      const hod = await this.resolveFacultyByUserId(currentUser.sub);
      if (row.service_indents.department_id !== hod.department_id) {
        throw new ForbiddenException({
          message: 'You may only view requests from your own department',
          errorCode: 'NOT_YOUR_DEPARTMENT',
        });
      }
    }

    return toResponse(row);
  }

  /** PATCH /me/service-requests/:id/hod-review (HoD only, own department, only while 'pending'). */
  async hodReview(id: number, dto: HodReviewServiceRequestDto, currentUser: JwtPayload) {
    const hod = await this.resolveFacultyByUserId(currentUser.sub);

    const existing = await this.prisma.service_order_proposals.findUnique({
      where: { id },
      include: { service_indents: true },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Service request not found',
        errorCode: 'SERVICE_REQUEST_NOT_FOUND',
      });
    }
    if (existing.service_indents.department_id !== hod.department_id) {
      throw new ForbiddenException({
        message: 'You may only review requests from your own department',
        errorCode: 'NOT_YOUR_DEPARTMENT',
      });
    }
    if (existing.status !== 'pending') {
      throw new UnprocessableEntityException({
        message: 'This request is not awaiting HoD review',
        errorCode: 'INVALID_WORKFLOW_STATE',
      });
    }

    const nextStatus = dto.decision === 'approved' ? 'hod_approved' : 'rejected';
    const [proposal] = await this.prisma.$transaction([
      this.prisma.service_order_proposals.update({
        where: { id },
        data: {
          status: nextStatus,
          hod_reviewed_by: currentUser.sub,
          hod_reviewed_at: new Date(),
          hod_remarks: dto.remarks,
        },
        include: PROPOSAL_INCLUDE,
      }),
      this.prisma.service_indents.update({
        where: { id: existing.indent_id },
        data: { status: nextStatus },
      }),
    ]);

    this.logger.log(
      `Service request ${id} ${dto.decision === 'approved' ? 'forwarded to Finance' : 'rejected'} by HoD user=${currentUser.sub}`,
    );
    return toResponse(proposal as unknown as ProposalRow);
  }

  /** PATCH /me/service-requests/:id/finance-review (Finance only, only while 'hod_approved'). */
  async financeReview(id: number, dto: FinanceReviewServiceRequestDto, userId: number) {
    const existing = await this.prisma.service_order_proposals.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Service request not found',
        errorCode: 'SERVICE_REQUEST_NOT_FOUND',
      });
    }
    if (existing.status !== 'hod_approved') {
      throw new UnprocessableEntityException({
        message: 'This request is not awaiting Finance review',
        errorCode: 'INVALID_WORKFLOW_STATE',
      });
    }

    const nextStatus = dto.decision === 'approved' ? 'finance_approved' : 'rejected';
    const [proposal] = await this.prisma.$transaction([
      this.prisma.service_order_proposals.update({
        where: { id },
        data: {
          status: nextStatus,
          finance_reviewed_by: userId,
          finance_reviewed_at: new Date(),
          finance_remarks: dto.remarks,
        },
        include: PROPOSAL_INCLUDE,
      }),
      this.prisma.service_indents.update({
        where: { id: existing.indent_id },
        data: { status: nextStatus },
      }),
    ]);

    this.logger.log(
      `Service request ${id} ${dto.decision === 'approved' ? 'approved' : 'rejected'} by Finance user=${userId}`,
    );
    return toResponse(proposal as unknown as ProposalRow);
  }

  /**
   * PATCH /me/service-requests/:id/convert (Admin only, only while
   * 'finance_approved'). so_number follows the same SO-{year}-{proposalId,
   * 4 digits} convention already used by the existing seeded rows.
   */
  async convert(id: number, userId: number) {
    const existing = await this.prisma.service_order_proposals.findUnique({
      where: { id },
      include: { service_orders: true },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Service request not found',
        errorCode: 'SERVICE_REQUEST_NOT_FOUND',
      });
    }
    if (existing.service_orders) {
      throw new UnprocessableEntityException({
        message: 'This request has already been converted',
        errorCode: 'INVALID_WORKFLOW_STATE',
      });
    }
    if (existing.status !== 'finance_approved') {
      throw new UnprocessableEntityException({
        message: 'Only a Finance-approved request can be converted',
        errorCode: 'INVALID_WORKFLOW_STATE',
      });
    }

    const year = new Date().getFullYear();
    const soNumber = `SO-${year}-${String(id).padStart(4, '0')}`;

    const [, , proposal] = await this.prisma.$transaction([
      this.prisma.service_orders.create({
        data: {
          proposal_id: id,
          so_number: soNumber,
          approved_by_user_id: userId,
          approved_at: new Date(),
        },
      }),
      this.prisma.service_indents.update({
        where: { id: existing.indent_id },
        data: { status: 'order_created' },
      }),
      this.prisma.service_order_proposals.findUnique({
        where: { id },
        include: PROPOSAL_INCLUDE,
      }),
    ]);

    this.logger.log(`Service request ${id} converted to ${soNumber} by admin user=${userId}`);
    return toResponse(proposal as unknown as ProposalRow);
  }

  private async resolveFacultyByUserId(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'Faculty profile not found for the authenticated user',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    return faculty;
  }
}
