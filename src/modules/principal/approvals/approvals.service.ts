import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListApprovalsQueryDto } from './dto/list-approvals-query.dto';
import { DecideApprovalDto } from './dto/decide-approval.dto';

type ApprovalKind = 'leave' | 'od';
type ApprovalStatus = 'pending' | 'approved' | 'rejected';

interface PrincipalColumnsRow {
  id: number;
  principal_approval_status: ApprovalStatus;
  principal_decided_at: Date | null;
  principal_remarks: string | null;
}

export interface UnifiedApproval {
  id: number;
  kind: ApprovalKind;
  faculty: {
    id: number;
    name: string;
    designation: string;
    department_code: string | null;
  };
  from_date: string;
  to_date: string;
  summary: string;
  hod_approval_status: string;
  hr_approval_status: string;
  principal_approval_status: ApprovalStatus;
  principal_remarks: string | null;
  principal_decided_at: string | null;
  created_at: string;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * `principal_approval_status`/`principal_decided_by_user_id`/
 * `principal_decided_at`/`principal_remarks` on `faculty_leaves` and
 * `faculty_od_requests` are proposed in query.md #6 — no approval table in
 * this schema had a Principal-level stage before this. query.md #6 has
 * now run and `prisma db pull` has synced these columns into
 * schema.prisma — still read/written via `$queryRaw`/`$executeRaw` rather
 * than the generated Prisma Client, since this predates that pull. These
 * two raw-query methods (and the `$executeRaw` writes in `decide()` below)
 * are the only things that would need converting to typed Prisma calls —
 * everything else here already uses the typed client.
 */
@Injectable()
export class PrincipalApprovalsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Both wrapped in try/catch, same self-upgrading pattern as every other
   * pending-migration read this session (Hostel/Transport/Medical/Sports/
   * Finance) — until query.md #6 runs, this degrades to every item showing
   * `principal_approval_status: 'pending'` (unifiedList()'s own fallback
   * when the map lookup misses) instead of a hard 500 on the whole page.
   */
  private async principalColumnsForLeaves(
    ids: number[],
  ): Promise<Map<number, PrincipalColumnsRow>> {
    if (ids.length === 0) return new Map();
    try {
      const rows = await this.prisma.$queryRaw<PrincipalColumnsRow[]>`
        SELECT id, principal_approval_status, principal_decided_at, principal_remarks
        FROM faculty_leaves WHERE id = ANY(${ids})
      `;
      return new Map(rows.map((r) => [r.id, r]));
    } catch {
      return new Map();
    }
  }

  private async principalColumnsForOd(
    ids: number[],
  ): Promise<Map<number, PrincipalColumnsRow>> {
    if (ids.length === 0) return new Map();
    try {
      const rows = await this.prisma.$queryRaw<PrincipalColumnsRow[]>`
        SELECT id, principal_approval_status, principal_decided_at, principal_remarks
        FROM faculty_od_requests WHERE id = ANY(${ids})
      `;
      return new Map(rows.map((r) => [r.id, r]));
    } catch {
      return new Map();
    }
  }

