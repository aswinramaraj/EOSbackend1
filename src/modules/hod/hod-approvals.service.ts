import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { FacultyLeavesService } from '../faculty/faculty-leaves/faculty-leaves.service';
import { FacultyOdRequestsService } from '../faculty/faculty-od-requests/faculty-od-requests.service';

type Tab = 'pending' | 'approved' | 'rejected' | 'all';

export interface Row {
  id: number;
  kind: 'student' | 'faculty';
  name: string;
  subtitle: string;
  from_date: Date;
  to_date: Date;
  days: number;
  applied_at: Date;
  type_label: string | null;
  detail_text: string | null;
  status: 'pending' | 'approved' | 'rejected';
  can_act: boolean;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

function yearLabel(semester: number | null | undefined): string {
  if (semester == null) return '—';
  return ['I', 'II', 'III', 'IV'][Math.ceil(semester / 2) - 1] ?? '—';
}

function bucket(rows: Row[], tab: Tab): Row[] {
  return tab === 'all' ? rows : rows.filter((r) => r.status === tab);
}

function counts(rows: Row[]) {
  return {
    pending: rows.filter((r) => r.status === 'pending').length,
    approved: rows.filter((r) => r.status === 'approved').length,
    rejected: rows.filter((r) => r.status === 'rejected').length,
    all: rows.length,
  };
}

/**
 * GET /hod/leave-requests and /hod/od-requests — both are a unified
 * "student" + "faculty" audience view. Faculty audience is a thin adapter
 * over the already-real, already-HOD-scoped `FacultyLeavesService`/
 * `FacultyOdRequestsService` (their own dual HOD+HR approval rules are
 * reused wholesale, not re-implemented). Student audience reads real
 * `student_leaves` / `od_request_hod_approvals` rows directly, department-
 * scoped. Every query sequential — Supabase's session-mode pool caps at 15
 * connections (see HodService's own comments).
 *
 * `campus_outing_requests` (a separate, shorter same-day-outing table with
 * an identical status enum to `student_leaves`) is deliberately NOT
 * included here — neither the leave-requests nor od-requests frontend
 * contract references it, and it reads as a distinct feature from either.
 */
@Injectable()
export class HodApprovalsService {
  private readonly logger = new Logger(HodApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly facultyLeaves: FacultyLeavesService,
    private readonly facultyOdRequests: FacultyOdRequestsService,
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
      select: { id: true, name: true, code: true },
    });
    if (!department) {
      throw new NotFoundException({
        message: 'Department not found.',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }
    return department;
  }

  async getLeaveRequests(
    user: JwtPayload,
    audience: 'student' | 'faculty',
    tab: Tab,
  ) {
    const department = await this.resolveDepartment(user);

    if (audience === 'faculty') {
      const page = await this.facultyLeaves.findAll(
        { limit: 100, page: 1, skip: 0 },
        user,
      );
      const rows: Row[] = page.data.map((r) => ({
        id: r.id,
        kind: 'faculty',
        name: r.faculty
          ? `${r.faculty.first_name} ${r.faculty.last_name}`.trim()
          : '—',
        subtitle: r.faculty ? `${r.faculty.designation}` : '—',
        from_date: r.from_date,
        to_date: r.to_date,
        days: daysBetween(r.from_date, r.to_date),
        applied_at: r.created_at,
        type_label: r.leave_type?.name ?? null,
        detail_text: r.reason,
        status: r.overall_status,
        can_act: r.hod_approval_status === 'pending',
      }));
      return {
        department,
        audience,
        counts: counts(rows),
        rows: bucket(rows, tab),
      };
    }

    const leaves = await this.prisma.student_leaves.findMany({
      where: { students: { classes: { department_id: department.id } } },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        from_date: true,
        to_date: true,
        reason: true,
        status: true,
        created_at: true,
        students: {
          select: {
            register_no: true,
            soa_applications: { select: { first_name: true, last_name: true } },
            classes: { select: { section: true, current_semester: true } },
          },
        },
      },
    });
    const rows: Row[] = leaves
      // Not yet reached the HOD's stage at all — the class advisor hasn't
      // acted yet, so this isn't the HOD's request to see or act on.
      .filter((l) => l.status !== 'pending')
      .map((l) => {
        const status: Row['status'] =
          l.status === 'faculty_approved'
            ? 'pending'
            : l.status === 'rejected'
              ? 'rejected'
              : 'approved';
        return {
          id: l.id,
          kind: 'student' as const,
          name: l.students.soa_applications
            ? `${l.students.soa_applications.first_name} ${l.students.soa_applications.last_name ?? ''}`.trim()
            : (l.students.register_no ?? '—'),
          subtitle: `${yearLabel(l.students.classes?.current_semester)} · Sec ${l.students.classes?.section ?? '—'}`,
          from_date: l.from_date,
          to_date: l.to_date,
          days: daysBetween(l.from_date, l.to_date),
          applied_at: l.created_at,
          type_label: 'Student Leave',
          detail_text: l.reason,
          status,
          can_act: l.status === 'faculty_approved',
        };
      });
    return {
      department,
      audience,
      counts: counts(rows),
      rows: bucket(rows, tab),
    };
  }

