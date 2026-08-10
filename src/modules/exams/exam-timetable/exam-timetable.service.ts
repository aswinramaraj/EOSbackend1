// exam-timetable.service.ts
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateExamTimetableDto } from './dto/create-exam-timetable.dto';
import { UpdateExamTimetableDto } from './dto/update-exam-timetable.dto';

function prismaErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
}

@Injectable()
export class ExamTimetableService {
  private readonly logger = new Logger(ExamTimetableService.name);

  constructor(private readonly prisma: PrismaService) {}

  private toTimeDate(time: string): Date {
    const normalized = time.length === 5 ? `${time}:00` : time;
    return new Date(`1970-01-01T${normalized}.000Z`);
  }

  private assertValidTimeRange(startTime: Date, endTime: Date) {
    if (startTime.getTime() >= endTime.getTime()) {
      throw new BadRequestException({
        message: 'start_time must be earlier than end_time.',
        errorCode: 'INVALID_TIME_RANGE',
      });
    }
  }

  /**
   * exam_timetable now belongs to a specific exam_timetable_versions row
   * (@@unique([version_id, exam_subject_mapping_id]) lets the same mapping
   * appear in more than one version's draft), and publication moved to
   * exam_subject_mapping.is_published/published_at rather than a per-slot
   * flag. This module has no version-management API of its own, so every
   * exam gets exactly one implicit, exam-wide (department_id: null) version,
   * lazily created on first use — same getOrCreateRow() convention as
   * library_settings/hostel_settings elsewhere in this codebase.
   *
   * Note: like the advisory-lock comment in attendance.service.ts, Postgres
   * treats NULL <> NULL in unique indexes, so @@unique([exam_id,
   * department_id, version_number]) does not by itself stop two concurrent
   * calls from both creating a default version for the same exam. Left
   * unlocked here since exam-timetable authoring is a rare, single-admin
   * action, not a high-concurrency path.
   */
  private async getOrCreateDefaultVersion(examId: number) {
    const existing = await this.prisma.exam_timetable_versions.findFirst({
      where: { exam_id: examId, department_id: null },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.exam_timetable_versions.create({
      data: { exam_id: examId, version_number: 1, status: 'draft' },
    });
  }

  async create(createExamTimetableDto: CreateExamTimetableDto) {
    const {
      exam_subject_mapping_id,
      exam_date,
      start_time,
      end_time,
      session,
      is_published,
    } = createExamTimetableDto;

    const mapping = await this.prisma.exam_subject_mapping.findUnique({
      where: { id: exam_subject_mapping_id },
    });

    if (!mapping) {
      throw new NotFoundException({
        message: 'Exam subject mapping not found.',
        errorCode: 'EXAM_SUBJECT_MAPPING_NOT_FOUND',
      });
    }

    const version = await this.getOrCreateDefaultVersion(mapping.exam_id);

    const existing = await this.prisma.exam_timetable.findUnique({
      where: {
        version_id_exam_subject_mapping_id: {
          version_id: version.id,
          exam_subject_mapping_id,
        },
      },
    });

    if (existing) {
      throw new ConflictException({
        message: 'Exam timetable already exists.',
        errorCode: 'EXAM_TIMETABLE_EXISTS',
      });
    }

    const startTime = this.toTimeDate(start_time);
    const endTime = this.toTimeDate(end_time);
    this.assertValidTimeRange(startTime, endTime);

    try {
      // Transactional so the timetable row and its mapping's publish flag
      // either both land or neither does — see the compound-unique catch
      // below for why this needs the errors from both statements handled
      // the same way.
      return await this.prisma.$transaction(async (tx) => {
        const timetable = await tx.exam_timetable.create({
          data: {
            exam_subject_mapping_id,
            exam_date: new Date(exam_date),
            start_time: startTime,
            end_time: endTime,
            session,
            version_id: version.id,
          },
        });

        // Explicit undefined check (not just truthy is_published) so an
        // explicit `is_published: false` at creation still clears
        // published_at back to null, instead of silently doing nothing.
        if (is_published !== undefined) {
          await tx.exam_subject_mapping.update({
            where: { id: exam_subject_mapping_id },
            data: {
              is_published,
              published_at: is_published ? new Date() : null,
            },
          });
        }

        return timetable;
      });
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2002') {
        throw new ConflictException({
          message: 'Exam timetable already exists.',
          errorCode: 'EXAM_TIMETABLE_EXISTS',
        });
      }

      if (prismaErrorCode(err) === 'P2003') {
        throw new NotFoundException({
          message: 'Exam subject mapping not found.',
          errorCode: 'EXAM_SUBJECT_MAPPING_NOT_FOUND',
        });
      }

      this.logger.error('DB error while creating exam timetable', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll() {
    try {
      return await this.prisma.exam_timetable.findMany({
        include: { exam_subject_mapping: true },
      });
    } catch (err: unknown) {
      this.logger.error('DB error while fetching exam timetables', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findOne(id: number) {
    let timetable: Awaited<
      ReturnType<typeof this.prisma.exam_timetable.findUnique>
    >;

    try {
      timetable = await this.prisma.exam_timetable.findUnique({
        where: { id },
        include: { exam_subject_mapping: true },
      });
    } catch (err: unknown) {
      this.logger.error('DB error while fetching exam timetable', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!timetable) {
      throw new NotFoundException({
        message: 'Exam timetable not found.',
        errorCode: 'EXAM_TIMETABLE_NOT_FOUND',
      });
    }

    return timetable;
  }

  async update(id: number, updateExamTimetableDto: UpdateExamTimetableDto) {
    const existing = await this.prisma.exam_timetable.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        message: 'Exam timetable not found.',
        errorCode: 'EXAM_TIMETABLE_NOT_FOUND',
      });
    }

    const exam_subject_mapping_id =
      updateExamTimetableDto.exam_subject_mapping_id ??
      existing.exam_subject_mapping_id;

    if (
      updateExamTimetableDto.exam_subject_mapping_id !== undefined &&
      updateExamTimetableDto.exam_subject_mapping_id !==
        existing.exam_subject_mapping_id
    ) {
      const mapping = await this.prisma.exam_subject_mapping.findUnique({
        where: { id: updateExamTimetableDto.exam_subject_mapping_id },
      });

      if (!mapping) {
        throw new NotFoundException({
          message: 'Exam subject mapping not found.',
          errorCode: 'EXAM_SUBJECT_MAPPING_NOT_FOUND',
        });
      }

      const duplicate = await this.prisma.exam_timetable.findUnique({
        where: {
          version_id_exam_subject_mapping_id: {
            version_id: existing.version_id,
            exam_subject_mapping_id,
          },
        },
      });

      if (duplicate && duplicate.id !== id) {
        throw new ConflictException({
          message: 'Exam timetable already exists.',
          errorCode: 'EXAM_TIMETABLE_EXISTS',
        });
      }
    }

    const startTime = updateExamTimetableDto.start_time
      ? this.toTimeDate(updateExamTimetableDto.start_time)
      : existing.start_time;
    const endTime = updateExamTimetableDto.end_time
      ? this.toTimeDate(updateExamTimetableDto.end_time)
      : existing.end_time;

    this.assertValidTimeRange(startTime, endTime);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const timetable = await tx.exam_timetable.update({
          where: { id },
          data: {
            exam_subject_mapping_id:
              updateExamTimetableDto.exam_subject_mapping_id,
            exam_date: updateExamTimetableDto.exam_date
              ? new Date(updateExamTimetableDto.exam_date)
              : undefined,
            start_time: updateExamTimetableDto.start_time
              ? startTime
              : undefined,
            end_time: updateExamTimetableDto.end_time ? endTime : undefined,
            session: updateExamTimetableDto.session,
          },
        });

        if (updateExamTimetableDto.is_published !== undefined) {
          await tx.exam_subject_mapping.update({
            where: { id: exam_subject_mapping_id },
            data: {
              is_published: updateExamTimetableDto.is_published,
              published_at: updateExamTimetableDto.is_published
                ? new Date()
                : null,
            },
          });
        }

        return timetable;
      });
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2002') {
        throw new ConflictException({
          message: 'Exam timetable already exists.',
          errorCode: 'EXAM_TIMETABLE_EXISTS',
        });
      }

      if (prismaErrorCode(err) === 'P2003') {
        throw new NotFoundException({
          message: 'Exam subject mapping not found.',
          errorCode: 'EXAM_SUBJECT_MAPPING_NOT_FOUND',
        });
      }

      if (prismaErrorCode(err) === 'P2025') {
        throw new NotFoundException({
          message: 'Exam timetable not found.',
          errorCode: 'EXAM_TIMETABLE_NOT_FOUND',
        });
      }

      this.logger.error('DB error while updating exam timetable', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async remove(id: number) {
    try {
      await this.prisma.exam_timetable.delete({ where: { id } });
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2025') {
        throw new NotFoundException({
          message: 'Exam timetable not found.',
          errorCode: 'EXAM_TIMETABLE_NOT_FOUND',
        });
      }

      this.logger.error('DB error while deleting exam timetable', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
