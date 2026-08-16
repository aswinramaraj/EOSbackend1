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
import { CreateAppraisalDto } from './dto/create-appraisal.dto';
import {
  UpdateAppraisalDto,
  AppraisalEntryScoreDto,
} from './dto/update-appraisal.dto';
import { ListAppraisalQueryDto } from './dto/list-appraisal-query.dto';
import { ListAppraisalCriteriaQueryDto } from './dto/list-appraisal-criteria-query.dto';

const APPRAISAL_SELECT = {
  id: true,
  academic_year: true,
  status: true,
  hod_reviewed_at: true,
  hod_remarks: true,
  management_approved_at: true,
  created_at: true,
  staff_user_id: true,
  faculty: {
    select: {
      id: true,
      prefix: true,
      first_name: true,
      last_name: true,
      designation: true,
      department_id: true,
      departments: { select: { name: true } },
    },
  },
  users_appraisal_requests_hod_reviewed_byTousers: {
    select: { id: true, email: true },
  },
  users_appraisal_requests_management_approved_byTousers: {
    select: { id: true, email: true },
  },
  appraisal_entries: {
    select: {
      id: true,
      description: true,
      score: true,
      appraisal_criteria: {
        select: {
          id: true,
          criteria_name: true,
          max_score: true,
          appraisal_divisions: { select: { id: true, name: true } },
        },
      },
    },
  },
  appraisal_attachments: {
    select: {
      id: true,
      division_id: true,
      file_url: true,
      file_name: true,
      storage_path: true,
      uploaded_at: true,
    },
    orderBy: { uploaded_at: 'asc' },
  },
} as const;

interface AppraisalRequestRow {
  id: number;
  academic_year: string;
  status: string;
  hod_reviewed_at: Date | null;
  hod_remarks: string | null;
  management_approved_at: Date | null;
  created_at: Date;
  // Real column, added by the Secretary module completion migration — set
  // for Secretary-authored (non-Faculty) requests, null for Faculty/HoD
  // requests (which keep using faculty_id, unchanged).
  staff_user_id: number | null;
  // Null for a genuine Secretary-authored row (no faculty row exists for
  // that account) — this is a real, expected state now, not just a
  // compile-time nullability fix.
  faculty: {
    id: number;
    prefix: string | null;
    first_name: string;
    last_name: string;
    designation: string;
    department_id: number;
    departments: { name: string };
  } | null;
  users_appraisal_requests_hod_reviewed_byTousers: {
    id: number;
    email: string;
  } | null;
  users_appraisal_requests_management_approved_byTousers: {
    id: number;
    email: string;
  } | null;
  appraisal_entries: Array<{
    id: number;
    description: string | null;
    score: unknown;
    appraisal_criteria: {
      id: number;
      criteria_name: string;
      max_score: unknown;
      appraisal_divisions: { id: number; name: string };
    };
  }>;
  appraisal_attachments: Array<{
    id: number;
    division_id: number;
    file_url: string;
    file_name: string;
    storage_path: string;
    uploaded_at: Date;
  }>;
}

function toResponse(row: AppraisalRequestRow) {
  return {
    id: row.id,
    academic_year: row.academic_year,
    status: row.status,
    staff_user_id: row.staff_user_id,
    faculty: row.faculty && {
      id: row.faculty.id,
      first_name: row.faculty.first_name,
      last_name: row.faculty.last_name,
      designation: row.faculty.designation,
      department_name: row.faculty.departments.name,
    },
    hod_reviewer: row.users_appraisal_requests_hod_reviewed_byTousers,
    hod_reviewed_at: row.hod_reviewed_at,
    hod_remarks: row.hod_remarks,
    management_approver:
      row.users_appraisal_requests_management_approved_byTousers,
    management_approved_at: row.management_approved_at,
    created_at: row.created_at,
    entries: row.appraisal_entries.map((entry) => ({
      id: entry.id,
      description: entry.description,
      // Prisma's Decimal serializes to a string in JSON — convert to a
      // number here so API consumers (the frontend types this as `number`)
      // get a real number.
      score: entry.score === null ? null : Number(entry.score),
      criteria: {
        id: entry.appraisal_criteria.id,
        name: entry.appraisal_criteria.criteria_name,
        max_score: Number(entry.appraisal_criteria.max_score),
        division: entry.appraisal_criteria.appraisal_divisions,
      },
    })),
    attachments: row.appraisal_attachments.map((attachment) => ({
      id: attachment.id,
      division_id: attachment.division_id,
      file_url: attachment.file_url,
      file_name: attachment.file_name,
      uploaded_at: attachment.uploaded_at,
    })),
  };
}

