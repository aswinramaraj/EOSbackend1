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
import { StorageService } from 'src/modules/storage/storage.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { paginate } from 'src/common/dto/pagination.dto';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { CreateFacultyOdDto } from './dto/create-faculty-od.dto';
import { ListFacultyOdQueryDto } from './dto/list-faculty-od-query.dto';
import { UpdateFacultyOdDto } from './dto/update-faculty-od.dto';
import { UploadFacultyOdAttachmentDto } from './dto/upload-faculty-od-attachment.dto';
import { VerifyFacultyOdDto } from './dto/verify-faculty-od.dto';

/**
 * Prisma's default $transaction maxWait (2000ms) is too tight for this
 * project's Supabase pooler round-trip under real-world latency — the batch
 * $transaction below was observed failing at a hard ~2.0-2.3s ceiling
 * ("Unable to start a transaction in the given time"), not intermittently,
 * so this raises the budget rather than papering over a one-off blip.
 */
const TRANSACTION_OPTIONS = { maxWait: 10000, timeout: 15000 };

const FACULTY_OD_SELECT = {
  id: true,
  from_date: true,
  to_date: true,
  place: true,
  purpose: true,
  hod_approval_status: true,
  hr_approval_status: true,
  created_at: true,
  organization_visited: true,
  students_guided: true,
  sanction_order: true,
  latitude: true,
  longitude: true,
  photo_url: true,
  photo_uploaded_at: true,
  certificate_url: true,
  certificate_uploaded_at: true,
  verification_status: true,
  email_sender: true,
  email_receiver: true,
  email_subject: true,
  email_sent_at: true,
  email_body: true,
  admin_remarks: true,
  staff_user_id: true,
  // faculty_od.faculty_id is NULLABLE - an OD raised by non-teaching staff
  // (Secretary / HR Payroll / warden) has staff_user_id set and faculty null.
  // Without a name here every client had to guess, and the mobile HR queue
  // asserted row.faculty! and crashed on the first such row.
  // Prisma auto-names this relation after the FK column. Plain `users` is a

  // DIFFERENT relation (or absent), so the generated name must be used

  // verbatim - see the note in FacultyLeavesService.resolveDepartmentHodUserId

  // about these names not being stable across `db pull`.

  users_faculty_od_requests_staff_user_idTousers: {
    select: {
      email: true,
      non_teaching_staff: {
        select: {
          first_name: true,
          last_name: true,
          departments: { select: { id: true, name: true, code: true } },
        },
      },
    },
  },
  faculty: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      designation: true,
      user_id: true,
      department_id: true,
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
  organization_visited: string | null;
  students_guided: number | null;
  sanction_order: string | null;
  latitude: unknown;
  longitude: unknown;
  photo_url: string | null;
  photo_uploaded_at: Date | null;
  certificate_url: string | null;
  certificate_uploaded_at: Date | null;
  verification_status: string;
  email_sender: string | null;
  email_receiver: string | null;
  email_subject: string | null;
  email_sent_at: Date | null;
  email_body: string | null;
  admin_remarks: string | null;
  // Real column, added by the Secretary module completion migration — set
  // for Secretary-authored (non-Faculty) requests, null for Faculty/HoD
  // requests (which keep using faculty_id, unchanged).
  staff_user_id: number | null;
  // Nullable only because faculty_id was relaxed for an unrelated
  // Secretary-facing feature (see the Secretary module completion
  // migration) — every row Faculty/HoD create/read still always has
  // faculty_id (and thus user_id/department_id) set — a genuinely
  // Secretary-authored row has faculty: null for real instead.
  faculty: {
    id: number;
    first_name: string;
    last_name: string;
    designation: string;
    user_id: number;
    department_id: number;
    departments: { id: number; name: string; code: string } | null;
  } | null;
  // The requester's user row, so a staff-submitted OD (faculty null) still has
  // a name. non_teaching_staff.user_id is nullable, so Prisma models the
  // relation as a list.
  users_faculty_od_requests_staff_user_idTousers: {
    email: string;
    non_teaching_staff: {
      first_name: string;
      last_name: string | null;
      departments: { id: number; name: string; code: string } | null;
    }[];
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
    organization_visited: od.organization_visited,
    students_guided: od.students_guided,
    sanction_order: od.sanction_order,
    latitude: od.latitude,
    longitude: od.longitude,
    photo_url: od.photo_url,
    photo_uploaded_at: od.photo_uploaded_at,
    certificate_url: od.certificate_url,
    certificate_uploaded_at: od.certificate_uploaded_at,
    verification_status: od.verification_status,
    email: {
      sender: od.email_sender,
      receiver: od.email_receiver,
      subject: od.email_subject,
      sent_at: od.email_sent_at,
      body: od.email_body,
    },
    admin_remarks: od.admin_remarks,
    created_at: od.created_at,
    // Null for a genuine Secretary-authored row (no faculty row exists for
    // that account) — real, expected state, not just a compile-time guard.
    faculty: od.faculty
      ? {
          id: od.faculty.id,
          first_name: od.faculty.first_name,
          last_name: od.faculty.last_name,
          designation: od.faculty.designation,
          department_id: od.faculty.department_id,
          department_name: od.faculty.departments?.name ?? null,
        }
      : null,
    staff_user_id: od.staff_user_id,
    // One display identity, whichever register the requester lives in.
    // Clients must read this rather than reaching into `faculty`, which is
    // null for staff-submitted rows.
    requester: resolveOdRequester(od),
  };
}

