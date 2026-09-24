import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodStudentFeedbackService } from './hod-student-feedback.service';
import { CreateHodStudentFeedbackDto } from './dto/create-hod-student-feedback.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('hod/student-feedback')
@Roles(ROLES.HOD)
export class HodStudentFeedbackController {
  constructor(private readonly studentFeedback: HodStudentFeedbackService) {}

  /** GET /hod/student-feedback/forms */
  @Get('forms')
  listForms(@CurrentUser() user: JwtPayload) {
    return this.studentFeedback.listForms(user);
  }

  /** POST /hod/student-feedback/forms */
  @Post('forms')
  createForm(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateHodStudentFeedbackDto,
  ) {
    return this.studentFeedback.createForm(user, dto);
  }

  /** GET /hod/student-feedback/forms/:id/results */
  @Get('forms/:id/results')
  getResults(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.studentFeedback.getResults(user, id);
  }

  /** DELETE /hod/student-feedback/forms/:id */
  @Delete('forms/:id')
  deleteForm(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.studentFeedback.deleteForm(user, id);
  }
}
