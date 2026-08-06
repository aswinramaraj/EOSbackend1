import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateTimetableVersionDto } from './dto/create-timetable-version.dto';
import { ListTimetableVersionsQueryDto } from './dto/list-timetable-versions-query.dto';
import { PublishTimetableVersionDto } from './dto/publish-timetable-version.dto';

const VERSION_DETAIL_INCLUDE = {
  departments: { select: { id: true, name: true, code: true } },
  exam_timetable: {
    include: {
      exam_subject_mapping: {
        include: {
          classes: { select: { id: true, section: true, department_id: true } },
          subjects: { select: { id: true, name: true, subject_code: true } },
        },
      },
      venues: { select: { id: true, name: true, location: true } },
    },
  },
} as const;

@Injectable()
export class ExamTimetableVersionsService {
  private readonly logger = new Logger(ExamTimetableVersionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTimetableVersionDto, userId: number) {
    const exam = await this.prisma.exams.findUnique({
      where: { id: dto.exam_id },
    });
    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found.',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    if (dto.department_id) {
      const department = await this.prisma.departments.findUnique({
        where: { id: dto.department_id },
      });
      if (!department) {
        throw new NotFoundException({
          message: 'Department not found.',
          errorCode: 'DEPARTMENT_NOT_FOUND',
        });
      }
    }

    const lastVersion = await this.prisma.exam_timetable_versions.findFirst({
      where: { exam_id: dto.exam_id, department_id: dto.department_id ?? null },
      orderBy: { version_number: 'desc' },
    });
    const versionNumber = (lastVersion?.version_number ?? 0) + 1;

    try {
      return await this.prisma.exam_timetable_versions.create({
        data: {
          exam_id: dto.exam_id,
          department_id: dto.department_id,
          version_number: versionNumber,
          created_by_user_id: userId,
        },
      });
    } catch (err) {
      this.logger.error('DB error while creating timetable version', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll(query: ListTimetableVersionsQueryDto) {
    try {
      return await this.prisma.exam_timetable_versions.findMany({
        where: {
          exam_id: query.exam_id,
          department_id: query.department_id,
          status: query.status,
        },
        orderBy: [{ exam_id: 'asc' }, { version_number: 'desc' }],
        include: {
          departments: { select: { id: true, name: true, code: true } },
          _count: { select: { exam_timetable: true } },
        },
      });
    } catch (err) {
      this.logger.error('DB error while fetching timetable versions', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findOne(id: number) {
    return this.getOrThrow(id, VERSION_DETAIL_INCLUDE);
  }

  /** draft -> ready_to_publish. Requires at least one scheduled slot. */
  async readyToPublish(id: number) {
    const version = await this.getOrThrow(id);
    if (version.status !== 'draft') {
      throw new BadRequestException({
        message: 'Only a draft version can be staged for publish.',
        errorCode: 'INVALID_STATUS_TRANSITION',
      });
    }

    const slotCount = await this.prisma.exam_timetable.count({
      where: { version_id: id },
    });
    if (slotCount === 0) {
      throw new BadRequestException({
        message:
          'Cannot stage an empty timetable — schedule at least one paper first.',
        errorCode: 'EMPTY_VERSION',
      });
    }

    return this.prisma.exam_timetable_versions.update({
      where: { id },
      data: { status: 'ready_to_publish' },
    });
  }

  /** ready_to_publish -> draft (Senior COE only, enforced at the controller). */
  async returnToDrafts(id: number) {
    const version = await this.getOrThrow(id);
    if (version.status !== 'ready_to_publish') {
      throw new BadRequestException({
        message: 'Only a version staged for publish can be returned to drafts.',
        errorCode: 'INVALID_STATUS_TRANSITION',
      });
    }

    return this.prisma.exam_timetable_versions.update({
      where: { id },
      data: { status: 'draft' },
    });
  }

  /**
   * ready_to_publish -> published (Senior COE only, enforced at the
   * controller). Supersedes any other currently-published version in the
   * same scope, and advances the parent exam's status on first publish.
   */
  async publish(id: number, dto: PublishTimetableVersionDto, userId: number) {
    const version = await this.getOrThrow(id, {
      exam_timetable: {
        include: {
          exam_subject_mapping: {
            select: { class_id: true, subject_id: true },
          },
        },
      },
    });

    if (version.status !== 'ready_to_publish') {
      throw new BadRequestException({
        message: 'Only a version staged for publish can be published.',
        errorCode: 'INVALID_STATUS_TRANSITION',
      });
    }

    const signature = this.computeSignature(version.exam_timetable);

    if (!dto.force) {
      const duplicate = await this.prisma.exam_timetable_versions.findFirst({
        where: {
          exam_id: version.exam_id,
          department_id: version.department_id,
          status: 'published',
          signature,
          id: { not: id },
        },
      });
      if (duplicate) {
        throw new ConflictException({
          message:
            'A published version with the same papers, dates and sessions already exists for this scope.',
          errorCode: 'DUPLICATE_PLAN_SIGNATURE',
        });
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.exam_timetable_versions.updateMany({
          where: {
            exam_id: version.exam_id,
            department_id: version.department_id,
            status: 'published',
            id: { not: id },
          },
          data: { status: 'superseded' },
        });

        const updated = await tx.exam_timetable_versions.update({
          where: { id },
          data: {
            status: 'published',
            signature,
            published_by_user_id: userId,
            published_at: new Date(),
          },
        });

        const exam = await tx.exams.findUnique({
          where: { id: version.exam_id },
        });
        if (exam?.status === 'created') {
          await tx.exams.update({
            where: { id: version.exam_id },
            data: { status: 'timetable_published' },
          });
        }

        return updated;
      });
    } catch (err) {
      if (
        err instanceof ConflictException ||
        err instanceof BadRequestException
      ) {
        throw err;
      }
      this.logger.error('DB error while publishing timetable version', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** published -> withdrawn (Senior COE only, enforced at the controller). */
  async withdraw(id: number) {
    const version = await this.getOrThrow(id);
    if (version.status !== 'published') {
      throw new BadRequestException({
        message: 'Only a published version can be withdrawn.',
        errorCode: 'INVALID_STATUS_TRANSITION',
      });
    }

    return this.prisma.exam_timetable_versions.update({
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

    try {
      await this.prisma.exam_timetable_versions.delete({ where: { id } });
      return { id };
    } catch (err) {
      this.logger.error('DB error while deleting timetable version', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** Sorted hash of {class,subject,date,session} tuples — order-independent fingerprint of a version's content. */
  private computeSignature(
    slots: {
      exam_date: Date;
      session: string;
      exam_subject_mapping: { class_id: number; subject_id: number };
    }[],
  ): string {
    const tuples = slots
      .map(
        (s) =>
          `${s.exam_subject_mapping.class_id}:${s.exam_subject_mapping.subject_id}:${s.exam_date.toISOString().slice(0, 10)}:${s.session}`,
      )
      .sort();
    return crypto
      .createHash('sha256')
      .update(tuples.join('|'))
      .digest('hex')
      .slice(0, 64);
  }

  private async getOrThrow(id: number, include?: object) {
    let version: any;
    try {
      version = await this.prisma.exam_timetable_versions.findUnique({
        where: { id },
        include,
      });
    } catch (err) {
      this.logger.error('DB error while fetching timetable version', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!version) {
      throw new NotFoundException({
        message: 'Timetable version not found.',
        errorCode: 'TIMETABLE_VERSION_NOT_FOUND',
      });
    }

    return version;
  }
}