/**
 * Display identity for an OD request: faculty -> non_teaching_staff -> email,
 * the same order used across this codebase (resolveRequesterName in
 * media-requests.service.ts, resolveMarkerName in attendance.service.ts).
 */
function resolveOdRequester(od: FacultyOdRow) {
  if (od.faculty) {
    return {
      kind: 'faculty' as const,
      name: `${od.faculty.first_name} ${od.faculty.last_name}`,
      designation: od.faculty.designation,
      department: od.faculty.departments?.code ?? null,
    };
  }
  const staff =
    od.users_faculty_od_requests_staff_user_idTousers?.non_teaching_staff?.[0];
  if (staff) {
    return {
      kind: 'staff' as const,
      name: [staff.first_name, staff.last_name].filter(Boolean).join(' '),
      designation: 'Non-teaching staff',
      department: staff.departments?.code ?? null,
    };
  }
  return {
    kind: 'unknown' as const,
    name: od.users_faculty_od_requests_staff_user_idTousers?.email ?? 'Unknown',
    designation: null,
    department: null,
  };
}

@Injectable()
export class FacultyOdService {
  private readonly logger = new Logger(FacultyOdService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notificationsService: NotificationsService,
  ) {}

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

    // Any non-teaching staff account — no faculty row, no HoD to review; goes
    // straight to the HR Payroll stage, keyed by staff_user_id.
    //
    // Branches on whether a faculty row EXISTS rather than on the role name.
    // This used to test `role === SECRETARY`, so HR Payroll and warden fell
    // through to the faculty path and got a FACULTY_NOT_FOUND 404 raising
    // their own OD. See the identical fix in faculty-leaves.service.ts.
    const facultyRow = await this.prisma.faculty.findUnique({
      where: { user_id: currentUser.sub },
    });

    if (!facultyRow) {
      // No non_teaching_staff membership check: the row this writes is keyed
      // on staff_user_id, whose FK is to `users` — which the authenticated
      // caller demonstrably has. Demanding a personnel row as well added no
      // integrity and 404d real employees whose non_teaching_staff row was
      // never created.
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

    const faculty = facultyRow;

    const od = await this.prisma.faculty_od_requests.create({
      data: {
        faculty_id: faculty.id,
        from_date: fromDate,
        to_date: toDate,
        place: dto.place,
        purpose: dto.purpose,
        organization_visited: dto.organization_visited,
        students_guided: dto.students_guided,
        sanction_order: dto.sanction_order,
        hod_approval_status:
          currentUser.role === ROLES.HOD ? 'approved' : undefined,
      },
      select: FACULTY_OD_SELECT,
    });

    this.logger.log(`Faculty OD request created: id=${od.id}`);
    return toResponse(od);
  }

