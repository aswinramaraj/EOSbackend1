import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { CalendarService } from './calendar.service';
import { QueryCalendarDto } from './dto/query-calendar.dto';
import { CreateCalendarNoteDto } from './dto/create-calendar-note.dto';

@Controller('sports-admin/calendar')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SPORTS_ADMIN, ROLES.ADMIN)
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get()
  getCalendar(@Query() query: QueryCalendarDto) {
    return this.calendarService.getCalendar(query);
  }

  @Post('notes')
  createNote(
    @Body() dto: CreateCalendarNoteDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.calendarService.createNote(dto, user.sub);
  }

  @Delete('notes/:id')
  removeNote(@Param('id', ParseIntPipe) id: number) {
    return this.calendarService.removeNote(id);
  }
}
