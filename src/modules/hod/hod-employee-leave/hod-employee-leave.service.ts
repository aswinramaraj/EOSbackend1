import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { FacultyLeavesService } from 'src/modules/faculty/faculty-leaves/faculty-leaves.service';
import { CreateFacultyLeafDto } from 'src/modules/faculty/faculty-leaves/dto/create-faculty-leaf.dto';

const FETCH_LIMIT = 100;

/** Same academic-year convention used elsewhere in this codebase. */
function currentAcademicYear(): string {
  const now = new Date();
  const calendarYear = now.getUTCFullYear();
  const academicStartYear =
    now.getUTCMonth() + 1 >= 6 ? calendarYear : calendarYear - 1;
  return `${academicStartYear}-${String((academicStartYear + 1) % 100).padStart(2, '0')}`;
}

@Injectable()
export class HodEmployeeLeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly facultyLeavesService: FacultyLeavesService,
  ) {}

  private async resolveFaculty(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }

  /** GET /hod/employee/leave/types */
  async getLeaveTypes() {
    return this.prisma.leave_types.findMany({
      where: { is_active: true },
      select: { id: true, name: true, default_annual_quota: true },
      orderBy: { name: 'asc' },
    });
  }

  /** GET /hod/employee/leave/balances */
  async getBalances(userId: number) {
    const faculty = await this.resolveFaculty(userId);
    const academicYear = currentAcademicYear();
    const balances = await this.prisma.faculty_leave_balances.findMany({
      where: { faculty_id: faculty.id, academic_year: academicYear },
      select: {
        allocated: true,
        used: true,
        leave_types: { select: { id: true, name: true } },
      },
    });
    return balances.map((b) => ({
      leave_type_id: b.leave_types.id,
      leave_type: b.leave_types.name,
      allocated: b.allocated,
      used: b.used,
      remaining: Math.max(0, b.allocated - b.used),
    }));
  }

  /** POST /hod/employee/leave — self-service, same create path any faculty (HOD included) already uses. */
  async apply(userId: number, dto: CreateFacultyLeafDto) {
    return this.facultyLeavesService.create(dto, userId);
  }

  /** GET /hod/employee/leave/history?status= — the HOD's own submitted requests only. */
  async getHistory(
    userId: number,
    status?: 'pending' | 'approved' | 'rejected',
  ) {
    const faculty = await this.resolveFaculty(userId);
    const currentUser: JwtPayload = {
      sub: userId,
      role: ROLES.HOD,
      email: '',
      roleId: 0,
    };
    const result = await this.facultyLeavesService.findAll(
      {
        page: 1,
        limit: FETCH_LIMIT,
        skip: 0,
        faculty_id: faculty.id,
        hod_approval_status: status,
      },
      currentUser,
    );
    return result.data;
  }
}
