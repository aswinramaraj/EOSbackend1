import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { paginate } from 'src/common/dto/pagination.dto';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { CreateFacultyLeafDto } from './dto/create-faculty-leaf.dto';
import { UpdateFacultyLeafDto } from './dto/update-faculty-leaf.dto';
import { ListFacultyLeafQueryDto } from './dto/list-faculty-leaf-query.dto';

const FACULTY_LEAVE_SELECT = {
  id: true,
  from_date: true,
  to_date: true,
  reason: true,
  leave_type_id: true,
  hod_approval_status: true,
  hr_approval_status: true,
  created_at: true,
  faculty: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      designation: true,
      departments: {
        select: { id: true, name: true, code: true },
      },
    },
  },
  leave_types: { select: { id: true, name: true } },
} as const;

interface FacultyLeaveRow {
  id: number;
  from_date: Date;
  to_date: Date;
  reason: string | null;
  leave_type_id: number | null;
  hod_approval_status: string;
  hr_approval_status: string;
  created_at: Date;
  faculty: {
    id: number;
    first_name: string;
    last_name: string;
    designation: string;
    departments: {
      id: number;
      name: string;
      code: string;
    } | null;
  };
  leave_types: { id: number; name: string } | null;
}

function computeOverallStatus(
  hod: string,
  hr: string,
): 'pending' | 'approved' | 'rejected' {
  if (hod === 'rejected' || hr === 'rejected') {
    return 'rejected';
  }
  if (hod === 'approved' && hr === 'approved') {
    return 'approved';
  }
  return 'pending';
}

function toResponse(leave: FacultyLeaveRow) {
  return {
    id: leave.id,
    from_date: leave.from_date,
    to_date: leave.to_date,
    reason: leave.reason,
    leave_type: leave.leave_types,
    hod_approval_status: leave.hod_approval_status,
    hr_approval_status: leave.hr_approval_status,
    overall_status: computeOverallStatus(
      leave.hod_approval_status,
      leave.hr_approval_status,
    ),
    created_at: leave.created_at,
    faculty: leave.faculty,
  };
}

@Injectable()
export class FacultyLeavesService {
  private readonly logger = new Logger(FacultyLeavesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** POST /faculty-leaves (Faculty only — always for the caller's own faculty record). */
  async create(dto: CreateFacultyLeafDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const fromDate = new Date(dto.from_date);
    const toDate = new Date(dto.to_date);
    const today = new Date(new Date().toISOString().slice(0, 10));

    if (fromDate < today) {
      throw new BadRequestException(
        "from_date must not be before today's date",
      );
    }

    if (fromDate > toDate) {
      throw new BadRequestException('from_date must be on or before to_date');
    }

    const leave = await this.prisma.faculty_leaves.create({
      data: {
        faculty_id: faculty.id,
        from_date: fromDate,
        to_date: toDate,
        reason: dto.reason,
        leave_type_id: dto.leave_type_id,
      },
      select: FACULTY_LEAVE_SELECT,
    });

    this.logger.log(`Faculty leave request created: id=${leave.id}`);
    return toResponse(leave);
  }

  /** GET /faculty-leaves (Faculty/HoD/HR Payroll). Faculty is always scoped to their own records. */
  async findAll(query: ListFacultyLeafQueryDto, currentUser: JwtPayload) {
    const where: Record<string, unknown> = {
      faculty_id: query.faculty_id,
      hod_approval_status: query.hod_approval_status,
      hr_approval_status: query.hr_approval_status,
    };

    if (currentUser.role === ROLES.FACULTY) {
      const faculty = await this.resolveFacultyByUserId(currentUser.sub);
      where.faculty_id = faculty.id;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.faculty_leaves.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        select: FACULTY_LEAVE_SELECT,
      }),
      this.prisma.faculty_leaves.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  /** GET /faculty-leaves/:id (Faculty/HoD/HR Payroll). Faculty may only view their own. */
  async findOne(id: number, currentUser: JwtPayload) {
    const leave = await this.prisma.faculty_leaves.findUnique({
      where: { id },
      select: FACULTY_LEAVE_SELECT,
    });

    if (!leave) {
      throw new NotFoundException('Faculty leave request not found');
    }

    if (currentUser.role === ROLES.FACULTY) {
      const faculty = await this.resolveFacultyByUserId(currentUser.sub);
      if (leave.faculty.id !== faculty.id) {
        throw new ForbiddenException(
          'You may only view your own leave requests',
        );
      }
    } else if (currentUser.role === ROLES.HOD) {
      const hod = await this.resolveFacultyByUserId(currentUser.sub);
      if (
        leave.faculty.departments?.id !==
        hod.department_id
      ) {
        throw new ForbiddenException(
          'You may only view leave requests from your own department',
        );
      }
    }

    return toResponse(leave);
  }

  /**
   * PATCH /faculty-leaves/:id (HoD or HR Payroll only).
   * HoD may only set hod_approval_status. HR Payroll may only set
   * hr_approval_status, and only once hod_approval_status is 'approved'.
   */
  async update(id: number, dto: UpdateFacultyLeafDto, currentUser: JwtPayload) {
    if (!dto || Object.keys(dto).length === 0) {
      throw new BadRequestException('No fields provided to update');
    }

    const existing = await this.prisma.faculty_leaves.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Faculty leave request not found');
    }

    const data: {
      hod_approval_status?: 'approved' | 'rejected';
      hr_approval_status?: 'approved' | 'rejected';
    } = {};

    if (currentUser.role === ROLES.HOD) {
      if (dto.hr_approval_status !== undefined) {
        throw new ForbiddenException('HoD may only set hod_approval_status');
      }
      if (dto.hod_approval_status !== undefined) {
        data.hod_approval_status = dto.hod_approval_status;
      }
    } else if (currentUser.role === ROLES.HR_PAYROLL) {
      if (dto.hod_approval_status !== undefined) {
        throw new ForbiddenException(
          'HR Payroll may only set hr_approval_status',
        );
      }
      if (dto.hr_approval_status !== undefined) {
        if (existing.hod_approval_status !== 'approved') {
          throw new ConflictException(
            'HR approval requires HoD approval first',
          );
        }
        data.hr_approval_status = dto.hr_approval_status;
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No permitted fields provided to update');
    }

    const leave = await this.prisma.faculty_leaves.update({
      where: { id },
      data,
      select: FACULTY_LEAVE_SELECT,
    });

    return toResponse(leave);
  }

  /** DELETE /faculty-leaves/:id (Faculty only — own request, and only while fully pending). */
  async remove(id: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const existing = await this.prisma.faculty_leaves.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Faculty leave request not found');
    }

    if (existing.faculty_id !== faculty.id) {
      throw new ForbiddenException(
        'You may only delete your own leave requests',
      );
    }

    if (
      existing.hod_approval_status !== 'pending' ||
      existing.hr_approval_status !== 'pending'
    ) {
      throw new ConflictException(
        'Only a fully pending leave request can be withdrawn',
      );
    }

    await this.prisma.faculty_leaves.delete({ where: { id } });

    this.logger.log(`Faculty leave request deleted: id=${id}`);
    return { id, deleted: true };
  }

  private async resolveFacultyByUserId(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }
}
