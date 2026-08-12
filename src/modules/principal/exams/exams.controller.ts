import {
  Controller,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalExamsService } from './exams.service';

/** GET /api/v1/me/principal/exams/* — Principal only. */
@Controller('me/principal/exams')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalExamsController {
  constructor(private readonly examsService: PrincipalExamsService) {}

  @Get('summary')
  summary() {
    return this.examsService.summary();
  }

  @Get('filters')
  filters() {
    return this.examsService.filters();
  }

  @Get('classes')
  classesForBatch(@Query('batch_id', ParseIntPipe) batchId: number) {
    return this.examsService.classesForBatch(batchId);
  }

  @Get('semesters')
  semestersForBatch(@Query('batch_id', ParseIntPipe) batchId: number) {
    return this.examsService.semestersForBatch(batchId);
  }

  @Get('exams')
  examsForBatchSemester(
    @Query('batch_id', ParseIntPipe) batchId: number,
    @Query('semester', ParseIntPipe) semester: number,
  ) {
    return this.examsService.examsForBatchSemester(batchId, semester);
  }

  @Get('results')
  results(
    @Query('exam_id', ParseIntPipe) examId: number,
    @Query('class_id', ParseIntPipe) classId: number,
  ) {
    return this.examsService.results(examId, classId);
  }
}
