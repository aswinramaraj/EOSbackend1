import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
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
  staff_user_id: true,
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
  staff_user_id: number | null;
  // Nullable only because faculty_id was relaxed for an unrelated
  // Secretary-facing feature (see the Secretary module completion
  // migration) — every row THIS module creates/reads still always has
  // faculty_id set (create() is still Faculty-only), so this is a
  // compile-time nullability fix, not a real behavior change.
  faculty: {
    id: number;
    first_name: string;
    last_name: string;
    designation: string;
    departments: { id: number; name: string; code: string } | null;
  } | null;
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
    staff_user_id: od.staff_user_id,
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

    // Secretary (or any non-Faculty staff account) — no faculty row, no
    // HoD to review; goes straight to the HR Payroll stage, keyed by
    // staff_user_id. Mirrors faculty-leaves' identical Secretary branch.
    if (currentUser.role === ROLES.SECRETARY) {
      const od = await this.prisma.faculty_od_requests.create({
        data: {
          staff_user_id: currentUser.sub,
          from_date: fromDate,
          to_date: toDate,
          place: dto.place,
          purpose: dto.purpose,
          hod_approval_status: 'approved',
        },
        select: FACULTY_OD_SELECT,
      });
      this.logger.log(`Staff OD request created: id=${od.id}`);
      return toResponse(od);
    }

    const faculty = await this.resolveFacultyByUserId(currentUser.sub);

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
    } else if (currentUser.role === ROLES.SECRETARY) {
      delete where.faculty_id;
      where.staff_user_id = currentUser.sub;
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
      if (existing.faculty_id === null) {
        throw new InternalServerErrorException({
          message: 'This OD request has no faculty on record',
          errorCode: 'INTERNAL_ERROR',
        });
      }
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

  /**
   * DELETE /me/faculty-od/:id (Faculty/HoD/Secretary — own request, only
   * while still fully pending). This route never previously existed for
   * this module at all — added to give OD requests real CRUD parity with
   * faculty-leaves' equivalent withdraw action, same rules: a Secretary's
   * own request has hod_approval_status pre-set to 'approved' (no HoD to
   * review it), so only hr_approval_status gates withdrawal for them.
   */
  async remove(id: number, userId: number, role?: string) {
    const existing = await this.prisma.faculty_od_requests.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Faculty OD request not found');
    }

    if (role === ROLES.SECRETARY) {
      if (existing.staff_user_id !== userId) {
        throw new ForbiddenException('You may only delete your own OD requests');
      }
    } else {
      const faculty = await this.resolveFacultyByUserId(userId);
      if (existing.faculty_id !== faculty.id) {
        throw new ForbiddenException('You may only delete your own OD requests');
      }
    }

    const stillWithdrawable =
      role === ROLES.SECRETARY
        ? existing.hr_approval_status === 'pending'
        : existing.hod_approval_status === 'pending' &&
          existing.hr_approval_status === 'pending';

    if (!stillWithdrawable) {
      throw new ConflictException(
        'Only a still-pending OD request can be withdrawn',
      );
    }

    await this.prisma.faculty_od_requests.delete({ where: { id } });
    this.logger.log(`Faculty OD request deleted: id=${id}`);
    return { id, deleted: true };
  }

  /**
   * PATCH /me/my-od/:id — Secretary self-edit of their OWN still-pending
   * (at HR Payroll) OD request. Mirrors faculty-leaves' updateOwnStaffRequest.
   */
  async updateOwnStaffRequest(
    id: number,
    userId: number,
    dto: { from_date?: string; to_date?: string; place?: string; purpose?: string },
  ) {
    const existing = await this.prisma.faculty_od_requests.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Faculty OD request not found');
    }
    if (existing.staff_user_id !== userId) {
      throw new ForbiddenException('You may only edit your own OD requests');
    }
    if (existing.hr_approval_status !== 'pending') {
      throw new ConflictException(
        'This request has already been decided and can no longer be edited',
      );
    }

    const data: {
      from_date?: Date;
      to_date?: Date;
      place?: string;
      purpose?: string;
    } = {};
    if (dto.from_date) data.from_date = new Date(dto.from_date);
    if (dto.to_date) data.to_date = new Date(dto.to_date);
    if (dto.place !== undefined) data.place = dto.place;
    if (dto.purpose !== undefined) data.purpose = dto.purpose;

    const fromDate = data.from_date ?? existing.from_date;
    const toDate = data.to_date ?? existing.to_date;
    if (fromDate > toDate) {
      throw new BadRequestException('from_date must be on or before to_date');
    }

    const updated = await this.prisma.faculty_od_requests.update({
      where: { id },
      data,
      select: FACULTY_OD_SELECT,
    });
    return toResponse(updated);
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
