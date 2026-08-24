import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import crypto from 'node:crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { paginate } from 'src/common/dto/pagination.dto';
import type {
  faculty_employment_status_enum,
  faculty_employment_type_enum,
} from '../../../../generated/prisma/client';
import { CreateFacultyDto } from './dto/create-faculty.dto';
import { UpdateFacultyDto } from './dto/update-faculty.dto';
import { AdminUpdateFacultyDto } from './dto/admin-update-faculty.dto';
import { ListFacultyQueryDto } from './dto/list-faculty-query.dto';
import type { FacultyExtendedFieldsDto } from './dto/faculty-extended-fields.dto';

/** Characters used for generated temporary passwords — excludes visually ambiguous chars (0/O, 1/l/I). */
const TEMP_PASSWORD_CHARSET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function prismaErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
}

/**
 * Faculty columns added for the admin-role extended profile fields (see
 * FACULTY_MODULE_UPDATE.md). A HOD-role feature is being built concurrently
 * and may add its own columns to faculty-related tables — this list only
 * ever contains the columns admin-role faculty management actually needs;
 * confirm via `npx prisma db pull --print` before adding to it. Declared
 * once so the Prisma `select` and the response-shaping `pick` below can
 * never drift apart.
 */
const EXTENDED_FIELD_KEYS = [
  'profile_url',
  'prefix',
  'gender',
  'date_of_birth',
  'personal_email',
  'whatsapp_number',
  'alternate_phone',
  'address_line',
  'city',
  'state',
  'postal_code',
  'academic_role',
  'employment_status',
  'employment_type',
  'confirmation_date',
  'probation_end_date',
  'work_location',
  'qualification',
  'specialization',
  'previous_institution',
  'previous_experience_years',
  'office_room',
  'is_mentor',
  'phone_verified',
  'whatsapp_verified',
] as const;

const EXTENDED_SELECT_FIELDS = Object.fromEntries(
  EXTENDED_FIELD_KEYS.map((key) => [key, true]),
) as Record<(typeof EXTENDED_FIELD_KEYS)[number], true>;

function pickExtendedFields<T extends Record<string, unknown>>(
  row: T,
): Pick<T, (typeof EXTENDED_FIELD_KEYS)[number]> {
  const result: Record<string, unknown> = {};
  for (const key of EXTENDED_FIELD_KEYS) {
    result[key] = row[key];
  }
  return result as Pick<T, (typeof EXTENDED_FIELD_KEYS)[number]>;
}

@Injectable()
export class FacultyService {
  private readonly logger = new Logger(FacultyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /faculty (Admin only)
   *
   * Creates the users + faculty + (optional) faculty_sensitive_info records
   * in a single transaction. Rolls back entirely if any step fails.
   */
  async create(dto: CreateFacultyDto, actorUserId?: number) {
    const department = await this.prisma.departments.findUnique({
      where: { id: dto.department_id },
    });
    if (!department) {
      throw new NotFoundException('Department not found');
    }

    const existingUser = await this.prisma.users.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException('A user with this email already exists');
    }

    const facultyRole = await this.prisma.roles.findUnique({
      where: { name: ROLES.FACULTY },
    });
    if (!facultyRole) {
      throw new InternalServerErrorException('Faculty role is not configured');
    }

    const temporaryPassword = this.generateTemporaryPassword();
    const passwordHash = this.hashPassword(temporaryPassword);

    let faculty: {
      id: number;
      first_name: string;
      last_name: string;
      designation: string;
      date_of_joining: Date | null;
      status: string;
    };
    try {
      faculty = await this.prisma.$transaction(async (tx) => {
        const user = await tx.users.create({
          data: {
            email: dto.email,
            password_hash: passwordHash,
            phone: dto.phone,
            role_id: facultyRole.id,
            status: 'active',
          },
        });

        const createdFaculty = await tx.faculty.create({
          data: {
            user_id: user.id,
            first_name: dto.first_name,
            last_name: dto.last_name,
            designation: dto.designation,
            department_id: dto.department_id,
            date_of_joining: dto.date_of_joining
              ? new Date(dto.date_of_joining)
              : null,
            status: 'active',
            ...this.extendedFieldsData(dto),
          },
        });

        if (dto.sensitive_info) {
          await tx.faculty_sensitive_info.create({
            data: {
              faculty_id: createdFaculty.id,
              ...dto.sensitive_info,
            },
          });
        }

        await this.logActivity(
          tx,
          createdFaculty.id,
          'Faculty record created',
          actorUserId,
        );

        return createdFaculty;
      });
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2002') {
        throw new ConflictException('A user with this email already exists');
      }
      this.logger.error('Faculty creation transaction failed', err);
      throw new InternalServerErrorException('Failed to create faculty');
    }

