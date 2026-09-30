import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuditLogService } from 'src/common/audit-log/audit-log.service';
import { ROLES } from 'src/common/constants/roles.constant';
import {
  hashPassword,
  generateTemporaryPassword,
} from 'src/common/utils/credentials.util';
import { CreateParentAccountDto } from './dto/create-parent-account.dto';
import { LinkParentAccountDto } from './dto/link-parent-account.dto';

function prismaErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
}

const MAPPING_SELECT = {
  relationship: true,
  users: { select: { id: true, email: true, phone: true, status: true } },
} as const;

/**
 * The write path `parents.service.ts` (Parent self-service, /me/children/*)
 * never had — that module only reads an already-existing
 * parent_student_mapping, it never creates one. `users` itself has no name
 * column at all (email/phone/role/status only — see schema.prisma), so
 * display names for parent rows come from the caller's own UI joining
 * against the student's family_details (father_name/mother_name), not from
 * anything stored against the login itself.
 */
@Injectable()
export class ParentAccountsService {
  private readonly logger = new Logger(ParentAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** GET /students/:id/parents */
  async listForStudent(studentId: number) {
    await this.assertStudentExists(studentId);
    const rows = await this.prisma.parent_student_mapping.findMany({
      where: { student_id: studentId },
      select: MAPPING_SELECT,
    });
    return rows.map((r) => ({
      id: r.users.id,
      email: r.users.email,
      phone: r.users.phone,
      status: r.users.status,
      relationship: r.relationship,
    }));
  }

  /**
   * POST /students/:id/parents — creates a brand-new parent login and links
   * it to this student in one transaction, same shape as
   * StaffAccountsService.create() (temporary password generated and
   * returned once, never stored in plain text or logged).
   */
  async create(
    studentId: number,
    dto: CreateParentAccountDto,
    actorUserId: number,
  ) {
    await this.assertStudentExists(studentId);

    const existingUser = await this.prisma.users.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException({
        message:
          'A user with this email already exists — use "Link existing parent" instead',
        errorCode: 'EMAIL_EXISTS',
      });
    }

    const role = await this.prisma.roles.findUniqueOrThrow({
      where: { name: ROLES.PARENT },
    });
    const temporaryPassword = generateTemporaryPassword();

    let parentUserId: number;
    try {
      parentUserId = await this.prisma.$transaction(async (tx) => {
        const user = await tx.users.create({
          data: {
            email: dto.email,
            password_hash: hashPassword(temporaryPassword),
            phone: dto.phone,
            role_id: role.id,
            status: 'active',
          },
        });
        await tx.parent_student_mapping.create({
          data: {
            parent_user_id: user.id,
            student_id: studentId,
            relationship: dto.relationship,
          },
        });
        return user.id;
      });
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2002') {
        throw new ConflictException({
          message: 'A user with this email already exists',
          errorCode: 'EMAIL_EXISTS',
        });
      }
      this.logger.error('Parent account creation transaction failed', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    await this.auditLog.record({
      entityType: 'parent_account',
      entityId: parentUserId,
      action: 'parent_account_created',
      performedByUserId: actorUserId,
      newValue: {
        student_id: studentId,
        email: dto.email,
        relationship: dto.relationship,
      },
    });

    return {
      id: parentUserId,
      email: dto.email,
      phone: dto.phone ?? null,
      relationship: dto.relationship,
      status: 'active' as const,
      temporary_password: temporaryPassword,
    };
  }

  /**
   * POST /students/:id/parents/link — an existing parent login (found via
   * the search below, typically the sibling's parent) gains an additional
   * child. No new `users` row.
   */
  async link(studentId: number, dto: LinkParentAccountDto, actorUserId: number) {
    await this.assertStudentExists(studentId);

    const parent = await this.prisma.users.findUnique({
      where: { id: dto.parent_user_id },
      select: { id: true, roles: { select: { name: true } } },
    });
    if (!parent || parent.roles.name !== ROLES.PARENT) {
      throw new NotFoundException({
        message: 'Parent account not found',
        errorCode: 'PARENT_NOT_FOUND',
      });
    }

    const existing = await this.prisma.parent_student_mapping.findUnique({
      where: {
        parent_user_id_student_id: {
          parent_user_id: dto.parent_user_id,
          student_id: studentId,
        },
      },
    });
    if (existing) {
      throw new ConflictException({
        message: 'This parent is already linked to this student',
        errorCode: 'MAPPING_EXISTS',
      });
    }

    await this.prisma.parent_student_mapping.create({
      data: {
        parent_user_id: dto.parent_user_id,
        student_id: studentId,
        relationship: dto.relationship,
      },
    });

    await this.auditLog.record({
      entityType: 'parent_account',
      entityId: dto.parent_user_id,
      action: 'parent_linked',
      performedByUserId: actorUserId,
      newValue: { student_id: studentId, relationship: dto.relationship },
    });

    return { id: dto.parent_user_id, student_id: studentId, relationship: dto.relationship };
  }

  /** DELETE /students/:id/parents/:parentUserId — unlinks only; the login itself survives (it may still be mapped to other children). */
  async unlink(studentId: number, parentUserId: number, actorUserId: number) {
    const existing = await this.prisma.parent_student_mapping.findUnique({
      where: {
        parent_user_id_student_id: {
          parent_user_id: parentUserId,
          student_id: studentId,
        },
      },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'This parent is not linked to this student',
        errorCode: 'MAPPING_NOT_FOUND',
      });
    }

    await this.prisma.parent_student_mapping.delete({
      where: {
        parent_user_id_student_id: {
          parent_user_id: parentUserId,
          student_id: studentId,
        },
      },
    });

    await this.auditLog.record({
      entityType: 'parent_account',
      entityId: parentUserId,
      action: 'parent_unlinked',
      performedByUserId: actorUserId,
      oldValue: { student_id: studentId, relationship: existing.relationship },
    });

    return { message: 'Parent unlinked' };
  }

