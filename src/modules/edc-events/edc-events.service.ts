import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateEdcEventDto } from './dto/create-edc-event.dto';
import { UpdateEdcEventDto } from './dto/update-edc-event.dto';

/**
 * EDC Coordinator's "Events & Competitions" screen — real `edc_events`
 * table, added this session. No generic events/workshop table existed
 * anywhere before (confirmed via a live DB audit, not just a schema grep) —
 * `academic_calendar_events` is a different, already-wired concept scoped
 * to the academic calendar. `participants_count` is coordinator-entered,
 * not derived — no RSVP/registration mechanism exists anywhere to compute
 * it from.
 */
@Injectable()
export class EdcEventsService {
  private readonly logger = new Logger(EdcEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private toResponse(row: any) {
    return {
      id: row.id,
      title: row.title,
      event_type: row.event_type,
      event_date: row.event_date,
      venue: row.venue,
      participants_count: row.participants_count,
      status: row.status,
      created_at: row.created_at,
    };
  }

  async findAll() {
    try {
      const rows = await this.prisma.edc_events.findMany({ orderBy: { event_date: 'asc' } });
      return rows.map((row) => this.toResponse(row));
    } catch (err) {
      this.logger.error('DB error listing edc_events', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async create(dto: CreateEdcEventDto, createdByUserId: number) {
    try {
      const created = await this.prisma.edc_events.create({
        data: {
          title: dto.title,
          event_type: dto.event_type,
          event_date: new Date(dto.event_date),
          venue: dto.venue,
          participants_count: dto.participants_count,
          status: dto.status,
          created_by_user_id: createdByUserId,
        },
      });
      return this.toResponse(created);
    } catch (err) {
      this.logger.error('DB error creating edc_event', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async update(id: number, dto: UpdateEdcEventDto) {
    const existing = await this.prisma.edc_events.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Event not found', errorCode: 'EVENT_NOT_FOUND' });
    }
    try {
      const updated = await this.prisma.edc_events.update({
        where: { id },
        data: {
          title: dto.title,
          event_type: dto.event_type,
          event_date: dto.event_date ? new Date(dto.event_date) : undefined,
          venue: dto.venue,
          participants_count: dto.participants_count,
          status: dto.status,
        },
      });
      return this.toResponse(updated);
    } catch (err) {
      this.logger.error('DB error updating edc_event', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async remove(id: number) {
    const existing = await this.prisma.edc_events.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Event not found', errorCode: 'EVENT_NOT_FOUND' });
    }
    await this.prisma.edc_events.delete({ where: { id } });
    return { id, deleted: true };
  }
}
