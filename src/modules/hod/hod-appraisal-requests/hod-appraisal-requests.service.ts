import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

function fullName(f: {
  prefix?: string | null;
  first_name: string;
  last_name: string;
}): string {
  return [f.prefix, f.first_name, f.last_name].filter(Boolean).join(' ');
}

/** hr_scored/management_approved have already left the HOD's own queue — grouped with hod_reviewed as "sent to principal" from the HOD's point of view. */
function statusOf(
  raw: string,
): 'pending' | 'sent_to_principal' | 'sent_back' {
  if (raw === 'rejected') return 'sent_back';
  if (raw === 'submitted') return 'pending';
  return 'sent_to_principal';
}

@Injectable()
export class HodAppraisalRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveHodDepartment(userId: number) {
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
    if (!department) throw new NotFoundException('Department not found');
    return department;
  }

  /** GET /hod/appraisal-requests */
  async getRequests(userId: number) {
    const department = await this.resolveHodDepartment(userId);

    const requests = await this.prisma.appraisal_requests.findMany({
      where: { faculty: { department_id: department.id } },
      select: {
        id: true,
        academic_year: true,
        status: true,
        created_at: true,
        faculty: {
          select: { prefix: true, first_name: true, last_name: true, designation: true },
        },
        appraisal_entries: {
          select: {
            score: true,
            appraisal_criteria: { select: { max_score: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    const rows = requests.map((r) => {
      const scored = r.appraisal_entries.filter((e) => e.score != null);
      const totalScore = scored.reduce((sum, e) => sum + Number(e.score), 0);
      const totalMax = scored.reduce(
        (sum, e) => sum + Number(e.appraisal_criteria.max_score),
        0,
      );
      const selfScore =
        totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : null;

      return {
        id: r.id,
        faculty_name: fullName(r.faculty),
        designation: r.faculty.designation,
        submitted_at: r.created_at.toISOString().slice(0, 10),
        cycle_academic_year: r.academic_year,
        entries_count: r.appraisal_entries.length,
        self_score: selfScore,
        status: statusOf(r.status),
        can_act: r.status === 'submitted',
      };
    });

    const counts = {
      pending: rows.filter((r) => r.status === 'pending').length,
      sent_to_principal: rows.filter((r) => r.status === 'sent_to_principal').length,
      sent_back: rows.filter((r) => r.status === 'sent_back').length,
      all: rows.length,
    };

    return {
      department: { name: department.name, code: department.code },
      counts,
      rows,
    };
  }

  /** GET /hod/appraisal-requests/:id */
  async getRequestDetail(userId: number, id: number) {
    const department = await this.resolveHodDepartment(userId);

    const request = await this.prisma.appraisal_requests.findUnique({
      where: { id },
      select: {
        id: true,
        academic_year: true,
        status: true,
        created_at: true,
        hod_remarks: true,
        faculty: {
          select: {
            department_id: true,
            prefix: true,
            first_name: true,
            last_name: true,
            designation: true,
          },
        },
        appraisal_entries: {
          select: {
            id: true,
            description: true,
            score: true,
            appraisal_criteria: {
              select: {
                criteria_name: true,
                max_score: true,
                appraisal_divisions: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!request || request.faculty.department_id !== department.id) {
      throw new NotFoundException('Appraisal request not found in your department');
    }

    return {
      id: request.id,
      faculty_name: fullName(request.faculty),
      designation: request.faculty.designation,
      cycle_academic_year: request.academic_year,
      submitted_at: request.created_at.toISOString().slice(0, 10),
      status: statusOf(request.status),
      hod_remarks: request.hod_remarks,
      entries: request.appraisal_entries.map((e) => ({
        id: e.id,
        division: e.appraisal_criteria.appraisal_divisions.name,
        criteria_name: e.appraisal_criteria.criteria_name,
        description: e.description,
        score: e.score != null ? Number(e.score) : null,
        max_score: Number(e.appraisal_criteria.max_score),
      })),
    };
  }

  /** PATCH /hod/appraisal-requests/:id */
  async decide(
    userId: number,
    id: number,
    decision: 'approved' | 'rejected',
    remarks?: string,
  ) {
    const department = await this.resolveHodDepartment(userId);

    const request = await this.prisma.appraisal_requests.findUnique({
      where: { id },
      select: { faculty: { select: { department_id: true } } },
    });
    if (!request || request.faculty.department_id !== department.id) {
      throw new ForbiddenException('This request is not in your department');
    }

    await this.prisma.appraisal_requests.update({
      where: { id },
      data: {
        status: decision === 'approved' ? 'hod_reviewed' : 'rejected',
        hod_reviewed_by: userId,
        hod_reviewed_at: new Date(),
        hod_remarks: remarks,
      },
    });
    return { status: 'ok' as const };
  }
}