  private async unifiedList(): Promise<UnifiedApproval[]> {
    const [leaves, odRequests] = await Promise.all([
      this.prisma.faculty_leaves.findMany({
        select: {
          id: true,
          from_date: true,
          to_date: true,
          reason: true,
          hod_approval_status: true,
          hr_approval_status: true,
          created_at: true,
          faculty: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              designation: true,
              departments: { select: { code: true } },
            },
          },
        },
      }),
      this.prisma.faculty_od_requests.findMany({
        select: {
          id: true,
          from_date: true,
          to_date: true,
          purpose: true,
          place: true,
          hod_approval_status: true,
          hr_approval_status: true,
          created_at: true,
          faculty: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              designation: true,
              departments: { select: { code: true } },
            },
          },
        },
      }),
    ]);

    const [leavePrincipalCols, odPrincipalCols] = await Promise.all([
      this.principalColumnsForLeaves(leaves.map((l) => l.id)),
      this.principalColumnsForOd(odRequests.map((o) => o.id)),
    ]);

    const leaveItems: UnifiedApproval[] = leaves.map((l) => {
      const principal = leavePrincipalCols.get(l.id);
      return {
        id: l.id,
        kind: 'leave',
        faculty: {
          id: l.faculty.id,
          name: `${l.faculty.first_name} ${l.faculty.last_name}`,
          designation: l.faculty.designation,
          department_code: l.faculty.departments?.code ?? null,
        },
        from_date: toDateOnly(l.from_date),
        to_date: toDateOnly(l.to_date),
        summary: l.reason ?? 'Leave request',
        hod_approval_status: l.hod_approval_status,
        hr_approval_status: l.hr_approval_status,
        principal_approval_status:
          principal?.principal_approval_status ?? 'pending',
        principal_remarks: principal?.principal_remarks ?? null,
        principal_decided_at: principal?.principal_decided_at
          ? principal.principal_decided_at.toISOString()
          : null,
        created_at: l.created_at.toISOString(),
      };
    });

    const odItems: UnifiedApproval[] = odRequests.map((o) => {
      const principal = odPrincipalCols.get(o.id);
      return {
        id: o.id,
        kind: 'od',
        faculty: {
          id: o.faculty.id,
          name: `${o.faculty.first_name} ${o.faculty.last_name}`,
          designation: o.faculty.designation,
          department_code: o.faculty.departments?.code ?? null,
        },
        from_date: toDateOnly(o.from_date),
        to_date: toDateOnly(o.to_date),
        summary:
          [o.purpose, o.place].filter(Boolean).join(' · ') || 'On-duty request',
        hod_approval_status: o.hod_approval_status,
        hr_approval_status: o.hr_approval_status,
        principal_approval_status:
          principal?.principal_approval_status ?? 'pending',
        principal_remarks: principal?.principal_remarks ?? null,
        principal_decided_at: principal?.principal_decided_at
          ? principal.principal_decided_at.toISOString()
          : null,
        created_at: o.created_at.toISOString(),
      };
    });

    return [...leaveItems, ...odItems].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
  }

  /** GET /me/principal/approvals/summary */
  async summary() {
    const items = await this.unifiedList();
    const pending = items.filter(
      (i) => i.principal_approval_status === 'pending',
    );
    const accepted = items.filter(
      (i) => i.principal_approval_status === 'approved',
    );
    const rejected = items.filter(
      (i) => i.principal_approval_status === 'rejected',
    );

    const decided = [...accepted, ...rejected].filter(
      (i) => i.principal_decided_at != null,
    );
    const averageCloseDays =
      decided.length > 0
        ? Math.round(
            (decided.reduce((sum, i) => {
              const created = new Date(i.created_at).getTime();
              const decidedAt = new Date(
                i.principal_decided_at as string,
              ).getTime();
              return sum + (decidedAt - created) / 86_400_000;
            }, 0) /
              decided.length) *
              10,
          ) / 10
        : null;

    const oldestPending = pending.length > 0 ? pending[0] : null;

    return {
      pending: pending.length,
      accepted: accepted.length,
      rejected: rejected.length,
      total: items.length,
      average_close_days: averageCloseDays,
      oldest_pending_created_at: oldestPending?.created_at ?? null,
    };
  }

  /** GET /me/principal/approvals */
  async list(query: ListApprovalsQueryDto) {
    let items = await this.unifiedList();

    if (!query.status || query.status === 'pending') {
      items = items.filter((i) => i.principal_approval_status === 'pending');
    } else if (query.status !== 'all') {
      items = items.filter((i) => i.principal_approval_status === query.status);
    }

    if (query.kind && query.kind !== 'all') {
      items = items.filter((i) => i.kind === query.kind);
    }

    if (query.q) {
      const q = query.q.toLowerCase();
      items = items.filter((i) =>
        [
          i.faculty.name,
          i.faculty.designation,
          i.summary,
          i.faculty.department_code,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q),
      );
    }

    return { total: items.length, items };
  }

  /**
   * PATCH /me/principal/approvals/:kind/:id
   *
   * Independent of HOD/HR: setting this doesn't read or require
   * hod_approval_status/hr_approval_status to be 'approved' first — same
   * independent-column shape those two already have with each other.
   */
  async decide(
    kind: ApprovalKind,
    id: number,
    dto: DecideApprovalDto,
    principalUserId: number,
  ) {
    if (kind === 'leave') {
      const existing = await this.prisma.faculty_leaves.findUnique({
        where: { id },
      });
      if (!existing) {
        throw new NotFoundException({
          message: 'Leave request not found',
          errorCode: 'LEAVE_NOT_FOUND',
        });
      }
      await this.runDecisionUpdate(
        this.prisma.$executeRaw`
          UPDATE faculty_leaves
          SET principal_approval_status = ${dto.decision}::approval_status_enum,
              principal_decided_by_user_id = ${principalUserId},
              principal_decided_at = NOW(),
              principal_remarks = ${dto.remarks ?? null}
          WHERE id = ${id}
        `,
      );
    } else {
      const existing = await this.prisma.faculty_od_requests.findUnique({
        where: { id },
      });
      if (!existing) {
        throw new NotFoundException({
          message: 'On-duty request not found',
          errorCode: 'OD_NOT_FOUND',
        });
      }
      await this.runDecisionUpdate(
        this.prisma.$executeRaw`
          UPDATE faculty_od_requests
          SET principal_approval_status = ${dto.decision}::approval_status_enum,
              principal_decided_by_user_id = ${principalUserId},
              principal_decided_at = NOW(),
              principal_remarks = ${dto.remarks ?? null}
          WHERE id = ${id}
        `,
      );
    }

    const items = await this.unifiedList();
    const updated = items.find((i) => i.kind === kind && i.id === id);
    if (!updated) {
      throw new NotFoundException({
        message: 'Request not found after update',
        errorCode: 'NOT_FOUND',
      });
    }
    return updated;
  }

  /** Turns the raw "column does not exist" failure into an honest, actionable error instead of a generic 500 — there's genuinely nowhere to persist a decision until query.md #6 is run. */
  private async runDecisionUpdate(update: Promise<unknown>): Promise<void> {
    try {
      await update;
    } catch {
      throw new UnprocessableEntityException({
        message:
          "Approvals aren't enabled in this database yet — an admin needs to run the pending database update (query.md #6) before requests can be accepted or rejected.",
        errorCode: 'APPROVALS_NOT_ENABLED',
      });
    }
  }
}
