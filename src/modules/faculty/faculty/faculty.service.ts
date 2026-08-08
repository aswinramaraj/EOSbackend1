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
import { CreateFacultyDto } from './dto/create-faculty.dto';
import { UpdateFacultyDto } from './dto/update-faculty.dto';
import { AdminUpdateFacultyDto } from './dto/admin-update-faculty.dto';
import { ListFacultyQueryDto } from './dto/list-faculty-query.dto';

/** Characters used for generated temporary passwords — excludes visually ambiguous chars (0/O, 1/l/I). */
const TEMP_PASSWORD_CHARSET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function prismaErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
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
  async create(dto: CreateFacultyDto) {
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

  /** GET /faculty (Admin/HoD) — paginated list, filterable by department_id and status. */
  async findAll(query: ListFacultyQueryDto) {
    const where = {
      department_id: query.department_id,
      status: query.status,
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
            first_name: true,
            last_name: true,
            designation: true,
            date_of_joining: true,
            status: true,
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
      first_name: faculty.first_name,
      last_name: faculty.last_name,
      designation: faculty.designation,
      department: faculty.departments,
      date_of_joining: faculty.date_of_joining,
      status: faculty.status,
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
        departments: { select: { id: true, name: true, code: true } },
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

  /** GET /faculty/:id — Admin/HoD view. Excludes faculty_sensitive_info entirely. */
  async findOneForAdmin(id: number) {
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
        departments: { select: { id: true, name: true, code: true } },
        users: { select: { id: true, email: true, phone: true, status: true } },
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
  async updateByAdmin(id: number, dto: AdminUpdateFacultyDto) {
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
          },
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            designation: true,
            date_of_joining: true,
            status: true,
            departments: { select: { id: true, name: true, code: true } },
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
  async removeByAdmin(id: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { id },
      select: { id: true, user_id: true },
    });

    if (!faculty) {
      throw new NotFoundException('Faculty not found');
    }

    await this.prisma.$transaction([
      this.prisma.faculty.update({
        where: { id },
        data: { status: 'inactive' },
      }),
      this.prisma.users.update({
        where: { id: faculty.user_id },
        data: { status: 'inactive' },
      }),
    ]);

    this.logger.log(`Faculty soft-deleted: id=${id}`);

    return { id, status: 'inactive' as const };
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