  /**
   * GET /parents/search?q= — powers the "Link existing parent" picker.
   * `users` has no name column, so matching is by the parent's own email or
   * by any already-linked child's name/roll/student id no (finding a
   * sibling's parent without knowing their exact email).
   */
  async search(q: string | undefined) {
    const term = q?.trim();
    const rows = await this.prisma.users.findMany({
      where: {
        roles: { name: ROLES.PARENT },
        ...(term
          ? {
              OR: [
                { email: { contains: term, mode: 'insensitive' as const } },
                {
                  parent_student_mapping: {
                    some: {
                      students: {
                        OR: [
                          { roll_no: { contains: term, mode: 'insensitive' as const } },
                          { student_id_no: { contains: term, mode: 'insensitive' as const } },
                          {
                            soa_applications: {
                              OR: [
                                { first_name: { contains: term, mode: 'insensitive' as const } },
                                { last_name: { contains: term, mode: 'insensitive' as const } },
                              ],
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        email: true,
        phone: true,
        parent_student_mapping: {
          select: {
            relationship: true,
            students: {
              select: {
                id: true,
                roll_no: true,
                student_id_no: true,
                soa_applications: { select: { first_name: true, last_name: true } },
              },
            },
          },
        },
      },
      take: 20,
      orderBy: { id: 'desc' },
    });

    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      phone: u.phone,
      children: u.parent_student_mapping.map((m) => ({
        student_id: m.students.id,
        roll_no: m.students.roll_no,
        student_id_no: m.students.student_id_no,
        name: m.students.soa_applications
          ? [m.students.soa_applications.first_name, m.students.soa_applications.last_name]
              .filter(Boolean)
              .join(' ')
          : null,
        relationship: m.relationship,
      })),
    }));
  }

  private async assertStudentExists(studentId: number) {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }
  }
}
