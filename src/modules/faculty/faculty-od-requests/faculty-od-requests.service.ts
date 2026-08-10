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
import { CreateFacultyOdRequestDto } from './dto/create-faculty-od-request.dto';
import { UpdateFacultyOdRequestDto } from './dto/update-faculty-od-request.dto';
import { ListFacultyOdRequestQueryDto } from './dto/list-faculty-od-request-query.dto';

const OD_REQUEST_SELECT = {
  id: true,
  from_date: true,
  to_date: true,
  place: true,
  purpose: true,
  organization_visited: true,
  students_guided: true,
  sanction_order: true,
  hod_approval_status: true,
  hr_approval_status: true,
  verification_status: true,
  admin_remarks: true,
  created_at: true,
  faculty: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      designation: true,
      department_id: true,
      departments: { select: { id: true, name: true } },
    },
  },
} as const;

interface OdRequestRow {
  id: number;
  from_date: Date;
  to_date: Date;
  place: string | null;
  purpose: string | null;
  organization_visited: string | null;
  students_guided: number | null;
  sanction_order: string | null;
  hod_approval_status: string;
  hr_approval_status: string;
  verification_status: string;
  admin_remarks: string | null;
  created_at: Date;
  faculty: {
    id: number;
    first_name: string;
    last_name: string;
    designation: string;
    department_id: number;
    departments: { id: number; name: string };
  };
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

function toResponse(row: OdRequestRow) {
  return {
    id: row.id,
    from_date: row.from_date,
    to_date: row.to_date,
    place: row.place,
    purpose: row.purpose,
    organization_visited: row.organization_visited,
    students_guided: row.students_guided,
    sanction_order: row.sanction_order,
    hod_approval_status: row.hod_approval_status,
    hr_approval_status: row.hr_approval_status,
    overall_status: computeOverallStatus(
      row.hod_approval_status,
      row.hr_approval_status,
    ),
    verification_status: row.verification_status,
    admin_remarks: row.admin_remarks,
    created_at: row.created_at,
    faculty: {
      id: row.faculty.id,
      first_name: row.faculty.first_name,
      last_name: row.faculty.last_name,
      designation: row.faculty.designation,
      department: row.faculty.departments,
    },
  };
}

@Injectable()
export class FacultyOdRequestsService {
  private readonly logger = new Logger(FacultyOdRequestsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** POST /faculty-od-requests (Faculty only — always for the caller's own faculty record). */
  async create(dto: CreateFacultyOdRequestDto, userId: number) {
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

    const odRequest = await this.prisma.faculty_od_requests.create({
      data: {
        faculty_id: faculty.id,
        from_date: fromDate,
        to_date: toDate,
        place: dto.place,
        purpose: dto.purpose,
        organization_visited: dto.organization_visited,
        students_guided: dto.students_guided,
        sanction_order: dto.sanction_order,
      },
      select: OD_REQUEST_SELECT,
    });

    this.logger.log(`Faculty OD request created: id=${odRequest.id}`);
    return toResponse(odRequest);
  }

  /**
   * GET /faculty-od-requests (Faculty/HoD/HR Payroll).
   * Faculty is force-scoped to their own records. HoD is force-scoped to
   * their own department (the acting HoD's faculty.department_id) — unlike
   * the equivalent Faculty Leaves/Appraisal endpoints, which don't enforce
   * this; department-scoping is deliberately correct here from the start.
   */
  async findAll(query: ListFacultyOdRequestQueryDto, currentUser: JwtPayload) {
    const where: Record<string, unknown> = {
      faculty_id: query.faculty_id,
      hod_approval_status: query.hod_approval_status,
      hr_approval_status: query.hr_approval_status,
      verification_status: query.verification_status,
    };

    if (currentUser.role === ROLES.FACULTY) {
      const faculty = await this.resolveFacultyByUserId(currentUser.sub);
      where.faculty_id = faculty.id;
    } else if (currentUser.role === ROLES.HOD) {
      const hod = await this.resolveFacultyByUserId(currentUser.sub);
      where.faculty = { department_id: hod.department_id };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.faculty_od_requests.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        select: OD_REQUEST_SELECT,
      }),
      this.prisma.faculty_od_requests.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  /** GET /faculty-od-requests/:id (Faculty/HoD/HR Payroll). Scoped the same way as findAll. */
  async findOne(id: number, currentUser: JwtPayload) {
    const odRequest = await this.prisma.faculty_od_requests.findUnique({
      where: { id },
      select: OD_REQUEST_SELECT,
    });

    if (!odRequest) {
      throw new NotFoundException('OD request not found');
    }

    if (currentUser.role === ROLES.FACULTY) {
      const faculty = await this.resolveFacultyByUserId(currentUser.sub);
      if (odRequest.faculty.id !== faculty.id) {
        throw new ForbiddenException('You may only view your own OD requests');
      }
    } else if (currentUser.role === ROLES.HOD) {
      const hod = await this.resolveFacultyByUserId(currentUser.sub);
      if (odRequest.faculty.department_id !== hod.department_id) {
        throw new ForbiddenException(
          'You may only view OD requests within your own department',
        );
      }
    }

    return toResponse(odRequest);
  }

  /**
   * PATCH /faculty-od-requests/:id (HoD or HR Payroll only).
   * HoD may only set hod_approval_status, and only within their own
   * department. HR Payroll may set hr_approval_status (requires
   * hod_approval_status already 'approved') and/or verification_status.
   * Either role may attach admin_remarks.
   */
  async update(
    id: number,
    dto: UpdateFacultyOdRequestDto,
    currentUser: JwtPayload,
  ) {
    if (!dto || Object.keys(dto).length === 0) {
      throw new BadRequestException('No fields provided to update');
    }

    const existing = await this.prisma.faculty_od_requests.findUnique({
      where: { id },
      include: { faculty: { select: { department_id: true } } },
    });
    if (!existing) {
      throw new NotFoundException('OD request not found');
    }

    const data: {
      hod_approval_status?: 'approved' | 'rejected';
      hr_approval_status?: 'approved' | 'rejected';
      verification_status?: 'under_review' | 'verified';
      admin_remarks?: string;
    } = {};

    if (currentUser.role === ROLES.HOD) {
      const hod = await this.resolveFacultyByUserId(currentUser.sub);
      if (existing.faculty.department_id !== hod.department_id) {
        throw new ForbiddenException(
          'You may only act on OD requests within your own department',
        );
      }
      if (
        dto.hr_approval_status !== undefined ||
        dto.verification_status !== undefined
      ) {
        throw new ForbiddenException(
          'HoD may only set hod_approval_status (and admin_remarks)',
        );
      }
      if (dto.hod_approval_status !== undefined) {
        data.hod_approval_status = dto.hod_approval_status;
      }
    } else if (currentUser.role === ROLES.HR_PAYROLL) {
      if (dto.hod_approval_status !== undefined) {
        throw new ForbiddenException(
          'HR Payroll may not set hod_approval_status',
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
      if (dto.verification_status !== undefined) {
        data.verification_status = dto.verification_status;
      }
    }

    if (dto.admin_remarks !== undefined) {
      data.admin_remarks = dto.admin_remarks;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No permitted fields provided to update');
    }

    const odRequest = await this.prisma.faculty_od_requests.update({
      where: { id },
      data,
      select: OD_REQUEST_SELECT,
    });

    return toResponse(odRequest);
  }

  /** DELETE /faculty-od-requests/:id (Faculty only — own request, only while fully pending). */
  async remove(id: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const existing = await this.prisma.faculty_od_requests.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('OD request not found');
    }

    if (existing.faculty_id !== faculty.id) {
      throw new ForbiddenException('You may only delete your own OD requests');
    }

    if (
      existing.hod_approval_status !== 'pending' ||
      existing.hr_approval_status !== 'pending'
    ) {
      throw new ConflictException(
        'Only a fully pending OD request can be withdrawn',
      );
    }

    await this.prisma.faculty_od_requests.delete({ where: { id } });

    this.logger.log(`Faculty OD request deleted: id=${id}`);
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
