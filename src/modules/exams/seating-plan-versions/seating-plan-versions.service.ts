import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  generateSeatPlan,
  seatLabelForIndex,
} from './lib/seating-pattern.util';
import { CreateSeatingPlanVersionDto } from './dto/create-seating-plan-version.dto';
import { ListSeatingPlanVersionsQueryDto } from './dto/list-seating-plan-versions-query.dto';
import { PublishSeatingPlanVersionDto } from './dto/publish-seating-plan-version.dto';
import { AddVersionVenueDto } from './dto/add-version-venue.dto';
import { UpdateVersionVenueDto } from './dto/update-version-venue.dto';
import { AllocateVersionVenueDto } from './dto/allocate-version-venue.dto';

const VERSION_DETAIL_INCLUDE = {
  seating_plan_version_venues: {
    include: {
      venues: {
        select: { id: true, name: true, location: true, capacity: true },
      },
      seating_plan_venue_departments: {
        include: {
          departments: { select: { id: true, name: true, code: true } },
        },
      },
      hall_plans: { select: { id: true } },
    },
  },
} as const;

@Injectable()
export class SeatingPlanVersionsService {
  private readonly logger = new Logger(SeatingPlanVersionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSeatingPlanVersionDto, userId: number) {
    const exam = await this.prisma.exams.findUnique({
      where: { id: dto.exam_id },
    });
    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found.',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    const examDate = new Date(dto.exam_date);
    const lastVersion = await this.prisma.seating_plan_versions.findFirst({
      where: {
        exam_id: dto.exam_id,
        exam_date: examDate,
        session: dto.session,
      },
      orderBy: { version_number: 'desc' },
    });
    const versionNumber = (lastVersion?.version_number ?? 0) + 1;

    try {
      return await this.prisma.seating_plan_versions.create({
        data: {
          exam_id: dto.exam_id,
          exam_date: examDate,
          session: dto.session,
          version_number: versionNumber,
          created_by_user_id: userId,
        },
      });
    } catch (err) {
      this.logger.error('DB error while creating seating plan version', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll(query: ListSeatingPlanVersionsQueryDto) {
    try {
      return await this.prisma.seating_plan_versions.findMany({
        where: {
          exam_id: query.exam_id,
          exam_date: query.exam_date ? new Date(query.exam_date) : undefined,
          session: query.session,
          status: query.status,
        },
        orderBy: [
          { exam_id: 'asc' },
          { exam_date: 'asc' },
          { session: 'asc' },
          { version_number: 'desc' },
        ],
        include: { _count: { select: { seating_plan_version_venues: true } } },
      });
    } catch (err) {
      this.logger.error('DB error while fetching seating plan versions', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findOne(id: number) {
    return this.getOrThrow(id, VERSION_DETAIL_INCLUDE);
  }

  async readyToPublish(id: number) {
    const version = await this.getOrThrow(id, VERSION_DETAIL_INCLUDE);
    if (version.status !== 'draft') {
      throw new BadRequestException({
        message: 'Only a draft version can be staged for publish.',
        errorCode: 'INVALID_STATUS_TRANSITION',
      });
    }

    const hasAllocatedVenue = await this.prisma.seating_arrangements.findFirst({
      where: { version_id: id },
    });
    if (!hasAllocatedVenue) {
      throw new BadRequestException({
        message:
          'Cannot stage an empty seating plan — allocate at least one venue first.',
        errorCode: 'EMPTY_VERSION',
      });
    }

    return this.prisma.seating_plan_versions.update({
      where: { id },
      data: { status: 'ready_to_publish' },
    });
  }

  async returnToDrafts(id: number) {
    const version = await this.getOrThrow(id);
    if (version.status !== 'ready_to_publish') {
      throw new BadRequestException({
        message: 'Only a version staged for publish can be returned to drafts.',
        errorCode: 'INVALID_STATUS_TRANSITION',
      });
    }

    return this.prisma.seating_plan_versions.update({
      where: { id },
      data: { status: 'draft' },
    });
  }

  async publish(id: number, dto: PublishSeatingPlanVersionDto, userId: number) {
    const version = await this.getOrThrow(id, VERSION_DETAIL_INCLUDE);
    if (version.status !== 'ready_to_publish') {
      throw new BadRequestException({
        message: 'Only a version staged for publish can be published.',
        errorCode: 'INVALID_STATUS_TRANSITION',
      });
    }

    const signature = this.computeSignature(
      version.seating_plan_version_venues,
    );

    if (!dto.force) {
      const duplicate = await this.prisma.seating_plan_versions.findFirst({
        where: {
          exam_id: version.exam_id,
          exam_date: version.exam_date,
          session: version.session,
          status: 'published',
          signature,
          id: { not: id },
        },
      });
      if (duplicate) {
        throw new ConflictException({
          message:
            'A published seating plan with the same venues, departments and pattern already exists for this scope.',
          errorCode: 'DUPLICATE_PLAN_SIGNATURE',
        });
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.seating_plan_versions.updateMany({
          where: {
            exam_id: version.exam_id,
            exam_date: version.exam_date,
            session: version.session,
            status: 'published',
            id: { not: id },
          },
          data: { status: 'superseded' },
        });

        return tx.seating_plan_versions.update({
          where: { id },
          data: {
            status: 'published',
            signature,
            published_by_user_id: userId,
            published_at: new Date(),
          },
        });
      });
    } catch (err) {
      if (
        err instanceof ConflictException ||
        err instanceof BadRequestException
      ) {
        throw err;
      }
      this.logger.error('DB error while publishing seating plan version', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async withdraw(id: number) {
    const version = await this.getOrThrow(id);
    if (version.status !== 'published') {
      throw new BadRequestException({
        message: 'Only a published version can be withdrawn.',
        errorCode: 'INVALID_STATUS_TRANSITION',
      });
    }

    return this.prisma.seating_plan_versions.update({
      where: { id },
      data: { status: 'withdrawn' },
    });
  }

  async remove(id: number) {
    const version = await this.getOrThrow(id);
    if (version.status !== 'draft') {
      throw new ConflictException({
        message: 'Only a draft version can be deleted.',
        errorCode: 'VERSION_NOT_DRAFT',
      });
    }

    const seatedCount = await this.prisma.seating_arrangements.count({
      where: { version_id: id },
    });
    if (seatedCount > 0) {
      throw new ConflictException({
        message:
          'Cannot delete a version that already has students seated — clear its allocations first.',
        errorCode: 'VERSION_HAS_SEATED_STUDENTS',
      });
    }

    await this.prisma.seating_plan_versions.delete({ where: { id } });
    return { id };
  }

  // ---- venue management (draft only) ----

  async addVenue(versionId: number, dto: AddVersionVenueDto) {
    const version = await this.getOrThrow(versionId);
    this.assertDraft(version);

    const venue = await this.prisma.venues.findUnique({
      where: { id: dto.venue_id },
    });
    if (!venue) {
      throw new NotFoundException({
        message: 'Venue not found.',
        errorCode: 'VENUE_NOT_FOUND',
      });
    }

    if (dto.department_ids?.length) {
      await this.assertDepartmentsExist(dto.department_ids);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const versionVenue = await tx.seating_plan_version_venues.create({
          data: {
            version_id: versionId,
            venue_id: dto.venue_id,
            allocation_mode: dto.allocation_mode,
            pattern: dto.pattern,
          },
        });

        if (dto.department_ids?.length) {
          await tx.seating_plan_venue_departments.createMany({
            data: dto.department_ids.map((department_id) => ({
              version_venue_id: versionVenue.id,
              department_id,
            })),
          });
        }

        return versionVenue;
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException({
          message: 'This venue is already part of this seating plan version.',
          errorCode: 'VENUE_ALREADY_IN_VERSION',
        });
      }
      this.logger.error(
        'DB error while adding venue to seating plan version',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async updateVenue(
    versionId: number,
    versionVenueId: number,
    dto: UpdateVersionVenueDto,
  ) {
    const version = await this.getOrThrow(versionId);
    this.assertDraft(version);
    await this.getVersionVenueOrThrow(versionId, versionVenueId);

    if (dto.department_ids !== undefined) {
      await this.assertDepartmentsExist(dto.department_ids);
      await this.prisma.seating_plan_venue_departments.deleteMany({
        where: { version_venue_id: versionVenueId },
      });
      if (dto.department_ids.length) {
        await this.prisma.seating_plan_venue_departments.createMany({
          data: dto.department_ids.map((department_id) => ({
            version_venue_id: versionVenueId,
            department_id,
          })),
        });
      }
    }

    return this.prisma.seating_plan_version_venues.update({
      where: { id: versionVenueId },
      data: { allocation_mode: dto.allocation_mode, pattern: dto.pattern },
    });
  }

  async removeVenue(versionId: number, versionVenueId: number) {
    const version = await this.getOrThrow(versionId);
    this.assertDraft(version);
    const versionVenue = await this.getVersionVenueOrThrow(
      versionId,
      versionVenueId,
    );

    if (versionVenue.hall_plan_id) {
      const seatedCount = await this.prisma.seating_arrangements.count({
        where: {
          hall_plan_id: versionVenue.hall_plan_id,
          version_id: versionId,
        },
      });
      if (seatedCount > 0) {
        throw new ConflictException({
          message:
            'Cannot remove a venue that already has students seated — clear its allocation first.',
          errorCode: 'VENUE_HAS_SEATED_STUDENTS',
        });
      }
    }

    await this.prisma.seating_plan_version_venues.delete({
      where: { id: versionVenueId },
    });
    return { id: versionVenueId };
  }

  // ---- allocation ----

  async allocateVenue(
    versionId: number,
    versionVenueId: number,
    dto: AllocateVersionVenueDto,
  ) {
    const version = await this.getOrThrow(versionId);
    this.assertDraft(version);
    await this.getVersionVenueOrThrow(versionId, versionVenueId);
    const versionVenue =
      await this.prisma.seating_plan_version_venues.findUniqueOrThrow({
        where: { id: versionVenueId },
        include: { venues: true, seating_plan_venue_departments: true },
      });

    let hallPlanId = versionVenue.hall_plan_id;
    if (!hallPlanId) {
      let hallPlan = await this.prisma.hall_plans.findFirst({
        where: {
          exam_id: version.exam_id,
          venue_id: versionVenue.venue_id,
          exam_date: version.exam_date,
        },
      });
      if (!hallPlan) {
        hallPlan = await this.prisma.hall_plans.create({
          data: {
            exam_id: version.exam_id,
            venue_id: versionVenue.venue_id,
            exam_date: version.exam_date,
            capacity: versionVenue.venues.capacity,
          },
        });
      }
      hallPlanId = hallPlan.id;
      await this.prisma.seating_plan_version_venues.update({
        where: { id: versionVenueId },
        data: { hall_plan_id: hallPlanId },
      });
    }

    await this.prisma.seating_arrangements.deleteMany({
      where: { hall_plan_id: hallPlanId, version_id: versionId },
    });

    const capacity = versionVenue.venues.capacity ?? 0;

    if (versionVenue.allocation_mode === 'manual') {
      return this.allocateManual(versionId, hallPlanId, dto);
    }
    return this.allocateAutomatic(version, versionVenue, hallPlanId, capacity);
  }

  private async allocateAutomatic(
    version: { id: number; exam_id: number; exam_date: Date; session: string },
    versionVenue: {
      pattern: string | null;
      seating_plan_venue_departments: { department_id: number }[];
    },
    hallPlanId: number,
    capacity: number,
  ) {
    const allowedDeptIds = versionVenue.seating_plan_venue_departments.map(
      (d) => d.department_id,
    );

    const mappings = await this.prisma.exam_subject_mapping.findMany({
      where: {
        exam_id: version.exam_id,
        exam_timetable: {
          some: {
            exam_date: version.exam_date,
            session: version.session as 'FN' | 'AN',
            exam_timetable_versions: { status: 'published' },
          },
        },
        ...(allowedDeptIds.length
          ? { classes: { department_id: { in: allowedDeptIds } } }
          : {}),
      },
      select: { class_id: true },
    });
    const classIds = [...new Set(mappings.map((m) => m.class_id))];
    if (classIds.length === 0) {
      throw new UnprocessableEntityException({
        message:
          'No published exam timetable is scheduled for this exam/date/session (matching the allowed departments, if any).',
        errorCode: 'NO_TIMETABLE_FOR_DATE',
      });
    }

    const alreadySeated = await this.prisma.seating_arrangements.findMany({
      where: { version_id: version.id },
      select: { student_id: true },
    });
    const alreadySeatedIds = alreadySeated.map((s) => s.student_id);

    const students = await this.prisma.students.findMany({
      where: { class_id: { in: classIds }, id: { notIn: alreadySeatedIds } },
      select: {
        id: true,
        roll_no: true,
        classes: { select: { department_id: true } },
      },
      orderBy: [{ roll_no: 'asc' }, { id: 'asc' }],
    });
    if (students.length === 0) {
      throw new UnprocessableEntityException({
        message:
          'No eligible students found for this venue (they may already be seated elsewhere for this plan).',
        errorCode: 'NO_ELIGIBLE_STUDENTS',
      });
    }
    if (students.length > capacity) {
      throw new UnprocessableEntityException({
        message: `${students.length} eligible student(s) exceed this venue's capacity (${capacity}).`,
        errorCode: 'CAPACITY_EXCEEDED',
      });
    }

    const input = students.map((s) => ({
      id: s.id,
      department_id: s.classes!.department_id,
    }));
    const plan = generateSeatPlan(
      (versionVenue.pattern as any) ?? 'sequential',
      input,
      capacity,
    );

    await this.prisma.seating_arrangements.createMany({
      data: plan.map((p) => ({
        hall_plan_id: hallPlanId,
        student_id: p.student_id,
        seat_number: p.seat_number,
        version_id: version.id,
      })),
    });

    return this.getVenueSeating(hallPlanId, version.id);
  }

  private async allocateManual(
    versionId: number,
    hallPlanId: number,
    dto: AllocateVersionVenueDto,
  ) {
    if (!dto.entries?.length) {
      throw new BadRequestException({
        message: 'entries is required for manual allocation.',
        errorCode: 'ENTRIES_REQUIRED',
      });
    }

    const registerNumbers = this.expandEntries(dto.entries);
    const students = await this.prisma.students.findMany({
      where: { register_no: { in: registerNumbers } },
      select: { id: true, register_no: true },
    });
    const foundRegistrationNumbers = new Set(
      students.map((s) => s.register_no),
    );
    const missing = registerNumbers.filter(
      (r) => !foundRegistrationNumbers.has(r),
    );
    if (missing.length > 0) {
      throw new UnprocessableEntityException({
        message: `Unknown register numbers: ${missing.join(', ')}`,
        errorCode: 'UNKNOWN_REGISTER_NUMBERS',
      });
    }

    const specialSet = new Set(
      dto.special_accommodation_register_numbers ?? [],
    );

    const rows = students.map((s, i) => ({
      hall_plan_id: hallPlanId,
      student_id: s.id,
      seat_number: seatLabelForIndex(i),
      version_id: versionId,
      is_special_accommodation: specialSet.has(s.register_no ?? ''),
    }));

    await this.prisma.seating_arrangements.createMany({ data: rows });
    return this.getVenueSeating(hallPlanId, versionId);
  }

  async clearVenueAllocation(versionId: number, versionVenueId: number) {
    const version = await this.getOrThrow(versionId);
    this.assertDraft(version);
    const versionVenue = await this.getVersionVenueOrThrow(
      versionId,
      versionVenueId,
    );

    if (!versionVenue.hall_plan_id) {
      return { deleted_count: 0 };
    }

    const result = await this.prisma.seating_arrangements.deleteMany({
      where: { hall_plan_id: versionVenue.hall_plan_id, version_id: versionId },
    });

    return { deleted_count: result.count };
  }

  private async getVenueSeating(hallPlanId: number, versionId: number) {
    return this.prisma.seating_arrangements.findMany({
      where: { hall_plan_id: hallPlanId, version_id: versionId },
      include: {
        students: {
          select: {
            id: true,
            student_id_no: true,
            roll_no: true,
            register_no: true,
          },
        },
      },
      orderBy: { seat_number: 'asc' },
    });
  }

  /** "START-END" ranges sharing a common alpha prefix are expanded; anything else passes through as-is. */
  private expandEntries(entries: string[]): string[] {
    const result: string[] = [];
    for (const raw of entries) {
      const entry = raw.trim();
      if (!entry.includes('-')) {
        result.push(entry);
        continue;
      }

      const [start, end] = entry.split('-').map((s) => s.trim());
      const startMatch = /^(.*?)(\d+)$/.exec(start);
      const endMatch = /^(.*?)(\d+)$/.exec(end);

      if (!startMatch || !endMatch || startMatch[1] !== endMatch[1]) {
        result.push(start, end);
        continue;
      }

      const [, prefix, startDigits] = startMatch;
      const endDigits = endMatch[2];
      const width = startDigits.length;
      const startNum = parseInt(startDigits, 10);
      const endNum = parseInt(endDigits, 10);
      for (let n = startNum; n <= endNum; n++) {
        result.push(`${prefix}${String(n).padStart(width, '0')}`);
      }
    }
    return result;
  }

  private computeSignature(
    versionVenues: {
      venue_id: number;
      allocation_mode: string;
      pattern: string | null;
      seating_plan_venue_departments: { department_id: number }[];
    }[],
  ): string {
    const tuples = versionVenues
      .map((vv) => {
        const depts = vv.seating_plan_venue_departments
          .map((d) => d.department_id)
          .sort((a, b) => a - b)
          .join(',');
        return `${vv.venue_id}:${vv.allocation_mode}:${vv.pattern ?? ''}:${depts}`;
      })
      .sort();
    return crypto
      .createHash('sha256')
      .update(tuples.join('|'))
      .digest('hex')
      .slice(0, 64);
  }

  private assertDraft(version: { status: string }) {
    if (version.status !== 'draft') {
      throw new ConflictException({
        message: 'This can only be changed while the version is a draft.',
        errorCode: 'VERSION_NOT_DRAFT',
      });
    }
  }

  private async assertDepartmentsExist(departmentIds: number[]) {
    if (departmentIds.length === 0) return;
    const departments = await this.prisma.departments.findMany({
      where: { id: { in: departmentIds } },
    });
    if (departments.length !== new Set(departmentIds).size) {
      throw new NotFoundException({
        message: 'One or more departments were not found.',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }
  }

  private async getVersionVenueOrThrow(
    versionId: number,
    versionVenueId: number,
    include?: object,
  ) {
    const versionVenue =
      await this.prisma.seating_plan_version_venues.findUnique({
        where: { id: versionVenueId },
        include,
      });
    if (!versionVenue || versionVenue.version_id !== versionId) {
      throw new NotFoundException({
        message: 'Venue not found in this seating plan version.',
        errorCode: 'VERSION_VENUE_NOT_FOUND',
      });
    }
    return versionVenue;
  }

  private async getOrThrow(id: number, include?: object) {
    let version: any;
    try {
      version = await this.prisma.seating_plan_versions.findUnique({
        where: { id },
        include,
      });
    } catch (err) {
      this.logger.error('DB error while fetching seating plan version', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!version) {
      throw new NotFoundException({
        message: 'Seating plan version not found.',
        errorCode: 'SEATING_PLAN_VERSION_NOT_FOUND',
      });
    }

    return version;
  }
}
