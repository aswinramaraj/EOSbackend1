import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodTimetableService } from './hod-timetable.service';

@Controller('hod/timetable')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodTimetableController {
  constructor(private readonly hodTimetableService: HodTimetableService) {}

  /** GET /api/v1/hod/timetable?class_id= */
  @Get()
  getTimetable(
    @CurrentUser() user: JwtPayload,
    @Query('class_id') classId?: string,
  ) {
    return this.hodTimetableService.getTimetable(
      user.sub,
      classId ? Number(classId) : undefined,
    );
  }

  /** PUT /api/v1/hod/timetable/slot */
  @Put('slot')
  setSlot(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      class_id: number;
      day_of_week: number;
      period_number: number;
      subject_id: number;
      faculty_id: number;
    },
  ) {
    return this.hodTimetableService.setSlot(
      user.sub,
      Number(body.class_id),
      Number(body.day_of_week),
      Number(body.period_number),
      Number(body.subject_id),
      Number(body.faculty_id),
    );
  }

  /** DELETE /api/v1/hod/timetable/slot/:id */
  @Delete('slot/:id')
  clearSlot(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.hodTimetableService.clearSlot(user.sub, Number(id));
  }
}
