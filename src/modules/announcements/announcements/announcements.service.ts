import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/common/storage/storage.service';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { Prisma, announcement_status_enum } from '../../../../generated/prisma/client';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * POST /announcements/attachments (Admin/HOD/Faculty).
   * Pure storage passthrough — never touches the announcements table.
   * `key` is what the caller then sends back as `file_key` on
   * create()/update() once that column exists.
   */
  async uploadAttachment(file: Express.Multer.File) {
    const { key } = await this.storage.upload(
      'announcements',
      file.originalname,
      file.buffer,
      file.mimetype,
    );
    const url = this.storage.getPublicUrl(key);
    return { file_key: key, file_name: file.originalname, url };
  }

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
    const status = dto.status ?? 'published';

    // A draft is a private scratchpad, visible only to its author (see
    // buildVisibilityQuery) - it skips every targeting requirement below
    // entirely. If class_ids happen to already be picked (continuing a
    // partially-filled draft), they're still validated normally; nothing
    // else is required.
    if (status === 'draft') {
      if (dto.class_ids !== undefined) {
        await this.assertClassesValid(dto.class_ids, context);
      }

      try {
        return await this.prisma.$transaction(async (tx) => {
          const announcement = await tx.announcements.create({
            data: {
              posted_by_user_id: user.sub,
              title: dto.title,
              content: dto.content,
              // NOT NULL column - a draft with no audience chosen yet gets
              // a placeholder that means nothing until actually published.
              target_audience: dto.target_audience ?? 'students',
              status,
              file_key: dto.file_key,
              file_name: dto.file_name,
            },
          });

          if (dto.class_ids && dto.class_ids.length > 0) {
            await tx.announcement_class_mapping.createMany({
              data: dto.class_ids.map((class_id) => ({
                announcement_id: announcement.id,
                class_id,
              })),
            });
          }

          return this.toResponseShape({
            ...announcement,
            announcement_class_mapping: (dto.class_ids ?? []).map((class_id) => ({ class_id })),
          });
        });
      } catch (err) {
        this.logger.error('DB error while creating draft announcement', err);
        throw new InternalServerErrorException({
          message: 'Something went wrong. Please try again.',
          errorCode: 'INTERNAL_ERROR',
        });
      }
    }

    // 'teachers' is a department-wide faculty broadcast (department_id),
    // never a class broadcast (announcement_class_mapping) - the two are
    // mutually exclusive branches, matching the DTO's own ValidateIf split.
    if (dto.target_audience === 'teachers') {
      const departmentId = await this.resolveTeacherTargetDepartment(
        dto.department_id,
        context,
      );

      try {
        const announcement = await this.prisma.announcements.create({
          data: {
            posted_by_user_id: user.sub,
            title: dto.title,
            content: dto.content,
            target_audience: dto.target_audience,
            department_id: departmentId,
            status,
            file_key: dto.file_key,
            file_name: dto.file_name,
          },
        });
        return this.toResponseShape({ ...announcement, announcement_class_mapping: [] });
      } catch (err) {
        this.logger.error('DB error while creating announcement', err);
        throw new InternalServerErrorException({
          message: 'Something went wrong. Please try again.',
          errorCode: 'INTERNAL_ERROR',
        });
      }
    }

    await this.assertClassesValid(dto.class_ids!, context);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const announcement = await tx.announcements.create({
          data: {
            posted_by_user_id: user.sub,
            title: dto.title,
            content: dto.content,
            target_audience: dto.target_audience!,
            status,
            file_key: dto.file_key,
            file_name: dto.file_name,
          },
        });

        await tx.announcement_class_mapping.createMany({
          data: dto.class_ids!.map((class_id) => ({
            announcement_id: announcement.id,
            class_id,
          })),
        });

        return this.toResponseShape({
          ...announcement,
          announcement_class_mapping: dto.class_ids!.map((class_id) => ({ class_id })),
        });
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
   * Resolves the single department_id a 'teachers'-audience announcement
   * broadcasts to (null = every faculty account, any department).
   * HOD is hard-restricted to their own department - unlike class
   * targeting (assertClassesValid), a mismatched request is rejected
   * outright rather than silently corrected, since silently redirecting a
   * broadcast to a different department than the one requested would be
   * far more surprising than refusing it.
   */
  private async resolveTeacherTargetDepartment(
    requestedDepartmentId: number | undefined,
    context: UserContext,
  ): Promise<number | null> {
    if (context.role === ROLES.HOD) {
      if (context.departmentId === undefined) {
        throw new InternalServerErrorException({
          message: 'Something went wrong. Please try again.',
          errorCode: 'INTERNAL_ERROR',
        });
      }
      if (
        requestedDepartmentId !== undefined &&
        requestedDepartmentId !== context.departmentId
      ) {
        throw new ForbiddenException({
          message: 'You may only post faculty announcements to your own department',
          errorCode: 'DEPARTMENT_OUTSIDE_SCOPE',
        });
      }
      return context.departmentId;
    }

    if (context.role === ROLES.ADMIN) {
      if (requestedDepartmentId === undefined) {
        return null;
      }
      const department = await this.prisma.departments.findUnique({
        where: { id: requestedDepartmentId },
      });
      if (!department) {
        throw new NotFoundException({
          message: 'Department not found',
          errorCode: 'DEPARTMENT_NOT_FOUND',
        });
      }
      return department.id;
    }

    throw new ForbiddenException({
      message: 'You are not permitted to post announcements to faculty',
      errorCode: 'ROLE_NOT_PERMITTED',
    });
  }

  /**
   * GET /announcements?status=
   */
  async findAll(user: JwtPayload, status?: announcement_status_enum) {
    const context = await this.resolveUserContext(user);
    const visibility = this.buildVisibilityQuery(context);
    const where: Prisma.announcementsWhereInput = status
      ? { AND: [visibility, { status }] }
      : visibility;

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

    const existingStatus = existing.status as announcement_status_enum;
    const resultStatus = dto.status ?? existingStatus;

    // Whenever target_audience is explicitly supplied — most importantly
    // when publishing a draft that never had one — re-run the exact same
    // targeting rules create() enforces. Switching audience away from
    // 'teachers' drops any stale department_id from a previous save.
    let resolvedDepartmentId: number | null | undefined;
    if (dto.target_audience !== undefined) {
      resolvedDepartmentId =
        dto.target_audience === 'teachers'
          ? await this.resolveTeacherTargetDepartment(dto.department_id, context)
          : null;
    }

    if (
      resultStatus === 'published' &&
      existingStatus === 'draft' &&
      dto.target_audience === undefined
    ) {
      throw new BadRequestException({
        message: 'target_audience is required to publish this draft',
        errorCode: 'TARGET_AUDIENCE_REQUIRED',
      });
    }

    const effectiveTargetAudience = dto.target_audience ?? existing.target_audience;

    if (dto.class_ids !== undefined) {
      await this.assertClassesValid(dto.class_ids, context);
    } else if (
      resultStatus === 'published' &&
      existingStatus === 'draft' &&
      effectiveTargetAudience !== 'teachers'
    ) {
      const currentMappingCount = await this.prisma.announcement_class_mapping.count({
        where: { announcement_id: id },
      });
      if (currentMappingCount === 0) {
        throw new BadRequestException({
          message: 'class_ids is required to publish this draft',
          errorCode: 'CLASS_IDS_REQUIRED',
        });
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (
          dto.title !== undefined ||
          dto.content !== undefined ||
          dto.target_audience !== undefined ||
          dto.status !== undefined ||
          dto.file_key !== undefined ||
          dto.file_name !== undefined ||
          resolvedDepartmentId !== undefined
        ) {
          await tx.announcements.update({
            where: { id },
            data: {
              title: dto.title,
              content: dto.content,
              target_audience: dto.target_audience,
              status: dto.status,
              department_id: resolvedDepartmentId,
              file_key: dto.file_key,
              file_name: dto.file_name,
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
        return this.toResponseShape({
          ...updated,
          announcement_class_mapping: classIds.map((class_id) => ({ class_id })),
        });
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
        return {
          role: ROLES.FACULTY,
          userId: user.sub,
          assignedClassIds,
          departmentId: faculty.department_id,
        };
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

  /**
   * Wraps the role-specific query with one hard rule that applies
   * regardless of role: a draft is only ever visible to its own author.
   * Even Admin's normally-sees-everything `{}` gets constrained by this —
   * drafts are a private scratchpad, not an org-wide announcement yet.
   */
  private buildVisibilityQuery(
    context: UserContext,
  ): Prisma.announcementsWhereInput {
    return {
      AND: [
        this.buildRoleVisibilityQuery(context),
        { OR: [{ status: 'published' }, { posted_by_user_id: context.userId }] },
      ],
    };
  }

  private buildRoleVisibilityQuery(
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
            // Admin's org-wide faculty broadcasts (department_id: null) —
            // an HOD is also faculty and should see those.
            { target_audience: 'teachers', department_id: null },
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
            // Department-wide faculty broadcasts — either targeted at this
            // faculty member's own department, or an org-wide broadcast
            // (department_id: null) from Admin.
            {
              target_audience: 'teachers',
              OR: [
                { department_id: context.departmentId ?? -1 },
                { department_id: null },
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
      const classes = await this.prisma.classes.findMany({
        where: { id: { in: classIds } },
        select: {
          id: true,
          section: true,
          courses: { select: { code: true } },
          batches: { select: { name: true } },
        },
      });
      // Raw class rows have no human-readable name of their own (just a
      // section letter) - synthesize one the same way subject-records does,
      // so the frontend's "Target classes" checkboxes show something
      // meaningful instead of a bare "A".
      return classes.map((klass) => ({
        id: klass.id,
        label: `${klass.courses.code}-${klass.section} (${klass.batches.name})`,
      }));
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

  /**
   * GET /announcements/lookup/my-department
   * HOD only. Single-item array (shape matches lookup/assigned-classes) for
   * the "Target faculty" toggle — an HOD may only ever broadcast to their
   * own department (see resolveTeacherTargetDepartment).
   */
  async lookupMyDepartment(user: JwtPayload) {
    const context = await this.resolveUserContext(user);
    if (context.role !== ROLES.HOD || context.departmentId === undefined) {
      throw new ForbiddenException({
        message: 'Only HOD accounts have a department to target',
        errorCode: 'ROLE_NOT_PERMITTED',
      });
    }

    try {
      const department = await this.prisma.departments.findUnique({
        where: { id: context.departmentId },
      });
      if (!department) {
        throw new NotFoundException({
          message: 'Department not found',
          errorCode: 'DEPARTMENT_NOT_FOUND',
        });
      }
      return [{ id: department.id, label: `${department.name} Faculty` }];
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error while resolving own department', err);
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
    const fileKey = announcement.file_key as string | null | undefined;
    return {
      ...rest,
      file_url: fileKey ? this.storage.getPublicUrl(fileKey) : null,
      class_ids: mappings.map((m) => m.class_id),
    };
  }
}