    this.logger.log(`Faculty created: id=${faculty.id} email=${dto.email}`);

    return {
      id: faculty.id,
      first_name: faculty.first_name,
      last_name: faculty.last_name,
      designation: faculty.designation,
      department: {
        id: department.id,
        name: department.name,
        code: department.code,
      },
      date_of_joining: faculty.date_of_joining,
      status: faculty.status,
      email: dto.email,
      temporary_password: temporaryPassword,
    };
  }

  /** GET /faculty (Admin/HoD) — paginated list, filterable by department_id, status, designation, joining year, and a name/email search. */
  async findAll(query: ListFacultyQueryDto) {
    const where = {
      department_id: query.department_id,
      status: query.status,
      designation: query.designation,
      employment_status: query.employment_status as
        faculty_employment_status_enum | undefined,
      date_of_joining: query.year
        ? {
            gte: new Date(query.year, 0, 1),
            lt: new Date(query.year + 1, 0, 1),
          }
        : undefined,
      OR: query.search
        ? [
            {
              first_name: {
                contains: query.search,
                mode: 'insensitive' as const,
              },
            },
            {
              last_name: {
                contains: query.search,
                mode: 'insensitive' as const,
              },
            },
            {
              users: {
                email: { contains: query.search, mode: 'insensitive' as const },
              },
            },
            // staff_code is the faculty roll number, which is how HR actually
            // refers to people on paper. It was missing here, so searching by
            // roll number returned nothing.
            {
              staff_code: {
                contains: query.search,
                mode: 'insensitive' as const,
              },
            },
            {
              designation: {
                contains: query.search,
                mode: 'insensitive' as const,
              },
            },
          ]
        : undefined,
    };

    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.faculty.findMany({
          where,
          skip: query.skip,
          take: query.limit,
          orderBy: { id: 'asc' },
          select: {
            id: true,
            prefix: true,
            first_name: true,
            last_name: true,
            designation: true,
            staff_code: true,
            date_of_joining: true,
            status: true,
            profile_url: true,
            departments: { select: { id: true, name: true, code: true } },
            users: { select: { email: true, phone: true } },
          },
        }),
        this.prisma.faculty.count({ where }),
      ],
      // See finance-overview.service.ts getOverview() for why timeout/maxWait
      // are both raised above their defaults.
      { timeout: 20_000, maxWait: 20_000 },
    );

    const data = rows.map((faculty) => ({
      id: faculty.id,
      prefix: faculty.prefix,
      first_name: faculty.first_name,
      last_name: faculty.last_name,
      designation: faculty.designation,
      staff_code: faculty.staff_code,
      department: faculty.departments,
      date_of_joining: faculty.date_of_joining,
      status: faculty.status,
      profile_url: faculty.profile_url,
      email: faculty.users.email,
      phone: faculty.users.phone,
    }));

    return paginate(data, total, query);
  }

  /** GET /faculty/profile — the authenticated faculty's own profile. */
  async getOwnProfile(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: {
        first_name: true,
        last_name: true,
        designation: true,
        date_of_joining: true,
        status: true,
        departments: {
          select: { id: true, name: true, code: true },
        },
        users: { select: { email: true, phone: true } },
      },
    });

    if (!faculty) {
      throw new NotFoundException('Faculty profile not found');
    }

    return {
      first_name: faculty.first_name,
      last_name: faculty.last_name,
      designation: faculty.designation,
      department: faculty.departments,
      date_of_joining: faculty.date_of_joining,
      status: faculty.status,
      email: faculty.users.email,
      phone: faculty.users.phone,
    };
  }

  /** PATCH /faculty/profile — faculty self-service update of editable fields only. */
  async updateOwnProfile(userId: number, dto: UpdateFacultyDto) {
    if (!dto || Object.keys(dto).length === 0) {
      throw new BadRequestException('No fields provided to update');
    }

    try {
      return await this.prisma.faculty.update({
        where: { user_id: userId },
        data: dto,
        select: {
          first_name: true,
          last_name: true,
          designation: true,
          date_of_joining: true,
          status: true,
        },
      });
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2025') {
        throw new NotFoundException('Faculty profile not found');
      }
      throw err;
    }
  }

  /**
   * GET /faculty/:id — Admin/HoD/HR Payroll view.
   *
   * faculty_sensitive_info (Aadhaar/PAN/bank details) is only ever included
   * in the *response* for ADMIN/HR_PAYROLL callers — the same two roles
   * allowed to write it via updateByAdmin() below — even though it's always
   * selected here (selecting it unconditionally keeps this one Prisma call
   * statically typed instead of a role-dependent select shape; the actual
   * access control is enforced below, before anything is returned). HOD
   * shares this endpoint for the rest of the profile but has no legitimate
   * need to see a colleague's bank/Aadhaar details, so callerRole being
   * anything else leaves `sensitive_info` off the response entirely — not
   * masked, not present at all.
   */
  async findOneForAdmin(id: number, callerRole: string) {
    const canSeeSensitiveInfo =
      callerRole === ROLES.ADMIN || callerRole === ROLES.HR_PAYROLL;

    const faculty = await this.prisma.faculty.findUnique({
      where: { id },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        designation: true,
        date_of_joining: true,
        status: true,
        created_at: true,
        departments: {
          select: { id: true, name: true, code: true },
        },
        users: { select: { id: true, email: true, phone: true, status: true } },
        faculty_sensitive_info: {
          select: {
            aadhar_number: true,
            pan_number: true,
            bank_account_number: true,
            bank_ifsc: true,
            bank_name: true,
          },
        },
        ...EXTENDED_SELECT_FIELDS,
      },
    });

    if (!faculty) {
      throw new NotFoundException('Faculty not found');
    }

    return {
      id: faculty.id,
      first_name: faculty.first_name,
      last_name: faculty.last_name,
      designation: faculty.designation,
      department: faculty.departments,
      date_of_joining: faculty.date_of_joining,
      status: faculty.status,
      created_at: faculty.created_at,
      email: faculty.users.email,
      phone: faculty.users.phone,
      ...pickExtendedFields(faculty),
      sensitive_info: canSeeSensitiveInfo
        ? (faculty.faculty_sensitive_info ?? undefined)
        : undefined,
    };
  }

  /**
   * PATCH /faculty/:id (Admin only)
   *
   * Admin-driven edit of any faculty record — distinct from the faculty's own
   * /profile self-update. `status` and `phone` also propagate to the linked
   * `users` row (in the same transaction) so that deactivating a faculty here
   * also blocks their login. `sensitive_info`, if provided, is upserted into
   * faculty_sensitive_info but is never included in the response.
   */
  async updateByAdmin(
    id: number,
    dto: AdminUpdateFacultyDto,
    actorUserId?: number,
  ) {
    if (!dto || Object.keys(dto).length === 0) {
      throw new BadRequestException('No fields provided to update');
    }

    if (dto.department_id !== undefined) {
      const department = await this.prisma.departments.findUnique({
        where: { id: dto.department_id },
      });
      if (!department) {
        throw new NotFoundException('Department not found');
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const faculty = await tx.faculty.update({
          where: { id },
          data: {
            first_name: dto.first_name,
            last_name: dto.last_name,
            designation: dto.designation,
            department_id: dto.department_id,
            date_of_joining: dto.date_of_joining
              ? new Date(dto.date_of_joining)
              : undefined,
            status: dto.status,
            ...this.extendedFieldsData(dto),
          },
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            designation: true,
            date_of_joining: true,
            status: true,
            departments: {
              select: { id: true, name: true, code: true },
            },
          },
        });

        if (dto.phone !== undefined || dto.status !== undefined) {
          await tx.users.update({
            where: { id: faculty.user_id },
            data: {
              phone: dto.phone,
              status: dto.status,
            },
          });
        }

        if (dto.sensitive_info) {
          await tx.faculty_sensitive_info.upsert({
            where: { faculty_id: id },
            create: { faculty_id: id, ...dto.sensitive_info },
            update: { ...dto.sensitive_info },
          });
        }

        await this.logActivity(tx, id, 'Faculty record updated', actorUserId);

        return {
          id,
          first_name: faculty.first_name,
          last_name: faculty.last_name,
          designation: faculty.designation,
          department: faculty.departments,
          date_of_joining: faculty.date_of_joining,
          status: faculty.status,
        };
      });
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2025') {
        throw new NotFoundException('Faculty not found');
      }
      throw err;
    }
  }

  /**
   * DELETE /faculty/:id (Admin only)
   *
   * Soft delete: the schema has no deleted_at/deleted flag, so this sets
   * faculty.status and the linked users.status to 'inactive' together,
   * which also blocks the faculty's login (see AuthService.login).
   */
  async removeByAdmin(id: number, actorUserId?: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { id },
      select: { id: true, user_id: true },
    });

    if (!faculty) {
      throw new NotFoundException('Faculty not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.faculty.update({
        where: { id },
        data: { status: 'inactive' },
      });
      await tx.users.update({
        where: { id: faculty.user_id },
        data: { status: 'inactive' },
      });
      await this.logActivity(tx, id, 'Faculty deactivated', actorUserId);
    });

    this.logger.log(`Faculty soft-deleted: id=${id}`);

    return { id, status: 'inactive' as const };
  }

  /**
   * GET /faculty/:id/activity (Admin/HoD) — most recent audit trail entries.
   * `faculty_activity_log` has been intermittently missing from the live
   * database (see FACULTY_MODULE_UPDATE.md) — returns an empty list rather
   * than a 500 if the table isn't there right now.
   */
  async listActivity(facultyId: number) {
    const exists = await this.prisma.faculty.findUnique({
      where: { id: facultyId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Faculty not found');
    }

    try {
      const rows = await this.prisma.faculty_activity_log.findMany({
        where: { faculty_id: facultyId },
        orderBy: { created_at: 'desc' },
        take: 50,
        select: {
          id: true,
          description: true,
          created_at: true,
          users: { select: { email: true } },
        },
      });

      return rows.map((row) => ({
        id: row.id,
        description: row.description,
        created_at: row.created_at,
        created_by_email: row.users?.email ?? null,
      }));
    } catch (err: unknown) {
      this.logger.warn(`faculty_activity_log unavailable: ${String(err)}`);
      return [];
    }
  }

  /**
   * Best-effort audit-trail write — never lets a missing/unstable
   * faculty_activity_log table fail the create/update/delete it's attached
   * to (see FACULTY_MODULE_UPDATE.md for why this table has been flaky).
   */
  private async logActivity(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    facultyId: number,
    description: string,
    actorUserId?: number,
  ) {
    try {
      await tx.faculty_activity_log.create({
        data: {
          faculty_id: facultyId,
          description,
          created_by_user_id: actorUserId,
        },
      });
    } catch (err: unknown) {
      this.logger.warn(`faculty_activity_log write skipped: ${String(err)}`);
    }
  }

  /**
   * Builds the Prisma `data` fragment for every optional extended field —
   * shared by create() and updateByAdmin() so the two never drift. Fields
   * left undefined on the DTO are simply omitted by Prisma (kept as-is on
   * update; column default/null on create), never overwritten with null.
   */
  private extendedFieldsData(dto: FacultyExtendedFieldsDto) {
    return {
      prefix: dto.prefix,
      gender: dto.gender,
      date_of_birth: dto.date_of_birth
        ? new Date(dto.date_of_birth)
        : undefined,
      personal_email: dto.personal_email,
      whatsapp_number: dto.whatsapp_number,
      alternate_phone: dto.alternate_phone,
      address_line: dto.address_line,
      city: dto.city,
      state: dto.state,
      postal_code: dto.postal_code,
      academic_role: dto.academic_role,
      employment_status: dto.employment_status as
        faculty_employment_status_enum | undefined,
      employment_type: dto.employment_type as
        faculty_employment_type_enum | undefined,
      confirmation_date: dto.confirmation_date
        ? new Date(dto.confirmation_date)
        : undefined,
      probation_end_date: dto.probation_end_date
        ? new Date(dto.probation_end_date)
        : undefined,
      work_location: dto.work_location,
      qualification: dto.qualification,
      specialization: dto.specialization,
      previous_institution: dto.previous_institution,
      previous_experience_years: dto.previous_experience_years,
      office_room: dto.office_room,
      is_mentor: dto.is_mentor,
      phone_verified: dto.phone_verified,
      whatsapp_verified: dto.whatsapp_verified,
    };
  }

  /** Same one-way SHA-256 hashing scheme used by AuthService's login check. */
  private hashPassword(plain: string): string {
    return crypto.createHash('sha256').update(plain).digest('hex');
  }

  private generateTemporaryPassword(): string {
    const bytes = crypto.randomBytes(10);
    let password = '';
    for (const byte of bytes) {
      password += TEMP_PASSWORD_CHARSET[byte % TEMP_PASSWORD_CHARSET.length];
    }
    return `${password}@1`;
  }
}
