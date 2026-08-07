import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { ExamMarksService } from './exam-marks.service';
import { EnterExamMarksDto } from './dto/enter-exam-marks.dto';
import { UpdateExamMarkDto } from './dto/update-exam-mark.dto';
import { ListExamMarksQueryDto } from './dto/list-exam-marks-query.dto';
import { ValidateExamMarksDto } from './dto/validate-exam-marks.dto';

/**
 * Faculty-side exam marks entry — reads exam_subject_mapping (created by
 * COE) to know which class+subject to enter marks for, but never creates
 * or modifies exams/exam_subject_mapping/exam_types themselves.
 */
@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.FACULTY)
export class ExamMarksController {
  constructor(private readonly examMarksService: ExamMarksService) {}

  /** POST /api/v1/me/exams/:exam_subject_mapping_id/marks — enter marks for a whole class at once. */
  @Post('exams/:exam_subject_mapping_id/marks')
  @HttpCode(HttpStatus.CREATED)
  enterMarks(
    @Param('exam_subject_mapping_id', ParseIntPipe)
    examSubjectMappingId: number,
    @Body() dto: EnterExamMarksDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.examMarksService.enterMarks(
      examSubjectMappingId,
      dto,
      user.sub,
    );
  }

  /**
   * POST /api/v1/me/exam-marks/validate — checks whether every student in
   * the class has a mark entered. Stateless: nothing is persisted or locked.
   */
  @Post('exam-marks/validate')
  validate(@Body() dto: ValidateExamMarksDto, @CurrentUser() user: JwtPayload) {
    return this.examMarksService.validate(dto, user.sub);
  }

  /**
   * GET /api/v1/me/exam-marks/roster/:exam_subject_mapping_id — full class
   * roster joined against any already-entered marks. Declared before
   * `exam-marks/:id` so "roster" is never swallowed by the :id param route.
   */
  @Get('exam-marks/roster/:exam_subject_mapping_id')
  getRoster(
    @Param('exam_subject_mapping_id', ParseIntPipe) examSubjectMappingId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.examMarksService.getRoster(examSubjectMappingId, user.sub);
  }

  /** GET /api/v1/me/exam-marks — own-entered records, filtered, paginated. */
  @Get('exam-marks')
  findAll(
    @Query() query: ListExamMarksQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.examMarksService.findAll(query, user.sub);
  }

  /** GET /api/v1/me/exam-marks/:id — own-entered record. */
  @Get('exam-marks/:id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.examMarksService.findOne(id, user.sub);
  }

  /** PATCH /api/v1/me/exam-marks/:id — correct a wrongly-entered mark. */
  @Patch('exam-marks/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateExamMarkDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.examMarksService.update(id, dto, user.sub);
  }
}
