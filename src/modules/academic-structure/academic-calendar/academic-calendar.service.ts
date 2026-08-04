import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateAcademicCalendarDto } from './dto/create-academic-calendar.dto';
import { UpdateAcademicCalendarDto } from './dto/update-academic-calendar.dto';

@Injectable()
export class AcademicCalendarService {
  private readonly logger = new Logger(AcademicCalendarService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateAcademicCalendarDto, userId: number) {
    if (new Date(dto.end_date) <= new Date(dto.start_date)) {
      throw new UnprocessableEntityException({
        message: 'end_date must be after start_date',
        errorCode: 'INVALID_DATE_RANGE',
      });
    }

    const batch = await this.prisma.batches.findUnique({
      where: { id: dto.batch_id },
    });

    if (!batch) {
      throw new NotFoundException({
        message: 'Batch not found',
        errorCode: 'NOT_FOUND',
      });
    }

    const existing = await this.prisma.academic_calendars.findUnique({
      where: {
        batch_id_semester: {
          batch_id: dto.batch_id,
          semester: dto.semester,
        },
      },
    });

    if (existing) {
      throw new ConflictException({
        message:
          'An academic calendar already exists for this batch and semester',
        errorCode: 'CALENDAR_ALREADY_EXISTS',
      });
    }

    try {
      return await this.prisma.academic_calendars.create({
        data: {
          batch_id: dto.batch_id,
          semester: dto.semester,
          start_date: new Date(dto.start_date),
          end_date: new Date(dto.end_date),
          created_by_user_id: userId,
        },
      });
    } catch (err) {
      this.logger.error('DB error creating academic calendar', err);

      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
  findAll() {
    return this.prisma.academic_calendars.findMany({
      orderBy: [{ batch_id: 'asc' }, { semester: 'asc' }],
    });
  }

  async findOne(id: number) {
    const calendar = await this.prisma.academic_calendars.findUnique({
      where: { id },
    });

    if (!calendar) {
      throw new NotFoundException({
        message: 'Academic calendar not found',
        errorCode: 'NOT_FOUND',
      });
    }

    return calendar;
  }

  async update(id: number, dto: UpdateAcademicCalendarDto) {
    const calendar = await this.findOne(id);

    const nextStart = dto.start_date ?? calendar.start_date;
    const nextEnd = dto.end_date ?? calendar.end_date;

    if (new Date(nextEnd) <= new Date(nextStart)) {
      throw new UnprocessableEntityException({
        message: 'end_date must be after start_date',
        errorCode: 'INVALID_DATE_RANGE',
      });
    }

    if (dto.batch_id !== undefined && dto.batch_id !== calendar.batch_id) {
      const batch = await this.prisma.batches.findUnique({
        where: { id: dto.batch_id },
      });

      if (!batch) {
        throw new NotFoundException({
          message: 'Batch not found',
          errorCode: 'NOT_FOUND',
        });
      }
    }

    if (dto.batch_id !== undefined || dto.semester !== undefined) {
      const nextBatchId = dto.batch_id ?? calendar.batch_id;
      const nextSemester = dto.semester ?? calendar.semester;

      const duplicate = await this.prisma.academic_calendars.findUnique({
        where: {
          batch_id_semester: {
            batch_id: nextBatchId,
            semester: nextSemester,
          },
        },
      });

      if (duplicate && duplicate.id !== id) {
        throw new ConflictException({
          message:
            'An academic calendar already exists for this batch and semester',
          errorCode: 'CALENDAR_ALREADY_EXISTS',
        });
      }
    }

    try {
      return await this.prisma.academic_calendars.update({
        where: { id },
        data: {
          batch_id: dto.batch_id,
          semester: dto.semester,
          start_date: dto.start_date ? new Date(dto.start_date) : undefined,
          end_date: dto.end_date ? new Date(dto.end_date) : undefined,
        },
      });
    } catch (err) {
      this.logger.error(`DB error updating academic calendar #${id}`, err);

      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async remove(id: number) {
    await this.findOne(id);

    await this.prisma.academic_calendars.delete({
      where: { id },
    });

    return {
      message: 'Academic calendar deleted successfully',
    };
  }
}
