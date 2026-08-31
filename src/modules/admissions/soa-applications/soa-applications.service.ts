import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import crypto from 'node:crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/common/storage/storage.service';
import { SmsService } from 'src/common/sms/sms.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { STORAGE_BUCKETS } from 'src/common/constants/storage-buckets.constant';
import {
  address_type_enum,
  dayscholar_mode_enum,
  soa_status_enum,
  student_type_enum,
} from 'generated/prisma/client';
import { CreateSoaApplicationDto } from './dto/create-soa-application.dto';
import { UpdateSoaApplicationDto } from './dto/update-soa-application.dto';
import { UpdateSoaStatusDto } from './dto/update-soa-status.dto';
import { CreatePerfectEntryDto } from './dto/create-perfect-entry.dto';
import { ListSoaApplicationsQueryDto } from './dto/list-soa-applications-query.dto';
import { SaveProfileDraftDto } from './dto/save-profile-draft.dto';
import { paginate } from 'src/common/dto/pagination.dto';
import { Prisma } from 'generated/prisma/client';

/**
 * Statuses in which the draft application fields (name, contacts, cutoffs)
 * can still be corrected. Locked once admission_confirmed — at that point the
 * real students/users row (created by Perfect Entry) is the record of truth.
 */
const EDITABLE_STATUSES: soa_status_enum[] = [
  soa_status_enum.applied,
  soa_status_enum.fees_paid,
];

const VALID_ADDRESS_TYPES = Object.values(address_type_enum);

const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];
const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024; // matches the reference admission form's own limit

const CUTOFF_FIELDS = [
  'cutoff_physics',
  'cutoff_chemistry',
  'cutoff_maths',
] as const;

/**
 * Legal forward-only transitions through soa_status_enum. Not specified by
 * todo.md/2-PATCH-soa-applications-status.md (marked "Pending from Backend
 * Implementation" for the full matrix) — this is the deliberate choice made
 * during implementation, documented here and in
 * test/methods/2-PATCH-soa-applications-status-test.md:
 *  - applied     → fees_paid | cancelled
 *  - fees_paid   → admission_confirmed | cancelled  (a paid application can
 *    still be cancelled/withdrawn; refund handling is out of this endpoint's
 *    scope per the spec's own note)
 *  - admission_confirmed → terminal (gate for Perfect Entry; no further moves)
 *  - cancelled   → terminal
 * Re-submitting the application's CURRENT status is treated as an invalid
 * transition (not a no-op success), since nothing in the spec calls for
 * idempotent same-status requests.
 */
const ALLOWED_STATUS_TRANSITIONS: Record<soa_status_enum, soa_status_enum[]> = {
  applied: [soa_status_enum.fees_paid, soa_status_enum.cancelled],
  fees_paid: [soa_status_enum.admission_confirmed, soa_status_enum.cancelled],
  admission_confirmed: [],
  cancelled: [],
};

/**
 * Status an SOA application must be in for Perfect Entry to be attempted.
 * The real schema has no separate "fee_paid"/"confirmed" pair — it collapses
 * to one admission_confirmed value, which is already the terminal state
 * reached via fees_paid → admission_confirmed (see ALLOWED_STATUS_TRANSITIONS
 * above). After Perfect Entry completes, status is deliberately left at
 * admission_confirmed rather than moved to a new "completed" value the
 * schema doesn't have — the linked `students` row (students.soa_application_id)
 * is the real completion marker, matching the "at most one student per
 * application" business rule.
 */
const PERFECT_ENTRY_ELIGIBLE_STATUS = soa_status_enum.admission_confirmed;

@Injectable()
export class SoaApplicationsService {
  private readonly logger = new Logger(SoaApplicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly sms: SmsService,
  ) {}

