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
import { CreateFacultyOdDto } from './dto/create-faculty-od.dto';
import { ListFacultyOdQueryDto } from './dto/list-faculty-od-query.dto';
import { UpdateFacultyOdDto } from './dto/update-faculty-od.dto';

const FACULTY_OD_SELECT = {
  id: true,
  from_date: true,
  to_date: true,
  place: true,
  purpose: true,
  hod_approval_status: true,
  hr_approval_status: true,
  created_at: true,
  faculty: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      designation: true,
      departments: { select: { id: true, name: true, code: true } },
    },
  },
} as const;

interface FacultyOdRow {
  id: number;
  from_date: Date;
  to_date: Date;
  place: string | null;
  purpose: string | null;
  hod_approval_status: string;
  hr_approval_status: string;
  created_at: Date;
  faculty: {
    id: number;
    first_name: string;
    last_name: string;
    designation: string;
    departments: { id: number; name: string; code: string } | null;
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

function toResponse(od: FacultyOdRow) {
  return {
    id: od.id,
    from_date: od.from_date,
    to_date: od.to_date,
    place: od.place,
    purpose: od.purpose,
    hod_approval_status: od.hod_approval_status,
    hr_approval_status: od.hr_approval_status,
    overall_status: computeOverallStatus(
      od.hod_approval_status,
      od.hr_approval_status,
    ),
    created_at: od.created_at,
    faculty: od.faculty,
  };
}

@Injectable()
export class FacultyOdService {
  private readonly logger = new Logger(FacultyOdService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /me/create-od (Faculty or HoD — always for the caller's own
   * faculty record).
   *
   * An HoD's own OD has no one to fill the HoD-review stage (they can't
   * review their own request) - so for an HoD-created request,
   * hod_approval_status is set to 'approved' immediately at creation,
   * sending it straight to HR Payroll.
   */
  async create(dto: CreateFacultyOdDto, currentUser: JwtPayload) {
    const faculty = await this.resolveFacultyByUserId(currentUser.sub);

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

    const od = await this.prisma.faculty_od_requests.create({
      data: {
        faculty_id: faculty.id,
        from_date: fromDate,
        to_date: toDate,
        place: dto.place,
        purpose: dto.purpose,
        hod_approval_status:
          currentUser.role === ROLES.HOD ? 'approved' : undefined,
      },
      select: FACULTY_OD_SELECT,
    });

    this.logger.log(`Faculty OD request created: id=${od.id}`);
    return toResponse(od);
  }

  /**
   * GET /me/faculty-od (Faculty/HoD/HR Payroll). Faculty is always scoped
   * to their own records. HoD is scoped to their own department (previously
   * unscoped). HR Payroll only ever sees requests the HoD has already
   * approved - a request still awaiting HoD review has nothing for HR to
   * act on yet (update() below 409s "HR approval requires HoD approval
   * first" anyway), so it's hidden from HR's list entirely rather than
   * shown as an unactionable "pending" row. This overrides whatever
   * hod_approval_status the HR caller passes - it is never allowed to see
   * pending/rejected-by-HoD requests.
   */
  async findAll(query: ListFacultyOdQueryDto, currentUser: JwtPayload) {
    const where: Record<string, unknown> = {
      faculty_id: query.faculty_id,
      hod_approval_status: query.hod_approval_status,
      hr_approval_status: query.hr_approval_status,
    };

    if (currentUser.role === ROLES.FACULTY) {
      const faculty = await this.resolveFacultyByUserId(currentUser.sub);
      where.faculty_id = faculty.id;
    } else if (currentUser.role === ROLES.HOD) {
      const hod = await this.resolveFacultyByUserId(currentUser.sub);
      where.faculty = { department_id: hod.department_id };
    } else if (currentUser.role === ROLES.HR_PAYROLL) {
      where.hod_approval_status = 'approved';
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.faculty_od_requests.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        select: FACULTY_OD_SELECT,
      }),
      this.prisma.faculty_od_requests.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  /**
   * PATCH /me/faculty-od/:id (HoD or HR Payroll only).
   * HoD may only set hod_approval_status. HR Payroll may only set
   * hr_approval_status, and only once hod_approval_status is 'approved'.
   * Mirrors FacultyLeavesService.update() exactly — same two-column,
   * two-role gate, same HoD-must-approve-before-HR ordering, same
   * department scoping and self-review guard for HoD.
   */
  async update(id: number, dto: UpdateFacultyOdDto, currentUser: JwtPayload) {
    if (!dto || Object.keys(dto).length === 0) {
      throw new BadRequestException('No fields provided to update');
    }

    const existing = await this.prisma.faculty_od_requests.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Faculty OD request not found');
    }

    const data: {
      hod_approval_status?: 'approved' | 'rejected';
      hr_approval_status?: 'approved' | 'rejected';
    } = {};

    if (currentUser.role === ROLES.HOD) {
      const hod = await this.resolveFacultyByUserId(currentUser.sub);
      if (existing.faculty_id === hod.id) {
        throw new ForbiddenException({
          message: 'You cannot review your own OD request',
          errorCode: 'CANNOT_REVIEW_OWN_REQUEST',
        });
      }
      const requestingFaculty = await this.prisma.faculty.findUnique({
        where: { id: existing.faculty_id },
        select: { department_id: true },
      });
      if (requestingFaculty?.department_id !== hod.department_id) {
        throw new ForbiddenException(
          'You may only approve OD requests from your own department',
        );
      }
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

    const od = await this.prisma.faculty_od_requests.update({
      where: { id },
      data,
      select: FACULTY_OD_SELECT,
    });

    return toResponse(od);
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
