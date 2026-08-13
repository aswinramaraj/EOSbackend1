import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { StudentLeavesService } from 'src/modules/admissions/student-leaves/student-leaves.service';
import { FacultyLeavesService } from 'src/modules/faculty/faculty-leaves/faculty-leaves.service';

export type LeaveAudience = 'student' | 'faculty';
export type LeaveTab = 'pending' | 'approved' | 'rejected' | 'all';

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

export interface UnifiedLeaveRow {
  id: number;
  kind: LeaveAudience;
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
export class HodLeaveRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentLeavesService: StudentLeavesService,
    private readonly facultyLeavesService: FacultyLeavesService,
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

  /** GET /hod/leave-requests?audience=student|faculty&tab=pending|approved|rejected|all */
  async getList(userId: number, audience: LeaveAudience, tab: LeaveTab) {
    const { department } = await this.resolveHodDepartment(userId);

    const rows =
      audience === 'student'
        ? await this.getStudentRows(userId)
        : await this.getFacultyRows(userId);

    const counts = {
      pending: rows.filter((r) => r.status === 'pending_bucket').length,
      approved: rows.filter((r) => r.status === 'approved_bucket').length,
      rejected: rows.filter((r) => r.status === 'rejected_bucket').length,
      all: rows.length,
    };

    const filtered =
      tab === 'all' ? rows : rows.filter((r) => r.status === `${tab}_bucket`);

    return {
      department,
      audience,
      counts,
      rows: filtered.map((r) => ({
        ...r,
        status: r.status.replace('_bucket', ''),
      })),
    };
  }

  private async getStudentRows(
    userId: number,
  ): Promise<(UnifiedLeaveRow & { status: string })[]> {
    const result = await this.studentLeavesService.findAllForHod(
      { page: 1, limit: FETCH_LIMIT, skip: 0 },
      userId,
    );
    return result.data.map((leave) => {
      const bucket =
        leave.status === 'faculty_approved'
          ? 'pending_bucket'
          : leave.status === 'hod_approved'
            ? 'approved_bucket'
            : leave.status === 'rejected'
              ? 'rejected_bucket'
              : 'awaiting_mentor';
      return {
        id: leave.id,
        kind: 'student' as const,
        name: leave.student.name,
        subtitle: [leave.student.student_id_no, leave.student.section]
          .filter(Boolean)
          .join(' · '),
        from_date: new Date(leave.from_date).toISOString().slice(0, 10),
        to_date: new Date(leave.to_date).toISOString().slice(0, 10),
        days: daysBetween(new Date(leave.from_date), new Date(leave.to_date)),
        applied_at: new Date(leave.created_at).toISOString().slice(0, 10),
        type_label: null,
        detail_text: leave.reason,
        status: bucket,
        can_act: leave.status === 'faculty_approved',
      };
    });
  }

  private async getFacultyRows(
    userId: number,
  ): Promise<(UnifiedLeaveRow & { status: string })[]> {
    const currentUser: JwtPayload = {
      sub: userId,
      role: ROLES.HOD,
      email: '',
      roleId: 0,
    };
    const result = await this.facultyLeavesService.findAll(
      { page: 1, limit: FETCH_LIMIT, skip: 0 },
      currentUser,
    );
    return result.data.map((leave) => {
      const bucket =
        leave.hod_approval_status === 'pending'
          ? 'pending_bucket'
          : leave.hod_approval_status === 'approved'
            ? 'approved_bucket'
            : 'rejected_bucket';
      return {
        id: leave.id,
        kind: 'faculty' as const,
        name: fullName(leave.faculty),
        subtitle: [leave.faculty.designation, leave.faculty.departments?.code]
          .filter(Boolean)
          .join(' · '),
        from_date: new Date(leave.from_date).toISOString().slice(0, 10),
        to_date: new Date(leave.to_date).toISOString().slice(0, 10),
        days: daysBetween(new Date(leave.from_date), new Date(leave.to_date)),
        applied_at: new Date(leave.created_at).toISOString().slice(0, 10),
        type_label: leave.leave_type?.name ?? null,
        detail_text: [
          leave.reason,
          leave.alternate_arrangement
            ? `Alternate arrangement: ${leave.alternate_arrangement}`
            : null,
          leave.is_station_leave ? 'Leaving the station' : null,
        ]
          .filter(Boolean)
          .join(' · ') || null,
        status: bucket,
        can_act: leave.hod_approval_status === 'pending',
      };
    });
  }

  /** PATCH /hod/leave-requests/:kind/:id */
  async decide(
    userId: number,
    kind: LeaveAudience,
    id: number,
    decision: 'approved' | 'rejected',
  ) {
    if (kind === 'student') {
      return this.studentLeavesService.hodApprove(id, { decision }, userId);
    }
    const currentUser: JwtPayload = {
      sub: userId,
      role: ROLES.HOD,
      email: '',
      roleId: 0,
    };
    return this.facultyLeavesService.update(
      id,
      { hod_approval_status: decision },
      currentUser,
    );
  }
}
