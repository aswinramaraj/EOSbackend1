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
import { AuditLogService } from 'src/common/audit-log/audit-log.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { paginate } from 'src/common/dto/pagination.dto';
import {
  hashPassword,
  generateTemporaryPassword,
} from 'src/common/utils/credentials.util';
import { PROVISIONABLE_STAFF_ROLES } from './constants/provisionable-roles.constant';
import { CreateStaffAccountDto } from './dto/create-staff-account.dto';
import { ListStaffAccountsQueryDto } from './dto/list-staff-accounts-query.dto';
import { ResetStaffAccountPasswordDto } from './dto/reset-staff-account-password.dto';

function prismaErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
}

const ACCOUNT_SELECT = {
  id: true,
  email: true,
  phone: true,
  status: true,
  created_at: true,
  roles: { select: { id: true, name: true, description: true } },
  non_teaching_staff: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      departments: { select: { id: true, name: true, code: true } },
    },
    take: 1,
  },
} as const;

@Injectable()
export class StaffAccountsService {
  private readonly logger = new Logger(StaffAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** GET /staff-accounts/roles — dropdown source: every role this screen can provision, id + name + description. */
  async listProvisionableRoles() {
    const roles = await this.prisma.roles.findMany({
      where: { name: { in: [...PROVISIONABLE_STAFF_ROLES] } },
      select: { id: true, name: true, description: true },
      orderBy: { name: 'asc' },
    });
    return roles;
  }

  /**
   * POST /staff-accounts
   *
   * Error cases:
   *  400 ROLE_NOT_PROVISIONABLE – role isn't one of PROVISIONABLE_STAFF_ROLES
   *  400 DEPARTMENT_REQUIRED    – Secretary without a department_id
   *  404 DEPARTMENT_NOT_FOUND   – department_id doesn't exist
   *  409 EMAIL_EXISTS           – email already registered
   *  500 INTERNAL_ERROR         – unexpected DB failure
   */
  async create(dto: CreateStaffAccountDto, actorUserId: number) {
    const existingUser = await this.prisma.users.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException({
        message: 'A user with this email already exists',
        errorCode: 'EMAIL_EXISTS',
      });
    }

    const role = await this.prisma.roles.findUnique({
      where: { name: dto.role_name },
    });
    if (!role) {
      throw new InternalServerErrorException({
        message: 'Role is not configured',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    const isSecretary = dto.role_name === ROLES.SECRETARY;
    let department: { id: number; name: string; code: string } | null = null;
    if (isSecretary) {
      if (!dto.department_id) {
        throw new BadRequestException({
          message: 'Department is required for a Secretary account',
          errorCode: 'DEPARTMENT_REQUIRED',
        });
      }
      department = await this.prisma.departments.findUnique({
        where: { id: dto.department_id },
      });
      if (!department) {
        throw new NotFoundException({
          message: 'Department not found',
          errorCode: 'DEPARTMENT_NOT_FOUND',
        });
      }
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = hashPassword(temporaryPassword);

    let userId: number;
    try {
      userId = await this.prisma.$transaction(async (tx) => {
        const user = await tx.users.create({
          data: {
            email: dto.email,
            password_hash: passwordHash,
            phone: dto.phone,
            role_id: role.id,
            status: 'active',
          },
        });

        if (isSecretary) {
          await tx.non_teaching_staff.create({
            data: {
              user_id: user.id,
              first_name: dto.first_name!,
              last_name: dto.last_name,
              category: 'other',
              department_id: dto.department_id,
              status: 'active',
            },
          });
        }

        return user.id;
      });
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2002') {
        throw new ConflictException({
          message: 'A user with this email already exists',
          errorCode: 'EMAIL_EXISTS',
        });
      }
      this.logger.error('Staff account creation transaction failed', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    await this.auditLog.record({
      entityType: 'staff_account',
      entityId: userId,
      action: 'staff_account_created',
      performedByUserId: actorUserId,
      newValue: {
        email: dto.email,
        role: dto.role_name,
        department_id: dto.department_id ?? null,
      },
    });

    this.logger.log(
      `Staff account created: id=${userId} email=${dto.email} role=${dto.role_name}`,
    );

    return {
      id: userId,
      email: dto.email,
      phone: dto.phone ?? null,
      role: { id: role.id, name: role.name, description: role.description },
      department,
      first_name: dto.first_name ?? null,
      last_name: dto.last_name ?? null,
      status: 'active' as const,
      temporary_password: temporaryPassword,
    };
  }

  /** GET /staff-accounts — paginated, filterable by role_name/status/search. Always confined to PROVISIONABLE_STAFF_ROLES — Admin/Principal/HoD/Faculty/Student/Parent/Alumni accounts never show up here, they're managed by their own screens. */
  async findAll(query: ListStaffAccountsQueryDto) {
    const roleIds = query.role_name
      ? (
          await this.prisma.roles.findMany({
            where: { name: query.role_name },
            select: { id: true },
          })
        ).map((r) => r.id)
      : (
          await this.prisma.roles.findMany({
            where: { name: { in: [...PROVISIONABLE_STAFF_ROLES] } },
            select: { id: true },
          })
        ).map((r) => r.id);

    const search = query.search?.trim();
    const where = {
      role_id: { in: roleIds },
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' as const } },
              {
                non_teaching_staff: {
                  some: {
                    OR: [
                      {
                        first_name: {
                          contains: search,
                          mode: 'insensitive' as const,
                        },
                      },
                      {
                        last_name: {
                          contains: search,
                          mode: 'insensitive' as const,
                        },
                      },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.users.findMany({
        where,
        select: ACCOUNT_SELECT,
        orderBy: { created_at: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.users.count({ where }),
    ]);

    return paginate(
      data.map((u) => this.toStaffAccountView(u)),
      total,
      query,
    );
  }

  /** PATCH /staff-accounts/:id/status — Admin/HR Payroll. Activate or deactivate a login (soft, reversible — no data is deleted). */
  async updateStatus(
    id: number,
    status: 'active' | 'inactive',
    actorUserId: number,
  ) {
    const user = await this.prisma.users.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        status: true,
        roles: { select: { name: true } },
      },
    });
    if (!user) {
      throw new NotFoundException({
        message: 'Account not found',
        errorCode: 'ACCOUNT_NOT_FOUND',
      });
    }
    if (
      !(PROVISIONABLE_STAFF_ROLES as readonly string[]).includes(
        user.roles.name,
      )
    ) {
      throw new BadRequestException({
        message: 'This account is not managed from this screen',
        errorCode: 'ROLE_NOT_PROVISIONABLE',
      });
    }

    await this.prisma.users.update({ where: { id }, data: { status } });

    await this.auditLog.record({
      entityType: 'staff_account',
      entityId: id,
      action:
        status === 'active'
          ? 'staff_account_activated'
          : 'staff_account_deactivated',
      performedByUserId: actorUserId,
      oldValue: { status: user.status },
      newValue: { status },
    });

    return { id, status };
  }

  /**
   * POST /staff-accounts/:id/reset-password — Admin/HR Payroll. Generates a
   * fresh temporary password and returns it once; the old one stops working
   * immediately. Step-up confirmation required (see ResetStaffAccountPasswordDto)
   * — this overwrites an existing login's credential, unlike account creation.
   */
  async resetPassword(
    id: number,
    dto: ResetStaffAccountPasswordDto,
    actorUserId: number,
  ) {
    const actor = await this.prisma.users.findUnique({
      where: { id: actorUserId },
      select: { password_hash: true },
    });
    if (!actor || hashPassword(dto.adminPassword) !== actor.password_hash) {
      throw new ForbiddenException({
        message: 'Incorrect password',
        errorCode: 'ADMIN_PASSWORD_INCORRECT',
      });
    }

    const user = await this.prisma.users.findUnique({
      where: { id },
      select: { id: true, email: true, roles: { select: { name: true } } },
    });
    if (!user) {
      throw new NotFoundException({
        message: 'Account not found',
        errorCode: 'ACCOUNT_NOT_FOUND',
      });
    }
    if (
      !(PROVISIONABLE_STAFF_ROLES as readonly string[]).includes(
        user.roles.name,
      )
    ) {
      throw new BadRequestException({
        message: 'This account is not managed from this screen',
        errorCode: 'ROLE_NOT_PROVISIONABLE',
      });
    }

    const temporaryPassword = generateTemporaryPassword();
    await this.prisma.users.update({
      where: { id },
      data: { password_hash: hashPassword(temporaryPassword) },
    });

    await this.auditLog.record({
      entityType: 'staff_account',
      entityId: id,
      action: 'staff_account_password_reset',
      performedByUserId: actorUserId,
    });

    return { id, email: user.email, temporary_password: temporaryPassword };
  }

  private toStaffAccountView(user: {
    id: number;
    email: string;
    phone: string | null;
    status: string;
    created_at: Date;
    roles: { id: number; name: string; description: string | null };
    non_teaching_staff: {
      id: number;
      first_name: string;
      last_name: string | null;
      departments: { id: number; name: string; code: string } | null;
    }[];
  }) {
    const staffProfile = user.non_teaching_staff[0] ?? null;
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      status: user.status,
      created_at: user.created_at,
      role: user.roles,
      first_name: staffProfile?.first_name ?? null,
      last_name: staffProfile?.last_name ?? null,
      department: staffProfile?.departments ?? null,
    };
  }
}
