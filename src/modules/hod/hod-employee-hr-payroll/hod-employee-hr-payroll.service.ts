import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

function hrAssignedName(
  user: {
    email: string;
    faculty: { first_name: string; last_name: string } | null;
    non_teaching_staff: { first_name: string; last_name: string | null }[];
  } | null,
): string | null {
  if (!user) return null;
  if (user.faculty)
    return `${user.faculty.first_name} ${user.faculty.last_name}`.trim();
  if (user.non_teaching_staff[0]) {
    const staff = user.non_teaching_staff[0];
    return `${staff.first_name} ${staff.last_name ?? ''}`.trim();
  }
  return user.email;
}

@Injectable()
export class HodEmployeeHrPayrollService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /hod/employee/hr-payroll/requests */
  async getMyRequests(userId: number) {
    const rows = await this.prisma.hr_payroll_requests.findMany({
      where: { requested_by_user_id: userId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        category: true,
        subject: true,
        description: true,
        attachment_url: true,
        status: true,
        resolution_note: true,
        resolved_at: true,
        created_at: true,
        users_hr_payroll_requests_assigned_hr_user_idTousers: {
          select: {
            email: true,
            faculty: { select: { first_name: true, last_name: true } },
            non_teaching_staff: { select: { first_name: true, last_name: true } },
          },
        },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      subject: r.subject,
      description: r.description,
      attachment_url: r.attachment_url,
      status: r.status as 'submitted' | 'under_review' | 'resolved',
      hr_assigned_name: hrAssignedName(
        r.users_hr_payroll_requests_assigned_hr_user_idTousers,
      ),
      resolution_note: r.resolution_note,
      resolved_at: r.resolved_at,
      created_at: r.created_at,
    }));
  }

  /** POST /hod/employee/hr-payroll/requests */
  async createRequest(
    userId: number,
    dto: { category: string; subject: string; description?: string },
  ) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }

    const row = await this.prisma.hr_payroll_requests.create({
      data: {
        requested_by_user_id: userId,
        category: dto.category,
        subject: dto.subject,
        description: dto.description,
        status: 'submitted',
      },
      select: { id: true },
    });

    return { id: row.id, status: 'submitted' as const };
  }
}
