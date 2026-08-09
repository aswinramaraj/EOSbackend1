import { ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

interface PendingRow {
  id: number;
  title: string;
  detail: string | null;
  needed_by: Date | null;
  dept_code: string | null;
  dept_name: string | null;
  requester_name: string;
  raised_at: Date;
  hod_approved_at: Date | null;
  estimated_amount: string | null;
}

const REQUESTER_NAME_SQL = Prisma.sql`
  COALESCE(
    NULLIF(TRIM(CONCAT(f.first_name, ' ', COALESCE(f.last_name, ''))), ''),
    NULLIF(TRIM(CONCAT(nts.first_name, ' ', COALESCE(nts.last_name, ''))), ''),
    u.email
  )
`;

/**
 * Principal-only Approvals - purchase & service proposals only (the only
 * two approval chains that exist as real tables anywhere in the schema;
 * see the design conversation for why events/policy-change/recruitment
 * approvals aren't included). Flow: pending -> hod_approved ->
 * principal_approved -> finance_approved (terminal), or rejected at any
 * point. Principal's queue = status = 'hod_approved' with
 * principal_reviewed_by still null. "Estimated amount" comes from the
 * proposal's selected vendor's item_price (vendors.item_price) - often
 * null, since a vendor isn't always chosen by the time HoD has approved.
 */
@Injectable()
export class PrincipalApprovalsService {
  private readonly logger = new Logger(PrincipalApprovalsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listPending() {
    try {
      const purchaseRows = await this.prisma.$queryRaw<PendingRow[]>(Prisma.sql`
        SELECT pop.id,
          pi.item_name AS title,
          pi.purpose AS detail,
          pi.needed_by,
          d.code AS dept_code, d.name AS dept_name,
          ${REQUESTER_NAME_SQL} AS requester_name,
          pi.created_at AS raised_at,
          pop.hod_reviewed_at AS hod_approved_at,
          v.item_price::text AS estimated_amount
        FROM purchase_order_proposals pop
        JOIN purchase_indents pi ON pi.id = pop.indent_id
        JOIN departments d ON d.id = pi.department_id
        JOIN users u ON u.id = pi.requested_by_user_id
        LEFT JOIN faculty f ON f.user_id = pi.requested_by_user_id
        LEFT JOIN non_teaching_staff nts ON nts.user_id = pi.requested_by_user_id
        LEFT JOIN vendors v ON v.id = pop.vendor_id
        WHERE pop.status = 'hod_approved' AND pop.principal_reviewed_by IS NULL
        ORDER BY pi.created_at ASC
      `);

      const serviceRows = await this.prisma.$queryRaw<PendingRow[]>(Prisma.sql`
        SELECT sop.id,
          COALESCE(si.title, si.service_description) AS title,
          si.location AS detail,
          si.needed_by,
          d.code AS dept_code, d.name AS dept_name,
          ${REQUESTER_NAME_SQL} AS requester_name,
          si.created_at AS raised_at,
          sop.hod_reviewed_at AS hod_approved_at,
          v.item_price::text AS estimated_amount
        FROM service_order_proposals sop
        JOIN service_indents si ON si.id = sop.indent_id
        JOIN departments d ON d.id = si.department_id
        JOIN users u ON u.id = si.requested_by_user_id
        LEFT JOIN faculty f ON f.user_id = si.requested_by_user_id
        LEFT JOIN non_teaching_staff nts ON nts.user_id = si.requested_by_user_id
        LEFT JOIN vendors v ON v.id = sop.vendor_id
        WHERE sop.status = 'hod_approved' AND sop.principal_reviewed_by IS NULL
        ORDER BY si.created_at ASC
      `);

      const toItem = (row: PendingRow, type: 'purchase' | 'service') => ({
        id: row.id,
        type,
        title: row.title,
        detail: row.detail,
        needed_by: row.needed_by,
        department_code: row.dept_code,
        department_name: row.dept_name,
        requested_by: row.requester_name,
        raised_at: row.raised_at,
        hod_approved_at: row.hod_approved_at,
        estimated_amount: row.estimated_amount !== null ? Number(row.estimated_amount) : null,
      });

      const items = [
        ...purchaseRows.map((row) => toItem(row, 'purchase' as const)),
        ...serviceRows.map((row) => toItem(row, 'service' as const)),
      ].sort((a, b) => new Date(a.raised_at).getTime() - new Date(b.raised_at).getTime());

      return { total: items.length, items };
    } catch (err) {
      this.logger.error('DB error listing principal approvals', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async approvePurchase(id: number, principalUserId: number) {
    return this.reviewPurchase(id, principalUserId, 'principal_approved');
  }

  async rejectPurchase(id: number, principalUserId: number) {
    return this.reviewPurchase(id, principalUserId, 'rejected');
  }

  async approveService(id: number, principalUserId: number) {
    return this.reviewService(id, principalUserId, 'principal_approved');
  }

  async rejectService(id: number, principalUserId: number) {
    return this.reviewService(id, principalUserId, 'rejected');
  }

  private assertAwaitingPrincipal(existing: { status: string; principal_reviewed_by: number | null } | null) {
    if (!existing) {
      throw new NotFoundException({
        message: 'Approval request not found',
        errorCode: 'APPROVAL_NOT_FOUND',
      });
    }
    if (existing.status !== 'hod_approved' || existing.principal_reviewed_by !== null) {
      throw new ForbiddenException({
        message: 'This request is not awaiting Principal review',
        errorCode: 'NOT_AWAITING_PRINCIPAL_REVIEW',
      });
    }
  }

  private async reviewPurchase(id: number, principalUserId: number, nextStatus: 'principal_approved' | 'rejected') {
    try {
      const existing = await this.prisma.purchase_order_proposals.findUnique({ where: { id } });
      this.assertAwaitingPrincipal(existing);

      await this.prisma.purchase_order_proposals.update({
        where: { id },
        data: { status: nextStatus, principal_reviewed_by: principalUserId, principal_reviewed_at: new Date() },
      });

      return { id, type: 'purchase' as const, status: nextStatus };
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof ForbiddenException) throw err;
      this.logger.error(`DB error reviewing purchase proposal ${id}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async reviewService(id: number, principalUserId: number, nextStatus: 'principal_approved' | 'rejected') {
    try {
      const existing = await this.prisma.service_order_proposals.findUnique({ where: { id } });
      this.assertAwaitingPrincipal(existing);

      await this.prisma.service_order_proposals.update({
        where: { id },
        data: { status: nextStatus, principal_reviewed_by: principalUserId, principal_reviewed_at: new Date() },
      });

      return { id, type: 'service' as const, status: nextStatus };
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof ForbiddenException) throw err;
      this.logger.error(`DB error reviewing service proposal ${id}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