  async decideLeaveRequest(
    user: JwtPayload,
    kind: 'student' | 'faculty',
    id: number,
    decision: 'approved' | 'rejected',
  ) {
    if (kind === 'faculty') {
      return this.facultyLeaves.update(
        id,
        { hod_approval_status: decision },
        user,
      );
    }
    const department = await this.resolveDepartment(user);
    const existing = await this.prisma.student_leaves.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        students: { select: { classes: { select: { department_id: true } } } },
      },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Leave request not found.',
        errorCode: 'NOT_FOUND',
      });
    }
    if (existing.students.classes?.department_id !== department.id) {
      throw new ForbiddenException({
        message: 'You may only decide leave requests from your own department.',
        errorCode: 'FORBIDDEN',
      });
    }
    const updated = await this.prisma.student_leaves.update({
      where: { id },
      data: {
        status: decision === 'approved' ? 'hod_approved' : 'rejected',
        approved_by_hod_user_id: user.sub,
      },
    });
    return { id: updated.id, status: updated.status };
  }

  async getOdRequests(
    user: JwtPayload,
    audience: 'student' | 'faculty',
    tab: Tab,
  ) {
    const department = await this.resolveDepartment(user);

    if (audience === 'faculty') {
      const page = await this.facultyOdRequests.findAll(
        { limit: 100, page: 1, skip: 0 },
        user,
      );
      const rows: Row[] = page.data.map((r) => ({
        id: r.id,
        kind: 'faculty',
        name: r.faculty
          ? `${r.faculty.first_name} ${r.faculty.last_name}`.trim()
          : '—',
        subtitle: r.faculty ? r.faculty.designation : '—',
        from_date: r.from_date,
        to_date: r.to_date,
        days: daysBetween(r.from_date, r.to_date),
        applied_at: r.created_at,
        type_label: r.purpose,
        detail_text: r.organization_visited ?? r.place,
        status: r.overall_status,
        can_act: r.hod_approval_status === 'pending',
      }));
      return {
        department,
        audience,
        counts: counts(rows),
        rows: bucket(rows, tab),
      };
    }

    const odApprovals = await this.prisma.od_request_hod_approvals.findMany({
      where: { department_id: department.id },
      orderBy: { id: 'desc' },
      select: {
        id: true,
        status: true,
        od_requests: {
          select: {
            from_date: true,
            to_date: true,
            reason: true,
            organization: true,
            created_at: true,
          },
        },
        students: {
          select: {
            register_no: true,
            soa_applications: { select: { first_name: true, last_name: true } },
            classes: { select: { section: true, current_semester: true } },
          },
        },
      },
    });
    const rows: Row[] = odApprovals.map((a) => ({
      id: a.id,
      kind: 'student' as const,
      name: a.students.soa_applications
        ? `${a.students.soa_applications.first_name} ${a.students.soa_applications.last_name ?? ''}`.trim()
        : (a.students.register_no ?? '—'),
      subtitle: `${yearLabel(a.students.classes?.current_semester)} · Sec ${a.students.classes?.section ?? '—'}`,
      from_date: a.od_requests.from_date,
      to_date: a.od_requests.to_date,
      days: daysBetween(a.od_requests.from_date, a.od_requests.to_date),
      applied_at: a.od_requests.created_at,
      type_label: a.od_requests.organization,
      detail_text: a.od_requests.reason,
      status:
        a.status === 'pending'
          ? 'pending'
          : a.status === 'rejected'
            ? 'rejected'
            : 'approved',
      can_act: a.status === 'pending',
    }));
    return {
      department,
      audience,
      counts: counts(rows),
      rows: bucket(rows, tab),
    };
  }

  async decideOdRequest(
    user: JwtPayload,
    kind: 'student' | 'faculty',
    id: number,
    decision: 'approved' | 'rejected',
  ) {
    if (kind === 'faculty') {
      return this.facultyOdRequests.update(
        id,
        { hod_approval_status: decision },
        user,
      );
    }
    const department = await this.resolveDepartment(user);
    const existing = await this.prisma.od_request_hod_approvals.findUnique({
      where: { id },
      select: { id: true, department_id: true },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'OD request not found.',
        errorCode: 'NOT_FOUND',
      });
    }
    if (existing.department_id !== department.id) {
      throw new ForbiddenException({
        message: 'You may only decide OD requests from your own department.',
        errorCode: 'FORBIDDEN',
      });
    }
    const updated = await this.prisma.od_request_hod_approvals.update({
      where: { id },
      data: {
        status: decision,
        hod_user_id: user.sub,
        reviewed_at: new Date(),
      },
    });
    return { id: updated.id, status: updated.status };
  }
}
