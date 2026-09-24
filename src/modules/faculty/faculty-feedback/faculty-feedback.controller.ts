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
import { FacultyFeedbackService } from './faculty-feedback.service';
import { CreateFacultyFeedbackFormDto } from './dto/create-faculty-feedback-form.dto';
import { SubmitFacultyFeedbackDto } from './dto/submit-faculty-feedback.dto';

/** HoD side - post feedback forms to their own department's faculty. */
@Controller('hod/faculty-feedback-forms')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodFacultyFeedbackFormsController {
  constructor(private readonly service: FacultyFeedbackService) {}

  /** GET /hod/faculty-feedback-forms */
  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.service.listForHod(user);
  }

  /** POST /hod/faculty-feedback-forms */
  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateFacultyFeedbackFormDto,
  ) {
    return this.service.createForHod(user, dto);
  }

  /** GET /hod/faculty-feedback-forms/:id/results */
  @Get(':id/results')
  results(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.resultsForHod(user, id);
  }

  /** DELETE /hod/faculty-feedback-forms/:id */
  @Delete(':id')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.deleteForHod(user, id);
  }
}

/**
 * Faculty side - answer the HoD's feedback forms (Campus tab). HOD is
 * allowed too so a HoD switched to Faculty view can answer another HoD's
 * form in their department; nobody is ever shown their own form.
 */
@Controller('me/faculty-feedback')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.FACULTY, ROLES.HOD)
export class MyFacultyFeedbackController {
  constructor(private readonly service: FacultyFeedbackService) {}

  /** GET /me/faculty-feedback/forms */
  @Get('forms')
  list(@CurrentUser() user: JwtPayload) {
    return this.service.listForFaculty(user);
  }

  /** GET /me/faculty-feedback/forms/:id */
  @Get('forms/:id')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.getForFaculty(user, id);
  }

  /** POST /me/faculty-feedback/forms/:id/responses */
  @Post('forms/:id/responses')
  submit(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmitFacultyFeedbackDto,
  ) {
    return this.service.submitForFaculty(user, id, dto);
  }
}
