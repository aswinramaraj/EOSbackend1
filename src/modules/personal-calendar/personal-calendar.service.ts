import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { CreatePersonalCalendarEntryDto } from './dto/create-personal-calendar-entry.dto';
import { UpdatePersonalCalendarEntryDto } from './dto/update-personal-calendar-entry.dto';
import { ListPersonalCalendarEntriesQueryDto } from './dto/list-personal-calendar-entries-query.dto';

function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * A private planner layered on top of the read-only institution academic
 * calendar (calendar_events) - every method here is hard-scoped to the
 * caller's own user_id, never a client-supplied one, so one user can never
 * read/edit/delete another's entries.
 */
@Injectable()
export class PersonalCalendarService {
  private readonly logger = new Logger(PersonalCalendarService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(userId: number, dto: CreatePersonalCalendarEntryDto) {
    try {
      return await this.prisma.personal_calendar_entries.create({
        data: {
          user_id: userId,
          entry_date: toDateOnly(dto.entry_date),
          title: dto.title,
          category: dto.category,
          details: dto.details,
        },
      });
    } catch (err) {
      this.logger.error('DB error creating personal calendar entry', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll(userId: number, query: ListPersonalCalendarEntriesQueryDto) {
    const where: Prisma.personal_calendar_entriesWhereInput = {
      user_id: userId,
      ...((query.from || query.to) && {
        entry_date: {
          ...(query.from && { gte: toDateOnly(query.from) }),
          ...(query.to && { lte: toDateOnly(query.to) }),
        },
      }),
    };

    try {
      return await this.prisma.personal_calendar_entries.findMany({
        where,
        orderBy: { entry_date: 'asc' },
      });
    } catch (err) {
      this.logger.error('DB error listing personal calendar entries', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async update(userId: number, id: number, dto: UpdatePersonalCalendarEntryDto) {
    await this.assertOwn(userId, id);

    try {
      return await this.prisma.personal_calendar_entries.update({
        where: { id },
        data: {
          entry_date: dto.entry_date ? toDateOnly(dto.entry_date) : undefined,
          title: dto.title,
          category: dto.category,
          details: dto.details,
        },
      });
    } catch (err) {
      this.logger.error(`DB error updating personal calendar entry #${id}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async remove(userId: number, id: number) {
    await this.assertOwn(userId, id);

    try {
      await this.prisma.personal_calendar_entries.delete({ where: { id } });
      return { id, deleted: true };
    } catch (err) {
      this.logger.error(`DB error deleting personal calendar entry #${id}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async assertOwn(userId: number, id: number) {
    const entry = await this.prisma.personal_calendar_entries.findUnique({
      where: { id },
    });
    if (!entry) {
      throw new NotFoundException({
        message: 'Entry not found',
        errorCode: 'NOT_FOUND',
      });
    }
    if (entry.user_id !== userId) {
      throw new ForbiddenException({
        message: 'You may only modify your own entries',
        errorCode: 'NOT_OWNER',
      });
    }
  }
}
