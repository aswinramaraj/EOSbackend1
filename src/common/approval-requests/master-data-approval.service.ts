import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { isUndefinedTableError } from 'src/common/utils/pg-error.util';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { DepartmentsService } from 'src/modules/academic-structure/departments/departments.service';
import { CoursesService } from 'src/modules/academic-structure/courses/courses.service';
import { BatchesService } from 'src/modules/academic-structure/batches/batches.service';
import { ClassesService } from 'src/modules/academic-structure/classes/classes.service';
import { AcademicCoordinatorMappingService } from 'src/modules/academic-coordinator/mapping/academic-coordinator-mapping.service';

const TABLE = 'master_data_change_requests';

export type MasterDataEntityType =
  | 'department'
  | 'course'
  | 'batch'
  | 'class'
  | 'curriculum_mapping';
export type MasterDataAction = 'create' | 'add_mapping' | 'remove_mapping';

/** Departments/Courses/Batches/Classes — Principal-reviewed. Distinct from curriculum_mapping, which is HOD-reviewed and department-scoped. */
const MASTER_DATA_TYPES: MasterDataEntityType[] = [
  'department',
  'course',
  'batch',
  'class',
];

interface ChangeRequestRow {
  id: number;
  entity_type: MasterDataEntityType;
  action: MasterDataAction;
  department_id: number | null;
  payload: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected';
  requested_by_user_id: number;
  requested_at: Date;
  reviewed_by_user_id: number | null;
  reviewed_at: Date | null;
  rejection_reason: string | null;
  created_entity_id: number | null;
}

function toResponse(r: ChangeRequestRow) {
  return {
    id: r.id,
    entity_type: r.entity_type,
    action: r.action,
    department_id: r.department_id,
    payload: r.payload,
    status: r.status,
    requested_by_user_id: r.requested_by_user_id,
    requested_at: r.requested_at,
    reviewed_by_user_id: r.reviewed_by_user_id,
    reviewed_at: r.reviewed_at,
    rejection_reason: r.rejection_reason,
    created_entity_id: r.created_entity_id,
  };
}

/**
 * Shared staging table for two otherwise-unrelated checklist gaps:
 * Domain 01's Departments/Courses/Batches/Classes approval workflow and
 * Domain 03's curriculum-mapping review step. A request that hasn't been
 * approved yet simply doesn't exist in the real table it targets — so this
 * is purely additive: none of the 53 existing files that read
 * departments/courses/batches/classes without a status filter need to
 * change, and every existing direct-create endpoint keeps working exactly
 * as before. "Submit for review" is a new, optional path alongside it.
 *
 * Real once `master_data_change_requests` runs (see
 * master_data_approvals.query.md) — a brand-new table, so reads degrade to
 * an empty list and writes throw FEATURE_NOT_ENABLED until the migration
 * lands, same convention as TimetablePeriodRequestsService.
 */
@Injectable()
export class MasterDataApprovalService {
  private readonly logger = new Logger(MasterDataApprovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly departments: DepartmentsService,
    private readonly courses: CoursesService,
    private readonly batches: BatchesService,
    private readonly classes: ClassesService,
    private readonly mapping: AcademicCoordinatorMappingService,
  ) {}

