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
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalExamsService } from 'src/modules/principal/exams/exams.service';
import { ClassesService } from 'src/modules/academic-structure/classes/classes.service';
import { CreateClassDto } from 'src/modules/academic-structure/classes/dto/create-class.dto';
import { AssignMentorDto } from 'src/modules/academic-structure/classes/dto/assign-mentor.dto';
import { CoursesService } from 'src/modules/academic-structure/courses/courses.service';
import { IqacAcademicQualityService } from './iqac-academic-quality.service';

/**
 * GET /api/v1/me/iqac/academic-quality/* — IQAC only.
 *
 * The exam-filter-cascade routes (exam-filters/exam-semesters/exams)
 * delegate straight to PrincipalExamsService — the exact same real
 * batch/exam-type/semester/exam lookups Principal's own Exams page uses,
 * not a duplicate. `results` and `grade-distribution` are new aggregates
 * (see IqacAcademicQualityService) built for this page specifically.
 *
 * `class-options` / `POST class-rows` back the Attendance/CGPA pages'
 * "+ Add class row" action (the reference design's one real write action
 * on those two pages) — delegates straight to the real ClassesService,
 * i.e. this genuinely registers a new class/section (`classes` table),
 * not a fabricated attendance/CGPA number. The new class then shows up in
 * the Attendance/CGPA register with honest "—" values until real
 * attendance/exam data is recorded for it elsewhere.
 */
@Controller('me/iqac/academic-quality')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.IQAC)
export class IqacAcademicQualityController {
  constructor(
    private readonly academicQuality: IqacAcademicQualityService,
    private readonly examsService: PrincipalExamsService,
    private readonly classesService: ClassesService,
    private readonly coursesService: CoursesService,
  ) {}

  @Get('class-options')
  async classOptions() {
    const [filters, courses] = await Promise.all([
      this.examsService.filters(),
      this.coursesService.findAll(),
    ]);
    return { batches: filters.batches, courses };
  }

  @Post('class-rows')
  createClassRow(@Body() dto: CreateClassDto) {
    return this.classesService.create(dto);
  }

  @Post('class-rows/:id/mentor')
  assignClassMentor(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignMentorDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.classesService.assignMentor(id, dto, user.sub);
  }

  @Get('attendance')
  attendance() {
    return this.academicQuality.attendance();
  }

  @Get('exam-filters')
  examFilters() {
    return this.examsService.filters();
  }

  @Get('exam-semesters')
  examSemesters(@Query('batch_id', ParseIntPipe) batchId: number) {
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
    @Query('batch_id') batchId?: string,
    @Query('section') section?: string,
  ) {
    return this.academicQuality.results(
      batchId ? Number(batchId) : undefined,
      section,
    );
  }

  @Get('grade-distribution')
  gradeDistribution(@Query('batch_id') batchId?: string) {
    return this.academicQuality.gradeDistribution(
      batchId ? Number(batchId) : undefined,
    );
  }

  @Get('course-attainment')
  courseAttainment(
    @Query('department_id') departmentId?: string,
    @Query('batch_id') batchId?: string,
  ) {
    return this.academicQuality.courseAttainment(
      departmentId ? Number(departmentId) : undefined,
      batchId ? Number(batchId) : undefined,
    );
  }

  @Get('program-attainment')
  programAttainment(
    @Query('department_id') departmentId?: string,
    @Query('batch_id') batchId?: string,
  ) {
    return this.academicQuality.programAttainment(
      departmentId ? Number(departmentId) : undefined,
      batchId ? Number(batchId) : undefined,
    );
  }
}
