import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * GET /hod/academic-calendar?year=&month= — institution-wide holidays/events
 * for one calendar month, from the real `calendar_events` table. Not
 * department-scoped: calendar_events belong to a batch+semester's
 * academic_calendars row, not a department, and holidays apply to
 * everyone regardless of department — same institution-wide framing the
 * frontend hook itself uses (no department/batch param at all).
 */
@Injectable()
export class HodAcademicCalendarService {
  private readonly logger = new Logger(HodAcademicCalendarService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getMonth(year: number, month: number) {
    try {
      const start = new Date(Date.UTC(year, month - 1, 1));
      const end = new Date(Date.UTC(year, month, 1));
      const events = await this.prisma.calendar_events.findMany({
        where: { event_date: { gte: start, lt: end } },
        select: {
          id: true,
          event_date: true,
          title: true,
          description: true,
          event_type: true,
        },
        orderBy: { event_date: 'asc' },
      });
      return {
        year,
        month,
        events: events.map((e) => ({
          id: e.id,
          event_date: toDateOnly(e.event_date),
          title: e.title,
          description: e.description,
          event_type: e.event_type,
        })),
      };
    } catch (err) {
      this.logger.error('DB error computing HoD academic calendar month', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
