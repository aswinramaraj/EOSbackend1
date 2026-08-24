import { Injectable } from '@nestjs/common';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { PurchaseRequestsService } from '../procurement/purchase-requests/purchase-requests.service';
import { ServiceRequestsService } from '../procurement/service-requests/service-requests.service';

type SopPopStatus = 'awaiting_hod' | 'sent_to_principal' | 'rejected';

function mapStatus(status: string): SopPopStatus {
  if (status === 'pending_hod') return 'awaiting_hod';
  if (status === 'rejected_by_hod' || status === 'rejected_by_finance')
    return 'rejected';
  // pending_finance / converted / approved — past the HoD's own stage.
  return 'sent_to_principal';
}

/**
 * GET /hod/sop-pop-requests — a unified view over two real, already
 * HOD-scoped self-service workflows: "POP" = purchase requests
 * (`PurchaseRequestsService`, Secretary raises → HoD reviews → Finance →
 * Admin converts), "SOP" = service requests (`ServiceRequestsService`,
 * identical shape for services). Reused wholesale — the dual-stage
 * approval/rejection rules already live there, not re-implemented.
 *
 * `next_stage` and `status` map that service's real derived 6-state status
 * onto the frontend's simpler 3-state model: `pending_hod` → `awaiting_hod`;
 * `rejected_by_hod`/`rejected_by_finance` → `rejected`; everything past the
 * HoD's own stage (`pending_finance`/`approved`/`converted`) → `sent_to_principal`
 * (the closest real bucket for "no longer awaiting me").
 */
@Injectable()
export class HodSopPopService {
  constructor(
    private readonly purchaseRequests: PurchaseRequestsService,
    private readonly serviceRequests: ServiceRequestsService,
  ) {}

  async getRequests(user: JwtPayload) {
    const pop = await this.purchaseRequests.findAll(
      { limit: 500, page: 1, skip: 0 },
      user,
    );
    const sop = await this.serviceRequests.findAll(
      { limit: 500, page: 1, skip: 0 },
      user,
    );

    const popRows = pop.data.map((r) => ({
      id: r.id,
      kind: 'pop' as const,
      display_id: `POP-${r.id}`,
      title: r.title,
      description: r.purpose ?? '',
      raised_by: r.raised_by ? `${r.raised_by.email}` : '—',
      raised_by_role: 'Secretary',
      amount: r.estimated_amount != null ? Number(r.estimated_amount) : null,
      needed_by: r.needed_by,
      next_stage:
        mapStatus(r.status) === 'awaiting_hod'
          ? 'HoD review'
          : mapStatus(r.status) === 'rejected'
            ? '—'
            : 'Finance review',
      status: mapStatus(r.status),
      raised_at: r.created_at,
      hod_remarks: r.hod_remarks,
      reviewed_by: r.hod_reviewer ? r.hod_reviewer.email : null,
      reviewed_at: r.hod_reviewed_at,
    }));
    const sopRows = sop.data.map((r) => ({
      id: r.id,
      kind: 'sop' as const,
      display_id: `SOP-${r.id}`,
      title: r.title,
      description: r.service_description ?? '',
      raised_by: r.raised_by ? `${r.raised_by.email}` : '—',
      raised_by_role: 'Secretary',
      amount: null,
      needed_by: r.needed_by,
      next_stage:
        mapStatus(r.status) === 'awaiting_hod'
          ? 'HoD review'
          : mapStatus(r.status) === 'rejected'
            ? '—'
            : 'Finance review',
      status: mapStatus(r.status),
      raised_at: r.created_at,
      hod_remarks: r.hod_remarks,
      reviewed_by: r.hod_reviewer ? r.hod_reviewer.email : null,
      reviewed_at: r.hod_reviewed_at,
    }));

    return {
      counts: { sop: sopRows.length, pop: popRows.length },
      sop: sopRows,
      pop: popRows,
    };
  }

  async decide(
    user: JwtPayload,
    kind: 'sop' | 'pop',
    id: number,
    decision: 'approved' | 'rejected',
    remarks?: string,
  ) {
    if (kind === 'pop') {
      return this.purchaseRequests.hodReview(id, { decision, remarks }, user);
    }
    return this.serviceRequests.hodReview(id, { decision, remarks }, user);
  }
}
