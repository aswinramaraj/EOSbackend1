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

  async create(createExamTimetableDto: CreateExamTimetableDto) {
    const {
      exam_subject_mapping_id,
      version_id,
      session,
      exam_date,
      start_time,
      end_time,
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

    const version = await this.prisma.exam_timetable_versions.findUnique({
      where: { id: version_id },
    });

    if (!version) {
      throw new NotFoundException({
        message: 'Exam timetable version not found.',
        errorCode: 'EXAM_TIMETABLE_VERSION_NOT_FOUND',
      });
    }

    const existing = await this.prisma.exam_timetable.findUnique({
      where: {
        version_id_exam_subject_mapping_id: {
          version_id,
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
      return await this.prisma.exam_timetable.create({
        data: {
          exam_subject_mapping_id,
          version_id,
          session,
          exam_date: new Date(exam_date),
          start_time: startTime,
          end_time: endTime,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException({
          message: 'Exam timetable already exists.',
          errorCode: 'EXAM_TIMETABLE_EXISTS',
        });
      }

      if (err?.code === 'P2003') {
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
    } catch (err: any) {
      this.logger.error('DB error while fetching exam timetables', err);
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
        include: { exam_subject_mapping: true },
      });
    } catch (err: any) {
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
    const version_id =
      updateExamTimetableDto.version_id ?? existing.version_id;

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
    }

    if (
      updateExamTimetableDto.version_id !== undefined &&
      updateExamTimetableDto.version_id !== existing.version_id
    ) {
      const version = await this.prisma.exam_timetable_versions.findUnique({
        where: { id: updateExamTimetableDto.version_id },
      });

      if (!version) {
        throw new NotFoundException({
          message: 'Exam timetable version not found.',
          errorCode: 'EXAM_TIMETABLE_VERSION_NOT_FOUND',
        });
      }
    }

    if (
      exam_subject_mapping_id !== existing.exam_subject_mapping_id ||
      version_id !== existing.version_id
    ) {
      const duplicate = await this.prisma.exam_timetable.findUnique({
        where: {
          version_id_exam_subject_mapping_id: {
            version_id,
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
      return await this.prisma.exam_timetable.update({
        where: { id },
        data: {
          exam_subject_mapping_id:
            updateExamTimetableDto.exam_subject_mapping_id,
          version_id: updateExamTimetableDto.version_id,
          session: updateExamTimetableDto.session,
          exam_date: updateExamTimetableDto.exam_date
            ? new Date(updateExamTimetableDto.exam_date)
            : undefined,
          start_time: updateExamTimetableDto.start_time ? startTime : undefined,
          end_time: updateExamTimetableDto.end_time ? endTime : undefined,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException({
          message: 'Exam timetable already exists.',
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
    } catch (err: any) {
      if (err?.code === 'P2025') {
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
