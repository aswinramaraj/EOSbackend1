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
import { FeedbackService } from './feedback.service';
import { CreateFeedbackFormDto } from './dto/create-feedback-form.dto';
import { UpdateFeedbackFormDto } from './dto/update-feedback-form.dto';
import { CreateFeedbackQuestionDto } from './dto/create-feedback-question.dto';
import { UpdateFeedbackQuestionDto } from './dto/update-feedback-question.dto';
import { ListFeedbackFormsQueryDto } from './dto/list-feedback-forms-query.dto';
import { GetQuestionTemplatesQueryDto } from './dto/get-question-templates-query.dto';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { ROLES } from '../../../common/constants/roles.constant';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';

/**
 * Feedback form management — created by the Academic Coordinator (per worflow.md),
 * with Admin retaining oversight access.
 */
@Controller('feedback/forms')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ACADEMIC_COORDINATOR, ROLES.ADMIN)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateFeedbackFormDto) {
    return this.feedbackService.createForm(user, dto);
  }

  @Get()
  findAll(@Query() query: ListFeedbackFormsQueryDto) {
    return this.feedbackService.listForms(query);
  }

  /** Must stay above @Get(':id') — same path shape, "question-templates" would otherwise be parsed as an :id. */
  @Get('question-templates')
  questionTemplates(@Query() query: GetQuestionTemplatesQueryDto) {
    return this.feedbackService.listQuestionTemplates(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.feedbackService.getForm(id);
  }

  @Get(':id/results')
  results(@Param('id', ParseIntPipe) id: number) {
    return this.feedbackService.getResults(id);
  }

  @Patch(':id/publish')
  publish(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.feedbackService.publishForm(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFeedbackFormDto,
  ) {
    return this.feedbackService.updateForm(user, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.feedbackService.deleteForm(user, id);
  }

  @Post(':id/questions')
  addQuestion(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateFeedbackQuestionDto,
  ) {
    return this.feedbackService.addQuestion(user, id, dto);
  }

  @Patch(':id/questions/:questionId')
  updateQuestion(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body() dto: UpdateFeedbackQuestionDto,
  ) {
    return this.feedbackService.updateQuestion(user, id, questionId, dto);
  }

  @Delete(':id/questions/:questionId')
  removeQuestion(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('questionId', ParseIntPipe) questionId: number,
  ) {
    return this.feedbackService.deleteQuestion(user, id, questionId);
  }
}
