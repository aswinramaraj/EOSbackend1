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
import {
  assertVenueNotClashing,
  type ExamSession,
} from 'src/common/utils/check-venue-clash.util';
import { CreateExamTimetableDto } from './dto/create-exam-timetable.dto';
import { UpdateExamTimetableDto } from './dto/update-exam-timetable.dto';
import { ListExamTimetableQueryDto } from './dto/list-exam-timetable-query.dto';

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

  /** Slots can only be added/edited/removed while their version is still a draft. */
  private assertVersionIsDraft(version: { status: string }) {
    if (version.status !== 'draft') {
      throw new ConflictException({
        message:
          'Slots can only be changed while the timetable version is a draft.',
        errorCode: 'VERSION_NOT_DRAFT',
      });
    }
  }

  /**
   * A class can have more than one paper in the same session only if every
   * paper involved is an elective — students split across whichever
   * elective they picked, so there's no genuine student-level clash. A core
   * paper always conflicts with anything else scheduled for that class in
   * that session, since every student in the class takes it.
   */
  private async assertNoCohortConflict(
    versionId: number,
    examDate: Date,
    session: ExamSession,
    mapping: { class_id: number; is_elective: boolean },
    excludeExamTimetableId?: number,
  ) {
    const overlapping = await this.prisma.exam_timetable.findMany({
      where: {
        version_id: versionId,
        exam_date: examDate,
        session,
        exam_subject_mapping: { class_id: mapping.class_id },
        id: excludeExamTimetableId
          ? { not: excludeExamTimetableId }
          : undefined,
      },
      select: { exam_subject_mapping: { select: { is_elective: true } } },
    });

    const hasConflict = mapping.is_elective
      ? overlapping.some((slot) => !slot.exam_subject_mapping.is_elective)
      : overlapping.length > 0;

    if (hasConflict) {
      throw new ConflictException({
        message: mapping.is_elective
          ? 'A core paper is already scheduled for this class in this session.'
          : 'This class already has a paper scheduled in this session.',
        errorCode: 'TIMETABLE_SLOT_CONFLICT',
      });
    }
  }

  async create(dto: CreateExamTimetableDto) {
    const version = await this.prisma.exam_timetable_versions.findUnique({
      where: { id: dto.version_id },
    });
    if (!version) {
      throw new NotFoundException({
        message: 'Timetable version not found.',
        errorCode: 'TIMETABLE_VERSION_NOT_FOUND',
      });
    }
    this.assertVersionIsDraft(version);

    const mapping = await this.prisma.exam_subject_mapping.findUnique({
      where: { id: dto.exam_subject_mapping_id },
    });
    if (!mapping) {
      throw new NotFoundException({
        message: 'Exam subject mapping not found.',
        errorCode: 'EXAM_SUBJECT_MAPPING_NOT_FOUND',
      });
    }
    if (mapping.exam_id !== version.exam_id) {
      throw new BadRequestException({
        message: "This subject mapping does not belong to the version's exam.",
        errorCode: 'MAPPING_EXAM_MISMATCH',
      });
    }

    const startTime = this.toTimeDate(dto.start_time);
    const endTime = this.toTimeDate(dto.end_time);
    this.assertValidTimeRange(startTime, endTime);
    const examDate = new Date(dto.exam_date);

    await this.assertNoCohortConflict(
      dto.version_id,
      examDate,
      dto.session,
      mapping,
    );

    if (dto.venue_id) {
      await assertVenueNotClashing(this.prisma, {
        venueId: dto.venue_id,
        examDate,
        session: dto.session,
      });
    }

    try {
      return await this.prisma.exam_timetable.create({
        data: {
          version_id: dto.version_id,
          exam_subject_mapping_id: dto.exam_subject_mapping_id,
          exam_date: examDate,
          session: dto.session,
          start_time: startTime,
          end_time: endTime,
          venue_id: dto.venue_id,
        },
      });
    } catch (err: any) {
      if (
        err instanceof ConflictException ||
        err instanceof BadRequestException
      ) {
        throw err;
      }
      if (err?.code === 'P2002') {
        throw new ConflictException({
          message: 'This paper is already scheduled in this version.',
          errorCode: 'EXAM_TIMETABLE_EXISTS',
        });
      }
      if (err?.code === 'P2003') {
        throw new NotFoundException({
          message: 'Exam subject mapping not found.',
          errorCode: 'EXAM_SUBJECT_MAPPING_NOT_FOUND',
        });
      }

      this.logger.error('DB error while creating exam timetable slot', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll(query: ListExamTimetableQueryDto) {
    try {
      return await this.prisma.exam_timetable.findMany({
        where: { version_id: query.version_id },
        include: { exam_subject_mapping: true, venues: true },
      });
    } catch (err: any) {
      this.logger.error('DB error while fetching exam timetable slots', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findOne(id: number) {
    let timetable: any;

    try {
      timetable = await this.prisma.exam_timetable.findUnique({
        where: { id },
        include: { exam_subject_mapping: true, venues: true },
      });
    } catch (err: any) {
      this.logger.error('DB error while fetching exam timetable slot', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!timetable) {
      throw new NotFoundException({
        message: 'Exam timetable slot not found.',
        errorCode: 'EXAM_TIMETABLE_NOT_FOUND',
      });
    }

    return timetable;
  }

  /**
   * Once a version has left draft, only venue_id may still change (the
   * Published-tab per-date venue assignment) — everything else is frozen;
   * a real change means creating a new version instead.
   */
  async update(id: number, dto: UpdateExamTimetableDto) {
    const existing = await this.prisma.exam_timetable.findUnique({
      where: { id },
      include: { exam_timetable_versions: true, exam_subject_mapping: true },
    });

    if (!existing) {
      throw new NotFoundException({
        message: 'Exam timetable slot not found.',
        errorCode: 'EXAM_TIMETABLE_NOT_FOUND',
      });
    }

    const nonVenueFieldsGiven = Object.keys(dto).some(
      (key) => key !== 'venue_id',
    );
    if (nonVenueFieldsGiven) {
      this.assertVersionIsDraft(existing.exam_timetable_versions);
    }

    const examDate = dto.exam_date
      ? new Date(dto.exam_date)
      : existing.exam_date;
    const session = dto.session ?? existing.session;

    if (
      dto.exam_subject_mapping_id !== undefined ||
      dto.exam_date ||
      dto.session
    ) {
      const mappingId =
        dto.exam_subject_mapping_id ?? existing.exam_subject_mapping_id;
      const mapping = await this.prisma.exam_subject_mapping.findUnique({
        where: { id: mappingId },
      });
      if (!mapping) {
        throw new NotFoundException({
          message: 'Exam subject mapping not found.',
          errorCode: 'EXAM_SUBJECT_MAPPING_NOT_FOUND',
        });
      }

      await this.assertNoCohortConflict(
        existing.version_id,
        examDate,
        session,
        mapping,
        id,
      );
    }

    const startTime = dto.start_time
      ? this.toTimeDate(dto.start_time)
      : existing.start_time;
    const endTime = dto.end_time
      ? this.toTimeDate(dto.end_time)
      : existing.end_time;
    this.assertValidTimeRange(startTime, endTime);

    if (dto.venue_id !== undefined) {
      await assertVenueNotClashing(this.prisma, {
        venueId: dto.venue_id,
        examDate,
        session,
        excludeExamTimetableId: id,
      });
    }

    try {
      return await this.prisma.exam_timetable.update({
        where: { id },
        data: {
          exam_subject_mapping_id: dto.exam_subject_mapping_id,
          exam_date: dto.exam_date ? examDate : undefined,
          session: dto.session,
          start_time: dto.start_time ? startTime : undefined,
          end_time: dto.end_time ? endTime : undefined,
          venue_id: dto.venue_id,
        },
      });
    } catch (err: any) {
      if (
        err instanceof ConflictException ||
        err instanceof BadRequestException
      ) {
        throw err;
      }
      if (err?.code === 'P2002') {
        throw new ConflictException({
          message: 'This paper is already scheduled in this version.',
          errorCode: 'EXAM_TIMETABLE_EXISTS',
        });
      }
      if (err?.code === 'P2003') {
        throw new NotFoundException({
          message: 'Exam subject mapping not found.',
          errorCode: 'EXAM_SUBJECT_MAPPING_NOT_FOUND',
        });
      }
      if (err?.code === 'P2025') {
        throw new NotFoundException({
          message: 'Exam timetable slot not found.',
          errorCode: 'EXAM_TIMETABLE_NOT_FOUND',
        });
      }

      this.logger.error('DB error while updating exam timetable slot', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async remove(id: number) {
    const existing = await this.prisma.exam_timetable.findUnique({
      where: { id },
      include: { exam_timetable_versions: true },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Exam timetable slot not found.',
        errorCode: 'EXAM_TIMETABLE_NOT_FOUND',
      });
    }
    this.assertVersionIsDraft(existing.exam_timetable_versions);

    try {
      await this.prisma.exam_timetable.delete({ where: { id } });
    } catch (err: any) {
      if (err?.code === 'P2025') {
        throw new NotFoundException({
          message: 'Exam timetable slot not found.',
          errorCode: 'EXAM_TIMETABLE_NOT_FOUND',
        });
      }

      this.logger.error('DB error while deleting exam timetable slot', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
