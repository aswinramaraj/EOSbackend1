import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuditLogService } from 'src/common/audit-log/audit-log.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { AssignHodDto } from './dto/assign-hod.dto';

function prismaErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
}

const HOD_SELECT = {
  id: true,
  first_name: true,
  last_name: true,
  designation: true,
} as const;

@Injectable()
export class DepartmentsService {
  private readonly logger = new Logger(DepartmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * POST /departments
   *
   * Error cases:
   *  409 DEPARTMENT_CODE_EXISTS – code already in use
   *  500 INTERNAL_ERROR         – unexpected DB failure
   */
  async create(
    createDepartmentDto: CreateDepartmentDto,
    performedByUserId: number,
  ) {
    const existing = await this.prisma.departments.findUnique({
      where: {
        code: createDepartmentDto.code,
      },
    });

    if (existing) {
      throw new ConflictException({
        message: 'Department code already exists',
        errorCode: 'DEPARTMENT_CODE_EXISTS',
      });
    }

    let created: Awaited<ReturnType<typeof this.prisma.departments.create>>;
    try {
      created = await this.prisma.departments.create({
        data: {
          name: createDepartmentDto.name,
          code: createDepartmentDto.code,
        },
      });
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2002') {
        throw new ConflictException({
          message: 'Department code already exists',
          errorCode: 'DEPARTMENT_CODE_EXISTS',
        });
      }

      this.logger.error('DB error while creating department', err);

      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    await this.auditLog.record({
      entityType: 'department',
      entityId: created.id,
      action: 'department_created',
      performedByUserId,
      newValue: { name: created.name, code: created.code },
    });

    return created;
  }

  async findAll() {
    return this.prisma.departments.findMany({
      include: {
        faculty_departments_head_of_department_faculty_idTofaculty: {
          select: HOD_SELECT,
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number) {
    const department = await this.prisma.departments.findUnique({
      where: { id },
      include: {
        faculty_departments_head_of_department_faculty_idTofaculty: {
          select: HOD_SELECT,
        },
      },
    });

    if (!department) {
      throw new NotFoundException({
        message: 'Department not found',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }

    return department;
  }

  /**
   * PATCH /departments/:id
   *
   * Error cases:
   *  404 DEPARTMENT_NOT_FOUND  – id doesn't exist
   *  409 DEPARTMENT_CODE_EXISTS – code already belongs to another department
   *  500 INTERNAL_ERROR        – unexpected DB failure
   */
  async update(
    id: number,
    updateDepartmentDto: UpdateDepartmentDto,
    performedByUserId: number,
  ) {
    const existing = await this.prisma.departments.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Department not found',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }

    if (
      updateDepartmentDto.code &&
      updateDepartmentDto.code !== existing.code
    ) {
      const duplicate = await this.prisma.departments.findUnique({
        where: { code: updateDepartmentDto.code },
      });
      if (duplicate) {
        throw new ConflictException({
          message: 'Department code already exists',
          errorCode: 'DEPARTMENT_CODE_EXISTS',
        });
      }
    }

    try {
      await this.prisma.departments.update({
        where: { id },
        data: {
          name: updateDepartmentDto.name,
          code: updateDepartmentDto.code,
        },
      });
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2002') {
        throw new ConflictException({
          message: 'Department code already exists',
          errorCode: 'DEPARTMENT_CODE_EXISTS',
        });
      }

      this.logger.error(`DB error while updating department #${id}`, err);

      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    await this.auditLog.record({
      entityType: 'department',
      entityId: id,
      action: 'department_updated',
      performedByUserId,
      oldValue: { name: existing.name, code: existing.code },
      newValue: {
        name: updateDepartmentDto.name,
        code: updateDepartmentDto.code,
      },
    });

    return this.findOne(id);
  }

  /**
   * DELETE /departments/:id
   *
   * Blocked (409 DEPARTMENT_IN_USE) if any course or class still references
   * this department — mirrors the real onDelete: NoAction foreign keys, but
   * reports exactly what's blocking it (course/class counts) rather than a
   * generic DB error, so the UI can show it before the click even happens.
   */
  async remove(id: number, performedByUserId: number) {
    const existing = await this.prisma.departments.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Department not found',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }

    const [courseCount, classCount] = await Promise.all([
      this.prisma.courses.count({ where: { department_id: id } }),
      this.prisma.classes.count({ where: { department_id: id } }),
    ]);

    if (courseCount > 0 || classCount > 0) {
      throw new ConflictException({
        message: `Cannot delete — still in use by ${courseCount} course(s) and ${classCount} class(es). Remove those first.`,
        errorCode: 'DEPARTMENT_IN_USE',
        details: { courses: courseCount, classes: classCount },
      });
    }

    try {
      await this.prisma.departments.delete({ where: { id } });
      await this.auditLog.record({
        entityType: 'department',
        entityId: id,
        action: 'department_deleted',
        performedByUserId,
        oldValue: { name: existing.name, code: existing.code },
      });
      return { message: 'Department deleted successfully' };
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2003') {
        throw new ConflictException({
          message:
            'Department cannot be deleted while other records reference it',
          errorCode: 'DEPARTMENT_IN_USE',
        });
      }

      this.logger.error(`DB error while deleting department #${id}`, err);

      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PATCH /departments/:id/hod — Admin-scoped equivalent of the Principal
   * module's own /me/principal/departments/:id/hod (same validation), kept
   * as a separate implementation rather than widening that controller's
   * @Roles(PRINCIPAL) guard, since that controller's other routes are
   * Principal-only dashboard rollups this module has no business exposing.
   * Also reachable from Academic Coordinator's Structure page
   * (HodPickerDialog.tsx), so this is a real, live third entry point into
   * HoD appointment, not just Admin.
   *
   * Keeps `users.role_id` in sync with this appointment (promotes the
   * incoming HoD, reverts the outgoing one to faculty) and writes an
   * audit_logs row — this sibling implementation previously did neither,
   * which is the exact bug PrincipalDepartmentsService.assignHod() was
   * fixed for; same fix, same reasoning, mirrored here since Prisma has no
   * single shared base class between these two otherwise-identical methods
   * to fix it in just once.
   */
  async assignHod(id: number, dto: AssignHodDto, performedByUserId: number) {
    const department = await this.prisma.departments.findUnique({
      where: { id },
    });
    if (!department) {
      throw new NotFoundException({
        message: 'Department not found',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }

    let newHodUserId: number | null = null;
    if (dto.faculty_id != null) {
      const faculty = await this.prisma.faculty.findUnique({
        where: { id: dto.faculty_id },
      });
      if (!faculty) {
        throw new NotFoundException({
          message: 'Faculty not found',
          errorCode: 'FACULTY_NOT_FOUND',
        });
      }
      if (faculty.department_id !== id) {
        throw new BadRequestException({
          message: 'The Head of Department must belong to this department',
          errorCode: 'FACULTY_WRONG_DEPARTMENT',
        });
      }
      newHodUserId = faculty.user_id;
    }

    const previousHodFacultyId = department.head_of_department_faculty_id;
    const hasChange = previousHodFacultyId !== dto.faculty_id;

    let previousHodUserId: number | null = null;
    if (hasChange && previousHodFacultyId != null) {
      const previousHod = await this.prisma.faculty.findUnique({
        where: { id: previousHodFacultyId },
        select: { user_id: true },
      });
      previousHodUserId = previousHod?.user_id ?? null;
    }

    if (hasChange) {
      await this.prisma.$transaction(async (tx) => {
        await tx.departments.update({
          where: { id },
          data: { head_of_department_faculty_id: dto.faculty_id },
        });

        if (newHodUserId != null) {
          const hodRole = await tx.roles.findUniqueOrThrow({
            where: { name: ROLES.HOD },
          });
          await tx.users.update({
            where: { id: newHodUserId },
            data: { role_id: hodRole.id },
          });
        }
        if (previousHodUserId != null) {
          const facultyRole = await tx.roles.findUniqueOrThrow({
            where: { name: ROLES.FACULTY },
          });
          await tx.users.update({
            where: { id: previousHodUserId },
            data: { role_id: facultyRole.id },
          });
        }
      });

      await this.auditLog.record({
        entityType: 'department_hod',
        entityId: id,
        action:
          dto.faculty_id == null
            ? 'hod_cleared'
            : previousHodFacultyId == null
              ? 'hod_assigned'
              : 'hod_changed',
        performedByUserId,
        oldValue: { faculty_id: previousHodFacultyId },
        newValue: { faculty_id: dto.faculty_id },
        reason: dto.reason,
      });
    }

    return this.findOne(id);
  }
}
