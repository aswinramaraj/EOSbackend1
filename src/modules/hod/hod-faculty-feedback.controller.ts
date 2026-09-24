import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodFacultyFeedbackService } from './hod-faculty-feedback.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('hod/faculty-feedback')
@Roles(ROLES.HOD)
export class HodFacultyFeedbackController {
  constructor(private readonly facultyFeedback: HodFacultyFeedbackService) {}

  /** GET /hod/faculty-feedback/forms */
  @Get('forms')
  listForms(@CurrentUser() user: JwtPayload) {
    return this.facultyFeedback.listForms(user);
  }

  /** GET /hod/faculty-feedback/forms/:id/results */
  @Get('forms/:id/results')
  getResults(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyFeedback.getResults(user, id);
  }
}
