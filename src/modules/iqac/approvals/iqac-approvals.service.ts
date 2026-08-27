import { Injectable } from '@nestjs/common';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { DocumentsService } from 'src/modules/secretary-portal/documents/documents.service';
import { ListDocumentsQueryDto } from 'src/modules/secretary-portal/documents/dto/list-documents-query.dto';

@Injectable()
export class IqacApprovalsService {
  constructor(private readonly documents: DocumentsService) {}

  findAll(user: JwtPayload, query: ListDocumentsQueryDto) {
    return this.documents.findAll(user, query);
  }

  toggleVerify(user: JwtPayload, id: number, userId: number) {
    return this.documents.toggleVerify(user, id, userId);
  }

  /**
   * GET /me/iqac/approvals/stats — real, institution-wide counts (not
   * scoped to one paginated page). Reuses DocumentsService.findAll() itself
   * (a big enough limit to cover every real row, same "small dataset,
   * fetch everything" tradeoff as Students/Faculty/Higher Education) rather
   * than querying department_documents directly — IQAC never reaches past
   * another role's own service for its data.
   *
   * "Approved" here means the real `verified` status. There is NO
   * "rejected" status anywhere in department_document_status_enum
   * (pending/verified/missing only) — a rejected_count would have to be
   * fabricated, so this deliberately doesn't return one; the frontend
   * shows an honest "—" for it. `months` is real, derived from every
   * document's own `created_at`, for a genuine month filter (no
   * "criterion" field exists anywhere on this table — that reference-
   * design filter has no real equivalent here either).
   */
  async stats(user: JwtPayload) {
    const bigDto = Object.assign(new ListDocumentsQueryDto(), {
      page: 1,
      limit: 1000,
    });
    const { data: rows } = await this.documents.findAll(user, bigDto);

    const departmentsReporting = new Set(rows.map((r) => r.department.id));
    const departmentsPending = new Set(
      rows.filter((r) => r.status === 'pending').map((r) => r.department.id),
    );
    const months = Array.from(
      new Set(
        rows.map((r) => {
          const d = new Date(r.created_at);
          return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        }),
      ),
    ).sort((a, b) => b.localeCompare(a));

    return {
      pending_count: rows.filter((r) => r.status === 'pending').length,
      approved_count: rows.filter((r) => r.status === 'verified').length,
      missing_count: rows.filter((r) => r.status === 'missing').length,
      departments_reporting: departmentsReporting.size,
      departments_pending: departmentsPending.size,
      categories: Array.from(new Set(rows.map((r) => r.category))).sort(),
      months,
    };
  }
}
