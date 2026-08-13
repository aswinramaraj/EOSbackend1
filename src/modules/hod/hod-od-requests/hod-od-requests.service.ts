import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { OdHodApprovalsService } from 'src/modules/admissions/od-hod-approvals/od-hod-approvals.service';
import { FacultyOdRequestsService } from 'src/modules/faculty/faculty-od-requests/faculty-od-requests.service';

export type OdAudience = 'student' | 'faculty';
export type OdTab = 'pending' | 'approved' | 'rejected' | 'all';

const FETCH_LIMIT = 200;

function fullName(p: {
  prefix?: string | null;
  first_name: string;
  last_name?: string | null;
}): string {
  return [p.prefix, p.first_name, p.last_name].filter(Boolean).join(' ');
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
}

export interface UnifiedOdRow {
  id: number;
  kind: OdAudience;
  name: string;
  subtitle: string;
  from_date: string;
  to_date: string;
  days: number;
  applied_at: string;
  type_label: string | null;
  detail_text: string | null;
  status: string;
  can_act: boolean;
}

@Injectable()
export class HodOdRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly odHodApprovalsService: OdHodApprovalsService,
    private readonly facultyOdRequestsService: FacultyOdRequestsService,
  ) {}

  /** Resolves the caller's own faculty row + department — never trusts a client-supplied department_id. */
  async resolveHodDepartment(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { id: true, department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    const department = await this.prisma.departments.findUnique({
      where: { id: faculty.department_id },
      select: { id: true, name: true, code: true },
    });
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    return { faculty, department };
  }

  /** GET /hod/od-requests?audience=student|faculty&tab=pending|approved|rejected|all */
  async getList(userId: number, audience: OdAudience, tab: OdTab) {
    const { department } = await this.resolveHodDepartment(userId);

    const rows =
      audience === 'student'
        ? await this.getStudentRows(userId)
        : await this.getFacultyRows(userId);

    const counts = {
      pending: rows.filter((r) => r.status === 'pending').length,
      approved: rows.filter((r) => r.status === 'approved').length,
      rejected: rows.filter((r) => r.status === 'rejected').length,
      all: rows.length,
    };

    const filtered =
      tab === 'all' ? rows : rows.filter((r) => r.status === tab);

    return { department, audience, counts, rows: filtered };
  }

  private async getStudentRows(userId: number): Promise<UnifiedOdRow[]> {
    const result = await this.odHodApprovalsService.findAll(
      { page: 1, limit: FETCH_LIMIT, skip: 0 },
      userId,
    );
    return result.data.map((approval) => ({
      id: approval.id,
      kind: 'student' as const,
      name: approval.student.name,
      subtitle: [approval.student.student_id_no, approval.student.section]
        .filter(Boolean)
        .join(' · '),
      from_date: new Date(approval.od_request.from_date)
        .toISOString()
        .slice(0, 10),
      to_date: new Date(approval.od_request.to_date).toISOString().slice(0, 10),
      days: daysBetween(
        new Date(approval.od_request.from_date),
        new Date(approval.od_request.to_date),
      ),
      applied_at: new Date(approval.od_request.created_at)
        .toISOString()
        .slice(0, 10),
      type_label: approval.od_request.reason,
      detail_text:
        [approval.od_request.organization, approval.od_request.location]
          .filter(Boolean)
          .join(' · ') || null,
      status: approval.status,
      can_act: approval.status === 'pending',
    }));
  }

  private async getFacultyRows(userId: number): Promise<UnifiedOdRow[]> {
    const currentUser: JwtPayload = {
      sub: userId,
      role: ROLES.HOD,
      email: '',
      roleId: 0,
    };
    const result = await this.facultyOdRequestsService.findAll(
      { page: 1, limit: FETCH_LIMIT, skip: 0 },
      currentUser,
    );
    return result.data.map((od) => ({
      id: od.id,
      kind: 'faculty' as const,
      name: fullName(od.faculty),
      subtitle: [od.faculty.designation, od.faculty.department?.code]
        .filter(Boolean)
        .join(' · '),
      from_date: new Date(od.from_date).toISOString().slice(0, 10),
      to_date: new Date(od.to_date).toISOString().slice(0, 10),
      days: daysBetween(new Date(od.from_date), new Date(od.to_date)),
      applied_at: new Date(od.created_at).toISOString().slice(0, 10),
      type_label: od.purpose,
      detail_text:
        [
          od.organization_visited,
          od.place,
          od.class_adjustment ? `Class adjustment: ${od.class_adjustment}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || null,
      status: od.hod_approval_status,
      can_act: od.hod_approval_status === 'pending',
    }));
  }

  /** PATCH /hod/od-requests/:kind/:id */
  async decide(
    userId: number,
    kind: OdAudience,
    id: number,
    decision: 'approved' | 'rejected',
  ) {
    if (kind === 'student') {
      return this.odHodApprovalsService.review(id, { decision }, userId);
    }
    const currentUser: JwtPayload = {
      sub: userId,
      role: ROLES.HOD,
      email: '',
      roleId: 0,
    };
    return this.facultyOdRequestsService.update(
      id,
      { hod_approval_status: decision },
      currentUser,
    );
  }
}
