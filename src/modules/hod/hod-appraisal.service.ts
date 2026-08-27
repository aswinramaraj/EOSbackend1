import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { AppraisalService } from '../faculty/appraisal/appraisal.service';

type Status = 'pending' | 'sent_to_hr' | 'sent_back';

function mapStatus(status: string): Status {
  if (status === 'submitted') return 'pending';
  if (status === 'rejected') return 'sent_back';
  return 'sent_to_hr'; // hod_reviewed / hr_scored / management_approved
}

/**
 * GET /hod/appraisal-requests — a thin adapter over the real, already
 * HOD-scoped `AppraisalService` (exposed institution-wide at
 * `/me/appraisal_requests`, role-gated to include HOD already). Reused
 * wholesale — its real state machine (submitted → hod_reviewed → hr_scored
 * → management_approved/rejected) is not re-implemented.
 *
 * Once an HoD approves, the request goes to HR Payroll for scoring — never
 * to a Principal (there never was a Principal step in the real state
 * machine above; "sent_to_principal" was this adapter's own leftover label
 * for the hod_reviewed/hr_scored/management_approved states, corrected to
 * match the real destination).
 *
 * Known simplification: the real `UpdateAppraisalDto` has no `remarks`
 * field for the HoD's review transition (only `status`) — a `remarks`
 * value passed to decide() has no real place to persist and is dropped,
 * not fabricated.
 */
@Injectable()
export class HodAppraisalService {
  constructor(
    private readonly appraisal: AppraisalService,
    private readonly prisma: PrismaService,
  ) {}

  private async resolveDepartment(user: JwtPayload) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: { department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'No faculty record found for this account.',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    const department = await this.prisma.departments.findUnique({
      where: { id: faculty.department_id },
      select: { name: true, code: true },
    });
    if (!department) {
      throw new NotFoundException({
        message: 'Department not found.',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }
    return department;
  }

  async getRequests(user: JwtPayload) {
    const department = await this.resolveDepartment(user);
    const page = await this.appraisal.findAll(
      { limit: 200, page: 1, skip: 0 },
      user,
    );
    const rows = page.data
      .filter((r) => r.faculty !== null)
      .map((r) => {
        const scored = r.entries.filter((e) => e.score != null);
        return {
          id: r.id,
          faculty_name:
            `${r.faculty!.first_name} ${r.faculty!.last_name}`.trim(),
          designation: r.faculty!.designation,
          submitted_at: r.created_at,
          cycle_academic_year: r.academic_year,
          entries_count: r.entries.length,
          self_score:
            scored.length > 0
              ? scored.reduce((sum, e) => sum + (e.score ?? 0), 0)
              : null,
          status: mapStatus(r.status),
          can_act: r.status === 'submitted',
        };
      });
    return {
      department,
      counts: {
        pending: rows.filter((r) => r.status === 'pending').length,
        sent_to_hr: rows.filter((r) => r.status === 'sent_to_hr').length,
        sent_back: rows.filter((r) => r.status === 'sent_back').length,
        all: rows.length,
      },
      rows,
    };
  }

  async getDetail(user: JwtPayload, id: number) {
    const r = await this.appraisal.findOne(id, user);
    return {
      id: r.id,
      faculty_name: r.faculty
        ? `${r.faculty.first_name} ${r.faculty.last_name}`.trim()
        : '—',
      designation: r.faculty?.designation ?? '—',
      cycle_academic_year: r.academic_year,
      submitted_at: r.created_at,
      status: mapStatus(r.status),
      hod_remarks: r.hod_remarks,
      entries: r.entries.map((e) => ({
        id: e.id,
        division: e.criteria.division.name,
        criteria_name: e.criteria.name,
        description: e.description,
        score: e.score,
        max_score: e.criteria.max_score,
      })),
    };
  }

  async decide(
    user: JwtPayload,
    id: number,
    decision: 'approved' | 'rejected',
  ) {
    return this.appraisal.update(
      id,
      { status: decision === 'approved' ? 'hod_reviewed' : 'rejected' },
      user,
    );
  }
}
