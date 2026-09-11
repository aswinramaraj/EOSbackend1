import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AcademicCalendarEventsService } from './academic-calendar-events.service';
import { CreateAcademicCalendarEventDto } from './dto/create-academic-calendar-event.dto';
import { UpdateAcademicCalendarEventDto } from './dto/update-academic-calendar-event.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

@Controller('academic-calendar-events')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AcademicCalendarEventsController {
  constructor(
    private readonly academicCalendarEventsService: AcademicCalendarEventsService,
  ) {}

  @Post()
  @Roles(
    ROLES.ACADEMIC_COORDINATOR,
    ROLES.PRINCIPAL,
    ROLES.SECRETARY,
    ROLES.MEDIA_ROOM,
    ROLES.PLACEMENT,
  )
  create(
    @Body() createAcademicCalendarEventDto: CreateAcademicCalendarEventDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.academicCalendarEventsService.create(
      createAcademicCalendarEventDto,
      user.sub,
    );
  }

  @Get()
  findAll(@Query('academic_calendar_id') academicCalendarId?: string) {
    return this.academicCalendarEventsService.findAll(
      academicCalendarId ? +academicCalendarId : undefined,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.academicCalendarEventsService.findOne(+id);
  }

  @Patch(':id')
  @Roles(
    ROLES.ACADEMIC_COORDINATOR,
    ROLES.PRINCIPAL,
    ROLES.SECRETARY,
    ROLES.MEDIA_ROOM,
    ROLES.PLACEMENT,
  )
  update(
    @Param('id') id: string,
    @Body() updateAcademicCalendarEventDto: UpdateAcademicCalendarEventDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.academicCalendarEventsService.update(
      +id,
      updateAcademicCalendarEventDto,
      user,
    );
  }

  @Delete(':id')
  @Roles(
    ROLES.ACADEMIC_COORDINATOR,
    ROLES.PRINCIPAL,
    ROLES.SECRETARY,
    ROLES.MEDIA_ROOM,
    ROLES.PLACEMENT,
  )
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.academicCalendarEventsService.remove(+id, user);
  }
}
