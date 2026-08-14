import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { INTERNAL_ERROR } from 'src/modules/sports-admin/common/sports-common';
import { QueryCalendarDto } from './dto/query-calendar.dto';
import { CreateCalendarNoteDto } from './dto/create-calendar-note.dto';

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface CalendarEntry {
  date: string;
  title: string;
  tag: string;
  meta: string;
}

function toCalendarNoteResponse(note: {
  id: number;
  title: string;
  category: string;
  event_date: Date;
  created_by_user_id: number | null;
  created_at: Date;
}) {
  return {
    id: note.id,
    title: note.title,
    category: note.category,
    event_date: toDateOnly(note.event_date),
    created_by_user_id: note.created_by_user_id,
    created_at: note.created_at.toISOString(),
  };
}

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /sports-admin/calendar?year=&month=
   *
   * `year`/`month` (1-12) default to the current server date when omitted.
   * Merges sports_fixtures and sports_calendar_notes falling in that month
   * into a single, date-ascending list of calendar entries.
   */
  async getCalendar(dto: QueryCalendarDto) {
    const now = new Date();
    const year = dto.year ?? now.getUTCFullYear();
    const month = dto.month ?? now.getUTCMonth() + 1;

    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));

    try {
      const [fixtures, notes] = await this.prisma.$transaction([
        this.prisma.sports_fixtures.findMany({
          where: { fixture_date: { gte: start, lt: end } },
          select: { title: true, opponent: true, fixture_date: true },
        }),
        this.prisma.sports_calendar_notes.findMany({
          where: { event_date: { gte: start, lt: end } },
          select: { title: true, category: true, event_date: true },
        }),
      ]);

      const entries: CalendarEntry[] = [
        ...fixtures.map((f) => ({
          date: toDateOnly(f.fixture_date),
          title: f.title,
          tag: 'Fixture',
          meta: f.opponent ? `vs ${f.opponent}` : '',
        })),
        ...notes.map((n) => ({
          date: toDateOnly(n.event_date),
          title: n.title,
          tag: n.category,
          meta: '',
        })),
      ].sort((a, b) => a.date.localeCompare(b.date));

      return { year, month, entries };
    } catch (err) {
      this.logger.error('DB error while fetching calendar', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /** POST /sports-admin/calendar/notes */
  async createNote(dto: CreateCalendarNoteDto, userId: number) {
    try {
      const note = await this.prisma.sports_calendar_notes.create({
        data: {
          title: dto.title,
          category: dto.category,
          event_date: new Date(dto.event_date),
          created_by_user_id: userId,
        },
      });
      return toCalendarNoteResponse(note);
    } catch (err) {
      this.logger.error('DB error while creating calendar note', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * DELETE /sports-admin/calendar/notes/:id
   *
   * Error cases:
   *  404 CALENDAR_NOTE_NOT_FOUND – no calendar note with the given id
   */
  async removeNote(id: number) {
    let note: { id: number } | null;
    try {
      note = await this.prisma.sports_calendar_notes.findUnique({
        where: { id },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error('DB error during calendar note lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    if (!note) {
      throw new NotFoundException({
        message: 'Calendar note not found',
        errorCode: 'CALENDAR_NOTE_NOT_FOUND',
      });
    }

    try {
      await this.prisma.sports_calendar_notes.delete({ where: { id } });
      return { message: 'Calendar note deleted successfully' };
    } catch (err) {
      this.logger.error('DB error while deleting calendar note', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }
}