  /**
   * POST /soa-applications
   * Admin-only intake of a prospect's Sale of Application form. No FK checks
   * needed — `soa_applications` stands alone until Perfect Entry links it to
   * a `students` row.
   *
   * Error cases:
   *  422 INVALID_CUTOFF_RANGE – any provided cutoff mark falls outside 0–100
   *  500 INTERNAL_ERROR       – unexpected DB failure
   */
  async create(dto: CreateSoaApplicationDto) {
    for (const field of CUTOFF_FIELDS) {
      const value = dto[field];
      if (value !== undefined && (value < 0 || value > 100)) {
        throw new UnprocessableEntityException({
          message: `${field} must be between 0 and 100`,
          errorCode: 'INVALID_CUTOFF_RANGE',
        });
      }
    }

    try {
      return await this.prisma.soa_applications.create({ data: dto });
    } catch (err) {
      this.logger.error('Failed to create SOA application', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PATCH /soa-applications/:id/status
   * Advances the application through soa_status_enum. See
   * ALLOWED_STATUS_TRANSITIONS above for the transition matrix.
   *
   * Error cases:
   *  404 SOA_APPLICATION_NOT_FOUND  – no row with this id
   *  422 INVALID_STATUS_TRANSITION  – status is a real enum member, but not
   *                                   a legal next step from the current one
   *  500 INTERNAL_ERROR             – unexpected DB failure
   */
  async updateStatus(id: number, dto: UpdateSoaStatusDto) {
    const application = await this.prisma.soa_applications.findUnique({
      where: { id },
    });

    if (!application) {
      throw new NotFoundException({
        message: 'SOA application not found',
        errorCode: 'SOA_APPLICATION_NOT_FOUND',
      });
    }

    const allowedNext = ALLOWED_STATUS_TRANSITIONS[application.status];
    if (!allowedNext.includes(dto.status)) {
      throw new UnprocessableEntityException({
        message: `Cannot transition from '${application.status}' to '${dto.status}'`,
        errorCode: 'INVALID_STATUS_TRANSITION',
      });
    }

    try {
      return await this.prisma.soa_applications.update({
        where: { id },
        data: { status: dto.status },
      });
    } catch (err) {
      this.logger.error(
        `Failed to update status for SOA application ${id}`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * POST /soa-applications/:id/perfect-entry
   *
   * SCOPE NOTE — implemented Admin-only, not the spec's "primary: student
   * self-service" flow. The spec itself flags the blocker: there is no
   * invite/pre-auth token table anywhere in this schema, and the existing
   * JWT login flow (see brain/AUTH.md) strictly requires an EXISTING `users`
   * row — but this endpoint's whole job is to CREATE that row. A prospect
   * cannot hold a valid JWT before this endpoint runs, so "student
   * self-service" isn't achievable without a new pre-auth subsystem (the
   * spec's own "Future Improvements" proposes exactly that: a
   * soa_pre_auth_tokens table). Until that exists, only the documented
   * "Secondary: Admin may complete on the student's behalf" path is
   * implementable — see
   * test/methods/3-POST-soa-applications-perfect-entry-test.md.
   *
   * DEFERRED SCOPE — student_transport_mapping / student_hostel_mapping are
   * NOT inserted. Both need business logic this spec never states:
   *  - student_transport_mapping needs route_id + boarding_stage_id +
   *    destination_stage_id (three FKs), not the single transport_stage_id
   *    the DTO describes — resolving a route/destination from one boarding
   *    stage needs a rule this spec doesn't give.
   *  - student_hostel_mapping needs a specific hostel_rooms.room_id, not a
   *    hostel_room_types.id — assigning an actual room from a room *type*
   *    needs a room-allocation algorithm this spec doesn't give either.
   * Both conditional fields ARE still required (422 MISSING_CONDITIONAL_FIELD)
   * and existence-checked (404) as the spec requires — only the mapping-table
   * insert itself is deferred.
   *
   * Error cases:
   *  404 SOA_APPLICATION_NOT_FOUND / COURSE_NOT_FOUND / QUOTA_NOT_FOUND /
   *      BATCH_NOT_FOUND / TRANSPORT_STAGE_NOT_FOUND / HOSTEL_ROOM_TYPE_NOT_FOUND
   *  409 PERFECT_ENTRY_ALREADY_DONE / EMAIL_ALREADY_EXISTS /
   *      STUDENT_ID_NO_ALREADY_EXISTS / ADMISSION_NO_ALREADY_EXISTS
   *  422 PERFECT_ENTRY_NOT_ALLOWED / INVALID_ADDRESS_TYPE / MISSING_CONDITIONAL_FIELD
   *  400 VALIDATION_ERROR — date_of_birth in the future, duplicate
   *      identity_marks.mark_number, duplicate addresses.address_type
   *  500 INTERNAL_ERROR
   */
  async perfectEntry(id: number, dto: CreatePerfectEntryDto) {
    const application = await this.prisma.soa_applications.findUnique({
      where: { id },
    });
    if (!application) {
      throw new NotFoundException({
        message: 'SOA application not found',
        errorCode: 'SOA_APPLICATION_NOT_FOUND',
      });
    }

    if (application.status !== PERFECT_ENTRY_ELIGIBLE_STATUS) {
      throw new UnprocessableEntityException({
        message: `Perfect entry requires status '${PERFECT_ENTRY_ELIGIBLE_STATUS}'; this application is '${application.status}'`,
        errorCode: 'PERFECT_ENTRY_NOT_ALLOWED',
      });
    }

    const existingStudent = await this.prisma.students.findUnique({
      where: { soa_application_id: id },
    });
    if (existingStudent) {
      throw new ConflictException({
        message: 'This application has already completed perfect entry',
        errorCode: 'PERFECT_ENTRY_ALREADY_DONE',
      });
    }

    this.validateConditionalFields(dto);
    this.validateIdentityMarks(dto.identity_marks);
    this.validateAddresses(dto.addresses);
    this.validateCertificates(dto.certificates);
    this.validateDateOfBirth(dto.date_of_birth);

    const [course, quota, batch] = await Promise.all([
      this.prisma.courses.findUnique({ where: { id: dto.course_id } }),
      this.prisma.quotas.findUnique({ where: { id: dto.quota_id } }),
      this.prisma.batches.findUnique({ where: { id: dto.batch_id } }),
    ]);
    if (!course) {
      throw new NotFoundException({
        message: 'course_id does not reference an existing course',
        errorCode: 'COURSE_NOT_FOUND',
      });
    }
    if (!quota) {
      throw new NotFoundException({
        message: 'quota_id does not reference an existing quota',
        errorCode: 'QUOTA_NOT_FOUND',
      });
    }
    if (!batch) {
      throw new NotFoundException({
        message: 'batch_id does not reference an existing batch',
        errorCode: 'BATCH_NOT_FOUND',
      });
    }

    if (dto.certificates?.length) {
      const typeIds = dto.certificates.map((c) => c.certificate_type_id);
      const foundTypes = await this.prisma.certificate_types.findMany({
        where: { id: { in: typeIds } },
        select: { id: true },
      });
      if (foundTypes.length !== new Set(typeIds).size) {
        throw new NotFoundException({
          message:
            'One or more certificate_type_id values do not reference an existing certificate type',
          errorCode: 'CERTIFICATE_TYPE_NOT_FOUND',
        });
      }
    }

    const isDayscholar = dto.student_type === student_type_enum.dayscholar;
    const isHosteller = dto.student_type === student_type_enum.hosteller;

    if (
      isDayscholar &&
      dto.dayscholar_mode === dayscholar_mode_enum.transport
    ) {
      const transportStage = await this.prisma.transport_stages.findUnique({
        where: { id: dto.transport_stage_id },
      });
      if (!transportStage) {
        throw new NotFoundException({
          message:
            'transport_stage_id does not reference an existing transport stage',
          errorCode: 'TRANSPORT_STAGE_NOT_FOUND',
        });
      }
    }

    if (isHosteller) {
      const hostelRoomType = await this.prisma.hostel_room_types.findUnique({
        where: { id: dto.hostel_room_type_id },
      });
      if (!hostelRoomType) {
        throw new NotFoundException({
          message:
            'hostel_room_type_id does not reference an existing hostel room type',
          errorCode: 'HOSTEL_ROOM_TYPE_NOT_FOUND',
        });
      }
    }

    const [emailTaken, studentIdNoTaken, admissionNoTaken] = await Promise.all([
      this.prisma.users.findUnique({ where: { email: dto.email } }),
      this.prisma.students.findUnique({
        where: { student_id_no: dto.student_id_no },
      }),
      dto.admission_no
        ? this.prisma.students.findUnique({
            where: { admission_no: dto.admission_no },
          })
        : Promise.resolve(null),
    ]);
    if (emailTaken) {
      throw new ConflictException({
        message: 'This email is already registered',
        errorCode: 'EMAIL_ALREADY_EXISTS',
      });
    }
    if (studentIdNoTaken) {
      throw new ConflictException({
        message: 'This student_id_no is already in use',
        errorCode: 'STUDENT_ID_NO_ALREADY_EXISTS',
      });
    }
    if (admissionNoTaken) {
      throw new ConflictException({
        message: 'This admission_no is already in use',
        errorCode: 'ADMISSION_NO_ALREADY_EXISTS',
      });
    }

    const studentRole = await this.prisma.roles.findUnique({
      where: { name: ROLES.STUDENT },
    });
    if (!studentRole) {
      this.logger.error(
        `Role '${ROLES.STUDENT}' is not seeded in the roles table`,
      );
      throw new InternalServerErrorException({
        message:
          'Something went wrong while completing your admission. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    // Either the admin typed one (dto.password present — the wizard's
    // "Auto-generate" toggle was off), or it was off... the toggle was ON,
    // in which case the field is omitted entirely and a random 6-digit
    // numeric code is generated here instead. Either way it's hashed with
    // the same unsalted-SHA-256 scheme AuthService's login check compares
    // against (see brain/SECURITY.md — a pre-existing, separately-tracked
    // weakness, not something to silently change mid-endpoint), and the
    // plaintext is kept only long enough to (a) return it once in this
    // response and (b) best-effort SMS it to the student below.
    const plainPassword = dto.password ?? this.generateNumericPassword();
    const passwordHash = this.hashPassword(plainPassword);

    const createdStudent = await this.runPerfectEntryTransaction(
      id,
      dto,
      passwordHash,
      studentRole.id,
      isDayscholar,
    );

    // Best-effort SMS with the login credentials — SmsService.send() never
    // throws (see its own docblock), so a missing/broken provider can never
    // fail an admission that's already been committed to the DB above. The
    // result is returned to the caller either way so the UI can show an
    // honest "not sent" note instead of assuming delivery.
    const phone = dto.contacts?.student_mobile;
    const sms = phone
      ? await this.sms.send(
          phone,
          `Your student portal login — email: ${dto.email}, password: ${plainPassword}. Please change this password after logging in.`,
        )
      : {
          sent: false,
          note: 'No phone number was provided for this student.',
        };

    return { ...createdStudent, password: plainPassword, sms };
  }

  /** Just the DB-writing half of perfectEntry, split out so the SMS step above can run after a real commit instead of inside the same try/catch. */
  private async runPerfectEntryTransaction(
    id: number,
    dto: CreatePerfectEntryDto,
    passwordHash: string,
    studentRoleId: number,
    isDayscholar: boolean,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.users.create({
          data: {
            email: dto.email,
            password_hash: passwordHash,
            role_id: studentRoleId,
            status: 'active',
          },
        });

        const student = await tx.students.create({
          data: {
            soa_application_id: id,
            user_id: user.id,
            student_id_no: dto.student_id_no,
            roll_no: dto.roll_no,
            register_no: dto.register_no,
            admission_no: dto.admission_no,
            course_id: dto.course_id,
            quota_id: dto.quota_id,
            batch_id: dto.batch_id,
            admission_date: dto.admission_date
              ? new Date(dto.admission_date)
              : undefined,
            admission_type: dto.admission_type,
            joined_academic_year: dto.joined_academic_year,
            gender: dto.gender,
            date_of_birth: dto.date_of_birth
              ? new Date(dto.date_of_birth)
              : undefined,
            student_type: dto.student_type,
            // Stale fields from the abandoned student_type branch are
            // dropped, never persisted (see spec's edge-case note).
            dayscholar_mode: isDayscholar ? dto.dayscholar_mode : undefined,
            vehicle_number: isDayscholar ? dto.vehicle_number : undefined,
            is_first_graduate: dto.is_first_graduate,
            nationality: dto.nationality,
            religion: dto.religion,
            community: dto.community,
            caste: dto.caste,
            mother_tongue: dto.mother_tongue,
            blood_group: dto.blood_group,
            is_father_exserviceman: dto.is_father_exserviceman,
            exserviceman_info: dto.is_father_exserviceman
              ? dto.exserviceman_info
              : undefined,
            is_diff_abled: dto.is_diff_abled,
            diff_abled_info: dto.is_diff_abled
              ? dto.diff_abled_info
              : undefined,
            counselling_order_no: dto.counselling_order_no,
            counselling_rank_no: dto.counselling_rank_no,
            govt_quota_admission_no: dto.govt_quota_admission_no,
            joined_through: dto.joined_through,
            knew_institution_by: dto.knew_institution_by,
            nominee: dto.nominee,
            // Always a URL this same application already got back from
            // POST :id/photo (see CreatePerfectEntryDto's docblock) — never
            // a client-chosen photo_uploaded_at, so the two stay honest.
            photo_url: dto.photo_url,
            photo_uploaded_at: dto.photo_url ? new Date() : undefined,
          },
        });

        if (dto.sensitive_info) {
          await tx.student_sensitive_info.create({
            data: {
              student_id: student.id,
              aadhar_number: dto.sensitive_info.aadhar_number,
              pan_number: dto.sensitive_info.pan_number,
            },
          });
        }

        if (dto.identity_marks?.length) {
          await tx.student_identity_marks.createMany({
            data: dto.identity_marks.map((mark) => ({
              student_id: student.id,
              mark_number: mark.mark_number,
              description: mark.description,
            })),
          });
        }

        if (dto.family_details) {
          await tx.student_family_details.create({
            data: { student_id: student.id, ...dto.family_details },
          });
        }

        if (dto.contacts) {
          await tx.student_contacts.create({
            data: { student_id: student.id, ...dto.contacts },
          });
        }

        if (dto.addresses?.length) {
          await tx.student_addresses.createMany({
            data: dto.addresses.map((address) => ({
              student_id: student.id,
              address_type: address.address_type as address_type_enum,
              address_line: address.address_line,
              city: address.city,
              state: address.state,
              pincode: address.pincode,
            })),
          });
        }

        if (dto.certificates?.length) {
          await tx.student_certificates.createMany({
            data: dto.certificates.map((cert) => ({
              student_id: student.id,
              certificate_type_id: cert.certificate_type_id,
              is_available: cert.is_available,
              file_url: cert.file_url,
            })),
          });
        }

        // student_transport_mapping / student_hostel_mapping intentionally
        // NOT inserted — see the deferred-scope note in this method's docblock.

        // The in-progress profile draft (if any) is no longer needed once
        // the real student row exists — deleteMany rather than delete so
        // this is a no-op when nothing was ever saved.
        await tx.admission_profile_drafts.deleteMany({
          where: { soa_application_id: id },
        });

        return student;
      });
    } catch (err) {
      if (this.isUniqueConstraintError(err)) {
        throw new ConflictException({
          message:
            'A record with one of the provided unique fields already exists',
          errorCode: 'PERFECT_ENTRY_ALREADY_DONE',
        });
      }
      this.logger.error(
        `Failed to complete perfect entry for SOA application ${id}`,
        err,
      );
      throw new InternalServerErrorException({
        message:
          'Something went wrong while completing your admission. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /soa-applications/:id/draft — the Complete Profile wizard's saved
   * in-progress state, or null if nothing has been saved yet. Returning null
   * (not 404) for "no draft" keeps the wizard's load path a single branch:
   * an application can validly have never been drafted.
   */
  async getDraft(id: number) {
    const application = await this.prisma.soa_applications.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!application) {
      throw new NotFoundException({
        message: 'SOA application not found',
        errorCode: 'SOA_APPLICATION_NOT_FOUND',
      });
    }

    return this.prisma.admission_profile_drafts.findUnique({
      where: { soa_application_id: id },
      select: {
        values: true,
        marks: true,
        saved_categories: true,
        updated_at: true,
      },
    });
  }

  /**
   * PUT /soa-applications/:id/draft — upserts the wizard's in-progress state.
   * Called after every category save so closing the tab, a refresh, or
   * another admin picking up the same application never loses progress.
   */
  async saveDraft(id: number, dto: SaveProfileDraftDto) {
    const application = await this.prisma.soa_applications.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!application) {
      throw new NotFoundException({
        message: 'SOA application not found',
        errorCode: 'SOA_APPLICATION_NOT_FOUND',
      });
    }

    const data = {
      values: dto.values as Prisma.InputJsonValue,
      marks: dto.marks as Prisma.InputJsonValue,
      saved_categories: dto.saved_categories,
      updated_at: new Date(),
    };

    return this.prisma.admission_profile_drafts.upsert({
      where: { soa_application_id: id },
      create: { soa_application_id: id, ...data },
      update: data,
      select: {
        values: true,
        marks: true,
        saved_categories: true,
        updated_at: true,
      },
    });
  }

  /**
   * POST /soa-applications/:id/photo — uploads to Supabase Storage and
   * returns the public URL only; nothing is written to the DB here. There
   * is no `students` row to attach it to yet at this point in the wizard
   * (perfect-entry hasn't run), so the frontend stashes the returned URL in
   * the wizard's own draft state (values.photo_url) and it rides along in
   * the final perfect-entry payload, same as every other wizard field.
   */
  async uploadPhoto(id: number, file: Express.Multer.File) {
    await this.assertApplicationExists(id);
    if (!PHOTO_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException({
        message: `That file type is not accepted. JPG, PNG or WebP only — got ${file.mimetype || 'an unknown type'}.`,
        errorCode: 'INVALID_PHOTO_TYPE',
      });
    }
    if (file.size > PHOTO_MAX_BYTES) {
      throw new BadRequestException({
        message: `File is too large — the limit is ${PHOTO_MAX_BYTES / (1024 * 1024)}MB.`,
        errorCode: 'PHOTO_TOO_LARGE',
      });
    }

    const { key } = await this.storage.upload(
      `soa/${id}`,
      file.originalname,
      file.buffer,
      file.mimetype,
      STORAGE_BUCKETS.STUDENT_PHOTOS,
    );
    return {
      url: this.storage.getPublicUrl(key, STORAGE_BUCKETS.STUDENT_PHOTOS),
    };
  }

  /**
   * POST /soa-applications/:id/documents — same "upload now, attach later"
   * pattern as uploadPhoto: student_certificates.student_id can't be set
   * until the real student row exists, so this only returns
   * {certificate_type_id, file_url} for the wizard to fold into its draft
   * and, ultimately, the perfect-entry payload's `certificates` array.
   */
  async uploadDocument(
    id: number,
    certificateTypeId: number,
    file: Express.Multer.File,
  ) {
    await this.assertApplicationExists(id);
    const certificateType = await this.prisma.certificate_types.findUnique({
      where: { id: certificateTypeId },
      select: { id: true },
    });
    if (!certificateType) {
      throw new NotFoundException({
        message:
          'certificate_type_id does not reference an existing certificate type',
        errorCode: 'CERTIFICATE_TYPE_NOT_FOUND',
      });
    }
    if (!DOCUMENT_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException({
        message: `That file type is not accepted. PDF, JPG, PNG or WebP only — got ${file.mimetype || 'an unknown type'}.`,
        errorCode: 'INVALID_DOCUMENT_TYPE',
      });
    }
    if (file.size > DOCUMENT_MAX_BYTES) {
      throw new BadRequestException({
        message: `File is too large — the limit is ${DOCUMENT_MAX_BYTES / (1024 * 1024)}MB per document.`,
        errorCode: 'DOCUMENT_TOO_LARGE',
      });
    }

    const { key } = await this.storage.upload(
      `soa/${id}/certificates`,
      file.originalname,
      file.buffer,
      file.mimetype,
      STORAGE_BUCKETS.STUDENT_DOCUMENTS,
    );
    // student_documents is PRIVATE — file_url is the storage KEY (what the
    // wizard's draft stashes and, ultimately, perfect-entry's `certificates`
    // array persists as student_certificates.file_url); preview_url is a
    // freshly-signed, time-limited link for the wizard to show "View" on
    // the just-attached scan right now. Never persist preview_url anywhere.
    return {
      certificate_type_id: certificateTypeId,
      file_url: key,
      preview_url: await this.storage.getSignedDownloadUrl(
        key,
        STORAGE_BUCKETS.STUDENT_DOCUMENTS,
      ),
    };
  }

  private async assertApplicationExists(id: number) {
    const application = await this.prisma.soa_applications.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!application) {
      throw new NotFoundException({
        message: 'SOA application not found',
        errorCode: 'SOA_APPLICATION_NOT_FOUND',
      });
    }
  }

  private validateConditionalFields(dto: CreatePerfectEntryDto) {
    if (dto.student_type === student_type_enum.dayscholar) {
      if (!dto.dayscholar_mode) {
        throw new UnprocessableEntityException({
          message:
            'dayscholar_mode is required when student_type is dayscholar',
          errorCode: 'MISSING_CONDITIONAL_FIELD',
        });
      }
      if (
        dto.dayscholar_mode === dayscholar_mode_enum.own_vehicle &&
        !dto.vehicle_number
      ) {
        throw new UnprocessableEntityException({
          message:
            'vehicle_number is required when dayscholar_mode is own_vehicle',
          errorCode: 'MISSING_CONDITIONAL_FIELD',
        });
      }
      if (
        dto.dayscholar_mode === dayscholar_mode_enum.transport &&
        !dto.transport_stage_id
      ) {
        throw new UnprocessableEntityException({
          message:
            'transport_stage_id is required when dayscholar_mode is transport',
          errorCode: 'MISSING_CONDITIONAL_FIELD',
        });
      }
    }

    if (
      dto.student_type === student_type_enum.hosteller &&
      !dto.hostel_room_type_id
    ) {
      throw new UnprocessableEntityException({
        message:
          'hostel_room_type_id is required when student_type is hosteller',
        errorCode: 'MISSING_CONDITIONAL_FIELD',
      });
    }

    if (dto.is_father_exserviceman && !dto.exserviceman_info) {
      throw new UnprocessableEntityException({
        message:
          'exserviceman_info is required when is_father_exserviceman is true',
        errorCode: 'MISSING_CONDITIONAL_FIELD',
      });
    }

    if (dto.is_diff_abled && !dto.diff_abled_info) {
      throw new UnprocessableEntityException({
        message: 'diff_abled_info is required when is_diff_abled is true',
        errorCode: 'MISSING_CONDITIONAL_FIELD',
      });
    }
  }

  private validateIdentityMarks(
    marks?: CreatePerfectEntryDto['identity_marks'],
  ) {
    if (!marks?.length) return;
    const numbers = marks.map((mark) => mark.mark_number);
    if (new Set(numbers).size !== numbers.length) {
      throw new BadRequestException({
        message: 'identity_marks cannot repeat the same mark_number',
        errorCode: 'VALIDATION_ERROR',
      });
    }
  }

  private validateCertificates(
    certificates?: CreatePerfectEntryDto['certificates'],
  ) {
    if (!certificates?.length) return;
    const typeIds = certificates.map((c) => c.certificate_type_id);
    if (new Set(typeIds).size !== typeIds.length) {
      throw new BadRequestException({
        message: 'certificates cannot repeat the same certificate_type_id',
        errorCode: 'VALIDATION_ERROR',
      });
    }
  }

  /** Same one-way SHA-256 hashing scheme used by AuthService's login check and faculty.service.ts's own createFaculty(). */
  private hashPassword(plain: string): string {
    return crypto.createHash('sha256').update(plain).digest('hex');
  }

  /**
   * Used when the wizard's "Auto-generate" toggle is on — a random 6-digit
   * numeric code (e.g. "004821", leading zeros kept), the format the
   * frontend toggle promises. crypto.randomInt is cryptographically strong,
   * unlike Math.random. This is intentionally simple (digits only, no
   * letters/symbols) since it's meant to be read off an SMS and typed back
   * in on a phone keypad — same reasoning as a bank OTP.
   */
  private generateNumericPassword(): string {
    return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private validateAddresses(addresses?: CreatePerfectEntryDto['addresses']) {
    if (!addresses?.length) return;
    const types = addresses.map((address) => address.address_type);
    if (new Set(types).size !== types.length) {
      throw new BadRequestException({
        message: 'addresses cannot repeat the same address_type',
        errorCode: 'VALIDATION_ERROR',
      });
    }
    for (const address of addresses) {
      if (
        !VALID_ADDRESS_TYPES.includes(address.address_type as address_type_enum)
      ) {
        throw new UnprocessableEntityException({
          message: `address_type must be one of: ${VALID_ADDRESS_TYPES.join(', ')}`,
          errorCode: 'INVALID_ADDRESS_TYPE',
        });
      }
    }
  }

  private validateDateOfBirth(dateOfBirth?: string) {
    if (dateOfBirth && new Date(dateOfBirth) > new Date()) {
      throw new BadRequestException({
        message: 'date_of_birth cannot be in the future',
        errorCode: 'VALIDATION_ERROR',
      });
    }
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'P2002'
    );
  }

  /**
   * GET /soa-applications — the admissions pipeline view: every draft, its
   * status, and whether Perfect Entry has already turned it into a real
   * student (students.soa_application_id is unique, so at most one).
   */
  async findAll(query: ListSoaApplicationsQueryDto) {
    const where: Record<string, unknown> = {};
    if (query.has_draft === 'true') {
      // "Draft" isn't a real status — it's admission_confirmed applications
      // that started Complete Profile but haven't finished it yet.
      where.status = soa_status_enum.admission_confirmed;
      where.students = null;
      where.admission_profile_drafts = { isNot: null };
    } else if (query.status) {
      where.status = query.status;
    }
    if (query.q) {
      where.OR = [
        { first_name: { contains: query.q, mode: 'insensitive' } },
        { last_name: { contains: query.q, mode: 'insensitive' } },
        { student_email: { contains: query.q, mode: 'insensitive' } },
        { student_contact: { contains: query.q } },
        { parent_contact: { contains: query.q } },
      ];
    }
    if (query.from || query.to) {
      where.created_at = {
        ...(query.from && { gte: new Date(query.from) }),
        ...(query.to && { lte: new Date(query.to) }),
      };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.soa_applications.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { id: 'desc' },
        include: {
          students: { select: { id: true, student_id_no: true } },
          admission_profile_drafts: {
            select: { saved_categories: true, updated_at: true },
          },
        },
      }),
      this.prisma.soa_applications.count({ where }),
    ]);

    return paginate(rows, total, query);
  }

  /**
   * GET /soa-applications/admitted-cutoff-summary
   * Average cutoff — (Physics + Chemistry) / 2 + Maths — across every
   * application that has actually been admitted. "Admitted" here means a
   * linked `students` row exists, not merely status === 'admission_confirmed'
   * (see PERFECT_ENTRY_ELIGIBLE_STATUS's doc-comment above: some
   * admission_confirmed applications haven't finished Perfect Entry yet and
   * so have no students row). Applications missing any of the three marks
   * are excluded from the average rather than treated as 0, which would
   * silently drag it down.
   */
  async getAdmittedCutoffSummary() {
    const rows = await this.prisma.soa_applications.findMany({
      where: { students: { isNot: null } },
      select: {
        cutoff_physics: true,
        cutoff_chemistry: true,
        cutoff_maths: true,
      },
    });

    const cutoffs = rows
      .filter(
        (r) =>
          r.cutoff_physics !== null &&
          r.cutoff_chemistry !== null &&
          r.cutoff_maths !== null,
      )
      .map(
        (r) =>
          (Number(r.cutoff_physics) + Number(r.cutoff_chemistry)) / 2 +
          Number(r.cutoff_maths),
      );

    const average_cutoff =
      cutoffs.length > 0
        ? Math.round(
            (cutoffs.reduce((sum, c) => sum + c, 0) / cutoffs.length) * 100,
          ) / 100
        : null;

    return {
      average_cutoff,
      admitted_count: rows.length,
      counted_count: cutoffs.length,
    };
  }

  /** GET /soa-applications/:id */
  async findOne(id: number) {
    const row = await this.prisma.soa_applications.findUnique({
      where: { id },
      include: {
        students: { select: { id: true, student_id_no: true } },
        admission_profile_drafts: {
          select: { saved_categories: true, updated_at: true },
        },
      },
    });
    if (!row) {
      throw new NotFoundException({
        message: 'SOA application not found',
        errorCode: 'SOA_APPLICATION_NOT_FOUND',
      });
    }
    return row;
  }

  /**
   * PATCH /soa-applications/:id — corrects the draft's own fields (name,
   * contacts, cutoffs). Locked once the application is admission_confirmed;
   * use the Perfect Entry categories to fix anything from that point on.
   */
  async update(id: number, dto: UpdateSoaApplicationDto) {
    const existing = await this.prisma.soa_applications.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'SOA application not found',
        errorCode: 'SOA_APPLICATION_NOT_FOUND',
      });
    }
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new UnprocessableEntityException({
        message: `Application is ${existing.status} and can no longer be edited`,
        errorCode: 'APPLICATION_NOT_EDITABLE',
      });
    }

    for (const field of CUTOFF_FIELDS) {
      const value = dto[field];
      if (value !== undefined && (value < 0 || value > 100)) {
        throw new UnprocessableEntityException({
          message: `${field} must be between 0 and 100`,
          errorCode: 'INVALID_CUTOFF_RANGE',
        });
      }
    }

    try {
      return await this.prisma.soa_applications.update({
        where: { id },
        data: dto,
      });
    } catch (err) {
      this.logger.error(`Failed to update SOA application #${id}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /soa-applications/:id — hard delete (the table has no soft-delete
   * column). Restricted to untouched drafts: once fees are paid or the
   * application is decided, it stays as a permanent record; use the status
   * endpoint to cancel it instead.
   */
  async remove(id: number) {
    const existing = await this.prisma.soa_applications.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'SOA application not found',
        errorCode: 'SOA_APPLICATION_NOT_FOUND',
      });
    }
    if (existing.status !== soa_status_enum.applied) {
      throw new ConflictException({
        message: `Only applications still in 'applied' status can be deleted — this one is ${existing.status}`,
        errorCode: 'APPLICATION_NOT_DELETABLE',
      });
    }

    await this.prisma.soa_applications.delete({ where: { id } });
    return { id, deleted: true };
  }
}
