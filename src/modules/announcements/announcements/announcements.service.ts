import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { Prisma } from '../../../../generated/prisma/client';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

/**
 * Resolved relationship facts for the current actor, derived once per request.
 * batch_id/department_id on `announcements` are never populated and never
 * read here — announcement_class_mapping is the only recipient source.
 */
interface UserContext {
  role: string;
  userId: number;
  departmentId?: number;
  assignedClassIds?: number[];
  studentClassId?: number | null;
  linkedStudentClassIds?: number[];
}

@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /announcements
   *
   * Creates exactly one `announcements` row and one `announcement_class_mapping`
   * row per selected class, inside a single transaction.
   *
   * Error cases:
   *  400 VALIDATION_ERROR          – class_ids missing/empty (enforced by CreateAnnouncementDto)
   *  403 CLASS_OUTSIDE_DEPARTMENT  – HOD selected a class outside their department
   *  403 CLASS_NOT_ASSIGNED        – Faculty selected a class not assigned to them
   *  403 ROLE_NOT_PERMITTED        – role has no create capability
   *  404 CLASS_NOT_FOUND           – a submitted class_id does not exist
   *  404 HOD_FACULTY_RECORD_NOT_FOUND / FACULTY_RECORD_NOT_FOUND
   *  500 INTERNAL_ERROR
   */
  async create(dto: CreateAnnouncementDto, user: JwtPayload) {
    const context = await this.resolveUserContext(user);
    await this.assertClassesValid(dto.class_ids, context);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const announcement = await tx.announcements.create({
          data: {
            posted_by_user_id: user.sub,
            title: dto.title,
            content: dto.content,
            target_audience: dto.target_audience,
          },
        });

        await tx.announcement_class_mapping.createMany({
          data: dto.class_ids.map((class_id) => ({
            announcement_id: announcement.id,
            class_id,
          })),
        });

        return { ...announcement, class_ids: dto.class_ids };
      });
    } catch (err) {
      this.logger.error('DB error while creating announcement', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /announcements
   */
  async findAll(user: JwtPayload) {
    const context = await this.resolveUserContext(user);
    const where = this.buildVisibilityQuery(context);

    let announcements: Array<{ id: number } & Record<string, unknown>>;

    try {
      announcements = await this.prisma.announcements.findMany({
        where,
        include: { announcement_class_mapping: { select: { class_id: true } } },
        orderBy: { created_at: 'desc' },
      });
    } catch (err) {
      this.logger.error('DB error while fetching announcements', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    return announcements.map((announcement) =>
      this.toResponseShape(announcement),
    );
  }

  /**
   * GET /announcements/:id
   *
   * A row that exists but fails the visibility predicate returns the same
   * 404 as a row that does not exist, to avoid leaking existence.
   *
   * Error cases:
   *  404 ANNOUNCEMENT_NOT_FOUND
   */
  async findOne(id: number, user: JwtPayload) {
    const context = await this.resolveUserContext(user);
    const where = this.buildVisibilityQuery(context);

    let announcement: ({ id: number } & Record<string, unknown>) | null;

    try {
      announcement = await this.prisma.announcements.findFirst({
        where: { AND: [{ id }, where] },
        include: { announcement_class_mapping: { select: { class_id: true } } },
      });
    } catch (err) {
      this.logger.error('DB error during announcement lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!announcement) {
      throw new NotFoundException({
        message: 'Announcement not found',
        errorCode: 'ANNOUNCEMENT_NOT_FOUND',
      });
    }

    return this.toResponseShape(announcement);
  }

  /**
   * PUT/PATCH /announcements/:id
   *
   * The announcement row itself is never recreated. Scalar fields update the
   * row directly; a supplied class_ids array synchronizes
   * announcement_class_mapping (delete removed, insert added, keep unchanged).
   *
   * A row that does not exist and a row that is not visible to this caller
   * (see findVisibleById) both produce the same 404 — existence is never
   * leaked for rows outside the caller's visibility. Only a row that IS
   * visible but not owned by the caller yields 403 NOT_OWNER.
   *
   * Error cases:
   *  403 NOT_OWNER / CLASS_OUTSIDE_DEPARTMENT / CLASS_NOT_ASSIGNED / ROLE_NOT_PERMITTED
   *  404 ANNOUNCEMENT_NOT_FOUND / CLASS_NOT_FOUND
   *  500 INTERNAL_ERROR
   */
  async update(id: number, dto: UpdateAnnouncementDto, user: JwtPayload) {
    const context = await this.resolveUserContext(user);
    const existing = await this.findVisibleById(id, context);

    if (!existing) {
      throw new NotFoundException({
        message: 'Announcement not found',
        errorCode: 'ANNOUNCEMENT_NOT_FOUND',
      });
    }

    this.assertOwnership(existing, user, context);

    if (dto.class_ids !== undefined) {
      await this.assertClassesValid(dto.class_ids, context);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (
          dto.title !== undefined ||
          dto.content !== undefined ||
          dto.target_audience !== undefined
        ) {
          await tx.announcements.update({
            where: { id },
            data: {
              title: dto.title,
              content: dto.content,
              target_audience: dto.target_audience,
            },
          });
        }

        let classIds: number[];

        if (dto.class_ids !== undefined) {
          await this.syncClassMapping(tx, id, dto.class_ids);
          classIds = dto.class_ids;
        } else {
          const currentMappings = await tx.announcement_class_mapping.findMany({
            where: { announcement_id: id },
            select: { class_id: true },
          });
          classIds = currentMappings.map((m) => m.class_id);
        }

        const updated = await tx.announcements.findUniqueOrThrow({
          where: { id },
        });
        return { ...updated, class_ids: classIds };
      });
    } catch (err) {
      this.logger.error('DB error while updating announcement', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /announcements/:id
   *
   * announcement_class_mapping rows are removed by the database's
   * onDelete: Cascade on announcement_id — never deleted manually here.
   *
   * A row that does not exist and a row that is not visible to this caller
   * (see findVisibleById) both produce the same 404 — existence is never
   * leaked for rows outside the caller's visibility. Only a row that IS
   * visible but not owned by the caller yields 403 NOT_OWNER.
   *
   * Error cases:
   *  403 NOT_OWNER
   *  404 ANNOUNCEMENT_NOT_FOUND
   *  500 INTERNAL_ERROR
   */
  async remove(id: number, user: JwtPayload) {
    const context = await this.resolveUserContext(user);
    const existing = await this.findVisibleById(id, context);

    if (!existing) {
      throw new NotFoundException({
        message: 'Announcement not found',
        errorCode: 'ANNOUNCEMENT_NOT_FOUND',
      });
    }

    this.assertOwnership(existing, user, context);

    try {
      return await this.prisma.announcements.delete({ where: { id } });
    } catch (err) {
      this.logger.error('DB error while deleting announcement', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  // ── Relationship resolution ──────────────────────────────────────────────

  private async resolveUserContext(user: JwtPayload): Promise<UserContext> {
    switch (user.role) {
      case ROLES.ADMIN:
        return { role: ROLES.ADMIN, userId: user.sub };

      case ROLES.HOD: {
        const faculty = await this.getFacultyByUserId(user.sub);

        if (!faculty) {
          throw new NotFoundException({
            message: 'No faculty record found for this HOD account',
            errorCode: 'HOD_FACULTY_RECORD_NOT_FOUND',
          });
        }

        return {
          role: ROLES.HOD,
          userId: user.sub,
          departmentId: faculty.department_id,
        };
      }

      case ROLES.FACULTY: {
        const faculty = await this.getFacultyByUserId(user.sub);

        if (!faculty) {
          throw new NotFoundException({
            message: 'No faculty record found for this account',
            errorCode: 'FACULTY_RECORD_NOT_FOUND',
          });
        }

        const assignedClassIds = await this.getAssignedClassIds(faculty.id);
        return { role: ROLES.FACULTY, userId: user.sub, assignedClassIds };
      }

      case ROLES.STUDENT: {
        const student = await this.getStudentByUserId(user.sub);

        if (!student) {
          throw new NotFoundException({
            message: 'No student record found for this account',
            errorCode: 'STUDENT_RECORD_NOT_FOUND',
          });
        }

        return {
          role: ROLES.STUDENT,
          userId: user.sub,
          studentClassId: student.class_id,
        };
      }

      case ROLES.PARENT: {
        const linkedStudentClassIds = await this.getLinkedStudentClassIds(
          user.sub,
        );
        return { role: ROLES.PARENT, userId: user.sub, linkedStudentClassIds };
      }

      default:
        return { role: user.role, userId: user.sub };
    }
  }

  // ── Visibility algorithm ─────────────────────────────────────────────────

  private buildVisibilityQuery(
    context: UserContext,
  ): Prisma.announcementsWhereInput {
    switch (context.role) {
      case ROLES.ADMIN:
        return {};

      case ROLES.HOD:
        return {
          OR: [
            { posted_by_user_id: context.userId },
            { users: { roles: { name: ROLES.ADMIN } } },
          ],
        };

      case ROLES.FACULTY: {
        const assignedClassIds = context.assignedClassIds ?? [];

        return {
          OR: [
            { posted_by_user_id: context.userId },
            { users: { roles: { name: ROLES.ADMIN } } },
            {
              AND: [
                { users: { roles: { name: ROLES.HOD } } },
                {
                  announcement_class_mapping: {
                    some: {
                      class_id: {
                        in: assignedClassIds.length ? assignedClassIds : [-1],
                      },
                    },
                  },
                },
              ],
            },
          ],
        };
      }

      case ROLES.STUDENT: {
        const classId = context.studentClassId ?? -1;
        return { announcement_class_mapping: { some: { class_id: classId } } };
      }

      case ROLES.PARENT: {
        const classIds = context.linkedStudentClassIds ?? [];
        return {
          announcement_class_mapping: {
            some: { class_id: { in: classIds.length ? classIds : [-1] } },
          },
        };
      }

      default:
        return { id: -1 };
    }
  }

  // ── Class-set validation (shared by create and update) ──────────────────

  private async assertClassesValid(classIds: number[], context: UserContext) {
    const existing = await this.getClassesByIds(classIds);
    const foundIds = new Set(existing.map((c) => c.id));

    const missing = classIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new NotFoundException({
        message: 'One or more classes were not found',
        errorCode: 'CLASS_NOT_FOUND',
      });
    }

    if (context.role === ROLES.HOD) {
      const outside = existing.filter(
        (c) => c.department_id !== context.departmentId,
      );
      if (outside.length > 0) {
        throw new ForbiddenException({
          message:
            'One or more selected classes do not belong to your department',
          errorCode: 'CLASS_OUTSIDE_DEPARTMENT',
        });
      }
      return;
    }

    if (context.role === ROLES.FACULTY) {
      const assignedClassIds = new Set(context.assignedClassIds ?? []);
      const notAssigned = classIds.filter((id) => !assignedClassIds.has(id));
      if (notAssigned.length > 0) {
        throw new ForbiddenException({
          message: 'One or more selected classes are not assigned to you',
          errorCode: 'CLASS_NOT_ASSIGNED',
        });
      }
      return;
    }

    if (context.role === ROLES.ADMIN) {
      return;
    }

    throw new ForbiddenException({
      message: 'You are not permitted to create or update announcements',
      errorCode: 'ROLE_NOT_PERMITTED',
    });
  }

  // ── Mapping synchronization (update only) ───────────────────────────────

  private async syncClassMapping(
    tx: Prisma.TransactionClient,
    announcementId: number,
    newClassIds: number[],
  ) {
    const currentMappings = await tx.announcement_class_mapping.findMany({
      where: { announcement_id: announcementId },
      select: { class_id: true },
    });

    const currentIds = new Set(currentMappings.map((m) => m.class_id));
    const newIds = new Set(newClassIds);

    const toDelete = [...currentIds].filter((id) => !newIds.has(id));
    const toInsert = [...newIds].filter((id) => !currentIds.has(id));

    if (toDelete.length > 0) {
      await tx.announcement_class_mapping.deleteMany({
        where: { announcement_id: announcementId, class_id: { in: toDelete } },
      });
    }

    if (toInsert.length > 0) {
      await tx.announcement_class_mapping.createMany({
        data: toInsert.map((class_id) => ({
          announcement_id: announcementId,
          class_id,
        })),
      });
    }
  }

  // ── Ownership ─────────────────────────────────────────────────────────────

  private assertOwnership(
    existing: { posted_by_user_id: number },
    user: JwtPayload,
    context: UserContext,
  ) {
    if (
      context.role !== ROLES.ADMIN &&
      existing.posted_by_user_id !== user.sub
    ) {
      throw new ForbiddenException({
        message: 'You may only modify your own announcements',
        errorCode: 'NOT_OWNER',
      });
    }
  }

  // ── Lookup APIs (Admin/HOD/Faculty navigation) ──────────────────────────

  /**
   * GET /announcements/lookup/departments?batch_id=
   * Admin only.
   */
  async lookupDepartmentsForBatch(batchId: number) {
    try {
      const classes = await this.prisma.classes.findMany({
        where: { batch_id: batchId },
        select: { department_id: true },
        distinct: ['department_id'],
      });

      const departmentIds = classes.map((c) => c.department_id);

      if (departmentIds.length === 0) {
        return [];
      }

      return await this.prisma.departments.findMany({
        where: { id: { in: departmentIds } },
      });
    } catch (err) {
      this.logger.error('DB error while resolving departments for batch', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /announcements/lookup/classes?batch_id=&department_id=
   * Admin: department_id is required and used as supplied.
   * HOD: department_id must not be supplied — it is always resolved from the
   * HOD's own department instead.
   */
  async lookupClasses(
    batchId: number,
    departmentId: number | undefined,
    user: JwtPayload,
  ) {
    const context = await this.resolveUserContext(user);

    let effectiveDepartmentId: number;

    if (context.role === ROLES.HOD) {
      if (context.departmentId === undefined) {
        throw new InternalServerErrorException({
          message: 'Something went wrong. Please try again.',
          errorCode: 'INTERNAL_ERROR',
        });
      }
      effectiveDepartmentId = context.departmentId;
    } else {
      if (departmentId === undefined) {
        throw new BadRequestException({
          message: 'department_id is required',
          errorCode: 'DEPARTMENT_ID_REQUIRED',
        });
      }
      effectiveDepartmentId = departmentId;
    }

    try {
      return await this.prisma.classes.findMany({
        where: { batch_id: batchId, department_id: effectiveDepartmentId },
      });
    } catch (err) {
      this.logger.error(
        'DB error while resolving classes for batch/department',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /announcements/lookup/assigned-classes
   * Faculty only.
   */
  async lookupAssignedClasses(user: JwtPayload) {
    const context = await this.resolveUserContext(user);
    const classIds = context.assignedClassIds ?? [];

    if (classIds.length === 0) {
      return [];
    }

    try {
      return await this.prisma.classes.findMany({
        where: { id: { in: classIds } },
      });
    } catch (err) {
      this.logger.error('DB error while resolving assigned classes', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  // ── Data-access helpers ──────────────────────────────────────────────────

  private async getFacultyByUserId(userId: number) {
    try {
      return await this.prisma.faculty.findUnique({
        where: { user_id: userId },
        select: { id: true, department_id: true },
      });
    } catch (err) {
      this.logger.error('DB error during faculty lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async getStudentByUserId(userId: number) {
    try {
      return await this.prisma.students.findUnique({
        where: { user_id: userId },
        select: { class_id: true },
      });
    } catch (err) {
      this.logger.error('DB error during student lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async getLinkedStudentClassIds(
    parentUserId: number,
  ): Promise<number[]> {
    try {
      const links = await this.prisma.parent_student_mapping.findMany({
        where: { parent_user_id: parentUserId },
        select: { students: { select: { class_id: true } } },
      });

      const classIds = links
        .map((link) => link.students.class_id)
        .filter((classId): classId is number => classId !== null);

      return [...new Set(classIds)];
    } catch (err) {
      this.logger.error('DB error while resolving linked student classes', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async getAssignedClassIds(facultyId: number): Promise<number[]> {
    try {
      const [subjectMappings, mentorMappings] = await Promise.all([
        this.prisma.faculty_subject_class_mapping.findMany({
          where: { faculty_id: facultyId },
          select: { class_id: true },
        }),
        this.prisma.class_mentors.findMany({
          where: { faculty_id: facultyId },
          select: { class_id: true },
        }),
      ]);

      const classIds = [...subjectMappings, ...mentorMappings].map(
        (row) => row.class_id,
      );
      return [...new Set(classIds)];
    } catch (err) {
      this.logger.error('DB error while resolving assigned classes', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async getClassesByIds(classIds: number[]) {
    try {
      return await this.prisma.classes.findMany({
        where: { id: { in: classIds } },
        select: { id: true, department_id: true },
      });
    } catch (err) {
      this.logger.error('DB error during class lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Fetches an announcement scoped by the caller's visibility predicate, so a
   * row that exists but is not visible to this caller is indistinguishable
   * from a row that does not exist at all — avoids leaking existence.
   */
  private async findVisibleById(id: number, context: UserContext) {
    const where = this.buildVisibilityQuery(context);

    try {
      return await this.prisma.announcements.findFirst({
        where: { AND: [{ id }, where] },
      });
    } catch (err) {
      this.logger.error('DB error during announcement lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private toResponseShape(
    announcement: { id: number } & Record<string, unknown>,
  ) {
    const mappings = (announcement.announcement_class_mapping ?? []) as {
      class_id: number;
    }[];
    const { announcement_class_mapping, ...rest } = announcement;
    return { ...rest, class_ids: mappings.map((m) => m.class_id) };
  }
}
