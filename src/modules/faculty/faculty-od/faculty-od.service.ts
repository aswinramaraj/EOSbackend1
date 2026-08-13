import {
  BadRequestException,
  ForbiddenException,
  Injectable,
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
  od_type: true,
  periods_affected: true,
  class_adjustment: true,
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
  faculty: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      designation: true,
      user_id: true,
      department_id: true,
      departments: { select: { id: true, name: true } },
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
  od_type: string | null;
  periods_affected: string | null;
  class_adjustment: string | null;
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
  faculty: {
    id: number;
    first_name: string;
    last_name: string;
    designation: string;
    user_id: number;
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
    od_type: od.od_type,
    periods_affected: od.periods_affected,
    class_adjustment: od.class_adjustment,
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
    faculty: {
      id: od.faculty.id,
      first_name: od.faculty.first_name,
      last_name: od.faculty.last_name,
      designation: od.faculty.designation,
      department_id: od.faculty.department_id,
      department_name: od.faculty.departments.name,
    },
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

  /** POST /me/create-od (Faculty only — always for the caller's own faculty record). */
  async create(dto: CreateFacultyOdDto, userId: number) {
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
        od_type: dto.od_type,
        periods_affected: dto.periods_affected,
        class_adjustment: dto.class_adjustment,
      },
      select: FACULTY_OD_SELECT,
    });

    this.logger.log(`Faculty OD request created: id=${od.id}`);
    return toResponse(od);
  }

  /**
   * GET /me/faculty-od (Faculty/HoD/HR Payroll/IQAC). Faculty is always
   * scoped to their own records. department_id/from/to/verification_status
   * are IQAC admin-portal filters (worflow.md: "IQAC can view ... On-Duty of
   * students" — faculty OD visibility follows the same "IQAC sees
   * everything" precedent already established for student OD and venues).
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

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.faculty_od_requests.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        select: FACULTY_OD_SELECT,
      }),
      this.prisma.faculty_od_requests.count({ where }),
    ], TRANSACTION_OPTIONS);

    return paginate(rows.map(toResponse), total, query);
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
      const { url } = await this.storage.upload(file.buffer, path, file.mimetype);
      data.photo_url = url;
      data.photo_uploaded_at = new Date();
    }

    if (files.certificate?.[0]) {
      const file = files.certificate[0];
      const path = `faculty-od/${id}/certificate-${Date.now()}-${file.originalname}`;
      const { url } = await this.storage.upload(file.buffer, path, file.mimetype);
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

    this.logger.log(`Faculty OD request ${id} attachments updated by faculty=${faculty.id}`);
    return toResponse(updated);
  }

  /** PATCH /me/faculty-od/:id/verify (IQAC only). */
  async verify(id: number, dto: VerifyFacultyOdDto, userId: number) {
    const existing = await this.prisma.faculty_od_requests.findUnique({
      where: { id },
      select: { id: true, purpose: true, faculty: { select: { user_id: true } } },
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

    try {
      await this.notificationsService.create({
        user_id: existing.faculty.user_id,
        title: 'On-duty documents reviewed',
        message: `IQAC marked your on-duty request "${existing.purpose ?? ''}" as ${dto.verification_status.replace('_', ' ')}.`,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to notify faculty for OD request ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

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
