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
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto';
import { ListPurchaseRequestsQueryDto } from './dto/list-purchase-requests-query.dto';
import { HodReviewPurchaseRequestDto } from './dto/hod-review-purchase-request.dto';
import { FinanceReviewPurchaseRequestDto } from './dto/finance-review-purchase-request.dto';

/**
 * Self-service layer over the existing purchase_indents /
 * purchase_order_proposals / purchase_orders tables, implementing the
 * requested workflow: Secretary creates -> HoD reviews -> Finance reviews
 * -> Admin converts to a purchase_orders record.
 *
 * This is deliberately a NEW layer, not a rewrite of the pre-existing
 * PurchaseIndentsService/PurchaseOrderProposalsService/PurchaseOrdersService
 * (those remain exactly as they were - plain Admin-only CRUD with no
 * self-scoping, and their own hodReview/financeReview enforce the OPPOSITE
 * order: Finance first, then HoD). Both API surfaces read/write the same
 * tables and can coexist; this one is what the mobile app talks to.
 *
 * A single purchase_order_proposals row is treated as the one review-
 * tracking record per request (created 1:1 with its indent, vendor_id left
 * null - vendor selection is out of scope for this flow and remains
 * available separately through the existing Admin-only endpoints).
 * proposal_status_enum only has 4 values (pending, hod_approved,
 * finance_approved, rejected) and no per-stage "who rejected" flag, so the
 * unified status exposed to the client is DERIVED (see deriveStatus) rather
 * than stored directly.
 */

const PROPOSAL_INCLUDE = {
  purchase_indents: {
    include: {
      departments: { select: { id: true, name: true } },
      users: { select: { id: true, email: true } },
    },
  },
  users_purchase_order_proposals_hod_reviewed_byTousers: {
    select: { id: true, email: true },
  },
  users_purchase_order_proposals_finance_reviewed_byTousers: {
    select: { id: true, email: true },
  },
  purchase_orders: true,
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
  purchase_indents: {
    id: number;
    item_name: string;
    quantity: number;
    purpose: string | null;
    needed_by: Date | null;
    department_id: number;
    created_at: Date;
    departments: { id: number; name: string };
    users: { id: number; email: string };
  };
  users_purchase_order_proposals_hod_reviewed_byTousers: { id: number; email: string } | null;
  users_purchase_order_proposals_finance_reviewed_byTousers: { id: number; email: string } | null;
  purchase_orders: { po_number: string; created_at: Date } | null;
};

// The proposal's own status only tells you the LATEST stage's outcome, not
// which stage produced a rejection - distinguished here by which reviewer
// field is populated (finance_reviewed_by set => finance rejected it after
// the HoD had already approved; otherwise the HoD rejected it first).
function deriveStatus(row: ProposalRow): string {
  if (row.purchase_orders) return 'converted';
  if (row.status === 'rejected') {
    return row.finance_reviewed_by ? 'rejected_by_finance' : 'rejected_by_hod';
  }
  if (row.status === 'pending') return 'pending_hod';
  if (row.status === 'hod_approved') return 'pending_finance';
  return 'approved'; // finance_approved
}

function toResponse(row: ProposalRow) {
  const indent = row.purchase_indents;
  return {
    id: row.id,
    title: indent.item_name,
    department: indent.departments,
    raised_by: indent.users,
    purpose: indent.purpose,
    quantity: indent.quantity,
    needed_by: indent.needed_by,
    status: deriveStatus(row),
    hod_reviewer: row.users_purchase_order_proposals_hod_reviewed_byTousers,
    hod_reviewed_at: row.hod_reviewed_at,
    hod_remarks: row.hod_remarks,
    finance_reviewer: row.users_purchase_order_proposals_finance_reviewed_byTousers,
    finance_reviewed_at: row.finance_reviewed_at,
    finance_remarks: row.finance_remarks,
    order_number: row.purchase_orders?.po_number ?? null,
    converted_at: row.purchase_orders?.created_at ?? null,
    created_at: indent.created_at,
  };
}

