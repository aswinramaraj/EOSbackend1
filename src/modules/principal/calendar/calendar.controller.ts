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
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { PrincipalCalendarService } from './calendar.service';
import { AddPrincipalEventDto } from './dto/add-event.dto';
import { AddPersonalEntryDto } from './dto/add-personal-entry.dto';

/** GET/POST /api/v1/me/principal/calendar/* — Principal only. */
@Controller('me/principal/calendar')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalCalendarController {
  constructor(private readonly calendarService: PrincipalCalendarService) {}

  @Get('events')
  eventsForMonth(
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
  ) {
    return this.calendarService.eventsForMonth(year, month);
  }

  @Post('events')
  addEvent(
    @Body() body: AddPrincipalEventDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.calendarService.addEvent(body, user.sub);
  }

  @Get('personal-entries')
  personalEntriesForMonth(
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.calendarService.personalEntriesForMonth(user.sub, year, month);
  }

  @Post('personal-entries')
  addPersonalEntry(
    @Body() body: AddPersonalEntryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.calendarService.addPersonalEntry(body, user.sub);
  }

  @Delete('personal-entries/:id')
  removePersonalEntry(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.calendarService.removePersonalEntry(id, user.sub);
  }
}