  async submit(
    entityType: MasterDataEntityType,
    action: MasterDataAction,
    payload: Record<string, unknown>,
    requestedByUserId: number,
    departmentId: number | null,
  ) {
    try {
      const inserted = await this.prisma.$queryRawUnsafe<{ id: number }[]>(
        `INSERT INTO ${TABLE} (entity_type, action, department_id, payload, requested_by_user_id)
         VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
        entityType,
        action,
        departmentId,
        JSON.stringify(payload),
        requestedByUserId,
      );
      const row = await this.loadRow(inserted[0].id);
      await this.notifyReviewers(row);
      return toResponse(row);
    } catch (err) {
      if (isUndefinedTableError(err, TABLE)) {
        throw new UnprocessableEntityException({
          message: 'This feature is not enabled yet.',
          errorCode: 'FEATURE_NOT_ENABLED',
        });
      }
      throw err;
    }
  }

  /**
   * GET /approval-requests — reviewer-scoped: Principal sees pending
   * Departments/Courses/Batches/Classes requests institution-wide; HOD sees
   * only pending curriculum-mapping requests for their own department
   * (re-derived from their own faculty row, never a client-supplied param —
   * same convention as every other HOD-scoped read in this codebase).
   */
  async listPending(reviewer: JwtPayload) {
    try {
      if (reviewer.role === ROLES.PRINCIPAL) {
        const rows = await this.queryRows(
          `WHERE status = 'pending' AND entity_type = ANY($1) ORDER BY requested_at ASC`,
          [MASTER_DATA_TYPES],
        );
        return rows.map(toResponse);
      }
      if (reviewer.role === ROLES.HOD) {
        const departmentId = await this.resolveDepartmentIdForHod(
          reviewer.sub,
        );
        const rows = await this.queryRows(
          `WHERE status = 'pending' AND entity_type = 'curriculum_mapping' AND department_id = $1 ORDER BY requested_at ASC`,
          [departmentId],
        );
        return rows.map(toResponse);
      }
      return [];
    } catch (err) {
      if (isUndefinedTableError(err, TABLE)) return [];
      throw err;
    }
  }

  async approve(id: number, reviewer: JwtPayload) {
    const row = await this.loadRowForReview(id, reviewer);
    const createdEntityId = await this.applyRequest(row);

    await this.prisma.$executeRawUnsafe(
      `UPDATE ${TABLE} SET status = 'approved', reviewed_by_user_id = $1, reviewed_at = now(), created_entity_id = $2 WHERE id = $3`,
      reviewer.sub,
      createdEntityId,
      id,
    );

    const updated = await this.loadRow(id);
    await this.notifyRequester(updated);
    return toResponse(updated);
  }

  async reject(id: number, reviewer: JwtPayload, reason?: string) {
    await this.loadRowForReview(id, reviewer);

    await this.prisma.$executeRawUnsafe(
      `UPDATE ${TABLE} SET status = 'rejected', reviewed_by_user_id = $1, reviewed_at = now(), rejection_reason = $2 WHERE id = $3`,
      reviewer.sub,
      reason ?? null,
      id,
    );

    const updated = await this.loadRow(id);
    await this.notifyRequester(updated);
    return toResponse(updated);
  }

  // ───────────────────────── internals ─────────────────────────

  /** Invokes the same create/mutate service method the direct (non-reviewed) endpoint already calls — no duplicated validation or business logic. */
  private async applyRequest(row: ChangeRequestRow): Promise<number | null> {
    switch (row.entity_type) {
      case 'department': {
        const created = await this.departments.create(
          row.payload as never,
          row.requested_by_user_id,
        );
        return created.id;
      }
      case 'course': {
        const created = await this.courses.create(
          row.payload as never,
          row.requested_by_user_id,
        );
        return created.id;
      }
      case 'batch': {
        const created = await this.batches.create(
          row.payload as never,
          row.requested_by_user_id,
        );
        return created.id;
      }
      case 'class': {
        const created = await this.classes.create(
          row.payload as never,
          row.requested_by_user_id,
        );
        return created.id;
      }
      case 'curriculum_mapping': {
        const p = row.payload as unknown as {
          department_id: number;
          semester: number;
          subject_id: number;
        };
        if (row.action === 'remove_mapping') {
          await this.mapping.removeMapping(
            p.department_id,
            p.semester,
            p.subject_id,
          );
        } else {
          await this.mapping.addMapping(
            p.department_id,
            p.semester,
            p.subject_id,
          );
        }
        return null;
      }
    }
  }

  private async loadRowForReview(
    id: number,
    reviewer: JwtPayload,
  ): Promise<ChangeRequestRow> {
    const row = await this.loadRow(id);
    if (row.status !== 'pending') {
      throw new ConflictException({
        message: 'This request has already been decided.',
        errorCode: 'REQUEST_ALREADY_DECIDED',
      });
    }

    if (MASTER_DATA_TYPES.includes(row.entity_type)) {
      if (reviewer.role !== ROLES.PRINCIPAL) {
        throw new ForbiddenException(
          'Only the Principal may review master-data requests',
        );
      }
    } else {
      if (reviewer.role !== ROLES.HOD) {
        throw new ForbiddenException(
          'Only a Head of Department may review curriculum-mapping requests',
        );
      }
      const departmentId = await this.resolveDepartmentIdForHod(reviewer.sub);
      if (row.department_id !== departmentId) {
        throw new ForbiddenException(
          'You may only review requests for your own department',
        );
      }
    }
    return row;
  }

  private async loadRow(id: number): Promise<ChangeRequestRow> {
    const rows = await this.queryRows(`WHERE id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException({
        message: 'Request not found.',
        errorCode: 'REQUEST_NOT_FOUND',
      });
    }
    return rows[0];
  }

  private async queryRows(
    whereClause: string,
    params: unknown[],
  ): Promise<ChangeRequestRow[]> {
    const sql = `
      SELECT id, entity_type, action, department_id, payload, status,
             requested_by_user_id, requested_at, reviewed_by_user_id,
             reviewed_at, rejection_reason, created_entity_id
      FROM ${TABLE}
      ${whereClause}
    `;
    return this.prisma.$queryRawUnsafe<ChangeRequestRow[]>(sql, ...params);
  }

  /** HOD's own faculty row is the only honest source of their department — never trust a client-supplied department_id (same convention as attendance.service.ts/hod-class-records.service.ts). */
  private async resolveDepartmentIdForHod(userId: number): Promise<number> {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty.department_id;
  }

  private async notifyReviewers(row: ChangeRequestRow) {
    try {
      const reviewerRole = MASTER_DATA_TYPES.includes(row.entity_type)
        ? ROLES.PRINCIPAL
        : ROLES.HOD;
      const reviewers = await this.prisma.users.findMany({
        where: {
          roles: { name: reviewerRole },
          ...(reviewerRole === ROLES.HOD && row.department_id != null
            ? { faculty: { department_id: row.department_id } }
            : {}),
        },
        select: { id: true },
      });
      await Promise.all(
        reviewers.map((u) =>
          this.notifications.notify({
            user_id: u.id,
            title: 'New request pending your review',
            message: `A ${row.entity_type.replace('_', ' ')} request is waiting for your approval.`,
            type: 'approval_request_pending',
            related_entity_type: 'master_data_change_request',
            related_entity_id: row.id,
          }),
        ),
      );
    } catch (err) {
      this.logger.error(
        `Failed to notify reviewers for request ${row.id}`,
        err as Error,
      );
    }
  }

  private async notifyRequester(row: ChangeRequestRow) {
    try {
      await this.notifications.notify({
        user_id: row.requested_by_user_id,
        title:
          row.status === 'approved' ? 'Request approved' : 'Request rejected',
        message:
          row.status === 'approved'
            ? `Your ${row.entity_type.replace('_', ' ')} request has been approved.`
            : `Your ${row.entity_type.replace('_', ' ')} request was rejected${row.rejection_reason ? `: ${row.rejection_reason}` : '.'}`,
        type:
          row.status === 'approved'
            ? 'approval_request_approved'
            : 'approval_request_rejected',
        related_entity_type: 'master_data_change_request',
        related_entity_id: row.id,
      });
    } catch (err) {
      this.logger.error(
        `Failed to notify requester for request ${row.id}`,
        err as Error,
      );
    }
  }
}