@Injectable()
export class PurchaseRequestsService {
  private readonly logger = new Logger(PurchaseRequestsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** POST /me/purchase-requests (Secretary only). */
  async create(dto: CreatePurchaseRequestDto, userId: number) {
    const department = await this.prisma.departments.findUnique({
      where: { id: dto.department_id },
    });
    if (!department) {
      throw new NotFoundException({
        message: 'Department not found',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }

    const indent = await this.prisma.purchase_indents.create({
      data: {
        requested_by_user_id: userId,
        department_id: dto.department_id,
        item_name: dto.item_name,
        quantity: dto.quantity,
        purpose: dto.purpose,
        needed_by: dto.needed_by ? new Date(dto.needed_by) : undefined,
      },
    });

    const proposal = await this.prisma.purchase_order_proposals.create({
      data: { indent_id: indent.id },
      include: PROPOSAL_INCLUDE,
    });

    this.logger.log(
      `Purchase request created: proposal=${proposal.id} indent=${indent.id} by user=${userId} dept=${dto.department_id}`,
    );
    return toResponse(proposal as unknown as ProposalRow);
  }

  /**
   * GET /me/purchase-requests — scoped per role:
   *  Secretary -> their own submissions only
   *  HoD       -> their own department only (via their own faculty row)
   *  Finance/Admin -> institution-wide
   *
   * `status` is derived, not a DB column, so filtering/sorting/pagination
   * all happen in application code after fetching the role-scoped rows
   * (capped at 500 - generous for this demo's scale, documented rather than
   * silently truncated).
   */
  async findAll(query: ListPurchaseRequestsQueryDto, currentUser: JwtPayload) {
    const where: Record<string, unknown> = {};

    if (currentUser.role === ROLES.SECRETARY) {
      where.purchase_indents = { requested_by_user_id: currentUser.sub };
    } else if (currentUser.role === ROLES.HOD) {
      const hod = await this.resolveFacultyByUserId(currentUser.sub);
      where.purchase_indents = { department_id: hod.department_id };
    }

    const rows = (await this.prisma.purchase_order_proposals.findMany({
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

  /** GET /me/purchase-requests/:id — same per-role scoping as findAll, enforced as a 403 rather than a silent filter. */
  async findOne(id: number, currentUser: JwtPayload) {
    const row = (await this.prisma.purchase_order_proposals.findUnique({
      where: { id },
      include: PROPOSAL_INCLUDE,
    })) as unknown as ProposalRow | null;
    if (!row) {
      throw new NotFoundException({
        message: 'Purchase request not found',
        errorCode: 'PURCHASE_REQUEST_NOT_FOUND',
      });
    }

    if (
      currentUser.role === ROLES.SECRETARY &&
      row.purchase_indents.users.id !== currentUser.sub
    ) {
      throw new ForbiddenException({
        message: 'You may only view your own requests',
        errorCode: 'NOT_THE_REQUESTER',
      });
    }
    if (currentUser.role === ROLES.HOD) {
      const hod = await this.resolveFacultyByUserId(currentUser.sub);
      if (row.purchase_indents.department_id !== hod.department_id) {
        throw new ForbiddenException({
          message: 'You may only view requests from your own department',
          errorCode: 'NOT_YOUR_DEPARTMENT',
        });
      }
    }

    return toResponse(row);
  }

  /**
   * PATCH /me/purchase-requests/:id/hod-review (HoD only, own department,
   * only while the proposal is 'pending').
   */
  async hodReview(id: number, dto: HodReviewPurchaseRequestDto, currentUser: JwtPayload) {
    const hod = await this.resolveFacultyByUserId(currentUser.sub);

    const existing = await this.prisma.purchase_order_proposals.findUnique({
      where: { id },
      include: { purchase_indents: true },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Purchase request not found',
        errorCode: 'PURCHASE_REQUEST_NOT_FOUND',
      });
    }
    if (existing.purchase_indents.department_id !== hod.department_id) {
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
      this.prisma.purchase_order_proposals.update({
        where: { id },
        data: {
          status: nextStatus,
          hod_reviewed_by: currentUser.sub,
          hod_reviewed_at: new Date(),
          hod_remarks: dto.remarks,
        },
        include: PROPOSAL_INCLUDE,
      }),
      this.prisma.purchase_indents.update({
        where: { id: existing.indent_id },
        data: { status: nextStatus },
      }),
    ]);

    this.logger.log(
      `Purchase request ${id} ${dto.decision === 'approved' ? 'forwarded to Finance' : 'rejected'} by HoD user=${currentUser.sub}`,
    );
    return toResponse(proposal as unknown as ProposalRow);
  }

  /**
   * PATCH /me/purchase-requests/:id/finance-review (Finance only, only
   * while the proposal is 'hod_approved').
   */
  async financeReview(id: number, dto: FinanceReviewPurchaseRequestDto, userId: number) {
    const existing = await this.prisma.purchase_order_proposals.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Purchase request not found',
        errorCode: 'PURCHASE_REQUEST_NOT_FOUND',
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
      this.prisma.purchase_order_proposals.update({
        where: { id },
        data: {
          status: nextStatus,
          finance_reviewed_by: userId,
          finance_reviewed_at: new Date(),
          finance_remarks: dto.remarks,
        },
        include: PROPOSAL_INCLUDE,
      }),
      this.prisma.purchase_indents.update({
        where: { id: existing.indent_id },
        data: { status: nextStatus },
      }),
    ]);

    this.logger.log(
      `Purchase request ${id} ${dto.decision === 'approved' ? 'approved' : 'rejected'} by Finance user=${userId}`,
    );
    return toResponse(proposal as unknown as ProposalRow);
  }

  /**
   * PATCH /me/purchase-requests/:id/convert (Admin only, only while the
   * proposal is 'finance_approved'). Creates the actual purchase_orders
   * record - po_number follows the same PO-{year}-{proposalId, 4 digits}
   * convention already used by the existing seeded rows.
   */
  async convert(id: number, userId: number) {
    const existing = await this.prisma.purchase_order_proposals.findUnique({
      where: { id },
      include: { purchase_orders: true },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Purchase request not found',
        errorCode: 'PURCHASE_REQUEST_NOT_FOUND',
      });
    }
    if (existing.purchase_orders) {
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
    const poNumber = `PO-${year}-${String(id).padStart(4, '0')}`;

    const [, , proposal] = await this.prisma.$transaction([
      this.prisma.purchase_orders.create({
        data: {
          proposal_id: id,
          po_number: poNumber,
          approved_by_user_id: userId,
          approved_at: new Date(),
        },
      }),
      this.prisma.purchase_indents.update({
        where: { id: existing.indent_id },
        data: { status: 'order_created' },
      }),
      this.prisma.purchase_order_proposals.findUnique({
        where: { id },
        include: PROPOSAL_INCLUDE,
      }),
    ]);

    this.logger.log(`Purchase request ${id} converted to ${poNumber} by admin user=${userId}`);
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
