import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';
import { MarksRosterService } from './marks-roster.service';
import { MarksRosterQueryDto } from './dto/marks-roster-query.dto';
import { GradeMatrixQueryDto } from './dto/grade-matrix-query.dto';
import { DepartmentCompletionQueryDto } from './dto/department-completion-query.dto';
import { ResultsSummaryQueryDto } from './dto/results-summary-query.dto';
import { CourseMarkStatusQueryDto } from './dto/course-mark-status-query.dto';
import { VerifyMappingMarksDto } from './dto/verify-mapping-marks.dto';

/**
 * Read-only aggregation for the COE Marks entry / Mark records pages.
 * Built entirely over existing tables (exam_subject_mapping, exam_marks,
 * students, soa_applications, exam_pass_rules_settings, marks_entry_locks)
 * — no schema change. Doesn't touch the FACULTY/ADMIN write path on
 * /exam-marks or the ADMIN-only /students controller.
 */
@Controller('marks-roster')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class MarksRosterController {
  constructor(private readonly marksRosterService: MarksRosterService) {}

  // Must come before any future ":id"-style route on this controller.
  @Get('grade-matrix')
  async getGradeMatrix(@Query() query: GradeMatrixQueryDto) {
    const matrix = await this.marksRosterService.getGradeMatrix(query);
    return ApiResponse.ok(matrix, 'Grade matrix fetched successfully.');
  }

  @Get('department-completion')
  async getDepartmentCompletion(@Query() query: DepartmentCompletionQueryDto) {
    const completion = await this.marksRosterService.getDepartmentCompletion(query);
    return ApiResponse.ok(completion, 'Department completion fetched successfully.');
  }

  @Get('results-summary')
  async getResultsSummary(@Query() query: ResultsSummaryQueryDto) {
    const summary = await this.marksRosterService.getResultsSummary(query);
    return ApiResponse.ok(summary, 'Results summary fetched successfully.');
  }

  @Get('course-status')
  async getCourseMarkStatus(@Query() query: CourseMarkStatusQueryDto) {
    const status = await this.marksRosterService.getCourseMarkStatus(query);
    return ApiResponse.ok(status, 'Course mark status fetched successfully.');
  }

  @Post('verify')
  async verifyMapping(@Body() dto: VerifyMappingMarksDto) {
    const result = await this.marksRosterService.verifyMapping(dto);
    return ApiResponse.ok(result, 'Marks verified successfully.');
  }

  @Get()
  async getRoster(@Query() query: MarksRosterQueryDto) {
    const roster = await this.marksRosterService.getRoster(query);
    return ApiResponse.ok(roster, 'Marks roster fetched successfully.');
  }
}
