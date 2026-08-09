import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
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
import { PersonalCalendarService } from './personal-calendar.service';
import { CreatePersonalCalendarEntryDto } from './dto/create-personal-calendar-entry.dto';
import { UpdatePersonalCalendarEntryDto } from './dto/update-personal-calendar-entry.dto';
import { ListPersonalCalendarEntriesQueryDto } from './dto/list-personal-calendar-entries-query.dto';

/**
 * Private planner entries on top of the read-only institution calendar -
 * Principal only for now. Every route is scoped to the caller's own
 * user_id inside the service - never a client-supplied one.
 */
@Controller('me/personal-calendar-entries')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PersonalCalendarController {
  constructor(private readonly personalCalendarService: PersonalCalendarService) {}

  @Post()
  create(
    @Body() dto: CreatePersonalCalendarEntryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.personalCalendarService.create(user.sub, dto);
  }

  @Get()
  findAll(
    @Query() query: ListPersonalCalendarEntriesQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.personalCalendarService.findAll(user.sub, query);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePersonalCalendarEntryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.personalCalendarService.update(user.sub, id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.personalCalendarService.remove(user.sub, id);
  }
}
