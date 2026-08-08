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
import { ROLES } from 'src/common/constants/roles.constant';
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
import { paginate } from 'src/common/dto/pagination.dto';

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

  constructor(private readonly prisma: PrismaService) {}

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

    // Temp password: same unsalted-SHA-256 scheme as AuthService/seed.ts (see
    // brain/SECURITY.md — a pre-existing, separately-tracked weakness, not
    // something to silently change mid-endpoint). Delivery mechanism to the
    // new student is undefined per the spec's own "Known Limitations" — not
    // returned in this response, so a follow-up (e.g. a reset-link email) is
    // still needed before the account is actually usable.
    const tempPassword = crypto.randomBytes(16).toString('hex');
    const tempPasswordHash = crypto
      .createHash('sha256')
      .update(tempPassword)
      .digest('hex');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.users.create({
          data: {
            email: dto.email,
            password_hash: tempPasswordHash,
            role_id: studentRole.id,
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

        // student_transport_mapping / student_hostel_mapping intentionally
        // NOT inserted — see the deferred-scope note in this method's docblock.

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
    if (query.status) where.status = query.status;
    if (query.q) {
      where.OR = [
        { first_name: { contains: query.q, mode: 'insensitive' } },
        { last_name: { contains: query.q, mode: 'insensitive' } },
        { student_email: { contains: query.q, mode: 'insensitive' } },
        { student_contact: { contains: query.q } },
        { parent_contact: { contains: query.q } },
      ];
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.soa_applications.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { id: 'desc' },
        include: { students: { select: { id: true, student_id_no: true } } },
      }),
      this.prisma.soa_applications.count({ where }),
    ]);

    return paginate(rows, total, query);
  }

  /** GET /soa-applications/:id */
  async findOne(id: number) {
    const row = await this.prisma.soa_applications.findUnique({
      where: { id },
      include: { students: { select: { id: true, student_id_no: true } } },
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
