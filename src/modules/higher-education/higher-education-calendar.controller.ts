import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { HigherEducationCalendarService } from './higher-education-calendar.service';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HIGHER_EDUCATION)
export class HigherEducationCalendarController {
  constructor(private readonly service: HigherEducationCalendarService) {}

  /** GET /api/v1/me/higher-education-academic-calendar — institution-wide calendar merged with the cell's own events. */
  @Get('higher-education-academic-calendar')
  getCalendar() {
    return this.service.getCalendar();
  }

  /** POST /api/v1/me/higher-education-calendar-events — add the cell's own event. */
  @Post('higher-education-calendar-events')
  @HttpCode(HttpStatus.CREATED)
  createEvent(@Body() dto: CreateCalendarEventDto) {
    return this.service.createEvent(dto);
  }
}
