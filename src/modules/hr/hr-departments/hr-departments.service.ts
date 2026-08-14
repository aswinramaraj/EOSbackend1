import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

type AppraisalRollupStatus = 'not_started' | 'in_progress' | 'complete';

function todayDateOnly(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

function appraisalRollupStatus(
  total: number,
  resolved: number,
): AppraisalRollupStatus {
  if (total === 0) return 'not_started';
  if (resolved >= total) return 'complete';
  return 'in_progress';
}

/**
 * HR-perspective department rollup — reuses departments/faculty/
 * faculty_leaves/faculty_od_requests/appraisal_requests directly rather than
 * introducing a parallel "HR department" concept. Read-only aggregation, no
 * new tables.
 */
@Injectable()
export class HrDepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const departments = await this.prisma.departments.findMany({
      orderBy: { name: 'asc' },
    });

    return Promise.all(
      departments.map((department) => this.buildRollup(department)),
    );
  }

  async findOne(id: number) {
    const department = await this.prisma.departments.findUnique({
      where: { id },
    });
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    return this.buildRollup(department);
  }

  private async buildRollup(department: {
    id: number;
    name: string;
    code: string;
  }) {
    const today = todayDateOnly();

    const [
      totalFaculty,
      onLeaveToday,
      onOdToday,
      pendingLeaves,
      pendingOdRequests,
      totalAppraisals,
      resolvedAppraisals,
    ] = await Promise.all([
      this.prisma.faculty.count({
        where: { department_id: department.id, status: 'active' },
      }),
      this.prisma.faculty_leaves.count({
        where: {
          faculty: { department_id: department.id },
          hod_approval_status: 'approved',
          hr_approval_status: 'approved',
          from_date: { lte: today },
          to_date: { gte: today },
        },
      }),
      this.prisma.faculty_od_requests.count({
        where: {
          faculty: { department_id: department.id },
          hod_approval_status: 'approved',
          hr_approval_status: 'approved',
          from_date: { lte: today },
          to_date: { gte: today },
        },
      }),
      this.prisma.faculty_leaves.count({
        where: {
          faculty: { department_id: department.id },
          OR: [
            { hod_approval_status: 'pending' },
            { hr_approval_status: 'pending' },
          ],
        },
      }),
      this.prisma.faculty_od_requests.count({
        where: {
          faculty: { department_id: department.id },
          OR: [
            { hod_approval_status: 'pending' },
            { hr_approval_status: 'pending' },
          ],
        },
      }),
      this.prisma.appraisal_requests.count({
        where: { faculty: { department_id: department.id } },
      }),
      this.prisma.appraisal_requests.count({
        where: {
          faculty: { department_id: department.id },
          status: { in: ['management_approved', 'rejected'] },
        },
      }),
    ]);

    return {
      id: department.id,
      name: department.name,
      code: department.code,
      total_faculty: totalFaculty,
      on_leave_today: onLeaveToday,
      on_od_today: onOdToday,
      pending_requests: pendingLeaves + pendingOdRequests,
      appraisal_status: appraisalRollupStatus(
        totalAppraisals,
        resolvedAppraisals,
      ),
    };
  }
}
