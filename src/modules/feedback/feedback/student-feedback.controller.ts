import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { SubmitFeedbackResponsesDto } from './dto/submit-feedback-responses.dto';
import { ListStudentFeedbackFormsQueryDto } from './dto/list-student-feedback-forms-query.dto';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { ROLES } from '../../../common/constants/roles.constant';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';

/**
 * Student-facing feedback endpoints — filling forms created by the Academic Coordinator (per worflow.md).
 */
@Controller('feedback/student')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.STUDENT)
export class StudentFeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  /** ?service_type= narrows to that one Campus-tab service's own review form(s) instead of the academic list. */
  @Get('forms')
  listForms(@CurrentUser() user: JwtPayload, @Query() query: ListStudentFeedbackFormsQueryDto) {
    return this.feedbackService.listFormsForStudent(user, query.service_type);
  }

  @Get('forms/:id')
  getForm(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.feedbackService.getFormForStudent(user, id);
  }

  @Post('forms/:id/responses')
  submit(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmitFeedbackResponsesDto,
  ) {
    return this.feedbackService.submitResponses(user, id, dto);
  }
}