@Injectable()
export class AppraisalService {
  private readonly logger = new Logger(AppraisalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * POST /appraisal (Faculty or HoD).
   * Creates the header (appraisal_requests) and its line items
   * (appraisal_entries) in a single transaction. An HoD's own submission
   * has no one to fill the HoD-review stage (they can't review their own
   * appraisal - see update()'s self-review guard), so it's created already
   * at 'hod_reviewed' instead of 'submitted', skipping straight to HR
   * scoring - same "goes directly to HR" treatment as Leave/OD.
   */
  async create(dto: CreateAppraisalDto, currentUser: JwtPayload) {
    const isSecretary = currentUser.role === ROLES.SECRETARY;
    const faculty = isSecretary
      ? null
      : await this.resolveFacultyByUserId(currentUser.sub);

    const existing = await this.prisma.appraisal_requests.findFirst({
      where: isSecretary
        ? { staff_user_id: currentUser.sub, academic_year: dto.academic_year }
        : { faculty_id: faculty!.id, academic_year: dto.academic_year },
    });
    if (existing) {
      throw new ConflictException(
        `An appraisal request already exists for ${dto.academic_year}`,
      );
    }

    const criteriaIds = dto.entries.map((e) => e.criteria_id);
    if (new Set(criteriaIds).size !== criteriaIds.length) {
      throw new BadRequestException('Duplicate criteria_id values in entries');
    }

    const criteria = await this.prisma.appraisal_criteria.findMany({
      where: { id: { in: criteriaIds } },
    });

    const foundCriteriaIds = new Set(criteria.map((c) => c.id));
    const missingCriteriaIds = criteriaIds.filter(
      (id) => !foundCriteriaIds.has(id),
    );
    if (missingCriteriaIds.length > 0) {
      throw new NotFoundException(
        `Criteria not found: ${missingCriteriaIds.join(', ')}`,
      );
    }

    const wrongYearIds = criteria
      .filter((c) => c.academic_year !== dto.academic_year)
      .map((c) => c.id);
    if (wrongYearIds.length > 0) {
      throw new BadRequestException(
        `Criteria ${wrongYearIds.join(', ')} do not belong to academic year ${dto.academic_year}`,
      );
    }

    const isHodSelfSubmission = currentUser.role === ROLES.HOD;

    const request = await this.prisma.$transaction(async (tx) => {
      const header = await tx.appraisal_requests.create({
        data: {
          ...(isSecretary
            ? { staff_user_id: currentUser.sub }
            : { faculty_id: faculty!.id }),
          academic_year: dto.academic_year,
          ...(isHodSelfSubmission
            ? {
                status: 'hod_reviewed' as const,
                hod_reviewed_by: currentUser.sub,
                hod_reviewed_at: new Date(),
              }
            : {}),
          // Secretary (or any non-Faculty staff account) — no HoD exists
          // to review it, so this goes straight to the HR scoring stage,
          // same skip-the-HoD-stage treatment as an HoD's own submission
          // above, just with no hod_reviewed_by (there was no reviewer).
          ...(isSecretary ? { status: 'hod_reviewed' as const } : {}),
        },
      });

      await tx.appraisal_entries.createMany({
        data: dto.entries.map((e) => ({
          appraisal_request_id: header.id,
          criteria_id: e.criteria_id,
          description: e.description,
        })),
      });

      return tx.appraisal_requests.findUniqueOrThrow({
        where: { id: header.id },
        select: APPRAISAL_SELECT,
      });
    });

    this.logger.log(
      `Appraisal request created: id=${request.id}` +
        (isSecretary ? ` staff_user=${currentUser.sub}` : ` faculty=${faculty!.id}`),
    );

    // An HoD's own self-submission (or a Secretary's, with no department at
    // all) skips the HoD stage entirely and has no one department-level to
    // notify.
    if (!isHodSelfSubmission && !isSecretary) {
      const hodUserId = await this.resolveDepartmentHodUserId(faculty!.department_id);
      if (hodUserId) {
        await this.notifyAppraisal(hodUserId, {
          title: 'New appraisal request to review',
          message: `${faculty!.first_name} ${faculty!.last_name} submitted an appraisal for ${dto.academic_year}.`,
          type: 'approval_request_pending',
          related_entity_id: request.id,
        });
      }
    }

    return toResponse(request);
  }

  /**
   * GET /appraisal-criteria?academic_year= (Faculty/HoD/HR Payroll).
   * Reference data: the divisions/criteria a faculty member submits entries
   * against on POST /appraisal. Defaults to the most recent academic_year
   * present in appraisal_criteria when none is given (lexical max is safe
   * here since the format is fixed-width "YYYY-YYYY").
   */
  async findCriteria(query: ListAppraisalCriteriaQueryDto) {
    let academicYear = query.academic_year;
    if (!academicYear) {
      const latest = await this.prisma.appraisal_criteria.findFirst({
        orderBy: { academic_year: 'desc' },
        select: { academic_year: true },
      });
      academicYear = latest?.academic_year;
    }

    if (!academicYear) {
      return { academic_year: null, divisions: [] };
    }

    const criteria = await this.prisma.appraisal_criteria.findMany({
      where: { academic_year: academicYear },
      orderBy: [{ division_id: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        criteria_name: true,
        max_score: true,
        appraisal_divisions: { select: { id: true, name: true } },
      },
    });

    const divisionsById = new Map<
      number,
      {
        id: number;
        name: string;
        criteria: Array<{ id: number; name: string; max_score: unknown }>;
      }
    >();
    for (const c of criteria) {
      const division = divisionsById.get(c.appraisal_divisions.id) ?? {
        id: c.appraisal_divisions.id,
        name: c.appraisal_divisions.name,
        criteria: [],
      };
      division.criteria.push({
        id: c.id,
        name: c.criteria_name,
        max_score: Number(c.max_score),
      });
      divisionsById.set(division.id, division);
    }

    return {
      academic_year: academicYear,
      divisions: Array.from(divisionsById.values()),
    };
  }

  /**
   * GET /appraisal (Faculty/HoD/HR Payroll). Faculty is always scoped to
   * their own records. HoD is always scoped to their own department (via
   * their own faculty row's department_id - a HoD account has a faculty
   * row too, designation "HOD & Professor" in the seed data). HR Payroll
   * is deliberately left unscoped - HR's "Appraisal" page shows which
   * faculty have applied (institution-wide), not HR's own appraisal (HR
   * has no Apply tab at all on that screen - see AppraisalRequestScreen's
   * canApply flag), and scoring/approval happens after a request has
   * already left the department.
   */
  async findAll(query: ListAppraisalQueryDto, currentUser: JwtPayload) {
    const where: Record<string, unknown> = {
      faculty_id: query.faculty_id,
      academic_year: query.academic_year,
      status: query.status,
    };

    if (currentUser.role === ROLES.FACULTY) {
      const faculty = await this.resolveFacultyByUserId(currentUser.sub);
      where.faculty_id = faculty.id;
    } else if (currentUser.role === ROLES.HOD) {
      const hod = await this.resolveFacultyByUserId(currentUser.sub);
      where.faculty = { department_id: hod.department_id };
    } else if (currentUser.role === ROLES.SECRETARY) {
      delete where.faculty_id;
      where.staff_user_id = currentUser.sub;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.appraisal_requests.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        select: APPRAISAL_SELECT,
      }),
      this.prisma.appraisal_requests.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  /**
   * GET /appraisal/:id (Faculty/HoD/HR Payroll). Faculty may only view
   * their own; HoD may only view requests from their own department.
   */
  async findOne(id: number, currentUser: JwtPayload) {
    const request = await this.prisma.appraisal_requests.findUnique({
      where: { id },
      select: APPRAISAL_SELECT,
    });

    if (!request) {
      throw new NotFoundException('Appraisal request not found');
    }

    if (currentUser.role === ROLES.SECRETARY) {
      if (request.staff_user_id !== currentUser.sub) {
        throw new ForbiddenException(
          'You may only view your own appraisal requests',
        );
      }
    } else if (currentUser.role === ROLES.FACULTY) {
      const faculty = await this.resolveFacultyByUserId(currentUser.sub);
      if (request.faculty?.id !== faculty.id) {
        throw new ForbiddenException(
          'You may only view your own appraisal requests',
        );
      }
    } else if (currentUser.role === ROLES.HOD) {
      const hod = await this.resolveFacultyByUserId(currentUser.sub);
      if (request.faculty?.department_id !== hod.department_id) {
        throw new ForbiddenException(
          'You may only view appraisal requests from your own department',
        );
      }
    }

    return toResponse(request);
  }

  /**
   * PATCH /appraisal/:id (HoD or HR Payroll only).
   * A role-gated state-machine transition:
   *   submitted --(HoD)--> hod_reviewed --(HR)--> hr_scored --(HR)--> management_approved
   *      |                       |                    |
   *      v                       v                    v
   *   rejected                rejected             rejected
   */
  async update(id: number, dto: UpdateAppraisalDto, currentUser: JwtPayload) {
    const existing = await this.prisma.appraisal_requests.findUnique({
      where: { id },
      include: { faculty: { select: { department_id: true } } },
    });
    if (!existing) {
      throw new NotFoundException('Appraisal request not found');
    }

    if (existing.faculty_id === null) {
      throw new InternalServerErrorException({
        message: 'This appraisal request has no faculty on record',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (currentUser.role === ROLES.HOD) {
      const hod = await this.resolveFacultyByUserId(currentUser.sub);
      // An HoD can now submit their OWN appraisal too (see create()) -
      // self-review would otherwise be possible since faculty_id === hod.id
      // is a valid state. Block it outright rather than silently allow an
      // HoD to approve their own request.
      if (existing.faculty_id === hod.id) {
        throw new ForbiddenException({
          message: 'You cannot review your own appraisal request',
          errorCode: 'CANNOT_REVIEW_OWN_REQUEST',
        });
      }
      if (existing.faculty?.department_id !== hod.department_id) {
        throw new ForbiddenException(
          'You may only review appraisal requests from your own department',
        );
      }
      return this.applyHodReview(
        id,
        existing.status,
        existing.faculty_id,
        dto,
        currentUser.sub,
      );
    }

    return this.applyHrAction(
      id,
      existing.status,
      existing.faculty_id,
      dto,
      currentUser.sub,
    );
  }

  /** DELETE /appraisal/:id (Faculty/Secretary — own request, only while not yet acted on). */
  async remove(id: number, userId: number, role?: string) {
    const existing = await this.prisma.appraisal_requests.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Appraisal request not found');
    }

    // A Secretary's own request starts at 'hod_reviewed' (no HoD exists to
    // review it — see create()), so that's their real "nothing has acted
    // on this yet" state, same role 'submitted' plays for Faculty/HoD.
    if (role === ROLES.SECRETARY) {
      if (existing.staff_user_id !== userId) {
        throw new ForbiddenException(
          'You may only delete your own appraisal requests',
        );
      }
      if (existing.status !== 'hod_reviewed') {
        throw new ConflictException(
          'This request has already been scored and can no longer be deleted',
        );
      }
    } else {
      const faculty = await this.resolveFacultyByUserId(userId);
      if (existing.faculty_id !== faculty.id) {
        throw new ForbiddenException(
          'You may only delete your own appraisal requests',
        );
      }
      if (existing.status !== 'submitted') {
        throw new ConflictException(
          'Only a request still in the submitted stage can be deleted',
        );
      }
    }

    // appraisal_entries cascade-deletes via schema's onDelete: Cascade on this FK.
    await this.prisma.appraisal_requests.delete({ where: { id } });

    this.logger.log(`Appraisal request deleted: id=${id}`);
    return { id, deleted: true };
  }

  /**
   * POST /appraisal_requests/:id/attachments (Faculty only — own request,
   * only while still 'submitted'). Files are uploaded to Supabase Storage
   * and only the resulting URL/name are persisted. Attachments belong to
   * the division as a whole, not a specific criteria_id/entry - there is no
   * FK to appraisal_entries.
   */
  async addAttachments(
    requestId: number,
    divisionId: number,
    files: Array<{ buffer: Buffer; originalname: string; mimetype: string }>,
    userId: number,
  ) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const existing = await this.prisma.appraisal_requests.findUnique({
      where: { id: requestId },
    });
    if (!existing) {
      throw new NotFoundException('Appraisal request not found');
    }
    if (existing.faculty_id !== faculty.id) {
      throw new ForbiddenException(
        'You may only attach files to your own appraisal requests',
      );
    }
    if (existing.status !== 'submitted') {
      throw new ConflictException(
        'Files can only be attached while the request is still in the submitted stage',
      );
    }

    const division = await this.prisma.appraisal_divisions.findUnique({
      where: { id: divisionId },
    });
    if (!division) {
      throw new NotFoundException('Appraisal division not found');
    }

    const uploaded = await Promise.all(
      files.map(async (file) => {
        const path = `${requestId}/${divisionId}/${Date.now()}-${file.originalname}`;
        const { url } = await this.storage.upload(
          file.buffer,
          path,
          file.mimetype,
        );
        return {
          file_url: url,
          file_name: file.originalname,
          storage_path: path,
        };
      }),
    );

    await this.prisma.appraisal_attachments.createMany({
      data: uploaded.map((u) => ({
        appraisal_request_id: requestId,
        division_id: divisionId,
        file_url: u.file_url,
        file_name: u.file_name,
        storage_path: u.storage_path,
      })),
    });

    this.logger.log(
      `${uploaded.length} attachment(s) added to appraisal request ${requestId}, division ${divisionId}`,
    );

    const request = await this.prisma.appraisal_requests.findUniqueOrThrow({
      where: { id: requestId },
      select: APPRAISAL_SELECT,
    });
    return toResponse(request);
  }

  /** DELETE /appraisal_requests/:id/attachments/:attachmentId (Faculty only — own request, only while still 'submitted'). */
  async removeAttachment(
    requestId: number,
    attachmentId: number,
    userId: number,
  ) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const request = await this.prisma.appraisal_requests.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('Appraisal request not found');
    }
    if (request.faculty_id !== faculty.id) {
      throw new ForbiddenException(
        'You may only remove attachments from your own appraisal requests',
      );
    }
    if (request.status !== 'submitted') {
      throw new ConflictException(
        'Attachments can only be removed while the request is still in the submitted stage',
      );
    }

    const attachment = await this.prisma.appraisal_attachments.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment || attachment.appraisal_request_id !== requestId) {
      throw new NotFoundException('Attachment not found on this request');
    }

    await this.prisma.appraisal_attachments.delete({
      where: { id: attachmentId },
    });
    await this.storage.remove(attachment.storage_path);

    this.logger.log(
      `Attachment ${attachmentId} removed from appraisal request ${requestId}`,
    );
    return { id: attachmentId, deleted: true };
  }

  private async applyHodReview(
    id: number,
    currentStatus: string,
    facultyId: number,
    dto: UpdateAppraisalDto,
    hodUserId: number,
  ) {
    if (dto.entries !== undefined) {
      throw new ForbiddenException('HoD may not score appraisal entries');
    }
    if (dto.status !== 'hod_reviewed' && dto.status !== 'rejected') {
      throw new ForbiddenException(
        'HoD may only set status to hod_reviewed or rejected',
      );
    }
    if (currentStatus !== 'submitted') {
      throw new ConflictException(
        'This appraisal request has already moved past the HoD review stage',
      );
    }

    const request = await this.prisma.appraisal_requests.update({
      where: { id },
      data: {
        status: dto.status,
        hod_reviewed_by: hodUserId,
        hod_reviewed_at: new Date(),
      },
      select: APPRAISAL_SELECT,
    });

    await this.notifyFacultyOfAppraisalStatus(facultyId, id, dto.status);
    // Passed the HoD stage - now HR Payroll's turn. Broadcast, same
    // reasoning as revaluation's COE notify: HR Payroll is a global role
    // with no per-request assignee.
    if (dto.status === 'hod_reviewed') {
      await this.notifyRoleUsersOfPendingAppraisal(id);
    }

    return toResponse(request);
  }

  private async applyHrAction(
    id: number,
    currentStatus: string,
    facultyId: number,
    dto: UpdateAppraisalDto,
    hrUserId: number,
  ) {
    if (dto.status === 'hod_reviewed') {
      throw new ForbiddenException('HR Payroll may not set hod_reviewed');
    }

    if (dto.status === 'hr_scored') {
      if (currentStatus !== 'hod_reviewed') {
        throw new ConflictException(
          'This appraisal request must be HoD-reviewed before it can be scored',
        );
      }
      if (!dto.entries || dto.entries.length === 0) {
        throw new BadRequestException(
          'entries with scores are required to set status to hr_scored',
        );
      }
      return this.scoreEntriesAndTransition(id, facultyId, dto.entries);
    }

    if (dto.entries !== undefined) {
      throw new ForbiddenException(
        'entries may only be supplied when transitioning to hr_scored',
      );
    }

    if (dto.status === 'management_approved') {
      if (currentStatus !== 'hr_scored') {
        throw new ConflictException(
          'This appraisal request must be scored before management approval',
        );
      }
      const request = await this.prisma.appraisal_requests.update({
        where: { id },
        data: {
          status: 'management_approved',
          management_approved_by: hrUserId,
          management_approved_at: new Date(),
        },
        select: APPRAISAL_SELECT,
      });
      await this.notifyFacultyOfAppraisalStatus(
        facultyId,
        id,
        'management_approved',
      );
      return toResponse(request);
    }

    // dto.status === 'rejected'
    if (currentStatus !== 'hod_reviewed' && currentStatus !== 'hr_scored') {
      throw new ConflictException(
        'This appraisal request is not in a stage HR Payroll can reject',
      );
    }
    const request = await this.prisma.appraisal_requests.update({
      where: { id },
      data: { status: 'rejected' },
      select: APPRAISAL_SELECT,
    });
    await this.notifyFacultyOfAppraisalStatus(facultyId, id, 'rejected');
    return toResponse(request);
  }

  private async scoreEntriesAndTransition(
    id: number,
    facultyId: number,
    entries: AppraisalEntryScoreDto[],
  ) {
    const entryIds = entries.map((e) => e.entry_id);
    if (new Set(entryIds).size !== entryIds.length) {
      throw new BadRequestException('Duplicate entry_id values in entries');
    }

    const existingEntries = await this.prisma.appraisal_entries.findMany({
      where: { id: { in: entryIds }, appraisal_request_id: id },
      include: { appraisal_criteria: true },
    });

    const foundEntryIds = new Set(existingEntries.map((e) => e.id));
    const missingEntryIds = entryIds.filter((eid) => !foundEntryIds.has(eid));
    if (missingEntryIds.length > 0) {
      throw new NotFoundException(
        `Entry not found on this appraisal request: ${missingEntryIds.join(', ')}`,
      );
    }

    const entryById = new Map(existingEntries.map((e) => [e.id, e]));
    for (const scoreDto of entries) {
      const entry = entryById.get(scoreDto.entry_id);
      const maxScore = entry
        ? Number(entry.appraisal_criteria.max_score)
        : undefined;
      if (maxScore !== undefined && scoreDto.score > maxScore) {
        throw new BadRequestException(
          `Score ${scoreDto.score} exceeds max_score ${maxScore} for entry ${scoreDto.entry_id}`,
        );
      }
    }

    const request = await this.prisma.$transaction(async (tx) => {
      await Promise.all(
        entries.map((e) =>
          tx.appraisal_entries.update({
            where: { id: e.entry_id },
            data: { score: e.score },
          }),
        ),
      );
      return tx.appraisal_requests.update({
        where: { id },
        data: { status: 'hr_scored' },
        select: APPRAISAL_SELECT,
      });
    });

    await this.notifyFacultyOfAppraisalStatus(facultyId, id, 'hr_scored');

    return toResponse(request);
  }

  private async notifyFacultyOfAppraisalStatus(
    facultyId: number,
    requestId: number,
    status: string,
  ): Promise<void> {
    try {
      const faculty = await this.prisma.faculty.findUnique({
        where: { id: facultyId },
        select: { user_id: true },
      });
      if (!faculty) return;

      const labels: Record<string, string> = {
        hod_reviewed: 'reviewed by your HoD and forwarded to HR Payroll',
        hr_scored: 'scored by HR Payroll',
        management_approved: 'approved by management',
        rejected: 'rejected',
      };

      await this.notifications.notify({
        user_id: faculty.user_id,
        title: 'Appraisal request updated',
        message: `Your appraisal request has been ${labels[status] ?? `updated to ${status}`}.`,
        type:
          status === 'rejected'
            ? 'approval_request_rejected'
            : status === 'management_approved'
              ? 'approval_request_approved'
              : 'approval_request_pending',
        related_entity_type: 'appraisal_request',
        related_entity_id: requestId,
      });
    } catch (err) {
      this.logger.error(
        `Failed to notify faculty of appraisal status for request ${requestId}`,
        err,
      );
    }
  }

  /** HR Payroll is a global role with no per-request assignee - broadcast, same reasoning as revaluation's COE notify. */
  private async notifyRoleUsersOfPendingAppraisal(
    requestId: number,
  ): Promise<void> {
    try {
      const hrUsers = await this.prisma.users.findMany({
        where: { roles: { name: ROLES.HR_PAYROLL } },
        select: { id: true },
      });
      for (const u of hrUsers) {
        await this.notifications.notify({
          user_id: u.id,
          title: 'Appraisal request ready for scoring',
          message: 'An HoD-reviewed appraisal request is ready for HR scoring.',
          type: 'approval_request_pending',
          related_entity_type: 'appraisal_request',
          related_entity_id: requestId,
        });
      }
    } catch (err) {
      this.logger.error(
        `Failed to notify HR Payroll of appraisal request ${requestId}`,
        err,
      );
    }
  }

  private async notifyAppraisal(
    userId: number,
    opts: {
      title: string;
      message: string;
      type:
        | 'approval_request_pending'
        | 'approval_request_approved'
        | 'approval_request_rejected';
      related_entity_id: number;
    },
  ): Promise<void> {
    try {
      await this.notifications.notify({
        user_id: userId,
        title: opts.title,
        message: opts.message,
        type: opts.type,
        related_entity_type: 'appraisal_request',
        related_entity_id: opts.related_entity_id,
      });
    } catch (err) {
      this.logger.error(
        `Failed to notify user ${userId} of appraisal request ${opts.related_entity_id}`,
        err,
      );
    }
  }

  /**
   * Two plain sequential queries rather than one nested relation select -
   * mirrors resolveDepartmentHodUserId in faculty-leaves.service.ts, for
   * the same reason: departments' auto-generated HoD relation field name
   * is not stable across `db pull` runs.
   */
  private async resolveDepartmentHodUserId(
    departmentId: number,
  ): Promise<number | null> {
    const department = await this.prisma.departments.findUnique({
      where: { id: departmentId },
      select: { head_of_department_faculty_id: true },
    });
    if (!department?.head_of_department_faculty_id) {
      return null;
    }
    const hod = await this.prisma.faculty.findUnique({
      where: { id: department.head_of_department_faculty_id },
      select: { user_id: true },
    });
    return hod?.user_id ?? null;
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