  /**
   * GET /me/faculty-od (Faculty/HoD/HR Payroll/IQAC). Faculty is always
   * scoped to their own records. HoD is scoped to their own department
   * (previously unscoped). HR Payroll only ever sees requests the HoD has
   * already approved - a request still awaiting HoD review has nothing for
   * HR to act on yet (update() below 409s "HR approval requires HoD
   * approval first" anyway), so it's hidden from HR's list entirely rather
   * than shown as an unactionable "pending" row. This overrides whatever
   * hod_approval_status the HR caller passes - it is never allowed to see
   * pending/rejected-by-HoD requests. department_id/from/to/
   * verification_status are IQAC admin-portal filters (worflow.md: "IQAC
   * can view ... On-Duty of students" — faculty OD visibility follows the
   * same "IQAC sees everything" precedent already established for student
   * OD and venues).
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

    if (currentUser.role === ROLES.IQAC) {
      if (query.verification_status) {
        where.verification_status = query.verification_status;
      }
      if (query.department_id || query.from || query.to) {
        where.faculty = {
          ...(query.department_id && { department_id: query.department_id }),
        };
      }
      if (query.from || query.to) {
        where.from_date = {
          ...(query.from && { gte: new Date(query.from) }),
          ...(query.to && { lte: new Date(query.to) }),
        };
      }
    }

    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.faculty_od_requests.findMany({
          where,
          skip: query.skip,
          take: query.limit,
          orderBy: { created_at: 'desc' },
          select: FACULTY_OD_SELECT,
        }),
        this.prisma.faculty_od_requests.count({ where }),
      ],
      TRANSACTION_OPTIONS,
    );

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
   * POST /me/faculty-od/:id/attachments (Faculty only, own record).
   * multipart/form-data: optional single "photo" file, optional single
   * "certificate" file, optional latitude/longitude text fields.
   */
  async addAttachments(
    id: number,
    userId: number,
    dto: UploadFacultyOdAttachmentDto,
    files: {
      photo?: Array<Express.Multer.File>;
      certificate?: Array<Express.Multer.File>;
    },
  ) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const existing = await this.prisma.faculty_od_requests.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Faculty OD request not found',
        errorCode: 'FACULTY_OD_NOT_FOUND',
      });
    }
    if (existing.faculty_id !== faculty.id) {
      throw new ForbiddenException({
        message: 'You may only attach files to your own OD request',
        errorCode: 'NOT_YOUR_RECORD',
      });
    }

    const data: Record<string, unknown> = {};

    if (files.photo?.[0]) {
      const file = files.photo[0];
      const path = `faculty-od/${id}/photo-${Date.now()}-${file.originalname}`;
      const { url } = await this.storage.upload(
        file.buffer,
        path,
        file.mimetype,
      );
      data.photo_url = url;
      data.photo_uploaded_at = new Date();
    }

    if (files.certificate?.[0]) {
      const file = files.certificate[0];
      const path = `faculty-od/${id}/certificate-${Date.now()}-${file.originalname}`;
      const { url } = await this.storage.upload(
        file.buffer,
        path,
        file.mimetype,
      );
      data.certificate_url = url;
      data.certificate_uploaded_at = new Date();
    }

    if (dto.latitude !== undefined) data.latitude = dto.latitude;
    if (dto.longitude !== undefined) data.longitude = dto.longitude;

    if (Object.keys(data).length > 0) {
      data.verification_status = 'under_review';
    }

    const updated = await this.prisma.faculty_od_requests.update({
      where: { id },
      data,
      select: FACULTY_OD_SELECT,
    });

    this.logger.log(
      `Faculty OD request ${id} attachments updated by faculty=${faculty.id}`,
    );
    return toResponse(updated);
  }

  /** PATCH /me/faculty-od/:id/verify (IQAC only). */
  async verify(id: number, dto: VerifyFacultyOdDto, userId: number) {
    const existing = await this.prisma.faculty_od_requests.findUnique({
      where: { id },
      select: {
        id: true,
        purpose: true,
        faculty: { select: { user_id: true } },
      },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Faculty OD request not found',
        errorCode: 'FACULTY_OD_NOT_FOUND',
      });
    }

    const updated = await this.prisma.faculty_od_requests.update({
      where: { id },
      data: {
        verification_status: dto.verification_status,
        admin_remarks: dto.admin_remarks,
      },
      select: FACULTY_OD_SELECT,
    });

    this.logger.log(
      `Faculty OD request ${id} verification set to ${dto.verification_status} by IQAC user=${userId}`,
    );

    // A Secretary-authored row has no faculty, so there's no faculty user
    // to notify here — this verify workflow is Faculty-only in practice
    // (IQAC reviews on-duty documents, which only Faculty submit).
    if (existing.faculty) {
      try {
        await this.notificationsService.notify({
          user_id: existing.faculty.user_id,
          title: 'On-duty documents reviewed',
          message: `IQAC marked your on-duty request "${existing.purpose ?? ''}" as ${dto.verification_status.replace('_', ' ')}.`,
        });
      } catch (err) {
        this.logger.warn(
          `Failed to notify faculty for OD request ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return toResponse(updated);
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
        throw new ForbiddenException(
          'You may only delete your own OD requests',
        );
      }
    } else {
      const faculty = await this.resolveFacultyByUserId(userId);
      if (existing.faculty_id !== faculty.id) {
        throw new ForbiddenException(
          'You may only delete your own OD requests',
        );
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
    dto: {
      from_date?: string;
      to_date?: string;
      place?: string;
      purpose?: string;
    },
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
