import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { IqacCalendarService } from './iqac-calendar.service';

/**
 * GET /api/v1/me/iqac/calendar/* — IQAC only, read-only. Real
 * calendar_events, enriched with the real batch/semester each event's
 * academic_calendars row carries (the shared /academic-calendar-events
 * endpoint every role can already read doesn't return that join).
 */
@Controller('me/iqac/calendar')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.IQAC)
export class IqacCalendarController {
  constructor(private readonly calendar: IqacCalendarService) {}

  @Get('filters')
  filters() {
    return this.calendar.filters();
  }

  @Get('events')
  events(
    @Query('batch_id') batchId?: string,
    @Query('semester') semester?: string,
    @Query('type') type?: string,
  ) {
    return this.calendar.events(
      batchId ? Number(batchId) : undefined,
      semester ? Number(semester) : undefined,
      type,
    );
  }

  @Get('quality')
  quality() {
    return this.calendar.quality();
  }
}
